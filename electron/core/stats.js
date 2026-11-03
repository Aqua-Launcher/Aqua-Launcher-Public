/**
 * Playtime statistics are derived from the session list the launcher already
 * stores; nothing new is tracked. All calendaring is local-time on purpose:
 * a session that starts at 23:30 belongs to that local day, even when its UTC
 * timestamp already points at tomorrow.
 */

const DEFAULT_WEEKS = 12
const MAX_WEEKS = 52
const TOP_LIMIT = 5
const MAX_DAY_MS = 7 * 24 * 60 * 60 * 1000

function parseTime(value) {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function playtimeOf(session) {
  const value = Number(session?.playtimeMs)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

export function startOfLocalDay(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addLocalDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

function bucketFor(map, key) {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = { playtimeMs: 0, sessions: 0 }
    map.set(key, bucket)
  }
  return bucket
}

/**
 * A session that crosses local midnight contributes to both days. The stored
 * `playtimeMs` is authoritative; `startedAt` only decides where it lands.
 */
function distributeDaytime(session, dayBuckets) {
  const started = parseTime(session.startedAt)
  const duration = Math.min(playtimeOf(session), MAX_DAY_MS)
  if (!started || duration <= 0) return
  let cursor = started
  let remaining = duration
  let guard = 0
  while (remaining > 0 && guard < 32) {
    const dayStart = startOfLocalDay(cursor)
    const nextDay = addLocalDays(dayStart, 1)
    const chunk = Math.min(remaining, Math.max(0, nextDay.getTime() - cursor.getTime()))
    const key = localDateKey(cursor)
    if (!key || chunk <= 0) break
    const bucket = bucketFor(dayBuckets, key)
    bucket.playtimeMs += chunk
    bucket.sessions += 1
    remaining -= chunk
    cursor = nextDay
    guard += 1
  }
}

function currentStreak(dayKeys, now) {
  const today = startOfLocalDay(now)
  if (!today) return 0
  let cursor = today
  // A streak is allowed to survive today until the day is over: if nothing has
  // been played yet, start counting from yesterday.
  if (!dayKeys.has(localDateKey(cursor))) cursor = addLocalDays(cursor, -1)
  let days = 0
  while (dayKeys.has(localDateKey(cursor))) {
    days += 1
    cursor = addLocalDays(cursor, -1)
  }
  return days
}

function longestStreak(dayKeys) {
  const sorted = [...dayKeys].sort()
  let longest = 0
  let run = 0
  let previous = null
  for (const key of sorted) {
    const [year, month, day] = key.split('-').map(Number)
    const current = new Date(year, month - 1, day)
    if (previous && localDateKey(addLocalDays(previous, 1)) === key) run += 1
    else run = 1
    longest = Math.max(longest, run)
    previous = current
  }
  return longest
}

export function buildPlaytimeStats({
  sessions = [],
  installations = [],
  crashes = [],
  now = new Date(),
  weeks = DEFAULT_WEEKS,
} = {}) {
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const weekCount = Math.min(MAX_WEEKS, Math.max(1, Math.round(Number(weeks) || DEFAULT_WEEKS)))
  const dayCount = weekCount * 7
  const installationById = new Map(
    installations.filter((entry) => entry && typeof entry.id === 'string').map((entry) => [entry.id, entry]),
  )

  const dayBuckets = new Map()
  const installationBuckets = new Map()
  let totalPlaytimeMs = 0
  let sessionCount = 0
  let longestSessionMs = 0
  let firstSessionAt = null
  let lastSessionAt = null

  for (const session of sessions) {
    const started = parseTime(session?.startedAt)
    if (!started) continue
    const ended = parseTime(session?.endedAt)
    const playtimeMs = playtimeOf(session)
    const installationId = typeof session?.installationId === 'string' ? session.installationId : null

    sessionCount += 1
    totalPlaytimeMs += playtimeMs
    longestSessionMs = Math.max(longestSessionMs, playtimeMs)
    if (!firstSessionAt || started < firstSessionAt) firstSessionAt = started
    const finished = ended && ended > started ? ended : started
    if (!lastSessionAt || finished > lastSessionAt) lastSessionAt = finished

    if (installationId) {
      let bucket = installationBuckets.get(installationId)
      if (!bucket) {
        bucket = { installationId, playtimeMs: 0, sessions: 0, lastPlayedAt: null }
        installationBuckets.set(installationId, bucket)
      }
      bucket.playtimeMs += playtimeMs
      bucket.sessions += 1
      if (!bucket.lastPlayedAt || finished > bucket.lastPlayedAt) bucket.lastPlayedAt = finished
    }

    distributeDaytime(session, dayBuckets)
  }

  const todayStart = startOfLocalDay(at)
  const windowStart = addLocalDays(todayStart, -(dayCount - 1))
  const days = []
  for (let index = 0; index < dayCount; index += 1) {
    const date = addLocalDays(windowStart, index)
    const key = localDateKey(date)
    const bucket = dayBuckets.get(key)
    days.push({
      date: key,
      playtimeMs: bucket?.playtimeMs || 0,
      sessions: bucket?.sessions || 0,
    })
  }

  const playedDays = new Set(
    [...dayBuckets.entries()].filter(([, bucket]) => bucket.playtimeMs > 0).map(([key]) => key),
  )

  const topInstallations = [...installationBuckets.values()]
    .map((bucket) => {
      const installation = installationById.get(bucket.installationId) || null
      return {
        installationId: bucket.installationId,
        name: installation?.name || 'Deleted installation',
        versionId: installation?.versionId || null,
        missing: !installation,
        playtimeMs: bucket.playtimeMs,
        sessions: bucket.sessions,
        lastPlayedAt: bucket.lastPlayedAt ? bucket.lastPlayedAt.toISOString() : null,
      }
    })
    .sort((left, right) => right.playtimeMs - left.playtimeMs || left.name.localeCompare(right.name))
    .slice(0, TOP_LIMIT)

  const versionBuckets = new Map()
  for (const bucket of installationBuckets.values()) {
    const installation = installationById.get(bucket.installationId)
    const versionId = installation?.versionId || 'Unknown version'
    const entry = versionBuckets.get(versionId) || { versionId, playtimeMs: 0, sessions: 0 }
    entry.playtimeMs += bucket.playtimeMs
    entry.sessions += bucket.sessions
    versionBuckets.set(versionId, entry)
  }
  const versions = [...versionBuckets.values()]
    .sort((left, right) => right.playtimeMs - left.playtimeMs || left.versionId.localeCompare(right.versionId))
    .slice(0, TOP_LIMIT)

  const recentCrashes = crashes.slice(0, 5).map((crash) => ({
    id: crash.id,
    at: crash.at,
    title: crash.title,
    category: crash.category,
    installationId: crash.installationId || null,
    installationName: crash.installationName || null,
  }))

  return {
    generatedAt: at.toISOString(),
    range: {
      start: localDateKey(windowStart),
      end: localDateKey(todayStart),
      weeks: weekCount,
    },
    hasHistory: sessionCount > 0,
    totals: {
      playtimeMs: totalPlaytimeMs,
      sessions: sessionCount,
      activeDays: playedDays.size,
      averageSessionMs: sessionCount ? Math.round(totalPlaytimeMs / sessionCount) : 0,
      longestSessionMs,
      firstSessionAt: firstSessionAt ? firstSessionAt.toISOString() : null,
      lastSessionAt: lastSessionAt ? lastSessionAt.toISOString() : null,
    },
    days,
    topInstallations,
    versions,
    streak: {
      currentDays: currentStreak(playedDays, at),
      longestDays: longestStreak(playedDays),
    },
    recentCrashes,
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One row per stored session, newest first, with ISO times and instance names. */
export function sessionsToCsv({ sessions = [], installations = [] } = {}) {
  const installationById = new Map(
    installations.filter((entry) => entry && typeof entry.id === 'string').map((entry) => [entry.id, entry]),
  )
  const rows = []
  for (const session of sessions) {
    const started = parseTime(session?.startedAt)
    if (!started) continue
    const ended = parseTime(session?.endedAt)
    const installation = installationById.get(session?.installationId) || null
    const playtimeMs = playtimeOf(session)
    rows.push({
      at: started,
      values: [
        started.toISOString(),
        ended && ended > started ? ended.toISOString() : '',
        localDateKey(started),
        installation?.name || 'Deleted installation',
        installation?.versionId || '',
        playtimeMs,
        (playtimeMs / 60_000).toFixed(1),
      ],
    })
  }
  rows.sort((left, right) => right.at - left.at)
  const header = 'startedAt,endedAt,localDate,installation,version,durationMs,durationMinutes'
  const body = rows.map((row) => row.values.map(csvCell).join(','))
  return {
    csv: [header, ...body].join('\r\n'),
    rows: rows.length,
  }
}
