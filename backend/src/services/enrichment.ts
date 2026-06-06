/**
 * Enrichment analysis: track sequences across SELEX rounds
 * and calculate fold-change enrichment.
 */

interface RoundData {
  id: string
  roundNumber: number
  totalReads: number
  sequences: { sequence: string; readCount: number; percentRead: number }[]
}

export interface EnrichmentEntry {
  sequence: string
  rounds: {
    roundNumber: number
    readCount: number
    percentRead: number
  }[]
  enrichmentFold: number | null  // fold change from first to last round
  maxPercentRead: number
  totalReads: number
  presentInRounds: number
}

export function calculateEnrichment(
  rounds: RoundData[],
  minReadCount: number = 1,
  minPercentRead: number = 0,
  topN: number = 200
): EnrichmentEntry[] {
  if (rounds.length === 0) return []

  // Build a map: sequence -> { roundNumber -> { readCount, percentRead } }
  const seqMap = new Map<string, Map<number, { readCount: number; percentRead: number }>>()

  for (const round of rounds) {
    for (const seq of round.sequences) {
      if (!seqMap.has(seq.sequence)) {
        seqMap.set(seq.sequence, new Map())
      }
      seqMap.get(seq.sequence)!.set(round.roundNumber, {
        readCount: seq.readCount,
        percentRead: seq.percentRead,
      })
    }
  }

  const roundNumbers = rounds.map((r) => r.roundNumber).sort((a, b) => a - b)
  const firstRound = roundNumbers[0]
  const lastRound = roundNumbers[roundNumbers.length - 1]

  // Build enrichment entries
  const entries: EnrichmentEntry[] = []

  for (const [sequence, roundMap] of seqMap) {
    // Apply filters: check if the sequence passes in the last round
    const lastRoundData = roundMap.get(lastRound)
    if (lastRoundData) {
      if (lastRoundData.readCount < minReadCount) continue
      if (lastRoundData.percentRead < minPercentRead) continue
    }

    const roundEntries = roundNumbers.map((rn) => {
      const data = roundMap.get(rn)
      return {
        roundNumber: rn,
        readCount: data?.readCount || 0,
        percentRead: data?.percentRead || 0,
      }
    })

    const firstPct = roundMap.get(firstRound)?.percentRead || 0
    const lastPct = roundMap.get(lastRound)?.percentRead || 0

    let enrichmentFold: number | null = null
    if (firstPct > 0) {
      enrichmentFold = lastPct / firstPct
    } else if (lastPct > 0) {
      enrichmentFold = Infinity
    }

    const maxPercentRead = Math.max(...roundEntries.map((r) => r.percentRead))
    const totalReads = roundEntries.reduce((sum, r) => sum + r.readCount, 0)
    const presentInRounds = roundEntries.filter((r) => r.readCount > 0).length

    entries.push({
      sequence,
      rounds: roundEntries,
      enrichmentFold,
      maxPercentRead,
      totalReads,
      presentInRounds,
    })
  }

  // Sort by enrichment fold (descending), then by maxPercentRead
  entries.sort((a, b) => {
    const aFold = a.enrichmentFold === Infinity ? 1e15 : (a.enrichmentFold || 0)
    const bFold = b.enrichmentFold === Infinity ? 1e15 : (b.enrichmentFold || 0)
    if (bFold !== aFold) return bFold - aFold
    return b.maxPercentRead - a.maxPercentRead
  })

  return entries.slice(0, topN)
}
