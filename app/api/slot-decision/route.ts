import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import {
  extractSearchTerm,
  competitionLevelToScore,
  estimateCompetitionLevel,
  competitionSignalLine
} from '@/services/competitionCheck';
import type { SlotDecision, SlotDecisionVerdict, UrgencyLevel, CompetitionLevel } from '@/types/pod';
import { stripJsonFences } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 30; // Two fast text-only Gemini calls, no images

const MODEL_ID = 'gemini-3-flash-preview'; // Pinned — prevents silent scoring drift on model updates

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
}

function computeSlotWorthiness(crs: number, competitionScore: number): number {
  return Math.round(crs * 0.6 + competitionScore * 0.4);
}

function getVerdict(slotWorthiness: number, level: CompetitionLevel): SlotDecisionVerdict {
  if (level === 'OVERCROWDED') return 'SKIP';
  if (slotWorthiness >= 70) return 'GO';
  if (slotWorthiness >= 50) return 'HOLD';
  return 'SKIP';
}

function getUrgency(verdict: SlotDecisionVerdict, level: CompetitionLevel, hasSeasonalNote: boolean): UrgencyLevel {
  if (verdict === 'SKIP') return 'SKIP';
  if (verdict === 'HOLD') return 'WAIT_FOR_SEASON';
  // verdict === GO
  if (level === 'BLUE_OCEAN') return 'UPLOAD_TODAY';
  return hasSeasonalNote ? 'UPLOAD_TODAY' : 'UPLOAD_THIS_WEEK';
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not configured' }, { status: 500 });
    }

    const body = await req.json() as {
      crs: number;
      nicheAgentOutput: Record<string, unknown>;
      cloudVisionLabels: Array<{ description: string; score: number }>;
      filename: string;
    };

    const { crs, nicheAgentOutput, cloudVisionLabels } = body;

    if (typeof crs !== 'number' || crs < 0 || crs > 100) {
      return NextResponse.json({ error: 'Invalid CRS value' }, { status: 400 });
    }

    const searchTerm = extractSearchTerm(nicheAgentOutput ?? {}, cloudVisionLabels ?? []);
    const ai = getAI();

    // Step 1 — Competition estimation (temperature 0, deterministic)
    const competitionPrompt = `You are a Merch by Amazon market analyst with deep knowledge of POD niche saturation.

Based on your training knowledge of the Merch by Amazon marketplace:
Estimate the approximate number of competing listings for: "${searchTerm}"

Consider:
- Very broad pet/dog niches have 10,000+ listings
- Breed-specific niches typically 2,000-10,000
- Breed + behavior specific (e.g. "border collie fetch") typically 500-2,000
- Hyper-specific (breed + activity + event) typically < 500
- Also note any upcoming seasonal opportunity (Christmas, Mother's Day, etc.) if relevant

Return ONLY valid JSON, no markdown:
{
  "estimatedListings": "< 500" or "500-2,000" or "2,000-10,000" or "> 10,000",
  "seasonalNote": "string or null"
}`;

    const competitionResult = await ai.models.generateContent({
      model: MODEL_ID,
      config: { temperature: 0 },
      contents: [{ parts: [{ text: competitionPrompt }] }]
    });

    const competitionText = stripJsonFences(competitionResult.text ?? '{}');
    let estimatedListings = 'unknown';
    let seasonalNote: string | null = null;

    try {
      const parsed = JSON.parse(competitionText) as { estimatedListings?: string; seasonalNote?: string | null };
      estimatedListings = parsed.estimatedListings ?? 'unknown';
      seasonalNote = parsed.seasonalNote ?? null;
    } catch {
      console.warn('Competition JSON parse failed, raw:', competitionText.slice(0, 200));
    }

    const level = estimateCompetitionLevel(estimatedListings);
    const competitionScore = competitionLevelToScore(level);
    const slotWorthiness = computeSlotWorthiness(crs, competitionScore);
    const verdict = getVerdict(slotWorthiness, level);
    const urgency = getUrgency(verdict, level, !!seasonalNote);
    const signal = competitionSignalLine(level, searchTerm);

    // Step 2 — Reasoning synthesis (temperature 0.7, expressive)
    const reasoningPrompt = `You are advising a Merch by Amazon seller on a single slot decision.

Design CRS: ${crs}/100
Market: "${searchTerm}"
Competition: ${level} (~${estimatedListings} listings)
Slot Worthiness: ${slotWorthiness}/100
Verdict: ${verdict}
${seasonalNote ? `Seasonal opportunity: ${seasonalNote}` : ''}

Write ONE concise sentence (max 20 words) explaining why this verdict is correct. Be direct and specific. No fluff.`;

    const reasoningResult = await ai.models.generateContent({
      model: MODEL_ID,
      config: { temperature: 0.7 },
      contents: [{ parts: [{ text: reasoningPrompt }] }]
    });

    const reasoning = (reasoningResult.text ?? '').trim().replace(/^["']|["']$/g, '');

    const slotDecision: SlotDecision = {
      slotWorthiness,
      verdict,
      urgency,
      competition: {
        level,
        estimatedListings,
        searchTerm,
        competitionScore,
        signal
      },
      reasoning,
      seasonalNote
    };

    return NextResponse.json(slotDecision);

  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('Slot decision error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
