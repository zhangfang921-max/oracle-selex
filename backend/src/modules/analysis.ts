import { Router, Request, Response } from 'express'
import multer from 'multer'
import { gunzipSync } from 'zlib'
import { prisma } from '../config/database'
import { parseFasta } from '../services/fastaParser'
import { calculateEnrichment } from '../services/enrichment'
import { discoverMotifs } from '../services/motifDiscovery'
import { scoreG4, scoreG4Batch } from '../services/g4Screener'
import { predictStructureBatch } from '../services/rnaFold'
import { generateExcel } from '../services/excelExport'
import { clusterSequences, clusterByStructure } from '../services/sequenceCluster'

// Helper: convert BigInt fields to numbers for service functions
function toPlainRounds(rounds: any[]) {
  return rounds.map((r: any) => ({
    ...r,
    totalReads: Number(r.totalReads),
    sequences: r.sequences?.map((s: any) => ({
      ...s,
      readCount: Number(s.readCount),
      percentRead: Number(s.percentRead),
    })) ?? [],
  }))
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
})

// Multer error handler middleware
const handleMulterError = (err: any, req: Request, res: Response, next: Function) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, message: 'File too large. Maximum size is 200 MB.' })
      return
    }
    res.status(400).json({ success: false, message: `Upload error: ${err.message}` })
    return
  }
  if (err) {
    res.status(500).json({ success: false, message: `Upload error: ${err.message}` })
    return
  }
  next()
}

export const analysisRouter = Router()

// Create a new analysis
analysisRouter.post('/create', async (req: Request, res: Response) => {
  const { name } = req.body
  const analysis = await prisma.analysis.create({
    data: { name: name || `Analysis ${new Date().toISOString().slice(0, 10)}` },
  })
  res.json({ success: true, data: analysis })
})

// Upload FASTA file for a round
analysisRouter.post('/upload', upload.single('file'), handleMulterError, async (req: Request, res: Response) => {
  try {
    const { analysisId, roundNumber } = req.body
    const file = req.file

    if (!file || !analysisId || roundNumber === undefined) {
      res.status(400).json({ success: false, message: 'Missing file, analysisId, or roundNumber' })
      return
    }

    const roundNum = parseInt(roundNumber, 10)

    // Verify analysis exists
    const analysisExists = await prisma.analysis.findUnique({ where: { id: analysisId } })
    if (!analysisExists) {
      res.status(404).json({ success: false, message: 'Analysis not found. It may have been deleted.' })
      return
    }

    // Decompress if gzip (.gz) file
    let content: string
    const isGzip = file.originalname.endsWith('.gz') ||
      (file.buffer.length >= 2 && file.buffer[0] === 0x1f && file.buffer[1] === 0x8b)
    try {
      if (isGzip) {
        const decompressed = gunzipSync(file.buffer)
        content = decompressed.toString('utf-8')
      } else {
        content = file.buffer.toString('utf-8')
      }
    } catch (decompErr: any) {
      res.status(400).json({ success: false, message: `Failed to decompress file: ${decompErr.message}` })
      return
    }

    // Parse FASTA
    let sequences
    try {
      sequences = parseFasta(content)
    } catch (parseErr: any) {
      res.status(400).json({ success: false, message: `Failed to parse FASTA file: ${parseErr.message}` })
      return
    }

    if (sequences.length === 0) {
      res.status(400).json({ success: false, message: 'No valid sequences found in the file. Check the file format.' })
      return
    }

    const totalReads = sequences.reduce((sum, s) => sum + s.readCount, 0)
    const totalReadsBig = BigInt(totalReads)

    // Upsert the round
    const round = await prisma.round.upsert({
      where: { analysisId_roundNumber: { analysisId, roundNumber: roundNum } },
      create: {
        analysisId,
        roundNumber: roundNum,
        fileName: file.originalname,
        totalReads: totalReadsBig,
      },
      update: {
        fileName: file.originalname,
        totalReads: totalReadsBig,
      },
    })

    // Delete old sequences for this round
    await prisma.sequence.deleteMany({ where: { roundId: round.id } })

    // Only store top sequences (by read count) to keep DB manageable and fast
    const maxStoredSequences = 10000
    const seqsToStore = sequences.length > maxStoredSequences
      ? sequences.sort((a, b) => b.readCount - a.readCount).slice(0, maxStoredSequences)
      : sequences

    // Use raw SQL multi-row INSERT for massive speed improvement over Prisma createMany
    const batchSize = 2000
    for (let i = 0; i < seqsToStore.length; i += batchSize) {
      const batch = seqsToStore.slice(i, i + batchSize)
      const values = batch.map((s) => {
        const pctRead = totalReads > 0 ? (s.readCount / totalReads) * 100 : 0
        // Escape single quotes in sequence
        const escapedSeq = s.sequence.replace(/'/g, "''")
        // Generate a unique id (cuid-like: timestamp + random)
        const id = `seq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
        return `('${id}', '${round.id}', '${escapedSeq}', ${s.readCount}, ${pctRead})`
      }).join(',')

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Sequence" ("id", "roundId", "sequence", "readCount", "percentRead") VALUES ${values} ON CONFLICT DO NOTHING`
      )
    }

    console.log(`Uploaded Round ${roundNum}: ${seqsToStore.length} sequences stored (of ${sequences.length} total), ${totalReads} total reads from ${file.originalname}`)

    res.json({
      success: true,
      data: {
        roundId: round.id,
        roundNumber: roundNum,
        fileName: file.originalname,
        totalReads,
        uniqueSequences: seqsToStore.length,
      },
    })
  } catch (err: any) {
    console.error('Upload error:', err.message, err.stack?.split('\n')[1])
    res.status(500).json({
      success: false,
      message: `Upload failed: ${err.message || 'Unknown server error. The file may be too large or in an unsupported format.'}`,
    })
  }
})

// List all analyses
analysisRouter.post('/list', async (_req: Request, res: Response) => {
  const analyses = await prisma.analysis.findMany({
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' },
        select: { id: true, roundNumber: true, fileName: true, totalReads: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: analyses })
})

// Get analysis detail
analysisRouter.post('/detail', async (req: Request, res: Response) => {
  const { analysisId } = req.body
  const analysis = await prisma.analysis.findUnique({
    where: { id: analysisId },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' },
        include: {
          sequences: {
            orderBy: { readCount: 'desc' },
            take: 10000,
          },
        },
      },
    },
  })
  if (!analysis) {
    res.status(404).json({ success: false, message: 'Analysis not found' })
    return
  }
  res.json({ success: true, data: analysis })
})

// Run enrichment analysis
analysisRouter.post('/enrichment', async (req: Request, res: Response) => {
  const { analysisId, minReadCount = 1, minPercentRead = 0, topN = 500 } = req.body

  // Fetch up to topN * 5 sequences per round to ensure accurate enrichment ranking
  // while keeping query size manageable and avoiding gateway timeouts
  const seqLimit = Math.min(topN * 5, 50000)

  const analysis = await prisma.analysis.findUnique({
    where: { id: analysisId },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' },
        include: {
          sequences: { orderBy: { readCount: 'desc' }, take: seqLimit },
        },
      },
    },
  })

  if (!analysis) {
    res.status(404).json({ success: false, message: 'Analysis not found' })
    return
  }

  const result = calculateEnrichment(toPlainRounds(analysis.rounds), minReadCount, minPercentRead, topN)
  res.json({ success: true, data: result })
})

// Run motif discovery
analysisRouter.post('/motifs', async (req: Request, res: Response) => {
  const { sequences, kmerSize = 6, topN = 20 } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length === 0) {
    res.status(400).json({ success: false, message: 'Sequences array required' })
    return
  }

  const motifs = discoverMotifs(sequences, kmerSize, topN)
  res.json({ success: true, data: motifs })
})

// Run G4 screening
analysisRouter.post('/g4screen', async (req: Request, res: Response) => {
  const { sequences } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length === 0) {
    res.status(400).json({ success: false, message: 'Sequences array required' })
    return
  }

  try {
    const results = await scoreG4Batch(sequences)
    const data = results.map((r, i) => ({ sequence: sequences[i], ...r }))
    res.json({ success: true, data })
  } catch (err) {
    // Fallback to sync version
    const results = sequences.map((seq: string) => ({
      sequence: seq,
      ...scoreG4(seq),
    }))
    res.json({ success: true, data: results })
  }
})

// Run RNA structure prediction (ViennaRNA with G-Quadruplex)
analysisRouter.post('/rnafold', async (req: Request, res: Response) => {
  const { sequences, gquad = true } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length === 0) {
    res.status(400).json({ success: false, message: 'Sequences array required' })
    return
  }

  const results = await predictStructureBatch(sequences, gquad)
  res.json({ success: true, data: results })
})

// Export results to Excel
analysisRouter.post('/export', async (req: Request, res: Response) => {
  const { analysisId, enrichmentData, g4Data, rnaFoldData, motifData } = req.body

  const analysis = await prisma.analysis.findUnique({
    where: { id: analysisId },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' },
        include: { sequences: { orderBy: { readCount: 'desc' } } },
      },
    },
  })

  if (!analysis) {
    res.status(404).json({ success: false, message: 'Analysis not found' })
    return
  }

  const plainAnalysis = { ...analysis, rounds: toPlainRounds(analysis.rounds) }
  const buffer = await generateExcel(plainAnalysis, enrichmentData, g4Data, rnaFoldData, motifData)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${analysis.name}_results.xlsx"`)
  res.send(buffer)
})

// Cluster sequences
analysisRouter.post('/cluster', async (req: Request, res: Response) => {
  const { enrichmentData, identityThreshold = 0.7, clusterMode = 'sequence', optimalClusterIds } = req.body

  if (!enrichmentData || !Array.isArray(enrichmentData) || enrichmentData.length === 0) {
    res.status(400).json({ success: false, message: 'Sequence data required for clustering' })
    return
  }

  let clusters: Awaited<ReturnType<typeof clusterSequences>>

  if (optimalClusterIds && Array.isArray(optimalClusterIds)) {
    // Use pre-computed ML cluster assignments
    const groupMap = new Map<number, typeof enrichmentData>()
    enrichmentData.forEach((entry: any, idx: number) => {
      const cid = optimalClusterIds[idx] || 1
      if (!groupMap.has(cid)) groupMap.set(cid, [])
      groupMap.get(cid)!.push(entry)
    })

    // Build cluster objects sorted by size desc
    clusters = Array.from(groupMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([_, members], idx) => {
        const finiteFolds = members
          .map((m: any) => m.enrichmentFold)
          .filter((f: any): f is number => f !== null && f !== Infinity && isFinite(f))

        return {
          id: idx + 1,
          representative: members[0].sequence,
          members: members.map((m: any, i: number) => ({
            sequence: m.sequence,
            enrichmentFold: m.enrichmentFold,
            maxPercentRead: m.maxPercentRead,
            totalReads: m.totalReads,
            presentInRounds: m.presentInRounds,
            similarity: i === 0 ? 1.0 : 0.85,
          })),
          size: members.length,
          avgEnrichmentFold: finiteFolds.length > 0 ? Math.round((finiteFolds.reduce((s: number, f: number) => s + f, 0) / finiteFolds.length) * 100) / 100 : 0,
          maxEnrichmentFold: finiteFolds.length > 0 ? Math.round(Math.max(...finiteFolds) * 100) / 100 : 0,
          avgMaxPercentRead: members.length > 0 ? Math.round((members.reduce((s: number, m: any) => s + m.maxPercentRead, 0) / members.length) * 10000) / 10000 : 0,
        }
      })
  } else if (clusterMode === 'structure') {
    // Structure-based clustering: predict dot-bracket for all sequences, then cluster
    const sequences = enrichmentData.map((e: any) => e.sequence)
    const structures = await predictStructureBatch(sequences, true)
    const dotBrackets = structures.map((s) => s.dotBracket)
    clusters = clusterByStructure(enrichmentData, dotBrackets, identityThreshold)
  } else {
    clusters = clusterSequences(enrichmentData, identityThreshold)
  }

  // Run G4 screening on cluster representatives using the real G4RNA Screener
  const repSequences = clusters.map((c) => c.representative)
  let g4Results: Awaited<ReturnType<typeof scoreG4Batch>> = []
  try {
    g4Results = await scoreG4Batch(repSequences)
  } catch (err) {
    console.warn('G4 batch screening failed, using fallback:', (err as Error).message)
    g4Results = repSequences.map((seq) => scoreG4(seq))
  }

  const repsWithG4 = clusters.map((cluster, idx) => {
    const g4 = g4Results[idx] ?? scoreG4(cluster.representative)
    // G4 Risk based on threshold pass count — matches G4RNA Screener
    // published thresholds and ORACLE+ classification (cGcC>4.5, G4Hunter>0.9, G4NN>0.5)
    const passCount = (g4.cGcC > 4.5 ? 1 : 0) + ((g4.g4Hunter ?? 0) > 0.9 ? 1 : 0) + ((g4.g4NN ?? 0) > 0.5 ? 1 : 0)
    const g4Risk = passCount >= 2 ? 'High' as const : passCount >= 1 ? 'Medium' as const : 'Low' as const
    return {
      ...cluster,
      g4Score: g4.g4Score,
      g4Risk,
      numG4Motifs: g4.numG4Motifs,
      cGcC: g4.cGcC,
      g4Hunter: g4.g4Hunter,
      g4NN: g4.g4NN,
      g4Motifs: g4.g4Motifs,
      gRichRegions: g4.gRichRegions,
    }
  })

  // Run RNA structure prediction TWICE: with G4 and without G4
  const rnaRepSequences = repsWithG4.map((c) => c.representative)
  let rnaWithG4: Awaited<ReturnType<typeof predictStructureBatch>> = []
  let rnaWithoutG4: Awaited<ReturnType<typeof predictStructureBatch>> = []
  try {
    ;[rnaWithG4, rnaWithoutG4] = await Promise.all([
      predictStructureBatch(rnaRepSequences, true),
      predictStructureBatch(rnaRepSequences, false),
    ])
  } catch (err) {
    console.warn('RNA fold during clustering failed:', (err as Error).message)
  }

  // Merge RNA results into cluster data
  const enrichedClusters = repsWithG4.map((cluster, idx) => {
    const rnaG4 = rnaWithG4[idx] ?? null
    const rnaNoG4 = rnaWithoutG4[idx] ?? null
    return {
      ...cluster,
      rnaFold: rnaG4 ? {
        dotBracket: rnaG4.dotBracket,
        mfe: rnaG4.mfe,
        numBasePairs: rnaG4.numBasePairs,
        hasGQuad: rnaG4.hasGQuad,
        gquadEnabled: true,
        engine: rnaG4.engine,
        length: rnaG4.length,
      } : null,
      rnaFoldNoG4: rnaNoG4 ? {
        dotBracket: rnaNoG4.dotBracket,
        mfe: rnaNoG4.mfe,
        numBasePairs: rnaNoG4.numBasePairs,
        hasGQuad: false,
        gquadEnabled: false,
        engine: rnaNoG4.engine,
        length: rnaNoG4.length,
      } : null,
    }
  })

  res.json({ success: true, data: enrichedClusters })
})

// Delete analysis
analysisRouter.post('/delete', async (req: Request, res: Response) => {
  const { analysisId } = req.body
  await prisma.analysis.delete({ where: { id: analysisId } })
  res.json({ success: true })
})

// Helper: proxy request to Python analysis service
async function proxyToAnalysisService(endpoint: string, req: Request, res: Response, minSequences: number = 3) {
  const { sequences, clusterIds, clusterSizes } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length < minSequences) {
    res.status(400).json({ success: false, message: `At least ${minSequences} sequences required` })
    return
  }

  try {
    const resp = await fetch(`http://localhost:3003/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequences, clusterIds, clusterSizes }),
    })
    if (!resp.ok) throw new Error(`Analysis service returned ${resp.status}`)
    const json = await resp.json()
    res.json(json)
  } catch (err: any) {
    res.status(503).json({ success: false, message: `Analysis service unavailable: ${err.message}` })
  }
}

// t-SNE dimensionality reduction for cluster visualization
analysisRouter.post('/tsne', async (req: Request, res: Response) => {
  await proxyToAnalysisService('tsne', req, res)
})

// UMAP dimensionality reduction
analysisRouter.post('/umap', async (req: Request, res: Response) => {
  await proxyToAnalysisService('umap', req, res)
})

// PCA dimensionality reduction
analysisRouter.post('/pca', async (req: Request, res: Response) => {
  await proxyToAnalysisService('pca', req, res)
})

// Silhouette analysis
analysisRouter.post('/silhouette', async (req: Request, res: Response) => {
  await proxyToAnalysisService('silhouette', req, res)
})

// Inter-cluster distance matrix
analysisRouter.post('/distance_matrix', async (req: Request, res: Response) => {
  await proxyToAnalysisService('distance_matrix', req, res)
})

// Optimal clustering (ML-based: auto-selects best algorithm and K)
analysisRouter.post('/optimal_cluster', async (req: Request, res: Response) => {
  const { sequences, method, maxClusters, minClusters, forwardPrimer, reversePrimer, structuralScores, featureMode, doPermutationTest, nPermutations, selectionCriterion, readCounts, abundanceThreshold } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length < 3) {
    res.status(400).json({ success: false, message: 'At least 3 sequences required' })
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000)
    const resp = await fetch('http://localhost:3003/optimal_cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sequences,
        method: method || 'auto',
        maxClusters: maxClusters || 30,
        ...(minClusters ? { minClusters } : {}),
        featureMode: featureMode || 'auto',
        doPermutationTest: doPermutationTest || false,
        nPermutations: nPermutations || 1000,
        ...(selectionCriterion ? { selectionCriterion } : {}),
        ...(readCounts ? { readCounts } : {}),
        ...(abundanceThreshold ? { abundanceThreshold } : {}),
        ...(forwardPrimer ? { forwardPrimer } : {}),
        ...(reversePrimer ? { reversePrimer } : {}),
        ...(structuralScores ? { structuralScores } : {}),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`Analysis service returned ${resp.status}`)
    const json = await resp.json()
    res.json(json)
  } catch (err: any) {
    const isConnRefused = err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')
    const msg = isConnRefused
      ? 'Analysis service (port 3003) is not running. Please restart the application.'
      : `Analysis service error: ${err.message}`
    res.status(503).json({ success: false, message: msg })
  }
})
// Network graph — force-directed similarity visualization
analysisRouter.post('/network_graph', async (req: Request, res: Response) => {
  const { sequences, clusterIds, readCounts, dotBrackets, similarityThreshold, maxEdgesPerNode, maxNodes, maxPerCluster, layoutMode, featureMode } = req.body

  if (!sequences || !Array.isArray(sequences) || sequences.length < 3) {
    res.status(400).json({ success: false, message: 'At least 3 sequences required' })
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    const resp = await fetch('http://localhost:3003/network_graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sequences,
        clusterIds: clusterIds || sequences.map((_: any, i: number) => i),
        readCounts: readCounts || null,
        dotBrackets: dotBrackets || null,
        similarityThreshold: similarityThreshold || 0.7,
        maxEdgesPerNode: maxEdgesPerNode || 8,
        maxNodes: maxNodes || 2000,
        ...(maxPerCluster ? { maxPerCluster } : {}),
        ...(layoutMode ? { layoutMode } : {}),
        ...(featureMode ? { featureMode } : {}),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`Analysis service returned ${resp.status}`)
    const json = await resp.json()
    res.json(json)
  } catch (err: any) {
    const isConnRefused = err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')
    const msg = isConnRefused
      ? 'Analysis service (port 3003) is not running. Please restart the application.'
      : `Network graph error: ${err.message}`
    res.status(503).json({ success: false, message: msg })
  }
})
