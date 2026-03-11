import { GoogleGenAI } from "@google/genai";
import { dnaIndex } from "@/lib/pineconeClient";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

export interface DesignMetadata {
  id: string;
  designName: string;
  podScore: number;
  market: string;
  niche: string;
  outcome: string;
  dateAdded: string;
}

export interface DNAMatch {
  id: string;
  namespace: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface DNAResult {
  dnaScore: number;
  classification: "WINNER_ZONE" | "NEUTRAL" | "DEATH_ROW_ZONE" | "BUILDING";
  winnerCount: number;
  deathRowCount: number;
  topMatches: DNAMatch[];
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
      nicheText,
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
    };
  }

  const classification =
    dnaScore >= 0.6
      ? "WINNER_ZONE"
      : dnaScore <= 0.3
      ? "DEATH_ROW_ZONE"
      : "NEUTRAL";

  return { dnaScore, classification, winnerCount, deathRowCount, topMatches: allMatches };
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
