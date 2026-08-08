import { useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Layers,
  Download,
  Loader2,
  Upload,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FadeIn } from '@/components/MotionPrimitives'
import { OverviewPanel } from '@/components/analysis/OverviewPanel'
import { ClusterPanel } from '@/components/analysis/ClusterPanel'
import { ClusterEvaluationFigure } from '@/components/analysis/ClusterEvaluationFigure'
import { ClusterEvaluationContent } from '@/components/analysis/ClusterEvaluationContent'
import { ClusterNetworkGraph } from '@/components/analysis/ClusterNetworkGraph'
import {
  useAnalysisDetail,
  useCluster,
  useExportExcel,
} from '@/hooks/use-analysis'
import { toast } from 'sonner'
import type { SequenceCluster } from '@/types/analysis'

/* ── Workflow Step Indicator ──────────────────────────────────────────── */

interface WorkflowStep {
  id: number
  label: string
  done: boolean
  active: boolean
  description: string
}

function WorkflowSteps({ steps }: { steps: WorkflowStep[] }) {
  return (
    <FadeIn>
      <div
        className="flex items-center justify-center flex-wrap rounded-xl bg-muted/50"
        style={{
          padding: '10px var(--spacing-md)',
          marginBottom: 'var(--spacing-lg)',
          gap: '6px',
        }}
      >
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center" style={{ gap: '6px' }}>
            <div
              className={`flex items-center rounded-lg transition-all ${
                step.done
                  ? 'bg-primary/15 text-primary'
                  : step.active
                    ? 'bg-primary/10 text-primary shadow-sm'
                    : 'bg-background text-muted-foreground'
              }`}
              style={{
                padding: '6px 14px',
                gap: '6px',
                fontSize: 'var(--font-size-small)',
                border: step.active ? '1px solid color-mix(in oklch, var(--primary) 30%, transparent)' : '1px solid transparent',
              }}
            >
              {step.done ? (
                <CheckCircle2 size={14} style={{ color: 'var(--primary)' }} />
              ) : (
                <span className="font-mono text-xs" style={{ opacity: 0.5 }}>{step.id}</span>
              )}
              <span className={`font-medium ${step.done || step.active ? '' : 'opacity-50'}`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <ChevronRight size={14} className="text-muted-foreground" style={{ opacity: 0.3 }} />
            )}
          </div>
        ))}
      </div>
    </FadeIn>
  )
}

/* ── Main Page ────────────────────────────────────────────────────── */

export default function AnalysisPage() {
  const { analysisId } = useParams<{ analysisId: string }>()
  const navigate = useNavigate()
  const { data: analysis, isLoading } = useAnalysisDetail(analysisId ?? null)

  // Analysis state
  const [clusterData, setClusterData] = useState<SequenceCluster[]>([])
  const [activeTab, setActiveTab] = useState('overview')

  // Filter controls for clustering
  const [minReadCount, setMinReadCount] = useState(2)
  const [topN, setTopN] = useState(500)
  const [clusterMode, setClusterMode] = useState<'sequence' | 'auto-optimal'>('auto-optimal')
  const [identityThreshold, setIdentityThreshold] = useState(0.7)
  const [optimalMethod, setOptimalMethod] = useState<'auto' | 'hierarchical' | 'kmeans' | 'gmm' | 'spectral'>('auto')
  const [primerMode, setPrimerMode] = useState<'auto' | 'manual'>('auto')
  const [forwardPrimer, setForwardPrimer] = useState('')
  const [reversePrimer, setReversePrimer] = useState('')
  // Profile mode settings
  const [nPermutations, setNPermutations] = useState(1000)
  const [significanceThreshold, setSignificanceThreshold] = useState(0.05)
  // Selection criterion for auto-optimal modes
  const [selectionCriterion, setSelectionCriterion] = useState<'silhouette' | 'davies_bouldin' | 'calinski_harabasz'>('silhouette')
  // Min clusters for DB/CH (prevents collapsing to K=2)
  const [minClusters, setMinClusters] = useState(2)
  // Two-stage clustering: high-abundance anchor threshold (0=disabled, 0-1=percentile, >=2=absolute)
  const [abundanceThreshold, setAbundanceThreshold] = useState(0)
  // Abundance-weighted clustering: weight sequences by read count
  // 'off' = equal weight, 'linear' = raw reads, 'sqrt' = sqrt(read_count), 'log' = log(1+read_count)
  const [weightingScheme, setWeightingScheme] = useState<string>('off')

  // Shared cluster visibility slider (used by evaluation + figure)
  const [maxVisibleClusters, setEvalMaxClusters] = useState(0)

  // Clustering metadata (which algorithm was selected, quality, etc.)
  interface ClusterMeta {
    method: string
    silhouetteScore: number
    quality: string
    numClusters: number
    kmerSize: number
    featureMode: string
    variableLen: number
    algorithmResults?: {
      method: string
      K: number
      silhouette: number
    }[]
    permutation?: {
      p_values: number[]
      significant: boolean[]
      cluster_sizes: number[]
      threshold: number
    }
    abundance?: {
      enrichment_scores: number[]
      enrichment_pvalues: number[]
      model: string
      parameters: { mu: number; var: number; r: number }
    }
  }
  const [clusterMeta, setClusterMeta] = useState<ClusterMeta | null>(null)

  // Progress tracking for clustering
  interface ProgressStep {
    label: string
    status: 'pending' | 'running' | 'done' | 'error'
    detail?: string
  }
  const [clusterProgress, setClusterProgress] = useState<ProgressStep[]>([])
  const [isOptimalRunning, setIsOptimalRunning] = useState(false)

  // Mutations
  const clusterMutation = useCluster()
  const exportMutation = useExportExcel()

  // Background permutation test runner for sequence/structure modes
  const permRunner = useCallback(async (sequences: string[], clusters: SequenceCluster[]) => {
    try {
      const seqList: string[] = []
      const clusterIds: number[] = []
      clusters.forEach((c) => {
        c.members.forEach((m) => {
          seqList.push(m.sequence)
          clusterIds.push(c.id)
        })
        if (c.members.length === 0) {
          seqList.push(c.representative)
          clusterIds.push(c.id)
        }
      })
      const resp = await fetch('/api/analysis/cluster_permutation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequences: seqList,
          clusterIds,
          nPermutations: 1000,
          featureMode: 'kmer',
        }),
      })
      if (!resp.ok) return
      const data = await resp.json()
      if (data.success && data.permutation) {
        setClusterMeta((prev) => prev ? { ...prev, permutation: data.permutation } : null)
      }
    } catch {
      // Silently ignore — permutation test is optional
    }
  }, [clusterMode])

  // Build sequence entries directly from analysis rounds (sorted by read count)
  const getSequenceEntries = useCallback(() => {
    if (!analysis || analysis.rounds.length === 0) return []
    // Aggregate sequences across all rounds, use last round's data for read count
    const seqMap = new Map<string, { sequence: string; maxPercentRead: number; totalReads: number; presentInRounds: number; enrichmentFold: number | null; rounds: { roundNumber: number; readCount: number; percentRead: number }[] }>()
    const roundNumbers = analysis.rounds.map((r: any) => r.roundNumber).sort((a: number, b: number) => a - b)
    const lastRoundNum = roundNumbers[roundNumbers.length - 1]

    for (const round of analysis.rounds) {
      for (const seq of round.sequences || []) {
        const existing = seqMap.get(seq.sequence)
        if (!existing) {
          seqMap.set(seq.sequence, {
            sequence: seq.sequence,
            maxPercentRead: Number(seq.percentRead || 0),
            totalReads: Number(seq.readCount || 0),
            presentInRounds: 1, rounds: [],
            enrichmentFold: null,
          })
        } else {
          existing.presentInRounds++; existing.rounds = []
          existing.totalReads += Number(seq.readCount || 0)
          existing.maxPercentRead = Math.max(existing.maxPercentRead, Number(seq.percentRead || 0))
        }
      }
    }

    // Filter and sort by totalReads desc, take topN
    let entries = Array.from(seqMap.values())
      .filter((e) => e.totalReads >= minReadCount)
      .sort((a, b) => b.totalReads - a.totalReads)
      .slice(0, topN)

    return entries
  }, [analysis, minReadCount, topN])

  const updateStep = useCallback((steps: ProgressStep[], index: number, update: Partial<ProgressStep>): ProgressStep[] => {
    const next = [...steps]
    next[index] = { ...next[index], ...update }
    return next
  }, [])

  const runClustering = useCallback(async () => {
    const entries = getSequenceEntries()
    if (entries.length === 0) {
      toast.error('No sequences meet filter criteria')
      return
    }

    if (clusterMode === 'auto-optimal') {
      let steps: ProgressStep[] = [
        { label: 'Preparing sequences', status: 'pending', detail: `${entries.length} sequences` },
        { label: 'Computing k-mer features', status: 'pending', detail: '4-mer frequency vectors' },
        { label: 'Finding optimal clusters', status: 'pending', detail: `Algorithm: ${optimalMethod === 'auto' ? 'Auto (best of all)' : optimalMethod}` },
        { label: 'G4 quadruplex screening', status: 'pending', detail: 'Scoring cluster representatives' },
        { label: 'RNA structure prediction', status: 'pending', detail: 'Folding with and without G4' },
        { label: 'Finalizing results', status: 'pending' },
      ]
      setClusterProgress(steps)
      setIsOptimalRunning(true)

      try {
        // Step 1: Prepare
        steps = updateStep(steps, 0, { status: 'running' })
        setClusterProgress([...steps])
        const sequences = entries.map((e) => e.sequence)
        const readCounts = entries.map((e) => e.totalReads)
        await new Promise((r) => setTimeout(r, 300))
        steps = updateStep(steps, 0, { status: 'done', detail: `${sequences.length} sequences ready` })
        setClusterProgress([...steps])

        // Step 2: k-mer features + clustering
        steps = updateStep(steps, 1, { status: 'running' })
        setClusterProgress([...steps])

        // Step 3: Optimal clustering call (covers steps 2+3)
        // Enhanced: uses GMM, HDBSCAN, Spectral + hybrid features automatically
        const resp = await fetch('/api/analysis/optimal_cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sequences,
            method: optimalMethod,
            maxClusters: 30,
            ...(minClusters > 2 ? { minClusters } : {}),
            featureMode: 'auto',
            doPermutationTest: true,
            nPermutations: 1000,
            selectionCriterion,
            readCounts,
            ...(abundanceThreshold > 0 ? { abundanceThreshold } : {}),
            ...(primerMode === 'manual' && forwardPrimer.trim() ? { forwardPrimer: forwardPrimer.trim() } : {}),
            ...(primerMode === 'manual' && reversePrimer.trim() ? { reversePrimer: reversePrimer.trim() } : {}),
          }),
        })
        if (!resp.ok) throw new Error('Optimal clustering failed')
        const optResult = await resp.json()
        if (!optResult.success) throw new Error(optResult.message)

        steps = updateStep(steps, 1, { status: 'done', detail: `${optResult.kmerSize}-mer${optResult.featureMode === 'hybrid' ? ' + gapped + structural' : ''}, ${optResult.variableLen}bp variable region` })
        steps = updateStep(steps, 2, { status: 'done', detail: `${optResult.numClusters} clusters (${optResult.method}, silhouette=${optResult.silhouetteScore?.toFixed(3)}, ${optResult.quality || 'unknown'})` })
        setClusterProgress([...steps])

        // Store clustering metadata for display in results
        setClusterMeta({
          method: `Auto-Optimal ML (${optResult.method})`,
          silhouetteScore: optResult.silhouetteScore,
          quality: optResult.quality || 'unknown',
          numClusters: optResult.numClusters,
          kmerSize: optResult.kmerSize,
          featureMode: optResult.featureMode,
          variableLen: optResult.variableLen,
          ...(optResult.permutation ? { permutation: optResult.permutation } : {}),
          ...(optResult.abundance ? { abundance: optResult.abundance } : {}),
          ...(optResult.algorithmResults ? { algorithmResults: optResult.algorithmResults } : {}),
        })

        // Step 4+5: G4 + RNA (handled by backend cluster endpoint)
        steps = updateStep(steps, 3, { status: 'running' })
        setClusterProgress([...steps])

        const result = await clusterMutation.mutateAsync({
          enrichmentData: entries,
          identityThreshold,
          clusterMode: 'sequence',
          optimalClusterIds: optResult.clusterIds,
        })

        steps = updateStep(steps, 3, { status: 'done', detail: `${result.length} representatives scored` })
        steps = updateStep(steps, 4, { status: 'done', detail: 'Folding complete' })
        steps = updateStep(steps, 5, { status: 'done', detail: `${result.length} clusters ready` })
        setClusterProgress([...steps])

        await new Promise((r) => setTimeout(r, 600))
        setClusterData(result)
        toast.success(`Auto-Optimal ML: ${optResult.numClusters} clusters (${optResult.method}, silhouette=${optResult.silhouetteScore?.toFixed(3)})`)
        setActiveTab('clusters')
      } catch (err: any) {
        const failIdx = steps.findIndex((s) => s.status === 'running')
        if (failIdx >= 0) {
          steps = updateStep(steps, failIdx, { status: 'error', detail: err.message })
          setClusterProgress([...steps])
        }
        toast.error(err.message || 'Optimal clustering failed')
      } finally {
        setTimeout(() => setIsOptimalRunning(false), 1500)
      }
    } else {
      let steps: ProgressStep[] = [
        { label: 'Preparing sequences', status: 'pending', detail: `${entries.length} sequences` },
        { label: 'Running clustering', status: 'pending', detail: `${clusterMode === 'sequence' ? 'Sequence Identity' : 'Structure dot-bracket'}, threshold ${(identityThreshold * 100).toFixed(0)}%` },
        { label: 'G4 screening & RNA folding', status: 'pending' },
        { label: 'Finalizing results', status: 'pending' },
      ]
      setClusterProgress(steps)
      setIsOptimalRunning(true)

      try {
        steps = updateStep(steps, 0, { status: 'done' })
        steps = updateStep(steps, 1, { status: 'running' })
        setClusterProgress([...steps])

        const result = await clusterMutation.mutateAsync({
          enrichmentData: entries,
          identityThreshold,
          clusterMode,
        })

        steps = updateStep(steps, 1, { status: 'done', detail: `${result.length} clusters formed` })
        steps = updateStep(steps, 2, { status: 'done' })
        steps = updateStep(steps, 3, { status: 'done', detail: `${result.length} clusters ready` })
        setClusterProgress([...steps])

        await new Promise((r) => setTimeout(r, 600))
        setClusterData(result)
        setClusterMeta({
          method: clusterMode === 'sequence' ? 'Sequence Identity' : 'Structure dot-bracket',
          silhouetteScore: -1, // Not applicable for greedy methods
          quality: 'n/a',
          numClusters: result.length,
          kmerSize: 0,
          featureMode: 'kmer',
          variableLen: 0,
        })

        // Kick off permutation test in background (non-blocking)
        permRunner(entries.map((e: any) => e.sequence), result)
        toast.success(`Grouped into ${result.length} clusters (${clusterMode === 'sequence' ? 'Sequence Identity' : 'Structure dot-bracket'})`)
        setActiveTab('clusters')
      } catch {
        const failIdx = steps.findIndex((s) => s.status === 'running')
        if (failIdx >= 0) {
          steps = updateStep(steps, failIdx, { status: 'error', detail: 'Clustering failed' })
          setClusterProgress([...steps])
        }
        toast.error('Clustering failed')
      } finally {
        setTimeout(() => setIsOptimalRunning(false), 1500)
      }
    }
  }, [getSequenceEntries, clusterMutation, clusterMode, identityThreshold, optimalMethod, forwardPrimer, reversePrimer, updateStep, permRunner])

  const handleExport = useCallback(async () => {
    if (!analysisId) return
    try {
      const entries = getSequenceEntries()
      const enrichmentForExport = entries.map((e) => ({
        sequence: e.sequence,
        rounds: e.rounds || [],
        enrichmentFold: e.enrichmentFold ?? null,
        maxPercentRead: e.maxPercentRead,
        totalReads: e.totalReads,
        presentInRounds: e.presentInRounds,
      }))
      const blob = await exportMutation.mutateAsync({
        analysisId,
        enrichmentData: enrichmentForExport,
        clusterData,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${analysis?.name || 'selex'}_results.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Excel file downloaded')
    } catch {
      toast.error('Export failed')
    }
  }, [analysisId, analysis, exportMutation, getSequenceEntries, clusterData])

  // ── Z-score sorted data for Evaluation tab (consistent with Cluster Details) ──
  const evaluationData = useMemo(() => {
    const scores = clusterMeta?.abundance?.enrichment_scores
    if (!scores || scores.length === 0) return clusterData
    // Sort by Z-score descending, remap cluster IDs to rank
    return [...clusterData]
      .sort((a, b) => {
        const za = scores[a.id - 1] ?? -Infinity
        const zb = scores[b.id - 1] ?? -Infinity
        return zb - za
      })
      .map((cluster, idx) => ({
        ...cluster,
        id: idx + 1,  // Z-score rank becomes the new ID
        members: cluster.members.map(m => ({ ...m })),
      }))
  }, [clusterData, clusterMeta])

  // ── Remapped permutation data (indexed by Z-score rank, not original cluster ID) ──
  const evaluationPermutation = useMemo(() => {
    const perm = clusterMeta?.permutation
    const scores = clusterMeta?.abundance?.enrichment_scores
    if (!perm || !scores || scores.length === 0) return perm
    // Build Z-score order mapping: original-id-1 → new-rank
    const order = clusterData
      .map((c, i) => ({ id: c.id, score: scores[c.id - 1] ?? -Infinity }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.id - 1)  // 0-based original indices
    return {
      p_values: order.map(i => perm.p_values[i] ?? 0),
      significant: order.map(i => perm.significant[i] ?? false),
      cluster_sizes: order.map(i => perm.cluster_sizes[i] ?? 0),
      threshold: perm.threshold,
      nPermutations: (perm as any).nPermutations,
      null_distributions: (perm as any).null_distributions ? order.map(i => (perm as any).null_distributions[i] ?? []) : undefined,
      observed_compactness: (perm as any).observed_compactness ? order.map(i => (perm as any).observed_compactness[i] ?? 0) : undefined,
    }
  }, [clusterData, clusterMeta])

  // Workflow steps (simplified to 2)
  const workflowSteps: WorkflowStep[] = [
    {
      id: 1,
      label: 'Cluster',
      done: clusterData.length > 0,
      active: clusterMutation.isPending,
      description: 'Group similar sequences',
    },
    {
      id: 2,
      label: 'Export',
      done: false,
      active: clusterData.length > 0,
      description: 'Download results as Excel',
    },
  ]

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '60vh', gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading analysis data...</p>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="container max-w-4xl text-center" style={{ padding: 'var(--spacing-3xl)' }}>
        <p className="text-muted-foreground">Analysis not found.</p>
        <Button onClick={() => navigate('/')} className="cursor-pointer" style={{ marginTop: 'var(--spacing-md)' }}>
          Go Home
        </Button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* ── Header — Glass morphism sticky bar ── */}
      <header
        className="border-b border-border/50 sticky top-0 z-10"
        style={{ padding: 'var(--spacing-md) var(--spacing-xl)', background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        <div className="container max-w-7xl flex items-center justify-between">
          <div className="flex items-center" style={{ gap: 'var(--spacing-md)' }}>
            <button
              onClick={() => navigate('/')}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center" style={{ gap: 'var(--spacing-xs)' }}>
                <span className="text-xs font-semibold text-primary tracking-widest uppercase">ORACLE</span>
                <span className="text-xs text-muted-foreground">/</span>
                <h1 className="font-bold" style={{ fontSize: 'var(--font-size-headline)', fontFamily: 'var(--font-family-heading)' }}>
                  {analysis.name}
                </h1>
              </div>
              <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)' }}>
                {analysis.rounds.length} rounds &middot; Created{' '}
                {new Date(analysis.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 'var(--spacing-sm)' }}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/')}
              className="cursor-pointer"
            >
              <Upload className="w-4 h-4 mr-1" />
              New Analysis
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exportMutation.isPending || clusterData.length === 0}
              className="cursor-pointer"
            >
              {exportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              Export
            </Button>
          </div>
        </div>
      </header>

      <div className="container max-w-7xl" style={{ padding: 'var(--spacing-lg) var(--spacing-xl)' }}>
        {/* Workflow Steps */}
        <WorkflowSteps steps={workflowSteps} />

        {/* ── Tabs — Glassmorphism pill navigation ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <FadeIn>
            <TabsList
              className="rounded-xl border border-border/50"
              style={{ marginBottom: 'var(--spacing-lg)', padding: 4, background: 'var(--glass-bg)', backdropFilter: 'blur(12px)' }}
            >
              <TabsTrigger
                value="overview"
                className="rounded-lg cursor-pointer font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm"
                style={{ fontSize: 'var(--font-size-body)', padding: '10px 24px' }}
              >
                <BarChart3 className="w-5 h-5 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="clusters"
                className="rounded-lg cursor-pointer font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm"
                style={{ fontSize: 'var(--font-size-body)', padding: '10px 24px' }}
              >
                <Layers className="w-5 h-5 mr-2" />
                Clusters
                {clusterData.length > 0 && (
                  <span className="ml-1.5 text-xs opacity-70 font-normal">({clusterData.length})</span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="evaluation"
                className="rounded-lg cursor-pointer font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm"
                style={{
                  fontSize: 'var(--font-size-body)',
                  padding: '10px 24px',
                  display: (clusterData.length > 0 && clusterMeta) ? undefined : 'none',
                }}
              >
                <Activity className="w-5 h-5 mr-2" />
                Evaluation
              </TabsTrigger>
            </TabsList>
          </FadeIn>

          <TabsContent value="overview">
            <OverviewPanel
              analysis={analysis}
              enrichmentData={[]}
              clusterData={clusterData}
              isEnrichmentLoading={false}
            />

            {/* Progress panel during clustering */}
            {isOptimalRunning && clusterProgress.length > 0 && (
              <FadeIn>
                <div
                  className="rounded-xl border shadow-sm overflow-hidden"
                  style={{
                    marginTop: 'var(--spacing-lg)',
                    background: 'var(--card)',
                    borderColor: 'color-mix(in oklch, var(--primary) 25%, var(--border))',
                  }}
                >
                  <div
                    className="flex items-center border-b border-border"
                    style={{ padding: '12px 20px', gap: 8 }}
                  >
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span className="text-sm font-semibold">Clustering in progress...</span>
                    <span className="text-xs text-muted-foreground">
                      {clusterProgress.filter((s) => s.status === 'done').length}/{clusterProgress.length} steps
                    </span>
                  </div>
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {clusterProgress.map((step, idx) => (
                        <div key={idx} className="flex items-start" style={{ gap: 10 }}>
                          <div style={{ width: 20, flexShrink: 0, paddingTop: 1 }}>
                            {step.status === 'done' && <CheckCircle2 size={16} className="text-green-500" />}
                            {step.status === 'running' && <Loader2 size={16} className="animate-spin text-primary" />}
                            {step.status === 'error' && (
                              <div className="rounded-full" style={{ width: 16, height: 16, background: 'var(--destructive)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>!</span>
                              </div>
                            )}
                            {step.status === 'pending' && (
                              <div className="rounded-full border-2 border-muted-foreground/30" style={{ width: 16, height: 16 }} />
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className={`text-sm ${
                              step.status === 'running' ? 'font-semibold text-foreground' :
                              step.status === 'done' ? 'text-muted-foreground' :
                              step.status === 'error' ? 'font-semibold text-red-600' :
                              'text-muted-foreground/60'
                            }`}>
                              {step.label}
                            </p>
                            {step.detail && (
                              <p className={`text-xs ${step.status === 'error' ? 'text-red-500' : 'text-muted-foreground'}`} style={{ marginTop: 1 }}>
                                {step.detail}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Progress bar */}
                    <div className="rounded-full overflow-hidden" style={{ height: 4, marginTop: 14, background: 'var(--muted)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(clusterProgress.filter((s) => s.status === 'done').length / clusterProgress.length) * 100}%`,
                          background: clusterProgress.some((s) => s.status === 'error') ? 'var(--destructive)' : 'var(--primary)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Action prompt for clustering */}
            {clusterData.length === 0 && !clusterMutation.isPending && !isOptimalRunning && (
              <FadeIn>
                <div
                  className="flex flex-col rounded-xl border shadow-sm"
                  style={{
                    padding: '20px 24px',
                    marginTop: 'var(--spacing-lg)',
                    background: 'color-mix(in oklch, var(--primary) 4%, var(--card))',
                    borderColor: 'color-mix(in oklch, var(--primary) 20%, var(--border))',
                    gap: 16,
                  }}
                >
                  <div>
                    <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)' }}>
                      Ready to cluster sequences
                    </p>
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-label)', marginTop: 4 }}>
                      {clusterMode === 'auto-optimal'
                        ? `Auto-Optimal ML — k-mer features, auto-selects best algorithm & K (min reads: ${minReadCount}, top ${topN}).`
                        : `Sequence Identity — Levenshtein edit distance clustering (threshold: ${(identityThreshold * 100).toFixed(0)}%, min reads: ${minReadCount}, top ${topN}).`}
                    </p>
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
                    <div className="flex flex-col" style={{ gap: 4 }}>
                      <div className="flex items-center" style={{ gap: 6 }}>
                        <label className="text-xs text-muted-foreground whitespace-nowrap">Mode</label>
                        <select
                          value={clusterMode}
                          onChange={(e) => setClusterMode(e.target.value as any)}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                        >
                          <optgroup label="Sequence">
                            <option value="sequence">Manual (Sequence Identity)</option>
                            <option value="auto-optimal">Auto-Optimal ML</option>
                          </optgroup>
                        </select>
                      </div>
                      <span className="text-[10px] text-muted-foreground" style={{ maxWidth: 220 }}>
                        {clusterMode === 'auto-optimal' && 'Auto-Optimal ML — k-mer features + ML auto-select K'}
                        {clusterMode === 'sequence' && 'Sequence Identity — Levenshtein edit distance'}


                      </span>
                    </div>
                    {clusterMode === 'auto-optimal' && (
                      <div className="flex flex-col" style={{ gap: 4 }}>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Algorithm</label>
                          <select
                            value={optimalMethod}
                            onChange={(e) => setOptimalMethod(e.target.value as any)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                          >
                            <option value="auto">Auto (best of all)</option>
                            <option value="hierarchical">Hierarchical</option>
                            <option value="kmeans">K-Means</option>
                            <option value="gmm">GMM (Gaussian Mixture)</option>
                            <option value="spectral">Spectral</option>
                          </select>
                        </div>
                        <span className="text-[10px] text-muted-foreground" style={{ maxWidth: 320 }}>
                          {optimalMethod === 'auto' && 'Tries all 6 algorithms + hybrid features, picks highest silhouette'}
                          {optimalMethod === 'hierarchical' && 'Merges nearest clusters bottom-up; tries ward/average/complete linkage'}
                          {false && 'Density-based; auto-detects K; handles noise/outliers'}
                          {false && 'Adaptive density; finds clusters of varying densities automatically'}
                          {optimalMethod === 'kmeans' && 'Fixed K partitioning; fast but assumes spherical clusters'}
                          {optimalMethod === 'gmm' && 'Gaussian Mixture; handles elliptical/overlapping clusters in converged pools'}
                          {optimalMethod === 'spectral' && 'Graph-based; excellent for non-convex cluster shapes'}
                        </span>
                      </div>
                    )}
                    {/* Selection criterion dropdown (auto-optimal modes only) */}
                    {clusterMode === 'auto-optimal' && (
                      <div className="flex flex-col" style={{ gap: 4 }}>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Selection Criterion</label>
                          <select
                            value={selectionCriterion}
                            onChange={(e) => setSelectionCriterion(e.target.value as any)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                          >
                            <option value="silhouette">Silhouette</option>
                            <option value="davies_bouldin">Davies-Bouldin</option>
                            <option value="calinski_harabasz">Calinski-Harabasz</option>
                          </select>
                        </div>
                        <span className="text-[10px] text-muted-foreground" style={{ maxWidth: 220 }}>
                          {selectionCriterion === 'silhouette' && 'Prefers compact spherical clusters. Higher = better.'}
                          {selectionCriterion === 'davies_bouldin' && 'No shape assumption. Lower = better. Stable across algorithms.'}
                          {selectionCriterion === 'calinski_harabasz' && 'Between/within-cluster variance ratio. Prefers well-separated clusters.'}
                        </span>
                      </div>
                    )}
                    {/* Min clusters (auto-optimal: prevents DB/CH collapsing to K=2) */}
                    {clusterMode === 'auto-optimal' && (
                      <div className="flex items-center" style={{ gap: 6 }}>
                        <label className="text-xs text-muted-foreground whitespace-nowrap">Min Clusters</label>
                        <input
                          type="number" min={2} max={30} value={minClusters}
                          onChange={(e) => setMinClusters(Math.max(2, parseInt(e.target.value) || 2))}
                          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
                        />
                      </div>
                    )}
{false && (
                      <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Permutations</label>
                          <select value={nPermutations} onChange={(e) => setNPermutations(Number(e.target.value))}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer">
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000</option>
                            <option value={2000}>2000</option>
                          </select>
                        </div>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <label className="text-xs text-muted-foreground whitespace-nowrap">p threshold</label>
                          <select value={significanceThreshold} onChange={(e) => setSignificanceThreshold(Number(e.target.value))}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer">
                            <option value={0.01}>0.01</option>
                            <option value={0.05}>0.05</option>
                            <option value={0.1}>0.10</option>
                          </select>
                        </div>
                      </div>
                    )}
                    {/* Selection criterion dropdown (profile mode) */}
{false && (
                      <div className="flex flex-col" style={{ gap: 4 }}>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Selection Criterion</label>
                          <select
                            value={selectionCriterion}
                            onChange={(e) => setSelectionCriterion(e.target.value as any)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                          >
                            <option value="silhouette">Silhouette</option>
                            <option value="davies_bouldin">Davies-Bouldin</option>
                            <option value="calinski_harabasz">Calinski-Harabasz</option>
                          </select>
                        </div>
                        <span className="text-[10px] text-muted-foreground" style={{ maxWidth: 220 }}>
                          {selectionCriterion === 'silhouette' && 'Prefers compact spherical clusters. Higher = better.'}
                          {selectionCriterion === 'davies_bouldin' && 'No shape assumption. Lower = better. Stable across algorithms.'}
                          {selectionCriterion === 'calinski_harabasz' && 'Between/within-cluster variance ratio. Prefers well-separated clusters.'}
                        </span>
                      </div>
                    )}
{(clusterMode === 'sequence') && (
                      <div className="flex items-center" style={{ gap: 6 }}>
                        <label className="text-xs text-muted-foreground whitespace-nowrap">Threshold</label>
                        <input
                          type="range"
                          min={0.5}
                          max={1.0}
                          step={0.05}
                          value={identityThreshold}
                          onChange={(e) => setIdentityThreshold(Number(e.target.value))}
                          className="w-20 h-2 cursor-pointer accent-primary"
                        />
                        <span className="text-xs font-mono text-muted-foreground w-10">{(identityThreshold * 100).toFixed(0)}%</span>
                      </div>
                    )}
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Min Reads</label>
                      <Input
                        type="number"
                        min={0}
                        value={minReadCount}
                        onChange={(e) => setMinReadCount(Number(e.target.value))}
                        className="w-20 h-8 text-xs"
                      />
                    </div>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Top N</label>
                      <Input
                        type="number"
                        min={1}
                        max={5000}
                        value={topN}
                        onChange={(e) => setTopN(Number(e.target.value))}
                        className="w-20 h-8 text-xs"
                      />
                    </div>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <label className="text-xs text-muted-foreground whitespace-nowrap">
                        {abundanceThreshold === 0 ? 'Abundance' : `Top ${Math.round((1 - abundanceThreshold) * 100)}%`}
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={abundanceThreshold === 0 ? 0 : Math.round((1 - abundanceThreshold) * 100)}
                        onChange={(e) => {
                          const pct = Number(e.target.value)
                          setAbundanceThreshold(pct === 0 ? 0 : 1 - pct / 100)
                        }}
                        className="w-20 h-2 cursor-pointer accent-primary"
                      />
                      <span className="text-xs font-mono text-muted-foreground w-10">
                        {abundanceThreshold === 0 ? 'off' : `Top ${Math.round((1 - abundanceThreshold) * 100)}%`}
                      </span>
                    </div>
                    {/* Abundance weighting scheme selector (Profile mode only — ML mode uses post-clustering enrichment) */}
{false && (
                    <div className="flex items-center" style={{ gap: 4 }}>
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Weight:</label>
                      <select
                        value={weightingScheme}
                        onChange={(e) => setWeightingScheme(e.target.value)}
                        className="h-6 text-xs border border-border rounded bg-background px-1.5 cursor-pointer"
                        title="How read counts influence clustering. Off: equal vote per unique sequence. Sqrt: mild abundance bias (recommended). Log: weakest bias. Linear: raw read count weighting."
                      >
                        <option value="off">Off</option>
                        <option value="sqrt">Sqrt</option>
                        <option value="log">Log</option>
                        <option value="linear">Linear</option>
                      </select>
                      <span className="text-[10px] text-muted-foreground/60"
                        title="Off = structure space exploration (equal vote). Sqrt = mild abundance bias (recommended). Log = weak bias. Linear = strongest abundance signal.">&#9432;</span>
                    </div>
                    )}
                    <Button onClick={runClustering} className="cursor-pointer" size="sm">
                      <Layers className="w-4 h-4 mr-1" />
                      Run Clustering
                    </Button>
                  </div>
                  {/* Primer region handling */}
                  {clusterMode === 'auto-optimal' && (
                    <div className="border-t border-border" style={{ paddingTop: 10, marginTop: 10 }}>
                      <div className="flex items-center" style={{ gap: 10, marginBottom: 8 }}>
                        <span className="text-xs font-medium text-muted-foreground">Primer Handling:</span>
                        <div className="flex items-center rounded-lg border border-border overflow-hidden">
                          <button
                            onClick={() => setPrimerMode('auto')}
                            className={`text-xs px-3 py-1.5 transition-colors cursor-pointer ${primerMode === 'auto' ? 'bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                          >
                            Auto-detect
                          </button>
                          <button
                            onClick={() => setPrimerMode('manual')}
                            className={`text-xs px-3 py-1.5 transition-colors cursor-pointer border-l border-border ${primerMode === 'manual' ? 'bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                          >
                            Manual input
                          </button>
                        </div>
                        <span className="text-[10px] text-muted-foreground italic">
                          {primerMode === 'auto'
                            ? 'Automatically detect conserved flanking regions (90% consensus)'
                            : 'Enter known primer sequences for precise trimming'}
                        </span>
                      </div>
                      {primerMode === 'manual' && (
                        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
                          <div className="flex items-center" style={{ gap: 6 }}>
                            <label className="text-xs text-muted-foreground whitespace-nowrap">5' Forward</label>
                            <Input
                              type="text"
                              placeholder="e.g. ATCCAGAGTGACGCAGCA"
                              value={forwardPrimer}
                              onChange={(e) => setForwardPrimer(e.target.value.toUpperCase())}
                              className="w-52 h-8 text-xs font-mono"
                            />
                          </div>
                          <div className="flex items-center" style={{ gap: 6 }}>
                            <label className="text-xs text-muted-foreground whitespace-nowrap">3' Reverse</label>
                            <Input
                              type="text"
                              placeholder="e.g. TGGACACGGTGGCTTAGT"
                              value={reversePrimer}
                              onChange={(e) => setReversePrimer(e.target.value.toUpperCase())}
                              className="w-52 h-8 text-xs font-mono"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </FadeIn>
            )}
          </TabsContent>

          <TabsContent value="clusters">
            <ClusterPanel
              data={clusterData}
              isLoading={clusterMutation.isPending}
              hasEnrichment={true}
              onRunCluster={runClustering}
              onGoToEnrichment={() => setActiveTab('overview')}
              clusterMeta={clusterMeta}
              permutation={evaluationPermutation}
            />
          </TabsContent>

          <TabsContent value="evaluation">
            {clusterData.length > 0 && clusterMeta ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Cluster Quality Evaluation: silhouette, permutation, dim-reduction */}
                <ClusterEvaluationContent
                  data={evaluationData}
                  featureMode={clusterMeta?.featureMode}
                  silhouetteScore={clusterMeta?.silhouetteScore ?? -1}
                  quality={clusterMeta?.quality ?? 'n/a'}
                  permutation={evaluationPermutation}
                  algorithmResults={clusterMeta?.algorithmResults}
                  maxVisibleClusters={maxVisibleClusters}
                  onMaxVisibleClustersChange={setEvalMaxClusters}
                />

                {/* Approach A: Structure-Profile UMAP + Quality Overlay */}
                <ClusterEvaluationFigure
                  data={evaluationData}
                  silhouetteScore={clusterMeta?.silhouetteScore ?? -1}
                  quality={clusterMeta?.quality ?? 'n/a'}
                  permutation={evaluationPermutation}
                  featureMode={clusterMeta?.featureMode}
                  maxVisibleClusters={maxVisibleClusters}
                />

                {/* Approach B: Network Graph */}
                <ClusterNetworkGraph
                  data={evaluationData}
                  silhouetteScore={clusterMeta?.silhouetteScore ?? -1}
                  quality={clusterMeta?.quality ?? 'n/a'}
                  permutation={evaluationPermutation}
                  featureMode={clusterMeta?.featureMode}
                  maxVisibleClusters={maxVisibleClusters}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center text-center" style={{ padding: '60px 20px', gap: 12 }}>
                <p className="text-sm font-semibold text-muted-foreground">No clustering data available</p>
                <p className="text-xs text-muted-foreground">Run clustering with Auto-Optimal ML mode to see quality evaluation charts.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
