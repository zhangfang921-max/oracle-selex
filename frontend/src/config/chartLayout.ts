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