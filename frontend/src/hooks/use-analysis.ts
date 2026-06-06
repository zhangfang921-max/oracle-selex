import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { Analysis, EnrichmentEntry, G4Result, RNAFoldResult, MotifAnalysis, SequenceCluster } from '@/types/analysis'

// List analyses
export function useAnalyses() {
  return useQuery({
    queryKey: ['analyses'],
    queryFn: async () => {
      const { data } = await apiClient.post('/analysis/list')
      return data.data as Analysis[]
    },
  })
}

// Get analysis detail
export function useAnalysisDetail(analysisId: string | null) {
  return useQuery({
    queryKey: ['analysis', analysisId],
    queryFn: async () => {
      const { data } = await apiClient.post('/analysis/detail', { analysisId })
      return data.data as Analysis
    },
    enabled: !!analysisId,
  })
}

// Create analysis
export function useCreateAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await apiClient.post('/analysis/create', { name })
      return data.data as Analysis
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })
}

// Upload file
export function useUploadFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      analysisId,
      roundNumber,
      file,
    }: {
      analysisId: string
      roundNumber: number
      file: File
    }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('analysisId', analysisId)
      formData.append('roundNumber', String(roundNumber))

      const { data } = await apiClient.post('/analysis/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
      })
      return data.data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['analysis', variables.analysisId] })
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })
}

// Enrichment analysis
export function useEnrichment() {
  return useMutation({
    mutationFn: async ({
      analysisId,
      minReadCount,
      minPercentRead,
      topN,
    }: {
      analysisId: string
      minReadCount?: number
      minPercentRead?: number
      topN?: number
    }) => {
      const { data } = await apiClient.post('/analysis/enrichment', {
        analysisId,
        minReadCount,
        minPercentRead,
        topN,
      })
      return data.data as EnrichmentEntry[]
    },
  })
}

// Sequence clustering
export function useCluster() {
  return useMutation({
    mutationFn: async ({
      enrichmentData,
      identityThreshold,
      clusterMode,
      optimalClusterIds,
    }: {
      enrichmentData: EnrichmentEntry[]
      identityThreshold?: number
      clusterMode?: 'sequence' | 'structure'
      optimalClusterIds?: number[]
    }) => {
      const { data } = await apiClient.post('/analysis/cluster', {
        enrichmentData,
        identityThreshold,
        clusterMode,
        optimalClusterIds,
      })
      return data.data as SequenceCluster[]
    },
  })
}

// G4 screening
export function useG4Screen() {
  return useMutation({
    mutationFn: async (sequences: string[]) => {
      const { data } = await apiClient.post('/analysis/g4screen', { sequences })
      return data.data as G4Result[]
    },
  })
}

// RNA fold
export function useRNAFold() {
  return useMutation({
    mutationFn: async (sequences: string[]) => {
      const { data } = await apiClient.post('/analysis/rnafold', { sequences }, { timeout: 120000 })
      return data.data as RNAFoldResult[]
    },
  })
}

// Motif discovery
export function useMotifDiscovery() {
  return useMutation({
    mutationFn: async ({
      sequences,
      kmerSize,
      topN,
    }: {
      sequences: string[]
      kmerSize?: number
      topN?: number
    }) => {
      const { data } = await apiClient.post('/analysis/motifs', { sequences, kmerSize, topN })
      return data.data as MotifAnalysis
    },
  })
}

// Export to Excel
export function useExportExcel() {
  return useMutation({
    mutationFn: async ({
      analysisId,
      enrichmentData,
      g4Data,
      rnaFoldData,
      motifData,
    }: {
      analysisId: string
      enrichmentData?: EnrichmentEntry[]
      g4Data?: G4Result[]
      rnaFoldData?: RNAFoldResult[]
      motifData?: MotifAnalysis
    }) => {
      const { data } = await apiClient.post(
        '/analysis/export',
        { analysisId, enrichmentData, g4Data, rnaFoldData, motifData },
        { responseType: 'blob', timeout: 120000 }
      )
      return data as Blob
    },
  })
}

// Delete analysis
export function useDeleteAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (analysisId: string) => {
      await apiClient.post('/analysis/delete', { analysisId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
    },
  })
}
