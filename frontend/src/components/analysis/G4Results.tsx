import { FlaskConical, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { fmtScore } from '@/lib/g4'
import type { G4Result } from '@/types/analysis'

interface G4ResultsProps {
  data: G4Result[]
  isLoading?: boolean
  selectedCount?: number
  onRunG4?: () => void
}

export function G4Results({ data, isLoading, selectedCount = 0, onRunG4 }: G4ResultsProps) {
  if (isLoading) {
    return (
      <FadeIn className="flex flex-col items-center justify-center" style={{ minHeight: 240, gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Screening sequences for G-Quadruplex structures...</p>
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
              background: 'color-mix(in oklch, var(--chart-3, oklch(0.75 0.17 80)) 12%, transparent)',
            }}
          >
            <FlaskConical size={24} style={{ color: 'var(--chart-3, oklch(0.75 0.17 80))' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 4 }}>
              G-Quadruplex Screening
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', maxWidth: 400, margin: '0 auto' }}>
              {selectedCount > 0
                ? `${selectedCount} sequences selected. Click below to screen them for G4 structures.`
                : 'Select sequences first, then run G4 screening to identify potential G-Quadruplex forming sequences.'}
            </p>
          </div>
          {selectedCount > 0 && (
            <Button onClick={onRunG4} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <FlaskConical className="w-4 h-4 mr-1" />
              Screen {selectedCount} Sequences
            </Button>
          )}
        </div>
      </FadeIn>
    )
  }

  // A missing score is styled neutrally and labelled 'n/a'. It must not fall
  // through to the "Low" bucket, which would read as a measured low risk.
  const getScoreColor = (score: number | null) => {
    if (score == null) return 'bg-muted text-muted-foreground'
    if (score >= 1.0) return 'bg-success text-success-foreground'
    if (score >= 0.5) return 'bg-warning text-warning-foreground'
    return 'bg-muted text-muted-foreground'
  }

  const getScoreLabel = (score: number | null) => {
    if (score == null) return 'n/a'
    if (score >= 1.0) return 'High'
    if (score >= 0.5) return 'Medium'
    return 'Low'
  }

  const highlightGRich = (sequence: string, regions: { start: number; end: number }[]) => {
    if (regions.length === 0) return <span>{sequence}</span>

    const parts: React.ReactNode[] = []
    let lastEnd = 0

    const sorted = [...regions].sort((a, b) => a.start - b.start)
    for (const region of sorted) {
      if (region.start > lastEnd) {
        parts.push(<span key={`t-${lastEnd}`}>{sequence.slice(lastEnd, region.start)}</span>)
      }
      parts.push(
        <span
          key={`g-${region.start}`}
          className="bg-warning/30 text-warning-foreground font-bold rounded-sm"
          style={{ padding: '0 1px' }}
        >
          {sequence.slice(region.start, region.end)}
        </span>
      )
      lastEnd = region.end
    }
    if (lastEnd < sequence.length) {
      parts.push(<span key={`t-${lastEnd}`}>{sequence.slice(lastEnd)}</span>)
    }
    return <>{parts}</>
  }

  // Sequences whose score is absent are counted separately rather than being
  // folded into "Low", so the summary bar can never overstate what was measured.
  const scored = data.filter((r): r is G4Result & { g4Score: number } => r.g4Score != null)
  const highCount = scored.filter((r) => r.g4Score >= 1.0).length
  const medCount = scored.filter((r) => r.g4Score >= 0.5 && r.g4Score < 1.0).length
  const lowCount = scored.filter((r) => r.g4Score < 0.5).length
  const unscoredCount = data.length - scored.length

  return (
    <div>
      {/* Summary bar */}
      <FadeIn>
        <div
          className="flex items-center flex-wrap rounded-xl bg-card border border-border shadow-sm"
          style={{ padding: 'var(--spacing-sm) var(--spacing-md)', marginBottom: 'var(--spacing-md)', gap: 'var(--spacing-md)' }}
        >
          <span className="text-sm font-semibold">
            {unscoredCount === data.length
              ? `${data.length} sequences — scoring unavailable`
              : `${data.length} sequences screened`}
          </span>
          <div className="flex items-center" style={{ gap: 'var(--spacing-sm)' }}>
            <span className="text-xs rounded-full bg-success/15 text-success font-semibold px-2 py-0.5">
              {highCount} High
            </span>
            <span className="text-xs rounded-full bg-warning/15 text-warning font-semibold px-2 py-0.5">
              {medCount} Medium
            </span>
            <span className="text-xs rounded-full bg-muted text-muted-foreground font-semibold px-2 py-0.5">
              {lowCount} Low
            </span>
            {unscoredCount > 0 && (
              <span className="text-xs rounded-full bg-destructive/10 text-destructive font-semibold px-2 py-0.5">
                {unscoredCount} not scored
              </span>
            )}
          </div>
        </div>
      </FadeIn>

      <Stagger stagger={0.04} className="flex flex-col" style={{ gap: 'var(--spacing-sm)' }}>
        {data.map((result, idx) => (
          <FadeIn key={idx}>
            <div className="border border-border rounded-lg bg-card" style={{ padding: 'var(--spacing-md)' }}>
              <div className="flex items-start justify-between" style={{ gap: 'var(--spacing-md)' }}>
                <div className="flex-1 min-w-0">
                  <code
                    className="text-xs break-all block"
                    style={{ fontFamily: 'var(--font-family-mono)', lineHeight: '1.6' }}
                  >
                    {highlightGRich(result.sequence, result.gRichRegions)}
                  </code>
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: 'var(--spacing-sm)' }}>
                  <span
                    className={`text-xs font-semibold rounded-full ${getScoreColor(result.g4Score)}`}
                    style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                  >
                    {getScoreLabel(result.g4Score)}
                  </span>
                </div>
              </div>

              <div
                className="flex flex-wrap text-xs text-muted-foreground"
                style={{ gap: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)' }}
              >
                <span>
                  <strong>G4 Score:</strong> {fmtScore(result.g4Score)}
                </span>
                <span>
                  <strong>cGcC:</strong> {fmtScore(result.cGcC)}
                </span>
                <span>
                  <strong>G4 Motifs:</strong> {result.numG4Motifs}
                </span>
                <span>
                  <strong>G-rich regions:</strong> {result.gRichRegions.length}
                </span>
              </div>

              {result.g4Motifs.length > 0 && (
                <div
                  className="text-xs bg-muted/50 rounded"
                  style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-xs) var(--spacing-sm)' }}
                >
                  <span className="font-semibold">Top motif: </span>
                  <code style={{ fontFamily: 'var(--font-family-mono)' }}>
                    {result.g4Motifs[0].motif}
                  </code>
                  <span className="text-muted-foreground ml-2">
                    (pos {result.g4Motifs[0].start}-{result.g4Motifs[0].end}, score{' '}
                    {result.g4Motifs[0].score})
                  </span>
                </div>
              )}
            </div>
          </FadeIn>
        ))}
      </Stagger>
    </div>
  )
}
