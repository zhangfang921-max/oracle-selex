import { useState, useEffect, useMemo } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { Activity, FlaskConical, Loader2, Camera, FileSpreadsheet } from 'lucide-react'
import type { SequenceCluster } from '@/types/analysis'
import { ChartLayout } from '@/config/chartLayout'
import { downloadCSV } from '@/lib/export-csv'
import { downloadPanelAsPNG } from '@/lib/svg-export'

interface PermutationData {
  p_values: number[]
  significant: boolean[]
  significant_bonferroni?: boolean[]
  cluster_sizes: number[]
  threshold: number
  bonferroni_threshold?: number
  nPermutations?: number
  null_distributions?: number[][]
  observed_compactness?: number[]
}

interface QualityDashboardProps {
  silhouetteScore: number
  quality: string
  permutation?: PermutationData
  data: SequenceCluster[]
  featureMode?: string
  algorithmResults?: { method: string; K: number; silhouette: number }[]
  rightPanel?: React.ReactNode
  maxVisibleClusters?: number
}

interface ScatterPoint {
  cluster: string
  silhouette: number
  negLogP: number
  pValue: number
  size: number
  significant: boolean
}

/* ─── p-value formatting: show < when at floor ────────────────── */
function formatPValue(p: number, nPermutations: number = 1000): string {
  const floor = 1 / (nPermutations + 1)
  if (Math.abs(p - floor) < 1e-9) return `p<${floor.toFixed(4)}`
  return `p=${p.toFixed(4)}`
}

function formatPValueShort(p: number, nPermutations: number = 1000): string {
  const floor = 1 / (nPermutations + 1)
  if (Math.abs(p - floor) < 1e-9) return `<${floor.toFixed(3)}`
  return p.toFixed(3)
}

/* ─── quality label helpers ────────────────────────────────────── */
function qualityLabel(score: number): string {
  return score >= 0.5 ? 'strong' : score >= 0.25 ? 'moderate' : 'weak'
}

function qualityColor(level: string): string {
  if (level === 'strong') return 'oklch(0.65 0.18 155)'
  if (level === 'moderate') return 'oklch(0.55 0.18 260)'
  return 'oklch(0.6 0.18 25)'
}

/* ─── box plot stats ───────────────────────────────────────────── */
interface BoxStats {
  min: number; q1: number; median: number; q3: number; max: number; iqr: number
}

function boxStats(values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, iqr: 0 }
  const mid = Math.floor(n / 2)
  const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const q1 = sorted[Math.floor(n * 0.25)]
  const q3 = sorted[Math.floor(n * 0.75)]
  return { min: sorted[0], q1, median, q3, max: sorted[n - 1], iqr: q3 - q1 }
}

function getClusterColor(idx: number): string {
  const hue = (idx * 137.508) % 360
  const lightness = idx % 2 === 0 ? 0.58 : 0.72
  const chroma = idx % 3 === 0 ? 0.26 : 0.22
  return `oklch(${lightness} ${chroma} ${hue.toFixed(1)})`
}

/* ── Silhouette gauge mini-card ─────────────────────────────────── */
function SilhouetteCard({ score, quality }: { score: number; quality: string }) {
  const isNA = score < 0
  const displayScore = isNA ? 'N/A' : score.toFixed(2)
  const pct = isNA ? 0 : Math.min(Math.max((score + 0.2) * 100, 0), 100)
  const color = isNA ? 'oklch(0.5 0.02 260)' : qualityColor(quality)

  return (
    <div className="rounded-xl border border-border/50 flex-1" style={{ padding: '16px 20px', background: 'var(--glass-bg)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <Activity size={15} style={{ color }} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Silhouette</span>
      </div>
      <div className="flex items-end gap-3">
        <span className="font-bold tabular-nums" style={{ fontSize: 28, lineHeight: 1, color }}>{displayScore}</span>
        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ marginBottom: 2, background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}>
          {quality}
        </span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 4, marginTop: 10, background: 'var(--muted)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

/* ── Permutation mini-card ──────────────────────────────────────── */
function PermutationCard({ permutation }: { permutation: PermutationData }) {
  const sigCount = permutation.significant.filter(Boolean).length
  const bonfSigCount = permutation.significant_bonferroni?.filter(Boolean).length ?? 0
  const total = permutation.significant.length
  const color = sigCount > 0 ? 'oklch(0.65 0.18 155)' : 'oklch(0.6 0.03 260)'

  return (
    <div className="rounded-xl border border-border/50 flex-1" style={{ padding: '16px 20px', background: 'var(--glass-bg)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <FlaskConical size={15} style={{ color }} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permutation</span>
      </div>
      <div className="flex items-end gap-3">
        <span className="font-bold tabular-nums" style={{ fontSize: 28, lineHeight: 1, color }}>
          {sigCount}<span className="text-lg opacity-50">/{total}</span>
        </span>
        <span className="text-xs text-muted-foreground" style={{ marginBottom: 2 }}>significant at p&lt;{permutation.threshold}</span>
      </div>
      {permutation.bonferroni_threshold != null && (
        <div style={{ marginTop: 4 }}>
          <span className="text-xs font-semibold" style={{ color }}>
            ★ {bonfSigCount}/{total}
          </span>
          <span className="text-xs text-muted-foreground"> Bonferroni-corrected (p&lt;{permutation.bonferroni_threshold.toExponential(2)})</span>
        </div>
      )}
      <div className="rounded-full overflow-hidden" style={{ height: 4, marginTop: 10, background: 'var(--muted)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 ? (sigCount / total) * 100 : 0}%`, background: color }} />
      </div>
    </div>
  )
}

/* ─── Per-cluster silhouette bar panel ──────────────────────────── */
function SilhouetteBarPanel({ clusterIds, clusterSizes, avgScores, globalAvg }: {
  clusterIds: number[]; clusterSizes: number[]; avgScores: number[]; globalAvg: number
}) {
  const width = 520; const h = 180
  const ml = 52; const mr = 16; const mt = 16; const mb = 36
  const pw = width - ml - mr; const ph = h - mt - mb
  const xMin = Math.min(-0.3, Math.floor(Math.min(...avgScores, globalAvg) * 10) / 10)
  const xMax = 1.05
  const xScale = (v: number) => ml + ((v - xMin) / (xMax - xMin)) * pw
  const barH = Math.min(22, ph / Math.max(clusterIds.length, 1) - 4)
  const rowH = barH + 4
  const totalH = rowH * clusterIds.length
  const yOff = mt + (ph - totalH) / 2

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border" style={{ padding: '10px 16px' }}>
        <span className="text-sm font-semibold">Per-Cluster Silhouette</span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        <svg width={width} height={h} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
          {/* reference at 0 */}
          <line x1={xScale(0)} y1={mt} x2={xScale(0)} y2={mt + ph} stroke="var(--border)" strokeWidth={1} />
          {/* reference at global avg */}
          <line x1={xScale(globalAvg)} y1={mt} x2={xScale(globalAvg)} y2={mt + ph} stroke="oklch(0.5 0.2 25)" strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={xScale(globalAvg)} y={mt - 4} textAnchor="middle" style={{ fontSize: 9, fill: 'oklch(0.5 0.2 25)', fontWeight: 600 }}>
            avg={globalAvg.toFixed(2)}
          </text>
          {/* level thresholds */}
          <line x1={xScale(0.5)} y1={mt} x2={xScale(0.5)} y2={mt + ph} stroke="oklch(0.65 0.18 155 / 0.3)" strokeDasharray="3 3" />
          <line x1={xScale(0.25)} y1={mt} x2={xScale(0.25)} y2={mt + ph} stroke="oklch(0.55 0.18 260 / 0.3)" strokeDasharray="3 3" />
          {/* bars */}
          {clusterIds.map((cid, i) => {
            const score = avgScores[i]
            const x0 = xScale(Math.min(0, score))
            const x1 = xScale(Math.max(0, score))
            const y = yOff + rowH * i
            const color = getClusterColor(cid)
            const lvl = qualityLabel(score)
            return (
              <g key={`bar-${cid}`}>
                <rect x={x0} y={y} width={Math.max(1, x1 - x0)} height={barH} rx={3} fill={color} fillOpacity={0.7} />
                <text x={x0 - 4} y={y + barH / 2 + 4} textAnchor="end" style={{ fontSize: 10, fill: '#1a1a1a' }}>
                  #{cid}
                </text>
                <text x={Math.max(x0, x1) + 6} y={y + barH / 2 + 4} style={{ fontSize: 10, fill: 'var(--foreground)', fontWeight: 600 }}>
                  {score.toFixed(3)}
                </text>
                <text x={Math.max(x0, x1) + 6} y={y + barH / 2 + 16} style={{ fontSize: 8, fill: qualityColor(lvl), opacity: 0.7 }}>
                  {lvl}
                </text>
              </g>
            )
          })}
          {/* x axis */}
          {[xMin, 0, 0.25, 0.5, 0.75, 1.0].filter(v => v >= xMin && v <= xMax).map(v => (
            <text key={`ax-${v}`} x={xScale(v)} y={mt + ph + 15} textAnchor="middle" style={{ fontSize: 10, fill: '#1a1a1a' }}>
              {v.toFixed(v % 1 === 0 ? 0 : 2)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}

/* ─── Permutation null distribution box plot ────────────────────── */
function PermNullBoxPanel({ permutation, maxClusters }: { permutation: PermutationData; maxClusters?: number }) {
  const nd0 = permutation.null_distributions
  const obs0 = permutation.observed_compactness
  if (!nd0 || !obs0 || nd0.length === 0) return null

  const limit = (maxClusters && maxClusters > 0) ? Math.min(maxClusters, nd0.length) : nd0.length
  const nd = nd0.slice(0, limit)
  const obs = obs0.slice(0, limit)
  const pvals = permutation.p_values.slice(0, limit)
  const sigs = permutation.significant.slice(0, limit)
  const sizes = permutation.cluster_sizes.slice(0, limit)

  const width = 760; const h = 240
  const ml = 50; const mr = 12; const mt = 20; const mb = 31
  const pw = width - ml - mr; const ph = h - mt - mb

  const yMin = 0; const yMax = 1.2
  const yScale = (v: number) => mt + ph - ((v - yMin) / (yMax - yMin)) * ph

  const nClusters = nd.length
  const slotW = Math.min(64, pw / Math.max(nClusters, 1))
  const totalW = slotW * nClusters
  const offX = ml + (pw - totalW) / 2
  const boxW = slotW * 0.5

  const globalObsMean = obs.filter((_, i) => nd[i] && nd[i].length > 0).reduce((a, b) => a + b, 0) /
    Math.max(1, obs.filter((_, i) => nd[i] && nd[i].length > 0).length)

  const sigStar = (pv: number) => pv < 0.001 ? '***' : pv < 0.01 ? '**' : pv < 0.05 ? '*' : ''
  const boxColor = 'oklch(0.55 0.12 250)'

  const seededRandom = (seed: number) => {
    let s = seed
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff }
  }

  return (
    <div id="perm-null-panel" className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '8px 16px' }}>
        <span className="text-xs font-semibold">C. Permutation Test: Null Distributions</span>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button title="Save as PNG"
            onClick={() => {
              // Tight-cropped PNG export for permutation panel
              const svgEl = document.getElementById('perm-null-box-svg') as SVGSVGElement | null
              if (!svgEl) return
              const clone = svgEl.cloneNode(true) as SVGSVGElement
              // Attach to DOM for getComputedStyle
              clone.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;pointer-events:none;z-index:99999'
              document.body.appendChild(clone)
              // Inline all computed styles
              const allEls = clone.querySelectorAll('*')
              allEls.forEach((el) => {
                const e = el as SVGElement & HTMLElement
                const cs = window.getComputedStyle(e)
                if (!cs) return
                for (const attr of ['fill', 'stroke', 'font-size', 'font-family', 'font-weight', 'text-anchor']) {
                  const v = cs.getPropertyValue(attr)
                  if (v && v !== 'rgba(0, 0, 0, 0)' && !v.includes('var(') && !v.includes('oklch')) e.setAttribute(attr, v)
                }
              })
              document.body.removeChild(clone)
              clone.style.cssText = ''
              // Tight crop: include axis labels (Y title at x=20, X labels at y=231)
              const vw = 760, vh = 240
              const cropL = 12, cropR = 12, cropT = 0, cropB = 15
              const cw = vw - cropL - cropR, ch = vh - cropT - cropB
              // Build output SVG with cropped viewBox
              const svgNS = 'http://www.w3.org/2000/svg'
              const outSvg = document.createElementNS(svgNS, 'svg')
              outSvg.setAttribute('xmlns', svgNS)
              outSvg.setAttribute('width', String(cw * 2))
              outSvg.setAttribute('height', String(ch * 2))
              outSvg.setAttribute('viewBox', `${cropL} ${cropT} ${cw} ${ch}`)
              // White background
              const bg = document.createElementNS(svgNS, 'rect')
              bg.setAttribute('width', String(vw)); bg.setAttribute('height', String(vh))
              bg.setAttribute('fill', '#ffffff')
              outSvg.appendChild(bg)
              while (clone.firstChild) outSvg.appendChild(clone.firstChild)
              const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(outSvg)
              const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }))
              const img = new Image()
              img.onload = () => {
                const canvas = document.createElement('canvas')
                canvas.width = cw * 2; canvas.height = ch * 2
                const ctx = canvas.getContext('2d')!
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0)
                canvas.toBlob(blob => {
                  if (!blob) return
                  const purl = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = purl; a.download = 'permutation_test.png'
                  document.body.appendChild(a); a.click(); document.body.removeChild(a)
                  URL.revokeObjectURL(purl)
                }, 'image/png')
                URL.revokeObjectURL(url)
              }
              img.src = url
            }}
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button title="Download CSV"
            onClick={() => {
              const hdrs = ['cluster', 'p_value', 'significant', 'observed_compactness', 'null_values'];
              const rows = nd0.slice(0, limit).map((nullDist, i) => [
                String(i + 1),
                (permutation.p_values[i] ?? 0).toExponential(3),
                String(permutation.significant[i] ?? false),
                (obs[i] ?? 0).toFixed(6),
                nullDist.join(';')
              ]);
              downloadCSV('permutation_test.csv', hdrs, rows);
            }}
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '8px 20px 2px', position: 'relative' }}>
        <div style={{ width: '100%', aspectRatio: '4/1' }}>
        <svg id="perm-null-box-svg" className="recharts-surface" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: '100%' }}>
          {/* Axes */}
          <line x1={ml} y1={mt} x2={ml} y2={mt + ph} stroke="#1a1a1a" strokeWidth={1} />
          <line x1={ml} y1={mt + ph} x2={ml + pw} y2={mt + ph} stroke="#1a1a1a" strokeWidth={1} />
          {/* Y-axis label */}
          <text x={20} y={mt + ph / 2} textAnchor="middle" transform={`rotate(-90 20 ${mt + ph / 2})`}
            fontSize={13} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
            Within-cluster cosine similarity
          </text>
          {/* Y ticks */}
          {[0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2].map((val) => (
            <g key={`yt-${val}`}>
              <line x1={ml - 4} y1={yScale(val)} x2={ml} y2={yScale(val)} stroke="#1a1a1a" strokeWidth={1} />
              <text x={ml - 6} y={yScale(val) + 4} textAnchor="end" fontSize={11} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                {val.toFixed(1)}
              </text>
            </g>
          ))}
          {/* Global mean reference (dashed) */}
          <line x1={ml} y1={yScale(globalObsMean)} x2={ml + pw} y2={yScale(globalObsMean)}
            stroke="#1a1a1a" strokeDasharray="6 4" strokeWidth={0.8} opacity={0.25} />

          {Array.from({ length: nClusters }, (_, i) => i).map(i => {
            if (!nd[i] || nd[i].length === 0) return null
            const st = boxStats(nd[i])
            const cx = offX + slotW * i + slotW / 2
            const sig = sigs[i]
            const fillOp = sig ? 0.18 : 0.10
            const boxColorNS = sig ? boxColor : 'oklch(0.55 0.03 25)'  // non-significant: warm gray
            const useColor = sig ? boxColor : boxColorNS
            const y0 = yScale(st.max); const y1 = yScale(st.q3)
            const yMed = yScale(st.median); const yq1 = yScale(st.q1); const yMinP = yScale(st.min)
            const obsY = yScale(obs[i])

            // Scatter dots
            const rng = seededRandom(i * 137 + 42)
            const scatterDots: { x: number; y: number }[] = []
            const maxDots = 200
            const step = Math.max(1, Math.floor(nd[i].length / maxDots))
            for (let j = 0; j < nd[i].length; j += step) {
              scatterDots.push({ x: cx + (rng() - 0.5) * boxW * 0.8, y: yScale(nd[i][j]) })
            }

            return (
              <g key={`n-${i}`}>
                {scatterDots.map((dot, di) => (
                  <circle key={`sd-${di}`} cx={dot.x} cy={dot.y} r={1.2} fill={useColor} opacity={0.12} />
                ))}
                {/* Whiskers — unified strokeWidth */}
                <line x1={cx} y1={y0} x2={cx} y2={y1} stroke={useColor} strokeWidth={1} opacity={sig ? 0.5 : 0.35} />
                <line x1={cx} y1={yq1} x2={cx} y2={yMinP} stroke={useColor} strokeWidth={1} opacity={sig ? 0.5 : 0.35} />
                {/* Box — unified strokeWidth */}
                <rect x={cx - boxW / 2} y={y1} width={boxW} height={Math.max(1.5, yq1 - y1)}
                  fill={useColor} fillOpacity={fillOp} stroke={useColor} strokeWidth={1} rx={1} />
                {/* Median */}
                <line x1={cx - boxW / 2} y1={yMed} x2={cx + boxW / 2} y2={yMed}
                  stroke={useColor} strokeWidth={1.2} opacity={sig ? 1 : 0.5} />
                {/* Observed marker */}
                <line x1={cx - boxW * 0.55} y1={obsY} x2={cx + boxW * 0.55} y2={obsY}
                  stroke={sig ? '#dc2626' : '#9ca3af'} strokeWidth={2.2} />
                <circle cx={cx} cy={obsY} r={3.5}
                  fill={sig ? '#dc2626' : '#9ca3af'} opacity={sig ? 0.95 : 0.6} />
                {sig && (
                  <text x={cx} y={y0 - 7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#dc2626">
                    {sigStar(pvals[i])}
                  </text>
                )}
                <text x={cx} y={mt + ph + 12} textAnchor="middle"
                  style={{ fontSize: '11px', fontWeight: 600, fill: sig ? '#1a1a1a' : '#9ca3af', fontFamily: 'system-ui, sans-serif' }}>
                  #{i + 1}
                </text>
                <text x={cx} y={mt + ph + 22} textAnchor="middle"
                  style={{ fontSize: '11px', fill: '#888', fontFamily: 'system-ui, sans-serif' }}>
                  ({sizes[i]})
                </text>
              </g>
            )
          })}
          {/* In-chart legend — horizontal row, right-aligned */}
          <g transform={`translate(${width - 320}, 2)`}>
            <rect x={0} y={0} width={310} height={20} fill="rgba(255,255,255,0.85)" rx={4} />
            <line x1={6} y1={10} x2={18} y2={10} stroke="#dc2626" strokeWidth={2} />
            <text x={22} y={14} style={{ fontSize: '11px', fontWeight: 600, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif' }}>observed</text>
            <rect x={82} y={5} width={14} height={8} fill={boxColor} fillOpacity={0.2} stroke={boxColor} strokeWidth={0.5} rx={1} />
            <text x={100} y={14} style={{ fontSize: '11px', fontWeight: 600, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif' }}>null (IQR)</text>
            <line x1={169} y1={10} x2={181} y2={10} stroke="#1a1a1a" strokeDasharray="6 4" strokeWidth={0.8} opacity={0.25} />
            <text x={185} y={14} style={{ fontSize: '11px', fontWeight: 600, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif' }}>global mean</text>
          </g>
        </svg>
        </div>
      </div>
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>C.</strong> Permutation test (1,000 random cluster reassignments). Dots = subsampled null distribution (~200/cluster); box = IQR with median; red marker = observed; dashed line = global mean. ★★★ p&lt;0.001, ★★ p&lt;0.01, ★ p&lt;0.05.
        </p>
      </div>
    </div>
  )
}
/* ── Main component ──────────────────────────────────────────────── */
export function QualityDashboard({ silhouetteScore, quality, permutation, data, featureMode, algorithmResults, rightPanel, maxVisibleClusters }: QualityDashboardProps) {

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Summary cards */}
      <div className="flex flex-wrap" style={{ gap: 12, marginBottom: 16 }}>
        <SilhouetteCard score={silhouetteScore} quality={quality} />
        {permutation && <PermutationCard permutation={permutation} />}
        {!permutation && (
          <div className="rounded-xl border border-border/50 flex-1 flex items-center justify-center" style={{ padding: '16px 20px', background: 'var(--glass-bg)' }}>
            <span className="text-xs text-muted-foreground italic">Permutation test not available for this mode</span>
          </div>
        )}
      </div>

      {/* Row 1: Panel A (Algorithm Selection) + rightPanel (t-SNE Map) side-by-side, both 4:3 */}
      {algorithmResults && algorithmResults.length > 0 && permutation && (() => {
        const byMethod: Record<string, { K: number; silhouette: number }[]> = {}
        algorithmResults.forEach(r => {
          if (!byMethod[r.method]) byMethod[r.method] = []
          byMethod[r.method].push({ K: r.K, silhouette: r.silhouette })
        })
        const methods = [...new Set(algorithmResults.map(r => r.method))]
        const COLORS: Record<string, string> = {
          hierarchical: 'oklch(0.55 0.20 265)', hierarchical_ward: 'oklch(0.55 0.20 290)',
          kmeans: 'oklch(0.55 0.20 25)', gmm: 'oklch(0.55 0.20 145)',
          spectral: 'oklch(0.55 0.20 85)', dbscan: 'oklch(0.55 0.18 340)', hdbscan: 'oklch(0.55 0.18 10)',
        }
        const fullScanMethods = methods.filter(m => (byMethod[m]?.length || 0) >= 6)
        const sparseMethods = methods.filter(m => (byMethod[m]?.length || 0) < 6)
        const algoScatterData: Record<string, { K: number; silhouette: number }[]> = {}
        for (const [m, pts] of Object.entries(byMethod)) { algoScatterData[m] = pts.sort((a, b) => a.K - b.K) }
        let bestPoint: { K: number; silhouette: number; method: string } | null = null
        algorithmResults.forEach(r => { if (!bestPoint || r.silhouette > bestPoint.silhouette) bestPoint = { K: r.K, silhouette: r.silhouette, method: r.method } })
        const allSil = algorithmResults.map(r => r.silhouette).filter(v => isFinite(v))
        const silMax = Math.max(0.3, ...allSil)

        const panelB = (
        <div id="algo-select-panel" className="border border-border rounded-xl bg-card overflow-hidden" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="flex items-center justify-between border-b border-border" style={{ padding: '8px 16px' }}>
            <span className="text-xs font-semibold">B. Algorithm Selection</span>
            <div className="flex items-center" style={{ gap: 4 }}>
              <button title="Save as SVG"
                onClick={() => {
                  const panel = document.getElementById('algo-select-panel')
                  if (panel) downloadPanelAsPNG(panel, 'algorithm_selection')
                }}
                className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                style={{ padding: '4px 8px' }}>
                <Camera size={13} />
              </button>
              <button title="Download CSV"
                onClick={() => {
                  const hdrs = ['method', 'K', 'silhouette']
                  const rows = algorithmResults.map(r => [r.method, String(r.K), r.silhouette.toFixed(4)])
                  downloadCSV('algorithm_selection.csv', hdrs, rows)
                }}
                className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                style={{ padding: '4px 8px' }}>
                <FileSpreadsheet size={13} />
              </button>
            </div>
          </div>
          <div style={{ padding: '8px 20px 12px', position: 'relative', flex: 1 }}>
            <div style={{ width: '100%', aspectRatio: '3/2' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={ChartLayout.algorithmSelection.margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                  <XAxis type="number" dataKey="K" tick={{ fontSize: 14, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }} stroke="#1a1a1a" strokeWidth={1}
                    domain={[0, 30]} ticks={[0,5,10,15,20,25,30]} allowDecimals={false}
                    label={{ value: 'K (Number of Clusters)', position: 'bottom', offset: 2, style: { fontSize: 16, fontWeight: 600, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif' } }} />
                  <YAxis domain={[0, 0.4]} ticks={[0, 0.1, 0.2, 0.3, 0.4]} tick={{ fontSize: 14, fill: '#1a1a1a', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }} stroke="#1a1a1a" strokeWidth={1}
                    label={{
                      content: ({ viewBox }: any) => {
                        const { x, y, height } = viewBox || { x: 0, y: 0, height: 0 }
                        return (
                          <text x={x - ChartLayout.algorithmSelection.yLabelDx} y={y + height / 2} textAnchor="middle"
                            transform={`rotate(-90, ${x - ChartLayout.algorithmSelection.yLabelDx}, ${y + height / 2})`}
                            fontSize={16} fontWeight={600} fill="#1a1a1a" fontFamily="system-ui, sans-serif">
                            Silhouette Score
                          </text>
                        )
                      }
                    }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(val: number) => val.toFixed(4)} />
                  {fullScanMethods.map(m => (
                    <Scatter key={m} name={m} data={algoScatterData[m]} dataKey="silhouette"
                      fill={COLORS[m] || '#888'} line={{ stroke: COLORS[m] || '#888', strokeWidth: 1.5, strokeDasharray: '4 3' }}
                      shape={(props: any) => <circle cx={props.cx} cy={props.cy} r={5} fill={props.fill} opacity={0.85} />} />
                  ))}
                  {sparseMethods.map(m => (
                    <Scatter key={m} name={m} data={algoScatterData[m]} dataKey="silhouette" fill={COLORS[m] || '#888'}
                      shape={(props: any) => <polygon points={`${props.cx},${props.cy - 7} ${props.cx + 6},${props.cy} ${props.cx},${props.cy + 7} ${props.cx - 6},${props.cy}`} fill={props.fill} opacity={0.85} />} />
                  ))}
                  {bestPoint && (
                    <Scatter name="Best" data={[bestPoint]} dataKey="silhouette" fill="#dc2626"
                      shape={(props: any) => {
                        const r1 = 9, r2 = 4; const pts: string[] = []
                        for (let i = 0; i < 5; i++) {
                          const a1 = (Math.PI / 2) * -1 + (2 * Math.PI * i) / 5, a2 = a1 + Math.PI / 5
                          pts.push(`${props.cx + r1 * Math.cos(a1)},${props.cy + r1 * Math.sin(a1)}`)
                          pts.push(`${props.cx + r2 * Math.cos(a2)},${props.cy + r2 * Math.sin(a2)}`)
                        }
                        return <polygon points={pts.join(' ')} fill="#dc2626" opacity={0.95} stroke="#991b1b" strokeWidth={0.8} />
                      }} />
                  )}
                  <ReferenceLine y={0} stroke="oklch(0.5 0 0 / 0.18)" />
                </ScatterChart>
              </ResponsiveContainer>

            {/* Legend — algorithm names only */}
            <div data-legend="panel-b" style={{ position: 'absolute', top: 8, left: 150, maxWidth: 'calc(100% - 108px)', display: 'flex', flexWrap: 'wrap', gap: '1px 6px', pointerEvents: 'none' }}>
              {methods.map(m => (
                <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 14, fontWeight: 600, color: '#1a1a1a', background: 'rgba(255,255,255,0.2)', padding: '0px 3px', borderRadius: 3 }}>
                  <span style={{ width: 7, height: 7, background: COLORS[m] || '#888', borderRadius: '50%' }} />{m}
                </span>
              ))}
            </div>
            </div>
            {/* Caption */}
            <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
              <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
                <strong>B.</strong> Algorithm selection by silhouette score. Four algorithms evaluated across K = 0–30. Best result marked ★.
              </p>
            </div>
          </div>
        </div>
        )

        return (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'stretch' }}>
          {rightPanel && (
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {rightPanel}
            </div>
          )}
          {panelB}
        </div>
        )
      })()}

      {/* Permutation Test: Null Distributions */}
      {permutation && permutation.null_distributions && permutation.null_distributions.length > 0 && (
        <PermNullBoxPanel permutation={permutation} maxClusters={maxVisibleClusters} />
      )}

    </div>
  )
}