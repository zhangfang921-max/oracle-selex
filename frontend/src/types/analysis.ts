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

// Sequence-level entry consumed by clustering. Named EnrichmentEntry for
// historical reasons; cross-round enrichment metrics were removed because
// Classic ORACLE analyses a single uploaded file (one round).
export interface EnrichmentEntry {
  sequence: string
  maxPercentRead: number
  totalReads: number
}

export interface G4Result {
  sequence: string
  g4Score: number | null
  cGcC: number | null
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
  maxPercentRead: number
  totalReads: number
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
  avgMaxPercentRead: number
  // null when the G4 scoring service was unavailable; 'n/a' risk means
  // "not evaluated", which is not the same as low risk
  g4Score: number | null
  g4Risk: 'High' | 'Medium' | 'Low' | 'n/a'
  numG4Motifs: number
  cGcC: number | null
  g4Hunter: number | null
  g4NN: number | null
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
