'use client';

import { useState, useRef, useCallback } from 'react';
import type { PODReport, BatchDesignResult } from '@/types/pod';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SingleResult {
  mode: 'single';
  filename: string;
  report: PODReport;
}

interface BatchResult {
  mode: 'batch';
  total: number;
  analyzed: number;
  uploadQueue: string[];
  results: BatchDesignResult[];
}

type AnalysisResult = SingleResult | BatchResult;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ label, value, color = 'bg-amber-500' }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const textColor = pct >= 70 ? 'text-green-400' : pct >= 45 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-stone-400">{label}</span>
        <span className={textColor}>{pct}</span>
      </div>
      <div className="h-1 bg-stone-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function UploadBadge({ decision }: { decision: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    UPLOAD_NOW:     { label: '✓ UPLOAD NOW',     cls: 'bg-green-900/30 text-green-400 border-green-400/30' },
    OPTIMIZE_FIRST: { label: '⚠ OPTIMIZE FIRST', cls: 'bg-yellow-900/30 text-yellow-400 border-yellow-400/30' },
    DO_NOT_UPLOAD:  { label: '✗ DO NOT UPLOAD',  cls: 'bg-red-900/30 text-red-400 border-red-400/30' }
  };
  const { label, cls } = cfg[decision] ?? cfg.DO_NOT_UPLOAD;
  return (
    <span className={`text-sm font-mono tracking-wider px-4 py-1 border inline-block ${cls}`}>
      {label}
    </span>
  );
}

function CRSDisplay({ report }: { report: PODReport }) {
  const crsColor = report.crs >= 75 ? 'text-green-400' : report.crs >= 55 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="text-center py-8 border border-stone-700 bg-stone-900/50">
      <div className="text-xs tracking-widest text-amber-400/60 mb-2 font-mono">COMMERCIAL RESONANCE SCORE</div>
      <div className={`text-8xl font-light ${crsColor}`}>{report.crs}</div>
      <div className="text-stone-500 text-sm mb-4">/ 100</div>
      <UploadBadge decision={report.uploadDecision} />
      {report.bestPlatform && (
        <div className="mt-3 text-xs text-stone-500 font-mono tracking-wider">
          BEST PLATFORM — <span className="text-amber-400/80">{report.bestPlatform.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

function NarrativeSection({ report }: { report: PODReport }) {
  const { narrative } = report;
  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-amber-400 font-serif text-xl italic">
        {report.crs >= 55 ? 'Why It Will Sell' : "Why It Won't Sell"}
      </h3>
      <p className="text-stone-300 leading-relaxed text-sm">{narrative.whyItSells}</p>
      <div className="border-l-2 border-blue-400/40 pl-4">
        <div className="text-xs font-mono text-blue-400/60 mb-1 tracking-wider">TARGET BUYER</div>
        <p className="text-stone-300 text-sm">{narrative.targetBuyer}</p>
      </div>
      <div className="border-l-2 border-amber-400/40 pl-4">
        <div className="text-xs font-mono text-amber-400/60 mb-1 tracking-wider">ONE CHANGE</div>
        <p className="text-stone-300 text-sm">{narrative.oneChange}</p>
      </div>
      <div className="border-l-2 border-stone-600/40 pl-4 italic">
        <div className="text-xs font-mono text-stone-500 mb-1 tracking-wider">DA VINCI SAYS</div>
        <p className="text-stone-400 text-sm italic">&ldquo;{narrative.daVinciVerdict}&rdquo;</p>
      </div>
    </div>
  );
}

function PlatformGrid({ platforms, best }: { platforms: Record<string, unknown>; best: string }) {
  const list = ['merch', 'redbubble', 'etsy', 'teepublic'];
  const labels: Record<string, string> = {
    merch: 'Merch by Amazon',
    redbubble: 'Redbubble',
    etsy: 'Etsy',
    teepublic: 'Teepublic'
  };
  return (
    <div className="grid grid-cols-2 gap-3 mt-4">
      {list.map(p => {
        const pData = platforms[p] as { score: number; verdict: string; reason?: string } | undefined;
        const score = pData?.score ?? 0;
        const scoreColor = score >= 70 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
        return (
          <div key={p} className={`p-3 border ${p === best ? 'border-amber-400/50 bg-amber-900/10' : 'border-stone-700'}`}>
            <div className="text-xs font-mono text-stone-500 mb-1">{labels[p]}</div>
            <div className={`text-2xl font-light ${scoreColor}`}>{score}</div>
            <div className="text-xs text-stone-500 mt-1">{pData?.verdict ?? '—'}</div>
            {p === best && <div className="text-xs text-amber-400 mt-1 font-mono">★ BEST FIT</div>}
            {pData?.reason && <div className="text-xs text-stone-600 mt-2 leading-relaxed">{pData.reason}</div>}
          </div>
        );
      })}
    </div>
  );
}

function AgentScoreGrid({ agents }: { agents: PODReport['agents'] }) {
  const rows = [
    { label: 'Niche Clarity',  value: (agents.niche as Record<string, number>).nicheClarityScore,           color: 'bg-purple-500' },
    { label: 'Thumbnail',      value: (agents.thumbnail as Record<string, number>).thumbnailScore,           color: 'bg-blue-500' },
    { label: 'Voice',          value: (agents.voice as Record<string, number>).voiceScore,                   color: 'bg-teal-500' },
    { label: 'Composition',    value: (agents.composition as Record<string, number>).overallCompositionScore, color: 'bg-amber-500' },
    { label: 'Commercial',     value: (agents.commercial as Record<string, number>).overallCommercialScore,  color: 'bg-green-500' },
    { label: 'Contrast',       value: (agents.contrast as Record<string, number>).overallContrastScore,      color: 'bg-cyan-500' },
    { label: 'Archetype Fit',  value: (agents.archetype as Record<string, number>).buyerAlignmentScore,      color: 'bg-rose-500' }
  ];
  return (
    <div className="mt-6">
      <div className="text-xs font-mono text-stone-500 tracking-wider mb-3">AGENT SCORES</div>
      {rows.map(r => (
        <ScoreBar key={r.label} label={r.label} value={r.value ?? 0} color={r.color} />
      ))}
    </div>
  );
}

// ─── Hidden data panels ───────────────────────────────────────────────────────

function ShirtColorPanel({ agents }: { agents: PODReport['agents'] }) {
  const contrast = agents.contrast as Record<string, string>;
  const blackPerf = contrast.blackShirtPerformance ?? 'MODERATE';
  const whitePerf = contrast.whiteShirtPerformance ?? 'MODERATE';
  const note = contrast.contrastNote as string | undefined;

  const cls = (v: string) => ({
    text: v === 'STRONG' ? 'text-green-400' : v === 'MODERATE' ? 'text-yellow-400' : 'text-red-400',
    border: v === 'STRONG' ? 'border-green-900/40 bg-green-900/10' : v === 'MODERATE' ? 'border-yellow-900/40 bg-yellow-900/10' : 'border-red-900/40 bg-red-900/10',
    icon: v === 'STRONG' ? '✓' : v === 'MODERATE' ? '~' : '✗'
  });

  const b = cls(blackPerf);
  const w = cls(whitePerf);

  return (
    <div className="mt-4">
      <div className="text-xs font-mono text-stone-500 tracking-wider mb-3">SHIRT COLORS — MERCH VARIANTS</div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-3 border ${b.border}`}>
          <div className="text-xs font-mono text-stone-500 mb-2">DARK SHIRTS</div>
          <div className={`text-sm font-mono ${b.text}`}>{b.icon} Black · Navy · Dark Heather</div>
          <div className={`text-xs mt-1 tracking-wider ${b.text}`}>{blackPerf}</div>
        </div>
        <div className={`p-3 border ${w.border}`}>
          <div className="text-xs font-mono text-stone-500 mb-2">LIGHT SHIRTS</div>
          <div className={`text-sm font-mono ${w.text}`}>{w.icon} White · Natural · Light Grey</div>
          <div className={`text-xs mt-1 tracking-wider ${w.text}`}>{whitePerf}</div>
        </div>
      </div>
      {note && <div className="text-xs text-stone-600 mt-2 italic">{note}</div>}
    </div>
  );
}

function CommercialIntelPanel({ agents }: { agents: PODReport['agents'] }) {
  const c = agents.commercial as Record<string, unknown>;
  const gift = c.giftPotential as string ?? 'MODERATE';
  const price = c.pricePointRecommendation as string ?? 'STANDARD';
  const pType = c.purchaseType as string ?? 'BOTH';
  const identity = c.identitySignalStrength as number ?? 0;
  const prediction = c.conversionPrediction as string | undefined;

  const priceMap: Record<string, string> = { BUDGET: '$15–19', STANDARD: '$19–23', PREMIUM: '$23–28' };
  const giftColor = gift === 'HIGH' ? 'text-green-400' : gift === 'MODERATE' ? 'text-yellow-400' : 'text-stone-500';
  const priceColor = price === 'PREMIUM' ? 'text-green-400' : price === 'STANDARD' ? 'text-yellow-400' : 'text-stone-400';
  const idColor = identity >= 70 ? 'text-green-400' : identity >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-3 border border-stone-800 bg-stone-900/30">
      <div className="text-xs font-mono text-stone-500 tracking-wider mb-3">COMMERCIAL SIGNALS</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs font-mono">
        <div><span className="text-stone-600">Gift Potential </span><span className={giftColor}>{gift}</span></div>
        <div><span className="text-stone-600">Price Point </span><span className={priceColor}>{price} <span className="text-stone-500">{priceMap[price] ?? ''}</span></span></div>
        <div><span className="text-stone-600">Purchase Type </span><span className="text-stone-300">{pType}</span></div>
        <div><span className="text-stone-600">Identity Signal </span><span className={idColor}>{identity}</span></div>
      </div>
      {prediction && <p className="text-stone-500 text-xs mt-3 leading-relaxed">{prediction}</p>}
    </div>
  );
}

function NicheDetailPanel({ agents }: { agents: PODReport['agents'] }) {
  const niche = agents.niche as Record<string, unknown>;
  const thumb = agents.thumbnail as Record<string, unknown>;
  const arch = agents.archetype as Record<string, unknown>;

  const selfIdSpeed = niche.selfIdentificationSpeed as string ?? '';
  const thumbNicheSignal = niche.thumbnailNicheSignal as string ?? '';
  const nicheRec = niche.nicheRecommendation as string ?? '';
  const textLeg = thumb.textLegibility as string ?? '';
  const thumbIssue = thumb.thumbnailIssue as string | null;
  const emotionalTrigger = arch.emotionalTrigger as string ?? '';
  const archetypeNote = arch.archetypeNote as string ?? '';

  const speedColor = selfIdSpeed === 'INSTANT' ? 'text-green-400' : selfIdSpeed === '3_SECONDS' ? 'text-yellow-400' : 'text-red-400';
  const signalColor = thumbNicheSignal === 'STRONG' ? 'text-green-400' : thumbNicheSignal === 'PARTIAL' ? 'text-yellow-400' : 'text-red-400';
  const textColor = textLeg === 'CLEAR' || textLeg === 'NO_TEXT' ? 'text-green-400' : textLeg === 'BORDERLINE' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-3">
      <div className="text-xs font-mono text-stone-500 tracking-wider">NICHE + BUYER SIGNALS</div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
        {selfIdSpeed && <div><span className="text-stone-600">Self-ID Speed </span><span className={speedColor}>{selfIdSpeed.replace('_', ' ')}</span></div>}
        {thumbNicheSignal && <div><span className="text-stone-600">Thumb Signal </span><span className={signalColor}>{thumbNicheSignal}</span></div>}
        {textLeg && textLeg !== 'NO_TEXT' && <div><span className="text-stone-600">Text Legibility </span><span className={textColor}>{textLeg}</span></div>}
      </div>
      {emotionalTrigger && (
        <div className="text-xs"><span className="text-stone-600 font-mono">Emotional trigger — </span><span className="text-stone-300">{emotionalTrigger}</span></div>
      )}
      {thumbIssue && thumbIssue !== 'null' && (
        <div className="border-l-2 border-red-400/30 pl-3">
          <div className="text-xs font-mono text-red-400/60 mb-1 tracking-wider">THUMBNAIL ISSUE</div>
          <p className="text-stone-400 text-xs">{thumbIssue}</p>
        </div>
      )}
      {nicheRec && (
        <div className="border-l-2 border-purple-400/30 pl-3">
          <div className="text-xs font-mono text-purple-400/60 mb-1 tracking-wider">NICHE NOTE</div>
          <p className="text-stone-400 text-xs">{nicheRec}</p>
        </div>
      )}
      {archetypeNote && (
        <div className="border-l-2 border-rose-400/30 pl-3">
          <div className="text-xs font-mono text-rose-400/60 mb-1 tracking-wider">ARCHETYPE NOTE</div>
          <p className="text-stone-400 text-xs">{archetypeNote}</p>
        </div>
      )}
    </div>
  );
}

function VoicePanel({ agents }: { agents: PODReport['agents'] }) {
  const voice = agents.voice as Record<string, unknown>;
  const voiceType = voice.voiceType as string ?? 'NO_TEXT';
  const voiceScore = voice.voiceScore as number ?? 0;
  const extractedText = voice.extractedText as string | null;
  const wordCount = voice.wordCount as number ?? 0;
  const conversionStrength = voice.conversionStrength as string ?? 'NO_TEXT';
  const emotionalDirectness = voice.emotionalDirectness as number ?? 0;
  const thumbnailTextSurvival = voice.thumbnailTextSurvival as string ?? 'NO_TEXT';
  const buyerPsychology = voice.buyerPsychology as string ?? '';
  const alternativeVoice = voice.alternativeVoice as string ?? '';

  const typeLabels: Record<string, string> = {
    PARASOCIAL_COMMAND:    'Parasocial Command',
    PARASOCIAL_STATEMENT:  'Parasocial Statement',
    IRONIC_TITLE:          'Ironic Title',
    IDENTITY_CLAIM:        'Identity Claim',
    DECLARATIVE_STATEMENT: 'Declarative Statement',
    OBSERVER_DESCRIPTION:  'Observer Description',
    NO_TEXT:               'No Text'
  };

  const typeColor: Record<string, string> = {
    PARASOCIAL_COMMAND:    'text-green-400',
    PARASOCIAL_STATEMENT:  'text-green-400',
    IRONIC_TITLE:          'text-yellow-300',
    IDENTITY_CLAIM:        'text-yellow-400',
    DECLARATIVE_STATEMENT: 'text-yellow-500',
    OBSERVER_DESCRIPTION:  'text-red-400',
    NO_TEXT:               'text-stone-400'
  };

  const strengthColor = conversionStrength === 'STRONG' ? 'text-green-400'
    : conversionStrength === 'MODERATE' ? 'text-yellow-400'
    : conversionStrength === 'WEAK' ? 'text-red-400'
    : 'text-stone-500';

  const survivalColor = thumbnailTextSurvival === 'INTACT' ? 'text-green-400'
    : thumbnailTextSurvival === 'PARTIAL' ? 'text-yellow-400'
    : thumbnailTextSurvival === 'LOST' ? 'text-red-400'
    : 'text-stone-500';

  const scoreColor = voiceScore >= 70 ? 'text-green-400' : voiceScore >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-3 border border-stone-800 bg-stone-900/30">
      <div className="text-xs font-mono text-stone-500 tracking-wider mb-3">VOICE ANALYSIS — PARASOCIAL CONVERSION</div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className={`text-sm font-mono font-medium ${typeColor[voiceType] ?? 'text-stone-400'}`}>
            {typeLabels[voiceType] ?? voiceType}
          </div>
          {extractedText && extractedText !== 'null' ? (
            <div className="text-stone-300 text-sm mt-1 italic">&ldquo;{extractedText}&rdquo;</div>
          ) : (
            <div className="text-stone-600 text-xs mt-1 italic">No text detected</div>
          )}
          {wordCount > 0 && (
            <div className="text-stone-600 text-xs mt-0.5 font-mono">{wordCount} word{wordCount !== 1 ? 's' : ''}</div>
          )}
        </div>
        <div className={`text-3xl font-light shrink-0 ${scoreColor}`}>{voiceScore}</div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono mb-3">
        <div><span className="text-stone-600">Conversion </span><span className={strengthColor}>{conversionStrength}</span></div>
        <div><span className="text-stone-600">Thumb Text </span><span className={survivalColor}>{thumbnailTextSurvival.replace('_', ' ')}</span></div>
        <div>
          <span className="text-stone-600">Directness </span>
          <span className={emotionalDirectness >= 70 ? 'text-green-400' : emotionalDirectness >= 50 ? 'text-yellow-400' : 'text-red-400'}>
            {emotionalDirectness}
          </span>
        </div>
      </div>

      {buyerPsychology && (
        <p className="text-stone-500 text-xs leading-relaxed mb-2">{buyerPsychology}</p>
      )}
      {alternativeVoice && alternativeVoice !== 'Text is optimized' && (
        <div className="border-l-2 border-amber-400/30 pl-3">
          <div className="text-xs font-mono text-amber-400/60 mb-1 tracking-wider">VOICE UPGRADE</div>
          <p className="text-stone-400 text-xs">{alternativeVoice}</p>
        </div>
      )}
      {alternativeVoice === 'Text is optimized' && (
        <div className="text-xs font-mono text-green-400/60">✓ Text is optimized</div>
      )}
    </div>
  );
}

// ─── Single result ─────────────────────────────────────────────────────────────

function SingleReport({ result }: { result: SingleResult }) {
  const { report, filename } = result;
  return (
    <div className="space-y-6">
      <div className="text-stone-500 text-sm font-mono text-center">{filename}</div>
      <CRSDisplay report={report} />
      <ShirtColorPanel agents={report.agents} />
      <NarrativeSection report={report} />
      <CommercialIntelPanel agents={report.agents} />
      <VoicePanel agents={report.agents} />
      <AgentScoreGrid agents={report.agents} />
      <NicheDetailPanel agents={report.agents} />
      <div>
        <div className="text-xs font-mono text-stone-500 tracking-wider mb-2">PLATFORM SCORES</div>
        <PlatformGrid platforms={report.agents.platforms as Record<string, unknown>} best={report.bestPlatform} />
      </div>
      {report.cloudVision && (
        <div className="p-3 border border-stone-800 bg-stone-900/30">
          <div className="text-xs font-mono text-stone-500 tracking-wider mb-2">CLOUD VISION DATA</div>
          <div className="text-xs text-stone-400 space-y-1">
            <div>Dominant color: <span className="font-mono text-amber-400">{report.cloudVision.imageProperties.dominantHex}</span></div>
            <div>Color mood: <span className="font-mono text-amber-400">{report.cloudVision.imageProperties.colorMood}</span></div>
            <div>Top labels: {report.cloudVision.labels.slice(0, 5).map(l => l.description).join(', ')}</div>
          </div>
        </div>
      )}
      <div className="text-xs text-stone-700 text-right font-mono">
        Processed in {(report.processingTime / 1000).toFixed(1)}s
      </div>
    </div>
  );
}

function BatchReport({ result }: { result: BatchResult }) {
  const { results, total, analyzed } = result;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showDNU, setShowDNU] = useState(false);

  const toggle = (filename: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });

  const uploadNow = results
    .filter(r => r.report?.uploadDecision === 'UPLOAD_NOW')
    .sort((a, b) => (b.report?.crs ?? 0) - (a.report?.crs ?? 0));
  const optimizeFirst = results
    .filter(r => r.report?.uploadDecision === 'OPTIMIZE_FIRST')
    .sort((a, b) => (b.report?.crs ?? 0) - (a.report?.crs ?? 0));
  const doNotUpload = results.filter(r => r.report?.uploadDecision === 'DO_NOT_UPLOAD');

  const thumbScore = (r: BatchDesignResult) =>
    (r.report?.agents.thumbnail as Record<string, number> | undefined)?.thumbnailScore ?? 0;
  const nicheScore = (r: BatchDesignResult) =>
    (r.report?.agents.niche as Record<string, number> | undefined)?.nicheClarityScore ?? 0;

  function DesignRow({ d, rank }: { d: BatchDesignResult; rank: number }) {
    const crs = d.report?.crs ?? 0;
    const crsColor = crs >= 75 ? 'text-green-400' : crs >= 55 ? 'text-yellow-400' : 'text-red-400';
    const isOpen = expanded.has(d.filename);
    const thumb = thumbScore(d);
    const niche = nicheScore(d);
    return (
      <div className="border border-stone-700 mb-2">
        <button
          onClick={() => toggle(d.filename)}
          className="w-full text-left p-4 hover:bg-stone-900/50 transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="text-stone-600 font-mono text-sm w-6 shrink-0 pt-0.5">#{rank}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-stone-200 text-sm font-medium truncate max-w-xs">{d.filename}</span>
                {d.report && <UploadBadge decision={d.report.uploadDecision} />}
              </div>
              <div className="flex gap-4 mt-1.5 text-xs font-mono">
                <span>
                  <span className="text-stone-600">Thumb </span>
                  <span className={thumb >= 70 ? 'text-green-400' : thumb >= 50 ? 'text-yellow-400' : 'text-red-400'}>{thumb}</span>
                </span>
                <span>
                  <span className="text-stone-600">Niche </span>
                  <span className={niche >= 70 ? 'text-green-400' : niche >= 50 ? 'text-yellow-400' : 'text-red-400'}>{niche}</span>
                </span>
              </div>
              {d.report?.narrative?.executiveSummary && (
                <div className="text-stone-500 text-xs mt-1 leading-relaxed line-clamp-2">
                  {d.report.narrative.executiveSummary}
                </div>
              )}
              {d.error && <div className="text-red-400 text-xs mt-1">{d.error}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className={`text-3xl font-light ${crsColor}`}>{crs || '—'}</div>
              <div className={`text-stone-500 text-lg transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</div>
            </div>
          </div>
        </button>
        {isOpen && d.report && (
          <div className="px-4 pb-4 border-t border-stone-800 pt-4 space-y-4">
            <ShirtColorPanel agents={d.report.agents} />
            <CommercialIntelPanel agents={d.report.agents} />
            <VoicePanel agents={d.report.agents} />
            <AgentScoreGrid agents={d.report.agents} />
            <NicheDetailPanel agents={d.report.agents} />
            <div className="space-y-3">
              <div className="text-xs font-mono text-amber-400/60 tracking-wider">
                WHY IT {d.report.crs >= 55 ? 'WILL' : "WON'T"} SELL
              </div>
              <p className="text-stone-300 text-sm leading-relaxed">{d.report.narrative.whyItSells}</p>
              <div className="border-l-2 border-amber-400/40 pl-3">
                <div className="text-xs font-mono text-amber-400/60 mb-1 tracking-wider">ONE CHANGE</div>
                <p className="text-stone-300 text-sm">{d.report.narrative.oneChange}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-xs font-mono border border-stone-800 p-3 bg-stone-900/30">
        <span className="text-stone-500">{analyzed}/{total} analyzed</span>
        {uploadNow.length > 0 && <span className="text-green-400">✓ {uploadNow.length} UPLOAD NOW</span>}
        {optimizeFirst.length > 0 && <span className="text-yellow-400">⚠ {optimizeFirst.length} OPTIMIZE FIRST</span>}
        {doNotUpload.length > 0 && <span className="text-red-400/60">✗ {doNotUpload.length} DO NOT UPLOAD</span>}
      </div>

      {/* UPLOAD NOW */}
      {uploadNow.length > 0 && (
        <div>
          <div className="text-green-400 font-mono text-xs tracking-widest mb-3">
            ✓ UPLOAD NOW <span className="text-stone-700 ml-2">— priority order</span>
          </div>
          {uploadNow.map((d, i) => <DesignRow key={d.filename} d={d} rank={i + 1} />)}
        </div>
      )}

      {/* OPTIMIZE FIRST */}
      {optimizeFirst.length > 0 && (
        <div>
          <div className="text-yellow-400 font-mono text-xs tracking-widest mb-3">⚠ OPTIMIZE FIRST</div>
          {optimizeFirst.map((d, i) => <DesignRow key={d.filename} d={d} rank={i + 1} />)}
        </div>
      )}

      {/* DO NOT UPLOAD — collapsed by default */}
      {doNotUpload.length > 0 && (
        <div>
          <button
            onClick={() => setShowDNU(v => !v)}
            className="text-red-400/50 font-mono text-xs tracking-widest mb-3 hover:text-red-400 transition-colors flex items-center gap-2"
          >
            {showDNU ? '▾' : '▸'} ✗ DO NOT UPLOAD ({doNotUpload.length})
          </button>
          {showDNU && doNotUpload.map((d, i) => <DesignRow key={d.filename} d={d} rank={i + 1} />)}
        </div>
      )}

      {uploadNow.length === 0 && optimizeFirst.length === 0 && (
        <div className="text-stone-500 text-sm text-center py-6">No designs cleared the upload threshold.</div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [platform, setPlatform] = useState('merch');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const PLATFORM_LABELS: Record<string, string> = {
    merch: 'Merch by Amazon',
    redbubble: 'Redbubble',
    etsy: 'Etsy',
    teepublic: 'Teepublic'
  };

  // Resize + compress to JPEG before sending — keeps base64 well under Vercel's 4.5MB body limit.
  // Max 1500px on longest side, white background (handles PNG transparency), JPEG 92%.
  const prepareImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1500;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });

  const analyze = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const fileArray = Array.from(files);
    setLoadingMsg(
      fileArray.length === 1
        ? `Analyzing ${fileArray[0].name} through Da Vinci's framework…`
        : `Analyzing ${fileArray.length} designs — ~30s per design…`
    );
    try {
      const images = await Promise.all(
        fileArray.map(async f => ({ filename: f.name, base64: await prepareImage(f) }))
      );
      const res = await fetch('/api/pod-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, platform })
      });
      if (!res.ok) {
        // Guard against non-JSON error responses (e.g. Vercel 413 plain text)
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { msg = text.slice(0, 120) || msg; }
        throw new Error(msg);
      }
      setResult(await res.json() as AnalysisResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }, [platform]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => analyze(e.target.files);
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); analyze(e.dataTransfer.files); };

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100 font-sans">
      {/* Header */}
      <div className="border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-amber-400 font-serif text-2xl tracking-wide">POD Vinci</h1>
          <p className="text-stone-500 text-xs font-mono mt-0.5">Commercial Resonance Analyzer · Da Vinci Engine</p>
        </div>
        <div className="text-stone-600 text-xs font-mono text-right">
          <div>v1.0</div>
          <div>~$0.11 / design</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* Platform selector */}
        <div>
          <div className="text-xs font-mono text-stone-500 tracking-wider mb-2">PRIMARY PLATFORM</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPlatform(key)}
                className={`px-4 py-2 text-sm font-mono border transition-colors ${
                  platform === key
                    ? 'border-amber-400/60 text-amber-400 bg-amber-900/20'
                    : 'border-stone-700 text-stone-400 hover:border-stone-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
            dragging ? 'border-amber-400/60 bg-amber-900/10' : 'border-stone-700 hover:border-stone-500'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="text-4xl mb-3 text-stone-600">⬆</div>
          <div className="text-stone-400 text-sm">Drop design(s) here or click to browse</div>
          <div className="text-stone-600 text-xs mt-2 font-mono">PNG · JPG · WEBP · up to 20 designs</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mb-4" />
            <p className="text-stone-400 text-sm">{loadingMsg}</p>
            <p className="text-stone-600 text-xs mt-2 font-mono">8 agents running in parallel…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="border border-red-900/50 bg-red-900/10 p-4">
            <div className="text-red-400 text-sm font-mono">{error}</div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="border-t border-stone-800 pt-8">
            {result.mode === 'single' ? (
              <SingleReport result={result} />
            ) : (
              <BatchReport result={result} />
            )}
          </div>
        )}

        {/* Footer quote */}
        {!result && !loading && (
          <div className="text-center text-stone-700 text-xs font-mono mt-16 space-y-1">
            <div>&ldquo;The painter has the Universe in his mind and hands.&rdquo;</div>
            <div>— Leonardo da Vinci</div>
            <div className="mt-4 text-stone-800">
              Thumbnail + Niche Clarity carry the most weight · Safe Search gates automatically
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
