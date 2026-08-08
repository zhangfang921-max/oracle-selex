import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Loader2, GitBranch, Activity, FlaskConical, Settings2, Camera } from 'lucide-react'
import { downloadPanelAsPNG } from '@/lib/svg-export'
import { getClusterColor } from '@/lib/cluster-colors'
import type { SequenceCluster } from '@/types/analysis'

/* ──────────────────────────────────────────────────────────────────
   ClusterNetworkGraph
   Cytoscape-style force-directed network graph for SELEX aptamer
   cluster visualization (Approach B).
   
   Nodes = aptamer sequences (colored by cluster, sized by abundance)
   Edges = structural similarity (cosine on structure profile vectors)
   
   No external dependencies — pure SVG + custom force simulation.
   Emphasizes "first permutation-test-validated SELEX clustering"
   ────────────────────────────────────────────────────────────────── */

interface PermutationData {
  p_values: number[]
  significant: boolean[]
  cluster_sizes: number[]
  threshold: number
}

interface NetworkNode {
  id: number
  clusterId: number
  sequence: string
  count: number
}

interface NetworkEdge {
  source: number
  target: number
  similarity: number
}

interface NetworkGraphData {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  mdsPositions?: { x: number; y: number }[] | null
  stats: { nodeCount: number; edgeCount: number; density: number; threshold: number; featureMode?: string }
}

interface ClusterNetworkGraphProps {
  data: SequenceCluster[]
  silhouetteScore: number
  quality: string
  permutation?: PermutationData
  featureMode?: string
  maxVisibleClusters?: number
}

/* ── Fruchterman-Reingold force-directed layout (1991) ──────────
   Standard algorithm with similarity-weighted edges.
   f_a(d) = s * d² / k    (attraction, s = edge similarity 0-1)
   f_r(d) = -k² / d       (repulsion)
   k = C * sqrt(area / |V|)  (optimal edge length)
   Linear cooling + soft boundary forces (no hard clamping).
   ─────────────────────────────────────────────────────────────── */
interface SimNode { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }

function runForceSimulation(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  width: number,
  height: number,
  iterations: number = 300,
  gravityStrength: number = 3.0,
): Map<number, SimNode> {
  const simNodes = new Map<number, SimNode>()
  const cx = width / 2
  const cy = height / 2
  const area = width * height
  const n = nodes.length

  // FR optimal edge length — C=0.75 gives balanced spread on 700×700
  const C = 0.75
  const k = C * Math.sqrt(area / Math.max(n, 1))
  const k2 = k * k

  // Linear cooling: starts hot, cools to zero at final iteration
  const initialTemp = Math.min(width, height) / 4

  // Boundary force: soft wall within marginZone pixels of edges
  const marginZone = Math.min(width, height) * 0.15
  const boundaryStrength = k * 0.5

  // Center gravity (configurable via UI slider)

  // Initialize positions: Gaussian cloud near center (not circle — avoids boundary bias)
  nodes.forEach((n) => {
    const angle = Math.random() * 2 * Math.PI
    const r = Math.min(width, height) * 0.15 * Math.sqrt(Math.random())
    simNodes.set(n.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0, vy: 0,
    })
  })

  const nodeArr = Array.from(simNodes.entries())

  for (let iter = 0; iter < iterations; iter++) {
    const temperature = initialTemp * (1 - iter / iterations)

    // Reset displacement accumulator
    const disp = new Map<number, { dx: number; dy: number }>()
    for (const [id] of nodeArr) {
      disp.set(id, { dx: 0, dy: 0 })
    }

    // ── Repulsive forces: all pairs, O(n²) ──
    for (let i = 0; i < nodeArr.length; i++) {
      const [idA, a] = nodeArr[i]
      for (let j = i + 1; j < nodeArr.length; j++) {
        const [idB, b] = nodeArr[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01)
        const force = k2 / dist   // FR: k²/d
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        disp.get(idA)!.dx += fx
        disp.get(idA)!.dy += fy
        disp.get(idB)!.dx -= fx
        disp.get(idB)!.dy -= fy
      }
    }

    // ── Attractive forces: edges only, weighted by similarity ──
    for (const edge of edges) {
      const a = simNodes.get(edge.source)
      const b = simNodes.get(edge.target)
      if (!a || !b) continue
      let dx = a.x - b.x
      let dy = a.y - b.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01)
      // FR: d²/k, scaled by similarity (0-1) so weak edges pull less
      const force = (dist * dist / k) * edge.similarity
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      disp.get(edge.source)!.dx -= fx
      disp.get(edge.source)!.dy -= fy
      disp.get(edge.target)!.dx += fx
      disp.get(edge.target)!.dy += fy
    }

    // ── Center gravity ──
    for (const [id, nData] of nodeArr) {
      disp.get(id)!.dx += (cx - nData.x) * gravityStrength
      disp.get(id)!.dy += (cy - nData.y) * gravityStrength
    }

    // ── Soft boundary force (replaces hard clamp) ──
    for (const [id, nData] of nodeArr) {
      // Left edge
      if (nData.x < marginZone) {
        disp.get(id)!.dx += (marginZone - nData.x) / marginZone * boundaryStrength
      }
      // Right edge
      if (nData.x > width - marginZone) {
        disp.get(id)!.dx -= (nData.x - (width - marginZone)) / marginZone * boundaryStrength
      }
      // Top edge
      if (nData.y < marginZone) {
        disp.get(id)!.dy += (marginZone - nData.y) / marginZone * boundaryStrength
      }
      // Bottom edge
      if (nData.y > height - marginZone) {
        disp.get(id)!.dy -= (nData.y - (height - marginZone)) / marginZone * boundaryStrength
      }
    }

    // ── Apply displacements with temperature clamping ──
    for (const [id, nData] of nodeArr) {
      const d = disp.get(id)!
      const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy)
      if (mag > 0) {
        const scale = Math.min(mag, temperature) / mag
        nData.x += d.dx * scale
        nData.y += d.dy * scale
      }
    }

    // No hard clamp — boundary force handles edges softly
  }

  // Final pass: gentle centering + ensure within canvas
  for (const [, nData] of nodeArr) {
    nData.x = Math.max(15, Math.min(width - 15, nData.x))
    nData.y = Math.max(15, Math.min(height - 15, nData.y))
  }

  return simNodes
}

/* ─── quality helpers ──────────────────────────────────────────── */
function qualityColor(level: string): string {
  if (level === 'strong') return 'oklch(0.65 0.22 145)'
  if (level === 'moderate') return 'oklch(0.55 0.18 260)'
  return 'oklch(0.6 0.18 25)'
}

/* ─── main component ───────────────────────────────────────────── */
export function ClusterNetworkGraph({
  data,
  silhouetteScore,
  quality,
  permutation,
  featureMode,
  maxVisibleClusters,
}: ClusterNetworkGraphProps) {
  const [network, setNetwork] = useState<NetworkGraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter data by cluster count (0 = show all)
  const filteredData = useMemo(() => {
    if (maxVisibleClusters == null || maxVisibleClusters <= 0 || maxVisibleClusters >= data.length) return data
    return data.slice(0, maxVisibleClusters)
  }, [data, maxVisibleClusters])
  const [simPositions, setSimPositions] = useState<Map<number, SimNode> | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [simThreshold, setSimThreshold] = useState(0.7)
  const [maxEdges, setMaxEdges] = useState(8)
  const [gravity, setGravity] = useState(3.0)
  const [showHulls, setShowHulls] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'force' | 'mds'>('force')
  const [zoom, setZoom] = useState(1.0)
  const svgRef = useRef<HTMLDivElement>(null)

  // SVG dimensions — square canvas avoids rectangular bias in force layout
  const svgW = 700
  const svgH = 700

  const fetchNetwork = useCallback(async (threshold: number, maxE: number) => {
    if (filteredData.length < 2) return
    setLoading(true)
    setError(null)
    try {
      const sequences: string[] = []
      const clusterIds: number[] = []
      const counts: number[] = []
      filteredData.forEach((cluster) => {
        cluster.members.forEach((m) => {
          sequences.push(m.sequence)
          clusterIds.push(cluster.id)
          counts.push(m.totalReads || 1)
        })
        if (cluster.members.length === 0) {
          sequences.push(cluster.representative)
          clusterIds.push(cluster.id)
          counts.push(1)
        }
      })

      const resp = await fetch('/api/analysis/network_graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequences,
          clusterIds,
          readCounts: counts,
          similarityThreshold: threshold,
          maxEdgesPerNode: maxE,
          maxNodes: 1500,
          layoutMode,
          ...(featureMode ? { featureMode } : {}),
        }),
      })
      if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || 'Network graph failed') }
      const result = await resp.json()
      if (!result.success) throw new Error(result.message)
      setNetwork(result)
      // Compute positions: MDS (from backend) or force simulation
      if (result.mdsPositions && result.mdsPositions.length === result.nodes.length) {
        // MDS positions: map node id → {x, y} (scaled to canvas)
        const m = new Map<number, SimNode>()
        result.nodes.forEach((n: NetworkNode, i: number) => {
          m.set(n.id, {
            x: result.mdsPositions![i].x * svgW,
            y: result.mdsPositions![i].y * svgH,
            vx: 0, vy: 0,
          })
        })
        setSimPositions(m)
      } else {
        const pos = runForceSimulation(result.nodes, result.edges, svgW, svgH, 500, gravity)
        setSimPositions(pos)
      }
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }, [filteredData, featureMode, gravity, layoutMode])

  const regenerate = useCallback(() => {
    fetchNetwork(simThreshold, maxEdges)
  }, [fetchNetwork, simThreshold, maxEdges])

  // Re-fetch when cluster count slider changes
  useEffect(() => {
    setNetwork(null)
    setSimPositions(null)
  }, [maxVisibleClusters])

  // Auto-fetch when network cleared or on first load
  useEffect(() => {
    if (!network && !loading && filteredData.length >= 2) {
      fetchNetwork(simThreshold, maxEdges)
    }
  }, [network])

  // Node radius scale
  const nodeRadii = useMemo(() => {
    if (!network) return new Map<number, number>()
    const counts = network.nodes.map(n => n.count)
    const maxC = Math.max(...counts, 1)
    const minC = Math.min(...counts, 1)
    const m = new Map<number, number>()
    network.nodes.forEach(n => {
      // Sqrt scale for more dramatic radius difference: min 3, max 24
      const frac = Math.sqrt(n.count / maxC)
      m.set(n.id, 3 + frac * 21)
    })
    return m
  }, [network])

  // Edge width scale — only for high-similarity edges (≥ 0.7)
  const edgeWidths = useMemo(() => {
    if (!network) return new Map<string, number>()
    const m = new Map<string, number>()
    network.edges.forEach(e => {
      if (e.similarity >= 0.7) {
        // 0.8–2.3 px, linear ramp above 0.7
        m.set(`${e.source}-${e.target}`, 0.8 + Math.min((e.similarity - 0.7) / 0.3, 1) * 1.5)
      }
    })
    return m
  }, [network])

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden" style={{ marginBottom: 20 }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '12px 20px' }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <GitBranch size={14} className="text-primary" />
          <span className="text-sm font-semibold">Cluster Network Graph</span>
          <span className="text-xs font-medium rounded-full px-2 py-0.5"
            style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
            {featureMode === 'structure-profile' || featureMode === 'structure' ? 'Structure Profile · FR Layout' : featureMode === 'kmer' ? 'K-mer · FR Layout' : 'FR Layout'}
          </span>
          {network && (
            <span className="text-xs text-muted-foreground">
              {network.stats.nodeCount} nodes · {network.stats.edgeCount} edges · density={network.stats.density.toFixed(4)} · cos≥{network.stats.threshold}
            </span>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          {network && (
            <>
              <button onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center text-xs font-medium rounded-md border transition-colors cursor-pointer ${showSettings ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted text-muted-foreground'}`}
                style={{ padding: '5px 10px', gap: 4 }}>
                <Settings2 size={12} /> Settings
              </button>
              <button onClick={() => { if (svgRef.current) downloadPanelAsPNG(svgRef.current, 'network_graph', { transparent: true, legendStyle: 'bottom' }) }}
                className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                style={{ padding: '4px 8px' }} title="Export network graph as vector SVG">
                <Camera size={13} />
              </button>
              <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))}
                className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                style={{ padding: '5px 8px' }} title="Zoom out">−</button>
              <span className="text-[10px] text-muted-foreground tabular-nums" style={{ minWidth: 32, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3.0, z + 0.15))}
                className="flex items-center text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                style={{ padding: '5px 8px' }} title="Zoom in">+</button>
            </>
          )}
          {!network && !loading && (
            <button onClick={regenerate} disabled={filteredData.length < 2}
              className="flex items-center text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-40"
              style={{ padding: '5px 12px', gap: 5 }}>
              <GitBranch size={12} /> Generate Network
            </button>
          )}
          {network && (
            <button onClick={() => { setNetwork(null); setSimPositions(null) }}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer" style={{ padding: '5px 8px' }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Settings ── */}
      {showSettings && (
        <div className="border-b border-border bg-muted/30" style={{ padding: '12px 20px' }}>
          <div className="flex items-center flex-wrap" style={{ gap: 20 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <label className="text-xs font-medium text-muted-foreground">Sim. Threshold</label>
              <input type="range" min={0.3} max={0.95} step={0.05} value={simThreshold}
                onChange={e => setSimThreshold(Number(e.target.value))}
                className="w-24 h-2 cursor-pointer accent-primary" />
              <span className="text-xs font-mono">{simThreshold.toFixed(2)}</span>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <label className="text-xs font-medium text-muted-foreground">Max Edges/Node</label>
              <input type="range" min={3} max={20} step={1} value={maxEdges}
                onChange={e => setMaxEdges(Number(e.target.value))}
                className="w-24 h-2 cursor-pointer accent-primary" />
              <span className="text-xs font-mono">{maxEdges}</span>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <label className="text-xs font-medium text-muted-foreground">Gravity</label>
              <input type="range" min={0.1} max={10} step={0.1} value={gravity}
                onChange={e => setGravity(Number(e.target.value))}
                className="w-24 h-2 cursor-pointer accent-primary" />
              <span className="text-xs font-mono">{gravity.toFixed(1)}</span>
            </div>
            <label className="flex items-center text-xs font-medium text-muted-foreground cursor-pointer" style={{ gap: 4 }}>
              <input type="checkbox" checked={showHulls} onChange={e => setShowHulls(e.target.checked)}
                className="cursor-pointer accent-primary" />
              Hulls
            </label>
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setLayoutMode('force')}
                className={`text-xs px-3 py-1.5 transition-colors cursor-pointer ${layoutMode === 'force' ? 'bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground hover:bg-muted'}`}
              >Force</button>
              <button
                onClick={() => setLayoutMode('mds')}
                className={`text-xs px-3 py-1.5 transition-colors cursor-pointer border-l border-border ${layoutMode === 'mds' ? 'bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground hover:bg-muted'}`}
              >MDS</button>
            </div>
            <button onClick={regenerate}
              className="text-xs font-medium rounded-md border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 transition-colors cursor-pointer"
              style={{ padding: '4px 12px' }}>
              Apply &amp; Regenerate
            </button>
          </div>
        </div>
      )}

      <div ref={svgRef} style={{ padding: '8px' }}>
        {/* ── Initial state ── */}
        {!network && !loading && !error && (
          <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20"
            style={{ height: 400, gap: 12 }}>
            <div className="rounded-full flex items-center justify-center"
              style={{ width: 60, height: 60, background: 'color-mix(in oklch, var(--primary) 12%, transparent)' }}>
              <GitBranch size={26} style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <p className="text-sm font-semibold">Force-Directed Sequence Similarity Network</p>
              <p className="text-xs text-muted-foreground" style={{ maxWidth: 400, marginTop: 6 }}>
                Fruchterman-Reingold force-directed network of aptamer sequences.
                Edges connect sequences with
                {featureMode === 'structure-profile' ? ' structure-profile' : featureMode === 'kmer' ? ' k-mer' : ''} cosine similarity ≥ threshold.
                Node positions iterate from repulsive (f_r = k²/d) and attractive (f_a = s·d²/k) forces.
                Node size ∝ √(read abundance), node color = cluster.
              </p>
              <p className="text-xs font-medium" style={{ marginTop: 8, color: 'oklch(0.65 0.22 145)' }}>
                Permutation-test-validated SELEX clustering — visualized as a similarity network
              </p>
            </div>
            <button onClick={regenerate}
              className="flex items-center text-sm font-medium rounded-lg px-5 py-2 transition-colors cursor-pointer"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', gap: 6 }}>
              <GitBranch size={14} /> Generate Network
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center" style={{ height: 400, gap: 12 }}>
            <Loader2 className="animate-spin text-primary" size={28} />
            <p className="text-sm font-medium">Building network graph...</p>
            <p className="text-xs text-muted-foreground">Computing cosine similarity — building edges — running Fruchterman-Reingold force layout</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex flex-col items-center justify-center text-center rounded-xl border border-red-500/20 bg-red-500/5"
            style={{ height: 180, gap: 8, padding: 24 }}>
            <p className="text-sm font-semibold text-red-600">Network graph failed</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <button onClick={regenerate} className="text-xs text-primary hover:underline cursor-pointer">Try again</button>
          </div>
        )}

        {/* ── Graph SVG ── */}
        {network && simPositions && (
          <div>


            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <div className="rounded-lg border border-border overflow-auto bg-background"
              style={{ maxHeight: zoom > 1 ? 700 * zoom : 700 }}>
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: svgW, height: svgH }}>
              <svg className="recharts-surface" width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
                {/* Background */}
                <rect width={svgW} height={svgH} fill="var(--background)" />

                {/* Edges — thin dark lines for clarity */}
                {network.edges.map((edge, i) => {
                  const a = simPositions.get(edge.source)
                  const b = simPositions.get(edge.target)
                  if (!a || !b) return null
                  const t = edge.similarity
                  if (t < 0.7) return null
                  const w = edgeWidths.get(`${edge.source}-${edge.target}`) || 0.8
                  const opacity = 0.25 + Math.min((t - 0.7) / 0.3, 1) * 0.45  // 0.25–0.70
                  return (
                    <line key={`e-${i}`}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="#555" strokeWidth={w} opacity={opacity}
                    />
                  )
                })}

                {/* Cluster boundaries — convex hull around each cluster */}
                {showHulls && network && simPositions && (() => {
                  const hulls: { cid: number; points: string; color: string }[] = []
                  const clusterNodes = new Map<number, { x: number; y: number }[]>()
                  network.nodes.forEach(n => {
                    const p = simPositions.get(n.id)
                    if (p) {
                      if (!clusterNodes.has(n.clusterId)) clusterNodes.set(n.clusterId, [])
                      clusterNodes.get(n.clusterId)!.push(p)
                    }
                  })
                  clusterNodes.forEach((pts, cid) => {
                    if (pts.length < 3) return
                    // Monotone chain convex hull
                    const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
                    const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
                    const lower: typeof sorted = []
                    for (const p of sorted) {
                      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
                      lower.push(p)
                    }
                    const upper: typeof sorted = []
                    for (let i = sorted.length - 1; i >= 0; i--) {
                      const p = sorted[i]
                      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
                      upper.push(p)
                    }
                    lower.pop(); upper.pop()
                    const hull = lower.concat(upper)
                    if (hull.length >= 3) {
                      hulls.push({
                        cid,
                        points: hull.map(p => `${p.x},${p.y}`).join(' '),
                        color: getClusterColor(cid),
                      })
                    }
                  })
                  return hulls.map(h => (
                    <polygon key={`hull-${h.cid}`} points={h.points}
                      fill={h.color} fillOpacity={0.12} stroke={h.color} strokeWidth={2} strokeOpacity={0.5}
                      strokeDasharray="8 4" />
                  ))
                })()}

                {/* Nodes (on top, semi-transparent so edges show at boundaries) */}
                {network.nodes.map((node) => {
                  const pos = simPositions.get(node.id)
                  if (!pos) return null
                  const r = nodeRadii.get(node.id) || 6
                  const color = getClusterColor(node.clusterId)
                  return (
                    <g key={`n-${node.id}`}>
                      <circle cx={pos.x} cy={pos.y} r={r}
                        fill={color} fillOpacity={0.72}
                        stroke="rgba(255,255,255,0.4)" strokeWidth={0.8} />
                      {r > 8 && (
                        <text x={pos.x} y={pos.y + r + 9} textAnchor="middle"
                          style={{ fontSize: Math.max(7, r * 0.6), fill: 'var(--muted-foreground)', fontWeight: 600 }}>
                          #{node.clusterId}
                        </text>
                      )}
                      <title>{`Cluster #${node.clusterId} | ${node.count} reads\n${node.sequence}`}</title>
                    </g>
                  )
                })}
              </svg>
              </div>
            </div>
              </div>{/* end flex chart area */}

            {/* Legend — right column */}
            <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '6px 10px', width: 150, flexShrink: 0, maxHeight: 700, overflowY: 'auto' }}>
              <p className="text-[10px] font-semibold text-muted-foreground" style={{ marginBottom: 4 }}>Clusters</p>
              <div data-legend="network-graph" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Array.from(new Map(network.nodes.map(n => [n.clusterId, getClusterColor(n.clusterId)] as const))).slice(0, 30).map(([cid, color]) => (
                  <div key={cid} className="flex items-center" style={{ gap: 3 }}>
                    <svg width="10" height="10"><circle cx={5} cy={5} r={4} fill={color} fillOpacity={0.85} /></svg>
                    <span className="text-[10px] text-muted-foreground">#{cid}</span>
                  </div>
                ))}
              </div>
            </div>
            </div>{/* end flex row */}

            {/* Caption */}
            {network && (
              <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 8 }}>
                <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
                  Fig. Force-directed sequence similarity network (Fruchterman-Reingold layout).
                </p>
                <p className="text-xs text-muted-foreground" style={{ lineHeight: 1.7 }}>
                  {network.stats.nodeCount} SELEX-enriched aptamer sequences connected by
                  {featureMode === 'structure-profile' ? ' structure-profile' : featureMode === 'kmer' ? ' k-mer' : ''} cosine similarity ≥ {network.stats.threshold}.
                  Node positions computed by the Fruchterman-Reingold force-directed algorithm:
                  attraction f_a(d) = s·d²/k between similar sequences pulls clusters together,
                  repulsion f_r(d) = k²/d spreads non-similar sequences apart.
                  Node color = cluster assignment, node size ∝ √(read abundance).
                  Clusters validated by permutation test ({permutation?.significant.filter(Boolean).length || 0}/{permutation?.significant.length || 0} significant
                  at p&lt;{permutation?.threshold || 0.05}).
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}