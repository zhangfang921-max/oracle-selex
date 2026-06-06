export interface Analysis {
  id: string
  name: string
  status: string
  createdAt: string
  updatedAt: string
  rounds: Round[]
}

export interface Round {
  id: string
  analysisId: string
  roundNumber: number
  fileName: string
  totalReads: number
  sequences?: Sequence[]
}

export interface Sequence {
  id: string
  roundId: string
  sequence: string
  readCount: number
  percentRead: number
}

export interface EnrichmentEntry {
  sequence: string
  rounds: {
    roundNumber: number
    readCount: number
    percentRead: number
  }[]
  enrichmentFold: number | null
  maxPercentRead: number
  totalReads: number
  presentInRounds: number
}

export interface G4Result {
  sequence: string
  g4Score: number
  cGcC: number
  numG4Motifs: number
  g4Motifs: {
    start: number
    end: number
    motif: string
    score: number
  }[]
  gRichRegions: { start: number; end: number }[]
}

export interface RNAFoldResult {
  sequence: string
  rnaSequence?: string
  dotBracket: string
  mfe: number
  numBasePairs: number
  hasGQuad: boolean
  gquadEnabled: boolean
  engine: string
  length: number
  structure?: string[]
}

export interface MotifResult {
  kmer: string
  count: number
  frequency: number
  reverseComplement: string
}

export interface MotifAnalysis {
  kmers: MotifResult[]
  consensusMotif: string
  positionMatrix: Record<string, number[]>
  totalSequences: number
}

export interface ClusterMember {
  sequence: string
  enrichmentFold: number | null
  maxPercentRead: number
  totalReads: number
  presentInRounds: number
  similarity: number
}

export interface ClusterRNAFold {
  dotBracket: string
  mfe: number
  numBasePairs: number
  hasGQuad: boolean
  gquadEnabled: boolean
  engine: string
  length: number
}

export interface G4MotifDetail {
  start: number
  end: number
  motif: string
  score: number
}

export interface SequenceCluster {
  id: number
  representative: string
  members: ClusterMember[]
  size: number
  avgEnrichmentFold: number
  maxEnrichmentFold: number
  avgMaxPercentRead: number
  g4Score: number
  g4Risk: 'High' | 'Medium' | 'Low'
  numG4Motifs: number
  cGcC: number
  g4Hunter: number
  g4NN: number
  g4Motifs: G4MotifDetail[]
  gRichRegions: { start: number; end: number }[]
  rnaFold: ClusterRNAFold | null
  rnaFoldNoG4: ClusterRNAFold | null
}

export interface UploadRound {
  roundNumber: number
  file: File | null
  fileName: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  totalReads?: number
  uniqueSequences?: number
}
