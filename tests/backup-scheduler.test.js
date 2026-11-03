import assert from 'node:assert/strict'
import test from 'node:test'
import { isDue, nextRunAt, planRetention } from '../electron/core/backup-scheduler.js'

const DAY = 86_400_000

function policy(overrides = {}) {
  return { enabled: true, onExit: true, daily: true, dailyHour: 3, retentionCount: 5, maxTotalMb: 2048, ...overrides }
}

test('daily backups are due once after the scheduled hour and not repeatedly', () => {
  const now = new Date(2026, 10, 2, 10, 0, 0)
  assert.equal(isDue(policy(), now, null), true)
  assert.equal(isDue(policy(), now, new Date(now.getTime() - 60_000).toISOString()), false)
  assert.equal(isDue(policy(), now, new Date(now.getTime() - DAY).toISOString()), true)
})

test('a run before the scheduled hour is not due until that hour arrives', () => {
  const now = new Date(2026, 10, 2, 1, 0, 0)
  const yesterdayAfter = new Date(2026, 10, 1, 4, 0, 0).toISOString()
  assert.equal(isDue(policy(), now, yesterdayAfter), false)
  assert.equal(isDue(policy(), new Date(2026, 10, 2, 3, 30, 0), yesterdayAfter), true)
})

test('disabling daily backups or the whole feature is not due', () => {
  const now = new Date(2026, 10, 2, 10, 0, 0)
  assert.equal(isDue(policy({ daily: false }), now, null), false)
  assert.equal(isDue(policy({ enabled: false }), now, null), false)
})

test('nextRunAt is today when the hour is still ahead and tomorrow after it', () => {
  const before = new Date(2026, 10, 2, 1, 0, 0)
  const after = new Date(2026, 10, 2, 5, 0, 0)
  assert.equal(new Date(nextRunAt(policy(), before)).getDate(), 2)
  assert.equal(new Date(nextRunAt(policy(), after)).getDate(), 3)
  assert.equal(nextRunAt(policy({ daily: false }), before), null)
})

test('retention keeps the newest unpinned backups and pinned ones forever', () => {
  const backups = [
    { id: 'a', createdAt: '2026-11-01T00:00:00.000Z', sizeBytes: 10 },
    { id: 'b', createdAt: '2026-11-02T00:00:00.000Z', sizeBytes: 10 },
    { id: 'c', createdAt: '2026-11-03T00:00:00.000Z', sizeBytes: 10, pinned: true },
    { id: 'd', createdAt: '2026-11-04T00:00:00.000Z', sizeBytes: 10 },
    { id: 'e', createdAt: '2026-11-05T00:00:00.000Z', sizeBytes: 10 },
    { id: 'f', createdAt: '2026-11-06T00:00:00.000Z', sizeBytes: 10 },
  ]
  const plan = planRetention(backups, policy({ retentionCount: 2 }))
  assert.deepEqual(plan.deleteIds.sort(), ['a', 'b', 'd'])
  assert.deepEqual(plan.keptIds.sort(), ['c', 'e', 'f'])
  assert.equal(plan.freedBytes, 30)
})

test('retention applies the size limit after the count limit', () => {
  const backups = [
    { id: 'a', createdAt: '2026-11-01T00:00:00.000Z', sizeBytes: 1024 * 1024 },
    { id: 'b', createdAt: '2026-11-02T00:00:00.000Z', sizeBytes: 1024 * 1024 },
    { id: 'c', createdAt: '2026-11-03T00:00:00.000Z', sizeBytes: 1024 * 1024 },
  ]
  const plan = planRetention(backups, policy({ retentionCount: 5, maxTotalMb: 2 }))
  assert.deepEqual(plan.deleteIds, ['a'])
  assert.deepEqual(plan.keptIds.sort(), ['b', 'c'])
})

test('a pinned backup is never deleted for size, even when it exceeds the limit', () => {
  const backups = [
    { id: 'pinned', createdAt: '2026-11-01T00:00:00.000Z', sizeBytes: 10 * 1024 * 1024, pinned: true },
    { id: 'new', createdAt: '2026-11-02T00:00:00.000Z', sizeBytes: 2 * 1024 * 1024 },
  ]
  const plan = planRetention(backups, policy({ retentionCount: 5, maxTotalMb: 1 }))
  assert.deepEqual(plan.deleteIds, ['new'])
  assert.deepEqual(plan.keptIds, ['pinned'])
})
