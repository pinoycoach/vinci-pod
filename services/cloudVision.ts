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
        { type: 'LABEL_DETECTION', maxResults: 15 },
        { type: 'IMAGE_PROPERTIES' },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
        { type: 'SAFE_SEARCH_DETECTION' }
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
    }
  };
}

// Format Cloud Vision data as agent context string
export function formatVisionContextForAgents(cv: CloudVisionData): string {
  const topLabels = cv.labels.slice(0, 8).map(l => `${l.description} (${l.score}%)`).join(', ');
  const topColors = cv.dominantColors.slice(0, 3).map(c =>
    `${c.pixelFraction}% coverage`
  ).join(', ');

  return `
CLOUD VISION COMPUTED DATA (mathematical, not interpreted):
- Top visual labels: ${topLabels}
- Dominant color hex: ${cv.imageProperties.dominantHex}
- Color mood: ${cv.imageProperties.colorMood}
- Color coverage: ${topColors}
- Main objects detected: ${cv.objects.slice(0, 5).map(o => o.name + ' (' + o.score + '%)').join(', ') || 'none'}
- Safe Search: Adult=${cv.safeSearch.adult}, Violence=${cv.safeSearch.violence}, Racy=${cv.safeSearch.racy}
  `.trim();
}
