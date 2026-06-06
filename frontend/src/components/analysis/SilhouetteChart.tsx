import { useState, useCallback, useRef } from 'react'
import { FadeIn } from '@/components/MotionPrimitives'
import { Download, Loader2, BarChart3, FileSpreadsheet } from 'lucide-react'
import { exportElementAsPNG } from '@/lib/export-png'
import { downloadCSV } from '@/lib/export-csv'
import type { SequenceCluster } from '@/types/analysis'

interface ClusterSilhouette {
  clusterId: number
  scores: number[]
  avgScore: number
  size: number
}

interface SilhouetteChartProps {
  data: SequenceCluster[]
}

function getClusterColor(clusterId: number): string {
  const idx = clusterId - 1
  const hue = (idx * 137.508) % 360
  const lightness = idx % 2 === 0 ? 0.58 : 0.72
  const chroma = idx % 3 === 0 ? 0.26 : 0.22
  return `oklch(${lightness} ${chroma} ${hue.toFixed(1)})`
}

export function SilhouetteChart({ data }: SilhouetteChartProps) {
  const [clusterData, setClusterData] = useState<ClusterSilhouette[]>([])
  const [avgScore, setAvgScore] = useState(0)
  const [loading, setLoading] = useState(false)
  const [computed, setComputed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const runSilhouette = useCallback(async () => {
    if (data.length < 2) return
    setLoading(true)
    setError(null)

    try {
      const sequences: string[] = []
      const clusterIds: number[] = []

      data.forEach((cluster) => {
        cluster.members.forEach((member) => {
          sequences.push(member.sequence)
          clusterIds.push(cluster.id)
        })
        if (cluster.members.length === 0) {
          sequences.push(cluster.representative)
          clusterIds.push(cluster.id)
        }
      })

      const resp = await fetch('/api/analysis/silhouette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, clusterIds }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.message || 'Silhouette computation failed')
      }

      const result = await resp.json()
      if (!result.success) throw new Error(result.message)
      setClusterData(result.data)
      setAvgScore(result.avgScore)
      setComputed(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data])

  const exportPNG = useCallback(async () => {
    if (!chartRef.current) return
    await exportElementAsPNG(chartRef.current, 'silhouette_plot.png')
  }, [])

  const exportCSV = useCallback(() => {
    if (clusterData.length === 0) return
    const headers = ['Cluster_ID', 'Sequence_Index', 'Silhouette_Score', 'Cluster_Size', 'Cluster_Avg_Score']
    const rows: (string | number)[][] = []
    clusterData.forEach(cluster => {
      cluster.scores.forEach((score, idx) => {
        rows.push([cluster.clusterId, idx + 1, score.toFixed(6), cluster.size, cluster.avgScore.toFixed(6)])
      })
    })
    downloadCSV('silhouette_scores.csv', headers, rows)
  }, [clusterData])

  // Render the silhouette knife plot using SVG
  const renderSilhouettePlot = () => {
    if (clusterData.length === 0) return null

    const width = 600
    const height = Math.max(300, clusterData.reduce((s, c) => s + c.scores.length, 0) * 2.5 + clusterData.length * 12)
    const marginLeft = 60
    const marginRight = 40
    const marginTop = 20
    const marginBottom = 30
    const plotWidth = width - marginLeft - marginRight
    const plotHeight = height - marginTop - marginBottom

    // Scale x: silhouette score -0.2 to 1.0
    const xMin = -0.2
    const xMax = 1.0
    const xScale = (v: number) => marginLeft + ((v - xMin) / (xMax - xMin)) * plotWidth

    // Build bars
    let yOffset = marginTop
    const bars: React.ReactElement[] = []
    const labels: React.ReactElement[] = []
    const gapBetweenClusters = 8
    const barHeight = Math.max(1.5, Math.min(3, plotHeight / clusterData.reduce((s, c) => s + c.scores.length, 0)))

    clusterData.forEach((cluster) => {
      const color = getClusterColor(cluster.clusterId)
      const startY = yOffset

      cluster.scores.forEach((score, i) => {
        const x0 = xScale(0)
        const x1 = xScale(score)
        bars.push(
          <rect
            key={`${cluster.clusterId}-${i}`}
            x={Math.min(x0, x1)}
            y={yOffset}
            width={Math.abs(x1 - x0)}
            height={barHeight}
            fill={color}
            opacity={0.8}
          />
        )
        yOffset += barHeight
      })

      // Cluster label
      const midY = (startY + yOffset) / 2
      labels.push(
        <text
          key={`label-${cluster.clusterId}`}
          x={marginLeft - 8}
          y={midY + 3}
          textAnchor="end"
          style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        >
          #{cluster.clusterId} ({cluster.size})
        </text>
      )

      yOffset += gapBetweenClusters
    })

    const actualHeight = yOffset + marginBottom
    const avgX = xScale(avgScore)

    return (
      <svg className="recharts-surface" width={width} height={actualHeight} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
        {/* Background grid */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
          <line key={v} x1={xScale(v)} y1={marginTop} x2={xScale(v)} y2={actualHeight - marginBottom} stroke="var(--border)" strokeDasharray="3 3" opacity={0.5} />
        ))}

        {/* Zero line */}
        <line x1={xScale(0)} y1={marginTop} x2={xScale(0)} y2={actualHeight - marginBottom} stroke="var(--border)" strokeWidth={1} />

        {/* Bars */}
        {bars}

        {/* Average silhouette line */}
        <line x1={avgX} y1={marginTop} x2={avgX} y2={actualHeight - marginBottom} stroke="oklch(0.5 0.2 25)" strokeWidth={1.5} strokeDasharray="6 3" />
        <text x={avgX + 4} y={marginTop + 12} style={{ fontSize: 12, fill: 'oklch(0.5 0.2 25)', fontWeight: 600 }}>
          avg = {avgScore.toFixed(3)}
        </text>

        {/* Labels */}
        {labels}

        {/* X axis labels */}
        {[-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
          <text key={`ax-${v}`} x={xScale(v)} y={actualHeight - marginBottom + 18} textAnchor="middle" style={{ fontSize: 12, fill: 'var(--muted-foreground)' }}>
            {v.toFixed(1)}
          </text>
        ))}
        <text x={marginLeft + plotWidth / 2} y={actualHeight - 2} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: 'var(--foreground)' }}>
          Silhouette Score
        </text>
      </svg>
    )
  }

  return (
    <div className="lg:col-span-2">
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '12px 20px' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <BarChart3 size={14} className="text-muted-foreground" />
            <span className="text-sm font-semibold">Silhouette Analysis</span>
            {computed && (
              <span className="text-xs text-muted-foreground">
                Avg score: {avgScore.toFixed(3)} · {clusterData.length} clusters
              </span>
            )}
          </div>
          <div className="flex items-center" style={{ gap: 6 }}>
            {computed && (
              <>
                <button onClick={exportCSV} className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" style={{ padding: '5px 10px', gap: 4 }}>
                  <FileSpreadsheet size={12} /> CSV
                </button>
                <button onClick={exportPNG} className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" style={{ padding: '5px 10px', gap: 4 }}>
                  <Download size={12} /> PNG (300dpi)
                </button>
              </>
            )}
            {!computed && !loading && (
              <button onClick={runSilhouette} disabled={data.length < 2} className="flex items-center text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: '5px 12px', gap: 5 }}>
                <BarChart3 size={12} /> Compute Silhouette
              </button>
            )}
            {computed && (
              <button onClick={() => { setComputed(false); setClusterData([]) }} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors" style={{ padding: '5px 8px' }}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div ref={chartRef} style={{ padding: '16px 20px' }}>
          {!computed && !loading && !error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20" style={{ height: 400, gap: 12 }}>
              <div className="rounded-full flex items-center justify-center" style={{ width: 56, height: 56, background: 'color-mix(in oklch, var(--primary) 10%, transparent)' }}>
                <BarChart3 size={24} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ marginBottom: 4 }}>Silhouette Analysis</p>
                <p className="text-xs text-muted-foreground" style={{ maxWidth: 360 }}>
                  Shows how confidently each sequence is assigned to its cluster. Values near 1 = strong fit; near 0 = borderline; negative = potential misassignment.
                </p>
              </div>
              <button onClick={runSilhouette} className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', gap: 6 }}>
                <BarChart3 size={14} /> Compute Silhouette
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center" style={{ height: 400, gap: 12 }}>
              <Loader2 className="animate-spin text-primary" size={28} />
              <div className="text-center">
                <p className="text-sm font-medium">Computing silhouette scores...</p>
                <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>Evaluating cluster assignment quality for each sequence</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5" style={{ height: 200, gap: 8, padding: 24 }}>
              <p className="text-sm font-semibold text-red-600">Silhouette computation failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <button onClick={runSilhouette} className="text-xs text-primary hover:underline cursor-pointer mt-2">Try again</button>
            </div>
          )}

          {computed && clusterData.length > 0 && (
            <FadeIn>
              <div className="overflow-x-auto">
                {renderSilhouettePlot()}
              </div>

              {/* Score interpretation */}
              <div className="flex items-center justify-center" style={{ gap: 16, marginTop: 12 }}>
                <div className="flex items-center" style={{ gap: 4 }}>
                  <div style={{ width: 20, height: 4, background: 'oklch(0.5 0.2 25)', borderRadius: 2 }} />
                  <span className="text-xs text-muted-foreground">Average ({avgScore.toFixed(3)})</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {avgScore > 0.5 ? 'Good separation' : avgScore > 0.25 ? 'Moderate separation' : 'Weak separation'}
                </span>
              </div>

              <p className="text-center text-muted-foreground" style={{ fontSize: 10, marginTop: 8 }}>
                Fig. Silhouette plot showing cluster assignment confidence. Each horizontal bar represents one sequence; length indicates silhouette score.
                Dashed red line shows the global average score.
              </p>
            </FadeIn>
          )}
        </div>
      </div>
    </div>
  )
}
