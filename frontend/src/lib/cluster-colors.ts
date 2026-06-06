/**
 * Maximally-distinct cluster color + shape encoding
 *
 * For >10 clusters, color alone is insufficient. We use:
 *   1. A hand-picked 25-color palette with maximum perceptual distance
 *      (alternating hue sectors, lightness, and chroma)
 *   2. 5 distinct SVG shapes, cycling every 5 clusters
 *      → "color group" + "shape group" gives 25 unique combinations
 */

// 25 hand-picked colors: 5 hue families × 5 lightness/chroma variants
// Ordered so consecutive IDs always pick from different hue families
const PALETTE: string[] = [
  // Row 1: one from each of 5 hue families (most vivid)
  'oklch(0.60 0.26 25)',    // #1  vivid red
  'oklch(0.62 0.24 165)',   // #2  vivid green
  'oklch(0.58 0.26 260)',   // #3  vivid blue
  'oklch(0.68 0.22 60)',    // #4  vivid orange-yellow
  'oklch(0.58 0.24 310)',   // #5  vivid purple

  // Row 2: lighter variants
  'oklch(0.75 0.20 15)',    // #6  light coral
  'oklch(0.76 0.18 155)',   // #7  light mint
  'oklch(0.72 0.20 240)',   // #8  light blue
  'oklch(0.80 0.18 80)',    // #9  light yellow-green
  'oklch(0.73 0.20 295)',   // #10 light violet

  // Row 3: darker/muted variants
  'oklch(0.50 0.22 30)',    // #11 dark red-brown
  'oklch(0.50 0.20 170)',   // #12 dark teal
  'oklch(0.48 0.22 255)',   // #13 dark navy
  'oklch(0.55 0.22 45)',    // #14 dark amber
  'oklch(0.48 0.22 320)',   // #15 dark magenta

  // Row 4: shifted hue variants
  'oklch(0.65 0.24 0)',     // #16 pure red
  'oklch(0.65 0.22 130)',   // #17 yellow-green
  'oklch(0.62 0.26 220)',   // #18 cyan-blue
  'oklch(0.72 0.24 90)',    // #19 lime
  'oklch(0.62 0.22 280)',   // #20 indigo

  // Row 5: high-contrast fillers
  'oklch(0.55 0.18 355)',   // #21 crimson
  'oklch(0.70 0.20 185)',   // #22 aqua
  'oklch(0.55 0.20 210)',   // #23 steel blue
  'oklch(0.75 0.22 55)',    // #24 gold
  'oklch(0.55 0.20 340)',   // #25 rose
]

// SVG shape paths for 5 shape types (all centered at 0,0 with r≈6)
export const CLUSTER_SHAPES = [
  'circle',    // shape 0: clusters 1-5
  'square',    // shape 1: clusters 6-10
  'triangle',  // shape 2: clusters 11-15
  'diamond',   // shape 3: clusters 16-20
  'cross',     // shape 4: clusters 21-25
] as const

export type ClusterShape = typeof CLUSTER_SHAPES[number]

export function getClusterColor(clusterId: number): string {
  const idx = (clusterId - 1) % PALETTE.length
  return PALETTE[idx]
}

export function getClusterShape(clusterId: number): ClusterShape {
  const idx = Math.floor((clusterId - 1) / 5) % CLUSTER_SHAPES.length
  return CLUSTER_SHAPES[idx]
}

export function getClusterColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => getClusterColor(i + 1))
}

/** Render an SVG shape element for scatter charts */
export function renderShapePath(
  shape: ClusterShape,
  cx: number,
  cy: number,
  r: number,
  color: string,
  opacity = 0.85,
): string {
  switch (shape) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.8" stroke-opacity="0.4"/>`
    case 'square': {
      const s = r * 1.55
      return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.8" stroke-opacity="0.4"/>`
    }
    case 'triangle': {
      const h = r * 1.7
      const pts = `${cx},${cy - h} ${cx - h},${cy + h * 0.5} ${cx + h},${cy + h * 0.5}`
      return `<polygon points="${pts}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.8" stroke-opacity="0.4"/>`
    }
    case 'diamond': {
      const d = r * 1.6
      const pts = `${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`
      return `<polygon points="${pts}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.8" stroke-opacity="0.4"/>`
    }
    case 'cross': {
      const t = r * 0.45
      const o = r * 1.4
      return `<path d="M${cx - t},${cy - o} L${cx + t},${cy - o} L${cx + t},${cy - t} L${cx + o},${cy - t} L${cx + o},${cy + t} L${cx + t},${cy + t} L${cx + t},${cy + o} L${cx - t},${cy + o} L${cx - t},${cy + t} L${cx - o},${cy + t} L${cx - o},${cy - t} L${cx - t},${cy - t} Z" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.6" stroke-opacity="0.4"/>`
    }
  }
}
