/**
 * Parse FASTA file content into sequences with read counts.
 *
 * Supports formats:
 * 1. Standard FASTA with read count in header: >seq_name-123 or >seq_name_count=123 or >seq_name x123
 * 2. Tab-separated: sequence\tcount
 * 3. Standard FASTA where each entry = 1 read (duplicates are counted)
 */
export interface ParsedSequence {
  sequence: string
  readCount: number
}

export function parseFasta(content: string): ParsedSequence[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)

  // Detect format
  const isTabSeparated = lines.some((l) => !l.startsWith('>') && l.includes('\t'))
  const isFasta = lines.some((l) => l.startsWith('>'))

  if (isTabSeparated && !isFasta) {
    return parseTabSeparated(lines)
  }

  if (isFasta) {
    return parseFastaFormat(lines)
  }

  // Fallback: treat each line as a sequence, count duplicates
  return countDuplicates(lines.map((l) => l.trim().toUpperCase()))
}

function parseTabSeparated(lines: string[]): ParsedSequence[] {
  const seqMap = new Map<string, number>()

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length >= 2) {
      const seq = parts[0].trim().toUpperCase()
      const count = parseInt(parts[1].trim(), 10) || 1
      if (seq && /^[ACGTURYKMSWBDHVN]+$/i.test(seq)) {
        seqMap.set(seq, (seqMap.get(seq) || 0) + count)
      }
    }
  }

  return Array.from(seqMap.entries())
    .map(([sequence, readCount]) => ({ sequence, readCount }))
    .sort((a, b) => b.readCount - a.readCount)
}

function parseFastaFormat(lines: string[]): ParsedSequence[] {
  const entries: { header: string; sequence: string }[] = []
  let currentHeader = ''
  let currentSeq = ''

  for (const line of lines) {
    if (line.startsWith('>')) {
      if (currentSeq) {
        entries.push({ header: currentHeader, sequence: currentSeq.toUpperCase() })
      }
      currentHeader = line.substring(1).trim()
      currentSeq = ''
    } else {
      currentSeq += line.trim()
    }
  }
  if (currentSeq) {
    entries.push({ header: currentHeader, sequence: currentSeq.toUpperCase() })
  }

  // Try to extract read count from headers
  const seqMap = new Map<string, number>()

  for (const entry of entries) {
    const count = extractReadCount(entry.header)
    const seq = entry.sequence
    if (seq && /^[ACGTURYKMSWBDHVN]+$/i.test(seq)) {
      seqMap.set(seq, (seqMap.get(seq) || 0) + count)
    }
  }

  return Array.from(seqMap.entries())
    .map(([sequence, readCount]) => ({ sequence, readCount }))
    .sort((a, b) => b.readCount - a.readCount)
}

function extractReadCount(header: string): number {
  // Pattern: -123 at end
  let match = header.match(/-(\d+)$/)
  if (match) return parseInt(match[1], 10)

  // Pattern: count=123 or count:123
  match = header.match(/count[=:](\d+)/i)
  if (match) return parseInt(match[1], 10)

  // Pattern: x123 at end or _123 at end
  match = header.match(/[x_](\d+)$/i)
  if (match) return parseInt(match[1], 10)

  // Pattern: reads=123
  match = header.match(/reads?[=:](\d+)/i)
  if (match) return parseInt(match[1], 10)

  // Pattern: size=123 (USEARCH/VSEARCH format)
  match = header.match(/size[=:](\d+)/i)
  if (match) return parseInt(match[1], 10)

  // Pattern: just a number after space
  match = header.match(/\s(\d+)$/)
  if (match) return parseInt(match[1], 10)

  return 1
}

function countDuplicates(sequences: string[]): ParsedSequence[] {
  const seqMap = new Map<string, number>()
  for (const seq of sequences) {
    if (seq && /^[ACGTURYKMSWBDHVN]+$/i.test(seq)) {
      seqMap.set(seq, (seqMap.get(seq) || 0) + 1)
    }
  }
  return Array.from(seqMap.entries())
    .map(([sequence, readCount]) => ({ sequence, readCount }))
    .sort((a, b) => b.readCount - a.readCount)
}
