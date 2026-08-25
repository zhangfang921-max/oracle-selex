/**
 * Evidence for selection of the TAGGAGGG motif, beyond a sequence logo.
 *
 * A logo collapses everything into one consensus and therefore HIDES the
 * strongest signal: whether the motif arose once and was amplified, or arose
 * repeatedly in unrelated sequence backgrounds (convergent selection).
 *
 * Computes, per round:
 *   1. motif frequency, both per-sequence and read-weighted (enrichment curve)
 *   2. observed vs random-library expectation + binomial z (is it even enriched?)
 *   3. number of DISTINCT flanking backgrounds carrying the motif
 *      -> many distinct backgrounds = independent origins, not clonal expansion
 *   4. positional distribution of the motif within the random region
 *   5. rank of TAGGAGGG among ALL 8-mers by read-weighted frequency
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const MOTIF = 'TAGGAGGG'
const K = MOTIF.length

const n = (v) => (typeof v === 'bigint' ? Number(v) : v)

async function main() {
  const analyses = await prisma.analysis.findMany({
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  // Named analyses are the real uploads; "Analysis <date>" are throwaway tests.
  const named = analyses.filter((a) =>
    a.rounds.length > 0 && !/^Analysis\s/i.test(a.name))
  console.log('=== named (non-throwaway) analyses ===')
  for (const a of named) {
    const per = []
    for (const r of a.rounds) {
      const c = await prisma.sequence.count({ where: { roundId: r.id } })
      per.push(`R${r.roundNumber}(${c} seqs)`)
    }
    console.log(`  "${a.name}"  rounds=${a.rounds.length}  ${per.join(' ')}`)
  }

  // Prefer an explicitly requested name, else the most-rounds named analysis,
  // else fall back to whatever has the most rounds overall.
  const want = process.argv[2]
  const pool = named.length ? named : analyses
  const target = (want && pool.find((a) => a.name.toLowerCase().includes(want.toLowerCase())))
    || pool.slice().sort((x, y) => y.rounds.length - x.rounds.length)[0]
  if (!target) {
    console.log('\nno analyses found')
    return
  }
  console.log(`\n>>> analysing: ${target.name}  (${target.rounds.length} rounds)`)

  console.log(`\n${'round'.padEnd(7)}${'seqs'.padStart(8)}${'reads'.padStart(12)}` +
    `${'seq w/motif'.padStart(13)}${'%seq'.padStart(8)}${'%reads'.padStart(9)}` +
    `${'distinct flanks'.padStart(17)}`)
  console.log('-'.repeat(74))

  const summary = []
  for (const r of target.rounds) {
    const seqs = await prisma.sequence.findMany({
      where: { roundId: r.id },
      select: { sequence: true, readCount: true },
    })
    let totalReads = 0
    let motifSeqs = 0
    let motifReads = 0
    const flanks = new Set()
    const positions = new Map()

    for (const s of seqs) {
      const rc = n(s.readCount)
      totalReads += rc
      const idx = s.sequence.indexOf(MOTIF)
      if (idx >= 0) {
        motifSeqs++
        motifReads += rc
        // flanking background = sequence with every motif occurrence masked out
        flanks.add(s.sequence.split(MOTIF).join('|'))
        positions.set(idx, (positions.get(idx) || 0) + rc)
      }
    }

    const pctSeq = seqs.length ? (100 * motifSeqs) / seqs.length : 0
    const pctReads = totalReads ? (100 * motifReads) / totalReads : 0
    console.log(`R${String(r.roundNumber).padEnd(6)}${String(seqs.length).padStart(8)}` +
      `${String(totalReads).padStart(12)}${String(motifSeqs).padStart(13)}` +
      `${pctSeq.toFixed(2).padStart(8)}${pctReads.toFixed(2).padStart(9)}` +
      `${String(flanks.size).padStart(17)}`)

    summary.push({ round: r.roundNumber, seqs, totalReads, motifSeqs, motifReads,
                   pctSeq, pctReads, flanks: flanks.size, positions })
  }

  // ---- random-library expectation ------------------------------------------
  const last = summary[summary.length - 1]
  const L = last.seqs.length
    ? Math.round(last.seqs.reduce((a, s) => a + s.sequence.length, 0) / last.seqs.length)
    : 0
  const windows = Math.max(0, L - K + 1)
  const pSite = Math.pow(0.25, K)
  const pSeq = 1 - Math.pow(1 - pSite, windows)   // P(sequence contains motif) if random
  console.log(`\nrandom-library expectation (mean length ${L} nt, ${windows} windows):`)
  console.log(`  P(a random sequence contains ${MOTIF}) = ${pSeq.toExponential(3)}`)
  console.log(`  i.e. ${(pSeq * 100).toExponential(3)} % of sequences by chance`)
  for (const s of summary) {
    const exp = pSeq * s.seqs.length
    const sd = Math.sqrt(s.seqs.length * pSeq * (1 - pSeq))
    const z = sd > 0 ? (s.motifSeqs - exp) / sd : 0
    const fold = exp > 0 ? s.motifSeqs / exp : Infinity
    console.log(`  R${s.round}: observed ${s.motifSeqs}, expected ${exp.toFixed(2)}, ` +
      `fold=${fold.toExponential(2)}, z=${z.toFixed(1)}`)
  }

  // ---- positional distribution in the final round --------------------------
  console.log(`\nmotif start position (final round, read-weighted):`)
  const pos = [...last.positions.entries()].sort((a, b) => a[0] - b[0])
  for (const [p, reads] of pos) {
    const share = last.motifReads ? (100 * reads) / last.motifReads : 0
    console.log(`  pos ${String(p).padStart(2)}: ${share.toFixed(1).padStart(5)}%  ` +
      '#'.repeat(Math.max(0, Math.round(share / 2))))
  }

  // ---- rank among all 8-mers ----------------------------------------------
  console.log(`\nrank of ${MOTIF} among all ${K}-mers (final round, read-weighted):`)
  const kmer = new Map()
  for (const s of last.seqs) {
    const rc = n(s.readCount)
    const seen = new Set()
    for (let i = 0; i + K <= s.sequence.length; i++) {
      const km = s.sequence.slice(i, i + K)
      if (seen.has(km)) continue      // count each k-mer once per sequence
      seen.add(km)
      kmer.set(km, (kmer.get(km) || 0) + rc)
    }
  }
  const ranked = [...kmer.entries()].sort((a, b) => b[1] - a[1])
  const rank = ranked.findIndex(([km]) => km === MOTIF) + 1
  console.log(`  distinct ${K}-mers observed: ${ranked.length}`)
  console.log(`  ${MOTIF} rank: ${rank || 'not found'} of ${ranked.length}`)
  console.log('  top 12:')
  ranked.slice(0, 12).forEach(([km, reads], i) => {
    const mark = km === MOTIF ? '  <== TAGGAGGG' : ''
    const share = last.totalReads ? (100 * reads) / last.totalReads : 0
    console.log(`    ${String(i + 1).padStart(2)}. ${km}  ${share.toFixed(2)}% of reads${mark}`)
  })
}

main()
  .catch((e) => { console.error('FAILED:', e.message) ; process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
