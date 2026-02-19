import { NextRequest, NextResponse } from 'next/server';
import { analyzePODDesign } from '@/services/podEngine';
import type { BatchDesignResult } from '@/types/pod';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro — supports large batches (20 designs ~130s)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { images, platform = 'merch' } = body as {
      images: Array<{ filename: string; base64: string }>;
      platform?: string;
    };

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    if (!process.env.GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not configured' }, { status: 500 });
    }

    // Single design
    if (images.length === 1) {
      const report = await analyzePODDesign(images[0].base64, platform);
      return NextResponse.json({
        mode: 'single',
        filename: images[0].filename,
        report
      });
    }

    // Batch — run in groups of 5 to avoid rate limits
    const BATCH_SIZE = 5;
    const results: BatchDesignResult[] = [];

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(img =>
          analyzePODDesign(img.base64, platform)
            .then(report => ({ filename: img.filename, report }))
            .catch(err => ({ filename: img.filename, error: (err as Error).message }))
        )
      );
      results.push(...batchResults);
    }

    // Rank by CRS for upload queue
    const validResults = results.filter(r => r.report) as Required<Pick<BatchDesignResult, 'filename' | 'report'>>[];
    validResults.sort((a, b) => b.report.crs - a.report.crs);

    const uploadQueue = validResults
      .filter(r => r.report.uploadDecision !== 'DO_NOT_UPLOAD')
      .map(r => r.filename);

    return NextResponse.json({
      mode: 'batch',
      total: images.length,
      analyzed: validResults.length,
      uploadQueue,
      results
    });

  } catch (err) {
    const message = (err as Error).message;
    console.error('POD analyze error:', message);

    if (message.startsWith('SAFE_SEARCH_FAIL')) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
