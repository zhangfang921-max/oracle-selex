import { useState, useMemo, useEffect } from 'react'
import { Camera, FileSpreadsheet, Activity, FlaskConical } from 'lucide-react'
import { downloadChartPanel } from '@/lib/svg-export'
import { getClusterColor } from '@/lib/cluster-colors'
import type { SequenceCluster } from '@/types/analysis'

interface PermutationData {
  p_values: number[]
  significant: boolean[]
  cluster_sizes: number[]
  threshold: number
}

interface ClusterEvalFigureProps {
  data: SequenceCluster[]
  silhouetteScore: number
  quality: string
  permutation?: PermutationData
  maxVisibleClusters?: number
  featureMode?: string
}

function qualityColor(level: string): string {
  if (level === 'strong') return 'oklch(0.65 0.18 155)'
  if (level === 'moderate') return 'oklch(0.55 0.18 260)'
  return 'oklch(0.6 0.18 25)'
}

export function ClusterEvaluationFigure({
  data,
  silhouetteScore,
  quality,
  permutation,
  featureMode,
  maxVisibleClusters: extMax,
}: ClusterEvalFigureProps) {
  const maxVisibleClusters = extMax ?? 0
  const fm = featureMode || 'kmer'

  // Per-cluster silhouette from permutation
  const perClusterSil = useMemo(() => {
    if (!permutation) return null
    return permutation.p_values.map((_, i) => ({
      cid: i + 1,
      pValue: permutation.p_values[i],
      significant: permutation.significant[i],
      size: permutation.cluster_sizes[i] || 0,
      avgScore: 0,
    }))
  }, [permutation])

  // Fetch per-cluster silhouette scores (including per-point data)
  const [silData, setSilData] = useState<{ avg: Record<number, number>; scores: Record<number, number[]> }>({ avg: {}, scores: {} })
  useEffect(() => {
    if (data.length < 2) return
    const seqs: string[] = []
    const cids: number[] = []
    data.forEach((c) => {
      c.members.forEach((m) => { seqs.push(m.sequence); cids.push(c.id) })
      if (c.members.length === 0) { seqs.push(c.representative); cids.push(c.id) }
    })
    fetch('/api/analysis/silhouette', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequences: seqs, clusterIds: cids, ...(fm ? { featureMode: fm } : {}) }),
    })
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data) {
          const avg: Record<number, number> = {}
          const scores: Record<number, number[]> = {}
          res.data.forEach((d: any) => { avg[d.clusterId] = d.avgScore; scores[d.clusterId] = d.scores || [] })
          setSilData({ avg, scores })
        }
      })
      .catch(() => {})
  }, [data])

  // Merge + filter by maxVisibleClusters
  const perClusterSilWithScore = useMemo(() => {
    if (!perClusterSil) return null
    let items = perClusterSil.map(item => ({
      ...item,
      avgScore: silData.avg[item.cid] ?? 0,
    }))
    if (maxVisibleClusters > 0 && maxVisibleClusters < items.length) {
      items = items.slice(0, maxVisibleClusters)
    }
    return items
  }, [perClusterSil, silData, maxVisibleClusters])

  const sigCount = permutation ? permutation.significant.filter(Boolean).length : 0

  const exportSVG = () => {
    const el = document.getElementById('cluster-eval-figure')
    if (el) downloadChartPanel(el, 'cluster_evaluation_figure.svg')
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden" style={{ marginBottom: 16 }}>
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '6px 20px' }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <Activity size={14} className="text-primary" />
          <span className="text-sm font-semibold">Per-Cluster Diagnostics</span>
          <span className="text-xs font-medium rounded-full px-2 py-0.5"
            style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
            {fm === 'structure-profile' ? 'Structure-based' : 'K-mer based'}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button title="Save as SVG" onClick={exportSVG}
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button title="Download CSV"
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>

      <div id="cluster-eval-figure" style={{ padding: '8px 20px 12px' }}>
{/* Quality summary removed — scores shown in summary cards above */}

        {/* Panels (a) and (b) — side by side */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {/* Panel (a): Per-cluster permutation significance — horizontal bars */}
        {perClusterSilWithScore && (
          <div className="border border-border rounded-lg overflow-hidden" style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div className="border-b border-border bg-muted/20" style={{ padding: '8px 14px' }}>
              <span className="text-xs font-semibold">
                D. Permutation Significance · p&lt;{permutation?.threshold || 0.05}
              </span>
            </div>
            <div style={{ padding: '4px 16px 12px' }}>
              <svg className="recharts-surface" width="100%" height={Math.max(80, perClusterSilWithScore.length * 26 + 50)} viewBox={`0 0 620 ${Math.max(80, perClusterSilWithScore.length * 26 + 50)}`} style={{ maxWidth: 620 }}>
                <text x={310} y={perClusterSilWithScore.length * 26 + 38} textAnchor="middle" style={{ fontSize: 16, fill: '#1a1a1a', fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
                  p-values per cluster (green = significant @ p&lt;{permutation?.threshold || 0.05})
                </text>
                <line x1={52} y1={16} x2={52} y2={perClusterSilWithScore.length * 26 + 8} stroke="var(--border)" strokeWidth={0.8} />
                <line x1={52} y1={16} x2={568} y2={16} stroke="var(--border)" strokeWidth={0.8} />
                {/* Reference line at p=threshold */}
                {permutation && (
                  <>
                    <line x1={52} y1={16} x2={52} y2={perClusterSilWithScore.length * 26 + 12}
                      stroke="oklch(0.68 0.20 75)" strokeDasharray="4 4" strokeWidth={0.8} />
                    <text x={54} y={perClusterSilWithScore.length * 26 + 26} style={{ fontSize: 16, fill: 'oklch(0.68 0.20 75)' }}>
                      p={permutation.threshold}
                    </text>
                  </>
                )}
                {perClusterSilWithScore.map((item, i) => {
                  const barW = Math.max(4, (1 - item.pValue) * 500)
                  const color = item.significant ? 'oklch(0.65 0.18 155)' : 'oklch(0.50 0.06 45)'
                  const y = 24 + i * 26
                  return (
                    <g key={`perm-${item.cid}`}>
                      <text x={8} y={y + 13} style={{ fontSize: 16, fill: '#1a1a1a', fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
                        #{item.cid}
                      </text>
                      <rect x={52} y={y} width={barW} height={20} rx={3} fill={color} fillOpacity={0.75} />
                      <text x={Math.min(52 + barW, 560) + 6} y={y + 14}
                        style={{ fontSize: 16, fill: color, fontWeight: item.significant ? 700 : 400 }}>
                        p={item.pValue < 0.001 ? '<0.001' : item.pValue.toFixed(3)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Panel (b): Classic Silhouette Plot — per-point bars */}
        {perClusterSilWithScore && (() => {
          const allScores: { cid: number; score: number }[] = []
          perClusterSilWithScore.forEach(item => {
            const scores = silData.scores[item.cid]
            if (scores && scores.length > 0) {
              scores.forEach(s => allScores.push({ cid: item.cid, score: s }))
            }
          })
          if (allScores.length === 0) return null
          const barH = 3; const gap = 1; const clusterGap = 8
          const xMin = -0.2; const xMax = 1.0
          const plotW = 520; const ml = 56; const mr = 40
          const xScale = (v: number) => ml + ((v - xMin) / (xMax - xMin)) * plotW
          const globalAvg = allScores.reduce((s, x) => s + x.score, 0) / allScores.length
          // Sort by cluster, then by score descending within cluster
          allScores.sort((a, b) => a.cid - b.cid || b.score - a.score)
          // Build row positions
          const rows: { cid: number; score: number; y: number; isFirst: boolean; isLast: boolean }[] = []
          let y = 20; let prevCid = -1
          allScores.forEach((s, i) => {
            const isFirst = s.cid !== prevCid
            if (isFirst && i > 0) y += clusterGap
            rows.push({ ...s, y, isFirst, isLast: false })
            y += barH + gap
            prevCid = s.cid
          })
          rows[rows.length-1].isLast = true
          const totalH = y + 30
          return (
            <div className="border border-border rounded-lg overflow-hidden" style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div className="border-b border-border bg-muted/20" style={{ padding: '8px 14px' }}>
                <span className="text-xs font-semibold">E. Silhouette — per-point cluster fit</span>
                <span className="text-[10px] text-muted-foreground ml-2">· each bar = one sequence · sorted by fit within cluster · avg={globalAvg.toFixed(3)}</span>
              </div>
              <div style={{ padding: '4px 16px 12px' }}>
                <svg className="recharts-surface" width="100%" height={totalH} viewBox={`0 0 620 ${totalH}`} style={{ maxWidth: 620 }}>
                  {/* Reference: 0 */}
                  <line x1={xScale(0)} y1={8} x2={xScale(0)} y2={totalH - 22} stroke="var(--border)" strokeWidth={1} />
                  {/* Reference: global average */}
                  <line x1={xScale(globalAvg)} y1={8} x2={xScale(globalAvg)} y2={totalH - 22}
                    stroke="oklch(0.5 0.2 25)" strokeWidth={1.2} strokeDasharray="6 4" />
                  <text x={xScale(globalAvg)} y={totalH - 6} textAnchor="middle" style={{ fontSize: 16, fill: 'oklch(0.5 0.2 25)', fontWeight: 600 }}>
                    avg={globalAvg.toFixed(3)}
                  </text>
                  {/* Threshold annotations */}
                  {[0.25, 0.5].map(t => (
                    <text key={`ann-${t}`} x={xScale(t)} y={14} textAnchor="middle" style={{ fontSize: 16, fill: '#1a1a1a', fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
                      {t === 0.5 ? 'strong' : 'mod'}
                    </text>
                  ))}
                  {rows.map((row, i) => {
                    const barW = Math.max(1, Math.abs((row.score - 0) / (xMax - xMin)) * plotW)
                    const x = row.score >= 0 ? xScale(0) : xScale(row.score)
                    const color = row.score >= 0.5 ? 'oklch(0.65 0.18 155)' : row.score >= 0.25 ? 'oklch(0.55 0.18 260)' : row.score >= 0 ? 'oklch(0.6 0.18 25)' : 'oklch(0.55 0.22 10)'
                    const avg = silData.avg[row.cid] ?? 0
                    return (
                      <g key={`sil-${i}`}>
                        {row.isFirst && (
                          <text x={ml - 4} y={row.y + barH + 3} textAnchor="end" style={{ fontSize: 16, fill: '#1a1a1a', fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
                            #{row.cid}
                          </text>
                        )}
                        <rect x={x} y={row.y} width={barW} height={barH} rx={1} fill={color} fillOpacity={0.7} />
                        {/* Cluster avg marker */}
                        {row.isLast && (
                          <line x1={xScale(avg)} y1={row.y - 2} x2={xScale(avg)} y2={row.y + barH + 2}
                            stroke="var(--foreground)" strokeWidth={0.8} opacity={0.4} />
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>
          )
        })()}
        </div>{/* end flex row for (a)+(b) */}
      </div>

      {/* Figure caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 12 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          (D) Per-cluster diagnostics: permutation significance and silhouette analysis.
        </p>
        <p className="text-xs text-muted-foreground" style={{ lineHeight: 1.7 }}>
          Left: permutation test p-values per cluster (1,000 random reassignments). Green = significant at p&lt;{permutation?.threshold || 0.05}, gray = not significant. Right: per-point silhouette scores — each bar = one sequence, sorted by fit within cluster. Bar color: green ≥ 0.5, blue ≥ 0.25, amber &lt; 0.25. Feature space: {fm === 'structure-profile' ? 'structure-profile' : fm === 'kmer' ? 'k-mer cosine' : fm}. First application of permutation-test-validated clustering to SELEX NGS data.
        </p>
      </div>
    </div>
  )
}