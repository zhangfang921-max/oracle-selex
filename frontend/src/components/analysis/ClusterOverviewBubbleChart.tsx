import { useMemo, useRef, useCallback } from 'react'
import {
  Legend,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Label,
} from 'recharts'
import { Camera, FileSpreadsheet } from 'lucide-react'
import { downloadChartPanel, downloadPanelAsPNG } from '@/lib/svg-export'
import { ChartLayout } from '@/config/chartLayout'
import type { SequenceCluster } from '@/types/analysis'

interface ClusterOverviewBubbleChartProps {
  data: SequenceCluster[]
  clusterMeta?: {
    abundance?: {
      enrichment_scores?: number[]
    }
  } | null
  compact?: boolean  // when true, renders inline without standalone border/header
}

const G4_RISK_COLORS: Record<string, string> = {
  High: 'oklch(0.55 0.20 15)',
  Medium: 'oklch(0.65 0.18 85)',
  Low: 'oklch(0.55 0.18 145)',
}

const G4_RISK_LABELS: Record<string, string> = {
  High: 'High (2–3 / 3 thresholds passed)',
  Medium: 'Medium (1 / 3 thresholds passed)',
  Low: 'Low (0 / 3 thresholds passed)',
}

const AXIS_BLACK = '#000'

export function ClusterOverviewBubbleChart({ data, clusterMeta, compact }: ClusterOverviewBubbleChartProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Sort by enrichment Z-score descending, matching ClusterPanel ordering
  const sortedData = useMemo(() => {
    const scores = clusterMeta?.abundance?.enrichment_scores
    if (scores && scores.length > 0) {
      return [...data].sort((a, b) => {
        const za = scores[a.id - 1] ?? -Infinity
        const zb = scores[b.id - 1] ?? -Infinity
        return zb - za
      })
    }
    return data
  }, [data, clusterMeta])

  const chartData = useMemo(() => {
    return sortedData.map((c, i) => ({
      x: c.size,
      y: c.avgMaxPercentRead,
      z: Math.max(c.size, 1),
      name: `#${i + 1}`,
      size: c.size,
      enrichment: c.avgMaxPercentRead,
      g4Risk: c.g4Risk,
      g4Motif: c.g4Motifs?.[0]?.motif || '',
      rank: i + 1,
    }))
  }, [data])

  const handleCameraDownload = useCallback((filename: string) => {
    if (!panelRef.current) return
    downloadChartPanel(panelRef.current, filename)
  }, [])

  if (sortedData.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 text-center text-muted-foreground text-sm">
        No cluster data available. Run clustering first.
      </div>
    )
  }

  // ── Chart content (shared between compact and full modes) ──
  const chartContent = (
    <>
      <div style={{ width: 650, maxWidth: '100%', aspectRatio: '3/2', position: 'relative', margin: '0 auto' }}><ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={ChartLayout.bubble.margin}>
                    <XAxis type="number" dataKey="x" name="Cluster Size" domain={[0, 70]} ticks={[0,10,20,30,40,50,60,70]} tick={{ fontSize: 14, fill: AXIS_BLACK, fontFamily: 'system-ui, sans-serif', fontWeight: 600 }} stroke={AXIS_BLACK} strokeWidth={1} tickLine={{ stroke: AXIS_BLACK }}>
            <Label value="Cluster Size (members)" position="insideBottom" offset={-10} style={{ fontSize: 16, fontWeight: 600, fill: AXIS_BLACK, fontFamily: 'system-ui, sans-serif' }} />
          </XAxis>
          <YAxis type="number" dataKey="y" name="Enrichment" domain={[0, 0.06]} ticks={[0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]} tick={{ fontSize: 14, fill: AXIS_BLACK, fontFamily: 'system-ui, sans-serif', fontWeight: 600 }} stroke={AXIS_BLACK} strokeWidth={1} tickLine={{ stroke: AXIS_BLACK }}>
            <Label
              content={({ viewBox }: any) => {
                const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 };
                return (
                  <text x={x - ChartLayout.bubble.yLabelDx} y={y + height / 2} textAnchor="middle"
                    transform={`rotate(-90, ${x - ChartLayout.bubble.yLabelDx}, ${y + height / 2})`}
                    fontSize={16} fontWeight={600} fill={AXIS_BLACK} fontFamily="system-ui, sans-serif">
                    Avg Max Percent Read
                  </text>
                );
              }}
            />
          </YAxis>
          <ZAxis type="number" dataKey="z" range={[25, 800]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
            if (!payload || payload.length === 0) return null
            const d = payload[0].payload
            const color = G4_RISK_COLORS[d.g4Risk] || '#888'
            return (
              <div className="rounded-lg border border-border shadow-lg" style={{ padding: '10px 14px', background: 'var(--card)', fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color }}>{d.name}</div>
                <div style={{ color: 'var(--muted-foreground)' }}>
                  <div>Size: <strong>{d.size}</strong> members</div>
                  <div>Enrichment: <strong>{d.enrichment.toFixed(4)}</strong></div>
                  <div>G4 Risk: <strong style={{ color }}>{d.g4Risk}</strong></div>
                  {d.g4Motif && <div>Motif: <strong>{d.g4Motif}</strong></div>}
                </div>
              </div>
            )
          }} />
          <Scatter data={chartData}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={G4_RISK_COLORS[entry.g4Risk] || 'oklch(0.55 0.05 260)'} fillOpacity={0.75} stroke={G4_RISK_COLORS[entry.g4Risk] || 'oklch(0.55 0.05 260)'} strokeOpacity={0.4} strokeWidth={1} />
            ))}
          </Scatter>
          {/* Top 5 cluster labels */}
          <Scatter data={chartData.slice(0, 5)} isAnimationActive={false}
            shape={(props: any) => {
              const x = props.cx ?? 0
              const y = props.cy ?? 0
              return (
                <text x={x} y={y - 10} textAnchor="middle"
                  style={{ fontSize: 12, fontWeight: 700, fill: '#1a1a1a' }}>
                  #{props.payload.rank}
                </text>
              )
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
      {/* Legend — HTML floating overlay */}
      <div data-legend="panel-a-results" style={{ position: 'absolute', top: 8, left: 220, display: 'flex', flexWrap: 'wrap', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 8px', pointerEvents: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: G4_RISK_COLORS.High, display: 'inline-block' }} />High G4
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: G4_RISK_COLORS.Medium, display: 'inline-block' }} />Medium G4
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: G4_RISK_COLORS.Low, display: 'inline-block' }} />Low G4
        </span>
      </div>
    </div>
    </>
  )

  if (compact) {
    return (
      <div ref={panelRef} id="panel-a-results" className="chart-panel">
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <p className="text-sm font-semibold">A. Cluster Overview</p>
          <div className="flex items-center" style={{ gap: 4 }}>
            <button onClick={() => downloadPanelAsPNG(document.getElementById('panel-a-results'), 'A_cluster_overview')} className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Save as PNG" style={{ padding: '4px 8px' }}>
              <Camera size={13} />
            </button>
            <button className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer" title="Download CSV" style={{ padding: '4px 8px' }}>
              <FileSpreadsheet size={13} />
            </button>
          </div>
        </div>
        <div style={{ padding: '8px 20px 12px' }}>{chartContent}</div>
        {/* Caption */}
        <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
          <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
            <strong>A.</strong> Cluster overview showing size (x-axis) vs read abundance (y-axis). Bubble area ∝ cluster size. Colors represent composite G4 risk level.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="chart-panel rounded-xl border border-border/50 bg-card overflow-hidden" style={{ marginTop: 'var(--spacing-lg)' }}>
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '14px 20px' }}>
        <div>
          <h3 className="font-semibold" style={{ fontSize: 15 }}>30-Cluster Distribution</h3>
          <p className="text-muted-foreground" style={{ marginTop: 2, fontSize: 12 }}>Bubble area ∝ cluster size · Color = G4 Risk (composite cGcC + G4Hunter + G4NN + motif)</p>
        </div>
        <button onClick={() => handleCameraDownload('chart_cluster_overview.svg')} className="flex items-center text-xs text-muted-foreground hover:text-foreground rounded-md border border-border hover:border-primary/30 transition-colors cursor-pointer" style={{ padding: '4px 8px', gap: 4 }} title="Download this chart as SVG">
          <Camera size={13} />SVG
        </button>
      </div>
      <div style={{ padding: '20px' }}>{chartContent}</div>
    </div>
  )
}