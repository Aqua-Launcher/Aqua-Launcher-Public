import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Compass,
  Download,
  ExternalLink,
  FolderOpen,
  Hammer,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes, relativeTime } from '../../lib/format'
import { useLauncher } from '../../state/LauncherProvider'
import type {
  HorizonMod,
  HorizonModKind,
  HorizonModsResult,
  HorizonNativeJob,
  HorizonNativeStatus,
  HorizonRegistryProject,
  HorizonRegistryResult,
} from '../../lib/types'
import { Button, EmptyState, IconButton, Spinner } from '../ui/primitives'
import { ConfirmDialog } from '../ui/overlays'

/**
 * Horizon reads its own files, not Minecraft jars: .hmod content mods live in
 * horizon-mods/, .hnmod native bundles in horizon-native-mods/, resource packs
 * in resourcepacks/, and horizon-mods.txt holds the on/off switches. The
 * catalogue is the registry index Horizon's own launcher reads, so browsing
 * needs no browser view.
 */
const GROUPS: Array<{ kind: HorizonModKind; label: string; folder: string; description: string }> = [
  {
    kind: 'content',
    label: 'Content mods',
    folder: 'horizon-mods',
    description: 'Blocks, items and data Horizon reads when it starts. Off until you turn them on.',
  },
  {
    kind: 'native',
    label: 'Native mods',
    folder: 'horizon-native-mods',
    description:
      'Rust mixin bundles. Enable them, then compile them into a playable Horizon build with Build native game.',
  },
  {
    kind: 'resourcepack',
    label: 'Resource packs',
    folder: 'resourcepacks',
    description: 'Packs layered over Horizon’s own resources the next time it loads them.',
  },
]

const KIND_LABELS: Record<HorizonModKind, string> = {
  content: 'Content mod',
  native: 'Native mod',
  resourcepack: 'Resource pack',
}

const FILTERS: Array<{ id: 'all' | HorizonModKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'native', label: 'Native mods' },
  { id: 'content', label: 'Content mods' },
  { id: 'resourcepack', label: 'Resource packs' },
]

const IMPORT_MESSAGES: Record<HorizonModKind, string> = {
  content: 'Content mods start off. Turn it on under Installed, then restart Horizon.',
  native: 'Turn it on under Installed, then use Build native game to compile it into Horizon.',
  resourcepack: 'Horizon applies the pack the next time it loads its resources.',
}

function groupIcon(kind: HorizonModKind) {
  if (kind === 'native') return <Boxes />
  if (kind === 'resourcepack') return <Palette />
  return <Package />
}

function formatDownloads(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function HorizonModsPanel() {
  const { pushToast, navigate } = useLauncher()
  const [data, setData] = useState<HorizonModsResult | null>(null)
  const [catalog, setCatalog] = useState<HorizonRegistryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | HorizonModKind>('all')
  const [deleteTarget, setDeleteTarget] = useState<HorizonMod | null>(null)
  const [native, setNative] = useState<HorizonNativeStatus | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.horizon.mods())
    } catch (loadError) {
      setData(null)
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCatalog = useCallback(async (force = false) => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      setCatalog(await api.horizon.registry({ force }))
    } catch (loadError) {
      setCatalog(null)
      setCatalogError(getErrorMessage(loadError))
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  const loadNative = useCallback(async () => {
    try {
      setNative(await api.horizon.nativeStatus())
    } catch (statusError) {
      pushToast({ level: 'error', title: 'Could not check the native build', message: getErrorMessage(statusError) })
    }
  }, [pushToast])

  useEffect(() => {
    void load()
    void loadCatalog()
    void loadNative()
  }, [load, loadCatalog, loadNative])

  useEffect(() => {
    return api.events.subscribe((event) => {
      if (event.type !== 'horizon-native') return
      const job = event.payload as HorizonNativeJob
      setNative((current) => (current ? { ...current, job, canBuild: job.status === 'running' ? false : current.canBuild } : current))
      if (job.status !== 'running' && job.status !== 'cancelling') {
        void load()
        void loadNative()
      }
    })
  }, [load, loadNative])

  const grouped = useMemo(() => {
    const groups = new Map<HorizonModKind, HorizonMod[]>()
    for (const mod of data?.mods ?? []) {
      const list = groups.get(mod.kind) ?? []
      list.push(mod)
      groups.set(mod.kind, list)
    }
    return groups
  }, [data])

  const installedIds = useMemo(() => new Set((data?.mods ?? []).map((mod) => mod.id)), [data])

  const projects = useMemo(() => {
    const text = query.trim().toLowerCase()
    return (catalog?.projects ?? []).filter((project) => {
      if (filter !== 'all' && project.kind !== filter) return false
      if (!text) return true
      return `${project.name} ${project.summary} ${project.id} ${project.authors.join(' ')}`
        .toLowerCase()
        .includes(text)
    })
  }, [catalog, filter, query])

  const importMod = async () => {
    try {
      const filePath = await api.dialogs.chooseHorizonMod()
      if (!filePath) return
      setImporting(true)
      const result = await api.horizon.importMod(filePath)
      pushToast({
        level: 'success',
        title: `Added ${result.title}`,
        message: IMPORT_MESSAGES[result.kind],
      })
      await load()
    } catch (importError) {
      pushToast({ level: 'error', title: 'Could not import that Horizon mod', message: getErrorMessage(importError) })
    } finally {
      setImporting(false)
    }
  }

  const installProject = async (project: HorizonRegistryProject) => {
    setInstalling(project.id)
    try {
      const result = await api.horizon.installProject(project.id)
      pushToast({
        level: 'success',
        title: `Installed ${result.title}`,
        message: IMPORT_MESSAGES[result.kind],
      })
      await load()
    } catch (installError) {
      pushToast({
        level: 'error',
        title: `Could not install ${project.name}`,
        message: getErrorMessage(installError),
      })
    } finally {
      setInstalling(null)
    }
  }

  const toggleMod = async (mod: HorizonMod) => {
    setBusy(mod.filename)
    try {
      const result = await api.horizon.toggleMod(mod.filename, mod.kind)
      pushToast({
        level: result.enabled ? 'success' : 'info',
        title: `${mod.title} ${result.enabled ? 'enabled' : 'disabled'}`,
        message: result.enabled ? 'Restart Horizon to load its content.' : 'Restart Horizon to unload it.',
      })
      await load()
    } catch (toggleError) {
      pushToast({ level: 'error', title: 'Could not change that mod', message: getErrorMessage(toggleError) })
    } finally {
      setBusy(null)
    }
  }

  const removeMod = async () => {
    if (!deleteTarget) return
    setBusy(deleteTarget.filename)
    try {
      await api.horizon.removeMod(deleteTarget.filename, deleteTarget.kind)
      pushToast({ level: 'success', title: `${deleteTarget.title} removed` })
      setDeleteTarget(null)
      await load()
    } catch (removeError) {
      pushToast({ level: 'error', title: 'Could not remove that Horizon mod', message: getErrorMessage(removeError) })
    } finally {
      setBusy(null)
    }
  }

  const openFolder = async (kind: HorizonModKind) => {
    try {
      await api.horizon.modsFolder(kind)
    } catch (folderError) {
      pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(folderError) })
    }
  }

  const openRegistrySite = async () => {
    try {
      await api.openExternal('https://playhorizon.dev/mods')
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open the registry', message: getErrorMessage(openError) })
    }
  }

  const buildNative = async () => {
    try {
      const job = await api.horizon.buildNative()
      setNative((current) => (current ? { ...current, job, canBuild: false } : current))
      pushToast({
        level: 'info',
        title: 'Native build started',
        message: native?.rust.available
          ? 'Compiling Horizon can take 20–30 minutes. You can keep using the launcher while it runs.'
          : 'Aqua downloads Rust on the first build, then compiles Horizon. This can take 20–30 minutes.',
      })
    } catch (buildError) {
      pushToast({ level: 'error', title: 'Could not start the native build', message: getErrorMessage(buildError) })
    }
  }

  const cancelBuild = async () => {
    try {
      const job = await api.horizon.cancelNativeBuild()
      setNative((current) => (current ? { ...current, job } : current))
    } catch (cancelError) {
      pushToast({ level: 'error', title: 'Could not cancel the build', message: getErrorMessage(cancelError) })
    }
  }

  const viewSwitch = (
    <div className="segmented edition-switch" role="tablist" aria-label="Horizon mods view">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'installed'}
        className={view === 'installed' ? 'is-active' : undefined}
        onClick={() => setView('installed')}
      >
        <Package /> Installed
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'browse'}
        className={view === 'browse' ? 'is-active' : undefined}
        onClick={() => setView('browse')}
      >
        <Compass /> Browse mods
      </button>
    </div>
  )

  if (view === 'browse') {
    return (
      <div className="horizon-mods">
        {viewSwitch}
        <div className="page-toolbar">
          <div className="search-input">
            <Search />
            <input
              className="input"
              placeholder="Search Horizon’s registry…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search Horizon’s registry"
            />
            {query ? (
              <button type="button" className="search-input__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X />
              </button>
            ) : null}
          </div>
          <span className="page-toolbar__count">
            {projects.length} project{projects.length === 1 ? '' : 's'} · Minecraft 26.3
          </span>
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={catalogLoading} onClick={() => void loadCatalog(true)}>
            Refresh
          </Button>
          <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void openRegistrySite()}>
            playhorizon.dev
          </Button>
        </div>

        <div className="segmented horizon-mods__filters" role="tablist" aria-label="Project type">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              className={filter === entry.id ? 'is-active' : undefined}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {catalog?.stale ? (
          <div className="callout callout--warning">
            <AlertTriangle />
            <span>
              Showing the last copy of Horizon’s registry — {catalog.error || 'the registry could not be reached'}.
            </span>
          </div>
        ) : null}
        {catalogError ? <div className="callout callout--danger">{catalogError}</div> : null}

        {catalogLoading && !catalog ? (
          <div className="mods-loading">
            <Spinner /> Reading Horizon’s registry…
          </div>
        ) : !projects.length ? (
          <div className="panel">
            <EmptyState
              icon={<Search />}
              title="No matching projects"
              description={query ? `Nothing in Horizon’s registry matches “${query}”.` : 'Nothing is published for this type on Minecraft 26.3 yet.'}
            />
          </div>
        ) : (
          <div className="mod-grid">
            {projects.map((project) => {
              const latest = project.versions[0]
              const isInstalled = installedIds.has(project.id)
              const numbered = latest?.version ? `v${latest.version}` : null
              return (
                <article key={project.id} className="mod-card">
                  <div className="mod-card__top">
                    <span className="mod-card__icon">
                      {project.icon ? <img src={project.icon} alt="" loading="lazy" /> : <Package />}
                    </span>
                    <div className="mod-card__identity">
                      <h3>{project.name}</h3>
                      <span className="mod-card__author">
                        by {project.authors.join(', ') || 'unknown'} · {formatDownloads(project.downloads)} downloads
                      </span>
                    </div>
                  </div>
                  <p className="mod-card__description">{project.summary || project.description.slice(0, 180)}</p>
                  <div className="mod-card__footer">
                    <span className="mod-card__tags">
                      <span>{KIND_LABELS[project.kind]}</span>
                      {numbered ? <span>{numbered}</span> : null}
                      {project.official ? <span>Horizon</span> : null}
                    </span>
                    {isInstalled ? (
                      <span className="mod-card__installed">Installed</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="subtle"
                        icon={installing === project.id ? <Loader2 className="spin" /> : <Download />}
                        disabled={installing !== null}
                        onClick={() => void installProject(project)}
                      >
                        {installing === project.id ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const nativeMods = grouped.get('native') ?? []
  const nativeJob = native?.job ?? null
  const building = nativeJob?.status === 'running' || nativeJob?.status === 'cancelling'

  return (
    <div className="horizon-mods">
      {viewSwitch}

      <div className="row gap-2 horizon-mods__toolbar">
        <Button icon={<Upload />} disabled={importing} loading={importing} onClick={() => void importMod()}>
          Import mod
        </Button>
        <Button icon={<FolderOpen />} onClick={() => void openFolder('content')}>
          Mods folder
        </Button>
        <Button icon={<RefreshCw />} loading={loading} onClick={() => void load()}>
          Refresh
        </Button>
        <Button variant="primary" icon={<Compass />} onClick={() => setView('browse')}>
          Browse Horizon mods
        </Button>
      </div>

      <p className="horizon-mods__path">
        <FolderOpen /> {data?.gameHome ?? 'Horizon game folder'}
      </p>

      <section className="panel horizon-native">
        <div className="panel-head">
          <div>
            <h2 className="panel-head__title">
              <Hammer /> Native build
            </h2>
            <p className="panel-head__subtitle">
              {native
                ? `${native.enabledNativeMods} native mod${native.enabledNativeMods === 1 ? '' : 's'} enabled · ${
                    native.rust.available
                      ? native.rust.version || 'Rust ready'
                      : native.rust.canDownload
                        ? 'Rust downloads on first build'
                        : 'Rust unavailable'
                  }${native.baseTag ? ` · from ${native.baseTag}` : ''}`
                : 'Checking the Rust toolchain…'}
            </p>
          </div>
          <Button
            variant="primary"
            icon={<Hammer />}
            loading={building}
            disabled={!native?.canBuild || building}
            onClick={() => void buildNative()}
          >
            {building ? 'Building…' : 'Build native game'}
          </Button>
        </div>
        <div className="panel-body">
          {native && !native.rust.available ? (
            <div className="callout callout--info">
              <Download />
              <div className="grow">
                <strong>Rust is installed with the first build.</strong>
                <div className="text-dim">
                  Aqua downloads a Rust toolchain into its own folder (about 600 MB on disk). Nothing is installed
                  system-wide or added to your PATH.
                </div>
              </div>
            </div>
          ) : null}
          {native?.reason && !building ? <p className="horizon-mods__note">{native.reason}</p> : null}
          {nativeJob ? (
            <div className="horizon-native__job">
              <div className="horizon-native__job-head">
                <strong>{nativeJob.stage}</strong>
                <div className="row gap-2">
                  <button type="button" className="link-button" onClick={() => navigate('tasks')}>
                    Open Tasks
                  </button>
                  {building ? (
                    <Button size="sm" variant="ghost" onClick={() => void cancelBuild()}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              {nativeJob.message ? <span className="text-dim">{nativeJob.message}</span> : null}
              {nativeJob.logTail?.length ? (
                <pre className="horizon-native__log">{nativeJob.logTail.slice(-6).join('\n')}</pre>
              ) : null}
            </div>
          ) : null}
          <p className="text-dim">
            Compiles the enabled native mods into Horizon at the pinned commit. Aqua downloads Rust, Horizon’s source,
            and the crates into its own folder; the first build can take 20–30 minutes. The finished build is playable
            from Installations → Horizon.
          </p>
        </div>
      </section>

      {error ? <div className="callout callout--danger">{error}</div> : null}

      {nativeMods.length ? (
        <div className="callout callout--warning">
          <AlertTriangle />
          <div className="grow">
            <strong>Native mods need a build that includes them.</strong>
            <div className="text-dim">
              Horizon’s native mods are Rust code compiled into the game. Turn on the ones you want, then use
              <strong> Build native game </strong>above; the finished build appears under Installations → Horizon.
            </div>
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mods-loading">
          <Spinner /> Reading Horizon’s mod folders…
        </div>
      ) : !data?.mods.length ? (
        <div className="panel">
          <EmptyState
            icon={<Package />}
            title="No Horizon mods installed"
            description="Browse Horizon’s registry in the launcher, or import a .hnmod, .hmod, or resource pack you already have."
          >
            <Button variant="primary" icon={<Compass />} onClick={() => setView('browse')}>
              Browse Horizon mods
            </Button>
            <Button icon={<Upload />} onClick={() => void importMod()} loading={importing}>
              Import mod
            </Button>
          </EmptyState>
        </div>
      ) : (
        GROUPS.map((group) => {
          const mods = grouped.get(group.kind) ?? []
          if (!mods.length) return null
          return (
            <section className="panel mods-installed" key={group.kind}>
              <div className="panel-head">
                <div>
                  <h2 className="panel-head__title">
                    {groupIcon(group.kind)} {group.label}
                  </h2>
                  <p className="panel-head__subtitle">
                    {mods.length} file{mods.length === 1 ? '' : 's'} · {group.description}
                  </p>
                </div>
                <button type="button" className="link-button" onClick={() => void openFolder(group.kind)}>
                  <FolderOpen /> Open {group.folder}
                </button>
              </div>
              <div className="panel-body">
                {mods.map((mod) => (
                  <article className="installed-mod" key={`${mod.kind}-${mod.filename}`}>
                    <span className="installed-mod__icon">{groupIcon(mod.kind)}</span>
                    <div className="installed-mod__copy">
                      <strong>
                        {mod.title}
                        {mod.version ? <span className="installed-mod__version"> {mod.version}</span> : null}
                      </strong>
                      <span>
                        {mod.filename} · {formatBytes(mod.size)} · {relativeTime(mod.modified)}
                      </span>
                      {mod.note ? <span className="horizon-mods__note">{mod.note}</span> : null}
                    </div>
                    {mod.kind === 'resourcepack' ? (
                      <span className="horizon-mod-kind">Always on</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={mod.enabled ? 'subtle' : 'ghost'}
                        disabled={busy === mod.filename}
                        onClick={() => void toggleMod(mod)}
                      >
                        {mod.enabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    )}
                    <IconButton
                      label={`Remove ${mod.title}`}
                      size="sm"
                      disabled={busy === mod.filename}
                      onClick={() => setDeleteTarget(mod)}
                    >
                      <Trash2 />
                    </IconButton>
                  </article>
                ))}
              </div>
            </section>
          )
        })
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Horizon mod?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.title}</strong> will be deleted from Horizon’s{' '}
            {deleteTarget ? GROUPS.find((group) => group.kind === deleteTarget.kind)?.folder : 'mods'} folder.
          </>
        }
        confirmLabel="Delete mod"
        loading={busy === deleteTarget?.filename}
        onCancel={() => (busy ? undefined : setDeleteTarget(null))}
        onConfirm={() => void removeMod()}
      />
    </div>
  )
}
