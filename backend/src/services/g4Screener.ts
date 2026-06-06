/**
 * G-Quadruplex (G4) Screener — calls the real G4RNA Screener Python service
 *
 * The Python microservice (port 3002) uses:
 *   1. cGcC score — original algorithm by Jean-Michel Garant
 *   2. G4Hunter (G4H) — Bedrat, Mergny & Lacroix, 2016
 *   3. G4NN — pre-trained ANN model (Garant et al., 2017)
 *
 * Falls back to a lightweight TypeScript approximation if the Python
 * service is unavailable.
 */

const G4_SERVICE_URL = 'http://localhost:3002'

export interface G4Result {
  g4Score: number       // composite score (0-2)
  cGcC: number          // cGcC score
  g4Hunter: number      // G4Hunter score
  g4NN: number          // G4NN score
  numG4Motifs: number
  g4Motifs: G4Motif[]
  gRichRegions: { start: number; end: number }[]
  engine?: string
}

export interface G4Motif {
  start: number
  end: number
  motif: string
  score: number
}

/**
 * Screen a batch of sequences using the G4RNA Screener Python service.
 * Returns one G4Result per sequence.
 */
export async function scoreG4Batch(sequences: string[]): Promise<G4Result[]> {
  const MAX_RETRIES = 3
  const RETRY_DELAY = 2000

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${G4_SERVICE_URL}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences }),
      })

      if (!resp.ok) {
        throw new Error(`G4 service returned ${resp.status}`)
      }

      const json = await resp.json() as {
        success: boolean
        data: Array<{
          cGcC: number
          g4Hunter: number
          g4NN: number
          sequence: string
          length: number
        }>
      }

      if (!json.success) {
        throw new Error('G4 service returned success=false')
      }

      // Map service response to G4Result[]
      return json.data.map((item) => {
        const seq = item.sequence.toUpperCase().replace(/T/g, 'U')
        const motifs = findG4Motifs(seq.replace(/U/g, 'T'))
        const gRichRegions = findGRichRegions(seq)

        // Composite score based on threshold passing
        const cGcCNorm = Math.min(Math.max(item.cGcC / 10, 0), 1)
        const g4HNorm = Math.min(Math.abs(item.g4Hunter) / 2, 1)
        const g4NNNorm = Math.min(Math.max(item.g4NN, 0), 1)
        const motifNorm = motifs.length > 0
          ? Math.min(motifs[0].score / 10, 1) : 0
        const composite = (cGcCNorm * 0.2 + g4HNorm * 0.3 +
          g4NNNorm * 0.3 + motifNorm * 0.2) * 2

        return {
          g4Score: Math.round(Math.min(composite, 2) * 1000) / 1000,
          cGcC: item.cGcC,
          g4Hunter: item.g4Hunter,
          g4NN: item.g4NN,
          numG4Motifs: motifs.length,
          g4Motifs: motifs,
          gRichRegions,
          engine: 'G4RNA Screener (Original ANN)',
        }
      })
    } catch (err: any) {
      const isConnectionError =
        err?.cause?.code === 'ECONNREFUSED' ||
        err?.message?.includes('fetch failed') ||
        err?.message?.includes('ECONNREFUSED')

      if (isConnectionError && attempt < MAX_RETRIES - 1) {
        console.log(`[G4Screener] Service not ready, retry ${attempt + 1}/${MAX_RETRIES}...`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY))
        continue
      }

      console.warn(`[G4Screener] Python service unavailable, using TS fallback: ${err.message}`)
      return sequences.map((seq) => scoreG4Fallback(seq))
    }
  }

  return sequences.map((seq) => scoreG4Fallback(seq))
}

/**
 * Screen a single sequence (convenience wrapper).
 * Synchronous fallback version for backward compatibility.
 */
export function scoreG4(sequence: string): G4Result {
  return scoreG4Fallback(sequence)
}

// ---------------------------------------------------------------------------
// TypeScript fallback (used only when Python service is unavailable)
// ---------------------------------------------------------------------------

function scoreG4Fallback(sequence: string): G4Result {
  const seq = sequence.toUpperCase().replace(/T/g, 'U')
  const gSeq = seq.replace(/U/g, 'T')

  const g4Motifs = findG4Motifs(gSeq)
  const cGcC = calculateCGcC(seq)
  const g4Hunter = calculateG4Hunter(seq)
  const g4NN = calculateG4NN(seq, g4Motifs)
  const g4Score = calculateCompositeScore(cGcC, g4Hunter, g4NN, g4Motifs)
  const gRichRegions = findGRichRegions(seq)

  return {
    g4Score: Math.round(g4Score * 1000) / 1000,
    cGcC: Math.round(cGcC * 1000) / 1000,
    g4Hunter: Math.round(g4Hunter * 1000) / 1000,
    g4NN: Math.round(g4NN * 1000) / 1000,
    numG4Motifs: g4Motifs.length,
    g4Motifs,
    gRichRegions,
    engine: 'TypeScript Approximation (Fallback)',
  }
}

// Motif detection (shared by both paths)
function findG4Motifs(seq: string): G4Motif[] {
  const motifs: G4Motif[] = []
  const s = seq.replace(/U/g, 'T')
  const g4Pattern = /(G{2,}).{1,7}(G{2,}).{1,7}(G{2,}).{1,7}(G{2,})/g
  let match
  while ((match = g4Pattern.exec(s)) !== null) {
    const motif = match[0]
    const start = match.index
    const end = start + motif.length
    const gTracts = [match[1], match[2], match[3], match[4]]
    const minGTract = Math.min(...gTracts.map((g) => g.length))
    const totalG = gTracts.reduce((s, g) => s + g.length, 0)
    const loopRegion = motif.replace(/G+/g, '|').split('|').filter((l) => l.length > 0)
    const avgLoopLen = loopRegion.length > 0
      ? loopRegion.reduce((s, l) => s + l.length, 0) / loopRegion.length : 0
    const score = (minGTract * 2 + totalG) / (1 + avgLoopLen * 0.5)
    motifs.push({ start, end, motif, score: Math.round(score * 100) / 100 })
    g4Pattern.lastIndex = match.index + 1
  }
  return motifs.sort((a, b) => b.score - a.score)
}

function findGRichRegions(seq: string): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = []
  const pattern = /G{2,}/g
  let match
  while ((match = pattern.exec(seq)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length })
  }
  return regions
}

// Fallback scoring functions (TypeScript approximations)
function calculateCGcC(seq: string): number {
  const len = seq.length
  if (len === 0) return 0
  const gCount = (seq.match(/G/g) || []).length
  const cCount = (seq.match(/C/g) || []).length
  const gFrac = gCount / len
  const diff = gCount - cCount
  return diff * gFrac * (100 / len)
}

function calculateG4Hunter(seq: string): number {
  const s = seq.replace(/U/g, 'T')
  const n = s.length
  if (n === 0) return 0
  const scores = new Array(n).fill(0)
  let i = 0
  while (i < n) {
    if (s[i] === 'G') {
      let j = i
      while (j < n && s[j] === 'G') j++
      const runLen = Math.min(j - i, 4)
      for (let k = i; k < j; k++) scores[k] = runLen
      i = j
    } else if (s[i] === 'C') {
      let j = i
      while (j < n && s[j] === 'C') j++
      const runLen = Math.min(j - i, 4)
      for (let k = i; k < j; k++) scores[k] = -runLen
      i = j
    } else { i++ }
  }
  const windowSize = Math.min(25, n)
  let maxScore = 0
  let windowSum = 0
  for (let k = 0; k < windowSize; k++) windowSum += scores[k]
  maxScore = Math.abs(windowSum / windowSize)
  for (let start = 1; start <= n - windowSize; start++) {
    windowSum -= scores[start - 1]
    windowSum += scores[start + windowSize - 1]
    const m = Math.abs(windowSum / windowSize)
    if (m > maxScore) maxScore = m
  }
  return maxScore
}

function calculateG4NN(seq: string, motifs: G4Motif[]): number {
  const s = seq.replace(/U/g, 'T')
  const n = s.length
  if (n === 0) return 0
  const gCount = (s.match(/G/g) || []).length
  const gContent = gCount / n
  const motifPresence = Math.min(motifs.length / 3, 1)
  const gTracts = s.match(/G+/g) || []
  const maxGTract = gTracts.length > 0 ? Math.max(...gTracts.map((g) => g.length)) : 0
  const gTractFeature = Math.min(maxGTract / 5, 1)
  const qualifiedTracts = gTracts.filter((g) => g.length >= 2).length
  const tractDensity = Math.min(qualifiedTracts / 4, 1)
  let loopRegularity = 0
  if (motifs.length > 0) {
    const loops = motifs[0].motif.replace(/G+/g, '|').split('|').filter((l) => l.length > 0)
    if (loops.length >= 3) {
      const loopLens = loops.map((l) => l.length)
      const meanLoop = loopLens.reduce((a, b) => a + b, 0) / loopLens.length
      const variance = loopLens.reduce((s, l) => s + (l - meanLoop) ** 2, 0) / loopLens.length
      loopRegularity = 1 / (1 + variance)
      if (meanLoop <= 3) loopRegularity *= 1.2
    }
  }
  const z = -2.5 + gContent * 6.0 + motifPresence * 3.0 +
    gTractFeature * 2.5 + tractDensity * 2.0 + loopRegularity * 1.5
  return Math.round((1 / (1 + Math.exp(-z))) * 1000) / 1000
}

function calculateCompositeScore(
  cGcC: number, g4Hunter: number, g4NN: number, motifs: G4Motif[]
): number {
  const cGcCNorm = Math.min(Math.max(cGcC / 10, 0), 1)
  const g4HNorm = Math.min(g4Hunter / 2, 1)
  const g4NNNorm = g4NN
  const motifNorm = Math.min(motifs.length > 0 ? motifs[0].score / 10 : 0, 1)
  return Math.min((cGcCNorm * 0.2 + g4HNorm * 0.3 + g4NNNorm * 0.3 + motifNorm * 0.2) * 2, 2)
}
