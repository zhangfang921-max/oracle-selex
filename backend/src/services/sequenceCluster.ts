/**
 * Sequence Clustering Service
 * 
 * CD-HIT-like greedy length-sorted clustering:
 * 1. Sort sequences by enrichment fold (desc)
 * 2. For each sequence, check similarity against existing cluster representatives
 * 3. If similarity >= threshold, add to that cluster; otherwise create new cluster
 * 4. Uses Levenshtein distance with k-mer pre-filter for speed
 */

export interface ClusterMember {
  sequence: string
  enrichmentFold: number | null
  maxPercentRead: number
  totalReads: number
  presentInRounds: number
  similarity: number // similarity to representative (1.0 for the rep itself)
}

export interface SequenceCluster {
  id: number
  representative: string
  members: ClusterMember[]
  size: number
  avgEnrichmentFold: number
  maxEnrichmentFold: number
  avgMaxPercentRead: number
}

interface EnrichmentInput {
  sequence: string
  enrichmentFold: number | null
  maxPercentRead: number
  totalReads: number
  presentInRounds: number
}

/**
 * Auto-detect common prefix and suffix (primer regions) from a set of sequences.
 * Returns the trimmed variable region for each sequence.
 * Also identifies internally conserved positions that should be down-weighted.
 */
function detectAndTrimPrimers(sequences: string[]): { trimmed: string[]; prefixLen: number; suffixLen: number; variablePositions: number[] } {
  if (sequences.length < 2) return { trimmed: sequences, prefixLen: 0, suffixLen: 0, variablePositions: [] }

  // Detect common prefix
  const first = sequences[0]
  let prefixLen = 0
  for (let i = 0; i < first.length; i++) {
    const char = first[i]
    // Check if 90%+ of sequences share this character at position i
    let matches = 0
    const sampleSize = Math.min(sequences.length, 200)
    for (let j = 0; j < sampleSize; j++) {
      if (sequences[j].length > i && sequences[j][i] === char) matches++
    }
    if (matches / sampleSize >= 0.9) {
      prefixLen = i + 1
    } else {
      break
    }
  }

  // Detect common suffix
  let suffixLen = 0
  for (let i = 0; i < first.length - prefixLen; i++) {
    const char = first[first.length - 1 - i]
    let matches = 0
    const sampleSize = Math.min(sequences.length, 200)
    for (let j = 0; j < sampleSize; j++) {
      const seq = sequences[j]
      if (seq.length > prefixLen + i && seq[seq.length - 1 - i] === char) matches++
    }
    if (matches / sampleSize >= 0.9) {
      suffixLen = i + 1
    } else {
      break
    }
  }

  // Only trim if primer region is significant (>= 4 bases)
  if (prefixLen < 4) prefixLen = 0
  if (suffixLen < 4) suffixLen = 0

  // Trim sequences
  const trimmed = sequences.map((seq) => {
    const end = suffixLen > 0 ? seq.length - suffixLen : seq.length
    return seq.substring(prefixLen, end)
  })

  // Identify truly variable positions within the trimmed region
  // A position is "variable" if <80% of sequences share the same nucleotide
  const varLen = trimmed[0]?.length || 0
  const variablePositions: number[] = []
  const sampleSize = Math.min(trimmed.length, 200)
  for (let pos = 0; pos < varLen; pos++) {
    const counts: Record<string, number> = {}
    for (let j = 0; j < sampleSize; j++) {
      const ch = trimmed[j]?.[pos]
      if (ch) counts[ch] = (counts[ch] || 0) + 1
    }
    const maxCount = Math.max(...Object.values(counts))
    if (maxCount / sampleSize < 0.8) {
      variablePositions.push(pos)
    }
  }

  if (prefixLen > 0 || suffixLen > 0) {
    console.log(`[Cluster] Auto-detected primers: prefix=${prefixLen}bp, suffix=${suffixLen}bp, variable region=${varLen}bp, truly variable positions=${variablePositions.length}/${varLen}`)
  }

  return { trimmed, prefixLen, suffixLen, variablePositions }
}

/**
 * Build k-mer set for a sequence (used for fast pre-filtering)
 */
function buildKmerSet(seq: string, k: number): Set<string> {
  const kmers = new Set<string>()
  for (let i = 0; i <= seq.length - k; i++) {
    kmers.add(seq.substring(i, i + k))
  }
  return kmers
}

/**
 * Jaccard similarity between two k-mer sets (fast pre-filter)
 */
function kmerJaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const k of a) {
    if (b.has(k)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Normalized Levenshtein similarity (1 - distance/maxLen)
 * Only computed when k-mer pre-filter passes
 */
function levenshteinSimilarity(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0 && n === 0) return 1
  if (m === 0 || n === 0) return 0

  // Optimize: if lengths differ too much, skip
  const maxLen = Math.max(m, n)
  if (Math.abs(m - n) / maxLen > 0.3) return 0

  // Use two-row DP for memory efficiency
  let prev = new Uint16Array(n + 1)
  let curr = new Uint16Array(n + 1)

  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
      }
    }
    ;[prev, curr] = [curr, prev]
  }

  const distance = prev[n]
  return 1 - distance / maxLen
}

/**
 * Position-weighted similarity: only compares truly variable positions.
 * Falls back to Levenshtein if variablePositions is empty or sequences differ in length.
 */
function variablePositionSimilarity(a: string, b: string, variablePositions: number[]): number {
  // If no variable positions detected or lengths differ, use full Levenshtein
  if (variablePositions.length === 0 || a.length !== b.length) {
    return levenshteinSimilarity(a, b)
  }

  // Compare only at truly variable positions (Hamming-like)
  let matches = 0
  for (const pos of variablePositions) {
    if (pos < a.length && pos < b.length && a[pos] === b[pos]) {
      matches++
    }
  }
  return matches / variablePositions.length
}

/**
 * Main clustering function
 * Auto-detects and trims primer regions before comparing sequences.
 * Uses position-weighted comparison focusing on truly variable positions.
 */
export function clusterSequences(
  entries: EnrichmentInput[],
  identityThreshold: number = 0.6,
  kmerSize: number = 5,
  kmerPreFilterThreshold: number = 0.2
): SequenceCluster[] {
  if (entries.length === 0) return []

  // Auto-detect and trim primer regions
  const allSequences = entries.map((e) => e.sequence)
  const { trimmed, variablePositions } = detectAndTrimPrimers(allSequences)

  // Adjust kmer size for short variable regions
  const avgVarLen = trimmed.reduce((s, t) => s + t.length, 0) / trimmed.length
  const effectiveKmerSize = avgVarLen < 12 ? 3 : avgVarLen < 20 ? 4 : kmerSize

  // Sort by totalReads descending (most abundant first = best representative)
  const indices = entries.map((_, i) => i)
  indices.sort((a, b) => entries[b].totalReads - entries[a].totalReads)

  const clusters: SequenceCluster[] = []
  const repKmers: Set<string>[] = []
  const repTrimmed: string[] = []

  for (const idx of indices) {
    const entry = entries[idx]
    const varRegion = trimmed[idx]
    const entryKmers = buildKmerSet(varRegion, effectiveKmerSize)
    let assigned = false

    for (let i = 0; i < clusters.length; i++) {
      // Fast pre-filter with k-mer Jaccard
      const jaccard = kmerJaccard(entryKmers, repKmers[i])
      if (jaccard < kmerPreFilterThreshold) continue

      // Detailed comparison: position-weighted on variable positions
      const sim = variablePositionSimilarity(varRegion, repTrimmed[i], variablePositions)
      if (sim >= identityThreshold) {
        clusters[i].members.push({
          sequence: entry.sequence,
          enrichmentFold: entry.enrichmentFold,
          maxPercentRead: entry.maxPercentRead,
          totalReads: entry.totalReads,
          presentInRounds: entry.presentInRounds,
          similarity: Math.round(sim * 1000) / 1000,
        })
        clusters[i].size++
        assigned = true
        break
      }
    }

    if (!assigned) {
      // Create new cluster with this sequence as representative
      clusters.push({
        id: clusters.length + 1,
        representative: entry.sequence,
        members: [
          {
            sequence: entry.sequence,
            enrichmentFold: entry.enrichmentFold,
            maxPercentRead: entry.maxPercentRead,
            totalReads: entry.totalReads,
            presentInRounds: entry.presentInRounds,
            similarity: 1.0,
          },
        ],
        size: 1,
        avgEnrichmentFold: 0,
        maxEnrichmentFold: 0,
        avgMaxPercentRead: 0,
      })
      repKmers.push(entryKmers)
      repTrimmed.push(varRegion)
    }
  }

  // Compute aggregate stats for each cluster
  for (const cluster of clusters) {
    const finiteFolds = cluster.members
      .map((m) => m.enrichmentFold)
      .filter((f): f is number => f !== null && f !== Infinity && isFinite(f))

    cluster.avgEnrichmentFold = finiteFolds.length > 0
      ? Math.round((finiteFolds.reduce((s, f) => s + f, 0) / finiteFolds.length) * 100) / 100
      : 0

    cluster.maxEnrichmentFold = finiteFolds.length > 0
      ? Math.round(Math.max(...finiteFolds) * 100) / 100
      : 0

    // Check for Infinity (new sequences)
    const hasNew = cluster.members.some((m) => m.enrichmentFold === Infinity)
    if (hasNew && cluster.maxEnrichmentFold === 0) {
      cluster.maxEnrichmentFold = Infinity
    }

    cluster.avgMaxPercentRead = cluster.members.length > 0
      ? Math.round((cluster.members.reduce((s, m) => s + m.maxPercentRead, 0) / cluster.members.length) * 10000) / 10000
      : 0
  }

  // Sort clusters: by size desc, then by avgEnrichmentFold desc
  clusters.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    return b.avgEnrichmentFold - a.avgEnrichmentFold
  })

  // Re-assign IDs after sorting
  clusters.forEach((c, i) => { c.id = i + 1 })

  return clusters
}

/**
 * Structure-based clustering using dot-bracket notation.
 * Groups sequences by RNA secondary structure similarity
 * (Levenshtein distance on dot-bracket strings).
 * Auto-trims primer-region structures (common prefix/suffix in dot-bracket).
 */
export function clusterByStructure(
  entries: EnrichmentInput[],
  structures: string[],
  identityThreshold: number = 0.6
): SequenceCluster[] {
  if (entries.length === 0 || structures.length === 0) return []

  // Normalize structures: replace '+' (G4 markers) with '.' for comparison
  const normalizedStructures = structures.map((s) => s.replace(/\+/g, '.'))

  // Auto-detect primer regions from sequences and trim corresponding positions from structures
  const allSequences = entries.map((e) => e.sequence)
  const { prefixLen, suffixLen } = detectAndTrimPrimers(allSequences)
  const trimmedStructures = normalizedStructures.map((s) => {
    const end = suffixLen > 0 ? s.length - suffixLen : s.length
    return s.substring(prefixLen, end)
  })

  console.log(`[StructureCluster] Using trimmed structures, variable region length: ${trimmedStructures[0]?.length || 0}`)

  // Sort by totalReads descending
  const indices = entries.map((_, i) => i)
  indices.sort((a, b) => entries[b].totalReads - entries[a].totalReads)

  const clusters: SequenceCluster[] = []
  const repStructures: string[] = []

  for (const idx of indices) {
    const entry = entries[idx]
    const structure = trimmedStructures[idx]
    let assigned = false

    for (let i = 0; i < clusters.length; i++) {
      const sim = levenshteinSimilarity(structure, repStructures[i])
      if (sim >= identityThreshold) {
        clusters[i].members.push({
          sequence: entry.sequence,
          enrichmentFold: entry.enrichmentFold,
          maxPercentRead: entry.maxPercentRead,
          totalReads: entry.totalReads,
          presentInRounds: entry.presentInRounds,
          similarity: Math.round(sim * 1000) / 1000,
        })
        clusters[i].size++
        assigned = true
        break
      }
    }

    if (!assigned) {
      clusters.push({
        id: clusters.length + 1,
        representative: entry.sequence,
        members: [
          {
            sequence: entry.sequence,
            enrichmentFold: entry.enrichmentFold,
            maxPercentRead: entry.maxPercentRead,
            totalReads: entry.totalReads,
            presentInRounds: entry.presentInRounds,
            similarity: 1.0,
          },
        ],
        size: 1,
        avgEnrichmentFold: 0,
        maxEnrichmentFold: 0,
        avgMaxPercentRead: 0,
      })
      repStructures.push(structure)
    }
  }

  // Compute aggregate stats
  for (const cluster of clusters) {
    const finiteFolds = cluster.members
      .map((m) => m.enrichmentFold)
      .filter((f): f is number => f !== null && f !== Infinity && isFinite(f))

    cluster.avgEnrichmentFold = finiteFolds.length > 0
      ? Math.round((finiteFolds.reduce((s, f) => s + f, 0) / finiteFolds.length) * 100) / 100
      : 0

    cluster.maxEnrichmentFold = finiteFolds.length > 0
      ? Math.round(Math.max(...finiteFolds) * 100) / 100
      : 0

    const hasNew = cluster.members.some((m) => m.enrichmentFold === Infinity)
    if (hasNew && cluster.maxEnrichmentFold === 0) {
      cluster.maxEnrichmentFold = Infinity
    }

    cluster.avgMaxPercentRead = cluster.members.length > 0
      ? Math.round((cluster.members.reduce((s, m) => s + m.maxPercentRead, 0) / cluster.members.length) * 10000) / 10000
      : 0
  }

  // Sort by size desc, then by avgEnrichmentFold desc
  clusters.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    return b.avgEnrichmentFold - a.avgEnrichmentFold
  })

  clusters.forEach((c, i) => { c.id = i + 1 })

  return clusters
}
