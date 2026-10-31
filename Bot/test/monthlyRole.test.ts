import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { Pool, PoolClient } from 'pg'
import type { Guild } from 'discord.js'
import { monthlyBounds, previousJstMonth, updateMonthlyRoleOnce } from '../src/monthlyRole'
import { latestPublishedReportPath } from '../../frontend/src/lib/report-period'

test('発言王ロールは先に新受賞者へ付け、失敗時は旧受賞者から外さない', async () => {
  const { assignWinnerRole } = await import('../src/cogs/ranking')
  const { KING_ROLE_ID } = await import('../src/config')
  const events: string[] = []
  const role = { id: KING_ROLE_ID, editable: true }
  const previous = { id: 'previous', roles: {
    cache: new Map([[KING_ROLE_ID, role]]),
    remove: async () => { events.push('remove') },
  } }
  let rejectGrant = true
  const winner = { id: 'winner', roles: {
    cache: new Map(),
    add: async () => {
      if (rejectGrant) throw new Error('Missing Permissions')
      events.push('add')
    },
  } }
  const guild = {
    roles: { fetch: async (id: string) => { assert.equal(id, KING_ROLE_ID); return role } },
    members: { fetch: async (id?: string) => id ? winner : new Map([['previous', previous]]) },
  } as unknown as Guild
  await assert.rejects(assignWinnerRole(guild, 'winner'), /Missing Permissions/)
  assert.deepEqual(events, [])
  rejectGrant = false
  await assignWinnerRole(guild, 'winner')
  assert.deepEqual(events, ['add', 'remove'])
})

test('JST月初と年初に、公開済みの前月へ切り替わる', () => {
  for (const [timestamp, year, month] of [
    ['2026-10-31T14:59:59Z', 2026, 9],
    ['2026-10-31T15:00:00Z', 2026, 10],
    ['2026-12-31T15:00:00Z', 2026, 12],
    ['2027-01-31T15:00:00Z', 2027, 1],
  ] as const) {
    const now = new Date(timestamp)
    assert.deepEqual(previousJstMonth(now), { year, month })
    assert.equal(latestPublishedReportPath(now), `/month/${year}/${month}`)
  }
  assert.deepEqual(monthlyBounds(2026, 10).map(date => date.toISOString()), [
    '2026-09-30T15:00:00.000Z', '2026-10-31T15:00:00.000Z',
  ])
})

function fakePool() {
  const completed = new Set<string>()
  let pending: string | undefined
  let locked = false
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: !locked }] }
      if (sql.startsWith('SELECT 1')) return { rows: completed.has(values.join(':')) ? [{}] : [] }
      if (sql.startsWith('INSERT')) pending = values.slice(0, 4).join(':')
      if (sql === 'COMMIT' && pending) { completed.add(pending); pending = undefined }
      if (sql === 'ROLLBACK') pending = undefined
      return { rows: [] }
    },
    release() {},
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    lock: () => { locked = true },
  }
}

test('初回起動で未実行月を回収し、再起動後も完了済み月は再実行しない', async () => {
  const { pool } = fakePool()
  let calls = 0
  const update = async (year: number, month: number) => {
    calls++
    assert.equal(year, 2026)
    assert.equal(month, 10)
    return 'winner'
  }
  const now = new Date('2026-11-10T00:00:00Z')
  assert.equal(await updateMonthlyRoleOnce(pool, 'guild', 'role', update, now), true)
  assert.equal(await updateMonthlyRoleOnce(pool, 'guild', 'role', update, now), false)
  assert.equal(calls, 1)
  assert.equal(await updateMonthlyRoleOnce(pool, 'guild', 'role', async (year, month) => {
    calls++
    assert.equal(year, 2026)
    assert.equal(month, 11)
    return 'next-winner'
  }, new Date('2026-11-30T15:00:00Z')), true)
  assert.equal(calls, 2)
})

test('Discordの失敗時は完了記録を残さず、次の実行で再試行する', async () => {
  const { pool } = fakePool()
  let calls = 0
  const update = async () => {
    calls++
    if (calls === 1) throw new Error('Missing Permissions')
    return 'winner'
  }
  const now = new Date('2026-11-01T00:00:00Z')
  await assert.rejects(updateMonthlyRoleOnce(pool, 'guild', 'role', update, now), /Missing Permissions/)
  assert.equal(await updateMonthlyRoleOnce(pool, 'guild', 'role', update, now), true)
  assert.equal(calls, 2)
})

test('別プロセスが処理中の場合はDiscord操作を実行しない', async () => {
  const { pool, lock } = fakePool()
  lock()
  let calls = 0
  const result = await updateMonthlyRoleOnce(pool, 'guild', 'role', async () => {
    calls++
    return 'winner'
  })
  assert.equal(result, false)
  assert.equal(calls, 0)
})
