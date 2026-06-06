import { useState, useCallback, useRef } from 'react'
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
import { FadeIn } from '@/components/MotionPrimitives'
import { Download, Loader2, Axis3D } from 'lucide-react'
import { exportElementAsPNG } from '@/lib/export-png'
import { getClusterColor, getClusterShape, type ClusterShape } from '@/lib/cluster-colors'
import type { SequenceCluster } from '@/types/analysis'

interface Point {
  x: number
  y: number
  clusterId: number
  sequence: string
  idx: number
}

interface PCAChartProps {
  data: SequenceCluster[]
}

function CustomDot(props: any) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined) return null
  const color = getClusterColor(payload.clusterId)
  const shape: ClusterShape = getClusterShape(payload.clusterId)
  const r = 6; const op = 0.88; const sw = 0.8
  if (shape === 'circle') return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={op} stroke={color} strokeWidth={sw} strokeOpacity={0.4} />
  if (shape === 'square') { const s = r*1.55; return <rect x={cx-s/2} y={cy-s/2} width={s} height={s} fill={color} fillOpacity={op} stroke={color} strokeWidth={sw} strokeOpacity={0.4} /> }
  if (shape === 'triangle') { const h=r*1.7; return <polygon points={`${cx},${cy-h} ${cx-h},${cy+h*0.5} ${cx+h},${cy+h*0.5}`} fill={color} fillOpacity={op} stroke={color} strokeWidth={sw} strokeOpacity={0.4} /> }
  if (shape === 'diamond') { const d=r*1.6; return <polygon points={`${cx},${cy-d} ${cx+d},${cy} ${cx},${cy+d} ${cx-d},${cy}`} fill={color} fillOpacity={op} stroke={color} strokeWidth={sw} strokeOpacity={0.4} /> }
  const t=r*0.45; const o=r*1.4
  return <path d={`M${cx-t},${cy-o} L${cx+t},${cy-o} L${cx+t},${cy-t} L${cx+o},${cy-t} L${cx+o},${cy+t} L${cx+t},${cy+t} L${cx+t},${cy+o} L${cx-t},${cy+o} L${cx-t},${cy+t} L${cx-o},${cy+t} L${cx-o},${cy-t} L${cx-t},${cy-t} Z`} fill={color} fillOpacity={op} stroke={color} strokeWidth={0.6} strokeOpacity={0.4} />
}

function PCATooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null
  const d: Point = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg text-xs" style={{ padding: '8px 12px', maxWidth: 240 }}>
      <p className="font-semibold" style={{ marginBottom: 3 }}>Cluster #{d.clusterId}</p>
      <p className="text-muted-foreground" style={{ fontFamily: 'var(--font-family-mono)', lineHeight: 1.5 }}>{d.sequence}</p>
    </div>
  )
}

export function PCAChart({ data }: PCAChartProps) {
  const [points, setPoints] = useState<Point[]>([])
  const [loading, setLoading] = useState(false)
  const [computed, setComputed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [variance, setVariance] = useState<number[]>([0, 0])
  const chartRef = useRef<HTMLDivElement>(null)

  const runPCA = useCallback(async () => {
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

      const resp = await fetch('/api/analysis/pca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, clusterIds }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.message || 'PCA computation failed')
      }

      const result = await resp.json()
      if (!result.success) throw new Error(result.message)
      setPoints(result.data)
      setVariance(result.varianceExplained || [0, 0])
      setComputed(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data])

  const exportPNG = useCallback(async () => {
    if (!chartRef.current) return
    await exportElementAsPNG(chartRef.current, 'pca_cluster_map.png')
  }, [])

  const clusterGroups = computed
    ? Array.from(new Map(points.map((p) => [p.clusterId, true])).keys())
        .sort((a, b) => a - b)
        .map((cid) => ({ cid, pts: points.filter((p) => p.clusterId === cid) }))
    : []

  const numClusters = clusterGroups.length

  return (
    <div className="lg:col-span-2">
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '12px 20px' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Axis3D size={14} className="text-muted-foreground" />
            <span className="text-sm font-semibold">PCA Projection</span>
            {computed && (
              <span className="text-xs text-muted-foreground">
                {points.length} sequences · PC1: {(variance[0] * 100).toFixed(1)}% · PC2: {(variance[1] * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <div className="flex items-center" style={{ gap: 6 }}>
            {computed && (
              <button onClick={exportPNG} className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" style={{ padding: '5px 10px', gap: 4 }}>
                <Download size={12} /> PNG (300dpi)
              </button>
            )}
            {!computed && !loading && (
              <button onClick={runPCA} disabled={data.length < 2} className="flex items-center text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: '5px 12px', gap: 5 }}>
                <Axis3D size={12} /> Generate PCA Plot
              </button>
            )}
            {computed && (
              <button onClick={() => { setComputed(false); setPoints([]) }} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors" style={{ padding: '5px 8px' }}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div ref={chartRef} style={{ padding: '16px 20px' }}>
          {!computed && !loading && !error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20" style={{ height: 400, gap: 12 }}>
              <div className="rounded-full flex items-center justify-center" style={{ width: 56, height: 56, background: 'color-mix(in oklch, var(--primary) 10%, transparent)' }}>
                <Axis3D size={24} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ marginBottom: 4 }}>PCA Linear Projection</p>
                <p className="text-xs text-muted-foreground" style={{ maxWidth: 360 }}>
                  Principal Component Analysis shows the two directions of greatest variance. Good for seeing overall spread and linear separability of clusters.
                </p>
              </div>
              <button onClick={runPCA} className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', gap: 6 }}>
                <Axis3D size={14} /> Generate PCA Plot
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center" style={{ height: 400, gap: 12 }}>
              <Loader2 className="animate-spin text-primary" size={28} />
              <div className="text-center">
                <p className="text-sm font-medium">Computing PCA projection...</p>
                <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>Finding principal components of k-mer feature space</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5" style={{ height: 200, gap: 8, padding: 24 }}>
              <p className="text-sm font-semibold text-red-600">PCA computation failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <button onClick={runPCA} className="text-xs text-primary hover:underline cursor-pointer mt-2">Try again</button>
            </div>
          )}

          {computed && points.length > 0 && (
            <FadeIn>
              <div style={{ width: '100%', height: 480 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                    <XAxis type="number" dataKey="x" name="PC1" tick={{ fontSize: 10 }} label={{ value: `PC1 (${(variance[0] * 100).toFixed(1)}% variance)`, position: 'bottom', offset: 20, style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
                    <YAxis type="number" dataKey="y" name="PC2" tick={{ fontSize: 10 }} label={{ value: `PC2 (${(variance[1] * 100).toFixed(1)}% variance)`, angle: -90, position: 'insideLeft', offset: -15, style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
                    <Tooltip content={<PCATooltip />} />
                    {clusterGroups.map(({ cid, pts }) => (
                      <Scatter key={cid} name={`Cluster #${cid}`} data={pts} isAnimationActive={false} shape={<CustomDot />}>
                        {pts.map((_, i) => (
                          <Cell key={i} fill={getClusterColor(cid)} />
                        ))}
                      </Scatter>
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(clusterGroups.length, clusterGroups.length > 20 ? 8 : 6)}, minmax(0, 1fr))`,
                  gap: '4px 12px',
                  marginTop: 10,
                  padding: '8px 4px',
                }}
              >
                {clusterGroups.map(({ cid, pts }) => {
                  const color = getClusterColor(cid)
                  const shape = getClusterShape(cid)
                  return (
                    <div key={cid} className="flex items-center" style={{ gap: 4, minWidth: 0 }}>
                      <svg width="12" height="12" viewBox="-7 -7 14 14" style={{ flexShrink: 0 }}>
                        {shape === 'circle' && <circle cx={0} cy={0} r={5.5} fill={color} fillOpacity={0.9} />}
                        {shape === 'square' && <rect x={-4.5} y={-4.5} width={9} height={9} fill={color} fillOpacity={0.9} />}
                        {shape === 'triangle' && <polygon points="0,-5.5 -5.5,3 5.5,3" fill={color} fillOpacity={0.9} />}
                        {shape === 'diamond' && <polygon points="0,-6 6,0 0,6 -6,0" fill={color} fillOpacity={0.9} />}
                        {shape === 'cross' && <path d="M-1.5,-6 L1.5,-6 L1.5,-1.5 L6,-1.5 L6,1.5 L1.5,1.5 L1.5,6 L-1.5,6 L-1.5,1.5 L-6,1.5 L-6,-1.5 L-1.5,-1.5 Z" fill={color} fillOpacity={0.9} />}
                      </svg>
                      <span className="text-muted-foreground truncate" style={{ fontSize: 10 }}>
                        #{cid} <span style={{ opacity: 0.7 }}>({pts.length})</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              <p className="text-center text-muted-foreground" style={{ fontSize: 10, marginTop: 8 }}>
                Fig. PCA projection of RNA aptamer sequences. PC1 and PC2 capture {((variance[0] + variance[1]) * 100).toFixed(1)}% of total variance in k-mer feature space.
              </p>
            </FadeIn>
          )}
        </div>
      </div>
    </div>
  )
}
