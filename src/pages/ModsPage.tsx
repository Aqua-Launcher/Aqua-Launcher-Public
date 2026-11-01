import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  Download,
  FolderOpen,
  Gem,
  Loader2,
  Package,
  Power,
  RefreshCw,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { contentTypeOption } from '../lib/contentTypes'
import { formatBytes, relativeTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { InstalledMod, ModrinthHit, ModrinthSearchResult, ModUpdatesResult } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { BedrockAddonsPanel } from '../components/bedrock/BedrockAddonsPanel'
import { ModRetargetDialog } from '../components/mods/ModRetargetDialog'
import { Button, EmptyState, IconButton, Spinner, cx } from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/overlays'

const MODRINTH_TITLE = <img className="page-header__logo" src="artwork/modrinth.svg" alt="Modrinth" />

function EditionSwitch({
  edition,
  onChange,
}: {
  edition: 'java' | 'bedrock'
  onChange: (edition: 'java' | 'bedrock') => void
}) {
  return (
    <div className="segmented edition-switch" role="tablist" aria-label="Edition">
      <button
        type="button"
        role="tab"
        aria-selected={edition === 'java'}
        className={edition === 'java' ? 'is-active' : undefined}
        onClick={() => onChange('java')}
      >
        <Boxes /> Java Edition
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={edition === 'bedrock'}
        className={edition === 'bedrock' ? 'is-active' : undefined}
        onClick={() => onChange('bedrock')}
      >
        <Gem /> Bedrock Edition
      </button>
    </div>
  )
}

const LOADER_LABELS: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

function formatDownloads(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function ModsPage() {
  const { route, selectedInstallation, openInstallDialog, pushToast, refreshInstallations, setDownloadsOpen } =
    useLauncher()

  const loader = selectedInstallation?.loader?.type ?? 'vanilla'
  const moddable = loader !== 'vanilla'
  const installationId = selectedInstallation?.id ?? null

  // The sidebar's Extra content entry is the content-type picker.
  const contentType = route.params?.contentType ?? 'mod'
  const typeOption = contentTypeOption(contentType)
  const isModpack = contentType === 'modpack'
  const needsLoader = contentType === 'mod'

  const [edition, setEdition] = useState<'java' | 'bedrock'>('java')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ModrinthSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<InstalledMod[]>([])
  const [contentDirectory, setContentDirectory] = useState<string>('')
  const [installedLoading, setInstalledLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installingPack, setInstallingPack] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InstalledMod | null>(null)
  const [retargetTarget, setRetargetTarget] = useState<InstalledMod | null>(null)
  const [updateState, setUpdateState] = useState<ModUpdatesResult | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingFile, setUpdatingFile] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const checkedKey = useRef<string | null>(null)
  const updateSeq = useRef(0)
  const searchSeq = useRef(0)

  const installedProjects = useMemo(() => {
    const set = new Set<string>()
    for (const item of installed) if (item.projectId) set.add(item.projectId)
    return set
  }, [installed])

  const loadInstalled = useCallback(async () => {
    if (!installationId || isModpack) return
    setInstalledLoading(true)
    try {
      const payload = await api.mods.list(installationId, contentType)
      setInstalled(payload.items)
      setContentDirectory(payload.directory ?? '')
    } catch (error) {
      pushToast({ level: 'error', title: `Could not read installed ${typeOption.plural}`, message: getErrorMessage(error) })
    } finally {
      setInstalledLoading(false)
    }
  }, [contentType, installationId, isModpack, pushToast, typeOption.plural])

  useEffect(() => {
    setInstalled([])
    setRetargetTarget(null)
    setUpdateState(null)
    checkedKey.current = null
    updateSeq.current += 1
    setResults(null)
    setSearchError(null)
    setQuery('')
    if (installationId && !isModpack) void loadInstalled()
  }, [installationId, contentType, isModpack, loadInstalled])

  const checkUpdates = useCallback(
    async (silent = false) => {
      if (!installationId || isModpack) return null
      const seq = ++updateSeq.current
      setCheckingUpdates(true)
      try {
        const payload = await api.mods.checkUpdates(installationId, contentType)
        if (seq !== updateSeq.current) return null
        setUpdateState(payload)
        if (!silent) {
          pushToast(
            payload.updates.length
              ? {
                  level: 'info',
                  title: `${payload.updates.length} update${payload.updates.length === 1 ? '' : 's'} available`,
                  message: `Checked ${payload.checked} installed ${typeOption.plural} against Modrinth.`,
                }
              : {
                  level: 'success',
                  title: `All ${typeOption.plural} are up to date`,
                  message: `Checked ${payload.checked} Modrinth file${payload.checked === 1 ? '' : 's'}.`,
                },
          )
        }
        return payload
      } catch (error) {
        if (seq === updateSeq.current && !silent) {
          pushToast({ level: 'error', title: 'Could not check for updates', message: getErrorMessage(error) })
        }
        return null
      } finally {
        if (seq === updateSeq.current) setCheckingUpdates(false)
      }
    },
    [contentType, installationId, isModpack, pushToast, typeOption.plural],
  )

  useEffect(() => {
    if (!installationId || isModpack || installedLoading || !installed.length) return
    const key = `${installationId}:${contentType}`
    if (checkedKey.current === key) return
    checkedKey.current = key
    void checkUpdates(true)
  }, [checkUpdates, contentType, installed.length, installedLoading, installationId, isModpack])

  const runSearch = useCallback(
    async (text: string, offset = 0) => {
      // Modpacks are installed as their own profile, so they need no selected one.
      if (!installationId && !isModpack) return
      if (needsLoader && !moddable) return
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(null)
      try {
        const payload = await api.mods.search(installationId, { query: text, offset, limit: 18, contentType })
        if (seq !== searchSeq.current) return
        setResults((current) =>
          offset > 0 && current ? { ...payload, hits: [...current.hits, ...payload.hits], offset: 0 } : payload,
        )
      } catch (error) {
        if (seq === searchSeq.current) setSearchError(getErrorMessage(error))
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    [contentType, installationId, isModpack, moddable, needsLoader],
  )

  useEffect(() => {
    if (!installationId && !isModpack) return
    if (needsLoader && !moddable) return
    const timer = window.setTimeout(() => void runSearch(query, 0), query ? 400 : 0)
    return () => window.clearTimeout(timer)
  }, [query, contentType, installationId, isModpack, moddable, needsLoader, runSearch])

  const installContent = async (hit: ModrinthHit) => {
    if (!installationId) return
    setInstalling(hit.id)
    try {
      const result = await api.mods.install(installationId, hit.id, null, contentType)
      pushToast({
        level: 'success',
        title: `Installed ${hit.title}`,
        message:
          result.installed.length > 1
            ? `${result.installed.length} files including required dependencies`
            : result.installed[0]?.filename,
      })
      await loadInstalled()
    } catch (error) {
      pushToast({ level: 'error', title: `Could not install ${hit.title}`, message: getErrorMessage(error) })
    } finally {
      setInstalling(null)
    }
  }

  const installModpack = async (hit: ModrinthHit) => {
    setInstallingPack(hit.id)
    try {
      const result = await api.mods.installModpack(hit.id)
      await refreshInstallations()
      setDownloadsOpen(true)
      pushToast({
        level: 'success',
        title: `${result.modpack.packName} added`,
        message: `Created ${result.installation.name} for Minecraft ${result.modpack.minecraftVersion}${
          result.modpack.loader !== 'vanilla' ? ` · ${LOADER_LABELS[result.modpack.loader] || result.modpack.loader}` : ''
        }. Game files are downloading.`,
      })
    } catch (error) {
      pushToast({ level: 'error', title: `Could not install ${hit.title}`, message: getErrorMessage(error) })
    } finally {
      setInstallingPack(null)
    }
  }

  const toggleMod = async (mod: InstalledMod) => {
    if (!installationId) return
    setBusyFile(mod.filename)
    try {
      await api.mods.toggle(installationId, mod.filename, contentType)
      await loadInstalled()
    } catch (error) {
      pushToast({ level: 'error', title: `Could not change that ${typeOption.noun}`, message: getErrorMessage(error) })
    } finally {
      setBusyFile(null)
    }
  }

  const updateMod = async (mod: InstalledMod, update: NonNullable<ModUpdatesResult['updates']>[number]) => {
    if (!installationId) return
    setUpdatingFile(mod.filename)
    try {
      const result = await api.mods.update(installationId, mod.filename, update.latestVersionId, contentType)
      setUpdateState((current) =>
        current ? { ...current, updates: current.updates.filter((item) => item.filename !== mod.filename) } : current,
      )
      await loadInstalled()
      pushToast({
        level: 'success',
        title: `Updated ${mod.title}`,
        message: result.versionNumber ? `Now on ${result.versionNumber}.` : result.filename,
      })
    } catch (error) {
      pushToast({ level: 'error', title: `Could not update ${mod.title}`, message: getErrorMessage(error) })
    } finally {
      setUpdatingFile(null)
    }
  }

  const updateAll = async () => {
    if (!installationId || !updateState?.updates.length) return
    setUpdatingAll(true)
    const pending = [...updateState.updates]
    const updatedFiles = new Set<string>()
    let succeeded = 0
    let failed = 0
    for (const update of pending) {
      try {
        await api.mods.update(installationId, update.filename, update.latestVersionId, contentType)
        updatedFiles.add(update.filename)
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    setUpdateState((current) =>
      current
        ? {
            ...current,
            updates: current.updates.filter((item) => !updatedFiles.has(item.filename)),
          }
        : current,
    )
    await loadInstalled()
    if (succeeded) {
      pushToast({
        level: failed ? 'warning' : 'success',
        title: `Updated ${succeeded} ${typeOption.noun}${succeeded === 1 ? '' : 's'}`,
        message: failed
          ? `${failed} could not be updated and remain listed below so you can retry.`
          : 'Restart Minecraft to load the new versions.',
      })
    } else if (failed) {
      pushToast({ level: 'error', title: 'No updates could be installed', message: 'Try updating the files one at a time.' })
    }
    setUpdatingAll(false)
  }

  const removeMod = async (mod: InstalledMod) => {
    if (!installationId) return
    setBusyFile(mod.filename)
    try {
      await api.mods.remove(installationId, mod.filename, contentType)
      setDeleteTarget(null)
      await loadInstalled()
      pushToast({ level: 'success', title: `Removed ${mod.title}` })
    } catch (error) {
      pushToast({ level: 'error', title: `Could not remove that ${typeOption.noun}`, message: getErrorMessage(error) })
    } finally {
      setBusyFile(null)
    }
  }

  const openContentFolder = async () => {
    if (!installationId) return
    try {
      await api.mods.openFolder(installationId, contentType)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open the folder', message: getErrorMessage(error) })
    }
  }

  if (edition === 'bedrock') {
    return (
      <div className="page">
        <PageHeader
          title="Extra content"
          subtitle="Browse Bedrock add-on sites in the launcher, or import .mcpack and .mcaddon files you already have."
        />
        <EditionSwitch edition={edition} onChange={setEdition} />
        <BedrockAddonsPanel />
      </div>
    )
  }

  if (!selectedInstallation && !isModpack) {
    return (
      <div className="page">
        <PageHeader title={MODRINTH_TITLE} subtitle="Browse Modrinth and manage the content in your profile." />
        <EditionSwitch edition={edition} onChange={setEdition} />
        <div className="panel">
          <EmptyState
            icon={<Package />}
            title="No installation selected"
            description="Pick an installation on the Home page or in Installations, then come back to add content."
          />
        </div>
      </div>
    )
  }

  if (needsLoader && !moddable) {
    return (
      <div className="page">
        <PageHeader
          title={MODRINTH_TITLE}
          subtitle={`${selectedInstallation?.name ?? 'This installation'} runs vanilla Minecraft. Resource packs, shaders and modpacks work without a loader.`}
        />
        <EditionSwitch edition={edition} onChange={setEdition} />
        <div className="panel">
          <EmptyState
            icon={<Package />}
            title="Add a mod loader first"
            description="Mods need Fabric, Quilt, Forge, or NeoForge. Add one to this installation, then install it — mods can be added to the same folder."
          >
            <Button
              variant="primary"
              icon={<Download />}
              onClick={() => selectedInstallation && openInstallDialog({ mode: 'edit', installation: selectedInstallation })}
            >
              Choose a mod loader
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  const totalHits = results?.total ?? 0
  const canLoadMore = Boolean(results && results.hits.length < totalHits)
  const loaderLabel = LOADER_LABELS[loader] || loader
  const contextLabel = isModpack
    ? 'Modpacks install as a new installation with their own Minecraft version and loader.'
    : selectedInstallation
      ? `${selectedInstallation.name} · MC ${selectedInstallation.versionId}${
          contentType === 'mod' ? ` · ${loaderLabel}` : ''
        }${selectedInstallation.loader?.version ? ` ${selectedInstallation.loader.version}` : ''}`
      : `No profile selected · ${loaderLabel}`

  return (
    <div className="page">
      <PageHeader
        title={MODRINTH_TITLE}
        subtitle={
          isModpack
            ? 'Browse Modrinth modpacks. Each install creates a separate profile you can launch right away.'
            : selectedInstallation
              ? `Browse Modrinth ${typeOption.plural} for Minecraft ${selectedInstallation.versionId}${
                  contentType === 'mod' ? ` on ${loaderLabel}` : ''
                }.`
              : `Browse Modrinth ${typeOption.plural}.`
        }
        actions={
          <div className="row gap-2">
            {!isModpack ? (
              <Button icon={<FolderOpen />} onClick={() => void openContentFolder()}>
                {typeOption.folderLabel}
              </Button>
            ) : null}
            {!isModpack ? (
              <Button icon={<RefreshCw />} onClick={() => void loadInstalled()} loading={installedLoading}>
                Refresh
              </Button>
            ) : null}
          </div>
        }
      />

      <EditionSwitch edition={edition} onChange={setEdition} />

      <div className="page-toolbar">
        <div className="search-input">
          <Search />
          <input
            className="input"
            placeholder={`Search Modrinth ${typeOption.plural}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search Modrinth ${typeOption.plural}`}
          />
          {query ? (
            <button type="button" className="search-input__clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X />
            </button>
          ) : null}
        </div>
        <span className="mods-context">{contextLabel}</span>
      </div>

      {!isModpack ? (
        <section className="panel mods-installed">
          <div className="panel-head">
            <div>
              <h2 className="panel-head__title">Installed {typeOption.plural}</h2>
              <p className="panel-head__subtitle">
                {installed.length
                  ? `${installed.filter((item) => item.enabled).length} enabled of ${installed.length} · ${contentDirectory}`
                  : `Nothing installed yet — search below to add your first ${typeOption.noun}.`}
                {updateState && !updateState.updates.length && updateState.checked > 0 ? ' · Up to date' : ''}
              </p>
            </div>
            {installed.length ? (
              <Button
                size="sm"
                variant="subtle"
                icon={checkingUpdates ? <Loader2 className="spin" /> : <ArrowUpCircle />}
                disabled={checkingUpdates || updatingAll}
                onClick={() => void checkUpdates()}
              >
                {checkingUpdates ? 'Checking…' : 'Check updates'}
              </Button>
            ) : null}
          </div>
          <div className="panel-body">
            {updateState && updateState.updates.length ? (
              <div className="mod-update-banner">
                <span className="mod-update-banner__icon">
                  <ArrowUpCircle />
                </span>
                <span className="mod-update-banner__copy">
                  <strong>
                    {updateState.updates.length} {typeOption.noun} update{updateState.updates.length === 1 ? '' : 's'} available
                  </strong>
                  <span>Newer Modrinth releases are compatible with Minecraft {selectedInstallation?.versionId}.</span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  loading={updatingAll}
                  disabled={checkingUpdates || Boolean(updatingFile)}
                  onClick={() => void updateAll()}
                >
                  Update all
                </Button>
              </div>
            ) : null}
            {installedLoading && !installed.length ? (
              <div className="mods-loading">
                <Spinner /> Reading {typeOption.folder} folder…
              </div>
            ) : installed.length ? (
              <ul className="mod-list">
                {installed.map((mod) => {
                  const update = updateState?.updates.find((item) => item.filename === mod.filename)
                  return (
                  <li key={mod.filename} className={cx('mod-row', !mod.enabled && 'is-disabled')}>
                    <span className="mod-row__icon">
                      {mod.iconUrl ? <img src={mod.iconUrl} alt="" loading="lazy" /> : <Package />}
                    </span>
                    <span className="mod-row__copy">
                      <span className="mod-row__title">
                        {mod.title}
                        {mod.versionNumber ? <span className="mod-row__version">{mod.versionNumber}</span> : null}
                        {!mod.enabled ? <span className="mod-row__flag">Disabled</span> : null}
                        {update ? <span className="mod-row__flag mod-row__flag--update">Update</span> : null}
                      </span>
                      <span className="mod-row__meta">
                        {mod.filename} · {formatBytes(mod.size)}
                        {mod.modified ? ` · ${relativeTime(mod.modified)}` : ''}
                        {update
                          ? ` · ${update.currentVersionNumber || 'installed'} → ${update.latestVersionNumber || 'latest'}`
                          : ''}
                      </span>
                    </span>
                    <span className="mod-row__actions">
                      {contentType === 'mod' ? (
                        <IconButton
                          label={`Convert ${mod.title} to Minecraft ${selectedInstallation?.versionId ?? 'this profile'}`}
                          size="sm"
                          onClick={() => setRetargetTarget(mod)}
                          disabled={busyFile === mod.filename || updatingAll || updatingFile === mod.filename}
                        >
                          <Wand2 />
                        </IconButton>
                      ) : null}
                      {update ? (
                        <IconButton
                          label={`Update ${mod.title} to ${update.latestVersionNumber || 'the latest version'}`}
                          size="sm"
                          onClick={() => void updateMod(mod, update)}
                          disabled={updatingAll || busyFile === mod.filename || updatingFile === mod.filename}
                        >
                          {updatingFile === mod.filename ? <Loader2 className="spin" /> : <ArrowUpCircle />}
                        </IconButton>
                      ) : null}
                      <IconButton
                        label={mod.enabled ? `Disable ${mod.title}` : `Enable ${mod.title}`}
                        size="sm"
                        onClick={() => void toggleMod(mod)}
                        disabled={busyFile === mod.filename || updatingAll || updatingFile === mod.filename}
                      >
                        <Power />
                      </IconButton>
                      <IconButton
                        label={`Delete ${mod.title}`}
                        size="sm"
                        onClick={() => setDeleteTarget(mod)}
                        disabled={busyFile === mod.filename || updatingAll || updatingFile === mod.filename}
                      >
                        <Trash2 />
                      </IconButton>
                    </span>
                  </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState
                icon={<Package />}
                title={`No ${typeOption.plural} installed`}
                description={`Search Modrinth above. Required dependencies are installed automatically.`}
              />
            )}
          </div>
        </section>
      ) : null}

      <section className="mods-browse">
        <div className="mods-browse__head">
          <h2>Browse Modrinth {typeOption.plural}</h2>
          {results ? (
            <span className="mods-browse__count">
              {totalHits.toLocaleString()} {typeOption.noun}
              {totalHits === 1 ? '' : 's'}
              {results.minecraftVersion ? ` compatible with ${results.minecraftVersion}` : ''}
              {contentType === 'mod' && results.loader ? ` on ${LOADER_LABELS[results.loader] || results.loader}` : ''}
            </span>
          ) : null}
        </div>

        {searchError ? (
          <div className="callout callout--danger">
            <AlertTriangle />
            <span>{searchError}</span>
          </div>
        ) : null}

        {searching && !results ? (
          <div className="mods-loading">
            <Spinner /> Searching Modrinth…
          </div>
        ) : results?.hits.length === 0 && !searching ? (
          <div className="panel">
            <EmptyState
              icon={<Search />}
              title={`No matching ${typeOption.plural}`}
              description={
                isModpack
                  ? `Nothing on Modrinth matches “${query}”.`
                  : `Nothing on Modrinth matches “${query}” for this loader and Minecraft version.`
              }
            />
          </div>
        ) : (
          <div className="mod-grid">
            {(results?.hits ?? []).map((hit) => {
              const isInstalled = !isModpack && installedProjects.has(hit.id)
              const busy = isModpack ? installingPack === hit.id : installing === hit.id
              const disabled = isModpack ? installingPack !== null : installing !== null
              return (
                <article key={hit.id} className="mod-card">
                  <div className="mod-card__top">
                    <span className="mod-card__icon">
                      {hit.iconUrl ? <img src={hit.iconUrl} alt="" loading="lazy" /> : <Package />}
                    </span>
                    <div className="mod-card__identity">
                      <h3>{hit.title}</h3>
                      <span className="mod-card__author">
                        by {hit.author} · {formatDownloads(hit.downloads)} downloads
                      </span>
                    </div>
                  </div>
                  <p className="mod-card__description">{hit.description}</p>
                  <div className="mod-card__footer">
                    <span className="mod-card__tags">
                      {hit.categories.slice(0, 2).map((category) => (
                        <span key={category}>{category}</span>
                      ))}
                    </span>
                    {isInstalled ? (
                      <span className="mod-card__installed">Installed</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="subtle"
                        icon={busy ? <Loader2 className="spin" /> : <Download />}
                        disabled={disabled}
                        onClick={() => void (isModpack ? installModpack(hit) : installContent(hit))}
                      >
                        {busy ? 'Installing…' : isModpack ? 'Install pack' : 'Install'}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {canLoadMore ? (
          <div className="mods-more">
            <Button
              icon={searching ? <Spinner /> : <RefreshCw />}
              onClick={() => void runSearch(query, results?.hits.length ?? 0)}
              disabled={searching}
            >
              {searching ? 'Loading…' : `Load more ${typeOption.plural}`}
            </Button>
          </div>
        ) : null}
      </section>

      <ModRetargetDialog
        installationId={installationId}
        mod={retargetTarget}
        onClose={() => setRetargetTarget(null)}
        onChanged={loadInstalled}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${typeOption.noun} file?`}
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.title}</strong> will be deleted from this profile’s{' '}
            {typeOption.folder} folder. You can install it again from Modrinth at any time.
          </>
        }
        confirmLabel={`Delete ${typeOption.noun}`}
        loading={busyFile === deleteTarget?.filename}
        onCancel={() => (busyFile ? undefined : setDeleteTarget(null))}
        onConfirm={() => deleteTarget && void removeMod(deleteTarget)}
      />
    </div>
  )
}
