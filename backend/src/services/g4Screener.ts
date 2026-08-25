/**
 * G-Quadruplex (G4) Screener — calls ORACLE's Python G4 scoring service
 *
 * The Python microservice (port 3002) uses:
 *   1. cGcC — Beaudoin, Jodoin & Perreault, 2014
 *   2. G4Hunter (G4H) — Bedrat, Lacroix & Mergny, 2016
 *   3. G4NN — optional; requires the externally installed pre-trained model
 *      published with G4RNA screener (Garant et al., 2017, GPL-3.0). When the
 *      model is not installed the service returns g4NN = null.
 *
 * If the Python service is unavailable, scores are reported as null rather
 * than substituted with an approximation. Publishing a differently-computed
 * number under the same field name would make results irreproducible and
 * silently invalidate the published thresholds, so the degraded state is made
 * explicit instead. Motif detection is pure pattern matching and stays
 * available either way.
 */

// The Python service reads G4_PORT (default 3002). Honour the same variable here
// so changing the port cannot leave Node dialling the old one. G4_SERVICE_URL
// overrides both, for the case where G4 scoring runs on another host.
const G4_PORT = process.env.G4_PORT ?? '3002'
const G4_SERVICE_URL = process.env.G4_SERVICE_URL ?? `http://localhost:${G4_PORT}`

export interface G4Result {
  g4Score: number | null   // composite score (0-2), null when scoring unavailable
  cGcC: number | null      // cGcC score, null when scoring unavailable
  g4Hunter: number | null  // G4Hunter score, null when scoring unavailable
  g4NN: number | null      // G4NN score, null when the optional model is absent
  numG4Motifs: number
  g4Motifs: G4Motif[]
  gRichRegions: { start: number; end: number }[]
  engine?: string
  degraded?: boolean       // true when the scoring service was unreachable
}

export interface G4Motif {
  start: number
  end: number
  motif: string
  score: number
}

/**
 * Screen a batch of sequences using ORACLE's Python G4 scoring service.
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
          g4NN: number | null
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

        // Composite score based on threshold passing.
        // cGcC normalization uses sigmoid centred at the published G4RNA
        // Screener threshold (4.5) — prevents saturation that would occur
        // with a simple /10 divisor on the Python scorer's output scale.
        const cGcCNorm = 1 / (1 + Math.exp(-(item.cGcC - 4.5) / 2.5))
        const g4HNorm = Math.min(Math.abs(item.g4Hunter) / 2, 1)
        const motifNorm = motifs.length > 0
          ? Math.min(motifs[0].score / 10, 1) : 0

        // G4NN is optional. When it is unavailable its 0.3 weight is
        // redistributed over the remaining terms so the composite stays on the
        // same 0-2 scale instead of being silently depressed.
        const hasNN = typeof item.g4NN === 'number' && Number.isFinite(item.g4NN)
        const g4NNNorm = hasNN ? Math.min(Math.max(item.g4NN as number, 0), 1) : 0
        const weighted = cGcCNorm * 0.2 + g4HNorm * 0.3 + motifNorm * 0.2 +
          (hasNN ? g4NNNorm * 0.3 : 0)
        const composite = (hasNN ? weighted : weighted / 0.7) * 2

        return {
          g4Score: Math.round(Math.min(composite, 2) * 1000) / 1000,
          cGcC: item.cGcC,
          g4Hunter: item.g4Hunter,
          g4NN: hasNN ? (item.g4NN as number) : null,
          numG4Motifs: motifs.length,
          g4Motifs: motifs,
          gRichRegions,
          engine: hasNN
            ? 'ORACLE G4 scorers + G4NN external model'
            : 'ORACLE G4 scorers (cGcC, G4Hunter)',
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
 * Motif detection only; numeric scores require the Python service.
 */
export function scoreG4(sequence: string): G4Result {
  return scoreG4Fallback(sequence)
}

// ---------------------------------------------------------------------------
// Degraded path (used only when the Python scoring service is unavailable)
// ---------------------------------------------------------------------------

function scoreG4Fallback(sequence: string): G4Result {
  const seq = sequence.toUpperCase().replace(/T/g, 'U')
  const gSeq = seq.replace(/U/g, 'T')

  const g4Motifs = findG4Motifs(gSeq)
  const gRichRegions = findGRichRegions(seq)

  return {
    // Deliberately null: cGcC, G4Hunter and G4NN are defined by their
    // published algorithms. Any substitute computed here would be a different
    // quantity reported under the same name, so nothing is reported at all.
    g4Score: null,
    cGcC: null,
    g4Hunter: null,
    g4NN: null,
    numG4Motifs: g4Motifs.length,
    g4Motifs,
    gRichRegions,
    engine: 'unavailable (G4 scoring service offline)',
    degraded: true,
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
