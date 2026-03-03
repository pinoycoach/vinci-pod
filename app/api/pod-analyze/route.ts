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

    // Enrich UPLOAD_NOW results with slot decisions in parallel
    // This gives each winner a Slot Worthiness score without manual re-runs
    const uploadNowResults = validResults.filter(r => r.report.uploadDecision === 'UPLOAD_NOW');

    if (uploadNowResults.length > 0) {
      const baseUrl = req.nextUrl.origin;
      const slotDecisions = await Promise.allSettled(
        uploadNowResults.map(r =>
          fetch(`${baseUrl}/api/slot-decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              crs: r.report.crs,
              nicheAgentOutput: r.report.agents.niche,
              cloudVisionLabels: r.report.cloudVision?.labels ?? [],
              filename: r.filename
            })
          }).then(res => {
            if (!res.ok) throw new Error(`Slot decision HTTP ${res.status}`);
            return res.json();
          })
        )
      );

      // Merge slot decisions back into reports — only if response has expected shape
      uploadNowResults.forEach((r, i) => {
        const settled = slotDecisions[i];
        if (settled.status === 'fulfilled' && typeof settled.value?.slotWorthiness === 'number') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r.report as any).slotDecision = settled.value;
        }
      });
    }

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
