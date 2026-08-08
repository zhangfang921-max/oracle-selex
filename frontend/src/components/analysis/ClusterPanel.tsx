import { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Layers, Dna, Users, TrendingUp, ArrowRight, Loader2, Activity, FlaskConical, FileSpreadsheet, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { ClusterCharts } from './ClusterCharts'
import type { SequenceCluster } from '@/types/analysis'

/** Export cluster data as CSV */
function exportClusterCSV(data: SequenceCluster[]) {
  const headers = [
    'Cluster_ID',
    'Rank',
    'Representative_Sequence',
    'Cluster_Size',
    'Avg_Enrichment_Fold',
    'Max_Enrichment_Fold',
    'Avg_Max_Percent_Read',
    'cGcC_Score',
    'G4Hunter_Score',
    'G4NN_Score',
    'G4_Risk',
    'Num_G4_Motifs',
    'MFE_With_G4',
    'MFE_Without_G4',
    'DotBracket_With_G4',
    'DotBracket_Without_G4',
    'Member_Sequences',
  ]

  const rows = data.map((c, i) => [
    c.id,
    i + 1,
    c.representative,
    c.size,
    c.avgEnrichmentFold === Infinity ? 'Inf' : (c.avgEnrichmentFold?.toFixed(4) ?? ''),
    c.maxEnrichmentFold === Infinity ? 'Inf' : (c.maxEnrichmentFold?.toFixed(4) ?? ''),
    c.avgMaxPercentRead?.toFixed(6) ?? '',
    c.cGcC?.toFixed(4) ?? '',
    (c.g4Hunter ?? 0).toFixed(4),
    (c.g4NN ?? 0).toFixed(4),
    c.g4Risk ?? '',
    c.numG4Motifs ?? 0,
    c.rnaFold?.mfe ?? '',
    c.rnaFoldNoG4?.mfe ?? '',
    c.rnaFold?.dotBracket ?? '',
    c.rnaFoldNoG4?.dotBracket ?? '',
    c.members.map((m) => m.sequence).join(';'),
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((val) => {
        const s = String(val)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s
      }).join(',')
    ),
  ].join('\n')

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cluster_results_${data.length}clusters.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Export cluster data as JSON (full detail, per-member sequences included) */
function exportClusterJSON(data: SequenceCluster[], clusterMeta?: ClusterMeta | null) {
  const payload = {
    exportedAt: new Date().toISOString(),
    totalClusters: data.length,
    totalSequences: data.reduce((s, c) => s + c.size, 0),
    clusterMeta: clusterMeta || null,
    clusters: data.map((c, i) => ({
      rank: i + 1,
      id: c.id,
      representative: c.representative,
      size: c.size,
      avgEnrichmentFold: c.avgEnrichmentFold === Infinity ? 'Infinity' : c.avgEnrichmentFold,
      maxEnrichmentFold: c.maxEnrichmentFold === Infinity ? 'Infinity' : c.maxEnrichmentFold,
      avgMaxPercentRead: c.avgMaxPercentRead,
      g4Score: c.g4Score,
      g4Risk: c.g4Risk,
      cGcC: c.cGcC,
      g4Hunter: c.g4Hunter ?? 0,
      g4NN: c.g4NN ?? 0,
      numG4Motifs: c.numG4Motifs,
      g4Motifs: c.g4Motifs || [],
      gRichRegions: c.gRichRegions || [],
      rnaFoldWithG4: c.rnaFold ? {
        dotBracket: c.rnaFold.dotBracket,
        mfe: c.rnaFold.mfe,
        numBasePairs: c.rnaFold.numBasePairs,
        hasGQuad: c.rnaFold.hasGQuad,
        engine: c.rnaFold.engine,
      } : null,
      rnaFoldWithoutG4: c.rnaFoldNoG4 ? {
        dotBracket: c.rnaFoldNoG4.dotBracket,
        mfe: c.rnaFoldNoG4.mfe,
        numBasePairs: c.rnaFoldNoG4.numBasePairs,
        engine: c.rnaFoldNoG4.engine,
      } : null,
      members: c.members.map((m) => ({
        sequence: m.sequence,
        enrichmentFold: m.enrichmentFold === Infinity ? 'Infinity' : m.enrichmentFold,
        maxPercentRead: m.maxPercentRead,
        totalReads: m.totalReads,
        presentInRounds: m.presentInRounds,
        similarity: m.similarity,
      })),
    })),
  }

  const jsonStr = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cluster_full_data_${data.length}clusters.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Export per-member CSV for downstream analysis (cluster-level graph, stats).
 *  Columns: sequence, cluster, read_count, z_score, significant */
function exportMembersCSV(
  data: SequenceCluster[],
  permutation?: { p_values: number[]; significant: boolean[]; cluster_sizes: number[]; threshold: number } | null
) {
  const headers = ['sequence', 'cluster', 'read_count', 'z_score', 'significant']

  const rows: string[][] = []
  data.forEach((c, ci) => {
    const sig = permutation?.significant?.[ci] ?? false
    const members = c.members
    if (members.length === 0) return

    // Compute per-cluster z-scores: (read_count - mean) / std
    const counts = members.map(m => m.totalReads || 0)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(counts.length, 1)
    const std = Math.sqrt(variance) || 1  // avoid div-by-zero

    members.forEach((m) => {
      const rc = m.totalReads || 0
      const z = (rc - mean) / std
      rows.push([
        m.sequence,
        String(c.id),
        String(rc),
        z.toFixed(4),
        sig ? '1' : '0',
      ])
    })
  })

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(v =>
      v.includes(',') || v.includes('"') || v.includes('\n')
        ? `"${v.replace(/"/g, '""')}"`
        : v
    ).join(',')),
  ].join('\n')

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cluster_members_${data.length}clusters.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface ClusterMeta {
  method: string
  silhouetteScore: number
  quality: string
  numClusters: number
  kmerSize: number
  featureMode: string
  variableLen: number
  permutation?: {
    p_values: number[]
    significant: boolean[]
    cluster_sizes: number[]
    threshold: number
  }
  abundance?: {
    enrichment_scores: number[]
    enrichment_pvalues: number[]
    model: string
    parameters: { mu: number; var: number; r: number }
  }
}

interface ClusterPanelProps {
  data: SequenceCluster[]
  isLoading?: boolean
  hasEnrichment?: boolean
  onRunCluster?: () => void
  onGoToEnrichment?: () => void
  clusterMeta?: ClusterMeta | null
  permutation?: {
    p_values: number[]
    significant: boolean[]
    cluster_sizes: number[]
    threshold: number
  } | null
}

/** Count how many G4RNA Screener scores pass their thresholds */
function g4PassCount(cluster: SequenceCluster): number {
  let count = 0
  if (cluster.cGcC > 4.5) count++
  if ((cluster.g4Hunter ?? 0) > 0.9) count++
  if ((cluster.g4NN ?? 0) > 0.5) count++
  return count
}

function ClusterCard({ cluster, rank, enrichmentScore, enrichmentPvalue }: { cluster: SequenceCluster; rank: number; enrichmentScore?: number; enrichmentPvalue?: number }) {
  const [expanded, setExpanded] = useState(false)

  const passCount = g4PassCount(cluster)
  const g4BadgeStyle = passCount >= 2
    ? 'bg-emerald-500/12 text-emerald-600 border-emerald-500/30'
    : passCount === 1
      ? 'bg-amber-500/12 text-amber-600 border-amber-500/30'
      : 'bg-slate-500/10 text-slate-500 border-slate-500/20'

  const formatFold = (fold: number) => {
    if (fold === Infinity || fold > 1e10) return 'New'
    if (fold === 0) return '--'
    return fold.toFixed(1) + 'x'
  }

  return (
    <FadeIn>
      <div
        className="rounded-xl border border-border/50 transition-all hover:shadow-md"
        style={{ overflow: 'hidden', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', borderLeft: rank <= 3 ? '3px solid var(--primary)' : undefined }}
      >
        {/* Header row - always visible */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full cursor-pointer"
          style={{ padding: '18px 24px' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center" style={{ gap: 12 }}>
              {/* Rank badge */}
              <div
                className="flex items-center justify-center rounded-lg font-bold"
                style={{
                  width: 42,
                  height: 42,
                  fontSize: 15,
                  background: rank <= 3
                    ? 'color-mix(in oklch, var(--primary) 15%, transparent)'
                    : 'var(--muted)',
                  color: rank <= 3 ? 'var(--primary)' : 'var(--muted-foreground)',
                  flexShrink: 0,
                }}
              >
                #{rank}
              </div>

              {/* Representative sequence */}
              <div className="text-left">
                <code
                  className="break-all block"
                  style={{ fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-small)', lineHeight: 1.5, maxWidth: 420 }}
                >
                  {cluster.representative.length > 50
                    ? cluster.representative.substring(0, 50) + '...'
                    : cluster.representative}
                </code>
                <div className="flex items-center text-muted-foreground" style={{ gap: 14, marginTop: 6, fontSize: 'var(--font-size-small)' }}>
                  <span className="flex items-center" style={{ gap: 4 }}>
                    <Users size={13} />
                    {cluster.size} member{cluster.size !== 1 ? 's' : ''}
                  </span>
                  {enrichmentScore !== undefined && (
                    <span
                      className={`flex items-center font-medium cursor-help ${enrichmentScore > 0 ? 'text-emerald-600' : enrichmentScore < 0 ? 'text-red-500' : 'text-muted-foreground'}`}
                      style={{ gap: 3 }}
                      title={`Z-score: how many standard deviations this cluster's total read count deviates from the random expectation under a negative binomial model.

Z > 0 = enriched (more reads than expected by chance).
Z < 0 = depleted (fewer reads than expected by chance).
|Z| > 2 ≈ p < 0.05, |Z| > 3 ≈ p < 0.003.

Clusters are sorted by Z-score descending — the most significantly enriched clusters appear first.`}
                    >
                      <TrendingUp size={12} />
                      Z={enrichmentScore.toFixed(1)}
                      {enrichmentPvalue !== undefined && enrichmentPvalue < 0.05 && (
                        <span className="text-[10px] opacity-70">*</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: G4 badge + MFE + expand */}
            <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
              {cluster.rnaFold && (
                <span
                  className={`font-medium rounded-full border flex items-center ${
                    cluster.rnaFold.mfe <= -10
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25'
                      : cluster.rnaFold.mfe <= -5
                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/25'
                        : 'bg-slate-500/8 text-slate-500 border-slate-500/20'
                  }`}
                  style={{ padding: '4px 11px', gap: 4, fontSize: 'var(--font-size-small)' }}
                >
                  <Activity size={12} />
                  {cluster.rnaFold.mfe} kcal
                </span>
              )}
              <span
                className={`font-semibold rounded-full border flex items-center ${g4BadgeStyle}`}
                style={{ padding: '4px 12px', gap: 5, fontSize: 'var(--font-size-small)' }}
              >
                <FlaskConical size={12} />
                G4 {passCount}/3
              </span>
              {expanded ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
            </div>
          </div>
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div
            className="border-t border-border"
            style={{ padding: '12px 20px 16px' }}
          >
            {/* RNA structure summary row */}
            {cluster.rnaFold && (
            <div
              className="flex flex-wrap items-center text-xs rounded-lg bg-muted/40"
              style={{ padding: '8px 12px', gap: 16, marginBottom: 12 }}
            >
              <span>
                <strong>MFE:</strong>{' '}
                <span className={
                  cluster.rnaFold.mfe <= -10 ? 'text-emerald-600 font-semibold' :
                  cluster.rnaFold.mfe <= -5 ? 'text-blue-600' : ''
                }>
                  {cluster.rnaFold.mfe} kcal/mol
                </span>
              </span>
              <span>
                <strong>Base Pairs:</strong> {cluster.rnaFold.numBasePairs}
              </span>
              {cluster.rnaFold.hasGQuad && (
                <span className="text-amber-600 font-semibold">G4 Structure Detected (ViennaRNA)</span>
              )}
            </div>
            )}

            {/* G4RNA Screener — Primary G4 analysis (Recommended) */}
            <G4ScreenerPanel cluster={cluster} />

            {/* RNA Secondary Structure — Dual Fold Comparison */}
            <RNAFoldComparison cluster={cluster} />

            {/* Member list */}
            {cluster.members.length > 1 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground" style={{ marginBottom: 6 }}>
                  Cluster Members ({cluster.members.length})
                </p>
                <div className="overflow-auto rounded-lg border border-border/60" style={{ maxHeight: 260 }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left font-semibold" style={{ padding: '6px 10px' }}>Sequence</th>
                        <th className="text-right font-semibold" style={{ padding: '6px 10px' }}>Fold</th>
                        <th className="text-right font-semibold" style={{ padding: '6px 10px' }}>Max%</th>
                        <th className="text-right font-semibold" style={{ padding: '6px 10px' }}>Similarity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cluster.members.map((m, idx) => (
                        <tr
                          key={idx}
                          className={`border-t border-border/30 ${idx === 0 ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                        >
                          <td style={{ padding: '5px 10px', fontFamily: 'var(--font-family-mono)' }}>
                            {m.sequence.length > 40 ? m.sequence.substring(0, 40) + '...' : m.sequence}
                            {idx === 0 && (
                              <span className="ml-1 text-primary font-semibold" style={{ fontFamily: 'var(--font-family-base)' }}>
                                (rep)
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums" style={{ padding: '5px 10px' }}>
                            {m.enrichmentFold === null
                              ? '--'
                              : m.enrichmentFold === Infinity
                                ? 'New'
                                : m.enrichmentFold.toFixed(1) + 'x'}
                          </td>
                          <td className="text-right tabular-nums" style={{ padding: '5px 10px' }}>
                            {m.maxPercentRead.toFixed(3)}%
                          </td>
                          <td className="text-right tabular-nums" style={{ padding: '5px 10px' }}>
                            {(m.similarity * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {cluster.members.length === 1 && (
              <p className="text-xs text-muted-foreground italic">
                This is a singleton cluster -- no similar sequences found at the current threshold.
              </p>
            )}
          </div>
        )}
      </div>
    </FadeIn>
  )
}

/* ── G4RNA Screener Panel ──────────────────────────────────────────── */

function G4ScreenerPanel({ cluster }: { cluster: SequenceCluster }) {
  const seq = cluster.representative
  const hasMotifs = cluster.g4Motifs && cluster.g4Motifs.length > 0

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20"
      style={{ padding: '12px 14px', marginBottom: 12 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap" style={{ marginBottom: 10, gap: 6 }}>
        <p className="text-xs font-semibold text-muted-foreground flex items-center" style={{ gap: 5 }}>
          <FlaskConical size={12} />
          G4RNA Screener
          <span
            className="ml-1 px-1.5 py-0.5 rounded font-bold border text-emerald-600 bg-emerald-500/12 border-emerald-500/25"
            style={{ fontSize: 9 }}
          >
            Recommended
          </span>
        </p>
        <div className="flex items-center text-xs text-muted-foreground" style={{ gap: 6 }}>
          <span style={{ fontSize: 10 }}>
            {g4PassCount(cluster)}/3 thresholds passed
          </span>
        </div>
      </div>

      {/* Three G4 scores with threshold indicators */}
      <div className="grid grid-cols-3 gap-2" style={{ marginBottom: 10 }}>
        {(() => {
          const scores = [
            {
              label: 'cGcC',
              value: cluster.cGcC,
              threshold: 4.5,
              thresholdLabel: '> 4.5',
              description: 'G-richness',
            },
            {
              label: 'G4H',
              value: cluster.g4Hunter ?? 0,
              threshold: 0.9,
              thresholdLabel: '> 0.9',
              description: 'G4Hunter',
            },
            {
              label: 'G4NN',
              value: cluster.g4NN ?? 0,
              threshold: 0.5,
              thresholdLabel: '> 0.5',
              description: 'Neural net',
            },
          ]
          return scores.map((s) => {
            const pass = s.value > s.threshold
            return (
              <div
                key={s.label}
                className={`rounded-lg border text-center ${
                  pass
                    ? 'border-emerald-500/30 bg-emerald-500/8'
                    : 'border-border/60 bg-background/60'
                }`}
                style={{ padding: '10px 8px' }}
              >
                <div className="flex items-center justify-center" style={{ gap: 4, marginBottom: 4 }}>
                  <span className="text-xs font-bold text-foreground">{s.label}</span>
                  <span
                    className={`text-xs font-medium rounded px-1 py-0.5 ${
                      pass
                        ? 'text-emerald-700 bg-emerald-500/15'
                        : 'text-muted-foreground bg-muted/60'
                    }`}
                    style={{ fontSize: 9 }}
                  >
                    {s.thresholdLabel}
                  </span>
                </div>
                <p
                  className={`font-bold tabular-nums ${
                    pass ? 'text-emerald-600' : 'text-foreground'
                  }`}
                  style={{ fontSize: 18, lineHeight: 1.2 }}
                >
                  {s.value.toFixed(3)}
                </p>
                <div className="flex items-center justify-center" style={{ gap: 4, marginTop: 3 }}>
                  {pass ? (
                    <span className="text-emerald-600 font-semibold" style={{ fontSize: 9 }}>PASS</span>
                  ) : (
                    <span className="text-muted-foreground" style={{ fontSize: 9 }}>below threshold</span>
                  )}
                </div>
                <p className="text-muted-foreground" style={{ fontSize: 9, marginTop: 1 }}>{s.description}</p>
              </div>
            )
          })
        })()}
      </div>

      {/* Additional stats row */}
      <div className="flex items-center flex-wrap text-xs text-muted-foreground rounded-md bg-background/40 border border-border/30" style={{ padding: '6px 10px', gap: 12, marginBottom: 10 }}>
        <span>G4 Motifs: <strong>{cluster.numG4Motifs}</strong></span>
        <span className="w-px h-3 bg-border" />
        <span>G-rich Regions: <strong>{cluster.gRichRegions?.length ?? 0}</strong></span>
      </div>

      {/* G4 motif details removed in lite version */}
    </div>
  )
}

/* ── RNA Fold Comparison (with/without G4) ─────────────────────────── */

function StructureRow({
  label,
  labelColor,
  fold,
  seq,
  isBetter,
}: {
  label: string
  labelColor: string
  fold: { dotBracket: string; mfe: number; numBasePairs: number; hasGQuad: boolean; gquadEnabled: boolean; engine: string; length: number }
  seq: string
  isBetter: boolean
}) {
  return (
    <div
      className={`rounded-lg border ${isBetter ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/50 bg-background/40'}`}
      style={{ padding: '10px 12px' }}
    >
      <div className="flex items-center justify-between flex-wrap" style={{ marginBottom: 6, gap: 6 }}>
        <div className="flex items-center" style={{ gap: 6 }}>
          <span className={`text-xs font-bold ${labelColor}`}>{label}</span>
          {fold.hasGQuad && (
            <span className="px-1.5 py-0.5 rounded text-amber-600 bg-amber-500/15 font-bold" style={{ fontSize: 9 }}>
              G4 DETECTED
            </span>
          )}
          {fold.gquadEnabled && !fold.hasGQuad && (
            <span className="px-1.5 py-0.5 rounded text-slate-500 bg-slate-500/10 font-medium" style={{ fontSize: 9 }}>
              G4 enabled, not detected
            </span>
          )}
          {isBetter && (
            <span className="px-1.5 py-0.5 rounded text-emerald-600 bg-emerald-500/15 font-bold" style={{ fontSize: 9 }}>
              MORE STABLE
            </span>
          )}
        </div>
        <div className="flex items-center text-xs text-muted-foreground" style={{ gap: 10 }}>
          <span>
            MFE: <strong className={fold.mfe <= -10 ? 'text-emerald-600' : fold.mfe <= -5 ? 'text-blue-600' : 'text-foreground'}>
              {fold.mfe} kcal/mol
            </strong>
          </span>
          <span>Pairs: <strong>{fold.numBasePairs}</strong></span>
        </div>
      </div>
      {/* Dot-bracket */}
      <div
        className="overflow-x-auto"
        style={{ fontFamily: 'var(--font-family-mono)', fontSize: 12, lineHeight: 1.4, whiteSpace: 'pre', letterSpacing: '0.5px' }}
      >
        {fold.dotBracket.split('').map((c, i) => {
          let cls = 'text-slate-400'
          if (c === '(') cls = 'text-primary font-semibold'
          else if (c === ')') cls = 'text-blue-500 font-semibold'
          else if (c === '+') cls = 'text-amber-500 font-bold'
          else if (c === '~') cls = 'text-orange-400 font-semibold'
          return <span key={i} className={cls}>{c}</span>
        })}
      </div>
      {/* Engine info */}
      <div className="flex items-center text-muted-foreground" style={{ gap: 6, marginTop: 4, fontSize: 10 }}>
        <span className="px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 font-medium">{fold.engine}</span>
        {fold.gquadEnabled && (
          <span className="text-amber-600">G-Quadruplex option: ON</span>
        )}
        {!fold.gquadEnabled && (
          <span>G-Quadruplex option: OFF</span>
        )}
      </div>
    </div>
  )
}

function RNAFoldComparison({ cluster }: { cluster: SequenceCluster }) {
  const { rnaFold, rnaFoldNoG4, representative } = cluster
  if (!rnaFold && !rnaFoldNoG4) return null

  const hasBoth = rnaFold && rnaFoldNoG4
  const g4IsBetter = hasBoth && rnaFold.mfe <= rnaFoldNoG4.mfe
  const noG4IsBetter = hasBoth && rnaFoldNoG4.mfe < rnaFold.mfe
  const mfeDiff = hasBoth ? Math.abs(rnaFold.mfe - rnaFoldNoG4.mfe) : 0

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20"
      style={{ padding: '12px 14px', marginBottom: 12 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap" style={{ marginBottom: 8, gap: 6 }}>
        <p className="text-xs font-semibold text-muted-foreground flex items-center" style={{ gap: 4 }}>
          <Dna size={12} />
          RNA Secondary Structure
          {hasBoth && (
            <span className="ml-1 text-muted-foreground/60" style={{ fontSize: 10 }}>
              (dual fold comparison)
            </span>
          )}
        </p>
        <div className="flex items-center text-xs text-muted-foreground" style={{ gap: 10 }}>
          <span className="flex items-center" style={{ gap: 3 }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--primary)' }} />
            ( pair
          </span>
          <span className="flex items-center" style={{ gap: 3 }}>
            <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />
            ) pair
          </span>
          <span className="flex items-center" style={{ gap: 3 }}>
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-500" />
            + G4 tract
          </span>
          <span className="flex items-center" style={{ gap: 3 }}>
            <span className="inline-block w-2 h-2 rounded-sm bg-orange-400" />
            ~ G4 loop
          </span>
          <span className="flex items-center" style={{ gap: 3 }}>
            <span className="inline-block w-2 h-2 rounded-sm bg-slate-300" />
            . free
          </span>
        </div>
      </div>

      {/* Sequence row */}
      <div
        className="overflow-x-auto rounded-md bg-background/60 border border-border/40"
        style={{ padding: '8px 10px', marginBottom: 8 }}
      >
        {/* Position ruler */}
        <div
          className="text-muted-foreground/50 select-none"
          style={{ fontFamily: 'var(--font-family-mono)', fontSize: 10, lineHeight: 1.2, marginBottom: 1, whiteSpace: 'pre' }}
        >
          {representative.split('').map((_, i) => {
            if (i === 0) return '1'
            if ((i + 1) % 10 === 0) return String(i + 1)
            if ((i + 1) % 5 === 0) return '.'
            return ' '
          }).join('')}
        </div>
        <div
          style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre', letterSpacing: '0.5px' }}
        >
          {representative.split('').map((c, i) => {
            const g4Char = rnaFold?.dotBracket[i]
            let cls = 'text-foreground/70'
            if (g4Char === '+') cls = 'text-amber-600 font-bold'
            else if (g4Char === '~') cls = 'text-orange-500 font-semibold'
            else if (g4Char === '(' || g4Char === ')') cls = 'text-foreground font-medium'
            return <span key={i} className={cls}>{c}</span>
          })}
        </div>
      </div>

      {/* Dual fold structures */}
      <div className="flex flex-col" style={{ gap: 6 }}>
        {rnaFold && (
          <StructureRow
            label="With G-Quadruplex"
            labelColor="text-amber-600"
            fold={rnaFold}
            seq={representative}
            isBetter={!!g4IsBetter}
          />
        )}
        {rnaFoldNoG4 && (
          <StructureRow
            label="Without G-Quadruplex"
            labelColor="text-blue-600"
            fold={rnaFoldNoG4}
            seq={representative}
            isBetter={!!noG4IsBetter}
          />
        )}
      </div>

      {/* Energy comparison summary */}
      {hasBoth && (
        <div className="flex items-center flex-wrap text-xs text-muted-foreground rounded-md bg-background/40 border border-border/30" style={{ padding: '6px 10px', gap: 10, marginTop: 8 }}>
          <span>
            {'\u0394'}MFE: <strong className={mfeDiff > 2 ? 'text-foreground' : ''}>{mfeDiff.toFixed(2)} kcal/mol</strong>
          </span>
          <span className="w-px h-3 bg-border" />
          {g4IsBetter ? (
            <span className="text-amber-600 font-medium">G4 conformation is thermodynamically favored</span>
          ) : (
            <span className="text-blue-600 font-medium">Canonical stem-loop is thermodynamically favored</span>
          )}
          <span className="w-px h-3 bg-border" />
          <span className="text-muted-foreground/60">
            Engine: <strong>{rnaFold.engine}</strong>
          </span>
        </div>
      )}
    </div>
  )
}

/* ── Summary Cards ──────────────────────────────────────────────────── */

function SummaryCards({ data }: { data: SequenceCluster[] }) {
  const totalSeqs = data.reduce((s, c) => s + c.size, 0)
  const multiClusters = data.filter((c) => c.size > 1).length
  const g4Positive = data.filter((c) => g4PassCount(c) >= 2).length
  const stableRNA = data.filter((c) => c.rnaFold && c.rnaFold.mfe <= -5).length

  const cards = [
    { label: 'Clusters', value: data.length, color: 'var(--primary)', icon: Layers },
    { label: 'Total Sequences', value: totalSeqs, color: 'var(--chart-2, oklch(0.65 0.16 165))', icon: Dna },
    { label: 'G4 Positive', value: g4Positive, color: 'oklch(0.55 0.16 165)', icon: FlaskConical },
    { label: 'Stable Structure', value: stableRNA, color: 'oklch(0.55 0.16 145)', icon: Activity },
  ]

  return (
    <FadeIn>
      <div
        className="grid grid-cols-2 md:grid-cols-4"
        style={{ gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)' }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border/50 shadow-sm flex items-center"
            style={{ padding: '16px 20px', gap: 14, background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))' }}
          >
            <div
              className="rounded-lg flex items-center justify-center"
              style={{
                width: 42,
                height: 42,
                background: `color-mix(in oklch, ${c.color} 12%, transparent)`,
                color: c.color,
                flexShrink: 0,
              }}
            >
              <c.icon size={20} />
            </div>
            <div>
              <p className="font-bold tabular-nums" style={{ fontSize: 24, lineHeight: 1.1, color: 'var(--foreground)' }}>
                {c.value}
              </p>
              <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>
    </FadeIn>
  )
}

/* ── Category Filters ──────────────────────────────────────────────── */

type FilterCategory = 'all' | 'multi' | 'g4pos' | 'stable'

function CategoryFilters({
  active,
  onChange,
  data,
}: {
  active: FilterCategory
  onChange: (c: FilterCategory) => void
  data: SequenceCluster[]
}) {
  const counts: Record<FilterCategory, number> = {
    all: data.length,
    multi: data.filter((c) => c.size > 1).length,
    g4pos: data.filter((c) => g4PassCount(c) >= 2).length,
    stable: data.filter((c) => c.rnaFold != null && c.rnaFold.mfe <= -5).length,
  }

  const categories: { key: FilterCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'multi', label: 'Multi-member' },
    { key: 'g4pos', label: 'G4 Positive (≥2 pass)' },
    { key: 'stable', label: 'Stable Structure' },
  ]

  return (
    <FadeIn>
      <div
        className="flex flex-wrap items-center rounded-xl bg-muted/50"
        style={{ padding: '4px', marginBottom: 'var(--spacing-md)', gap: 2 }}
      >
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onChange(cat.key)}
            className={`rounded-lg text-sm font-medium transition-all cursor-pointer ${
              active === cat.key
                ? 'bg-card shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ padding: '6px 14px' }}
          >
            {cat.label}
            <span
              className="ml-1.5 tabular-nums"
              style={{ fontSize: 11, opacity: 0.7 }}
            >
              ({counts[cat.key]})
            </span>
          </button>
        ))}
      </div>
    </FadeIn>
  )
}

/* ── Main Component ──────────────────────────────────────────────── */

export function ClusterPanel({
  data,
  isLoading,
  hasEnrichment,
  onRunCluster,
  onGoToEnrichment,
  clusterMeta,
  permutation,
}: ClusterPanelProps) {
  const [filter, setFilter] = useState<FilterCategory>('all')

  if (isLoading) {
    return (
      <FadeIn className="flex flex-col items-center justify-center" style={{ minHeight: 280, gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-sm font-medium" style={{ marginBottom: 4 }}>Clustering sequences...</p>
          <p className="text-xs text-muted-foreground">
            Grouping similar sequences, scoring G4 potential, and predicting RNA structures.
          </p>
        </div>
      </FadeIn>
    )
  }

  if (data.length === 0) {
    return (
      <FadeIn>
        <div
          className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border"
          style={{ minHeight: 320, padding: 'var(--spacing-2xl)', gap: 'var(--spacing-md)' }}
        >
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: 64,
              height: 64,
              background: 'color-mix(in oklch, var(--primary) 12%, transparent)',
            }}
          >
            <Layers size={28} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 6 }}>
              Sequence Clustering
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', maxWidth: 440, margin: '0 auto' }}>
              {hasEnrichment
                ? 'Group similar enriched sequences into clusters. Each cluster will be scored for G4 potential and predicted for RNA secondary structure.'
                : 'Run enrichment analysis first to identify candidate sequences, then cluster them by similarity.'}
            </p>
          </div>
          {hasEnrichment ? (
            <Button onClick={onRunCluster} className="cursor-pointer" size="lg" style={{ marginTop: 'var(--spacing-xs)' }}>
              <Layers className="w-4 h-4 mr-2" />
              Run Clustering
            </Button>
          ) : (
            <Button variant="outline" onClick={onGoToEnrichment} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <TrendingUp className="w-4 h-4 mr-1" />
              Run Enrichment First
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </FadeIn>
    )
  }

  // Apply filter
  const filtered = data.filter((c) => {
    if (filter === 'multi') return c.size > 1
    if (filter === 'g4pos') return g4PassCount(c) >= 2
    if (filter === 'stable') return c.rnaFold != null && c.rnaFold.mfe <= -5
    return true
  })

  // Sort by enrichment Z-score descending when abundance data is available
  const sorted = clusterMeta?.abundance?.enrichment_scores
    ? [...filtered].sort((a, b) => {
        const za = clusterMeta.abundance!.enrichment_scores[a.id - 1] ?? -Infinity
        const zb = clusterMeta.abundance!.enrichment_scores[b.id - 1] ?? -Infinity
        return zb - za
      })
    : filtered

  return (
    <div>
      {/* Section header — glass style */}
      <FadeIn>
        <div style={{ paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h2
                className="font-bold"
                style={{
                  fontSize: 'var(--font-size-headline)',
                  fontFamily: 'var(--font-family-heading)',
                  letterSpacing: 'var(--letter-spacing-tight)',
                  color: 'var(--foreground)',
                }}
              >
                Results
              </h2>
              <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-label)', marginTop: 4 }}>
                Clusters sorted by Z-score (enrichment significance). Hover over Z values for explanation.
              </p>
            </div>
            <div className="flex items-center" style={{ gap: 6 }}>
              <button
                onClick={() => exportClusterCSV(data)}
                className="flex items-center font-medium rounded-lg border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                style={{ padding: '8px 16px', gap: 6, fontSize: 'var(--font-size-small)', background: 'var(--glass-bg)', backdropFilter: 'blur(8px)' }}
                title="Export summary CSV (cluster-level, 17 columns)"
              >
                <FileSpreadsheet size={15} />
                CSV
              </button>
              <button
                onClick={() => exportClusterJSON(data, clusterMeta)}
                className="flex items-center font-medium rounded-lg border border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
                style={{ padding: '8px 16px', gap: 6, fontSize: 'var(--font-size-small)', background: 'var(--glass-bg)', backdropFilter: 'blur(8px)', color: 'var(--primary)' }}
                title="Export full data as JSON (per-member sequences, G4 motifs, RNA structures)"
              >
                <Download size={15} />
                JSON (Full)
              </button>
              <button
                onClick={() => exportMembersCSV(data, permutation)}
                className="flex items-center font-medium rounded-lg border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                style={{ padding: '8px 16px', gap: 6, fontSize: 'var(--font-size-small)', background: 'var(--glass-bg)', backdropFilter: 'blur(8px)' }}
                title="Export per-member CSV (sequence, cluster, read_count, z_score, significant) — for downstream cluster-level graph"
              >
                <FileSpreadsheet size={15} />
                Members CSV
              </button>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Algorithm metadata badge */}
      {clusterMeta && (
        <FadeIn>
          <div
            className="rounded-xl border border-border/50"
            style={{ padding: '16px 22px', marginBottom: 'var(--spacing-lg)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))' }}
          >
            <div className="flex items-center flex-wrap" style={{ gap: 14 }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <span
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                  style={{ letterSpacing: '0.08em' }}
                >
                  Algorithm:
                </span>
                <span
                  className="text-sm font-bold text-foreground px-2 py-0.5 rounded border border-primary/20 bg-primary/5"
                  style={{ fontFamily: 'var(--font-family-mono)' }}
                >
                  {clusterMeta.method}
                </span>
              </div>

              {clusterMeta.silhouetteScore !== undefined && (
                <>
                  <span className="w-px h-4 bg-border" />
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <span className="text-xs text-muted-foreground font-medium">Silhouette:</span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        clusterMeta.silhouetteScore < 0 ? 'text-muted-foreground' :
                        clusterMeta.silhouetteScore > 0.5 ? 'text-emerald-600' :
                        clusterMeta.silhouetteScore > 0.25 ? 'text-blue-600' :
                        'text-amber-600'
                      }`}
                    >
                      {clusterMeta.silhouetteScore < 0 ? 'N/A' : clusterMeta.silhouetteScore.toFixed(3)}
                    </span>
                  </div>
                  <span className="w-px h-4 bg-border" />
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <span className="text-xs text-muted-foreground font-medium">Separation:</span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        clusterMeta.silhouetteScore < 0 ? 'text-muted-foreground bg-muted/30 border-muted' :
                        clusterMeta.silhouetteScore > 0.5 ? 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30' :
                        clusterMeta.silhouetteScore > 0.25 ? 'text-blue-700 bg-blue-500/10 border-blue-500/30' :
                        'text-amber-700 bg-amber-500/10 border-amber-500/30'
                      }`}
                    >
                      {clusterMeta.silhouetteScore < 0 ? 'n/a' : clusterMeta.silhouetteScore > 0.5 ? 'strong' : clusterMeta.silhouetteScore > 0.25 ? 'moderate' : 'weak'}
                    </span>
                  </div>
                </>
              )}

              {clusterMeta.kmerSize > 0 && (
                <>
                  <span className="w-px h-4 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {clusterMeta.kmerSize}-mer {clusterMeta.featureMode === 'hybrid' ? '+ hybrid' : ''} · {clusterMeta.variableLen}bp
                  </span>
                </>
              )}

              {/* Feature space label */}
              {clusterMeta.featureMode && clusterMeta.featureMode !== 'n/a' && (
                <>
                  <span className="w-px h-4 bg-border" />
                  <span className="flex items-center" style={{ gap: 4 }}>
                    <span className="text-[10px] text-muted-foreground">Feature space:</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      clusterMeta.featureMode === 'structure-profile'
                        ? 'text-purple-600 bg-purple-500/10 border border-purple-500/20'
                        : clusterMeta.featureMode === 'hybrid'
                        ? 'text-indigo-600 bg-indigo-500/10 border border-indigo-500/20'
                        : 'text-cyan-600 bg-cyan-500/10 border border-cyan-500/20'
                    }`}>
                      {clusterMeta.featureMode === 'structure-profile' ? 'Structure Profile' :
                       clusterMeta.featureMode === 'hybrid' ? 'k-mer+Structure' : 'k-mer'}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </FadeIn>
      )}

      <SummaryCards data={data} />

      {/* Visualization charts */}
      <FadeIn>
        <div style={{ marginBottom: 'var(--spacing-lg)' }}>
          <p
            className="font-semibold text-muted-foreground"
            style={{ fontSize: 'var(--font-size-small)', marginBottom: 'var(--spacing-sm)' }}
          >
            Visualizations
          </p>
          <ClusterCharts
            data={sorted}
            featureMode={clusterMeta?.featureMode}
            silhouetteScore={clusterMeta?.silhouetteScore}
            quality={clusterMeta?.quality}
            permutation={clusterMeta?.permutation}
            clusterMeta={clusterMeta}
          />
        </div>
      </FadeIn>

      {/* Cluster list */}
      <FadeIn>
        <p
          className="font-semibold text-muted-foreground"
          style={{ fontSize: 'var(--font-size-small)', marginBottom: 'var(--spacing-sm)' }}
        >
          Cluster Details
        </p>
      </FadeIn>

      <CategoryFilters active={filter} onChange={setFilter} data={data} />

      {sorted.length === 0 ? (
        <FadeIn>
          <div
            className="text-center text-muted-foreground rounded-xl border border-dashed border-border"
            style={{ padding: 'var(--spacing-2xl)' }}
          >
            <p className="text-sm">No clusters match this filter.</p>
          </div>
        </FadeIn>
      ) : (
        <Stagger stagger={0.03} className="flex flex-col" style={{ gap: 'var(--spacing-sm)' }}>
          {sorted.map((cluster, idx) => {
            const enrichIdx = clusterMeta?.abundance ? cluster.id - 1 : -1
            const enrichScore = enrichIdx >= 0 && enrichIdx < (clusterMeta?.abundance?.enrichment_scores?.length || 0)
              ? clusterMeta!.abundance!.enrichment_scores[enrichIdx] : undefined
            const enrichPval = enrichIdx >= 0 && enrichIdx < (clusterMeta?.abundance?.enrichment_pvalues?.length || 0)
              ? clusterMeta!.abundance!.enrichment_pvalues[enrichIdx] : undefined
            return (
            <ClusterCard key={cluster.id} cluster={cluster} rank={idx + 1}
              enrichmentScore={enrichScore}
              enrichmentPvalue={enrichPval} />
          )})}
        </Stagger>
      )}
    </div>
  )
}
