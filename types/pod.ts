export type UploadDecision = 'UPLOAD_NOW' | 'OPTIMIZE_FIRST' | 'DO_NOT_UPLOAD';

export interface PODNarrative {
  whyItSells: string;
  targetBuyer: string;
  oneChange: string;
  daVinciVerdict: string;
  executiveSummary: string;
}

export interface CloudVisionData {
  labels: Array<{ description: string; score: number }>;
  dominantColors: Array<{
    color: { red: number; green: number; blue: number };
    pixelFraction: number;
    score: number;
  }>;
  objects: Array<{ name: string; score: number; boundingPoly: unknown }>;
  safeSearch: {
    adult: string;
    violence: string;
    racy: string;
  };
  imageProperties: {
    dominantHex: string;
    colorMood: string;
    colorCount: number;
  };
  ocrText: string;          // exact text extracted by Cloud Vision OCR — empty string if none
  cropHints: Array<{
    confidence: number;
    importanceFraction: number;
  }>;
}

// Purchase pathway — determines which scoring rubric applies
export type PurchasePathway = 'GIFT_IDENTITY' | 'MEME_SELF_PURCHASE' | 'HYBRID';

export interface PathwayDetection {
  pathway: PurchasePathway;
  confidence: number;     // 0–100
  signals: string[];      // what triggered this classification
  scoringNote: string;    // which rubric applies
}

export interface PODReport {
  crs: number;                   // Commercial Resonance Score 0-100
  uploadDecision: UploadDecision;
  cloudVision: CloudVisionData | null;
  pathway?: PathwayDetection;    // computed from Cloud Vision — undefined if CV unavailable
  memeRubricActive?: boolean;    // true when CRS was recalculated using meme weights
  slotDecision?: SlotDecision;   // enriched in batch mode for UPLOAD_NOW results
  agents: {
    composition: Record<string, unknown>;
    contrast: Record<string, unknown>;
    niche: Record<string, unknown>;
    thumbnail: Record<string, unknown>;
    commercial: Record<string, unknown>;
    archetype: Record<string, unknown>;
    platforms: Record<string, unknown>;
    voice: Record<string, unknown>;
  };
  narrative: PODNarrative;
  processingTime: number;
  bestPlatform: string;
}

export interface BatchDesignResult {
  filename: string;
  report?: PODReport;
  error?: string;
}

export interface BatchPODResult {
  mode: 'batch';
  total: number;
  analyzed: number;
  uploadQueue: string[];         // filenames ranked best to worst
  results: BatchDesignResult[];
}

export type CompetitionLevel = 'BLUE_OCEAN' | 'MODERATE' | 'SATURATED' | 'OVERCROWDED' | 'UNKNOWN';
export type SlotDecisionVerdict = 'GO' | 'HOLD' | 'SKIP';
export type UrgencyLevel = 'UPLOAD_TODAY' | 'UPLOAD_THIS_WEEK' | 'WAIT_FOR_SEASON' | 'SKIP';

export interface CompetitionData {
  level: CompetitionLevel;
  estimatedListings: string;
  searchTerm: string;
  competitionScore: number;
  signal: string;
}

export interface SlotDecision {
  slotWorthiness: number;
  verdict: SlotDecisionVerdict;
  urgency: UrgencyLevel;
  competition: CompetitionData;
  reasoning: string;
  seasonalNote: string | null;
}
