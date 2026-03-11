import { Pinecone } from "@pinecone-database/pinecone";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

// Pass host directly to skip the describe_index lookup on every serverless cold start
export const dnaIndex = pc.index(
  process.env.PINECONE_INDEX_NAME!,
  process.env.PINECONE_INDEX_HOST
);
