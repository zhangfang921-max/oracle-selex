/**
 * Motif Discovery: find recurring sequence patterns via k-mer analysis
 * and position weight matrix generation.
 */

export interface MotifResult {
  kmer: string
  count: number
  frequency: number
  reverseComplement: string
}

export interface MotifAnalysis {
  kmers: MotifResult[]
  consensusMotif: string
  positionMatrix: Record<string, number[]>  // base -> position frequencies
  totalSequences: number
}

export function discoverMotifs(
  sequences: string[],
  kmerSize: number = 6,
  topN: number = 20
): MotifAnalysis {
  const kmerMap = new Map<string, number>()
  let totalKmers = 0

  // Count k-mers
  for (const seq of sequences) {
    const upper = seq.toUpperCase().replace(/U/g, 'T')
    for (let i = 0; i <= upper.length - kmerSize; i++) {
      const kmer = upper.substring(i, i + kmerSize)
      if (/^[ACGT]+$/.test(kmer)) {
        kmerMap.set(kmer, (kmerMap.get(kmer) || 0) + 1)
        totalKmers++
      }
    }
  }

  // Sort by frequency
  const kmers = Array.from(kmerMap.entries())
    .map(([kmer, count]) => ({
      kmer,
      count,
      frequency: totalKmers > 0 ? count / totalKmers : 0,
      reverseComplement: getReverseComplement(kmer),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)

  // Generate position weight matrix from top sequences
  const positionMatrix = generatePositionMatrix(sequences)

  // Generate consensus from PWM
  const consensusMotif = generateConsensus(positionMatrix, sequences[0]?.length || 0)

  return {
    kmers,
    consensusMotif,
    positionMatrix,
    totalSequences: sequences.length,
  }
}

function getReverseComplement(seq: string): string {
  const complement: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' }
  return seq
    .split('')
    .reverse()
    .map((b) => complement[b] || b)
    .join('')
}

function generatePositionMatrix(
  sequences: string[]
): Record<string, number[]> {
  if (sequences.length === 0) return { A: [], C: [], G: [], T: [] }

  // Find the shortest sequence length
  const minLen = Math.min(...sequences.map((s) => s.length), 100)
  const matrix: Record<string, number[]> = {
    A: new Array(minLen).fill(0),
    C: new Array(minLen).fill(0),
    G: new Array(minLen).fill(0),
    T: new Array(minLen).fill(0),
  }

  for (const seq of sequences) {
    const upper = seq.toUpperCase().replace(/U/g, 'T')
    for (let i = 0; i < minLen; i++) {
      const base = upper[i]
      if (matrix[base]) {
        matrix[base][i]++
      }
    }
  }

  // Normalize to frequencies
  const total = sequences.length
  for (const base of ['A', 'C', 'G', 'T']) {
    matrix[base] = matrix[base].map((c) => c / total)
  }

  return matrix
}

function generateConsensus(
  matrix: Record<string, number[]>,
  length: number
): string {
  const bases = ['A', 'C', 'G', 'T']
  let consensus = ''

  for (let i = 0; i < length && i < (matrix.A?.length || 0); i++) {
    let maxBase = 'N'
    let maxFreq = 0
    for (const base of bases) {
      const freq = matrix[base]?.[i] || 0
      if (freq > maxFreq) {
        maxFreq = freq
        maxBase = base
      }
    }
    consensus += maxFreq > 0.5 ? maxBase : maxBase.toLowerCase()
  }

  return consensus
}
