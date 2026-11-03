import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BarChart3,
  CalendarDays,
  Clock,
  Download,
  Flame,
  Gamepad2,
  History,
  TriangleAlert,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatPlaytime, relativeTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { PlaytimeStats, StatsDay } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Button, EmptyState, Spinner, cx } from '../components/ui/primitives'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local date keys are calendar days, not UTC instants, so parse them by hand. */
function dayLabel(key: string, options?: Intl.DateTimeFormatOptions) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString(
    undefined,
    options || { weekday: 'short', month: 'short', day: 'numeric' },
  )
}

function dayStart(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function StatsPage() {
  const { data, navigate, pushToast } = useLauncher()
  const [stats, setStats] = useState<PlaytimeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [exporting, setExporting] = useState(false)

  // The summary is computed in the main process; refetching when the session
  // list changes keeps the page current after a game closes.
  const sessionCount = data?.sessions.length ?? 0
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api.stats
      .summary()
      .then((result) => {
        if (!cancelled) setStats(result)
      })
      .catch((cause) => {
        if (!cancelled) setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionCount, reloadKey])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const result = await api.stats.exportCsv()
      if (result) {
        pushToast({
          level: 'success',
          title: `Exported ${result.rows} session${result.rows === 1 ? '' : 's'}`,
          message: result.path,
        })
      }
    } catch (cause) {
      pushToast({ level: 'error', title: 'Could not export playtime', message: getErrorMessage(cause) })
    } finally {
      setExporting(false)
    }
  }

  const rangeLabel = stats
    ? `${dayLabel(stats.range.start, { month: 'short', day: 'numeric' })} – ${dayLabel(stats.range.end, {
        month: 'short',
        day: 'numeric',
      })}`
    : ''

  return (
    <div className="page stats-page">
      <PageHeader
        kicker="Local only · never uploaded"
        title="Playtime & activity"
        subtitle="Built from the sessions Aqua already records. Everything stays on this computer and is never compared with anyone else."
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Download />}
            loading={exporting}
            disabled={!stats || stats.totals.sessions === 0}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </Button>
        }
      />

      {error ? (
        <div className="callout callout--warning" role="alert">
          <TriangleAlert />
          <span>{error}</span>
          <button type="button" className="link-button" onClick={() => setReloadKey((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {!stats && loading ? (
        <div className="panel stats-loading">
          <Spinner /> Reading your session history…
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="stats-cards">
            <StatCard
              icon={<Clock />}
              label="Total playtime"
              value={formatPlaytime(stats.totals.playtimeMs)}
              meta={`${stats.totals.sessions.toLocaleString()} session${stats.totals.sessions === 1 ? '' : 's'} recorded`}
            />
            <StatCard
              icon={<BarChart3 />}
              label="Average session"
              value={formatPlaytime(stats.totals.averageSessionMs)}
              meta={`Longest ${formatPlaytime(stats.totals.longestSessionMs)}`}
            />
            <StatCard
              icon={<CalendarDays />}
              label="Active days"
              value={stats.totals.activeDays.toLocaleString()}
              meta="Days with recorded playtime"
            />
            <StatCard
              icon={<Flame />}
              label="Current streak"
              value={`${stats.streak.currentDays} day${stats.streak.currentDays === 1 ? '' : 's'}`}
              meta={`Longest streak ${stats.streak.longestDays} day${stats.streak.longestDays === 1 ? '' : 's'}`}
            />
          </div>

          {!stats.hasHistory ? (
            <div className="panel stats-empty">
              <EmptyState
                icon={<Gamepad2 />}
                title="No playtime recorded yet"
                description="Aqua records a session when Minecraft closes, so the first launch will start this chart."
              >
                <Button size="sm" onClick={() => navigate('installations')}>
                  Browse installations
                </Button>
              </EmptyState>
            </div>
          ) : null}

          <section className="panel stats-panel">
            <div className="stats-panel__head">
              <div>
                <h2 className="stats-panel__title">Last 12 weeks</h2>
                <p className="stats-panel__subtitle">
                  {rangeLabel} · days follow this computer’s local time
                </p>
              </div>
              <span className="stats-panel__total">{formatPlaytime(stats.totals.playtimeMs)} all time</span>
            </div>
            <Heatmap days={stats.days} />
            <div className="stats-legend">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={cx('stats-heatmap__cell', `is-level-${level}`)} aria-hidden="true" />
              ))}
              <span>More</span>
            </div>
          </section>

          <div className="stats-grid">
            <section className="panel stats-panel">
              <div className="stats-panel__head">
                <div>
                  <h2 className="stats-panel__title">Top installations</h2>
                  <p className="stats-panel__subtitle">Where the recorded hours went.</p>
                </div>
              </div>
              {stats.topInstallations.length ? (
                <ol className="stats-ranks">
                  {stats.topInstallations.map((entry, index) => (
                    <li className="stats-rank" key={entry.installationId}>
                      <span className="stats-rank__index">{index + 1}</span>
                      <div className="stats-rank__body">
                        <div className="stats-rank__row">
                          <span className={cx('stats-rank__name', entry.missing && 'is-missing')}>{entry.name}</span>
                          <span className="stats-rank__value">{formatPlaytime(entry.playtimeMs)}</span>
                        </div>
                        <div className="stats-rank__bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.max(
                                4,
                                Math.round(
                                  (entry.playtimeMs / Math.max(1, stats.topInstallations[0].playtimeMs)) * 100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="stats-rank__meta">
                          {entry.versionId ? `Minecraft ${entry.versionId} · ` : ''}
                          {entry.sessions} session{entry.sessions === 1 ? '' : 's'}
                          {entry.lastPlayedAt ? ` · last played ${relativeTime(entry.lastPlayedAt)}` : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="stats-note">No installations have recorded playtime yet.</p>
              )}
            </section>

            <section className="panel stats-panel">
              <div className="stats-panel__head">
                <div>
                  <h2 className="stats-panel__title">Most-played versions</h2>
                  <p className="stats-panel__subtitle">Playtime by each profile’s Minecraft version.</p>
                </div>
              </div>
              {stats.versions.length ? (
                <ul className="stats-versions">
                  {stats.versions.map((entry) => (
                    <li className="stats-version" key={entry.versionId}>
                      <span className="stats-version__name">
                        {entry.versionId === 'Unknown version' ? entry.versionId : `Minecraft ${entry.versionId}`}
                      </span>
                      <span className="stats-version__meta">
                        {formatPlaytime(entry.playtimeMs)} · {entry.sessions} session
                        {entry.sessions === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="stats-note">Versions appear once a session is recorded.</p>
              )}
            </section>
          </div>

          <section className="panel stats-panel">
            <div className="stats-panel__head">
              <div>
                <h2 className="stats-panel__title">Recent crashes</h2>
                <p className="stats-panel__subtitle">The last few classified crashes, kept with your diagnostics.</p>
              </div>
              <button type="button" className="link-button" onClick={() => navigate('logs', { category: 'crash' })}>
                Open logs
              </button>
            </div>
            {stats.recentCrashes.length ? (
              <ul className="stats-crashes">
                {stats.recentCrashes.map((crash) => (
                  <li className="stats-crash" key={crash.id}>
                    <span className="stats-crash__icon">
                      <TriangleAlert />
                    </span>
                    <span className="stats-crash__copy">
                      <span className="stats-crash__title">{crash.title}</span>
                      <span className="stats-crash__meta">
                        {crash.installationName || 'Launcher'} · {crash.category} · {relativeTime(crash.at)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        navigate('logs', {
                          category: 'crash',
                          ...(crash.installationId ? { installationId: crash.installationId } : {}),
                        })
                      }
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="stats-note">
                <History /> No crashes recorded. That is the good outcome.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  meta,
}: {
  icon: ReactNode
  label: string
  value: string
  meta: string
}) {
  return (
    <div className="stats-card">
      <span className="stats-card__label">
        {icon}
        {label}
      </span>
      <span className="stats-card__value">{value}</span>
      <span className="stats-card__meta">{meta}</span>
    </div>
  )
}

function Heatmap({ days }: { days: StatsDay[] }) {
  const { weeks, max } = useMemo(() => {
    const cells: Array<StatsDay | null> = []
    if (days.length) {
      // Pad the first column so weekday rows stay aligned (Sunday first).
      const leading = dayStart(days[0].date).getDay()
      for (let index = 0; index < leading; index += 1) cells.push(null)
      cells.push(...days)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const grouped: Array<Array<StatsDay | null>> = []
    for (let index = 0; index < cells.length; index += 7) grouped.push(cells.slice(index, index + 7))
    return {
      weeks: grouped,
      max: Math.max(1, ...days.map((day) => day.playtimeMs)),
    }
  }, [days])

  const levelFor = (day: StatsDay) =>
    day.playtimeMs <= 0 ? 0 : Math.max(1, Math.ceil((day.playtimeMs / max) * 4))

  return (
    <div
      className="stats-heatmap"
      role="img"
      aria-label={`Playtime heatmap for ${days.length} days, ${formatPlaytime(
        days.reduce((sum, day) => sum + day.playtimeMs, 0),
      )} total`}
    >
      <div className="stats-heatmap__labels" aria-hidden="true">
        {WEEKDAYS.map((name, index) => (
          <span key={name}>{index % 2 === 1 ? name : ''}</span>
        ))}
      </div>
      <div className="stats-heatmap__weeks">
        {weeks.map((week, weekIndex) => (
          <div className="stats-heatmap__week" key={weekIndex}>
            {week.map((day, dayIndex) =>
              day ? (
                <span
                  key={day.date}
                  className={`stats-heatmap__cell is-level-${levelFor(day)}`}
                  title={`${dayLabel(day.date)} · ${formatPlaytime(day.playtimeMs)} · ${day.sessions} session${
                    day.sessions === 1 ? '' : 's'
                  }`}
                />
              ) : (
                <span key={`blank-${weekIndex}-${dayIndex}`} className="stats-heatmap__cell is-empty" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
