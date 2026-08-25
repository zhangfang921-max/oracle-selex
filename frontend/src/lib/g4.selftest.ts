// 前端 G4 helper 的行为验证：确认缺失数据不会被当成 0 或 Low。
// 跑法：cd frontend && npx tsx /tmp/test_g4_helpers.ts
import { g4PassCount, g4RiskLabel, fmtScore, allUnscored, g4Unscored, g4EvaluatedCount } from './g4'

let failed = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expected)})`}`)
}

const scored = { cGcC: 400, g4Hunter: 1.71, g4NN: 0.99 } as any
const lowScored = { cGcC: 2.27, g4Hunter: 0.41, g4NN: 0.28 } as any
const unscored = { cGcC: null, g4Hunter: null, g4NN: null } as any
const partial = { cGcC: 2.27, g4Hunter: 0.41, g4NN: null } as any

console.log('--- pass count ---')
check('高风险序列 → 3 项通过', g4PassCount(scored), 3)
check('低风险序列 → 0 项通过', g4PassCount(lowScored), 0)
check('全缺失 → null（不是 0）', g4PassCount(unscored), null)
check('G4NN 缺失 → 只算可评估的 2 项', g4PassCount(partial), 0)
check('可评估项数（部分缺失）', g4EvaluatedCount(partial), 2)

console.log('\n--- risk label ---')
check('全缺失且后端未给 → n/a（不是 Low）', g4RiskLabel(unscored), 'n/a')
check('后端给了 n/a 就用 n/a', g4RiskLabel({ ...unscored, g4Risk: 'n/a' }), 'n/a')
check('高风险', g4RiskLabel({ ...scored, g4Risk: 'High' }), 'High')
check('无后端值时按阈值算', g4RiskLabel(scored), 'High')

console.log('\n--- 数值格式化 ---')
check('null → 破折号', fmtScore(null), '—')
check('null → 自定义占位（CSV 用空）', fmtScore(null, 4, ''), '')
check('0 不能被当成缺失', fmtScore(0, 3), '0.000')
check('正常值', fmtScore(0.4062, 4), '0.4062')

console.log('\n--- 整批判定 ---')
check('全部无分 → true', allUnscored([unscored, unscored]), true)
check('有一个有分 → false', allUnscored([unscored, lowScored]), false)
check('空数组 → false', allUnscored([]), false)
check('单条未评分判定', g4Unscored(unscored), true)
check('部分缺失不算未评分', g4Unscored(partial), false)

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
// Throwing (rather than process.exit) still yields a non-zero exit code under
// node/tsx, but keeps this file free of Node type dependencies so it stays
// inside the frontend's type-check scope.
if (failed > 0) {
  throw new Error(`${failed} 项 G4 空值处理自测失败`)
}
