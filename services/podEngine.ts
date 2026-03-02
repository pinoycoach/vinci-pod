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
import type { PODReport, PODNarrative, UploadDecision, CloudVisionData, PathwayDetection, PurchasePathway } from '@/types/pod';

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

// ─── Platform-specific CRS weight profiles ────────────────────────────────────

const CRS_WEIGHTS: Record<string, Record<string, number>> = {
  merch: {
    // Niche + Thumbnail dominant — keyword search + mobile thumbnail is the whole game
    composition: 0.13,
    contrast:    0.09,
    niche:       0.23,
    thumbnail:   0.23,
    commercial:  0.13,
    archetype:   0.05,
    platform:    0.04,
    voice:       0.10
  },
  etsy: {
    // Commercial + Archetype raised — Etsy buyers are gift/emotional, browse-based not search-exact
    composition: 0.13,
    contrast:    0.09,
    niche:       0.15,
    thumbnail:   0.18,
    commercial:  0.18,
    archetype:   0.13,
    platform:    0.04,
    voice:       0.10
  },
  redbubble: {
    // Composition + Archetype raised — art buyers, discovery platform, larger thumbnails
    composition: 0.18,
    contrast:    0.10,
    niche:       0.15,
    thumbnail:   0.15,
    commercial:  0.13,
    archetype:   0.15,
    platform:    0.06,
    voice:       0.08
  },
  teepublic: {
    // Slightly more archetype + voice — younger demographic, humour-forward
    composition: 0.13,
    contrast:    0.08,
    niche:       0.21,
    thumbnail:   0.22,
    commercial:  0.13,
    archetype:   0.08,
    platform:    0.04,
    voice:       0.11
  }
};

function computeCRS(scores: Record<string, number>, platform: string = 'merch'): number {
  const weights = CRS_WEIGHTS[platform] ?? CRS_WEIGHTS.merch;

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

// ─── Purchase Pathway Detection ───────────────────────────────────────────────
// Computed from Cloud Vision data — determines which scoring rubric applies

function detectPurchasePathway(cv: CloudVisionData, ocrText: string): PathwayDetection {
  const signals: string[] = [];
  let giftScore = 0;
  let memeScore = 0;

  const labelNames = cv.labels.map(l => l.description.toLowerCase());
  const text = ocrText.toLowerCase();

  // Gift/Identity signals
  if (labelNames.some(l => ['dog', 'cat', 'animal', 'pet', 'bird'].includes(l))) {
    giftScore += 30; signals.push('Animal subject detected');
  }
  if (cv.imageProperties.colorMood === 'warm') {
    giftScore += 15; signals.push('Warm palette — gift purchase signal');
  }
  if (['mum', 'mom', 'dad', 'gift', 'breed'].some(w => text.includes(w))) {
    giftScore += 25; signals.push('Identity/gift language in text');
  }

  // Meme/Self-purchase signals
  const ironyWords = ['no.', 'nope', 'fine', 'whatever', 'okay', 'sure', 'trust', 'bruh', 'vibes', 'chaos', 'help', 'literally'];
  if (ironyWords.some(w => text.includes(w))) {
    memeScore += 30; signals.push('Ironic/humour text detected');
  }
  if (labelNames.some(l => ['meme', 'humor', 'satire', 'comedy'].includes(l))) {
    memeScore += 35; signals.push('Meme/humour label from Cloud Vision');
  }
  if (cv.imageProperties.colorMood === 'high-contrast' && cv.objects.length < 2) {
    memeScore += 15; signals.push('High-contrast minimal composition — scroll-stop design');
  }

  const total = giftScore + memeScore;
  if (total === 0) return {
    pathway: 'GIFT_IDENTITY' as PurchasePathway,
    confidence: 50,
    signals,
    scoringNote: 'No strong signals — defaulting to gift/identity rubric'
  };

  const giftPct = Math.round((giftScore / total) * 100);

  if (giftPct >= 65) return {
    pathway: 'GIFT_IDENTITY' as PurchasePathway,
    confidence: giftPct,
    signals,
    scoringNote: 'Score using: Trust, Warmth, Parasocial Bond, identity signal'
  };
  if (giftPct <= 35) return {
    pathway: 'MEME_SELF_PURCHASE' as PurchasePathway,
    confidence: 100 - giftPct,
    signals,
    scoringNote: 'Priority signals: Scroll-Stop AND Voice. Deploy if both 80+.'
  };
  return {
    pathway: 'HYBRID' as PurchasePathway,
    confidence: 50,
    signals,
    scoringNote: 'Dual-market design — consider dual ASIN strategy'
  };
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

  // Purchase Pathway Detection — computed before agents, injected into visionContext
  const pathway = cloudVisionData
    ? detectPurchasePathway(cloudVisionData, cloudVisionData.ocrText ?? '')
    : undefined;

  if (pathway) {
    visionContext += `\n- Purchase pathway: ${pathway.pathway} (confidence: ${pathway.confidence}%) — ${pathway.scoringNote}`;
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

  // Phase 2: Compute Commercial Resonance Score (platform-specific weights)
  const crs = computeCRS({
    composition: compositionResult.overallCompositionScore as number,
    contrast:    contrastResult.overallContrastScore as number,
    niche:       nicheResult.nicheClarityScore as number,
    thumbnail:   thumbnailResult.thumbnailScore as number,
    commercial:  commercialResult.overallCommercialScore as number,
    archetype:   archetypeResult.buyerAlignmentScore as number,
    platform:    (platformResult[platform] as { score: number } | undefined)?.score ?? 65,
    voice:       voiceResult.voiceScore as number
  }, platform);

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
    pathway,
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
