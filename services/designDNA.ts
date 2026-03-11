import { GoogleGenAI } from "@google/genai";
import { dnaIndex } from "@/lib/pineconeClient";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

export interface DesignMetadata {
  id: string;
  title: string;        // display name (was: designName)
  podScore: number;     // CRS 0–100
  units_sold: number;   // actual unit sales count
  marketplace: string;  // "UK" | "US" | "DE" | "global" (was: market)
  niche: string;        // niche category label e.g. "dog breeds"
  outcome: string;      // "SOLD_500" | "MARKET_OG" | "TRENDING_OG" | "ZERO_SALES_KILLED"
  seeded_date: string;  // ISO timestamp (was: dateAdded)
}

export interface DNAMatch {
  id: string;
  namespace: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ClosestMatch {
  title: string;
  niche: string;
  units_sold: number;
  marketplace: string;
  similarity: number;  // cosine score 0–1, internal only
  namespace: "winners" | "death_row";
}

export interface DNAResult {
  dnaScore: number;
  classification: "WINNER_ZONE" | "NEUTRAL" | "DEATH_ROW_ZONE" | "BUILDING";
  winnerCount: number;
  deathRowCount: number;
  topMatches: DNAMatch[];
  closestMatch: ClosestMatch | null;
}

export async function embedDesign(
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg",
  nicheText: string
): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-2-preview",
    contents: [
      { inlineData: { data: imageBase64, mimeType } },
      { text: nicheText },
    ],
    config: { outputDimensionality: 1536 },
  });

  const raw = response.embeddings?.[0]?.values as number[];

  // Normalize — required for outputDimensionality < 3072
  const magnitude = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
  return raw.map((v) => v / magnitude);
}

export async function queryDNA(embedding: number[]): Promise<DNAResult> {
  const [winnersRes, deathRes] = await Promise.all([
    dnaIndex.namespace("winners").query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
    }),
    dnaIndex.namespace("death_row").query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
    }),
  ]);

  const winnerMatches: DNAMatch[] = (winnersRes.matches ?? []).map((m) => ({
    id: m.id,
    namespace: "winners",
    score: m.score ?? 0,
    metadata: (m.metadata as Record<string, unknown>) ?? {},
  }));

  const deathRowMatches: DNAMatch[] = (deathRes.matches ?? []).map((m) => ({
    id: m.id,
    namespace: "death_row",
    score: m.score ?? 0,
    metadata: (m.metadata as Record<string, unknown>) ?? {},
  }));

  const allMatches = [...winnerMatches, ...deathRowMatches].sort(
    (a, b) => b.score - a.score
  );

  const winnerCount = winnerMatches.length;
  const deathRowCount = deathRowMatches.length;
  const dnaScore = winnerCount / (winnerCount + deathRowCount || 1);

  // Cold start — not enough reference data yet
  if (winnerCount < 3) {
    return {
      dnaScore,
      classification: "BUILDING",
      winnerCount,
      deathRowCount,
      topMatches: allMatches,
      closestMatch: null,
    };
  }

  const classification =
    dnaScore >= 0.6
      ? "WINNER_ZONE"
      : dnaScore <= 0.3
      ? "DEATH_ROW_ZONE"
      : "NEUTRAL";

  // Extract closest reference design for WINNER_ZONE and DEATH_ROW_ZONE.
  // Backward-compat: old vectors stored designName/market/dateAdded field names.
  let closestMatch: ClosestMatch | null = null;

  if (classification === "WINNER_ZONE" && winnerMatches.length > 0) {
    const top = winnerMatches[0];
    closestMatch = {
      title: ((top.metadata.title ?? top.metadata.designName ?? "unknown") as string),
      niche: ((top.metadata.niche ?? "") as string),
      units_sold: Number(top.metadata.units_sold ?? 0),
      marketplace: ((top.metadata.marketplace ?? top.metadata.market ?? "") as string),
      similarity: top.score,
      namespace: "winners",
    };
  } else if (classification === "DEATH_ROW_ZONE" && deathRowMatches.length > 0) {
    const top = deathRowMatches[0];
    closestMatch = {
      title: ((top.metadata.title ?? top.metadata.designName ?? "unknown") as string),
      niche: ((top.metadata.niche ?? "") as string),
      units_sold: Number(top.metadata.units_sold ?? 0),
      marketplace: ((top.metadata.marketplace ?? top.metadata.market ?? "") as string),
      similarity: top.score,
      namespace: "death_row",
    };
  }

  return { dnaScore, classification, winnerCount, deathRowCount, topMatches: allMatches, closestMatch };
}

export async function seedDesign(
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg",
  nicheText: string,
  metadata: DesignMetadata,
  namespace: "winners" | "death_row"
): Promise<void> {
  const embedding = await embedDesign(imageBase64, mimeType, nicheText);
  await dnaIndex.namespace(namespace).upsert({
    records: [
      {
        id: metadata.id,
        values: embedding,
        metadata: metadata as unknown as Record<string, string | number | boolean>,
      },
    ],
  });
}
