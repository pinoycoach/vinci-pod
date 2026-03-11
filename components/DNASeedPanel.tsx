"use client";

import { useState, useRef } from "react";

export function DNASeedPanel() {
  const [open, setOpen] = useState(false);
  const [namespace, setNamespace] = useState<"winners" | "death_row">("winners");
  const [nicheText, setNicheText] = useState("");
  const [designName, setDesignName] = useState("");
  const [podScore, setPodScore] = useState("");
  const [market, setMarket] = useState("UK");
  const [outcome, setOutcome] = useState("");
  const [secret, setSecret] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setImageFilename(file.name);
    if (!designName) setDesignName(file.name.replace(/\.[^.]+$/, ""));
    // Compress to JPEG, max 1500px — same pipeline as main analyzer to avoid 4.5MB Vercel limit
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1500;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
        setImageBase64(b64);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!imageBase64 || !nicheText.trim() || !secret.trim()) {
      setStatus("error");
      setStatusMsg("Image, niche text, and secret are required.");
      return;
    }
    setStatus("loading");
    setStatusMsg("");
    const fd = new FormData();
    fd.append("imageBase64", imageBase64);
    fd.append("mimeType", "image/jpeg");
    fd.append("nicheText", nicheText.trim());
    fd.append("namespace", namespace);
    fd.append("id", `${designName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`);
    fd.append("designName", designName || imageFilename);
    fd.append("podScore", podScore || "0");
    fd.append("market", market);
    fd.append("outcome", outcome.trim() || (namespace === "winners" ? "WINNER" : "ZERO_SALES_KILLED"));
    try {
      const res = await fetch("/api/pod/seed", {
        method: "POST",
        headers: { "x-admin-secret": secret },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus("ok");
      setStatusMsg(`Seeded: ${data.id} → ${data.namespace}`);
      setImageBase64(null);
      setImageFilename("");
      setDesignName("");
      setNicheText("");
      setPodScore("");
      setOutcome("");
    } catch (err) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Seed failed");
    }
  }

  return (
    <div className="border border-stone-800 mt-8">
      <button
        className="w-full text-left px-4 py-3 text-xs font-mono text-stone-600 hover:text-stone-400 flex items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <span>DNA SEED PANEL</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4 border-t border-stone-800">
          <div className="text-xs text-stone-500 font-mono">
            Seed a design into Pinecone as a winner or death-row reference vector.
          </div>

          {/* Image upload */}
          <div
            className="border border-dashed border-stone-700 p-4 text-center cursor-pointer hover:border-stone-500"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            {imageFilename
              ? <span className="text-stone-300 text-xs font-mono">{imageFilename}</span>
              : <span className="text-stone-600 text-xs font-mono">Drop design image or click to select</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Namespace */}
          <div className="flex gap-2">
            {(["winners", "death_row"] as const).map(ns => (
              <button key={ns}
                className={`flex-1 py-2 text-xs font-mono border ${namespace === ns
                  ? ns === "winners" ? "border-emerald-600 text-emerald-400 bg-emerald-950/30" : "border-red-800 text-red-400 bg-red-950/30"
                  : "border-stone-700 text-stone-600"}`}
                onClick={() => setNamespace(ns)}
              >
                {ns === "winners" ? "WINNERS" : "DEATH ROW"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-stone-600 font-mono mb-1">Niche text *</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                placeholder="border collie dog mum UK" value={nicheText} onChange={e => setNicheText(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-stone-600 font-mono mb-1">Design name</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                placeholder="Border Collie Just Throw It" value={designName} onChange={e => setDesignName(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-stone-600 font-mono mb-1">POD score</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                placeholder="88" type="number" value={podScore} onChange={e => setPodScore(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-stone-600 font-mono mb-1">Market</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                placeholder="UK" value={market} onChange={e => setMarket(e.target.value)} />
            </div>
            <div className="col-span-2">
              <div className="text-xs text-stone-600 font-mono mb-1">Outcome</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                placeholder="SOLD_500 · ZERO_SALES_KILLED · etc." value={outcome} onChange={e => setOutcome(e.target.value)} />
            </div>
            <div className="col-span-2">
              <div className="text-xs text-stone-600 font-mono mb-1">Admin secret *</div>
              <input className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 text-xs font-mono text-stone-200 focus:outline-none focus:border-stone-500"
                type="password" placeholder="ADMIN_SECRET from .env.local" value={secret} onChange={e => setSecret(e.target.value)} />
            </div>
          </div>

          <button
            className="w-full py-2 text-xs font-mono border border-amber-700 text-amber-400 hover:bg-amber-950/30 disabled:opacity-40"
            disabled={status === "loading" || !imageBase64}
            onClick={handleSubmit}
          >
            {status === "loading" ? "Seeding…" : "SEED TO PINECONE"}
          </button>

          {status === "ok" && (
            <div className="text-emerald-400 text-xs font-mono">{statusMsg}</div>
          )}
          {status === "error" && (
            <div className="text-red-400 text-xs font-mono">{statusMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}
