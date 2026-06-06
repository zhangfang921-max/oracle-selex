import { FlaskConical, Dna, TrendingUp, Hash } from 'lucide-react'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import type { Analysis, EnrichmentEntry } from '@/types/analysis'

interface StatsCardsProps {
  analysis: Analysis | null
  enrichmentData: EnrichmentEntry[]
}

export function StatsCards({ analysis, enrichmentData }: StatsCardsProps) {
  const totalRounds = analysis?.rounds.length ?? 0
  const totalReads = analysis?.rounds.reduce((s, r) => s + r.totalReads, 0) ?? 0
  const totalUnique = analysis?.rounds.reduce(
    (s, r) => s + (r.sequences?.length ?? 0),
    0
  ) ?? 0
  const topEnriched = enrichmentData.filter(
    (e) => e.enrichmentFold !== null && e.enrichmentFold !== Infinity && e.enrichmentFold >= 2
  ).length

  const cards = [
    {
      label: 'Selection Rounds',
      value: totalRounds,
      icon: FlaskConical,
      color: 'var(--primary)',
    },
    {
      label: 'Total Reads',
      value: totalReads.toLocaleString(),
      icon: Hash,
      color: 'var(--info)',
    },
    {
      label: 'Unique Sequences',
      value: totalUnique.toLocaleString(),
      icon: Dna,
      color: 'var(--success)',
    },
    {
      label: 'Enriched (>2x)',
      value: topEnriched.toLocaleString(),
      icon: TrendingUp,
      color: 'var(--warning)',
    },
  ]

  return (
    <Stagger
      stagger={0.08}
      className="grid grid-cols-2 lg:grid-cols-4"
      style={{ gap: 'var(--spacing-md)' }}
    >
      {cards.map((card) => (
        <FadeIn key={card.label}>
          <div
            className="bg-card border border-border rounded-lg shadow-sm"
            style={{ padding: 'var(--spacing-md)' }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--spacing-xs)' }}>
              <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
              <card.icon className="w-4 h-4" style={{ color: card.color }} />
            </div>
            <p className="font-bold tabular-nums" style={{ fontSize: 'var(--font-size-headline)' }}>
              {card.value}
            </p>
          </div>
        </FadeIn>
      ))}
    </Stagger>
  )
}
