/**
 * RNA Secondary Structure Prediction
 *
 * Calls the local ViennaRNA RNAfold microservice (port 3001)
 * which uses the actual ViennaRNA package with G-Quadruplex support.
 *
 * Falls back to a nearest-neighbor thermodynamic model using
 * Turner RNA parameters (2004) with G-Quadruplex detection
 * if the service is unavailable.
 *
 * G-Quadruplex (G4) structures are detected using the canonical
 * G{2+}-N{1-7}-G{2+}-N{1-7}-G{2+}-N{1-7}-G{2+} pattern and
 * represented with '+' in the dot-bracket notation, following
 * the ViennaRNA convention.
 */

export interface RNAFoldResult {
  dotBracket: string
  mfe: number
  numBasePairs: number
  hasGQuad: boolean
  gquadEnabled: boolean
  engine: string
  length: number
  structure?: string[]
}

/**
 * Predict RNA structure via the ViennaRNA microservice.
 * Falls back to built-in Turner model if service unreachable.
 */
export async function predictStructureBatch(
  sequences: string[],
  gquad: boolean = true
): Promise<RNAFoldResult[]> {
  // Try ViennaRNA service with up to 3 retries (service may still be starting)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch('http://localhost:3001/fold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences, gquad }),
        signal: AbortSignal.timeout(120000),
      })

      if (!resp.ok) throw new Error(`ViennaRNA service error: ${resp.status}`)

      const data = await resp.json() as { success: boolean; data: RNAFoldResult[]; message?: string }
      if (data.success) return data.data
      throw new Error(data.message || 'Unknown error')
    } catch (err) {
      const isConnectionError = (err as Error).message?.includes('ECONNREFUSED') ||
        (err as Error).message?.includes('fetch failed')
      if (isConnectionError && attempt < 2) {
        // Wait a moment for ViennaRNA service to start
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      console.warn('ViennaRNA service unavailable, using Turner 2004 model:', (err as Error).message)
      return sequences.map((seq) => predictStructureTurner(seq, gquad))
    }
  }
  // Should not reach here, but fallback just in case
  return sequences.map((seq) => predictStructureTurner(seq, gquad))
}

/**
 * Single-sequence wrapper (used by the router)
 */
export function predictStructure(sequence: string): RNAFoldResult {
  return predictStructureTurner(sequence, true)
}

// ── G-Quadruplex Detection ──

interface G4Region {
  start: number
  end: number
  gTracts: { start: number; end: number }[]
  score: number
  energy: number
}

function detectG4Regions(seq: string): G4Region[] {
  const regions: G4Region[] = []
  const gTractPattern = /G{2,}/g
  const gTracts: { start: number; end: number; len: number }[] = []
  let m: RegExpExecArray | null
  while ((m = gTractPattern.exec(seq)) !== null) {
    gTracts.push({ start: m.index, end: m.index + m[0].length, len: m[0].length })
  }

  for (let a = 0; a < gTracts.length - 3; a++) {
    for (let b = a + 1; b < gTracts.length - 2; b++) {
      const loop1 = gTracts[b].start - gTracts[a].end
      if (loop1 < 1 || loop1 > 7) continue
      for (let c = b + 1; c < gTracts.length - 1; c++) {
        const loop2 = gTracts[c].start - gTracts[b].end
        if (loop2 < 1 || loop2 > 7) continue
        for (let d = c + 1; d < gTracts.length; d++) {
          const loop3 = gTracts[d].start - gTracts[c].end
          if (loop3 < 1 || loop3 > 7) continue

          const tracts = [gTracts[a], gTracts[b], gTracts[c], gTracts[d]]
          const minGLen = Math.min(...tracts.map((t) => t.len))
          const totalG = tracts.reduce((s, t) => s + t.len, 0)
          const avgLoop = (loop1 + loop2 + loop3) / 3
          const score = (minGLen * 3 + totalG) / (1 + avgLoop * 0.3)
          const numTetrads = minGLen
          const energy = -(numTetrads * 3.5 + (totalG - numTetrads * 4) * 0.5)

          regions.push({
            start: gTracts[a].start,
            end: gTracts[d].end,
            gTracts: tracts.map((t) => ({ start: t.start, end: t.end })),
            score,
            energy,
          })
        }
      }
    }
  }

  regions.sort((a, b) => b.score - a.score)
  const selected: G4Region[] = []
  const occupied = new Set<number>()
  for (const region of regions) {
    let overlaps = false
    for (let i = region.start; i < region.end; i++) {
      if (occupied.has(i)) { overlaps = true; break }
    }
    if (overlaps) continue
    selected.push(region)
    for (let i = region.start; i < region.end; i++) occupied.add(i)
  }
  return selected
}

function applyG4ToDotBracket(dotBracket: string[], g4Regions: G4Region[]): void {
  for (const region of g4Regions) {
    for (const tract of region.gTracts) {
      for (let i = tract.start; i < tract.end; i++) dotBracket[i] = '+'
    }
    for (let i = region.start; i < region.end; i++) {
      if (dotBracket[i] === '(' || dotBracket[i] === ')') dotBracket[i] = '.'
    }
  }
}

// ── Turner RNA Parameters (2004) ──
// Nearest-neighbor stacking energies in kcal/mol at 37°C
// From: Mathews, Sabina, Zuker & Turner (2004) J Mol Biol 288:911-940
//
// Key format: 5'-XY-3' paired with 3'-WZ-5' → 'XY/WZ'
// where X pairs with W, and Y pairs with Z
// i.e., for consecutive base pairs (i,j) and (i+1,j-1):
//   X=s[i], Y=s[i+1], W=s[j], Z=s[j-1]
//   key = s[i]s[i+1] / s[j]s[j-1]

const STACKING_ENERGIES: Record<string, number> = {
  // Watson-Crick pairs
  'CG/CG': -2.36, 'CG/GC': -3.42, 'CG/AU': -2.11, 'CG/UA': -2.35,
  'CG/GU': -1.41, 'CG/UG': -2.11,
  'GC/CG': -3.26, 'GC/GC': -2.36, 'GC/AU': -2.35, 'GC/UA': -2.11,
  'GC/GU': -2.11, 'GC/UG': -1.41,
  'AU/CG': -2.11, 'AU/GC': -2.35, 'AU/AU': -0.93, 'AU/UA': -1.10,
  'AU/GU': -0.55, 'AU/UG': -1.36,
  'UA/CG': -2.35, 'UA/GC': -2.11, 'UA/AU': -1.33, 'UA/UA': -0.93,
  'UA/GU': -1.00, 'UA/UG': -0.55,
  // Wobble pairs
  'GU/CG': -2.11, 'GU/GC': -1.41, 'GU/AU': -1.36, 'GU/UA': -0.55,
  'GU/GU':  0.47, 'GU/UG': -1.29,
  'UG/CG': -1.41, 'UG/GC': -2.11, 'UG/AU': -0.55, 'UG/UA': -1.36,
  'UG/GU': -0.38, 'UG/UG':  0.47,
}

// Hairpin loop initiation free energies (kcal/mol) at 37°C
const HAIRPIN_LOOP_INIT: Record<number, number> = {
  3: 5.40, 4: 5.60, 5: 5.70, 6: 5.40, 7: 6.00, 8: 5.50,
  9: 6.40, 10: 6.50, 12: 6.70, 14: 6.90, 16: 7.00, 18: 7.10,
  20: 7.20, 25: 7.50, 30: 7.70,
}

// Internal loop initiation free energies (kcal/mol) at 37°C
const INTERNAL_LOOP_INIT: Record<number, number> = {
  1: 0.0, 2: 0.70, 3: 1.70, 4: 1.80, 5: 2.00, 6: 2.20,
  7: 2.30, 8: 2.40, 9: 2.50, 10: 2.60, 12: 2.80, 14: 3.00,
  16: 3.10, 18: 3.20, 20: 3.30, 25: 3.50, 30: 3.70,
}

// Bulge loop initiation free energies
const BULGE_LOOP_INIT: Record<number, number> = {
  1: 3.80, 2: 2.80, 3: 3.20, 4: 3.60, 5: 4.00, 6: 4.40,
  7: 4.60, 8: 4.70, 9: 4.80, 10: 4.90, 12: 5.10, 14: 5.30,
  16: 5.40, 18: 5.50, 20: 5.60, 25: 5.80, 30: 6.00,
}

const MIN_HAIRPIN = 3
const AU_END_PENALTY = 0.45 // penalty for AU or GU closing pairs
const MULTI_LOOP_A = 3.40   // multi-loop offset
const MULTI_LOOP_B = 0.40   // per-branch penalty
const MULTI_LOOP_C = 0.00   // per-unpaired nt (simplified to 0)
const RT = 0.61632           // kcal/mol at 37°C

const VALID_PAIRS = new Set(['AU', 'UA', 'GC', 'CG', 'GU', 'UG'])

function canPair(a: string, b: string): boolean {
  return VALID_PAIRS.has(a + b)
}

/** Terminal AU/GU penalty: +0.45 kcal/mol per AU or GU pair at helix end */
function terminalPenalty(a: string, b: string): number {
  const pair = a + b
  if (pair === 'AU' || pair === 'UA' || pair === 'GU' || pair === 'UG') return AU_END_PENALTY
  return 0
}

/** Get stacking energy for consecutive pairs (i,j) and (i+1,j-1) */
function stackingEnergy(si: string, sj: string, si1: string, sj1: string): number {
  // Key: 5'-si si1-3' / 3'-sj sj1-5' BUT sj1 is at j-1
  // Format: XY/WZ where X=s[i], Y=s[i+1], W=s[j], Z=s[j-1]
  const key = `${si}${si1}/${sj}${sj1}`
  return STACKING_ENERGIES[key] ?? -1.0
}

/** Interpolate loop energy from the table */
function getLoopEnergy(table: Record<number, number>, size: number, maxTabulated: number, defaultMax: number): number {
  if (table[size] !== undefined) return table[size]
  // Find closest smaller tabulated value
  let closest = 0
  let closestE = defaultMax
  for (const k of Object.keys(table)) {
    const kn = parseInt(k)
    if (kn <= size && kn > closest) {
      closest = kn
      closestE = table[kn]
    }
  }
  if (size <= maxTabulated) {
    // Linear interpolate
    let nextKey = maxTabulated
    let nextE = defaultMax
    for (const k of Object.keys(table)) {
      const kn = parseInt(k)
      if (kn > closest && kn < nextKey) {
        nextKey = kn
        nextE = table[kn]
      }
    }
    const frac = (size - closest) / (nextKey - closest)
    return closestE + frac * (nextE - closestE)
  }
  // Jacobson-Stockmayer extrapolation for size > 30
  return closestE + 1.75 * RT * Math.log(size / closest)
}

function hairpinEnergy(size: number): number {
  return getLoopEnergy(HAIRPIN_LOOP_INIT, size, 30, 7.7)
}

function internalLoopEnergy(size: number): number {
  return getLoopEnergy(INTERNAL_LOOP_INIT, size, 30, 3.7)
}

function bulgeEnergy(size: number): number {
  return getLoopEnergy(BULGE_LOOP_INIT, size, 30, 6.0)
}

// ── Core DP ──

function predictStructureTurner(sequence: string, gquadEnabled: boolean = true): RNAFoldResult {
  const seq = sequence.toUpperCase().replace(/T/g, 'U')
  const n = seq.length

  if (n === 0) {
    return {
      dotBracket: '', mfe: 0, numBasePairs: 0,
      hasGQuad: false, gquadEnabled,
      engine: 'Turner model (2004)', length: 0,
    }
  }

  const maxLen = Math.min(n, 500)
  const s = seq.substring(0, maxLen)

  // Strategy 1: Pure stem structure (no G4)
  const stemResult = computeMFE(s, maxLen, new Set())
  let bestDotBracket = [...stemResult.dotBracket]
  let bestMfe = stemResult.mfe
  let bestPairs = stemResult.numBasePairs
  let hasG4 = false
  let g4Regions: G4Region[] = []

  // Strategy 2: With G4 (if enabled)
  if (gquadEnabled) {
    const detectedG4 = detectG4Regions(s)
    if (detectedG4.length > 0) {
      const g4Positions = new Set<number>()
      for (const region of detectedG4) {
        for (let i = region.start; i < region.end; i++) g4Positions.add(i)
      }
      const g4StemResult = computeMFE(s, maxLen, g4Positions)
      const g4Energy = detectedG4.reduce((sum, r) => sum + r.energy, 0)
      const totalG4Mfe = g4StemResult.mfe + g4Energy

      if (totalG4Mfe < bestMfe) {
        bestDotBracket = [...g4StemResult.dotBracket]
        bestMfe = totalG4Mfe
        bestPairs = g4StemResult.numBasePairs
        hasG4 = true
        g4Regions = detectedG4
        applyG4ToDotBracket(bestDotBracket, g4Regions)
      }
    }
  }

  const fullDotBracket = bestDotBracket.join('') + '.'.repeat(n - maxLen)

  return {
    dotBracket: fullDotBracket,
    mfe: Math.round(bestMfe * 100) / 100,
    numBasePairs: bestPairs,
    hasGQuad: hasG4,
    gquadEnabled,
    engine: 'Turner model (2004)',
    length: n,
  }
}

/**
 * Core MFE computation using the Zuker algorithm with Turner parameters.
 *
 * DP matrices:
 *   V[i][j] = MFE of subsequence s[i..j] given that (i,j) form a base pair
 *   W[i][j] = MFE of subsequence s[i..j] (unrestricted)
 *
 * V[i][j] considers:
 *   1. Hairpin loop closed by (i,j)
 *   2. Stacking: (i,j) stacks on (i+1,j-1)
 *   3. Internal loops / bulges: (i,j) closes loop with inner pair (p,q)
 *   4. Multi-loop: (i,j) closes a multi-branch loop
 *
 * W[i][j] considers:
 *   1. i unpaired: W[i+1][j]
 *   2. j unpaired: W[i][j-1]
 *   3. (i,j) paired: V[i][j] + terminal penalties
 *   4. Bifurcation: W[i][k] + W[k+1][j]
 */
function computeMFE(
  s: string,
  n: number,
  excludedPositions: Set<number>
): { dotBracket: string[]; mfe: number; numBasePairs: number } {
  function canUse(pos: number): boolean {
    return !excludedPositions.has(pos)
  }

  const INF = 1e9
  const W: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const V: number[][] = Array.from({ length: n }, () => new Array(n).fill(INF))

  // Fill DP tables bottom-up by span length
  for (let span = MIN_HAIRPIN + 1; span < n; span++) {
    for (let i = 0; i < n - span; i++) {
      const j = i + span

      // ── V[i][j]: energy when (i,j) are paired ──
      if (canUse(i) && canUse(j) && canPair(s[i], s[j])) {
        let best = INF

        // 1. Hairpin loop
        const hpSize = j - i - 1
        if (hpSize >= MIN_HAIRPIN) {
          // Hairpin energy = initiation + closing pair terminal penalty
          const hpE = hairpinEnergy(hpSize) + terminalPenalty(s[i], s[j])
          best = Math.min(best, hpE)
        }

        // 2. Stacking: (i,j) stacks directly on (i+1, j-1)
        if (i + 1 < j - 1 && canUse(i + 1) && canUse(j - 1) &&
            canPair(s[i + 1], s[j - 1]) && V[i + 1][j - 1] < INF) {
          const stackE = stackingEnergy(s[i], s[j], s[i + 1], s[j - 1])
          best = Math.min(best, V[i + 1][j - 1] + stackE)
        }

        // 3. Internal loops and bulges
        // (i,j) closes a loop with inner pair (p,q)
        // Internal loop: both sides > 0 unpaired
        // Bulge: exactly one side has 0 unpaired
        const maxIL = Math.min(30, j - i - 3) // max total loop size
        for (let p = i + 1; p <= Math.min(i + maxIL + 1, j - MIN_HAIRPIN - 1); p++) {
          if (!canUse(p)) continue
          const leftSize = p - i - 1 // unpaired on left side

          for (let q = Math.max(p + MIN_HAIRPIN + 1, j - maxIL + leftSize - 1); q < j; q++) {
            if (!canUse(q)) continue
            if (!canPair(s[p], s[q])) continue
            if (V[p][q] >= INF) continue

            const rightSize = j - q - 1 // unpaired on right side
            const totalLoop = leftSize + rightSize
            if (totalLoop === 0) continue // that's stacking (handled above)
            if (totalLoop > 30) continue

            let loopE: number
            if (leftSize === 0 || rightSize === 0) {
              // Bulge loop
              const bulgeSize = leftSize + rightSize
              loopE = bulgeEnergy(bulgeSize)
              // For single-nucleotide bulge, stacking of closing pairs is included
              if (bulgeSize === 1) {
                loopE += stackingEnergy(s[i], s[j], s[p], s[q])
                // Remove the double-count: bulge of 1 also gets closing pair stacking
              }
              // Terminal penalty for closing pairs
              loopE += terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])
            } else {
              // Internal loop
              loopE = internalLoopEnergy(totalLoop)
              // Asymmetry penalty
              const asymmetry = Math.abs(leftSize - rightSize)
              loopE += asymmetry * 0.30 // ninio asymmetry

              // Terminal penalties for both closing pairs
              loopE += terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])

              // Special case: 1x1 internal loop (mismatch stacking)
              if (leftSize === 1 && rightSize === 1) {
                loopE = internalLoopEnergy(2) + terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])
              }
            }

            best = Math.min(best, V[p][q] + loopE)
          }
        }

        // 4. Multi-loop: (i,j) closes a multi-branch loop
        // Decompose i+1..j-1 into two or more stems
        for (let k = i + MIN_HAIRPIN + 2; k < j - MIN_HAIRPIN - 1; k++) {
          const left = W[i + 1][k]
          const right = W[k + 1][j - 1]
          if (left + right < INF) {
            const mlE = MULTI_LOOP_A + terminalPenalty(s[i], s[j])
            best = Math.min(best, left + right + mlE)
          }
        }

        V[i][j] = best
      }

      // ── W[i][j]: unrestricted minimum ──
      let wBest = 0 // fully unpaired = 0

      // i unpaired
      if (i + 1 <= j) wBest = Math.min(wBest, W[i + 1][j])

      // j unpaired
      if (i <= j - 1) wBest = Math.min(wBest, W[i][j - 1])

      // (i,j) paired
      if (V[i][j] < INF) {
        wBest = Math.min(wBest, V[i][j])
      }

      // Bifurcation: split into two sub-problems
      for (let k = i + 1; k < j; k++) {
        const sum = W[i][k] + W[k + 1][j]
        if (sum < wBest) wBest = sum
      }

      W[i][j] = wBest
    }
  }

  // ── Traceback ──
  const pairs: [number, number][] = []
  traceW(W, V, s, 0, n - 1, pairs, excludedPositions)

  const dotBracket = new Array(n).fill('.')
  for (const [a, b] of pairs) {
    dotBracket[a] = '('
    dotBracket[b] = ')'
  }

  return {
    dotBracket,
    mfe: W[0][n - 1],
    numBasePairs: pairs.length,
  }
}

// ── Traceback functions ──

const TB_EPS = 1e-4

function traceW(
  W: number[][], V: number[][], s: string,
  i: number, j: number, pairs: [number, number][],
  ex: Set<number>
): void {
  if (i >= j || W[i][j] >= -TB_EPS) return // energy ~0 means no structure

  // i unpaired
  if (i + 1 <= j && Math.abs(W[i][j] - W[i + 1][j]) < TB_EPS) {
    traceW(W, V, s, i + 1, j, pairs, ex)
    return
  }

  // j unpaired
  if (i <= j - 1 && Math.abs(W[i][j] - W[i][j - 1]) < TB_EPS) {
    traceW(W, V, s, i, j - 1, pairs, ex)
    return
  }

  // (i,j) paired
  if (!ex.has(i) && !ex.has(j) && V[i][j] < 1e9 && Math.abs(W[i][j] - V[i][j]) < TB_EPS) {
    pairs.push([i, j])
    traceV(W, V, s, i, j, pairs, ex)
    return
  }

  // Bifurcation
  for (let k = i + 1; k < j; k++) {
    if (Math.abs(W[i][j] - (W[i][k] + W[k + 1][j])) < TB_EPS) {
      traceW(W, V, s, i, k, pairs, ex)
      traceW(W, V, s, k + 1, j, pairs, ex)
      return
    }
  }
}

function traceV(
  W: number[][], V: number[][], s: string,
  i: number, j: number, pairs: [number, number][],
  ex: Set<number>
): void {
  const INF = 1e9

  // Hairpin
  const hpSize = j - i - 1
  if (hpSize >= MIN_HAIRPIN) {
    const hpE = hairpinEnergy(hpSize) + terminalPenalty(s[i], s[j])
    if (Math.abs(V[i][j] - hpE) < TB_EPS) return
  }

  // Stacking
  if (i + 1 < j - 1 && !ex.has(i + 1) && !ex.has(j - 1) &&
      canPair(s[i + 1], s[j - 1]) && V[i + 1][j - 1] < INF) {
    const stackE = stackingEnergy(s[i], s[j], s[i + 1], s[j - 1])
    if (Math.abs(V[i][j] - (V[i + 1][j - 1] + stackE)) < TB_EPS) {
      pairs.push([i + 1, j - 1])
      traceV(W, V, s, i + 1, j - 1, pairs, ex)
      return
    }
  }

  // Internal loops and bulges
  const maxIL = Math.min(30, j - i - 3)
  for (let p = i + 1; p <= Math.min(i + maxIL + 1, j - MIN_HAIRPIN - 1); p++) {
    if (ex.has(p)) continue
    const leftSize = p - i - 1

    for (let q = Math.max(p + MIN_HAIRPIN + 1, j - maxIL + leftSize - 1); q < j; q++) {
      if (ex.has(q)) continue
      if (!canPair(s[p], s[q]) || V[p][q] >= INF) continue

      const rightSize = j - q - 1
      const totalLoop = leftSize + rightSize
      if (totalLoop === 0 || totalLoop > 30) continue

      let loopE: number
      if (leftSize === 0 || rightSize === 0) {
        const bulgeSize = leftSize + rightSize
        loopE = bulgeEnergy(bulgeSize)
        if (bulgeSize === 1) loopE += stackingEnergy(s[i], s[j], s[p], s[q])
        loopE += terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])
      } else {
        loopE = internalLoopEnergy(totalLoop)
        loopE += Math.abs(leftSize - rightSize) * 0.30
        loopE += terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])
        if (leftSize === 1 && rightSize === 1) {
          loopE = internalLoopEnergy(2) + terminalPenalty(s[i], s[j]) + terminalPenalty(s[p], s[q])
        }
      }

      if (Math.abs(V[i][j] - (V[p][q] + loopE)) < TB_EPS) {
        pairs.push([p, q])
        traceV(W, V, s, p, q, pairs, ex)
        return
      }
    }
  }

  // Multi-loop
  for (let k = i + MIN_HAIRPIN + 2; k < j - MIN_HAIRPIN - 1; k++) {
    const mlE = MULTI_LOOP_A + terminalPenalty(s[i], s[j])
    if (Math.abs(V[i][j] - (W[i + 1][k] + W[k + 1][j - 1] + mlE)) < TB_EPS) {
      traceW(W, V, s, i + 1, k, pairs, ex)
      traceW(W, V, s, k + 1, j - 1, pairs, ex)
      return
    }
  }
}
