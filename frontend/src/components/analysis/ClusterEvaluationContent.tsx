import { useState, useMemo, useRef, useCallback } from 'react'
import {
  Camera,
  FileSpreadsheet,
} from 'lucide-react'
import { downloadPanelAsPNG } from '@/lib/svg-export'
import { downloadCSV } from '@/lib/export-csv'
import { TSNEChart } from './TSNEChart'
import { PCAChart } from './PCAChart'
import { UMAPChart } from './UMAPChart'
import { QualityDashboard } from './QualityDashboard'
import type { SequenceCluster } from '@/types/analysis'

interface PermutationData {
  p_values: number[]
  significant: boolean[]
  cluster_sizes: number[]
  threshold: number
  nPermutations?: number
}

interface ClusterEvaluationContentProps {
  data: SequenceCluster[]
  featureMode?: string
  silhouetteScore: number
  quality: string
  permutation?: PermutationData
  algorithmResults?: { method: string; K: number; silhouette: number }[]
  maxVisibleClusters: number
  onMaxVisibleClustersChange: (v: number) => void
}

export function ClusterEvaluationContent({
  data,
  featureMode,
  silhouetteScore,
  quality,
  permutation,
  algorithmResults,
  maxVisibleClusters,
  onMaxVisibleClustersChange,
}: ClusterEvaluationContentProps) {
  const [dimMethod, setDimMethod] = useState<'tsne' | 'pca' | 'umap'>('tsne')
  const [dotSize, setDotSize] = useState(3)

  const effectiveFeatureMode = useMemo(() => {
    if (!featureMode || featureMode === 'n/a') return undefined
    return featureMode
  }, [featureMode])

  if (data.length === 0) return null

  // Dim-reduction selector bar — method + dot size + feature badge
  const dimSelectorBar = (
    <div className="flex items-center flex-wrap gap-3" style={{ marginBottom: 10 }}>
      <select
        value={dimMethod}
        onChange={(e) => setDimMethod(e.target.value as 'tsne' | 'pca' | 'umap')}
        className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground cursor-pointer hover:border-primary/50 transition-colors"
      >
        <option value="tsne">t-SNE</option>
        <option value="pca">PCA</option>
        <option value="umap">UMAP</option>
      </select>
      <span className="text-[11px] text-muted-foreground">|</span>
      <span className="text-[10px] text-muted-foreground">Dot size</span>
      <input
        type="range" min={3} max={14} step={1}
        value={dotSize} onChange={(e) => setDotSize(Number(e.target.value))}
        className="w-16 h-1.5 cursor-pointer accent-primary"
      />
      <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'color-mix(in oklch, var(--primary) 8%, transparent)', color: 'var(--primary)' }}>
        {(() => {
          const fm = effectiveFeatureMode
          if (fm === 'structure-profile') return 'Feature: Structure Profile (48-dim)'
          if (fm === 'kmer') return 'Feature: k-mer'
          if (fm === 'hybrid') return 'Feature: k-mer + Structure Hybrid'
          if (fm === 'levenshtein') return 'Method: Levenshtein Edit Distance'
          if (fm === 'dot-bracket') return 'Method: dot-bracket Structure Match'
          return 'Feature: k-mer (4-mer)'
        })()}
      </span>
    </div>
  )

  // Right panel: (A) Sequence Cluster Map — t-SNE/PCA/UMAP
  const dimReductionPanel = (
    <div id="cluster-eval-dim-panel" className="border border-border rounded-xl bg-card overflow-hidden" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '8px 16px' }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <span className="text-xs font-semibold">A. Sequence Cluster Map</span>
          <span className="text-[11px] text-muted-foreground">|</span>
          <select
            value={dimMethod}
            onChange={(e) => setDimMethod(e.target.value as 'tsne' | 'pca' | 'umap')}
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground cursor-pointer hover:border-primary/50 transition-colors"
          >
            <option value="tsne">t-SNE</option>
            <option value="pca">PCA</option>
            <option value="umap">UMAP</option>
          </select>
          <span className="text-[10px] text-muted-foreground">Dot size</span>
          <input
            type="range" min={3} max={14} step={1}
            value={dotSize} onChange={(e) => setDotSize(Number(e.target.value))}
            className="w-14 h-1.5 cursor-pointer accent-primary"
          />
          <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'color-mix(in oklch, var(--primary) 8%, transparent)', color: 'var(--primary)' }}>
            {(() => {
              const fm = effectiveFeatureMode
              if (fm === 'structure-profile') return 'Structure Profile'
              if (fm === 'kmer') return 'k-mer'
              if (fm === 'hybrid') return 'k-mer + Structure'
              if (fm === 'levenshtein') return 'Levenshtein'
              if (fm === 'dot-bracket') return 'dot-bracket'
              return 'k-mer'
            })()}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 4 }}>
          <button title="Save as SVG"
            onClick={() => {
              const panel = document.getElementById('cluster-eval-dim-panel')
              if (panel) downloadPanelAsPNG(panel, 'sequence_cluster_map')
            }}
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <Camera size={13} />
          </button>
          <button title="Download CSV"
            onClick={() => {
              const hdrs = ['cluster', 'members', 'enrichment_score', 'cGcC', 'G4Hunter', 'G4NN', 'representative']
              const rows = data.map(c => [
                String(c.id),
                String(c.size),
                c.avgEnrichmentFold ? c.avgEnrichmentFold.toFixed(2) : '-',
                c.cGcC ? c.cGcC.toFixed(2) : '-',
                c.g4Hunter ? c.g4Hunter.toFixed(3) : '-',
                c.g4NN ? c.g4NN.toFixed(4) : '-',
                c.representative
              ])
              downloadCSV('cluster_overview.csv', hdrs, rows)
            }}
            className="flex items-center text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
            style={{ padding: '4px 8px' }}>
            <FileSpreadsheet size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '8px 20px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: dimMethod === 'tsne' ? 'block' : 'none', height: '100%' }}>
            <TSNEChart data={data} maxVisibleClusters={maxVisibleClusters} featureMode={effectiveFeatureMode} dotSize={dotSize} />
          </div>
          <div style={{ display: dimMethod === 'pca' ? 'block' : 'none', height: '100%' }}>
            <PCAChart data={data} maxVisibleClusters={maxVisibleClusters} featureMode={effectiveFeatureMode} dotSize={dotSize} />
          </div>
          <div style={{ display: dimMethod === 'umap' ? 'block' : 'none', height: '100%' }}>
            <UMAPChart data={data} maxVisibleClusters={maxVisibleClusters} featureMode={effectiveFeatureMode} dotSize={dotSize} />
          </div>
        </div>
      </div>
      {/* Caption */}
      <div className="rounded-lg border border-border/50 bg-muted/5" style={{ padding: '10px 14px', marginTop: 4 }}>
        <p className="text-xs font-semibold" style={{ marginBottom: 4 }}>
          <strong>A.</strong> Sequence cluster map. {dimMethod.toUpperCase()} dimensionality reduction of {data.reduce((s,c)=>s+c.size,0)} sequences on k-mer frequency vectors. Points colored by cluster (top 5 shown); grey = clusters 6+. Point size ∝ overlap count. Legend: transparent overlay, top-left.
        </p>
      </div>
    </div>
  )

  return (
    <div className="border border-border rounded-xl bg-card" style={{ marginBottom: 20 }}>
      {/* Header with cluster count + export */}
      <div
        className="flex items-center justify-between border-b border-border"
        style={{ padding: '8px 16px' }}
      >
        <h3 className="text-xs font-semibold flex items-center flex-wrap" style={{ gap: 10 }}>
          <Camera size={14} className="text-muted-foreground" />
          Cluster Quality Evaluation
          <span className="text-[11px] text-muted-foreground">|</span>
          <label className="text-[11px] text-muted-foreground whitespace-nowrap">Clusters shown</label>
          <input
            type="range"
            min={2}
            max={data.length}
            step={1}
            value={maxVisibleClusters || data.length}
            onChange={(e) => {
              const v = Number(e.target.value)
              onMaxVisibleClustersChange(v >= data.length ? 0 : v)
            }}
            className="w-24 h-1.5 cursor-pointer accent-primary"
          />
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {maxVisibleClusters <= 0 ? `All (${data.length})` : `${maxVisibleClusters}/${data.length}`}
          </span>
        </h3>
      </div>

      {/* Quality dashboard — silhouette × permutation (all modes) */}
      {silhouetteScore !== undefined && (
        <QualityDashboard
          silhouetteScore={silhouetteScore}
          quality={quality || 'unknown'}
          permutation={permutation}
          data={data}
          featureMode={featureMode}
          algorithmResults={algorithmResults}
          rightPanel={dimReductionPanel}
          maxVisibleClusters={maxVisibleClusters}
        />
      )}
    </div>
  )
}