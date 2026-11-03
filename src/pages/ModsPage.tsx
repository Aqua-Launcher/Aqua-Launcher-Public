import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  Download,
  FolderOpen,
  Gem,
  Info,
  Loader2,
  Package,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { contentTypeOption } from '../lib/contentTypes'
import { formatBytes, relativeTime } from '../lib/format'
import { FILTER_CATEGORIES, FILTER_ENVIRONMENTS, FILTER_LICENSES, FILTER_LOADERS, FILTER_SORTS } from '../lib/modrinthFilters'
import { useLauncher } from '../state/LauncherProvider'
import type {
  ContentConflictsResult,
  ContentFilterEntry,
  ContentFilterEnvironment,
  ContentFilterSort,
  InstalledMod,
  ModrinthContentType,
  ModrinthHit,
  ModrinthSearchResult,
  ModUpdatesResult,
  WorldSummary,
} from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { BedrockAddonsPanel } from '../components/bedrock/BedrockAddonsPanel'
import { HorizonModsPanel } from '../components/horizon/HorizonModsPanel'
import { ModRetargetDialog } from '../components/mods/ModRetargetDialog'
import { ModDetailDrawer } from '../components/mods/ModDetailDrawer'
import { ModFileInspector } from '../components/mods/ModFileInspector'
import { ContentIssuesDrawer } from '../components/mods/ContentIssuesDrawer'
import { Button, EmptyState, IconButton, Spinner, cx } from '../components/ui/primitives'
import { ConfirmDialog, Modal } from '../components/ui/overlays'

const MODRINTH_TITLE = <img className="page-header__logo" src="artwork/modrinth.svg" alt="Modrinth" />

function EditionSwitch({
  edition,
  onChange,
}: {
  edition: 'java' | 'bedrock' | 'horizon'
  onChange: (edition: 'java' | 'bedrock' | 'horizon') => void
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
        aria-selected={edition === 'horizon'}
        className={edition === 'horizon' ? 'is-active' : undefined}
        onClick={() => onChange('horizon')}
      >
        <Package /> Horizon Mods
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

type PageFilters = {
  categories: string[]
  environment: ContentFilterEnvironment
  license: string | null
  openSource: boolean
  sort: ContentFilterSort
  gameVersion: string | null
  loader: string | null
}

function defaultFilters(
  profileVersion: string | null,
  contentType: ModrinthContentType,
  profileLoader: string,
): PageFilters {
  return {
    categories: [],
    environment: 'any',
    license: null,
    openSource: false,
    sort: 'relevance',
    gameVersion: contentType === 'modpack' ? null : profileVersion,
    loader: contentType === 'mod' ? profileLoader : null,
  }
}

function formatDownloads(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function ModsPage() {
  const {
    route,
    selectedInstallation,
    settings,
    saveSettings,
    versions: versionManifest,
    openInstallDialog,
    pushToast,
    refreshInstallations,
    navigate,
  } = useLauncher()

  const loader = selectedInstallation?.loader?.type ?? 'vanilla'
  const moddable = loader !== 'vanilla'
  const installationId = selectedInstallation?.id ?? null
  const profileVersion = selectedInstallation?.versionId ?? null

  // The sidebar's Extra content entry is the content-type picker.
  const contentType = route.params?.contentType ?? 'mod'
  const typeOption = contentTypeOption(contentType)
  const isModpack = contentType === 'modpack'
  const isDatapack = contentType === 'datapack'
  const needsLoader = contentType === 'mod'

  const [edition, setEdition] = useState<'java' | 'bedrock' | 'horizon'>('java')
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
  const [detailHit, setDetailHit] = useState<ModrinthHit | null>(null)
  const [inspectFile, setInspectFile] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<ContentConflictsResult | null>(null)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [worlds, setWorlds] = useState<WorldSummary[]>([])
  const [selectedWorld, setSelectedWorld] = useState<string | null>(null)
  const [worldPickerHit, setWorldPickerHit] = useState<ModrinthHit | null>(null)
  const [worldPickerChoice, setWorldPickerChoice] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<PageFilters>(() => defaultFilters(profileVersion, contentType, loader))
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingFile, setUpdatingFile] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const checkedKey = useRef<string | null>(null)
  const commandActionHandled = useRef(false)
  const updateSeq = useRef(0)
  const searchSeq = useRef(0)
  const filtersKey = useRef<string | null>(null)
  const profileKey = useRef(`${installationId ?? 'none'}:${profileVersion ?? ''}:${loader}:${contentType}`)

  useEffect(() => {
    if (!installationId || !isDatapack) {
      setWorlds([])
      setSelectedWorld(null)
      return
    }
    let cancelled = false
    void api.worlds
      .list(installationId)
      .then((payload) => {
        if (cancelled) return
        setWorlds(payload.worlds)
        setSelectedWorld((current) =>
          current && payload.worlds.some((world) => world.folder === current)
            ? current
            : payload.worlds.length === 1
              ? payload.worlds[0].folder
              : null,
        )
      })
      .catch((error) => {
        if (!cancelled) {
          setWorlds([])
          pushToast({ level: 'error', title: 'Could not read worlds', message: getErrorMessage(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [installationId, isDatapack, pushToast])

  const installedProjects = useMemo(() => {
    const set = new Set<string>()
    for (const item of installed) if (item.projectId) set.add(item.projectId)
    return set
  }, [installed])

  const contentIssues = useMemo(() => {
    const byModId = new Map<string, string[]>()
    const wrongLoader = new Set<string>()
    for (const mod of installed) {
      const modId = mod.metadata?.modId
      if (modId) byModId.set(modId, [...(byModId.get(modId) ?? []), mod.filename])
      if (contentType === 'mod' && mod.metadata?.loader && mod.metadata.loader !== loader) {
        wrongLoader.add(mod.filename)
      }
    }
    const duplicateIds = new Set<string>()
    for (const filenames of byModId.values()) {
      if (filenames.length > 1) for (const filename of filenames) duplicateIds.add(filename)
    }
    return { duplicateIds, wrongLoader }
  }, [contentType, installed, loader])

  useEffect(() => {
    if (!installationId || isModpack || isDatapack) {
      setConflicts(null)
      return
    }
    let cancelled = false
    void api.content
      .conflicts(installationId, contentType)
      .then((result) => {
        if (!cancelled) setConflicts(result)
      })
      .catch(() => {
        if (!cancelled) setConflicts(null)
      })
    return () => {
      cancelled = true
    }
  }, [contentType, installationId, installed, isDatapack, isModpack])

  useEffect(() => {
    if (!settings) return
    const key = `${contentType}:${installationId ?? 'none'}`
    if (filtersKey.current === key) return
    filtersKey.current = key
    const saved = settings.contentFilters?.[contentType]
    setFilters({
      categories: saved?.categories ?? [],
      environment: saved?.environment ?? 'any',
      license: saved?.license ?? null,
      openSource: saved?.openSource ?? false,
      sort: saved?.sort ?? 'relevance',
      gameVersion: contentType === 'modpack' ? null : profileVersion,
      loader: contentType === 'mod' ? loader : null,
    })
  }, [contentType, installationId, loader, profileVersion, settings])

  useEffect(() => {
    const key = `${installationId ?? 'none'}:${profileVersion ?? ''}:${loader}:${contentType}`
    if (profileKey.current === key) return
    profileKey.current = key
    setFilters((current) => ({
      ...current,
      gameVersion: contentType === 'modpack' ? null : profileVersion,
      loader: contentType === 'mod' ? loader : null,
    }))
  }, [contentType, installationId, loader, profileVersion])

  useEffect(() => {
    if (!settings) return
    if (filtersKey.current !== `${contentType}:${installationId ?? 'none'}`) return
    const timer = window.setTimeout(() => {
      const next: ContentFilterEntry = {
        categories: filters.categories,
        environment: filters.environment,
        license: filters.license,
        openSource: filters.openSource,
        sort: filters.sort,
      }
      const stored = settings.contentFilters?.[contentType]
      if (stored && JSON.stringify(stored) === JSON.stringify(next)) return
      void saveSettings({
        contentFilters: { ...(settings.contentFilters ?? {}), [contentType]: next },
      }).catch((error) => {
        pushToast({ level: 'error', title: 'Could not save content filters', message: getErrorMessage(error) })
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [
    contentType,
    filters.categories,
    filters.environment,
    filters.license,
    filters.openSource,
    filters.sort,
    installationId,
    pushToast,
    saveSettings,
    settings,
  ])

  const loadInstalled = useCallback(async () => {
    if (!installationId || isModpack) return
    if (isDatapack && !selectedWorld) {
      setInstalled([])
      setContentDirectory('')
      return
    }
    setInstalledLoading(true)
    try {
      const payload = await api.mods.list(installationId, contentType, selectedWorld)
      setInstalled(payload.items)
      setContentDirectory(payload.directory ?? '')
    } catch (error) {
      pushToast({ level: 'error', title: `Could not read installed ${typeOption.plural}`, message: getErrorMessage(error) })
    } finally {
      setInstalledLoading(false)
    }

  }, [contentType, installationId, isDatapack, isModpack, pushToast, selectedWorld, typeOption.plural])

  useEffect(() => {
    const refresh = () => {
      if (installationId && !isModpack) void loadInstalled()
    }
    window.addEventListener('aqua:content-imported', refresh)
    return () => window.removeEventListener('aqua:content-imported', refresh)
  }, [installationId, isModpack, loadInstalled])

  useEffect(() => {
    setInstalled([])
    setRetargetTarget(null)
    setInspectFile(null)
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
      if (!installationId || isModpack || isDatapack) return null
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
    [contentType, installationId, isDatapack, isModpack, pushToast, typeOption.plural],
  )

  useEffect(() => {
    if (route.params?.action !== 'check-updates' || commandActionHandled.current) return
    if (!installationId || isModpack || isDatapack) return
    commandActionHandled.current = true
    void checkUpdates()
  }, [checkUpdates, installationId, isDatapack, isModpack, route.params?.action])

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
        const payload = await api.mods.search(installationId, {
          query: text,
          offset,
          limit: 18,
          contentType,
          sort: filters.sort,
          categories: filters.categories,
          environment: filters.environment,
          license: filters.license,
          openSource: filters.openSource,
          gameVersion: isModpack ? null : filters.gameVersion,
          loader: contentType === 'mod' ? filters.loader : null,
        })
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
    [contentType, filters, installationId, isModpack, moddable, needsLoader],
  )

  useEffect(() => {
    if (!installationId && !isModpack) return
    if (needsLoader && !moddable) return
    // Invalidate any response still in flight before the debounce fires.
    searchSeq.current += 1
    const timer = window.setTimeout(() => void runSearch(query, 0), query ? 400 : 0)
    return () => window.clearTimeout(timer)
  }, [query, contentType, installationId, isModpack, moddable, needsLoader, runSearch])

  const performInstall = async (hit: ModrinthHit, worldFolder: string | null) => {
    if (!installationId) return
    setInstalling(hit.id)
    try {
      const result = await api.mods.install(installationId, hit.id, null, contentType, worldFolder)
      const warning = result.warnings?.[0]
      pushToast({
        level: warning ? 'warning' : 'success',
        title: `Installed ${hit.title}`,
        message:
          warning ||
          (result.installed.length > 1
            ? `${result.installed.length} files including required dependencies`
            : result.installed[0]?.filename),
      })
      await loadInstalled()
    } catch (error) {
      pushToast({ level: 'error', title: `Could not install ${hit.title}`, message: getErrorMessage(error) })
    } finally {
      setInstalling(null)
    }
  }

  const installContent = async (hit: ModrinthHit) => {
    if (!installationId) return
    if (!isDatapack) {
      await performInstall(hit, null)
      return
    }
    if (!worlds.length) {
      pushToast({
        level: 'error',
        title: 'No world to install into',
        message: 'Create or open a world in Minecraft first, then return here.',
      })
      return
    }
    const target = selectedWorld ?? (worlds.length === 1 ? worlds[0].folder : null)
    if (target) {
      await performInstall(hit, target)
      return
    }
    setWorldPickerChoice(worlds[0].folder)
    setWorldPickerHit(hit)
  }

  const installModpack = async (hit: ModrinthHit) => {
    setInstallingPack(hit.id)
    try {
      const result = await api.mods.installModpack(hit.id)
      await refreshInstallations()
      navigate('tasks')
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
      await api.mods.toggle(installationId, mod.filename, contentType, selectedWorld)
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
      const result = await api.mods.update(installationId, mod.filename, update.latestVersionId, contentType, selectedWorld)
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
        await api.mods.update(installationId, update.filename, update.latestVersionId, contentType, selectedWorld)
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
      await api.mods.remove(installationId, mod.filename, contentType, selectedWorld)
      setDeleteTarget(null)
      if (inspectFile === mod.filename) setInspectFile(null)
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
      await api.mods.openFolder(installationId, contentType, selectedWorld)
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

  if (edition === 'horizon') {
    return (
      <div className="page">
        <PageHeader
          title="Extra content"
          subtitle="Browse playhorizon.dev in the launcher and manage the mods, native bundles, and resource packs Horizon loads."
        />
        <EditionSwitch edition={edition} onChange={setEdition} />
        <HorizonModsPanel />
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
        }${selectedInstallation.loader?.version ? ` ${selectedInstallation.loader.version}` : ''}${
          isDatapack && selectedWorld ? ` · ${selectedWorld}` : ''
        }`
      : `No profile selected · ${loaderLabel}`

  const gameVersionOptions = useMemo(() => {
    const ids = (versionManifest?.versions ?? [])
      .filter((version) => version.type === 'release')
      .map((version) => version.id)
    if (profileVersion && !ids.includes(profileVersion)) ids.unshift(profileVersion)
    if (filters.gameVersion && !ids.includes(filters.gameVersion)) ids.unshift(filters.gameVersion)
    return ids
  }, [filters.gameVersion, profileVersion, versionManifest])

  const categoryOptions = FILTER_CATEGORIES[contentType]
  const activeFilterLabels = [
    ...categoryOptions.filter((category) => filters.categories.includes(category.id)).map((category) => category.label),
    filters.environment !== 'any'
      ? `${FILTER_ENVIRONMENTS.find((environment) => environment.id === filters.environment)?.label ?? filters.environment} side`
      : null,
    filters.license ? FILTER_LICENSES.find((license) => license.id === filters.license)?.label ?? filters.license : null,
    filters.openSource ? 'open source' : null,
    !isModpack && filters.gameVersion !== profileVersion
      ? filters.gameVersion
        ? `Minecraft ${filters.gameVersion}`
        : 'all Minecraft versions'
      : null,
    contentType === 'mod' && filters.loader !== loader
      ? filters.loader
        ? FILTER_LOADERS.find((entry) => entry.id === filters.loader)?.label ?? filters.loader
        : 'any loader'
      : null,
  ].filter((label): label is string => Boolean(label))
  const activeFilterCount = activeFilterLabels.length + (filters.sort !== 'relevance' ? 1 : 0)
  const clearFilters = () => setFilters(defaultFilters(profileVersion, contentType, loader))

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
              <Button
                icon={<FolderOpen />}
                onClick={() => void openContentFolder()}
                disabled={isDatapack && !selectedWorld}
              >
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
        {isDatapack ? (
          <label className="mods-filter-field">
            <span>World</span>
            <span className="select-wrap">
              <select
                className="select"
                value={selectedWorld ?? ''}
                onChange={(event) => setSelectedWorld(event.target.value || null)}
              >
                <option value="">{worlds.length ? 'Choose a world…' : 'No worlds found'}</option>
                {worlds.map((world) => (
                  <option key={world.folder} value={world.folder}>
                    {world.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ) : null}
        <span className="mods-context">{contextLabel}</span>
      </div>

      <div className="mods-filters">
        <div className="mods-filters__toggle">
          <Button
            size="sm"
            variant={filtersOpen ? 'subtle' : 'ghost'}
            icon={<SlidersHorizontal />}
            aria-expanded={filtersOpen}
            aria-controls="mods-filter-panel"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          {activeFilterCount ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={clearFilters}>
              Clear all
            </Button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="mods-filters__panel" id="mods-filter-panel">
            <label className="mods-filter-field">
              <span>Sort</span>
              <span className="select-wrap">
                <select
                  className="select"
                  value={filters.sort}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, sort: event.target.value as ContentFilterSort }))
                  }
                >
                  {FILTER_SORTS.map((sort) => (
                    <option key={sort.id} value={sort.id}>
                      {sort.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            {!isModpack ? (
              <label className="mods-filter-field">
                <span>Minecraft version</span>
                <span className="select-wrap">
                  <select
                    className="select"
                    value={filters.gameVersion ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, gameVersion: event.target.value || null }))
                    }
                  >
                    <option value="">All versions</option>
                    {gameVersionOptions.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : null}

            {contentType === 'mod' ? (
              <label className="mods-filter-field">
                <span>Mod loader</span>
                <span className="select-wrap">
                  <select
                    className="select"
                    value={filters.loader ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, loader: event.target.value || null }))
                    }
                  >
                    <option value="">Any loader</option>
                    {FILTER_LOADERS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : null}

            <div className="mods-filter-field">
              <span>Environment</span>
              <div className="segmented mods-filter-segmented" role="group" aria-label="Environment">
                {FILTER_ENVIRONMENTS.map((environment) => (
                  <button
                    key={environment.id}
                    type="button"
                    aria-pressed={filters.environment === environment.id}
                    className={cx(filters.environment === environment.id && 'is-active')}
                    onClick={() => setFilters((current) => ({ ...current, environment: environment.id }))}
                  >
                    {environment.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="mods-filter-field">
              <span>License</span>
              <span className="select-wrap">
                <select
                  className="select"
                  value={filters.license ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, license: event.target.value || null }))
                  }
                >
                  <option value="">Any license</option>
                  {FILTER_LICENSES.map((license) => (
                    <option key={license.id} value={license.id}>
                      {license.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            <label className="mods-filter-check">
              <input
                type="checkbox"
                checked={filters.openSource}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, openSource: event.target.checked }))
                }
              />
              <span>Open source only</span>
            </label>

            <div className="mods-filter-categories">
              <span>Categories</span>
              <div className="mods-filter-chips">
                {categoryOptions.map((category) => {
                  const selected = filters.categories.includes(category.id)
                  return (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={selected}
                      className={cx('filter-chip', selected && 'is-active')}
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          categories: selected
                            ? current.categories.filter((entry) => entry !== category.id)
                            : [...current.categories, category.id],
                        }))
                      }
                    >
                      {category.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {!isModpack && filters.gameVersion === null ? (
              <span className="mods-filters__note">
                Browsing every Minecraft version. Installs still target {profileVersion ?? 'this profile'}.
              </span>
            ) : null}
          </div>
        ) : null}
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
          {conflicts && conflicts.total > 0 ? (
            <div className="mod-issues">
              <span className="mod-issues__icon">
                <AlertTriangle />
              </span>
              <span className="mod-issues__copy">
                <strong>
                  {conflicts.total} content issue{conflicts.total === 1 ? '' : 's'} found
                </strong>
                <small>
                  Missing dependencies, duplicate IDs, loader and Minecraft mismatches, and known conflicts are listed
                  in the issue report.
                </small>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setIssuesOpen(true)}>
                View issues
              </Button>
            </div>
          ) : null}
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
                  const metadata = mod.metadata
                  const displayName = metadata?.name || (metadata ? mod.title : mod.filename)
                  const version = metadata?.version || mod.versionNumber
                  const authors = metadata?.authors?.join(', ')
                  const wrongLoader = contentIssues.wrongLoader.has(mod.filename)
                  const duplicateId = contentIssues.duplicateIds.has(mod.filename)
                  return (
                  <li key={mod.filename} className={cx('mod-row', !mod.enabled && 'is-disabled')}>
                    <span className="mod-row__icon">
                      {mod.iconUrl ? <img src={mod.iconUrl} alt="" loading="lazy" /> : <Package />}
                    </span>
                    <span className="mod-row__copy">
                      <span className="mod-row__title">
                        {displayName}
                        {version ? <span className="mod-row__version">{version}</span> : null}
                        {!mod.enabled ? <span className="mod-row__flag">Disabled</span> : null}
                        {!metadata ? <span className="mod-row__flag">No metadata</span> : null}
                        {wrongLoader ? <span className="mod-row__flag mod-row__flag--danger">Wrong loader</span> : null}
                        {duplicateId ? <span className="mod-row__flag">Duplicate ID</span> : null}
                        {update ? <span className="mod-row__flag mod-row__flag--update">Update</span> : null}
                      </span>
                      <span className="mod-row__meta">
                        {mod.filename} · {formatBytes(mod.size)}
                        {mod.modified ? ` · ${relativeTime(mod.modified)}` : ''}
                        {authors ? ` · ${authors}` : ''}
                        {metadata?.loader ? ` · ${LOADER_LABELS[metadata.loader] || metadata.loader}` : ''}
                        {metadata?.mcRange ? ` · MC ${metadata.mcRange}` : ''}
                        {update
                          ? ` · ${update.currentVersionNumber || 'installed'} → ${update.latestVersionNumber || 'latest'}`
                          : ''}
                      </span>
                    </span>
                    <span className="mod-row__actions">
                      {!isDatapack ? (
                        <IconButton
                          label={`Inspect ${displayName}`}
                          size="sm"
                          onClick={() => setInspectFile(mod.filename)}
                          disabled={busyFile === mod.filename || updatingAll || updatingFile === mod.filename}
                        >
                          <Info />
                        </IconButton>
                      ) : null}
                      {contentType === 'mod' ? (
                        <IconButton
                          label={`Convert ${displayName} to Minecraft ${selectedInstallation?.versionId ?? 'this profile'}`}
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
                        label={mod.enabled ? `Disable ${displayName}` : `Enable ${displayName}`}
                        size="sm"
                        onClick={() => void toggleMod(mod)}
                        disabled={busyFile === mod.filename || updatingAll || updatingFile === mod.filename}
                      >
                        <Power />
                      </IconButton>
                      <IconButton
                        label={`Delete ${displayName}`}
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
                activeFilterLabels.length
                  ? `Nothing on Modrinth matches “${query}” with ${activeFilterLabels.join(', ')} selected.`
                  : isModpack
                    ? `Nothing on Modrinth matches “${query}”.`
                    : `Nothing on Modrinth matches “${query}” for this loader and Minecraft version.`
              }
            >
              {activeFilterLabels.length ? (
                <Button size="sm" variant="subtle" icon={<RotateCcw />} onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </EmptyState>
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
                    <Button size="sm" variant="ghost" onClick={() => setDetailHit(hit)}>
                      Details
                    </Button>
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

      {inspectFile ? (
        <ModFileInspector
          installationId={installationId}
          contentType={contentType}
          filename={inspectFile}
          onClose={() => setInspectFile(null)}
        />
      ) : null}

      {issuesOpen && conflicts && installationId ? (
        <ContentIssuesDrawer
          conflicts={conflicts}
          installationId={installationId}
          contentType={contentType}
          onClose={() => setIssuesOpen(false)}
          onChanged={loadInstalled}
        />
      ) : null}

      {detailHit ? (
        <ModDetailDrawer
          projectId={detailHit.id}
          hit={detailHit}
          contentType={contentType}
          installationId={installationId}
          gameVersion={selectedInstallation?.versionId ?? null}
          loader={loader}
          worldFolder={isDatapack ? selectedWorld : null}
          onClose={() => setDetailHit(null)}
          onInstalled={loadInstalled}
        />
      ) : null}

      <Modal
        open={Boolean(worldPickerHit)}
        onClose={() => setWorldPickerHit(null)}
        title="Choose a world"
        subtitle="Datapacks live inside one world. Pick where this pack should be installed."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWorldPickerHit(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!worldPickerChoice}
              onClick={() => {
                const hit = worldPickerHit
                const world = worldPickerChoice
                setWorldPickerHit(null)
                if (hit && world) {
                  setSelectedWorld(world)
                  void performInstall(hit, world)
                }
              }}
            >
              Install datapack
            </Button>
          </>
        }
      >
        <div className="world-picker">
          {worlds.map((world) => (
            <label key={world.folder} className="world-picker__option">
              <input
                type="radio"
                name="datapack-world"
                value={world.folder}
                checked={worldPickerChoice === world.folder}
                onChange={() => setWorldPickerChoice(world.folder)}
              />
              <span>
                <strong>{world.name}</strong>
                <small>
                  {world.folder} · Minecraft {world.versionName || selectedInstallation?.versionId || 'unknown'}
                </small>
              </span>
            </label>
          ))}
        </div>
      </Modal>

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
