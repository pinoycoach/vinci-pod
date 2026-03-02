import type { CloudVisionData } from '@/types/pod';

const VISION_API_KEY = process.env.GOOGLE_CLOUD_VISION_API_KEY;
const VISION_URL = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`;

export type { CloudVisionData };

export async function analyzeDesignWithCloudVision(base64Image: string): Promise<CloudVisionData> {
  if (!VISION_API_KEY) {
    throw new Error('GOOGLE_CLOUD_VISION_API_KEY is not set');
  }

  const body = {
    requests: [{
      image: { content: base64Image },
      features: [
        { type: 'LABEL_DETECTION', maxResults: 20 },      // expanded from 15
        { type: 'IMAGE_PROPERTIES' },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'TEXT_DETECTION' },                        // exact OCR string
        { type: 'CROP_HINTS', maxResults: 3 }              // thumbnail survival
      ]
    }]
  };

  const response = await fetch(VISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Cloud Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const result = data.responses?.[0];

  if (!result) throw new Error('Cloud Vision returned no data');

  // Process labels
  const labels = (result.labelAnnotations ?? []).map((l: { description: string; score: number }) => ({
    description: l.description,
    score: Math.round(l.score * 100)
  }));

  // Process colors
  const colors = result.imagePropertiesAnnotation?.dominantColors?.colors ?? [];
  const dominantColors = colors
    .sort((a: { pixelFraction: number }, b: { pixelFraction: number }) => b.pixelFraction - a.pixelFraction)
    .slice(0, 5)
    .map((c: { color: { red?: number; green?: number; blue?: number }; pixelFraction: number; score?: number }) => ({
      color: c.color,
      pixelFraction: Math.round(c.pixelFraction * 100),
      score: Math.round((c.score ?? 0) * 100)
    }));

  // Compute dominant hex
  const top = dominantColors[0]?.color ?? { red: 0, green: 0, blue: 0 };
  const r = Math.round(top.red ?? 0);
  const g = Math.round(top.green ?? 0);
  const b = Math.round(top.blue ?? 0);
  const dominantHex = '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0');

  // Determine color mood
  const brightness = (r + g + b) / 3;
  const warmth = r - b;
  let colorMood = 'neutral';
  if (warmth > 40) colorMood = 'warm';
  else if (warmth < -40) colorMood = 'cool';
  else if (brightness > 180 || brightness < 60) colorMood = 'high-contrast';

  // Safe search
  const ss = result.safeSearchAnnotation ?? {};

  // Objects
  const objects = (result.localizedObjectAnnotations ?? []).map((o: { name: string; score: number; boundingPoly: unknown }) => ({
    name: o.name,
    score: Math.round(o.score * 100),
    boundingPoly: o.boundingPoly
  }));

  // OCR text — TEXT_DETECTION: first textAnnotation is the full merged text block
  const textAnnotations = result.textAnnotations ?? [];
  const ocrText = (textAnnotations[0]?.description ?? '').trim();

  // Crop hints — thumbnail survival data
  const cropHintsRaw = result.cropHintsAnnotation?.cropHints ?? [];
  const cropHints = cropHintsRaw.map((h: { confidence?: number; importanceFraction?: number }) => ({
    confidence: Math.round((h.confidence ?? 0) * 100) / 100,
    importanceFraction: Math.round((h.importanceFraction ?? 0) * 100) / 100
  }));

  return {
    labels,
    dominantColors,
    objects,
    safeSearch: {
      adult: ss.adult ?? 'UNLIKELY',
      violence: ss.violence ?? 'UNLIKELY',
      racy: ss.racy ?? 'UNLIKELY'
    },
    imageProperties: {
      dominantHex,
      colorMood,
      colorCount: dominantColors.length
    },
    ocrText,
    cropHints
  };
}

// ─── Style Classifier ─────────────────────────────────────────────────────────
// Computed from Cloud Vision data — no extra API cost

export type DesignStyle =
  | 'MINIMALIST'
  | 'VINTAGE_RETRO'
  | 'CHARACTER_DRIVEN'
  | 'TYPOGRAPHIC'
  | 'MAXIMALIST'
  | 'PATTERN'
  | 'UNKNOWN';

export function classifyDesignStyle(cv: CloudVisionData): {
  style: DesignStyle;
  confidence: number;
  styleNote: string;
} {
  const labelNames = cv.labels.map(l => l.description.toLowerCase());
  const colorCount = cv.dominantColors.length;
  const topColorFraction = cv.dominantColors[0]?.pixelFraction ?? 0;
  const topColor = cv.dominantColors[0]?.color;

  // Explicit label match first
  if (labelNames.includes('minimalism') || labelNames.includes('minimalist'))
    return { style: 'MINIMALIST', confidence: 85, styleNote: 'Cloud Vision detected minimalist aesthetic' };

  // Vintage via warm amber/sepia palette
  if (topColor) {
    const rc = topColor.red ?? 0, gc = topColor.green ?? 0, bc = topColor.blue ?? 0;
    if (rc > 150 && gc > 100 && bc < 80 && rc > gc && gc > bc)
      return { style: 'VINTAGE_RETRO', confidence: 70, styleNote: 'Warm amber/sepia palette — vintage signal' };
  }

  // Typographic: text is hero, minimal objects
  if ((labelNames.includes('typography') || labelNames.includes('font')) && cv.objects.length < 3)
    return { style: 'TYPOGRAPHIC', confidence: 75, styleNote: 'Text-dominant design, minimal objects' };

  // Character/illustration
  if (labelNames.some(l => ['illustration', 'clip art', 'cartoon', 'drawing', 'animal'].includes(l)))
    return { style: 'CHARACTER_DRIVEN', confidence: 80, styleNote: 'Character or illustration detected' };

  // Pattern
  if (labelNames.includes('pattern'))
    return { style: 'PATTERN', confidence: 75, styleNote: 'Repeating pattern detected' };

  // Maximalist: many objects OR many colors
  if (cv.objects.length > 6 || colorCount > 4)
    return { style: 'MAXIMALIST', confidence: 60, styleNote: 'Complex multi-element design' };

  // Implied minimalism from limited palette
  if (colorCount <= 2 || topColorFraction > 60)
    return { style: 'MINIMALIST', confidence: 55, styleNote: 'Limited palette implies minimalist' };

  return { style: 'UNKNOWN', confidence: 30, styleNote: 'Style undetermined' };
}

// ─── Agent Context Formatter ──────────────────────────────────────────────────

export function formatVisionContextForAgents(cv: CloudVisionData): string {
  const topLabels = cv.labels.slice(0, 8).map(l => `${l.description} (${l.score}%)`).join(', ');
  const topColors = cv.dominantColors.slice(0, 3).map(c =>
    `${c.pixelFraction}% coverage`
  ).join(', ');

  const styleResult = classifyDesignStyle(cv);

  const cropSurvival = cv.cropHints[0]
    ? `${Math.round(cv.cropHints[0].importanceFraction * 100)}% of visual content survives thumbnail crop`
    : 'not available';

  return `
CLOUD VISION COMPUTED DATA (mathematical, not interpreted):
- Top visual labels: ${topLabels}
- Dominant color hex: ${cv.imageProperties.dominantHex}
- Color mood: ${cv.imageProperties.colorMood}
- Color coverage: ${topColors}
- Main objects detected: ${cv.objects.slice(0, 5).map(o => o.name + ' (' + o.score + '%)').join(', ') || 'none'}
- Safe Search: Adult=${cv.safeSearch.adult}, Violence=${cv.safeSearch.violence}, Racy=${cv.safeSearch.racy}
- OCR extracted text (exact): "${cv.ocrText || 'none detected'}"
- Thumbnail crop survival: ${cropSurvival}
- Design style: ${styleResult.style} (confidence: ${styleResult.confidence}%) — ${styleResult.styleNote}
  `.trim();
}
