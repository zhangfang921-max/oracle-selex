import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { FadeIn } from '@/components/MotionPrimitives'
import type { EnrichmentEntry } from '@/types/analysis'

interface EnrichmentChartProps {
  data: EnrichmentEntry[]
  topN?: number
}

const COLORS = [
  'oklch(0.55 0.18 260)',
  'oklch(0.6 0.2 25)',
  'oklch(0.65 0.16 165)',
  'oklch(0.75 0.17 80)',
  'oklch(0.55 0.2 310)',
  'oklch(0.5 0.15 200)',
  'oklch(0.7 0.15 40)',
  'oklch(0.6 0.18 290)',
  'oklch(0.65 0.12 140)',
  'oklch(0.55 0.16 230)',
]

export function EnrichmentChart({ data, topN = 10 }: EnrichmentChartProps) {
  const topEntries = data.slice(0, topN)

  const chartData = useMemo(() => {
    if (topEntries.length === 0) return []
    const roundNums = topEntries[0].rounds.map((r) => r.roundNumber)
    return roundNums.map((rn) => {
      const point: Record<string, number | string> = { round: `R${rn}` }
      topEntries.forEach((entry, idx) => {
        const rd = entry.rounds.find((r) => r.roundNumber === rn)
        point[`seq${idx}`] = rd?.percentRead ?? 0
      })
      return point
    })
  }, [topEntries])

  if (data.length === 0) {
    return null
  }

  return (
    <FadeIn>
      <div className="border border-border rounded-lg bg-card" style={{ padding: 'var(--spacing-md)' }}>
        <h4 className="font-semibold text-sm" style={{ marginBottom: 'var(--spacing-sm)' }}>
          Enrichment Trajectory (Top {Math.min(topN, data.length)} sequences)
        </h4>
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <XAxis dataKey="round" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                label={{
                  value: '% Read',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 11 },
                }}
              />
              <Tooltip
                contentStyle={{
                  fontSize: '11px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
                formatter={(value: number) => [`${value.toFixed(4)}%`, '']}
              />
              <Legend
                wrapperStyle={{ fontSize: '10px', maxHeight: '60px', overflowY: 'auto' }}
                formatter={(_, entry) => {
                  const idx = parseInt((entry.dataKey as string).replace('seq', ''))
                  const seq = topEntries[idx]?.sequence
                  return seq ? seq.substring(0, 15) + '...' : ''
                }}
              />
              {topEntries.map((_, idx) => (
                <Line
                  key={idx}
                  type="monotone"
                  dataKey={`seq${idx}`}
                  stroke={COLORS[idx % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </FadeIn>
  )
}
