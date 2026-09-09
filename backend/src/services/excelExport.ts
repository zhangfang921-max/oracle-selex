import ExcelJS from 'exceljs'

interface AnalysisData {
  name: string
  rounds: {
    roundNumber: number
    fileName: string
    totalReads: number
    sequences: { sequence: string; readCount: number; percentRead: number }[]
  }[]
}

export async function generateExcel(
  analysis: AnalysisData,
  enrichmentData?: any[],
  g4Data?: any[],
  rnaFoldData?: any[],
  motifData?: any
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SELEX Analyzer'
  workbook.created = new Date()

  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    },
  }

  const dataStyle: Partial<ExcelJS.Style> = {
    border: {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    },
  }

  // === Summary Sheet ===
  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [
    { header: 'Property', key: 'prop', width: 25 },
    { header: 'Value', key: 'value', width: 40 },
  ]
  summarySheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

  summarySheet.addRow({ prop: 'Analysis Name', value: analysis.name })
  summarySheet.addRow({ prop: 'Number of Rounds', value: analysis.rounds.length })
  for (const round of analysis.rounds) {
    summarySheet.addRow({
      prop: `Round ${round.roundNumber}`,
      value: `${round.fileName} (${round.totalReads.toLocaleString()} reads, ${round.sequences.length.toLocaleString()} unique)`,
    })
  }

  // === Per-Round Sheets ===
  for (const round of analysis.rounds) {
    const sheet = workbook.addWorksheet(`Round ${round.roundNumber}`)
    sheet.columns = [
      { header: 'Rank', key: 'rank', width: 8 },
      { header: 'Sequence', key: 'sequence', width: 50 },
      { header: 'Read Count', key: 'readCount', width: 14 },
      { header: '% Read', key: 'percentRead', width: 12 },
    ]
    sheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

    round.sequences.forEach((seq, idx) => {
      const row = sheet.addRow({
        rank: idx + 1,
        sequence: seq.sequence,
        readCount: seq.readCount,
        percentRead: Math.round(seq.percentRead * 10000) / 10000,
      })
      row.eachCell((cell) => { Object.assign(cell, { style: dataStyle }) })
      if (idx % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
        })
      }
    })
  }

  // === Sequences Sheet ===
  if (enrichmentData && enrichmentData.length > 0) {
    const seqSheet = workbook.addWorksheet('Sequences')

    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'Rank', key: 'rank', width: 8 },
      { header: 'Sequence', key: 'sequence', width: 50 },
      { header: 'Total Reads', key: 'totalReads', width: 14 },
      { header: 'Max % Read', key: 'maxPercentRead', width: 14 },
    ]

    seqSheet.columns = columns
    seqSheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

    enrichmentData.forEach((entry: any, idx: number) => {
      const rowData: Record<string, any> = {
        rank: idx + 1,
        sequence: entry.sequence,
        totalReads: entry.totalReads ?? 0,
        maxPercentRead: Math.round((entry.maxPercentRead ?? 0) * 10000) / 10000,
      }
      const row = seqSheet.addRow(rowData)
      row.eachCell((cell) => { Object.assign(cell, { style: dataStyle }) })
    })
  }

  // === G4 Screening Sheet ===
  if (g4Data && g4Data.length > 0) {
    const g4Sheet = workbook.addWorksheet('G4 Screening')
    g4Sheet.columns = [
      { header: 'Sequence', key: 'sequence', width: 50 },
      { header: 'G4 Score', key: 'g4Score', width: 12 },
      { header: 'cGcC', key: 'cGcC', width: 10 },
      { header: 'G4Hunter', key: 'g4Hunter', width: 12 },
      { header: 'G4NN', key: 'g4NN', width: 12 },
      { header: 'G4 Risk', key: 'g4Risk', width: 12 },
      { header: 'G4 Motifs', key: 'numG4Motifs', width: 12 },
      { header: 'Top Motif', key: 'topMotif', width: 40 },
    ]
    g4Sheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

    g4Data.forEach((entry: any) => {
      const row = g4Sheet.addRow({
        sequence: entry.sequence,
        g4Score: entry.g4Score,
        cGcC: entry.cGcC,
        g4Hunter: entry.g4Hunter,
        g4NN: entry.g4NN,
        g4Risk: entry.g4Risk,
        numG4Motifs: entry.numG4Motifs,
        topMotif: entry.g4Motifs?.[0]?.motif || 'None',
      })
      row.eachCell((cell) => { Object.assign(cell, { style: dataStyle }) })
    })
  }

  // === RNA Fold Sheet ===
  if (rnaFoldData && rnaFoldData.length > 0) {
    const foldSheet = workbook.addWorksheet('RNA Structure')
    foldSheet.columns = [
      { header: 'Sequence', key: 'sequence', width: 50 },
      { header: 'Dot-Bracket (with G4)', key: 'dotBracket', width: 50 },
      { header: 'MFE with G4 (kcal/mol)', key: 'mfe', width: 20 },
      { header: 'MFE without G4 (kcal/mol)', key: 'mfeNoG4', width: 22 },
      { header: 'Base Pairs', key: 'numBasePairs', width: 12 },
    ]
    foldSheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

    rnaFoldData.forEach((entry: any) => {
      const row = foldSheet.addRow({
        sequence: entry.sequence,
        dotBracket: entry.dotBracket,
        mfe: entry.mfe,
        mfeNoG4: entry.mfeNoG4,
        numBasePairs: entry.numBasePairs,
      })
      row.eachCell((cell) => { Object.assign(cell, { style: dataStyle }) })
    })
  }

  // === Motifs Sheet ===
  if (motifData?.kmers && motifData.kmers.length > 0) {
    const motifSheet = workbook.addWorksheet('Motifs')
    motifSheet.columns = [
      { header: 'K-mer', key: 'kmer', width: 20 },
      { header: 'Count', key: 'count', width: 12 },
      { header: 'Frequency', key: 'frequency', width: 14 },
      { header: 'Rev. Complement', key: 'reverseComplement', width: 20 },
    ]
    motifSheet.getRow(1).eachCell((cell) => { Object.assign(cell, { style: headerStyle }) })

    motifData.kmers.forEach((m: any) => {
      const row = motifSheet.addRow({
        kmer: m.kmer,
        count: m.count,
        frequency: Math.round(m.frequency * 100000) / 100000,
        reverseComplement: m.reverseComplement,
      })
      row.eachCell((cell) => { Object.assign(cell, { style: dataStyle }) })
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
