import { GoogleGenAI } from '@google/genai';
import { analyzeDesignWithCloudVision, formatVisionContextForAgents } from './cloudVision';
import { COMPOSITION_DIRECTOR_PROMPT } from './pod-agents/compositionDirector';
import { CONTRAST_ANALYST_PROMPT } from './pod-agents/contrastAnalyst';
import { NICHE_CLARITY_PROMPT } from './pod-agents/nicheClarityAgent';
import { THUMBNAIL_AGENT_PROMPT } from './pod-agents/thumbnailAgent';
import { POD_COMMERCIAL_STRATEGIST_PROMPT } from './pod-agents/commercialStrategist';
import { POD_ARCHETYPE_READER_PROMPT } from './pod-agents/archetypeReader';
import { PLATFORM_AGENT_PROMPT } from './pod-agents/platformAgent';
import { VOICE_ANALYZER_PROMPT } from './pod-agents/voiceAnalyzer';
import type { PODReport, PODNarrative, UploadDecision, CloudVisionData } from '@/types/pod';

const MODEL_ID = 'gemini-2.5-flash';

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
}

function stripJsonFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

async function runAgent(prompt: string, imageBase64: string, mimeType: string = 'image/jpeg'): Promise<Record<string, unknown>> {
  const ai = getAI();
  const result = await ai.models.generateContent({
    model: MODEL_ID,
    config: { temperature: 0 }, // Deterministic scoring — same design always returns the same CRS
    contents: [
      {
        parts: [
          { inlineData: { data: imageBase64, mimeType } },
          { text: prompt }
        ]
      }
    ]
  });

  const text = result.text ?? '';
  const clean = stripJsonFences(text);

  try {
    return JSON.parse(clean);
  } catch {
    console.error('Agent JSON parse failed. Raw response:', text.slice(0, 500));
    throw new Error('Agent returned invalid JSON');
  }
}

function computeCRS(scores: Record<string, number>): number {
  // Weighted composite — thumbnail and niche clarity carry the most weight for POD
  // voice at 0.10 funds proportionally reduced from composition, contrast, commercial, platform
  const weights: Record<string, number> = {
    composition: 0.13,
    contrast:    0.09,
    niche:       0.23,   // #1 — niche clarity is the top predictor
    thumbnail:   0.23,   // #1 — if it doesn't work at thumbnail, nothing else matters
    commercial:  0.13,
    archetype:   0.05,
    platform:    0.04,
    voice:       0.10    // parasocial voice type — does the text speak TO the buyer?
  };

  return Math.round(
    Object.entries(weights).reduce((total, [key, weight]) => {
      return total + (scores[key] ?? 65) * weight;
    }, 0)
  );
}

function getUploadDecision(crs: number, thumbnailVerdict: string): UploadDecision {
  if (thumbnailVerdict === 'DO_NOT_UPLOAD') return 'DO_NOT_UPLOAD';
  if (crs >= 75) return 'UPLOAD_NOW';
  if (crs >= 55) return 'OPTIMIZE_FIRST';
  return 'DO_NOT_UPLOAD';
}

async function synthesizeNarrative(
  imageBase64: string,
  visionContext: string,
  crs: number,
  agentResults: {
    compositionResult: Record<string, unknown>;
    contrastResult: Record<string, unknown>;
    nicheResult: Record<string, unknown>;
    thumbnailResult: Record<string, unknown>;
    commercialResult: Record<string, unknown>;
    archetypeResult: Record<string, unknown>;
    platformResult: Record<string, unknown>;
    voiceResult: Record<string, unknown>;
  },
  platform: string
): Promise<PODNarrative> {
  const ai = getAI();

  const synthesisPrompt = `
You are the Da Vinci synthesis engine for a POD design analyzer.

${visionContext}

AGENT SCORES:
- Composition: ${agentResults.compositionResult.overallCompositionScore}
- Contrast: ${agentResults.contrastResult.overallContrastScore}
- Niche Clarity: ${agentResults.nicheResult.nicheClarityScore} (${agentResults.nicheResult.nicheSpecificityLevel})
- Thumbnail: ${agentResults.thumbnailResult.thumbnailScore} (${agentResults.thumbnailResult.thumbnailVerdict})
- Commercial: ${agentResults.commercialResult.overallCommercialScore}
- Archetype: ${agentResults.archetypeResult.primaryArchetype} — ${agentResults.archetypeResult.buyerAlignmentScore}
- Voice: ${agentResults.voiceResult.voiceScore} (${agentResults.voiceResult.voiceType}) — "${agentResults.voiceResult.extractedText ?? 'no text'}"
- Platform (${platform}): ${(agentResults.platformResult as Record<string, { score: number }>)[platform]?.score}

COMMERCIAL RESONANCE SCORE: ${crs}/100

Write a synthesis that explains:
1. WHY IT WILL OR WON'T SELL — specific, honest, Da Vinci-framed reasoning
2. THE BUYER — exactly who stops for this design and why
3. THE ONE CHANGE — if this design needs optimization, what is the single highest-impact change?
4. THE DA VINCI VERDICT — what Leonardo would say about this design's compositional communication

Return ONLY valid JSON with no markdown fences:
{
  "whyItSells": "string — 2-3 sentences, specific",
  "targetBuyer": "string — exact buyer portrait",
  "oneChange": "string — highest impact optimization, or 'This design is ready to upload' if CRS >= 75",
  "daVinciVerdict": "string — what Leonardo would observe",
  "executiveSummary": "string — one sentence CRS summary"
}
  `;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    config: { temperature: 0.7 }, // Narrative stays expressive — not locked to temperature 0
    contents: [
      {
        parts: [
          { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
          { text: synthesisPrompt }
        ]
      }
    ]
  });

  const text = result.text ?? '';
  const clean = stripJsonFences(text);

  try {
    return JSON.parse(clean) as PODNarrative;
  } catch {
    console.error('Synthesis JSON parse failed. Raw response:', text.slice(0, 500));
    throw new Error('Synthesis returned invalid JSON');
  }
}

export async function analyzePODDesign(imageBase64: string, platform: string = 'merch'): Promise<PODReport> {
  const startTime = Date.now();

  // Phase 0: Cloud Vision computed foundation
  let cloudVisionData: CloudVisionData | null = null;
  let visionContext = '';
  try {
    cloudVisionData = await analyzeDesignWithCloudVision(imageBase64);
    visionContext = formatVisionContextForAgents(cloudVisionData);
  } catch (e) {
    console.warn('Cloud Vision failed, continuing without computed data:', e);
    visionContext = 'Cloud Vision data unavailable — proceeding with visual interpretation only.';
  }

  // Safe Search gate — fail fast if content is problematic
  if (cloudVisionData) {
    const { adult, violence } = cloudVisionData.safeSearch;
    const flagged = (v: string) => v === 'LIKELY' || v === 'VERY_LIKELY';
    if (flagged(adult) || flagged(violence)) {
      throw new Error('SAFE_SEARCH_FAIL: Design flagged by content review. Will not pass platform policies.');
    }
  }

  // Phase 1: Run all 8 agents in parallel
  const [
    compositionResult,
    contrastResult,
    nicheResult,
    thumbnailResult,
    commercialResult,
    archetypeResult,
    platformResult,
    voiceResult
  ] = await Promise.all([
    runAgent(COMPOSITION_DIRECTOR_PROMPT(visionContext, platform), imageBase64),
    runAgent(CONTRAST_ANALYST_PROMPT(visionContext), imageBase64),
    runAgent(NICHE_CLARITY_PROMPT(visionContext), imageBase64),
    runAgent(THUMBNAIL_AGENT_PROMPT(visionContext, platform), imageBase64),
    runAgent(POD_COMMERCIAL_STRATEGIST_PROMPT(visionContext, platform), imageBase64),
    runAgent(POD_ARCHETYPE_READER_PROMPT(visionContext), imageBase64),
    runAgent(PLATFORM_AGENT_PROMPT(visionContext), imageBase64),
    runAgent(VOICE_ANALYZER_PROMPT(visionContext), imageBase64)
  ]);

  // Phase 2: Compute Commercial Resonance Score
  const crs = computeCRS({
    composition: compositionResult.overallCompositionScore as number,
    contrast:    contrastResult.overallContrastScore as number,
    niche:       nicheResult.nicheClarityScore as number,
    thumbnail:   thumbnailResult.thumbnailScore as number,
    commercial:  commercialResult.overallCommercialScore as number,
    archetype:   archetypeResult.buyerAlignmentScore as number,
    platform:    (platformResult[platform] as { score: number } | undefined)?.score ?? 65,
    voice:       voiceResult.voiceScore as number
  });

  // Phase 3: Synthesize narrative
  const narrative = await synthesizeNarrative(
    imageBase64, visionContext, crs,
    { compositionResult, contrastResult, nicheResult, thumbnailResult, commercialResult, archetypeResult, platformResult, voiceResult },
    platform
  );

  return {
    crs,
    uploadDecision: getUploadDecision(crs, thumbnailResult.thumbnailVerdict as string),
    cloudVision: cloudVisionData,
    agents: {
      composition: compositionResult,
      contrast: contrastResult,
      niche: nicheResult,
      thumbnail: thumbnailResult,
      commercial: commercialResult,
      archetype: archetypeResult,
      platforms: platformResult,
      voice: voiceResult
    },
    narrative,
    processingTime: Date.now() - startTime,
    bestPlatform: (platformResult.bestPlatform as string) ?? platform
  };
}
