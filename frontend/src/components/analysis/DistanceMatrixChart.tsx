import { useState, useCallback, useRef } from 'react'
import { FadeIn } from '@/components/MotionPrimitives'
import { Download, Loader2, Grid3X3, FileSpreadsheet } from 'lucide-react'
import { exportElementAsPNG } from '@/lib/export-png'
import { downloadCSV } from '@/lib/export-csv'
import type { SequenceCluster } from '@/types/analysis'

interface DistanceMatrixData {
  matrix: number[][]
  clusterIds: number[]
  clusterSizes: number[]
  numClusters: number
}

interface DistanceMatrixChartProps {
  data: SequenceCluster[]
}

export function DistanceMatrixChart({ data }: DistanceMatrixChartProps) {
  const [matrixData, setMatrixData] = useState<DistanceMatrixData | null>(null)
  const [loading, setLoading] = useState(false)
  const [computed, setComputed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const runDistanceMatrix = useCallback(async () => {
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

      const resp = await fetch('/api/analysis/distance_matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, clusterIds }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.message || 'Distance matrix computation failed')
      }

      const result = await resp.json()
      if (!result.success) throw new Error(result.message)
      setMatrixData(result)
      setComputed(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data])

  const exportPNG = useCallback(async () => {
    if (!chartRef.current) return
    await exportElementAsPNG(chartRef.current, 'distance_matrix.png')
  }, [])

  const exportCSV = useCallback(() => {
    if (!matrixData) return
    const { matrix, clusterIds, clusterSizes } = matrixData
    const headers = ['Cluster_ID', 'Cluster_Size', ...clusterIds.map(id => `Cluster_${id}`)]
    const rows = matrix.map((row, i) => [
      clusterIds[i], clusterSizes[i], ...row.map(v => v.toFixed(6))
    ])
    downloadCSV('distance_matrix.csv', headers, rows)
  }, [matrixData])

  // Color for distance value (0=white/close, 1=deep purple/far)
  function distColor(value: number, maxVal: number): string {
    const norm = Math.min(value / Math.max(maxVal, 0.001), 1)
    const l = 0.95 - norm * 0.45
    const c = norm * 0.2
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 290)`
  }

  const renderMatrix = () => {
    if (!matrixData) return null

    const { matrix, clusterIds, clusterSizes } = matrixData
    const n = matrix.length

    // Limit to top 20 clusters for readability
    const limit = Math.min(n, 20)
    const cellSize = Math.max(28, Math.min(44, 500 / limit))
    const labelWidth = 55
    const headerHeight = 55
    const legendWidth = 60

    const width = labelWidth + limit * cellSize + legendWidth
    const height = headerHeight + limit * cellSize + 20

    // Find max off-diagonal value for color scaling
    let maxVal = 0
    for (let i = 0; i < limit; i++) {
      for (let j = 0; j < limit; j++) {
        if (i !== j && matrix[i][j] > maxVal) maxVal = matrix[i][j]
      }
    }

    return (
      <svg className="recharts-surface" width={width} height={height} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
        {/* Column headers */}
        {clusterIds.slice(0, limit).map((cid, col) => (
          <g key={`col-${col}`}>
            <text
              x={labelWidth + col * cellSize + cellSize / 2}
              y={headerHeight - 8}
              textAnchor="middle"
              style={{ fontSize: 10, fill: 'var(--muted-foreground)', fontWeight: 500 }}
            >
              #{cid}
            </text>
            <text
              x={labelWidth + col * cellSize + cellSize / 2}
              y={headerHeight - 20}
              textAnchor="middle"
              style={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
            >
              ({clusterSizes[col]})
            </text>
          </g>
        ))}

        {/* Rows */}
        {clusterIds.slice(0, limit).map((cid, row) => (
          <g key={`row-${row}`}>
            {/* Row label */}
            <text
              x={labelWidth - 6}
              y={headerHeight + row * cellSize + cellSize / 2 + 3}
              textAnchor="end"
              style={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            >
              #{cid} ({clusterSizes[row]})
            </text>

            {/* Cells */}
            {matrix[row].slice(0, limit).map((val, col) => {
              const isDiagonal = row === col
              return (
                <g key={`cell-${row}-${col}`}>
                  <rect
                    x={labelWidth + col * cellSize + 1}
                    y={headerHeight + row * cellSize + 1}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    rx={3}
                    fill={isDiagonal ? 'oklch(0.92 0.03 160)' : distColor(val, maxVal)}
                    stroke={isDiagonal ? 'oklch(0.7 0.1 160)' : 'var(--border)'}
                    strokeWidth={isDiagonal ? 1 : 0.5}
                  />
                  <text
                    x={labelWidth + col * cellSize + cellSize / 2}
                    y={headerHeight + row * cellSize + cellSize / 2 + 3}
                    textAnchor="middle"
                    style={{
                      fontSize: cellSize > 35 ? 8 : 7,
                      fill: isDiagonal ? 'oklch(0.35 0.1 160)' : (val / maxVal > 0.6 ? 'white' : 'var(--foreground)'),
                      fontWeight: isDiagonal ? 600 : 400,
                    }}
                  >
                    {val.toFixed(2)}
                  </text>
                </g>
              )
            })}
          </g>
        ))}

        {/* Color legend */}
        <defs>
          <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={distColor(maxVal, maxVal)} />
            <stop offset="50%" stopColor={distColor(maxVal * 0.5, maxVal)} />
            <stop offset="100%" stopColor={distColor(0, maxVal)} />
          </linearGradient>
        </defs>
        <rect
          x={labelWidth + limit * cellSize + 15}
          y={headerHeight}
          width={12}
          height={limit * cellSize}
          fill="url(#distGrad)"
          rx={3}
        />
        <text x={labelWidth + limit * cellSize + 32} y={headerHeight + 8} style={{ fontSize: 7, fill: 'var(--muted-foreground)' }}>
          Far
        </text>
        <text x={labelWidth + limit * cellSize + 32} y={headerHeight + limit * cellSize} style={{ fontSize: 7, fill: 'var(--muted-foreground)' }}>
          Close
        </text>
      </svg>
    )
  }

  return (
    <div className="lg:col-span-2">
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '12px 20px' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Grid3X3 size={14} className="text-muted-foreground" />
            <span className="text-sm font-semibold">Inter-Cluster Distance Matrix</span>
            {computed && matrixData && (
              <span className="text-xs text-muted-foreground">
                {matrixData.numClusters} clusters · Cosine distance
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
              <button onClick={runDistanceMatrix} disabled={data.length < 2} className="flex items-center text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: '5px 12px', gap: 5 }}>
                <Grid3X3 size={12} /> Compute Distances
              </button>
            )}
            {computed && (
              <button onClick={() => { setComputed(false); setMatrixData(null) }} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors" style={{ padding: '5px 8px' }}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div ref={chartRef} style={{ padding: '16px 20px' }}>
          {!computed && !loading && !error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20" style={{ height: 400, gap: 12 }}>
              <div className="rounded-full flex items-center justify-center" style={{ width: 56, height: 56, background: 'color-mix(in oklch, var(--primary) 10%, transparent)' }}>
                <Grid3X3 size={24} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ marginBottom: 4 }}>Inter-Cluster Distance Matrix</p>
                <p className="text-xs text-muted-foreground" style={{ maxWidth: 360 }}>
                  Shows average cosine distances between clusters. Diagonal values show intra-cluster cohesion. Low off-diagonal = similar clusters that could potentially be merged.
                </p>
              </div>
              <button onClick={runDistanceMatrix} className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', gap: 6 }}>
                <Grid3X3 size={14} /> Compute Distances
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center" style={{ height: 400, gap: 12 }}>
              <Loader2 className="animate-spin text-primary" size={28} />
              <div className="text-center">
                <p className="text-sm font-medium">Computing distance matrix...</p>
                <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>Calculating pairwise cosine distances between all cluster pairs</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5" style={{ height: 200, gap: 8, padding: 24 }}>
              <p className="text-sm font-semibold text-red-600">Distance matrix computation failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <button onClick={runDistanceMatrix} className="text-xs text-primary hover:underline cursor-pointer mt-2">Try again</button>
            </div>
          )}

          {computed && matrixData && (
            <FadeIn>
              <div className="overflow-x-auto">
                {renderMatrix()}
              </div>

              <div className="flex items-center justify-center" style={{ gap: 16, marginTop: 12 }}>
                <div className="flex items-center" style={{ gap: 4 }}>
                  <div style={{ width: 12, height: 12, background: 'oklch(0.92 0.03 160)', border: '1px solid oklch(0.7 0.1 160)', borderRadius: 2 }} />
                  <span className="text-xs text-muted-foreground">Diagonal = intra-cluster cohesion</span>
                </div>
                <div className="flex items-center" style={{ gap: 4 }}>
                  <div style={{ width: 12, height: 12, background: 'oklch(0.5 0.2 290)', borderRadius: 2 }} />
                  <span className="text-xs text-muted-foreground">Off-diagonal = inter-cluster distance</span>
                </div>
              </div>

              <p className="text-center text-muted-foreground" style={{ fontSize: 10, marginTop: 8 }}>
                Fig. Inter-cluster distance matrix (cosine distance on 4-mer features). Green diagonal = intra-cluster average distance (lower = tighter cluster).
                Off-diagonal = average distance between cluster pairs.
              </p>
            </FadeIn>
          )}
        </div>
      </div>
    </div>
  )
}
