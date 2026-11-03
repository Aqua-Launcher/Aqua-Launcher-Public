import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlaytimeStats, localDateKey, sessionsToCsv } from '../electron/core/stats.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function localIso(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

function session({ id, installationId, date, durationMs, endDate = null }) {
  return {
    id,
    installationId,
    startedAt: date,
    endedAt: endDate || new Date(new Date(date).getTime() + durationMs).toISOString(),
    playtimeMs: durationMs,
  }
}

test('totals match the sum of session durations across installations', () => {
  const sessions = [
    session({ id: 'a', installationId: 'survival', date: localIso(2026, 3, 2, 18, 0), durationMs: 2 * HOUR }),
    session({ id: 'b', installationId: 'creative', date: localIso(2026, 3, 3, 19, 0), durationMs: 45 * MINUTE }),
    session({ id: 'c', installationId: 'survival', date: localIso(2026, 3, 4, 20, 0), durationMs: 30 * MINUTE }),
  ]
  const stats = buildPlaytimeStats({
    sessions,
    installations: [
      { id: 'survival', name: 'Survival', versionId: '1.21.4' },
      { id: 'creative', name: 'Creative', versionId: '1.20.6' },
    ],
    now: new Date(2026, 2, 10, 12),
  })
  assert.equal(stats.totals.playtimeMs, 3 * HOUR + 15 * MINUTE)
  assert.equal(stats.totals.sessions, 3)
  assert.equal(stats.totals.activeDays, 3)
  assert.equal(stats.totals.averageSessionMs, HOUR + 5 * MINUTE)
  assert.equal(stats.totals.longestSessionMs, 2 * HOUR)
  assert.equal(stats.topInstallations[0].name, 'Survival')
  assert.equal(stats.topInstallations[0].playtimeMs, 2 * HOUR + 30 * MINUTE)
  assert.equal(stats.topInstallations[0].sessions, 2)
  assert.deepEqual(stats.versions.map((entry) => entry.versionId), ['1.21.4', '1.20.6'])
})

test('a session crossing local midnight lands on both local days', () => {
  const start = localIso(2026, 1, 10, 23, 30)
  const end = localIso(2026, 1, 11, 0, 30)
  const stats = buildPlaytimeStats({
    sessions: [session({ id: 'late', installationId: 'main', date: start, endDate: end, durationMs: HOUR })],
    installations: [{ id: 'main', name: 'Main', versionId: '1.21.4' }],
    now: new Date(2026, 0, 20, 12),
  })
  const days = new Map(stats.days.map((day) => [day.date, day]))
  const [year, month, day] = localDateKey(start).split('-').map(Number)
  const nextKey = localDateKey(new Date(year, month - 1, day + 1, 12))
  assert.equal(days.get(localDateKey(start)).playtimeMs, 30 * MINUTE)
  assert.equal(days.get(nextKey).playtimeMs, 30 * MINUTE)
  assert.equal(days.get(localDateKey(start)).sessions, 1)
  assert.equal(days.get(nextKey).sessions, 1)
  assert.equal(
    stats.days.reduce((sum, entry) => sum + entry.playtimeMs, 0),
    HOUR,
  )
})

test('UTC and local dates can differ without moving the session', () => {
  // Pick a local time late enough that some timezones already show the next UTC
  // date; the bucket must still follow the local calendar, whatever this host is.
  const startedAt = localIso(2026, 6, 15, 23, 45)
  const stats = buildPlaytimeStats({
    sessions: [session({ id: 'edge', installationId: 'main', date: startedAt, durationMs: 15 * MINUTE })],
    installations: [{ id: 'main', name: 'Main', versionId: '1.21.4' }],
    now: new Date(2026, 5, 20, 12),
  })
  const day = stats.days.find((entry) => entry.playtimeMs > 0)
  assert.equal(day.date, localDateKey(startedAt))
  assert.equal(day.playtimeMs, 15 * MINUTE)
})

test('streaks count consecutive local play days and deleted instances stay labelled', () => {
  const now = new Date(2026, 4, 12, 12)
  const day = (offset) => new Date(2026, 4, 12 - offset, 18)
  const sessions = [
    session({ id: 'today', installationId: 'gone', date: day(0).toISOString(), durationMs: 30 * MINUTE }),
    session({ id: 'yesterday', installationId: 'gone', date: day(1).toISOString(), durationMs: 20 * MINUTE }),
    session({ id: 'two-days', installationId: 'gone', date: day(2).toISOString(), durationMs: 10 * MINUTE }),
    session({ id: 'old', installationId: 'old', date: day(6).toISOString(), durationMs: HOUR }),
  ]
  const stats = buildPlaytimeStats({ sessions, installations: [], now })
  assert.equal(stats.streak.currentDays, 3)
  assert.equal(stats.streak.longestDays, 3)
  assert.equal(stats.topInstallations[0].name, 'Deleted installation')
  assert.equal(stats.topInstallations[0].missing, true)
})

test('empty history returns zeros and a full 12-week grid', () => {
  const stats = buildPlaytimeStats({
    sessions: [],
    installations: [{ id: 'main', name: 'Main', versionId: '1.21.4' }],
    now: new Date(2026, 0, 15, 9),
  })
  assert.equal(stats.hasHistory, false)
  assert.equal(stats.totals.playtimeMs, 0)
  assert.equal(stats.totals.sessions, 0)
  assert.equal(stats.totals.activeDays, 0)
  assert.equal(stats.totals.averageSessionMs, 0)
  assert.equal(stats.totals.firstSessionAt, null)
  assert.equal(stats.days.length, 84)
  assert.equal(stats.days.at(-1).date, localDateKey(new Date(2026, 0, 15, 9)))
  assert.ok(stats.days.every((day) => day.playtimeMs === 0 && day.sessions === 0))
  assert.deepEqual(stats.topInstallations, [])
  assert.deepEqual(stats.versions, [])
  assert.deepEqual(stats.streak, { currentDays: 0, longestDays: 0 })
})

test('CSV export carries ISO timestamps, instance names and escaped fields', () => {
  const startedAt = localIso(2026, 7, 4, 10, 0)
  const endedAt = localIso(2026, 7, 4, 11, 30)
  const { csv, rows } = sessionsToCsv({
    sessions: [
      session({ id: 'one', installationId: 'pack', date: startedAt, endDate: endedAt, durationMs: 90 * MINUTE }),
      { id: 'broken', installationId: 'pack', startedAt: 'not a date', endedAt: null, playtimeMs: 1000 },
    ],
    installations: [{ id: 'pack', name: 'My, "Quoted" Pack', versionId: '1.21.4' }],
  })
  assert.equal(rows, 1)
  const lines = csv.split('\r\n')
  assert.equal(lines[0], 'startedAt,endedAt,localDate,installation,version,durationMs,durationMinutes')
  assert.match(lines[1], new RegExp(startedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(lines[1], new RegExp(endedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(lines[1], /"My, ""Quoted"" Pack"/)
  assert.match(lines[1], /1\.21\.4/)
  assert.match(lines[1], /5400000,90\.0$/)
})
