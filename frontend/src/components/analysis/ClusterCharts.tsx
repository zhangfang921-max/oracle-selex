import { useMemo, useRef, useCallback, useState } from 'react'
import {
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
  Legend,
  ReferenceLine,
} from 'recharts'
import { Download, Image, FileType, Settings2 } from 'lucide-react'
import { exportElementAsPNG } from '@/lib/export-png'
import { TSNEChart } from './TSNEChart'
import { SilhouetteChart } from './SilhouetteChart'
import { DistanceMatrixChart } from './DistanceMatrixChart'
import type { SequenceCluster } from '@/types/analysis'

interface ClusterChartsProps {
  data: SequenceCluster[]
}

// Scientific color palette (oklch-based, printable)
const COLORS = {
  g4pos: 'oklch(0.65 0.18 160)',
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

export function ClusterCharts({ data }: ClusterChartsProps) {
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
    const svgElements = chartRef.current.querySelectorAll('svg.recharts-surface')
    if (svgElements.length === 0) return

    // Combine all charts into a single SVG for export
    const container = chartRef.current.cloneNode(true) as HTMLElement
    container.style.background = 'white'
    container.style.padding = '20px'

    const svgNS = 'http://www.w3.org/2000/svg'
    const exportSvg = document.createElementNS(svgNS, 'svg')
    exportSvg.setAttribute('xmlns', svgNS)
    exportSvg.setAttribute('width', '1200')
    exportSvg.setAttribute('height', '1600')
    exportSvg.setAttribute('viewBox', '0 0 1200 1600')

    // Add white background
    const bg = document.createElementNS(svgNS, 'rect')
    bg.setAttribute('width', '1200')
    bg.setAttribute('height', '1600')
    bg.setAttribute('fill', 'white')
    exportSvg.appendChild(bg)

    let yOffset = 0
    svgElements.forEach((svg) => {
      const clone = svg.cloneNode(true) as SVGElement
      const g = document.createElementNS(svgNS, 'g')
      g.setAttribute('transform', `translate(0, ${yOffset})`)
      g.appendChild(clone)
      exportSvg.appendChild(g)
      yOffset += parseInt(svg.getAttribute('height') || '400') + 20
    })

    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(exportSvg)
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cluster_analysis.svg'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const exportPNG = useCallback(async () => {
    if (!chartRef.current) return
    await exportElementAsPNG(chartRef.current, 'cluster_analysis_300dpi.png')
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
              onClick={exportSVG}
              className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
              style={{ padding: '5px 10px', gap: 4 }}
            >
              <FileType size={12} />
              SVG
            </button>
            <button
              onClick={exportPNG}
              className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
              style={{ padding: '5px 10px', gap: 4 }}
            >
              <Download size={12} />
              PNG (300dpi)
            </button>
          </div>
        </div>

        {/* Global settings panel */}
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
                Applies to all charts below (t-SNE, Bubble, Heatmap, MFE, Silhouette, Distance Matrix)
              </p>
            </div>
          </div>
        )}

        {/* Charts grid */}
        <div ref={chartRef} style={{ padding: '16px 20px' }}>
          {/* t-SNE — primary dimensionality reduction map */}
          <div style={{ marginBottom: 20 }}>
            <TSNEChart data={filteredData} maxVisibleClusters={maxVisibleClusters} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 20 }}>
            <BubbleChart data={filteredData} />
            <ClusterSizeChart data={filteredData} />
            <HeatmapChart data={filteredData} />
            <MFEDistributionChart data={filteredData} />
            <SilhouetteChart data={filteredData} />
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
    return data.slice(0, 30).map((c, i) => {
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
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
        <p className="text-sm font-semibold text-muted-foreground">
          A. {hasEnrichment ? `Enrichment Fold vs ${titleY}` : `Read Abundance vs ${titleY}`}
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
      <p className="text-[10px] text-muted-foreground" style={{ marginBottom: 6 }}>
        Bubble size = cluster members; Color = MFE (blue = stable, red = unstable)
      </p>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              name={xName}
              tick={{ fontSize: 12 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: xLabel, position: 'bottom', offset: 16, style: { fontSize: 13, fontWeight: 600 } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              tick={{ fontSize: 12 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -10, style: { fontSize: 13, fontWeight: 600 } }}
              domain={yDomain}
            />
            <ZAxis type="number" dataKey="z" range={[40, 400]} name="Members" />
            <ReferenceLine y={yRefLine} stroke={COLORS.threshold} strokeDasharray="4 4" label={{ value: yRefLabel, position: 'right', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
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
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   2. Bar Chart — Cluster Size Distribution
   ═══════════════════════════════════════════════════════════════════ */

function ClusterSizeChart({ data }: { data: SequenceCluster[] }) {
  const chartData = useMemo(() => {
    return data.slice(0, 20).map((c, i) => ({
      rank: `#${i + 1}`,
      size: c.size,
      isG4: g4Pass(c) >= 2,
      fold: c.avgEnrichmentFold === Infinity ? 100 : (c.avgEnrichmentFold ?? 0),
    }))
  }, [data])

  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground" style={{ marginBottom: 8 }}>
        B. Cluster Size Distribution (Top 20)
      </p>
      <p className="text-[10px] text-muted-foreground" style={{ marginBottom: 6 }}>
        Green = G4 positive (≥2/3 thresholds passed)
      </p>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="rank"
              tick={{ fontSize: 11 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: 'Cluster Rank', position: 'bottom', offset: 16, style: { fontSize: 13, fontWeight: 600 } }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: 'Member Count', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 13, fontWeight: 600 } }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              formatter={(value: number, name: string) => [value, name === 'size' ? 'Members' : name]}
            />
            <Bar dataKey="size" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.isG4 ? COLORS.g4pos : COLORS.g4neg} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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

  const topClusters = data.slice(0, 15)

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

  const cellSize = 40
  const labelWidth = 48
  const headerHeight = 55

  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground" style={{ marginBottom: 8 }}>
        C. Multi-Score Heatmap
      </p>
      <p className="text-[10px] text-muted-foreground" style={{ marginBottom: 6 }}>
        Intensity indicates relative score magnitude; darker = higher
      </p>
      <div className="overflow-x-auto">
        <svg
          className="recharts-surface"
          width={labelWidth + metrics.length * cellSize + 80}
          height={headerHeight + topClusters.length * cellSize + 10}
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* Column headers */}
          {metrics.map((m, col) => (
            <text
              key={m}
              x={labelWidth + col * cellSize + cellSize / 2}
              y={headerHeight - 8}
              textAnchor="middle"
              style={{ fontSize: 11, fill: 'var(--muted-foreground)', fontWeight: 600 }}
            >
              {m}
            </text>
          ))}

          {/* Threshold markers */}
          {metrics.map((_, col) => (
            <text
              key={`th-${col}`}
              x={labelWidth + col * cellSize + cellSize / 2}
              y={headerHeight - 24}
              textAnchor="middle"
              style={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
            >
              {col === 3 ? '≤-10' : `>${thresholds[col]}`}
            </text>
          ))}

          {/* Rows */}
          {topClusters.map((cluster, row) => (
            <g key={row}>
              {/* Row label */}
              <text
                x={labelWidth - 6}
                y={headerHeight + row * cellSize + cellSize / 2 + 3}
                textAnchor="end"
                style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
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
            style={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          >
            High
          </text>
          <text
            x={labelWidth + metrics.length * cellSize + 35}
            y={headerHeight + topClusters.length * cellSize}
            style={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          >
            Low
          </text>
        </svg>
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
      .slice(0, 25)
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
        <p className="text-sm font-semibold text-muted-foreground" style={{ marginBottom: 8 }}>
          D. MFE Comparison: G4 Enabled vs Disabled
        </p>
        <p className="text-xs text-muted-foreground italic">No RNA fold data available.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground" style={{ marginBottom: 8 }}>
        D. MFE Comparison: G4 Enabled vs Disabled
      </p>
      <p className="text-[10px] text-muted-foreground" style={{ marginBottom: 6 }}>
        ΔG comparison — more negative = more thermodynamically stable
      </p>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 40, left: 25 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="rank"
              tick={{ fontSize: 11 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: 'Cluster Rank', position: 'bottom', offset: 16, style: { fontSize: 13, fontWeight: 600 } }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              axisLine={{ strokeWidth: 1.5 }}
              label={{ value: 'MFE (kcal/mol)', angle: -90, position: 'insideLeft', offset: -8, style: { fontSize: 13, fontWeight: 600 } }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              formatter={(value: number, name: string) => [
                `${value.toFixed(2)} kcal/mol`,
                name === 'withG4' ? 'With G4' : 'Without G4',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => (value === 'withG4' ? 'With G-Quadruplex' : 'Without G-Quadruplex')}
            />
            <Bar dataKey="withG4" fill={COLORS.mfeStable} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="withoutG4" fill={COLORS.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
