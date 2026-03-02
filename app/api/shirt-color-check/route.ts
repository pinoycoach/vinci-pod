import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 30; // Single lightweight Gemini call, no Cloud Vision

const MODEL_ID = 'gemini-2.5-flash';

function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not configured' }, { status: 500 });
    }

    const { compositedImage, shirtColor, originalCRS } = await req.json() as {
      compositedImage: string;
      shirtColor: string;
      originalCRS: number;
    };

    if (!compositedImage || !shirtColor || typeof originalCRS !== 'number') {
      return NextResponse.json({ error: 'Missing required fields: compositedImage, shirtColor, originalCRS' }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

    const prompt = `You are evaluating a t-shirt mockup for Amazon Merch by Amazon.
The image shows a design printed on a ${shirtColor} shirt at thumbnail size (160×160px).
This is the EXACT size buyers see when scrolling search results on the Amazon mobile app.

Score ONLY two things:

THUMBNAIL_SCORE (0–100):
- 80+ = text clearly readable, subject recognizable, sufficient contrast → PASSES mobile gate
- 65–79 = borderline, may lose legibility on smaller Android screens
- Below 65 = fails, buyer will not click, design is invisible at search size

CRS_ADJUSTMENT (negative number or 0):
- Thumbnail 80+: adjustment = 0
- Thumbnail 65–79: adjustment = -8
- Thumbnail below 65: adjustment = -20

Return ONLY this JSON, no other text:
{
  "thumbnailScore": number,
  "crsAdjustment": number,
  "passes": boolean,
  "issue": "specific description of what fails at this size, or null if passes",
  "recommendation": "one concrete action, e.g. 'Set Dark Heather as primary variant'"
}`;

    const result = await ai.models.generateContent({
      model: MODEL_ID,
      config: { temperature: 0 }, // Deterministic — shirt color gate must be consistent
      contents: [{
        parts: [
          { inlineData: { data: compositedImage, mimeType: 'image/jpeg' } },
          { text: prompt }
        ]
      }]
    });

    const clean = stripJsonFences(result.text ?? '{}');
    const parsed = JSON.parse(clean) as {
      thumbnailScore: number;
      crsAdjustment: number;
      passes: boolean;
      issue: string | null;
      recommendation: string;
    };

    return NextResponse.json({
      ...parsed,
      shirtColor,
      originalCRS,
      adjustedCRS: originalCRS + parsed.crsAdjustment
    });

  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('Shirt color check error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
