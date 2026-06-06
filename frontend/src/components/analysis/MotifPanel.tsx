import { Search, Loader2, TrendingUp, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { MotifAnalysis } from '@/types/analysis'

interface MotifPanelProps {
  data: MotifAnalysis | null
  isLoading?: boolean
  hasEnrichment?: boolean
  onRunMotifs?: () => void
  onGoToEnrichment?: () => void
}

export function MotifPanel({ data, isLoading, hasEnrichment, onRunMotifs, onGoToEnrichment }: MotifPanelProps) {
  if (isLoading) {
    return (
      <FadeIn className="flex flex-col items-center justify-center" style={{ minHeight: 240, gap: 'var(--spacing-md)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Discovering conserved motifs...</p>
      </FadeIn>
    )
  }

  if (!data) {
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
              background: 'color-mix(in oklch, var(--chart-5, oklch(0.55 0.2 310)) 12%, transparent)',
            }}
          >
            <Search size={24} style={{ color: 'var(--chart-5, oklch(0.55 0.2 310))' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 4 }}>
              Conserved Motif Discovery
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', maxWidth: 420, margin: '0 auto' }}>
              {hasEnrichment
                ? 'Discover conserved sequence patterns among enriched candidates. Uses k-mer frequency analysis to find recurring motifs.'
                : 'Run enrichment analysis first to identify candidates, then discover conserved motifs among them.'}
            </p>
          </div>
          {hasEnrichment ? (
            <Button onClick={onRunMotifs} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <Search className="w-4 h-4 mr-1" />
              Discover Motifs
            </Button>
          ) : (
            <Button variant="outline" onClick={onGoToEnrichment} className="cursor-pointer" style={{ marginTop: 'var(--spacing-xs)' }}>
              <TrendingUp className="w-4 h-4 mr-1" />
              Go to Enrichment Tab
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </FadeIn>
    )
  }

  const chartData = data.kmers.slice(0, 15).map((k) => ({
    name: k.kmer,
    count: k.count,
    frequency: k.frequency,
  }))

  const colors = [
    'oklch(0.55 0.18 260)',
    'oklch(0.65 0.16 165)',
    'oklch(0.75 0.17 80)',
    'oklch(0.6 0.2 25)',
    'oklch(0.55 0.2 310)',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
      {/* Consensus */}
      {data.consensusMotif && (
        <FadeIn>
          <div className="border border-border rounded-xl bg-card shadow-sm" style={{ padding: 'var(--spacing-lg)' }}>
            <h4 className="font-semibold" style={{ fontSize: 'var(--font-size-subheading, 16px)', marginBottom: 'var(--spacing-xs)' }}>
              Consensus Motif
            </h4>
            <code
              className="text-sm break-all block"
              style={{
                fontFamily: 'var(--font-family-mono)',
                letterSpacing: '0.1em',
                lineHeight: '1.6',
              }}
            >
              {data.consensusMotif.split('').map((c, i) => (
                <span
                  key={i}
                  className={c === c.toUpperCase() ? 'font-bold text-primary' : 'text-muted-foreground'}
                >
                  {c}
                </span>
              ))}
            </code>
            <p className="text-xs text-muted-foreground" style={{ marginTop: 'var(--spacing-xs)' }}>
              Uppercase = dominant base (&gt;50% frequency), lowercase = less conserved
            </p>
          </div>
        </FadeIn>
      )}

      {/* K-mer Bar Chart */}
      {chartData.length > 0 && (
        <FadeIn>
          <div className="border border-border rounded-xl bg-card shadow-sm" style={{ padding: 'var(--spacing-lg)' }}>
            <h4 className="font-semibold" style={{ fontSize: 'var(--font-size-subheading, 16px)', marginBottom: 'var(--spacing-xs)' }}>
              Top K-mer Frequencies
            </h4>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', marginBottom: 'var(--spacing-md)' }}>
              Most frequent k-mer patterns across analyzed sequences
            </p>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 40, left: 5 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fontFamily: 'var(--font-family-mono)' }}
                    angle={-45}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--card)',
                    }}
                    formatter={(value: number, name: string) => [
                      name === 'count' ? value.toLocaleString() : (value * 100).toFixed(3) + '%',
                      name === 'count' ? 'Count' : 'Frequency',
                    ]}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </FadeIn>
      )}

      {/* K-mer Table */}
      <FadeIn>
        <div className="overflow-auto rounded-xl border border-border shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left font-semibold" style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}>
                  K-mer
                </th>
                <th className="text-right font-semibold" style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}>
                  Count
                </th>
                <th className="text-right font-semibold" style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}>
                  Frequency
                </th>
                <th className="text-left font-semibold" style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}>
                  Rev. Complement
                </th>
              </tr>
            </thead>
            <tbody>
              {data.kmers.map((kmer, idx) => (
                <tr key={idx} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                  <td style={{ padding: 'var(--spacing-xs) var(--spacing-md)', fontFamily: 'var(--font-family-mono)' }}>
                    {kmer.kmer}
                  </td>
                  <td className="text-right tabular-nums" style={{ padding: 'var(--spacing-xs) var(--spacing-md)' }}>
                    {kmer.count.toLocaleString()}
                  </td>
                  <td className="text-right tabular-nums" style={{ padding: 'var(--spacing-xs) var(--spacing-md)' }}>
                    {(kmer.frequency * 100).toFixed(3)}%
                  </td>
                  <td
                    className="text-muted-foreground"
                    style={{ padding: 'var(--spacing-xs) var(--spacing-md)', fontFamily: 'var(--font-family-mono)' }}
                  >
                    {kmer.reverseComplement}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FadeIn>
    </div>
  )
}
