import { NextRequest, NextResponse } from "next/server";
import { embedDesign, queryDNA } from "@/services/designDNA";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const imageBase64 = form.get("imageBase64") as string | null;
    const mimeType = (form.get("mimeType") as string | null) ?? "image/jpeg";
    const nicheText = (form.get("nicheText") as string | null) ?? "";

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const embedding = await embedDesign(
      imageBase64,
      mimeType as "image/png" | "image/jpeg",
      nicheText
    );

    const result = await queryDNA(embedding);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[pod/embed]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Embedding failed" },
      { status: 500 }
    );
  }
}
