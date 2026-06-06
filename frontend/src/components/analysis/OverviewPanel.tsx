import { Dna, Hash, Layers, FlaskConical } from 'lucide-react'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import type { Analysis, EnrichmentEntry, SequenceCluster } from '@/types/analysis'

interface OverviewPanelProps {
  analysis: Analysis
  enrichmentData: EnrichmentEntry[]
  clusterData: SequenceCluster[]
  isEnrichmentLoading: boolean
}

/* -- Stat Card ----------------------------------------------------------- */

function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  iconColor,
  accentBg,
}: {
  label: string
  value: string
  subValue?: string
  icon: React.ElementType
  iconColor: string
  accentBg: string
}) {
  return (
    <div
      className="rounded-xl border border-border/50 shadow-sm hover:shadow-md transition-all"
      style={{ padding: 'var(--spacing-lg)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))' }}
    >
      <div className="flex items-start justify-between" style={{ marginBottom: 'var(--spacing-sm)' }}>
        <div
          className="rounded-xl flex items-center justify-center"
          style={{ width: 48, height: 48, background: accentBg, color: iconColor, flexShrink: 0 }}
        >
          <Icon size={24} />
        </div>
      </div>
      <p className="font-bold tabular-nums" style={{ fontSize: 26, color: 'var(--foreground)', lineHeight: 1.1 }}>
        {value}
      </p>
      <p className="font-medium" style={{ fontSize: 'var(--font-size-label)', color: 'var(--foreground)', marginTop: 4 }}>
        {label}
      </p>
      {subValue && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', marginTop: 4 }}>
          {subValue}
        </p>
      )}
    </div>
  )
}

/* -- Main Component ------------------------------------------------------ */

export function OverviewPanel({
  analysis,
  clusterData,
}: OverviewPanelProps) {
  const rounds = analysis?.rounds ?? []
  const totalReads = rounds.reduce((s, r) => s + (Number(r.totalReads) || 0), 0)
  const totalUnique = rounds.reduce((s, r) => s + (r.sequences?.length ?? 0), 0)
  const safeClusters = clusterData ?? []
  const clusterCount = safeClusters.length

  const stats = [
    {
      label: 'Total Reads',
      value: totalReads.toLocaleString(),
      subValue: rounds.length > 0 ? `From ${rounds[0]?.fileName || 'uploaded file'}` : undefined,
      icon: Hash,
      iconColor: 'var(--chart-2, oklch(0.65 0.16 165))',
      accentBg: 'color-mix(in oklch, var(--chart-2, oklch(0.65 0.16 165)) 15%, transparent)',
    },
    {
      label: 'Unique Sequences',
      value: totalUnique.toLocaleString(),
      subValue: totalReads > 0 ? `${((totalUnique / totalReads) * 100).toFixed(1)}% diversity` : undefined,
      icon: Dna,
      iconColor: 'var(--chart-3, oklch(0.75 0.17 80))',
      accentBg: 'color-mix(in oklch, var(--chart-3, oklch(0.75 0.17 80)) 15%, transparent)',
    },
    {
      label: 'Clusters',
      value: clusterCount > 0 ? clusterCount.toString() : '--',
      subValue: clusterCount > 0
        ? `${safeClusters.filter((c) => c.size > 1).length} multi-member`
        : 'Run clustering to group sequences',
      icon: Layers,
      iconColor: 'var(--chart-5, oklch(0.55 0.2 310))',
      accentBg: 'color-mix(in oklch, var(--chart-5, oklch(0.55 0.2 310)) 15%, transparent)',
    },
  ]

  // Compute summary metrics for the academic overview
  const g4PositiveCount = safeClusters.filter((c) => {
    let pass = 0
    if (c.cGcC > 4.5) pass++
    if ((c.g4Hunter ?? 0) > 0.9) pass++
    if ((c.g4NN ?? 0) > 0.5) pass++
    return pass >= 2
  }).length
  const stableCount = safeClusters.filter((c) => (c.rnaFold?.mfe ?? 0) <= -10).length

  return (
    <div className="flex flex-col" style={{ gap: 'var(--spacing-xl)' }}>
      {/* Section header */}
      <FadeIn>
          <div style={{ paddingBottom: 'var(--spacing-xs)', marginBottom: 'var(--spacing-md)' }}>
          <h2
            className="font-bold"
            style={{
              fontSize: 'var(--font-size-headline)',
              fontFamily: 'var(--font-family-heading)',
              letterSpacing: 'var(--letter-spacing-tight)',
              color: 'var(--foreground)',
            }}
          >
            Overview
          </h2>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-label)', marginTop: 4 }}>
            Summary statistics for uploaded SELEX rounds
          </p>
        </div>
      </FadeIn>

      {/* Stats grid */}
      <Stagger
        stagger={0.06}
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 'var(--spacing-md)' }}
      >
        {stats.map((s) => (
          <FadeIn key={s.label}>
            <StatCard {...s} />
          </FadeIn>
        ))}
      </Stagger>

      {/* Quick insights — journal abstract style */}
      {clusterCount > 0 && (
        <FadeIn>
          <div
            className="rounded-xl border border-border/50"
            style={{ padding: '18px 22px', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', borderLeft: '3px solid var(--primary)' }}
          >
            <p className="font-semibold" style={{ fontSize: 'var(--font-size-body)', marginBottom: 6, fontFamily: 'var(--font-family-heading)' }}>
              Key Findings
            </p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-label)', lineHeight: 1.7 }}>
              {clusterCount} clusters identified from {totalUnique.toLocaleString()} unique sequences.
              {g4PositiveCount > 0 && (
                <> <strong style={{ color: 'var(--foreground)' }}>{g4PositiveCount}</strong> cluster{g4PositiveCount > 1 ? 's' : ''} show G4 formation potential (&ge;2/3 thresholds passed).</>)}
              {stableCount > 0 && (
                <> <strong style={{ color: 'var(--foreground)' }}>{stableCount}</strong> cluster{stableCount > 1 ? 's' : ''} exhibit thermodynamically stable structures (MFE &le; -10 kcal/mol).</>)}
            </p>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
