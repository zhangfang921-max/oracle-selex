import type { SequenceCluster } from '@/types/analysis'

/**
 * Helpers for G4 scores that may be absent.
 *
 * The backend reports cGcC / G4Hunter / G4NN as null when the scoring service
 * is unavailable (and G4NN as null when its optional model is not installed),
 * rather than substituting a differently-computed number under the same name.
 * Absent scores must therefore never be rendered as 0, and absent risk must
 * never be rendered as "Low".
 */

type G4Scores = Pick<SequenceCluster, 'cGcC' | 'g4Hunter' | 'g4NN'>

/** Published decision thresholds. */
export const G4_THRESHOLDS = { cGcC: 4.5, g4Hunter: 0.9, g4NN: 0.5 } as const

/** True when no G4 score at all is available for this cluster. */
export function g4Unscored(c: G4Scores): boolean {
  return c.cGcC == null && c.g4Hunter == null && c.g4NN == null
}

/**
 * Number of published thresholds passed, or null when no criterion could be
 * evaluated. Criteria with a missing score are skipped, not counted as failed.
 */
export function g4PassCount(c: G4Scores): number | null {
  const evaluated = [
    c.cGcC == null ? null : c.cGcC > G4_THRESHOLDS.cGcC,
    c.g4Hunter == null ? null : c.g4Hunter > G4_THRESHOLDS.g4Hunter,
    c.g4NN == null ? null : c.g4NN > G4_THRESHOLDS.g4NN,
  ].filter((v): v is boolean => v !== null)

  if (evaluated.length === 0) return null
  return evaluated.filter(Boolean).length
}

/** How many criteria were actually evaluable (denominator for "x/y passed"). */
export function g4EvaluatedCount(c: G4Scores): number {
  return [c.cGcC, c.g4Hunter, c.g4NN].filter((v) => v != null).length
}

/**
 * Risk label. Prefers the value computed by the backend; 'n/a' means
 * "not evaluated", which is not the same as low risk.
 */
export function g4RiskLabel(c: SequenceCluster): 'High' | 'Medium' | 'Low' | 'n/a' {
  if (c.g4Risk) return c.g4Risk
  const passed = g4PassCount(c)
  if (passed === null) return 'n/a'
  return passed >= 2 ? 'High' : passed >= 1 ? 'Medium' : 'Low'
}

/** Format a possibly-absent score. Returns `dash` when there is no value. */
export function fmtScore(
  value: number | null | undefined,
  digits = 3,
  dash = '—',
): string {
  return value == null ? dash : value.toFixed(digits)
}

/** True when the whole result set came back without G4 scores. */
export function allUnscored(clusters: G4Scores[]): boolean {
  return clusters.length > 0 && clusters.every(g4Unscored)
}
