import { ExternalLink, CheckCircle, Cpu, Dna, MousePointerClick, Loader2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import type { RNAFoldResult } from '@/types/analysis'

interface RNAFoldResultsProps {
  data: RNAFoldResult[]
  isLoading?: boolean
  selectedCount?: number
  onRunRNAFold?: () => void
  onGoToEnrichment?: () => void
}

export function RNAFoldResults({ data, isLoading, selectedCount = 0, onRunRNAFold, onGoToEnrichment }: RNAFoldResultsProps) {
  if (isLoading) {
    return (
      <FadeIn className="flex flex-col items-center justify-center" style={{ minHeight: 240, gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Predicting RNA secondary structures...</p>
        <p className="text-xs text-muted-foreground">This may take a moment for complex sequences.</p>
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
            <Dna size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 4 }}>
              RNA Structure Prediction
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', maxWidth: 400, margin: '0 auto' }}>
              {selectedCount > 0
                ? `${selectedCount} sequences selected. Click below to predict their secondary structures.`
                : 'Select sequences from the Enrichment tab first, then run RNA folding to predict secondary structures with minimum free energy.'}
            </p>
          </div>
          {selectedCount > 0 ? (
            <Button onClick={onRunRNAFold} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <Dna className="w-4 h-4 mr-1" />
              Predict {selectedCount} Structures
            </Button>
          ) : (
            <Button variant="outline" onClick={onGoToEnrichment} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <MousePointerClick className="w-4 h-4 mr-1" />
              Go to Enrichment Tab
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </FadeIn>
    )
  }

  const usingViennaRNA = data.some((d) => d.engine === 'ViennaRNA')

  const getMFEColor = (mfe: number) => {
    if (mfe <= -10) return 'text-success font-semibold'
    if (mfe <= -5) return 'text-info'
    return 'text-muted-foreground'
  }

  const renderDotBracket = (dotBracket: string) => {
    const maxLen = 80
    const display = dotBracket.length > maxLen ? dotBracket.substring(0, maxLen) + '...' : dotBracket
    return display.split('').map((c, i) => {
      let color = 'text-muted-foreground'
      if (c === '(') color = 'text-primary'
      else if (c === ')') color = 'text-info'
      else if (c === '+') color = 'text-warning font-bold'
      else if (c === '~') color = 'text-warning'
      return (
        <span key={i} className={color}>
          {c}
        </span>
      )
    })
  }

  const gQuadCount = data.filter((d) => d.hasGQuad).length

  return (
    <div>
      {/* Engine info banner */}
      <FadeIn>
        <div
          className={`flex items-center rounded-xl border text-sm ${
            usingViennaRNA
              ? 'bg-success/10 border-success/30'
              : 'bg-accent/20 border-accent/30'
          }`}
          style={{
            padding: 'var(--spacing-sm) var(--spacing-md)',
            marginBottom: 'var(--spacing-md)',
            gap: 'var(--spacing-sm)',
          }}
        >
          {usingViennaRNA ? (
            <>
              <CheckCircle className="w-4 h-4 flex-shrink-0 text-success" />
              <span>
                <strong>ViennaRNA RNAfold</strong> with G-Quadruplex prediction.{' '}
                {gQuadCount > 0 && <span className="text-warning font-semibold">{gQuadCount} G4 structures detected.</span>}
                {' '}The <code className="text-xs bg-muted rounded px-1" style={{ fontFamily: 'var(--font-family-mono)' }}>+</code> symbols indicate G-quadruplex.
              </span>
            </>
          ) : (
            <>
              <Cpu className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-foreground)' }} />
              <span style={{ color: 'var(--accent-foreground)' }}>
                Using built-in Nussinov algorithm (fallback). For precise results, ensure the ViennaRNA service is running.
              </span>
            </>
          )}
        </div>
      </FadeIn>

      {/* Legend */}
      <FadeIn>
        <div
          className="flex flex-wrap items-center text-xs text-muted-foreground"
          style={{
            gap: 'var(--spacing-md)',
            marginBottom: 'var(--spacing-md)',
            padding: '0 var(--spacing-xs)',
          }}
        >
          <span className="text-sm font-semibold text-foreground">{data.length} structures predicted</span>
          <span className="w-px h-4 bg-border" />
          <span className="flex items-center" style={{ gap: '4px' }}>
            <span className="inline-block w-3 h-3 rounded-sm bg-primary" /> ( ) Base pairs
          </span>
          <span className="flex items-center" style={{ gap: '4px' }}>
            <span className="inline-block w-3 h-3 rounded-sm bg-warning" /> + G-Quadruplex
          </span>
          <span className="flex items-center" style={{ gap: '4px' }}>
            <span className="inline-block w-3 h-3 rounded-sm bg-muted" /> . Unpaired
          </span>
        </div>
      </FadeIn>

      <Stagger stagger={0.04} className="flex flex-col" style={{ gap: 'var(--spacing-sm)' }}>
        {data.map((result, idx) => (
          <FadeIn key={idx}>
            <div
              className={`border rounded-lg bg-card ${
                result.hasGQuad ? 'border-warning/40' : 'border-border'
              }`}
              style={{ padding: 'var(--spacing-md)' }}
            >
              <div className="flex items-start justify-between" style={{ gap: 'var(--spacing-sm)' }}>
                <div className="flex-1 min-w-0">
                  <code
                    className="text-xs break-all block"
                    style={{ fontFamily: 'var(--font-family-mono)', lineHeight: '1.4' }}
                  >
                    {result.sequence.length > 80
                      ? result.sequence.substring(0, 80) + '...'
                      : result.sequence}
                  </code>
                  <div
                    className="break-all"
                    style={{
                      fontFamily: 'var(--font-family-mono)',
                      fontSize: 'var(--font-size-small)',
                      lineHeight: '1.4',
                      marginTop: '2px',
                    }}
                  >
                    {renderDotBracket(result.dotBracket)}
                  </div>
                </div>

                <div className="flex flex-col items-end flex-shrink-0" style={{ gap: '4px' }}>
                  {result.hasGQuad && (
                    <span
                      className="text-xs font-semibold rounded-full bg-warning text-warning-foreground"
                      style={{ padding: '2px 8px' }}
                    >
                      G4 structure
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{result.engine}</span>
                </div>
              </div>

              <div
                className="flex flex-wrap text-xs text-muted-foreground"
                style={{ gap: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)' }}
              >
                <span className={getMFEColor(result.mfe)}>
                  <strong>MFE:</strong> {result.mfe} kcal/mol
                </span>
                <span>
                  <strong>Base pairs:</strong> {result.numBasePairs}
                </span>
                <span>
                  <strong>Length:</strong> {result.length || result.sequence.length} nt
                </span>
                {result.hasGQuad && (
                  <span className="text-warning font-medium">
                    G-Quadruplex detected
                  </span>
                )}
              </div>
            </div>
          </FadeIn>
        ))}
      </Stagger>
    </div>
  )
}
