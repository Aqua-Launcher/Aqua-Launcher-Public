import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Boxes,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  Gamepad2,
  Gem,
  Globe2,
  GripVertical,
  HardDrive,
  LayoutGrid,
  List,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatEta, formatPlaytime, relativeTime, shortPath } from '../lib/format'
import { loaderLabel } from '../lib/loaders'
import {
  installationColorHex,
  sortInstallations,
  type InstallationSortMode,
  type InstallationViewMode,
} from '../lib/installationMeta'
import { useLauncher } from '../state/LauncherProvider'
import type { DownloadJob, HealthStatus, HorizonInstallJob, HorizonStatus, Installation } from '../lib/types'
import { PackIcon } from '../components/brand/Brand'
import { PageHeader } from '../components/layout/PageHeader'
import { ActionMenu } from '../components/ui/Menu'
import { Badge, Button, EmptyState, IconButton, cx } from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/overlays'
import { InstallBedrockDialog } from '../components/bedrock/InstallBedrockDialog'
import { RegisterBedrockDialog } from '../components/bedrock/RegisterBedrockDialog'
import { HealthDialog } from '../components/dialogs/HealthDialog'
import { ImportPackDialog } from '../components/installations/ImportPackDialog'
import { LauncherImportDialog } from '../components/installations/LauncherImportDialog'
import { ExportPackDialog } from '../components/installations/ExportPackDialog'
import { InstallationMetaDialog } from '../components/installations/InstallationMetaDialog'

type EditionFilter = 'all' | 'java' | 'bedrock' | 'horizon'

const SORT_KEY = 'aqua.installations.sort.v1'
const VIEW_KEY = 'aqua.installations.view.v1'
const SORT_MODES: InstallationSortMode[] = ['recent', 'name', 'custom']
const VIEW_MODES: InstallationViewMode[] = ['grid', 'compact']

function readPreference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key)
    return values.includes(stored as T) ? (stored as T) : fallback
  } catch {
    return fallback
  }
}

function activeInstallJob(jobs: DownloadJob[], installationId: string) {
  return (
    jobs.find(
      (job) =>
        job.type === 'install' &&
        job.installationId === installationId &&
        (job.status === 'running' || job.status === 'queued'),
    ) || null
  )
}

function latestInstallJob(jobs: DownloadJob[], installationId: string) {
  return jobs.find((job) => job.type === 'install' && job.installationId === installationId) || null
}

function horizonJobActive(job: HorizonInstallJob | null) {
  return Boolean(job && (job.status === 'queued' || job.status === 'running' || job.status === 'cancelling'))
}

export function InstallationsPage() {
  const {
    installations,
    jobs,
    game,
    launchingId,
    versions,
    openInstallDialog,
    play,
    installGame,
    setActiveInstallation,
    updateInstallationMeta,
    reorderInstallations,
    openInstallationFolder,
    duplicateInstallation,
    deleteInstallation,
    pushToast,
    bedrock,
    bedrockLoading,
    bedrockError,
    refreshBedrock,
    launchBedrock,
    bedrockTarget,
    selectBedrockTarget,
    horizonTarget,
    bedrockLibrary,
    bedrockDownloads,
    cancelBedrockVersion,
    registerBedrockVersion,
    installBedrockVersion,
    removeBedrockVersion,
    openBedrockVersionFolder,
    launchHorizon,
    launchingHorizonTag,
    selectHorizonTarget,
    navigate,
  } = useLauncher()

  const [filter, setFilter] = useState<EditionFilter>('all')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<InstallationSortMode>(() =>
    readPreference(SORT_KEY, SORT_MODES, 'recent'),
  )
  const [viewMode, setViewMode] = useState<InstallationViewMode>(() =>
    readPreference(VIEW_KEY, VIEW_MODES, 'grid'),
  )
  const [metaTarget, setMetaTarget] = useState<Installation | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<HorizonStatus | null>(null)
  const [horizonLoading, setHorizonLoading] = useState(false)
  const [horizonError, setHorizonError] = useState<string | null>(null)
  const [horizonJob, setHorizonJob] = useState<HorizonInstallJob | null>(null)
  const horizonRequest = useRef(0)
  const [deleteTarget, setDeleteTarget] = useState<Installation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [launchingEditionId, setLaunchingEditionId] = useState<string | null>(null)
  const [registerTarget, setRegisterTarget] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<string | null>(null)
  const [healthTarget, setHealthTarget] = useState<Installation | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [launcherImportOpen, setLauncherImportOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<Installation | null>(null)
  const [healthSummaries, setHealthSummaries] = useState<Record<string, HealthStatus>>({})
  const javaIsPlayTarget = !bedrockTarget && !horizonTarget
  const customOrder = sortMode === 'custom'

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_KEY, sortMode)
      window.localStorage.setItem(VIEW_KEY, viewMode)
    } catch {
      // Preferences are a convenience; a blocked localStorage is harmless.
    }
  }, [sortMode, viewMode])

  const targetEdition = (editionId: string) => {
    selectBedrockTarget(editionId)
    pushToast({
      level: 'info',
      title: 'Bedrock is now the Play target',
      message: 'Press Play on the dashboard, or Shift-click Play here to launch it now.',
    })
  }

  const launchEdition = async (editionId: string) => {
    setLaunchingEditionId(editionId)
    try {
      // Shift-click is the shortcut that starts the game without changing the target.
      await launchBedrock(editionId, null, { keepTarget: true })
    } finally {
      setLaunchingEditionId(null)
    }
  }

  const refreshHorizon = useCallback(async (force = false) => {
    const request = ++horizonRequest.current
    setHorizonLoading(true)
    setHorizonError(null)
    try {
      const result = await api.horizon.status({ force })
      if (horizonRequest.current === request) setHorizon(result)
    } catch (error) {
      if (horizonRequest.current === request) setHorizonError(getErrorMessage(error))
    } finally {
      if (horizonRequest.current === request) setHorizonLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshHorizon(false)
  }, [refreshHorizon])

  useEffect(() => {
    if (horizon?.install) setHorizonJob(horizon.install)
  }, [horizon?.install])

  useEffect(() => {
    const unsubscribe = api.events.subscribe((event) => {
      if (event.type !== 'horizon-install') return
      const next = event.payload as HorizonInstallJob
      setHorizonJob(next)
      if (next.status === 'completed') {
        pushToast({
          level: 'success',
          title: `Horizon ${next.tag} installed`,
          message: next.gameVersion ? `Minecraft ${next.gameVersion} is ready to play.` : 'The build is ready to play.',
        })
        setHorizonJob(null)
        void refreshHorizon(true)
      } else if (next.status === 'failed') {
        pushToast({
          level: 'error',
          title: 'Horizon installation failed',
          message: next.error || 'The installation did not finish.',
        })
        setHorizonJob(null)
        void refreshHorizon(true)
      } else if (next.status === 'cancelled') {
        pushToast({ level: 'info', title: 'Horizon installation cancelled' })
        setHorizonJob(null)
        void refreshHorizon(true)
      }
    })
    return unsubscribe
  }, [pushToast, refreshHorizon])

  useEffect(() => {
    let cancelled = false
    api.health
      .summary()
      .then((summary) => {
        if (cancelled) return
        setHealthSummaries(
          Object.fromEntries(summary.installations.map((entry) => [entry.installationId, entry.status])),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [installations])

  const openEditionFolder = async (editionId: string) => {
    try {
      await api.bedrock.openFolder(editionId)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open the data folder', message: getErrorMessage(error) })
    }
  }

  // A registered build also sits in the download folder: it is one thing, not two.
  // Windows reports install locations with a trailing separator; downloaded folders have none.
  const folderKey = (value: string) => value.replace(/[\\/]+$/, '').toLowerCase()
  const registeredFolders = useMemo(
    () => new Set((bedrock?.editions || []).map((edition) => folderKey(edition.installLocation || ''))),
    [bedrock],
  )
  const extraBuilds = useMemo(
    () => bedrockLibrary.filter((entry) => !registeredFolders.has(folderKey(entry.directory))),
    [bedrockLibrary, registeredFolders],
  )

  const normalizedQuery = query.trim().toLowerCase()
  const matches = (...values: Array<string | null | undefined>) =>
    !normalizedQuery || values.some((value) => (value || '').toLowerCase().includes(normalizedQuery))

  const javaCards = useMemo(() => {
    if (filter !== 'all' && filter !== 'java') return []
    const selectedTag = tagFilter?.toLowerCase() ?? null
    return sortInstallations(
      installations.filter(
        (installation) =>
          matches(installation.name, installation.versionId, installation.gameDir, installation.loader?.type) &&
          (!selectedTag || installation.tags.some((tag) => tag.toLowerCase() === selectedTag)),
      ),
      sortMode,
    )
  }, [installations, filter, normalizedQuery, tagFilter, sortMode])

  const allTags = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>()
    for (const installation of installations) {
      for (const tag of installation.tags) {
        const key = tag.toLowerCase()
        const entry = counts.get(key)
        if (entry) entry.count += 1
        else counts.set(key, { key, label: tag, count: 1 })
      }
    }
    return [...counts.values()].sort((left, right) => left.label.localeCompare(right.label))
  }, [installations])

  // A tag that only existed on a deleted profile must not leave the list empty.
  useEffect(() => {
    if (tagFilter && !allTags.some((tag) => tag.key === tagFilter.toLowerCase())) setTagFilter(null)
  }, [allTags, tagFilter])

  const editionCards = useMemo(() => {
    if (filter !== 'all' && filter !== 'bedrock') return []
    return (bedrock?.editions || []).filter((edition) => matches(edition.name, edition.version, edition.packageVersion))
  }, [bedrock, filter, normalizedQuery])

  const buildCards = useMemo(() => {
    if (filter !== 'all' && filter !== 'bedrock') return []
    return extraBuilds.filter((entry) => matches(entry.version, entry.directory))
  }, [extraBuilds, filter, normalizedQuery])

  const horizonCards = useMemo(() => {
    if (filter !== 'all' && filter !== 'horizon') return []
    return (horizon?.builds || []).filter((build) => matches(build.tag, build.gameVersion))
  }, [horizon, filter, normalizedQuery])

  const counts = {
    all:
      installations.length +
      (bedrock?.editions.length ?? 0) +
      extraBuilds.length +
      (horizon?.builds.length ?? 0),
    java: installations.length,
    bedrock: (bedrock?.editions.length ?? 0) + extraBuilds.length,
    horizon: horizon?.builds.length ?? 0,
  }
  const visibleCount =
    javaCards.length + editionCards.length + buildCards.length + horizonCards.length

  const requestDelete = (installation: Installation) => {
    setDeleteError(null)
    setDeleteTarget(installation)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteInstallation(deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const cancelJob = async (job: DownloadJob) => {
    try {
      await api.downloads.cancel(job.id)
      pushToast({ level: 'info', title: 'Download cancelled', message: job.title })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not cancel download', message: getErrorMessage(error) })
    }
  }

  const selectInstallation = async (id: string, announce = false) => {
    try {
      await setActiveInstallation(id)
      if (announce) {
        pushToast({
          level: 'info',
          title: 'Java is now the Play target',
          message: 'Press Play on the dashboard, or Shift-click Play here to launch it now.',
        })
      }
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not select installation', message: getErrorMessage(error) })
    }
  }

  const togglePinned = async (installation: Installation) => {
    try {
      await updateInstallationMeta(installation.id, { pinned: !installation.pinned })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not update the profile', message: getErrorMessage(error) })
    }
  }

  const moveInstallation = async (fromId: string, toId: string) => {
    if (fromId === toId) return
    const ids = sortInstallations(installations, 'custom').map((installation) => installation.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    try {
      await reorderInstallations(ids)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not save the profile order', message: getErrorMessage(error) })
    }
  }

  const targetHorizonBuild = (build: NonNullable<HorizonStatus['builds']>[number]) => {
    selectHorizonTarget(build)
    pushToast({
      level: 'info',
      title: 'Horizon is now the Play target',
      message: `${build.tag} will launch from the dashboard. Shift-click Play here to launch it now.`,
    })
  }

  const prepareHorizonBuild = async (tag: string) => {
    try {
      setHorizonJob(await api.horizon.install(tag))
      pushToast({
        level: 'info',
        title: `Horizon ${tag} is preparing`,
        message: 'Aqua is downloading the build and writing its resources.',
      })
    } catch (error) {
      pushToast({ level: 'error', title: 'Horizon could not install', message: getErrorMessage(error) })
    }
  }

  const cancelHorizonInstall = async () => {
    try {
      setHorizonJob(await api.horizon.cancelInstall())
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not cancel the installation', message: getErrorMessage(error) })
    }
  }

  const refreshAll = () => {
    void refreshBedrock(true)
    void refreshHorizon(true)
  }

  const showHorizonJob = horizonJobActive(horizonJob) && (filter === 'all' || filter === 'horizon')
  const nothingInstalled = counts.all === 0

  return (
    <div className="page">
      <PageHeader
        title="Installations"
        subtitle="Java profiles, Bedrock builds and Horizon builds in one list. Play sets the dashboard target; Shift-click Play to launch it now."
        actions={
          <>
            <Button
              icon={<RefreshCw className={bedrockLoading || horizonLoading ? 'spin' : undefined} />}
              onClick={refreshAll}
              disabled={bedrockLoading || horizonLoading}
            >
              Refresh
            </Button>
            <Button
              icon={<Archive />}
              onClick={() => setImportOpen(true)}
            >
              Import pack
            </Button>
            <Button icon={<HardDrive />} onClick={() => setLauncherImportOpen(true)}>
              Import launcher
            </Button>
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => openInstallDialog({ mode: 'create', versionId: versions?.latest.release })}
            >
              New installation
            </Button>
          </>
        }
      />

      <div className="page-toolbar">
        <div className="search-input">
          <Search />
          <input
            className="input"
            placeholder="Search versions, editions or folders…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search installations"
          />
          {query ? (
            <button type="button" className="search-input__clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X />
            </button>
          ) : null}
        </div>
        <div className="filter-chips" role="group" aria-label="Filter by edition">
          {(
            [
              ['all', 'All'],
              ['java', 'Java'],
              ['bedrock', 'Bedrock'],
              ['horizon', 'Horizon'],
            ] as Array<[EditionFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cx('chip', filter === value && 'is-active')}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label}
              <span className="chip__count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <span className="page-toolbar__count">
          {visibleCount} of {counts.all}
        </span>
      </div>

      <div className="installations-controls">
        {allTags.length ? (
          <div className="installations-controls__tags">
            <span className="installations-controls__label">
              <Tag /> Tags
            </span>
            <div className="filter-chips" role="group" aria-label="Filter by tag">
              <button
                type="button"
                className={cx('chip', !tagFilter && 'is-active')}
                onClick={() => setTagFilter(null)}
                aria-pressed={!tagFilter}
              >
                All
              </button>
              {allTags.map((tag) => {
                const active = tagFilter?.toLowerCase() === tag.key
                return (
                  <button
                    key={tag.key}
                    type="button"
                    className={cx('chip', active && 'is-active')}
                    onClick={() => setTagFilter(active ? null : tag.label)}
                    aria-pressed={active}
                  >
                    {tag.label}
                    <span className="chip__count">{tag.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <span className="installations-controls__hint">
            Add tags from a profile’s menu to group and filter the list.
          </span>
        )}

        <div className="installations-controls__actions">
          {customOrder ? <span className="installations-controls__hint">Drag Java cards to reorder.</span> : null}
          <label className="installations-sort">
            <span>Java order</span>
            <select
              className="select"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as InstallationSortMode)}
              aria-label="Sort Java profiles"
            >
              <option value="recent">Recently played</option>
              <option value="name">Name</option>
              <option value="custom">Custom order</option>
            </select>
          </label>
          <div className="view-toggle" role="group" aria-label="Profile view">
            <IconButton
              label="Grid view"
              size="sm"
              className={cx(viewMode === 'grid' && 'is-on')}
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid />
            </IconButton>
            <IconButton
              label="Compact view"
              size="sm"
              className={cx(viewMode === 'compact' && 'is-on')}
              aria-pressed={viewMode === 'compact'}
              onClick={() => setViewMode('compact')}
            >
              <List />
            </IconButton>
          </div>
        </div>
      </div>

      {bedrock?.supported && !bedrock?.editions.length && !bedrockLoading ? (
        <div className="callout bedrock-callout">
          <Store />
          <div>
            <strong>Minecraft for Windows was not found</strong>
            <span>
              Install Bedrock Edition from the Microsoft Store to play it, or add a downloaded build with{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => openInstallDialog({ mode: 'create', edition: 'bedrock' })}
              >
                New installation
              </button>
              .{' '}
              <button type="button" className="link-button" onClick={() => void api.openExternal(bedrock.storeUrl)}>
                Open the Store page
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {horizon && !horizon.supported ? (
        <div className="callout callout--warning">
          <AlertTriangle />
          <div>
            <strong>Horizon is not available for this platform</strong>
            <span>{horizon.supportedReason}</span>
          </div>
        </div>
      ) : null}

      {showHorizonJob && horizonJob ? (
        <section className="panel installation-job-panel">
          <div className="installation-job-panel__head">
            <div>
              <strong>Horizon {horizonJob.tag} is installing</strong>
              <span className="text-dim">
                {horizonJob.stage}
                {horizonJob.progress != null ? ` · ${Math.round(horizonJob.progress)}%` : ''}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<X />}
              loading={horizonJob.status === 'cancelling'}
              onClick={() => void cancelHorizonInstall()}
            >
              Cancel
            </Button>
          </div>
          <div className="installation-card__download-meta">
            <span>{horizonJob.message || horizonJob.currentFile || ''}</span>
            <span>
              {horizonJob.bytesTotal > 0
                ? `${formatBytes(horizonJob.bytesDone)} / ${formatBytes(horizonJob.bytesTotal)}`
                : ''}
              {horizonJob.speedBps > 0 ? ` · ${formatBytes(horizonJob.speedBps)}/s` : ''}
              {horizonJob.etaSeconds != null && horizonJob.etaSeconds > 0
                ? ` · ${formatEta(horizonJob.etaSeconds)} left`
                : ''}
            </span>
          </div>
        </section>
      ) : null}

      {horizonError ? (
        <div className="callout callout--danger" role="alert">
          <AlertTriangle />
          <div className="grow">
            {horizonError}
            <span className="text-dim"> Horizon builds are listed when its status can be read.</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refreshHorizon(true)} loading={horizonLoading}>
            Retry
          </Button>
        </div>
      ) : null}

      {bedrockError ? (
        <div className="callout callout--danger" role="alert">
          <AlertTriangle />
          <span>{bedrockError}</span>
        </div>
      ) : null}

      {nothingInstalled ? (
        <div className="panel">
          <EmptyState
            icon={<Boxes />}
            title="Nothing installed yet"
            description="Create a Java installation, add a Bedrock build, or install Horizon. Each card keeps its own version and folder."
          >
            <Button variant="primary" icon={<Plus />} onClick={() => openInstallDialog({ mode: 'create' })}>
              New installation
            </Button>
            <Button icon={<Download />} onClick={() => navigate('tasks')}>
              View tasks
            </Button>
          </EmptyState>
        </div>
      ) : visibleCount === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Search />}
            title="Nothing matches this filter"
            description="Try a different search term, or pick another edition."
          >
            <Button
              onClick={() => {
                setQuery('')
                setFilter('all')
                setTagFilter(null)
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        </div>
      ) : (
        <div className={cx('installation-grid', viewMode === 'compact' && 'is-compact')}>
          {javaCards.map((installation) => {
            const job = activeInstallJob(jobs, installation.id)
            const lastJob = latestInstallJob(jobs, installation.id)
            const isPlaying = game.status === 'running' && game.installationId === installation.id
            const isPreparing =
              (game.status === 'preparing' && game.installationId === installation.id) ||
              launchingId === installation.id
            return (
              <article
                key={installation.id}
                draggable={customOrder}
                onDragStart={
                  customOrder
                    ? (event) => {
                        setDraggingId(installation.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', installation.id)
                      }
                    : undefined
                }
                onDragOver={
                  customOrder
                    ? (event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setDragOverId(installation.id)
                      }
                    : undefined
                }
                onDragLeave={
                  customOrder
                    ? () => setDragOverId((current) => (current === installation.id ? null : current))
                    : undefined
                }
                onDrop={
                  customOrder
                    ? (event) => {
                        event.preventDefault()
                        const from = draggingId || event.dataTransfer.getData('text/plain')
                        setDraggingId(null)
                        setDragOverId(null)
                        if (from) void moveInstallation(from, installation.id)
                      }
                    : undefined
                }
                onDragEnd={
                  customOrder
                    ? () => {
                        setDraggingId(null)
                        setDragOverId(null)
                      }
                    : undefined
                }
                className={cx(
                  'installation-card',
                  installation.isActive && 'is-selected',
                  isPlaying && 'is-playing',
                  customOrder && 'is-reorderable',
                  draggingId === installation.id && 'is-dragging',
                  dragOverId === installation.id && 'is-drag-over',
                )}
              >
                <div className="installation-card__top">
                  <div className="installation-card__identity">
                    <button
                      type="button"
                      className={cx('installation-card__select', installation.isActive && 'is-on')}
                      aria-label={installation.isActive ? 'Default Java installation' : 'Set as default Java installation'}
                      aria-pressed={installation.isActive}
                      title={installation.isActive ? 'Default Java installation' : 'Set as default Java installation'}
                      onClick={() => void selectInstallation(installation.id)}
                    >
                      {installation.isActive ? <CheckCircle2 /> : <Circle />}
                    </button>
                    <div className="installation-card__cube" data-version-type={installation.versionType}>
                      <PackIcon
                        modpack={installation.modpack}
                        loader={installation.loader?.type ?? 'vanilla'}
                        size={26}
                      />
                    </div>
                    <div className="installation-card__titles">
                      <div className="installation-card__name-row">
                        {installation.color ? (
                          <span
                            className="installation-card__color"
                            style={{ background: installationColorHex(installation.color) || undefined }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <h2 className="installation-card__name">{installation.name}</h2>
                        {installation.isActive && javaIsPlayTarget ? (
                          <span className="installation-card__target">
                            <CheckCircle2 /> Play target
                          </span>
                        ) : null}
                      </div>
                      <div className="installation-card__version-row">
                        <span className="installation-card__version">
                          {installation.versionId}
                          {installation.loader?.type && installation.loader.type !== 'vanilla'
                            ? ` · ${loaderLabel(installation.loader.type)}`
                            : ''}
                        </span>
                        {installation.pinned ? <Badge tone="info">Pinned</Badge> : null}
                        <Badge tone="default">Java</Badge>
                        {healthSummaries[installation.id] ? (
                          <Badge
                            tone={
                              healthSummaries[installation.id] === 'error'
                                ? 'danger'
                                : healthSummaries[installation.id] === 'warn'
                                  ? 'warning'
                                  : healthSummaries[installation.id] === 'ok'
                                    ? 'success'
                                    : 'default'
                            }
                          >
                            {healthSummaries[installation.id] === 'ok'
                              ? 'Healthy'
                              : healthSummaries[installation.id] === 'error'
                                ? 'Health issue'
                                : healthSummaries[installation.id] === 'warn'
                                  ? 'Check health'
                                  : 'Health unknown'}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="installation-card__top-actions">
                    {customOrder ? (
                      <span className="installation-card__grip" title="Drag to reorder" aria-hidden="true">
                        <GripVertical />
                      </span>
                    ) : null}
                    <IconButton
                      label={installation.pinned ? `Unpin ${installation.name}` : `Pin ${installation.name} to the top`}
                      size="sm"
                      className={cx('installation-card__pin', installation.pinned && 'is-on')}
                      aria-pressed={installation.pinned}
                      onClick={() => void togglePinned(installation)}
                    >
                      <Pin />
                    </IconButton>
                    <ActionMenu
                      label={`Actions for ${installation.name}`}
                    items={[
                      {
                        label: 'Edit installation',
                        icon: <Pencil />,
                        onSelect: () => openInstallDialog({ mode: 'edit', installation }),
                      },
                      {
                        label: installation.pinned ? 'Unpin from the top' : 'Pin to the top',
                        icon: <Pin />,
                        onSelect: () => void togglePinned(installation),
                      },
                      {
                        label: 'Edit tags & colour',
                        icon: <Tag />,
                        onSelect: () => setMetaTarget(installation),
                      },
                      {
                        label: installation.installed ? 'Verify game files' : 'Download game files',
                        icon: <RefreshCw />,
                        onSelect: () => void installGame(installation.id),
                      },
                      {
                        label: 'Open game folder',
                        icon: <FolderOpen />,
                        onSelect: () => void openInstallationFolder(installation.id),
                      },
                      {
                        label: 'Export pack',
                        icon: <Archive />,
                        onSelect: () => setExportTarget(installation),
                      },
                      {
                        label: 'Set as default Java installation',
                        icon: <Check />,
                        disabled: installation.isActive,
                        onSelect: () => void selectInstallation(installation.id),
                      },
                      {
                        label: 'Duplicate profile',
                        icon: <Copy />,
                        onSelect: () => void duplicateInstallation(installation.id),
                      },
                      { separator: true },
                      {
                        label: 'Delete installation',
                        icon: <Trash2 />,
                        danger: true,
                        onSelect: () => requestDelete(installation),
                      },
                    ]}
                    />
                  </div>
                </div>

                <div className="installation-card__statusline">
                  <span className="installation-card__played">
                    {installation.lastPlayedAt ? `Played ${relativeTime(installation.lastPlayedAt)}` : 'Never played'}
                  </span>
                </div>

                {installation.tags.length ? (
                  <div className="installation-card__tags" aria-label={`${installation.name} tags`}>
                    {installation.tags.map((tag) => {
                      const active = tagFilter?.toLowerCase() === tag.toLowerCase()
                      return (
                        <button
                          key={tag}
                          type="button"
                          className={cx('tag-chip', active && 'is-active')}
                          aria-pressed={active}
                          onClick={() => setTagFilter(active ? null : tag)}
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <div className="installation-card__meta">
                  <div>
                    <span>Worlds</span>
                    <strong>{installation.worlds}</strong>
                  </div>
                  <div>
                    <span>Playtime</span>
                    <strong>{formatPlaytime(installation.totalPlaytimeMs)}</strong>
                  </div>
                  <div>
                    <span>Folder</span>
                    <strong title={installation.gameDir}>{shortPath(installation.gameDir, 30)}</strong>
                  </div>
                </div>

                {job ? (
                  <div className="installation-card__download">
                    <div className="installation-card__download-head">
                      <span>
                        {job.status === 'queued' ? 'Queued' : job.stage}
                        {job.progress != null ? ` · ${job.progress}%` : ''}
                      </span>
                      <div className="row gap-2">
                        <button type="button" className="link-button" onClick={() => navigate('tasks')}>
                          Open Tasks
                        </button>
                        <IconButton label="Cancel installation" size="sm" onClick={() => void cancelJob(job)}>
                          <X />
                        </IconButton>
                      </div>
                    </div>
                    <div className="installation-card__download-meta">
                      <span>
                        {job.bytesTotal > 0
                          ? `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}`
                          : job.stage}
                      </span>
                      <span>
                        {job.speedBps > 0 ? `${formatBytes(job.speedBps)}/s` : ''}
                        {job.etaSeconds != null && job.etaSeconds > 0 ? ` · ${formatEta(job.etaSeconds)} left` : ''}
                      </span>
                    </div>
                  </div>
                ) : lastJob?.status === 'failed' ? (
                  <div className="installation-card__download is-error">
                    <span className="installation-card__download-error">
                      {lastJob.error || 'The last installation attempt failed.'}
                    </span>
                    <button type="button" className="link-button" onClick={() => void installGame(installation.id)}>
                      Try again
                    </button>
                  </div>
                ) : null}

                <div className="installation-card__actions">
                  {isPlaying ? (
                    <Button size="sm" variant="subtle" icon={<Gamepad2 />} onClick={() => play(installation.id)}>
                      In game
                    </Button>
                  ) : job ? (
                    <Button size="sm" variant="subtle" icon={<Download />} onClick={() => navigate('tasks')}>
                      {job.progress != null ? `Installing ${job.progress}%` : 'Installing'}
                    </Button>
                  ) : isPreparing ? (
                    <Button size="sm" variant="subtle" icon={<RefreshCw />} disabled>
                      Launching…
                    </Button>
                  ) : installation.installed ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Play />}
                      title="Set as the Play target · Shift-click to launch now"
                      onClick={(event) => {
                        if (event.shiftKey) void play(installation.id, { keepTarget: true })
                        else void selectInstallation(installation.id, true)
                      }}
                    >
                      Play
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Download />}
                      onClick={() => void installGame(installation.id)}
                    >
                      Install
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Stethoscope />}
                    onClick={() => setHealthTarget(installation)}
                  >
                    Health
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil />}
                    onClick={() => openInstallDialog({ mode: 'edit', installation })}
                  >
                    Edit
                  </Button>
                  <IconButton
                    label={`Open ${installation.name} game folder`}
                    size="sm"
                    onClick={() => void openInstallationFolder(installation.id)}
                  >
                    <FolderOpen />
                  </IconButton>
                </div>
              </article>
            )
          })}

          {editionCards.map((edition) => (
            <article
              key={edition.id}
              className={cx('installation-card', bedrockTarget?.id === edition.id && 'is-selected')}
            >
              <div className="installation-card__top">
                <div className="installation-card__identity">
                  <div className="installation-card__cube" data-edition="bedrock">
                    <Gem />
                  </div>
                  <div className="installation-card__titles">
                    <div className="installation-card__name-row">
                      <h2 className="installation-card__name">{edition.name}</h2>
                      {bedrockTarget?.id === edition.id ? (
                        <span className="installation-card__target">
                          <CheckCircle2 /> Play target
                        </span>
                      ) : null}
                    </div>
                    <div className="installation-card__version-row">
                      <span className="installation-card__version">
                        {edition.version ? `Bedrock ${edition.version}` : 'Version unknown'} · package{' '}
                        {edition.packageVersion}
                      </span>
                      <Badge tone="default">Bedrock</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="installation-card__statusline">
                <span className="installation-card__played">Installed from the Microsoft Store</span>
              </div>

              <dl className="installation-card__facts">
                <div>
                  <dt>Data folder</dt>
                  <dd title={edition.dataRoot}>{shortPath(edition.dataRoot)}</dd>
                </div>
                <div>
                  <dt>Worlds folder</dt>
                  <dd title={edition.worldsDirectory}>{shortPath(edition.worldsDirectory)}</dd>
                </div>
              </dl>

              <div className="installation-card__actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Play />}
                  loading={launchingEditionId === edition.id}
                  title="Set as the Play target · Shift-click to launch now"
                  onClick={(event) => {
                    if (event.shiftKey) void launchEdition(edition.id)
                    else targetEdition(edition.id)
                  }}
                >
                  Play
                </Button>
                <Button size="sm" icon={<FolderOpen />} onClick={() => void openEditionFolder(edition.id)}>
                  Data folder
                </Button>
                <Button size="sm" variant="ghost" icon={<Globe2 />} onClick={() => navigate('worlds')}>
                  Worlds
                </Button>
              </div>
            </article>
          ))}

          {buildCards.map((entry) => {
            const linked = registeredFolders.has(folderKey(entry.directory))
            const installed =
              Boolean(bedrock?.editions[0]?.version) && bedrock?.editions[0]?.version === entry.version
            const progress = bedrockDownloads[entry.version] ?? null
            const busy = Boolean(
              progress && progress.phase !== 'done' && progress.phase !== 'error' && progress.phase !== 'cancelled',
            )
            const percent =
              progress && progress.totalBytes
                ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
                : progress?.phase === 'downloading'
                  ? null
                  : 0
            return (
              <article className="installation-card" key={`bedrock-${entry.version}`}>
                <div className="installation-card__top">
                  <div className="installation-card__identity">
                    <div className="installation-card__cube" data-edition="bedrock">
                      <Gem />
                    </div>
                    <div className="installation-card__titles">
                      <div className="installation-card__name-row">
                        <h2 className="installation-card__name">Bedrock {entry.version}</h2>
                        {linked ? <Badge tone="success">Registered</Badge> : null}
                        {!linked && installed ? <Badge tone="success">Installed</Badge> : null}
                      </div>
                      <div className="installation-card__version-row">
                        <span className="installation-card__version">
                          {entry.layout === 'appx' ? 'APPX build · opens in place' : 'MSIXVC build · installs through Windows'}
                        </span>
                        <Badge tone="default">Bedrock</Badge>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="installation-card__statusline">
                  <span className="installation-card__played">
                    {linked
                      ? 'This folder is the installed Minecraft'
                      : installed
                        ? 'Installed through Windows'
                        : 'Downloaded, not installed'}
                  </span>
                </div>

                <dl className="installation-card__facts">
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(entry.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>Folder</dt>
                    <dd title={entry.directory}>{shortPath(entry.directory, 44)}</dd>
                  </div>
                </dl>

                {busy && progress ? (
                  <div className="installation-card__download">
                    <div className="installation-card__download-head">
                      <span>
                        {progress.phase === 'resolving'
                          ? 'Finding the package…'
                          : progress.phase === 'extracting'
                            ? 'Unpacking the build…'
                            : progress.phase === 'installing'
                              ? 'Windows is installing the build…'
                              : `Downloading${percent != null ? ` · ${percent}%` : ''}`}
                      </span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void cancelBedrockVersion(entry.version)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="installation-card__actions">
                  {entry.layout === 'appx' ? (
                    linked ? null : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<CheckCircle2 />}
                        disabled={busy}
                        onClick={() => setRegisterTarget(entry.version)}
                      >
                        Register
                      </Button>
                    )
                  ) : installed ? null : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<HardDrive />}
                      disabled={busy}
                      onClick={() => setInstallTarget(entry.version)}
                    >
                      Install
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<FolderOpen />}
                    onClick={() => void openBedrockVersionFolder(entry.version)}
                  >
                    Folder
                  </Button>
                  <IconButton
                    label={`Remove Bedrock ${entry.version}`}
                    size="sm"
                    disabled={linked}
                    title={linked ? 'Windows is running this build. Uninstall it in Windows Settings first.' : undefined}
                    onClick={() => void removeBedrockVersion(entry.version)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </article>
            )
          })}

          {horizonCards.map((build) => (
            <article
              key={`horizon-${build.tag}`}
              className={cx('installation-card', horizonTarget?.tag === build.tag && 'is-selected')}
            >
              <div className="installation-card__top">
                <div className="installation-card__identity">
                  <div className="installation-card__cube" data-edition="horizon">
                    <Cpu />
                  </div>
                  <div className="installation-card__titles">
                    <div className="installation-card__name-row">
                      <h2 className="installation-card__name">Horizon {build.tag}</h2>
                      {horizonTarget?.tag === build.tag ? (
                        <span className="installation-card__target">
                          <CheckCircle2 /> Play target
                        </span>
                      ) : null}
                    </div>
                    <div className="installation-card__version-row">
                      <span className="installation-card__version">
                        Minecraft {build.gameVersion}
                        {build.javaMajor ? ` · Java ${build.javaMajor}` : ''}
                        {build.native ? ' · built here' : ''}
                      </span>
                      <Badge tone="default">Horizon</Badge>
                      <Badge tone={build.prepared ? 'success' : 'warning'}>
                        {build.prepared ? 'Ready' : 'Needs preparation'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="installation-card__statusline">
                <span className="installation-card__played">
                  {build.installedAt ? `Installed ${relativeTime(build.installedAt)}` : 'Installed by Aqua'}
                </span>
              </div>

              <dl className="installation-card__facts">
                <div>
                  <dt>Build folder</dt>
                  <dd title={build.directory}>{shortPath(build.directory, 44)}</dd>
                </div>
              </dl>

              {build.warning ? (
                <div className="installation-card__download is-error">
                  <span className="installation-card__download-error">{build.warning}</span>
                </div>
              ) : null}

              <div className="installation-card__actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Play />}
                  loading={launchingHorizonTag === build.tag}
                  disabled={!build.prepared}
                  title={
                    build.prepared
                      ? 'Set as the Play target · Shift-click to launch now'
                      : 'Install this build again to finish preparation.'
                  }
                  onClick={(event) => {
                    if (event.shiftKey) void launchHorizon(build, { keepTarget: true })
                    else targetHorizonBuild(build)
                  }}
                >
                  Play
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw />}
                  title="Download and prepare this build again"
                  onClick={() => void prepareHorizonBuild(build.tag)}
                >
                  {build.prepared ? 'Repair' : 'Prepare'}
                </Button>
                <IconButton
                  label={`Open Horizon ${build.tag} folder`}
                  size="sm"
                  onClick={() => void api.horizon.openFolder('build', build.tag)}
                >
                  <FolderOpen />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      )}

      <InstallationMetaDialog installation={metaTarget} onClose={() => setMetaTarget(null)} />

      <RegisterBedrockDialog
        version={registerTarget}
        onCancel={() => setRegisterTarget(null)}
        onConfirm={(options) => {
          const version = registerTarget
          setRegisterTarget(null)
          if (version) void registerBedrockVersion(version, options)
        }}
      />

      {healthTarget ? <HealthDialog installation={healthTarget} onClose={() => setHealthTarget(null)} /> : null}

      <InstallBedrockDialog
        version={installTarget}
        installedVersion={bedrock?.editions[0]?.version || null}
        onCancel={() => setInstallTarget(null)}
        onConfirm={() => {
          const version = installTarget
          setInstallTarget(null)
          if (version) void installBedrockVersion(version)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete installation?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong> will be removed from Aqua. Its
            worlds, screenshots, and downloaded files are kept on disk — nothing inside the game folder is deleted.
          </>
        }
        confirmLabel="Delete installation"
        loading={deleting}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
        onConfirm={() => void confirmDelete()}
      >
        {deleteTarget ? (
          <div className="delete-dialog">
            <div className="callout callout--warning">
              <AlertTriangle />
              <div>
                {deleteTarget.worlds > 0
                  ? `${deleteTarget.worlds} world${deleteTarget.worlds === 1 ? '' : 's'} will remain safe in this folder.`
                  : 'No worlds were found in this installation yet.'}
                <div className="delete-dialog__path mono" title={deleteTarget.gameDir}>
                  {deleteTarget.gameDir}
                </div>
              </div>
            </div>
            {deleteError ? <div className="callout callout--danger">{deleteError}</div> : null}
          </div>
        ) : null}
      </ConfirmDialog>

      <ImportPackDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <LauncherImportDialog open={launcherImportOpen} onClose={() => setLauncherImportOpen(false)} />
      <ExportPackDialog installation={exportTarget} onClose={() => setExportTarget(null)} />
    </div>
  )
}
