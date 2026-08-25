/**
 * Does the fixed library scaffold distort the G4 scores?
 *
 * Confirmed design: 7 nt fixed 5' arm + 18 nt random region + 7 nt fixed 3' arm.
 *   5' CGCCGCC ... GGCGGCG 3'   (reverse-complementary -> hairpin scaffold)
 *
 * Why this matters rather than cancelling out:
 *   - cGcC is a RATIO G_score/C_score. CGCCGCC contributes C-runs (+90 to the
 *     denominator) and GGCGGCG contributes G-runs (+90 numerator, +20 denominator).
 *     A constant added to a ratio's denominator is NOT a constant shift - it
 *     compresses the dynamic range and can put the 4.5 threshold out of reach.
 *   - G4Hunter is a MEAN over length. 14 of 32 nt are scaffold, so the random
 *     region's signal is diluted by ~44%.
 *
 * Compares, on the same sequences: full 32 nt construct vs the 18 nt random
 * region alone, and reports how many cross each published threshold.
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const NAME = process.argv[2] || '5th'
const TOP = Number(process.argv[3] || 2000)
const ARM = 7
const TH = { cGcC: 4.5, g4Hunter: 0.9, g4NN: 0.5 }
const n = (v) => (typeof v === 'bigint' ? Number(v) : v)

async function score(seqs) {
  const out = []
  const CHUNK = 500
  for (let i = 0; i < seqs.length; i += CHUNK) {
    const batch = seqs.slice(i, i + CHUNK)
    const res = await fetch('http://localhost:3013/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequences: batch }),
    })
    const j = await res.json()
    out.push(...j.data)
  }
  return out
}

const stats = (xs) => {
  const v = xs.filter((x) => x != null).map(Number).sort((a, b) => a - b)
  if (!v.length) return null
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  return { n: v.length, min: v[0], q25: q(0.25), med: q(0.5), q75: q(0.75), max: v[v.length - 1],
           mean: v.reduce((a, b) => a + b, 0) / v.length }
}

async function main() {
  const a = await prisma.analysis.findFirst({
    where: { name: { contains: NAME } },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })
  const rows = await prisma.sequence.findMany({
    where: { roundId: a.rounds[0].id },
    select: { sequence: true, readCount: true },
    orderBy: { readCount: 'desc' },
    take: TOP,
  })

  const full = rows.map((r) => r.sequence)
  const core = full.map((s) => s.slice(ARM, s.length - ARM))
  const reads = rows.map((r) => n(r.readCount))
  const totalReads = reads.reduce((x, y) => x + y, 0)

  console.log(`analysis "${a.name}", top ${rows.length} sequences by reads ` +
    `(${totalReads} reads)`)
  console.log(`construct length: ${full[0].length} nt -> random region: ${core[0].length} nt`)
  console.log(`example  full: ${full[0]}`)
  console.log(`example  core: ${' '.repeat(ARM)}${core[0]}\n`)

  const sFull = await score(full)
  const sCore = await score(core)

  for (const field of ['cGcC', 'g4Hunter', 'g4NN']) {
    const F = stats(sFull.map((d) => d[field]))
    const C = stats(sCore.map((d) => d[field]))
    console.log(`--- ${field} (threshold ${TH[field]}) ---`)
    console.log(`  full 32nt : mean=${F.mean.toFixed(3)} med=${F.med.toFixed(3)} ` +
      `range=[${F.min.toFixed(3)}, ${F.max.toFixed(3)}]`)
    console.log(`  core 18nt : mean=${C.mean.toFixed(3)} med=${C.med.toFixed(3)} ` +
      `range=[${C.min.toFixed(3)}, ${C.max.toFixed(3)}]`)

    const passF = sFull.filter((d) => d[field] != null && d[field] > TH[field])
    const passC = sCore.filter((d) => d[field] != null && d[field] > TH[field])
    const rF = sFull.reduce((acc, d, i) =>
      acc + (d[field] != null && d[field] > TH[field] ? reads[i] : 0), 0)
    const rC = sCore.reduce((acc, d, i) =>
      acc + (d[field] != null && d[field] > TH[field] ? reads[i] : 0), 0)
    console.log(`  exceeding threshold — full: ${passF.length}/${sFull.length} ` +
      `(${((100 * rF) / totalReads).toFixed(1)}% of reads)   ` +
      `core: ${passC.length}/${sCore.length} (${((100 * rC) / totalReads).toFixed(1)}% of reads)`)
    console.log()
  }

  // risk classification shift
  const classify = (d) => {
    const p = ['cGcC', 'g4Hunter', 'g4NN']
      .filter((f) => d[f] != null && d[f] > TH[f]).length
    return p >= 2 ? 'High' : p >= 1 ? 'Medium' : 'Low'
  }
  const tally = (arr) => arr.reduce((m, d) => {
    const c = classify(d); m[c] = (m[c] || 0) + 1; return m
  }, {})
  console.log('--- risk classification ---')
  console.log('  full 32nt :', JSON.stringify(tally(sFull)))
  console.log('  core 18nt :', JSON.stringify(tally(sCore)))

  let flips = 0
  for (let i = 0; i < sFull.length; i++) {
    if (classify(sFull[i]) !== classify(sCore[i])) flips++
  }
  console.log(`  sequences whose class changes when the scaffold is excluded: ` +
    `${flips}/${sFull.length} (${((100 * flips) / sFull.length).toFixed(1)}%)`)
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
