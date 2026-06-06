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
import { Download, Loader2, Globe } from 'lucide-react'
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

interface UMAPChartProps {
  data: SequenceCluster[]
}

function CustomDot(props: any) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined) return null
  const color = getClusterColor(payload.clusterId)
  const shape: ClusterShape = getClusterShape(payload.clusterId)
  const r = 7; const op = 0.92; const sw = 1.2
  const strokeColor = 'rgba(255,255,255,0.6)'
  if (shape === 'circle') return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={sw} />
  if (shape === 'square') { const s = r*1.65; return <rect x={cx-s/2} y={cy-s/2} width={s} height={s} rx={1.5} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={sw} /> }
  if (shape === 'triangle') { const h=r*1.8; return <polygon points={`${cx},${cy-h} ${cx-h*0.95},${cy+h*0.55} ${cx+h*0.95},${cy+h*0.55}`} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={sw} /> }
  if (shape === 'diamond') { const d=r*1.7; return <polygon points={`${cx},${cy-d} ${cx+d*0.8},${cy} ${cx},${cy+d} ${cx-d*0.8},${cy}`} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={sw} /> }
  const t=r*0.42; const o=r*1.45
  return <path d={`M${cx-t},${cy-o} L${cx+t},${cy-o} L${cx+t},${cy-t} L${cx+o},${cy-t} L${cx+o},${cy+t} L${cx+t},${cy+t} L${cx+t},${cy+o} L${cx-t},${cy+o} L${cx-t},${cy+t} L${cx-o},${cy+t} L${cx-o},${cy-t} L${cx-t},${cy-t} Z`} fill={color} fillOpacity={op} stroke={strokeColor} strokeWidth={0.8} />
}

function UMAPTooltip({ active, payload }: any) {
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

export function UMAPChart({ data }: UMAPChartProps) {
  const [points, setPoints] = useState<Point[]>([])
  const [loading, setLoading] = useState(false)
  const [computed, setComputed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const runUMAP = useCallback(async () => {
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

      const resp = await fetch('/api/analysis/umap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, clusterIds }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.message || 'UMAP computation failed')
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

  const exportPNG = useCallback(async () => {
    if (!chartRef.current) return
    await exportElementAsPNG(chartRef.current, 'umap_cluster_map.png')
  }, [])

  const clusterGroups = computed
    ? Array.from(new Map(points.map((p) => [p.clusterId, true])).keys())
        .sort((a, b) => a - b)
        .map((cid) => ({ cid, pts: points.filter((p) => p.clusterId === cid) }))
    : []

  const numClusters = clusterGroups.length

  return (
    <div>
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '12px 20px' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Globe size={14} className="text-primary" />
            <span className="text-sm font-semibold">UMAP Cluster Map</span>
            <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>Primary</span>
            {computed && (
              <span className="text-xs text-muted-foreground">{points.length} sequences · {numClusters} clusters</span>
            )}
          </div>
          <div className="flex items-center" style={{ gap: 6 }}>
            {computed && (
              <button onClick={exportPNG} className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" style={{ padding: '5px 10px', gap: 4 }}>
                <Download size={12} /> PNG (300dpi)
              </button>
            )}
            {!computed && !loading && (
              <button onClick={runUMAP} disabled={data.length < 2} className="flex items-center text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: '5px 12px', gap: 5 }}>
                <Globe size={12} /> Generate UMAP Map
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
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20" style={{ height: 420, gap: 12 }}>
              <div className="rounded-full flex items-center justify-center" style={{ width: 60, height: 60, background: 'color-mix(in oklch, var(--primary) 12%, transparent)' }}>
                <Globe size={26} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ marginBottom: 6 }}>UMAP Cluster Map</p>
                <p className="text-xs text-muted-foreground" style={{ maxWidth: 400 }}>
                  UMAP preserves both local neighborhood structure and global topology simultaneously — clusters tend to be tighter and better separated.
                </p>
                <p className="text-xs" style={{ marginTop: 6, color: 'var(--muted-foreground)', opacity: 0.75 }}>
                  Runs faster than t-SNE and scales better to large datasets.
                </p>
              </div>
              <button onClick={runUMAP} className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', gap: 6 }}>
                <Globe size={14} /> Generate UMAP Map
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center" style={{ height: 400, gap: 12 }}>
              <Loader2 className="animate-spin text-primary" size={28} />
              <div className="text-center">
                <p className="text-sm font-medium">Computing UMAP embedding...</p>
                <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>Preserving global structure with neighborhood graph optimization</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5" style={{ height: 200, gap: 8, padding: 24 }}>
              <p className="text-sm font-semibold text-red-600">UMAP computation failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <button onClick={runUMAP} className="text-xs text-primary hover:underline cursor-pointer mt-2">Try again</button>
            </div>
          )}

          {computed && points.length > 0 && (
            <div>
              <div style={{ width: '100%', height: 520 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 50, left: 40 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" opacity={0.4} />
                    <XAxis type="number" dataKey="x" name="UMAP 1" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={{ stroke: 'var(--border)' }} label={{ value: 'UMAP Dimension 1', position: 'bottom', offset: 28, style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
                    <YAxis type="number" dataKey="y" name="UMAP 2" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={{ stroke: 'var(--border)' }} label={{ value: 'UMAP Dimension 2', angle: -90, position: 'insideLeft', offset: -20, style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
                    <Tooltip content={<UMAPTooltip />} />
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

              {/* Legend — bordered box */}
              <div
                className="rounded-lg border border-border bg-muted/20"
                style={{ padding: '10px 14px', marginTop: 10 }}
              >
                <p className="text-xs font-semibold text-muted-foreground" style={{ marginBottom: 8 }}>Cluster Legend</p>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${numClusters > 20 ? 8 : numClusters > 12 ? 6 : 5}, minmax(0, 1fr))`,
                    gap: '6px 10px',
                  }}
                >
                  {clusterGroups.map(({ cid, pts }) => {
                    const color = getClusterColor(cid)
                    const shape = getClusterShape(cid)
                    return (
                      <div key={cid} className="flex items-center" style={{ gap: 5, minWidth: 0 }}>
                        <svg width="14" height="14" viewBox="-7 -7 14 14" style={{ flexShrink: 0 }}>
                          {shape === 'circle' && <circle cx={0} cy={0} r={5.5} fill={color} fillOpacity={0.95} stroke="rgba(255,255,255,0.5)" strokeWidth={0.8} />}
                          {shape === 'square' && <rect x={-4.5} y={-4.5} width={9} height={9} rx={1} fill={color} fillOpacity={0.95} stroke="rgba(255,255,255,0.5)" strokeWidth={0.8} />}
                          {shape === 'triangle' && <polygon points="0,-5.5 -5.2,3.2 5.2,3.2" fill={color} fillOpacity={0.95} stroke="rgba(255,255,255,0.5)" strokeWidth={0.8} />}
                          {shape === 'diamond' && <polygon points="0,-6 5.5,0 0,6 -5.5,0" fill={color} fillOpacity={0.95} stroke="rgba(255,255,255,0.5)" strokeWidth={0.8} />}
                          {shape === 'cross' && <path d="M-1.5,-6 L1.5,-6 L1.5,-1.5 L6,-1.5 L6,1.5 L1.5,1.5 L1.5,6 L-1.5,6 L-1.5,1.5 L-6,1.5 L-6,-1.5 L-1.5,-1.5 Z" fill={color} fillOpacity={0.95} stroke="rgba(255,255,255,0.5)" strokeWidth={0.6} />}
                        </svg>
                        <span className="text-muted-foreground truncate" style={{ fontSize: 10, lineHeight: 1.3 }}>
                          <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>#{cid}</span>
                          <span style={{ opacity: 0.6, marginLeft: 2 }}>({pts.length})</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <p className="text-center text-muted-foreground" style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>
                Fig. UMAP visualization · {points.length} sequences · {numClusters} clusters · cosine metric, 4-mer features
                <br/>
                UMAP preserves both local neighborhoods and global cluster separation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
