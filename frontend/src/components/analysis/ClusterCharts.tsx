import { useMemo, useRef, useCallback, useState } from 'react'
import {
  Legend,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { Image, FileType, Settings2, Camera, FileSpreadsheet } from 'lucide-react'
import { downloadChartPanel, downloadPanelAsPNG } from '@/lib/svg-export'
import { DistanceMatrixChart } from './DistanceMatrixChart'
import { ClusterOverviewBubbleChart } from './ClusterOverviewBubbleChart'
import type { SequenceCluster } from '@/types/analysis'
import { ChartLayout } from '@/config/chartLayout'

interface ClusterChartsProps {
  data: SequenceCluster[]
  featureMode?: string
  silhouetteScore?: number
  quality?: string
  permutation?: {
    p_values: number[]
    significant: boolean[]
    cluster_sizes: number[]
    threshold: number
  }
  clusterMeta?: {
    abundance?: {
      enrichment_scores?: number[]
    }
  } | null
}
// Scientific color palette (oklch-based, printable)
const COLORS = {
  g4pos: 'oklch(0.65 0.22 145)',
  g4neg: 'oklch(0.6 0.03 260)',
  primary: 'oklch(0.55 0.18 260)',
  accent: 'oklch(0.6 0.2 25)',
  mfeStable: 'oklch(0.5 0.15 250)',
  mfeUnstable: 'oklch(0.65 0.18 25)',
  threshold: 'oklch(0.5 0.0 0 / 0.4)',
}

// MFE color interpolation (blue=stable, red=unstable)
function mfeColor(mfe: number): string {
  const normalized = Math.min(Math.max((mfe + 25) / 25, 0), 1) // -25..0 → 0..1
  const h = 250 - normalized * 225 // 250 (blue) → 25 (red)
  const c = 0.15 + (1 - Math.abs(normalized - 0.5) * 2) * 0.05
  return `oklch(0.6 ${c.toFixed(3)} ${h.toFixed(0)})`
}

// G4 pass count
function g4Pass(c: SequenceCluster): number {
  let n = 0
  if (c.cGcC > 4.5) n++
  if ((c.g4Hunter ?? 0) > 0.9) n++
  if ((c.g4NN ?? 0) > 0.5) n++
  return n
}

export function ClusterCharts({ data, featureMode, silhouetteScore, quality, permutation, clusterMeta }: ClusterChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [maxVisibleClusters, setMaxVisibleClusters] = useState(0) // 0 = show all
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)

  // Filter data by global cluster count
  const filteredData = useMemo(() => {
    if (maxVisibleClusters <= 0 || maxVisibleClusters >= data.length) return data
    return data.slice(0, maxVisibleClusters)
  }, [data, maxVisibleClusters])

  const numClusters = data.length

  // Export handlers
  const exportSVG = useCallback(() => {
    if (!chartRef.current) return
    const svgElements = chartRef.current.querySelectorAll('svg.recharts-surface, svg[class*=\"recharts\"]')
    if (svgElements.length === 0) return

    const svgNS = 'http://www.w3.org/2000/svg'
    const exportSvg = document.createElementNS(svgNS, 'svg')
    exportSvg.setAttribute('xmlns', svgNS)
    exportSvg.setAttribute('width', '1200')

    let totalH = 0
    const clones: SVGSVGElement[] = []

    svgElements.forEach((svg) => {
      const clone = svg.cloneNode(true) as SVGSVGElement
      // Attach to DOM visibly so getComputedStyle returns actual rendered values
      clone.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;pointer-events:none;z-index:99999'
      document.body.appendChild(clone)

      // Inline all computed styles
      const allEls = clone.querySelectorAll('*')
      allEls.forEach((el) => {
        const e = el as SVGElement & HTMLElement
        const cs = window.getComputedStyle(e)
        for (const attr of ['fill', 'stroke', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'stroke-width', 'opacity']) {
          const v = cs.getPropertyValue(attr)
          if (v && v !== 'rgba(0, 0, 0, 0)' && !v.includes('var(') && !v.includes('oklch')) {
            e.setAttribute(attr, v)
          }
        }
      })

      document.body.removeChild(clone)
      clone.style.cssText = ''

      const h = parseInt(clone.getAttribute('height') || '400')
      totalH += h + 20
      clones.push(clone)
    })

    exportSvg.setAttribute('height', String(totalH))

    const bg = document.createElementNS(svgNS, 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#ffffff')
    exportSvg.appendChild(bg)

    let yOffset = 0
    clones.forEach((clone) => {
      const g = document.createElementNS(svgNS, 'g')
      g.setAttribute('transform', `translate(0, ${yOffset})`)
      while (clone.firstChild) g.appendChild(clone.firstChild)
      exportSvg.appendChild(g)
      yOffset += parseInt(clone.getAttribute('height') || '400') + 20
    })

    const serializer = new XMLSerializer()
    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(exportSvg)
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cluster_analysis.svg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  if (data.length === 0) return null

  return (
    <div className="border border-border rounded-xl bg-card" style={{ marginBottom: 20 }}>
        {/* Header with export buttons */}
        <div
          className="flex items-center justify-between border-b border-border"
          style={{ padding: '12px 20px' }}
        >
          <h3 className="text-sm font-semibold flex items-center" style={{ gap: 6 }}>
            <Image size={14} className="text-muted-foreground" />
            Cluster Visualization
            <span className="text-xs font-normal text-muted-foreground ml-2">
              Publication-ready figures
            </span>
            {maxVisibleClusters > 0 && maxVisibleClusters < numClusters && (
              <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
                Showing {maxVisibleClusters}/{numClusters} clusters
              </span>
            )}
          </h3>
          <div className="flex items-center" style={{ gap: 6 }}>
            <button
              onClick={() => setShowGlobalSettings(!showGlobalSettings)}
              className={`flex items-center text-xs font-medium rounded-md border transition-colors cursor-pointer ${showGlobalSettings ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted text-muted-foreground'}`}
              style={{ padding: '5px 10px', gap: 4 }}
            >
              <Settings2 size={12} />
              Settings
            </button>
            <button
              onClick={() => downloadPanelAsPNG(chartRef.current, 'cluster_visualization')}
              className="flex items-center text-xs rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary transition-colors cursor-pointer"
              style={{ padding: '4px 8px' }}
              title="Export all charts as PNG"
            >
              <Camera size={13} />
            </button>
          </div>
        </div>

        {/* Settings panel description */}
        {showGlobalSettings && (
          <div className="border-b border-border bg-muted/30" style={{ padding: '12px 20px' }}>
            <div className="flex items-center flex-wrap" style={{ gap: 20 }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Show Clusters</label>
                <input
                  type="range"
                  min={2}
                  max={numClusters}
                  step={1}
                  value={maxVisibleClusters || numClusters}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setMaxVisibleClusters(v >= numClusters ? 0 : v)
                  }}
                  className="w-32 h-2 cursor-pointer accent-primary"
                />
                <span className="text-xs font-mono text-muted-foreground w-14">
                  {maxVisibleClusters <= 0 ? `All (${numClusters})` : `${maxVisibleClusters}/${numClusters}`}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                Applies to all charts (A–D). Heatmap (C) and Distance Matrix are capped at 20 clusters for readability.
              </p>
            </div>
          </div>
        )}

        {/* Charts grid */}
        <div ref={chartRef} style={{ padding: '8px 20px 12px' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2" style={{ columnGap: 10, rowGap: 40, alignItems: 'start' }}>
            <div style={{ alignSelf: 'end' }}>
              <ClusterOverviewBubbleChart data={filteredData} clusterMeta={clusterMeta} compact />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <ClusterSizeChart data={filteredData} />
            </div>
            <div className="lg:row-span-2">
              <HeatmapChart data={filteredData} />
            </div>
            <MFEDistributionChart data={filteredData} />
            <div style={{ marginTop: 10 }}>
              <BubbleChart data={filteredData} />
            </div>
            <DistanceMatrixChart data={filteredData} />
          </div>
        </div>
      </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   1. Bubble Chart — Enrichment Fold vs G4NN Score
   ═══════════════════════════════════════════════════════════════════ */

type YMetric = 'g4nn' | 'g4hunter' | 'cgcc' | 'mfe'

const Y_METRIC_OPTIONS: { value: YMetric; label: string }[] = [
  { value: 'g4nn', label: 'G4NN Score' },
  { value: 'g4hunter', label: 'G4Hunter Score' },
  { value: 'cgcc', label: 'cGcC Score' },
  { value: 'mfe', label: '-MFE (Stability)' },
]

function BubbleChart({ data }: { data: SequenceCluster[] }) {
  // Determine if enrichment fold data is available (multi-round analysis)
  const hasEnrichment = useMemo(() => data.some((c) => c.avgEnrichmentFold > 0), [data])

  // Determine best default y-axis metric: prefer G4NN if available, fallback to cGcC
  const defaultMetric = useMemo<YMetric>(() => {
    const hasG4NN = data.some((c) => (c.g4NN ?? 0) > 0)
    if (hasG4NN) return 'g4nn'
    const hasCGcC = data.some((c) => c.cGcC > 0)
    if (hasCGcC) return 'cgcc'
    return 'mfe'
  }, [data])

  const [selectedMetric, setSelectedMetric] = useState<YMetric | null>(null)
  const yAxisMetric = selectedMetric ?? defaultMetric

  const chartData = useMemo(() => {
    return data.map((c, i) => {
      let xVal: number
      if (hasEnrichment) {
        let fold = c.avgEnrichmentFold
        if (fold === Infinity || fold > 1e10) fold = 100
        if (!fold || fold <= 0) fold = 0.1
        xVal = Math.log10(fold + 1)
      } else {
        // Single-round: use read percentage as x-axis
        xVal = c.avgMaxPercentRead
      }

      let yVal: number
      if (yAxisMetric === 'g4nn') {
        yVal = c.g4NN ?? 0
      } else if (yAxisMetric === 'g4hunter') {
        yVal = c.g4Hunter ?? 0
      } else if (yAxisMetric === 'cgcc') {
        yVal = c.cGcC
      } else {
        yVal = -(c.rnaFold?.mfe ?? 0) // Negate so higher = more stable
      }

      return {
        x: xVal,
        y: yVal,
        z: Math.max(c.size, 1),
        mfe: c.rnaFold?.mfe ?? 0,
        rank: i + 1,
        name: `#${i + 1}`,
        fold: c.avgEnrichmentFold,
        percentRead: c.avgMaxPercentRead,
        g4nn: c.g4NN ?? 0,
        g4hunter: c.g4Hunter ?? 0,
        cgcc: c.cGcC,
        size: c.size,
        fill: mfeColor(c.rnaFold?.mfe ?? 0),
      }
    })
  }, [data, hasEnrichment, yAxisMetric])

  const xLabel = hasEnrichment ? 'log₁₀(Enrichment Fold + 1)' : 'Avg Max Read%'
  const xName = hasEnrichment ? 'Enrichment (log₁₀)' : 'Read %'

  const yLabel = yAxisMetric === 'g4nn' ? 'G4NN Score' : yAxisMetric === 'g4hunter' ? 'G4Hunter Score' : yAxisMetric === 'cgcc' ? 'cGcC Score' : '-MFE (kcal/mol)'
  const yDomain: [number, number] | undefined = yAxisMetric === 'g4nn' ? [0, 1] : yAxisMetric === 'g4hunter' ? [0, 2] : undefined
  const yRefLine = yAxisMetric === 'g4nn' ? 0.5 : yAxisMetric === 'g4hunter' ? 0.9 : yAxisMetric === 'cgcc' ? 4.5 : 10
  const yRefLabel = yAxisMetric === 'g4nn' ? 'G4NN=0.5' : yAxisMetric === 'g4hunter' ? 'G4Hunter=0.9' : yAxisMetric === 'cgcc' ? 'cGcC=4.5' : '-MFE=10'

  const titleY = yAxisMetric === 'g4nn' ? 'G4NN Score' : yAxisMetric === 'g4hunter' ? 'G4Hunter Score' : yAxisMetric === 'cgcc' ? 'cGcC Score' : 'Stability (-MFE)'

  return (
    <div id="panel-e-results" className="chart-panel">
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold">
            E. {hasEnrichment ? `Enrichment Fold vs ${titleY}` : `Read Abundance vs ${titleY}`}
          </p>
          <select
            value={yAxisMetric}
            onChange={(e) => setSelectedMetric(e.target.value as YMetric)}
            className="text-xs border border-border rounded px-2 py-0.5 bg-background text-foreground cursor-pointer hover:border-primary/50 transition-colors"
          >
            {Y_METRIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button onClick={() => downloadPanelAsPNG(document.getElementById('panel-e-results'), 'E_bubble')} className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Save as PNG" style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Download CSV" style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '8px 20px 12px' }}>
        <div style={{ width: 650, maxWidth: '100%', aspectRatio: '3/2', position: 'relative', margin: '0 auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={ChartLayout.enrichmentBubble.margin}>
                        <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              domain={[0.01, 0.05]}
              ticks={[0.01, 0.02, 0.03, 0.04, 0.05]}
              tick={{ fontSize: 14, fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{ value: xLabel, position: 'bottom', offset: 12, style: { fontSize: 16, fontWeight: 600, fill: '#000', fontFamily: 'system-ui, sans-serif' } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              tick={{ fontSize: 14, fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{
                content: ({ viewBox }: any) => {
                  const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 };
                  return (
                    <text x={x - ChartLayout.enrichmentBubble.yLabelDx} y={y + height / 2} textAnchor="middle"
                      transform={`rotate(-90, ${x - ChartLayout.enrichmentBubble.yLabelDx}, ${y + height / 2})`}
                      fontSize={16} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                      {yLabel}
                    </text>
                  );
                },
              }}
              domain={yAxisMetric === 'g4nn' ? [0, 1.0] as [number, number] : yAxisMetric === 'g4hunter' ? [0, 1.0] as [number, number] : yAxisMetric === 'cgcc' ? [0, 8] as [number, number] : undefined}
              ticks={yAxisMetric === 'g4nn' ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : yAxisMetric === 'g4hunter' ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : yAxisMetric === 'cgcc' ? [0, 2, 4, 6, 8] : undefined}
            />
            <ZAxis type="number" dataKey="z" range={[40, 400]} name="Members" />
            <ReferenceLine y={yRefLine} stroke={COLORS.threshold} strokeDasharray="4 4" label={{ value: yRefLabel, position: 'right', style: { fontSize: 14, fontWeight: 600, fill: '#000' } }} />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null
                const d = payload[0].payload
                return (
                  <div className="bg-background border border-border rounded-lg shadow-md" style={{ padding: '8px 12px', fontSize: 11 }}>
                    <p className="font-semibold">Cluster {d.name}</p>
                    {hasEnrichment
                      ? <p>Enrichment: {d.fold === Infinity ? '∞' : (d.fold?.toFixed(1) ?? '--')}x</p>
                      : <p>Read%: {d.percentRead?.toFixed(4)}%</p>
                    }
                    <p>G4NN: {d.g4nn.toFixed(4)}</p>
                    <p>G4Hunter: {d.g4hunter.toFixed(3)}</p>
                    <p>cGcC: {d.cgcc.toFixed(2)}</p>
                    <p>Members: {d.size}</p>
                    <p>MFE: {d.mfe} kcal/mol</p>
                  </div>
                )
              }}
            />
            <Scatter data={chartData} isAnimationActive={false}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.fill} fillOpacity={0.75} stroke={entry.fill} strokeWidth={1} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        {/* Legend — HTML floating overlay */}
        <div data-legend="panel-e-results" style={{ position: 'absolute', top: 8, right: 12, display: 'flex', flexWrap: 'wrap', gap: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 8px', pointerEvents: 'none' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'oklch(0.6 0.2 250)', display: 'inline-block' }} />Stable
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'oklch(0.6 0.15 140)', display: 'inline-block' }} />Mid
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'oklch(0.6 0.2 25)', display: 'inline-block' }} />Unstable
          </span>
        </div>
      </div>
      </div>
      {/* Caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>E.</strong> Bubble chart showing read abundance vs selected metric. Bubble area ∝ cluster size. MFE color: blue (stable, −25 kcal/mol) → red (unstable, 0 kcal/mol).
        </p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   2. Bar Chart — Cluster Size Distribution
   ═══════════════════════════════════════════════════════════════════ */

function ClusterSizeChart({ data }: { data: SequenceCluster[] }) {
  // G4 risk colors matching Evaluation tab
  const G4_RISK_COLORS: Record<string, string> = {
    High: 'oklch(0.55 0.20 15)',
    Medium: 'oklch(0.65 0.18 85)',
    Low: 'oklch(0.55 0.18 145)',
  }

  function g4RiskLevel(c: SequenceCluster): string {
    const n = g4Pass(c)
    if (n >= 2) return 'High'
    if (n === 1) return 'Medium'
    return 'Low'
  }

  const chartData = useMemo(() => {
    return data.map((c, i) => ({
      rank: `#${i + 1}`,
      size: c.size,
      risk: g4RiskLevel(c),
      fold: c.avgEnrichmentFold === Infinity ? 100 : (c.avgEnrichmentFold ?? 0),
    }))
  }, [data])

  return (
    <div id="panel-b-results" className="chart-panel">
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <p className="text-sm font-semibold">B. Cluster Size Distribution</p>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button onClick={() => downloadPanelAsPNG(document.getElementById('panel-b-results'), 'B_cluster_size')} className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Save as PNG" style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Download CSV" style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '8px 20px 12px' }}>
        <div style={{ width: 650, maxWidth: '100%', aspectRatio: '3/2', position: 'relative', margin: '0 auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={ChartLayout.clusterSize.margin}>
                        <XAxis
              dataKey="rank"
              tick={{ fontSize: 14, fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              interval={4}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{ value: 'Cluster Rank', position: 'insideBottom', offset: -10, style: { fontSize: 16, fontWeight: 600, fill: '#000', fontFamily: 'system-ui, sans-serif' } }}
            />
            <YAxis
              tick={{ fontSize: 14, fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{
                content: ({ viewBox }: any) => {
                  const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 };
                  return (
                    <text x={x - ChartLayout.clusterSize.yLabelDx} y={y + height / 2} textAnchor="middle"
                      transform={`rotate(-90, ${x - ChartLayout.clusterSize.yLabelDx}, ${y + height / 2})`}
                      fontSize={16} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                      Member Count
                    </text>
                  );
                },
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              formatter={(value: number, name: string) => [value, name === 'size' ? 'Members' : name]}
            />
            <Bar dataKey="size" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={G4_RISK_COLORS[entry.risk] || COLORS.g4neg} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {/* Legend — HTML floating overlay */}
        <div data-legend="panel-b-results" style={{ position: 'absolute', top: 8, right: 12, display: 'flex', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 8px', pointerEvents: 'none' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: G4_RISK_COLORS.High, display: 'inline-block' }} />High G4
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: G4_RISK_COLORS.Medium, display: 'inline-block' }} />Medium G4
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: G4_RISK_COLORS.Low, display: 'inline-block' }} />Low G4
          </span>
        </div>
      </div>
      </div>
      {/* Caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>B.</strong> Cluster size distribution by G4 risk level. Colors represent composite G4 risk (cGcC&gt;4.5, G4Hunter&gt;0.9, G4NN&gt;0.5). High G4 = 2–3 criteria met; Medium = 1; Low = 0.
        </p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   3. Heatmap — Multi-Score Comparison
   ═══════════════════════════════════════════════════════════════════ */

function HeatmapChart({ data }: { data: SequenceCluster[] }) {
  const metrics = ['cGcC', 'G4Hunter', 'G4NN', 'MFE'] as const
  const thresholds = [4.5, 0.9, 0.5, -10] // MFE threshold: stable if <= -10

  const topClusters = data.slice(0, Math.min(20, data.length))

  // Normalize values for color mapping
  const normalized = useMemo(() => {
    return topClusters.map((c) => {
      const vals = [
        c.cGcC,
        c.g4Hunter ?? 0,
        c.g4NN ?? 0,
        -(c.rnaFold?.mfe ?? 0), // Negate so higher = more stable
      ]
      // Normalize to 0-1 based on typical ranges
      return [
        Math.min(vals[0] / 20, 1), // cGcC: 0-20 range
        Math.min(Math.abs(vals[1]) / 2, 1), // G4H: 0-2 range
        vals[2], // G4NN: already 0-1
        Math.min(vals[3] / 25, 1), // MFE: 0-25 range (negated)
      ]
    })
  }, [topClusters])

  // Color mapping (0=white, 1=deep blue)
  function cellColor(value: number): string {
    const l = 0.95 - value * 0.45
    const c = value * 0.18
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 260)`
  }

  const cellSize = 42
  const labelWidth = 40
  const headerHeight = 105

  return (
    <div id="panel-c-results" className="chart-panel">
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <p className="text-sm font-semibold">
          C. Multi-Score Heatmap
        </p>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button onClick={() => downloadPanelAsPNG(document.getElementById('panel-c-results'), 'C_heatmap')} className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Save as PNG" style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Download CSV" style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" style={{ marginBottom: 6 }}>
        Intensity indicates relative score magnitude; darker = higher
      </p>
      <div className="overflow-x-auto">
        <svg
          className="recharts-surface"
          width={labelWidth + metrics.length * cellSize + 80}
          height={headerHeight + topClusters.length * cellSize + 10}
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* Column headers — name + threshold combined, -45°, positioned above-right of cells */}
          {metrics.map((m, col) => {
            const cx = labelWidth + col * cellSize + cellSize / 2
            const cy = headerHeight - 8
            const label = col === 3 ? `${m} \u2264-10` : `${m} >${thresholds[col]}`
            return (
              <text
                key={m}
                x={cx}
                y={cy}
                textAnchor="start"
                transform={`rotate(-45, ${cx}, ${cy})`}
                style={{ fontSize: 12, fill: '#000', fontWeight: 600 }}
              >
                {label}
              </text>
            )
          })}

          {/* Rows */}
          {topClusters.map((cluster, row) => (
            <g key={row}>
              {/* Row label — show both rank and cluster ID */}
              <text
                x={labelWidth - 6}
                y={headerHeight + row * cellSize + cellSize / 2 + 3}
                textAnchor="end"
                style={{ fontSize: 13, fill: 'var(--foreground)', fontWeight: 600 }}
              >
                #{row + 1}
              </text>

              {/* Cells */}
              {normalized[row].map((val, col) => {
                const rawVals = [
                  cluster.cGcC,
                  cluster.g4Hunter ?? 0,
                  cluster.g4NN ?? 0,
                  cluster.rnaFold?.mfe ?? 0,
                ]
                const passesThreshold = col === 3
                  ? rawVals[col] <= thresholds[col]
                  : rawVals[col] > thresholds[col]

                return (
                  <g key={col}>
                    <rect
                      x={labelWidth + col * cellSize + 1}
                      y={headerHeight + row * cellSize + 1}
                      width={cellSize - 2}
                      height={cellSize - 2}
                      rx={4}
                      fill={cellColor(val)}
                      stroke={passesThreshold ? 'oklch(0.55 0.18 160)' : 'var(--border)'}
                      strokeWidth={passesThreshold ? 1.5 : 0.5}
                    />
                    <text
                      x={labelWidth + col * cellSize + cellSize / 2}
                      y={headerHeight + row * cellSize + cellSize / 2 + 4}
                      textAnchor="middle"
                      style={{ fontSize: 10, fill: val > 0.6 ? 'white' : 'var(--foreground)' }}
                    >
                      {col === 3 ? rawVals[col].toFixed(1) : rawVals[col].toFixed(2)}
                    </text>
                  </g>
                )
              })}
            </g>
          ))}

          {/* Color legend — vertical gradient: dark (high) at top, light (low) at bottom */}
          <defs>
            <linearGradient id="heatmapGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cellColor(1)} />
              <stop offset="50%" stopColor={cellColor(0.5)} />
              <stop offset="100%" stopColor={cellColor(0)} />
            </linearGradient>
          </defs>
          <rect
            x={labelWidth + metrics.length * cellSize + 15}
            y={headerHeight}
            width={12}
            height={topClusters.length * cellSize}
            fill="url(#heatmapGrad)"
            rx={3}
          />
          <text
            x={labelWidth + metrics.length * cellSize + 35}
            y={headerHeight + 8}
            style={{ fontSize: 12, fontWeight: 600, fill: 'var(--muted-foreground)' }}
          >
            High
          </text>
          <text
            x={labelWidth + metrics.length * cellSize + 35}
            y={headerHeight + topClusters.length * cellSize}
            style={{ fontSize: 12, fontWeight: 600, fill: 'var(--muted-foreground)' }}
          >
            Low
          </text>
        </svg>
      </div>
      {/* Caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>C.</strong> Multi-score heatmap comparing cGcC, G4Hunter, and G4NN scores across cluster representatives. Higher values = stronger G4 potential. G4 risk: High (2–3 criteria) · Medium (1) · Low (0).
        </p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   4. MFE Distribution — With vs Without G4
   ═══════════════════════════════════════════════════════════════════ */

function MFEDistributionChart({ data }: { data: SequenceCluster[] }) {
  const chartData = useMemo(() => {
    return data
      .filter((c) => c.rnaFold && c.rnaFoldNoG4)
      .map((c, i) => ({
        rank: `#${i + 1}`,
        withG4: c.rnaFold!.mfe,
        withoutG4: c.rnaFoldNoG4!.mfe,
        diff: (c.rnaFold!.mfe - c.rnaFoldNoG4!.mfe),
      }))
  }, [data])

  if (chartData.length === 0) {
    return (
      <div>
        <p className="text-sm font-semibold" style={{ marginBottom: 8 }}>
          D. MFE Comparison: G4 Enabled vs Disabled
        </p>
        <p className="text-xs text-muted-foreground italic">No RNA fold data available.</p>
      </div>
    )
  }

  return (
    <div id="panel-d-results" className="chart-panel">
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <p className="text-sm font-semibold">
          D. MFE Comparison: G4 Enabled vs Disabled
        </p>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button onClick={() => downloadPanelAsPNG(document.getElementById('panel-d-results'), 'D_MFE')} className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Save as PNG" style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Download CSV" style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '8px 20px 12px' }}>
        <div style={{ width: 650, maxWidth: '100%', aspectRatio: '3/2', position: 'relative', margin: '0 auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={ChartLayout.mfeDistribution.margin}>
                        <XAxis
              dataKey="rank"
              // @ts-expect-error angle is supported by recharts but not in type defs
              tick={{ fontSize: 14, angle: -30, textAnchor: 'end', fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{ value: 'Cluster Rank', position: 'bottom', offset: 20, style: { fontSize: 16, fontWeight: 600, fill: '#000', fontFamily: 'system-ui, sans-serif' } }}
            />
            <YAxis
              tick={{ fontSize: 14, fill: '#000', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
              axisLine={{ strokeWidth: 1, stroke: '#000' }}
              tickLine={{ stroke: '#000' }}
              label={{
                content: ({ viewBox }: any) => {
                  const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 };
                  return (
                    <text x={x - ChartLayout.mfeDistribution.yLabelDx} y={y + height / 2} textAnchor="middle"
                      transform={`rotate(-90, ${x - ChartLayout.mfeDistribution.yLabelDx}, ${y + height / 2})`}
                      fontSize={16} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                      -MFE (kcal/mol)
                    </text>
                  );
                },
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              formatter={(value: number, name: string) => [
                `${value.toFixed(2)} kcal/mol`,
                name === 'withG4' ? 'With G4' : 'Without G4',
              ]}
            />
            <Bar dataKey="withG4" fill={COLORS.mfeStable} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="withoutG4" fill={COLORS.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        {/* Legend — HTML floating overlay */}
        <div data-legend="panel-d-results" style={{ position: 'absolute', top: 238, right: 12, display: 'flex', flexWrap: 'wrap', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 8px', pointerEvents: 'none' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: COLORS.mfeStable, display: 'inline-block' }} />With G4
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#000' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: COLORS.accent, display: 'inline-block' }} />Without G4
          </span>
        </div>
      </div>
      </div>
      {/* Caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>D.</strong> MFE comparison of cluster representatives with G4 enabled vs disabled. More negative ΔG = more thermodynamically stable secondary structure.
        </p>
      </div>
    </div>
  )
}