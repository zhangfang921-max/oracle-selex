import { useState, useCallback, useRef, useMemo } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'
import { Download, Loader2, MapPin, Settings2, FileSpreadsheet } from 'lucide-react'
import { downloadChartPanel } from '@/lib/svg-export'
import { downloadCSV } from '@/lib/export-csv'
import { getClusterColor } from '@/lib/cluster-colors'
import type { SequenceCluster } from '@/types/analysis'
import { ChartLayout } from '@/config/chartLayout'

interface TSNEPoint {
  x: number
  y: number
  clusterId: number
  sequence: string
  idx: number
  count?: number
}

interface TSNEChartProps {
  data: SequenceCluster[]
  maxVisibleClusters?: number
  featureMode?: string
  dotSize?: number
  onDotSizeChange?: (v: number) => void
}

// Custom dot renderer — size scales with count (overlapping points merged)
function CustomDot(props: any) {
  const { cx, cy, payload, dotSize, maxCount } = props
  if (cx === undefined || cy === undefined) return null
  const color = payload.clusterId <= 5 ? getClusterColor(payload.clusterId) : '#aaa'
  const baseR = dotSize || 7
  const count = payload.readCount || payload.count || 1
  // Area ∝ count: radius = baseR * √(fraction) with floor at 0.55× and ceiling at 1.7×
  const sf = Math.sqrt(count / Math.max(maxCount || count, 1))
  const r = baseR * Math.max(0.30, Math.min(3.2, 0.35 + sf * 2.85))
  const op = 0.92
  const sw = 1.2
  const strokeColor = 'rgba(255,255,255,0.6)'
  return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={sw} />
}

// Custom tooltip
function TSNETooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null
  const d: TSNEPoint = payload[0]?.payload
  if (!d) return null
  return (
    <div
      className="bg-background border border-border rounded-lg shadow-lg text-xs"
      style={{ padding: '8px 12px', maxWidth: 260 }}
    >
      <p className="font-semibold" style={{ marginBottom: 3 }}>Cluster #{d.clusterId}{(d.count && d.count > 1) ? `  (×${d.count})` : ''}</p>
      <p className="text-muted-foreground" style={{ fontFamily: 'var(--font-family-mono)', lineHeight: 1.5 }}>
        {d.sequence}
      </p>
      {(d.count && d.count > 1) && (
        <p className="text-[10px] text-muted-foreground mt-1 italic">
          {d.count} overlapping sequences at this position
        </p>
      )}
    </div>
  )
}

export function TSNEChart({ data, maxVisibleClusters: externalMaxClusters, featureMode, dotSize = 3, onDotSizeChange }: TSNEChartProps) {
  const [points, setPoints] = useState<TSNEPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [computed, setComputed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  // Maximum overlap count for sizing
  const maxCount = useMemo(() => {
    if (points.length === 0) return 1
    return Math.max(...points.map(p => (p as any).readCount || p.count || 1), 1)
  }, [points])

  // Use external cluster filter from parent
  const maxVisibleClusters = externalMaxClusters ?? 0

  const runTSNE = useCallback(async () => {
    if (data.length < 2) return
    setLoading(true)
    setError(null)

    try {
      const sequences: string[] = []
      const clusterIds: number[] = []
      const counts: number[] = []

      data.forEach((cluster) => {
        cluster.members.forEach((member) => {
          sequences.push(member.sequence)
          clusterIds.push(cluster.id)
          counts.push(member.totalReads || 1)
        })
        if (cluster.members.length === 0 && cluster.representative) {
          sequences.push(cluster.representative)
          clusterIds.push(cluster.id)
          counts.push(1)
        }
      })

      const resp = await fetch('/api/analysis/tsne', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, clusterIds, readCounts: counts, ...(featureMode ? { featureMode } : {}) }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.message || 't-SNE computation failed')
      }

      const result = await resp.json()
      if (!result.success) throw new Error(result.message)
      setPoints(result.data)
      setComputed(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data])

  const exportSVG = useCallback(() => {
    if (chartRef.current) downloadChartPanel(chartRef.current, 'tsne_cluster_map.svg')
  }, [])

  const exportCSV = useCallback(() => {
    if (points.length === 0) return
    const headers = ['x', 'y', 'cluster_id', 'sequence', 'read_count']
    const rows = points.map(p => [p.x.toFixed(6), p.y.toFixed(6), p.clusterId, p.sequence, p.count || 1])
    downloadCSV('tsne_coordinates.csv', headers, rows)
  }, [points])

  // Group points by cluster
  const allClusterGroups = useMemo(() => {
    if (!computed) return []
    return Array.from(new Map(points.map((p) => [p.clusterId, true])).keys())
      .sort((a, b) => a - b)
      .map((cid) => ({
        cid,
        pts: points.filter((p) => p.clusterId === cid),
      }))
  }, [computed, points])

  // Apply cluster count filter
  const clusterGroups = useMemo(() => {
    if (maxVisibleClusters <= 0 || maxVisibleClusters >= allClusterGroups.length) {
      return allClusterGroups
    }
    return allClusterGroups.slice(0, maxVisibleClusters)
  }, [allClusterGroups, maxVisibleClusters])

  const numClusters = allClusterGroups.length
  const visibleClusters = clusterGroups.length
  const visiblePoints = clusterGroups.reduce((sum, g) => sum + g.pts.length, 0)

  return (
    <div>

      {/* Chart area */}
      <div ref={chartRef}>
          {/* Initial state */}
          {!computed && !loading && !error && (
            <div
              className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20"
              style={{ height: 420, gap: 12 }}
            >
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 60,
                  height: 60,
                  background: 'color-mix(in oklch, var(--primary) 12%, transparent)',
                }}
              >
                <MapPin size={26} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ marginBottom: 6 }}>
                  t-SNE Sequence Cluster Map
                </p>
                <p className="text-xs text-muted-foreground text-center" style={{ maxWidth: 400 }}>
                  Project all {data.reduce((s, c) => s + c.size, 0)} sequences into 2D space using {featureMode === 'structure-profile' ? 'structure profile vectors (48-dim dot-bracket features)' : 'k-mer frequency features'}.
                  Each point is colored and shaped by cluster — nearby points share sequence similarity.
                </p>
                <p className="text-xs" style={{ marginTop: 6, color: 'var(--muted-foreground)', opacity: 0.75 }}>
                  t-SNE excels at revealing tight local neighborhood structure.
                </p>
              </div>
              <button
                onClick={runTSNE}
                className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer"
                style={{
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  gap: 6,
                }}
              >
                <MapPin size={14} />
                Generate t-SNE Map
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div
              className="flex flex-col items-center justify-center"
              style={{ height: 400, gap: 12 }}
            >
              <Loader2 className="animate-spin text-primary" size={28} />
              <div className="text-center">
                <p className="text-sm font-medium">Computing t-SNE embedding...</p>
                <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>
                  Calculating {featureMode === 'structure-profile' ? 'structure profile' : 'k-mer'} features and running dimensionality reduction
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5"
              style={{ height: 200, gap: 8, padding: 24 }}
            >
              <p className="text-sm font-semibold text-red-600">t-SNE computation failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <button
                onClick={runTSNE}
                className="text-xs text-primary hover:underline cursor-pointer mt-2"
              >
                Try again
              </button>
            </div>
          )}

          {/* Chart */}
          {computed && points.length > 0 && (
            <div style={{ height: '100%' }}>
              <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', height: '100%' }}>
                <div style={{ flex: '1 1 0', minWidth: 0, height: '100%' }}>
                  <div style={{ width: '100%', aspectRatio: '3/2', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={ChartLayout.dimReduction.margin}>
                                        <XAxis
                      type="number"
                      dataKey="x"
                      name="t-SNE 1"
                      tick={{ fontSize: 14, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
                      axisLine={{ stroke: '#1a1a1a', strokeWidth: 1 }}
                      tickLine={{ stroke: '#1a1a1a' }}
                      label={{ value: 't-SNE Dimension 1', position: 'bottom', offset: 2, style: { fontSize: 16, fontWeight: 600, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif' } }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="t-SNE 2"
                      tick={{ fontSize: 14, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}
                      axisLine={{ stroke: '#1a1a1a', strokeWidth: 1 }}
                      tickLine={{ stroke: '#1a1a1a' }}
                      label={{
                        content: ({ viewBox }: any) => {
                          const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 }
                          return (
                            <text x={x - ChartLayout.dimReduction.yLabelDx} y={y + height / 2} textAnchor="middle"
                              transform={`rotate(-90, ${x - ChartLayout.dimReduction.yLabelDx}, ${y + height / 2})`}
                              fontSize={16} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                              t-SNE Dimension 2
                            </text>
                          )
                        }
                      }}
                    />
                    <Tooltip content={<TSNETooltip />} />
                    {/* Render 6-30 first (bottom layer), then 1-5 (top layer) */}
                    {clusterGroups.filter(g => g.cid > 5).map(({ cid, pts }) => (
                      <Scatter key={cid} name={`Cluster #${cid}`} data={pts} isAnimationActive={false}
                        shape={<CustomDot dotSize={dotSize} maxCount={maxCount} />}>
                        {pts.map((_, i) => (<Cell key={i} fill="#aaa" />))}
                      </Scatter>
                    ))}
                    {clusterGroups.filter(g => g.cid <= 5).map(({ cid, pts }) => (
                      <Scatter key={cid} name={`Cluster #${cid}`} data={pts} isAnimationActive={false}
                        shape={<CustomDot dotSize={dotSize} maxCount={maxCount} />}>
                        {pts.map((_, i) => (<Cell key={i} fill={getClusterColor(cid)} />))}
                      </Scatter>
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>

              {/* Floating legend overlay */}
              <div data-legend="panel-a" style={{
                position: 'absolute',
                top: 16,
                left: 430,
                background: 'rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: '6px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                pointerEvents: 'none',
                zIndex: 10,
              }}>
                {clusterGroups.slice(0, 5).map(({ cid }) => (
                    <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="10" height="10" viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                        <circle cx={0} cy={0} r={4} fill={getClusterColor(cid)} fillOpacity={0.92} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
                      </svg>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>#{cid}</span>
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                  <svg width="10" height="10" viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                    <circle cx={0} cy={0} r={4} fill="#aaa" fillOpacity={0.85} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
                  </svg>
                  <span style={{ fontSize: 13, color: '#1a1a1a' }}>Others</span>
                </div>
              </div>


              </div>
            </div>
            </div>
            </div>
          )}
      </div>
    </div>
  )
}