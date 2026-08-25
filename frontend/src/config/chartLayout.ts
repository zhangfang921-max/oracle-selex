export const ChartLayout = {
  /** Panel A: Cluster Overview Bubble Chart */
  bubble: {
    margin: { top: 10, right: 10, bottom: 40, left: 35 },
    yLabelOffset: 0,
    yLabelDx: -8,
  },

  qualityScatter: {
    margin: { top: 20, right: 50, bottom: 40, left: 90 },
    yLabelOffset: -55,
    yLabelDx: -8,
  },

  qualityLine: {
    margin: { top: 5, right: 10, bottom: 30, left: 69 },
    yLabelOffset: -40,
    yLabelDx: -8,
  },

  /** Panel (A) t-SNE / PCA / UMAP (3:2) */
  dimReduction: {
    margin: { top: 20, right: 24, bottom: 40, left: 0 },
    yLabelOffset: 10,
    yLabelDx: -20,
  },

  /** Panel (B) Algorithm Selection (3:2) */
  algorithmSelection: {
    margin: { top: 8, right: 50, bottom: 40, left: 50 },
    yLabelOffset: 10,
    yLabelDx: -20,
  },

  /** Panel B: Cluster Size Distribution (BarChart) */
  clusterSize: {
    margin: { top: 10, right: 10, bottom: 40, left: 35 },
    yLabelOffset: -45,
    yLabelDx: -8,
  },

  /** Panel D: MFE Distribution */
  mfeDistribution: {
    margin: { top: 0, right: 5, bottom: 50, left: 5 },
    yLabelOffset: -45,
    yLabelDx: -8,
  },

  /** Panel E: Enrichment Fold */
  enrichmentBubble: {
    margin: { top: 0, right: 5, bottom: 40, left: 5 },
    yLabelOffset: -55,
    yLabelDx: -8,
  },

  enrichmentLine: {
    margin: { top: 5, right: 10, bottom: 5, left: 10 },
  },

  motif: {
    margin: { top: 5, right: 5, bottom: 40, left: 5 },
  },
} as const

/**
 * Compute a compact, "nice" axis domain + tick list from the actual data values.
 *
 * Replaces hard-coded domains (e.g. domain={[0, 0.06]}) which silently clip data
 * when a different sequencing file produces larger values. Step sizes snap to
 * 1 / 2 / 2.5 / 5 x 10^n so ticks stay on round numbers, and the range hugs the
 * data instead of padding out to an arbitrary fixed maximum.
 */
export function niceAxis(
  values: number[],
  opts: { targetTicks?: number; fromZero?: boolean; integer?: boolean; pad?: number } = {}
): { domain: [number, number]; ticks: number[] } {
  const { targetTicks = 6, fromZero = false, integer = false, pad = 0.05 } = opts
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { domain: [0, 1], ticks: [0, 0.5, 1] }

  const dataMin = Math.min(...finite)
  const dataMax = Math.max(...finite)
  let lo = dataMin
  let hi = dataMax

  if (hi === lo) {
    const d = Math.abs(hi) || 1
    hi += d * 0.5
    lo -= d * 0.5
  } else {
    const span = hi - lo
    hi += span * pad
    lo -= span * pad
  }

  // Anchor at zero only when the data itself is non-negative, otherwise a
  // "fromZero" axis would gain a meaningless negative lower bound.
  const anchorZero = fromZero && dataMin >= 0
  if (anchorZero) lo = 0

  const rawStep = (hi - lo) / Math.max(1, targetTicks)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  let mult = 1
  if (norm > 5) mult = 10
  else if (norm > 2.5) mult = 5
  else if (norm > 2) mult = 2.5
  else if (norm > 1) mult = 2
  let step = mult * mag
  if (integer) step = Math.max(1, Math.round(step))

  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step)) + 1))
  const start = anchorZero ? 0 : Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step

  const ticks: number[] = []
  for (let v = start; v <= end + step * 1e-6; v += step) {
    const t = Number(v.toFixed(decimals))
    if (ticks.length === 0 || t !== ticks[ticks.length - 1]) ticks.push(t)
    if (ticks.length > 40) break
  }
  if (ticks.length < 2) return { domain: [start, start + step], ticks: [start, start + step] }

  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks }
}