import { useState, useMemo } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/MotionPrimitives'
import type { EnrichmentEntry } from '@/types/analysis'

interface EnrichmentTableProps {
  data: EnrichmentEntry[]
  isLoading?: boolean
  onRunEnrichment?: () => void
}

type SortField = 'enrichmentFold' | 'maxPercentRead' | 'totalReads' | 'presentInRounds'
type SortDir = 'asc' | 'desc'

export function EnrichmentTable({
  data,
  isLoading,
  onRunEnrichment,
}: EnrichmentTableProps) {
  const [sortField, setSortField] = useState<SortField>('enrichmentFold')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const roundNumbers = useMemo(() => {
    if (data.length === 0) return []
    return data[0].rounds.map((r) => r.roundNumber)
  }, [data])

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let aVal = a[sortField] ?? -Infinity
      let bVal = b[sortField] ?? -Infinity
      if (aVal === Infinity) aVal = 1e15
      if (bVal === Infinity) bVal = 1e15
      return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
    })
  }, [data, sortField, sortDir])

  const pagedData = sortedData.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(sortedData.length / pageSize)

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />
    return sortDir === 'desc' ? (
      <ArrowDown className="w-3 h-3 ml-1" />
    ) : (
      <ArrowUp className="w-3 h-3 ml-1" />
    )
  }

  const formatFold = (fold: number | null) => {
    if (fold === null) return 'N/A'
    if (fold === Infinity) return 'New'
    return fold.toFixed(2) + 'x'
  }

  const getEnrichColor = (fold: number | null) => {
    if (fold === null) return ''
    if (fold === Infinity || fold >= 10) return 'text-success font-semibold'
    if (fold >= 2) return 'text-info'
    if (fold < 1) return 'text-destructive'
    return ''
  }

  if (isLoading) {
    return (
      <FadeIn className="flex flex-col items-center justify-center" style={{ minHeight: 240, gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Running enrichment analysis across rounds...</p>
        <p className="text-xs text-muted-foreground">Comparing sequences to find enriched candidates.</p>
      </FadeIn>
    )
  }

  if (data.length === 0) {
    return (
      <FadeIn>
        <div
          className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border"
          style={{ minHeight: 280, padding: 'var(--spacing-2xl)', gap: 'var(--spacing-md)' }}
        >
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: 56,
              height: 56,
              background: 'color-mix(in oklch, var(--primary) 12%, transparent)',
            }}
          >
            <TrendingUp size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 4 }}>
              Enrichment Analysis
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', maxWidth: 420, margin: '0 auto' }}>
              Compare sequences across selection rounds to identify enriched candidates.
              Sequences that increase in frequency are likely binding your target.
            </p>
          </div>
          <Button onClick={onRunEnrichment} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
            <TrendingUp className="w-4 h-4 mr-1" />
            Run Enrichment Analysis
          </Button>
        </div>
      </FadeIn>
    )
  }

  // Summary stats
  const enriched2x = data.filter((e) => e.enrichmentFold !== null && e.enrichmentFold !== Infinity && e.enrichmentFold >= 2).length
  const newSeqs = data.filter((e) => e.enrichmentFold === Infinity).length

  return (
    <FadeIn>
      {/* Summary bar */}
      <div
        className="flex items-center flex-wrap rounded-xl bg-card border border-border shadow-sm text-sm"
        style={{ padding: '8px 14px', marginBottom: 'var(--spacing-sm)', gap: 'var(--spacing-md)' }}
      >
        <span className="font-semibold">{data.length} candidates</span>
        <span className="text-success font-medium">{enriched2x} enriched &ge;2x</span>
        {newSeqs > 0 && <span className="text-info font-medium">{newSeqs} newly appeared</span>}
      </div>

      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left font-semibold" style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                #
              </th>
              <th
                className="text-left font-semibold"
                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: '220px' }}
              >
                Sequence
              </th>
              {roundNumbers.map((rn) => (
                <th
                  key={rn}
                  className="text-right font-semibold"
                  style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: '100px' }}
                >
                  R{rn} (count / %)
                </th>
              ))}
              <th
                className="text-right font-semibold cursor-pointer hover:text-primary transition-colors select-none"
                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                onClick={() => toggleSort('enrichmentFold')}
              >
                <span className="inline-flex items-center">
                  Fold <SortIcon field="enrichmentFold" />
                </span>
              </th>
              <th
                className="text-right font-semibold cursor-pointer hover:text-primary transition-colors select-none"
                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                onClick={() => toggleSort('maxPercentRead')}
              >
                <span className="inline-flex items-center">
                  Max% <SortIcon field="maxPercentRead" />
                </span>
              </th>
              <th
                className="text-right font-semibold cursor-pointer hover:text-primary transition-colors select-none"
                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                onClick={() => toggleSort('presentInRounds')}
              >
                <span className="inline-flex items-center">
                  Rounds <SortIcon field="presentInRounds" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pagedData.map((entry, idx) => (
              <tr
                key={entry.sequence}
                className="border-t border-border/50 hover:bg-muted/30 transition-colors"
              >
                <td className="text-muted-foreground" style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                  {page * pageSize + idx + 1}
                </td>
                <td style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                  <code
                    className="text-xs break-all"
                    style={{ fontFamily: 'var(--font-family-mono)' }}
                  >
                    {entry.sequence.length > 60
                      ? entry.sequence.substring(0, 60) + '...'
                      : entry.sequence}
                  </code>
                </td>
                {entry.rounds.map((rd) => (
                  <td
                    key={rd.roundNumber}
                    className="text-right tabular-nums"
                    style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                  >
                    <span>{rd.readCount.toLocaleString()}</span>
                    <span className="text-muted-foreground ml-1">
                      / {rd.percentRead.toFixed(3)}%
                    </span>
                  </td>
                ))}
                <td
                  className={`text-right tabular-nums ${getEnrichColor(entry.enrichmentFold)}`}
                  style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                >
                  {formatFold(entry.enrichmentFold)}
                </td>
                <td className="text-right tabular-nums" style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                  {entry.maxPercentRead.toFixed(3)}%
                </td>
                <td className="text-right tabular-nums" style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                  {entry.presentInRounds}/{roundNumbers.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between text-sm text-muted-foreground"
          style={{ marginTop: 'var(--spacing-sm)', padding: '0 var(--spacing-xs)' }}
        >
          <span>
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sortedData.length)} of{' '}
            {sortedData.length}
          </span>
          <div className="flex" style={{ gap: 'var(--spacing-xs)' }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </FadeIn>
  )
}
