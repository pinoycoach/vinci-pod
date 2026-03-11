import { NextRequest, NextResponse } from "next/server";
import { seedDesign, DesignMetadata } from "@/services/designDNA";

export async function POST(req: NextRequest) {
  // Admin-only — validate secret header
  const adminSecret = req.headers.get("x-admin-secret");
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();

    const imageBase64 = form.get("imageBase64") as string | null;
    const mimeType = (form.get("mimeType") as string | null) ?? "image/jpeg";
    const nicheText = (form.get("nicheText") as string | null) ?? "";
    const namespace = form.get("namespace") as "winners" | "death_row" | null;

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }
    if (!namespace || !["winners", "death_row"].includes(namespace)) {
      return NextResponse.json(
        { error: "namespace must be 'winners' or 'death_row'" },
        { status: 400 }
      );
    }

    // Backward-compat: accept both old field names (designName/market) and new ones (title/marketplace)
    const metadata: DesignMetadata = {
      id: (form.get("id") as string | null) ?? `design-${Date.now()}`,
      title:
        (form.get("title") as string | null) ??
        (form.get("designName") as string | null) ??
        "Unnamed",
      podScore: Number(form.get("podScore") ?? 0),
      units_sold: Number(form.get("units_sold") ?? 0),
      marketplace:
        (form.get("marketplace") as string | null) ??
        (form.get("market") as string | null) ??
        "UK",
      niche: (form.get("niche") as string | null) ?? nicheText,
      outcome:
        (form.get("outcome") as string | null) ??
        (namespace === "winners" ? "WINNER" : "ZERO_SALES_KILLED"),
      seeded_date: new Date().toISOString(),
    };

    await seedDesign(
      imageBase64,
      mimeType as "image/png" | "image/jpeg",
      nicheText,
      metadata,
      namespace
    );

    return NextResponse.json({ success: true, id: metadata.id, namespace });
  } catch (err) {
    console.error("[pod/seed]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed" },
      { status: 500 }
    );
  }
}
