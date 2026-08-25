/**
 * Follow-up: is the selected unit a motif, or a STRUCTURE?
 *
 * The 8-mer ranking hinted at two separate families:
 *   family A  TAGGAGGG / TTAGGAGG / AGGAGGGA / GGAGGGAT / ATTAGGAG / GAGGGATT
 *             -> these overlap; they may be windows onto one longer motif
 *   family B  CGCCGCCT / CGCCGCCA  and  AGGCGGCG / TGGCGGCG
 *             -> CGCCGCCT and AGGCGGCG are reverse complements of each other,
 *                which is what a self-complementary STEM looks like
 *
 * Tests here:
 *   1. extend k to find the longest consistently enriched motif (not just 8-mers)
 *   2. for sequences carrying the GC-rich element, check whether the 5' and 3'
 *      ends are reverse-complementary -> evidence of a stem, i.e. a hairpin
 *   3. print the top sequences by read count so the architecture is visible
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const NAME = process.argv[2] || '5th'
const n = (v) => (typeof v === 'bigint' ? Number(v) : v)

const rc = (s) => s.split('').reverse().map((c) =>
  ({ A: 'T', T: 'A', G: 'C', C: 'G' }[c] || c)).join('')

async function main() {
  const a = await prisma.analysis.findFirst({
    where: { name: { contains: NAME } },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })
  if (!a) { console.log(`analysis "${NAME}" not found`); return }
  const seqs = await prisma.sequence.findMany({
    where: { roundId: a.rounds[0].id },
    select: { sequence: true, readCount: true },
    orderBy: { readCount: 'desc' },
  })
  const totalReads = seqs.reduce((s, x) => s + n(x.readCount), 0)
  console.log(`analysis "${a.name}": ${seqs.length} seqs, ${totalReads} reads\n`)

  // ---- 1. longest consistently enriched motif ------------------------------
  console.log('=== most read-enriched k-mer at each k ===')
  console.log(`${'k'.padStart(3)}  ${'top k-mer'.padEnd(24)}${'%reads'.padStart(8)}  ${'#seqs'.padStart(6)}`)
  for (const k of [8, 10, 12, 14, 16, 18, 20]) {
    const m = new Map()
    for (const s of seqs) {
      const reads = n(s.readCount)
      const seen = new Set()
      for (let i = 0; i + k <= s.sequence.length; i++) {
        const km = s.sequence.slice(i, i + k)
        if (seen.has(km)) continue
        seen.add(km)
        const cur = m.get(km) || { reads: 0, seqs: 0 }
        cur.reads += reads; cur.seqs += 1
        m.set(km, cur)
      }
    }
    const [km, v] = [...m.entries()].sort((x, y) => y[1].reads - x[1].reads)[0]
    console.log(`${String(k).padStart(3)}  ${km.padEnd(24)}` +
      `${((100 * v.reads) / totalReads).toFixed(2).padStart(8)}  ${String(v.seqs).padStart(6)}`)
  }

  // ---- 2. stem test --------------------------------------------------------
  console.log('\n=== stem test: are the two ends reverse-complementary? ===')
  const STEM5 = 'CGCCGCC'
  let carry = 0, stemmed = 0
  const lens = new Map()
  for (const s of seqs) {
    const q = s.sequence
    if (!q.startsWith(STEM5)) continue
    carry++
    // longest reverse-complement pairing between the 5' start and the 3' end
    let best = 0
    for (let L = 4; L <= 12 && L <= q.length / 2; L++) {
      if (rc(q.slice(0, L)) === q.slice(q.length - L)) best = L
    }
    if (best >= 5) stemmed++
    lens.set(best, (lens.get(best) || 0) + 1)
  }
  console.log(`  sequences starting with ${STEM5}: ${carry}`)
  console.log(`  of those, 5' end reverse-complementary to 3' end (>=5 nt): ${stemmed}` +
    (carry ? `  (${((100 * stemmed) / carry).toFixed(1)}%)` : ''))
  console.log('  distribution of longest terminal pairing:')
  ;[...lens.entries()].sort((x, y) => x[0] - y[0]).forEach(([L, c]) =>
    console.log(`    ${String(L).padStart(2)} nt : ${c}`))

  // ---- 3. top sequences ----------------------------------------------------
  console.log('\n=== top 10 sequences by reads ===')
  seqs.slice(0, 10).forEach((s, i) => {
    const q = s.sequence
    let best = 0
    for (let L = 4; L <= 12 && L <= q.length / 2; L++) {
      if (rc(q.slice(0, L)) === q.slice(q.length - L)) best = L
    }
    const share = ((100 * n(s.readCount)) / totalReads).toFixed(2)
    const marks = []
    if (q.includes('TAGGAGGG')) marks.push('TAGGAGGG@' + q.indexOf('TAGGAGGG'))
    if (best >= 5) marks.push(`stem${best}nt`)
    const gruns = (q.match(/G{2,}/g) || [])
    marks.push(`Gruns:${gruns.length}[${gruns.join(',')}]`)
    console.log(`  ${String(i + 1).padStart(2)}. ${q}  ${share}%  ${marks.join(' ')}`)
  })
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
