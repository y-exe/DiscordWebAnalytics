import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { buildAllTimeRankingComponent, buildRankingComponent, monthlyRankingTitle, serializeComponentEmbed } from '../../shared/discord-ranking'
import { buildRankingContainer } from '../src/cogs/ranking'
import originalMessage from './fixtures/monthly-ranking.json'

const rows = Array.from({ length: 10 }, (_, index) => ({
  user_id: String(100 + index),
  display_name: index === 3 ? null : `テスト${index}`,
  count: index === 9 ? '10' : 100 - index,
}))

test('旧自動送信メッセージの全テキスト・順位・絵文字・ボタンを維持する', () => {
  const shared = buildRankingComponent('test', rows, 2026, 10)
  assert.deepEqual(shared, originalMessage)
  assert.deepEqual(buildRankingContainer('test', rows, 2026, 10).toJSON(), originalMessage)
})

test('Component Embedは同じContainerを親に持ち、Discordの3000バイト以内に収まる', () => {
  const component = buildRankingComponent(monthlyRankingTitle(2026, 10), rows, 2026, 10)
  const payload = serializeComponentEmbed(component)
  assert.ok(payload)
  assert.deepEqual(JSON.parse(payload), { component })
  assert.ok(Buffer.byteLength(payload, 'utf8') <= 3000)
  const allowed = new Set([1, 2, 10, 14, 17])
  let count = 0
  const inspect = (node: { type: number; components?: unknown[]; style?: number }) => {
    assert.ok(allowed.has(node.type))
    if (node.type === 2) assert.equal(node.style, 5)
    count++
    for (const child of node.components ?? []) inspect(child as typeof node)
  }
  inspect(component)
  assert.ok(count <= 40)
})

test('巨大な表示名でも順位や氏名を勝手に削らず、通常OGプレビューへ戻す', () => {
  const longRows = rows.map(row => ({ ...row, display_name: '長い名前'.repeat(200) }))
  const component = buildRankingComponent('test', longRows, 2026, 10)
  assert.equal(serializeComponentEmbed(component), null)
  assert.equal(component.components.filter(child => child.type === 10 && child.content.includes('回**')).length, 10)
})

test('全期間プレビューは全期間のタイトル・累計上位10人を表示し、月間ロール案内を含まない', () => {
  const component = buildAllTimeRankingComponent(rows)
  const payload = serializeComponentEmbed(component)
  assert.ok(payload)
  assert.match(payload, /🏆 全期間の発言ランキング/)
  assert.doesNotMatch(payload, /ロールが付与|1か月ごと|あけまして/)
  assert.equal(component.components.filter(child => child.type === 10 && child.content.includes('回**')).length, 10)
  const actions = component.components.find(child => child.type === 1)
  assert.ok(actions?.type === 1)
  assert.ok(actions.components.every(button => button.url === 'https://ymkw.top/all'))
})
