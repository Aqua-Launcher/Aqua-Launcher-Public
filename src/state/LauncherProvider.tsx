import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, getErrorMessage, type EventPayloadMap } from '../lib/api'
import { analyzeServerCompatibility, type JoinWarningState } from '../lib/serverCompatibility'
import type {
  ActivityEntry,
  AppNotification,
  AuthMode,
  AuthState,
  BedrockCatalog,
  BedrockDownloadProgress,
  BedrockEdition,
  BedrockLibraryEntry,
  BedrockStatus,
  Bootstrap,
  DownloadJob,
  GameState,
  HorizonBuild,
  HorizonInstallJob,
  HorizonNativeJob,
  InstallDialogState,
  Installation,
  InstallationInput,
  JavaInfo,
  LaunchErrorState,
  LinkIntent,
  PageName,
  RouteState,
  ServerEdition,
  SessionEntry,
  Settings,
  StorageProgress,
  Toast,
  VersionManifest,
} from '../lib/types'

type AuthInputStatus = 'idle' | 'starting' | 'waiting' | 'finalizing' | 'success' | 'error'

interface PendingLaunch {
  installationId: string
  jobId: string
}

interface LauncherContextValue {
  data: Bootstrap | null
  loading: boolean
  bootError: string | null
  retryBoot: () => void
  settings: Settings | null
  installations: Installation[]
  accounts: Bootstrap['accounts'] | null
  activeAccount: Bootstrap['accounts']['accounts'][number] | null
  selectedInstallation: Installation | null
  activity: ActivityEntry[]
  sessions: SessionEntry[]
  jobs: DownloadJob[]
  activeJobs: DownloadJob[]
  game: GameState
  auth: AuthState
  versions: VersionManifest | null
  versionsLoading: boolean
  versionsError: string | null
  refreshVersions: (force?: boolean) => Promise<VersionManifest | null>
  javas: JavaInfo[]
  javaLoading: boolean
  javaError: string | null
  refreshJava: (force?: boolean) => Promise<void>
  route: RouteState
  navigate: (page: PageName, params?: RouteState['params']) => void
  toasts: Toast[]
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  notifications: AppNotification[]
  markNotificationsRead: (ids?: string[]) => Promise<void>
  clearNotifications: () => Promise<void>
  /** A validated external link or CLI action waiting for confirmation. */
  linkIntent: LinkIntent | null
  dismissLinkIntent: () => void
  /** The Horizon client install that has run this session, while it is known. */
  horizonInstallJob: HorizonInstallJob | null
  /** The Rust build that compiles Horizon's native mods into the game. */
  horizonNativeJob: HorizonNativeJob | null
  installDialog: InstallDialogState | null
  openInstallDialog: (state?: Partial<InstallDialogState>) => void
  closeInstallDialog: () => void
  setupOpen: boolean
  openSetup: () => void
  completeSetup: (extra?: Partial<Settings>) => Promise<void>
  dismissSetup: () => Promise<void>
  authOpen: boolean
  authInitialMode: AuthMode | null
  openAuth: (mode?: AuthMode) => void
  closeAuth: () => void
  beginAuth: () => Promise<void>
  signInOffline: (name: string) => Promise<void>
  cancelAuth: () => Promise<void>
  launchError: LaunchErrorState | null
  clearLaunchError: () => void
  launchingId: string | null
  bedrock: BedrockStatus | null
  bedrockLoading: boolean
  bedrockError: string | null
  refreshBedrock: (force?: boolean) => Promise<void>
  launchBedrock: (
    editionId: string,
    serverAddress?: string | null,
    options?: { keepTarget?: boolean },
  ) => Promise<boolean>
  /** The Bedrock edition the Play button launches, or null for the Java installation or Horizon. */
  bedrockTarget: BedrockEdition | null
  selectBedrockTarget: (editionId: string | null) => void
  launchHorizon: (build: HorizonBuild, options?: { keepTarget?: boolean }) => Promise<boolean>
  /** The Horizon build the Play button launches, when one is targeted. */
  horizonTarget: HorizonBuild | null
  selectHorizonTarget: (build: HorizonBuild | null) => void
  launchingHorizonTag: string | null
  bedrockVersions: BedrockCatalog | null
  bedrockVersionsLoading: boolean
  bedrockVersionsError: string | null
  bedrockLibrary: BedrockLibraryEntry[]
  bedrockDownloads: Record<string, BedrockDownloadProgress>
  refreshBedrockVersions: (force?: boolean) => Promise<void>
  downloadBedrockVersion: (version: string) => Promise<boolean>
  cancelBedrockVersion: (version: string) => Promise<void>
  removeBedrockVersion: (version: string) => Promise<void>
  openBedrockVersionFolder: (version: string) => Promise<void>
  /** Installs a downloaded MSIXVC build through Windows, replacing the current copy. */
  installBedrockVersion: (version: string) => Promise<boolean>
  registerBedrockVersion: (
    version: string,
    options?: { ignoreMissingDependencies?: boolean },
  ) => Promise<void>
  play: (installationId: string, options?: { keepTarget?: boolean }) => Promise<void>
  joinServer: (
    serverId: string | null,
    address: string,
    edition?: ServerEdition,
    options?: { installationId?: string | null; serverName?: string; skipWarnings?: boolean },
  ) => Promise<boolean>
  /** Set when a join has avoidable compatibility warnings; the dialog owns the retry. */
  joinWarning: JoinWarningState | null
  confirmJoin: () => Promise<void>
  dismissJoinWarning: () => void
  launchGame: (installationId: string, options?: { safeMode?: boolean }) => Promise<void>
  installGame: (installationId: string) => Promise<DownloadJob | null>
  retryLaunch: () => Promise<void>
  createInstallation: (input: InstallationInput) => Promise<Installation>
  updateInstallation: (id: string, patch: Record<string, unknown>) => Promise<Installation>
  /** Pin, tags and colour changes skip the generic update toast. */
  updateInstallationMeta: (id: string, patch: Record<string, unknown>) => Promise<Installation>
  reorderInstallations: (ids: string[]) => Promise<void>
  duplicateInstallation: (id: string) => Promise<Installation | null>
  deleteInstallation: (id: string) => Promise<void>
  refreshInstallations: () => Promise<void>
  setActiveInstallation: (id: string) => Promise<void>
  openInstallationFolder: (id: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  signOut: (id: string) => Promise<void>
  switchAccount: (id: string) => Promise<void>
  refreshAccount: (id: string) => Promise<void>
  windowMaximized: boolean
  authPhase: AuthInputStatus
  /** Live progress from a storage scan or cleanup, or null when idle. */
  storageProgress: StorageProgress | null
}

const LauncherContext = createContext<LauncherContextValue | null>(null)

const emptyAuth: AuthState = { status: 'idle' }
const emptyGame: GameState = { status: 'idle' }

function makeToastId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-math`
}

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionManifest | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [javas, setJavas] = useState<JavaInfo[]>([])
  const [javaLoading, setJavaLoading] = useState(false)
  const [javaError, setJavaError] = useState<string | null>(null)
  const [bedrock, setBedrock] = useState<BedrockStatus | null>(null)
  const [bedrockLoading, setBedrockLoading] = useState(false)
  const [bedrockError, setBedrockError] = useState<string | null>(null)
  const [bedrockVersions, setBedrockVersions] = useState<BedrockCatalog | null>(null)
  const [bedrockVersionsLoading, setBedrockVersionsLoading] = useState(false)
  const [bedrockVersionsError, setBedrockVersionsError] = useState<string | null>(null)
  const [bedrockLibrary, setBedrockLibrary] = useState<BedrockLibraryEntry[]>([])
  const [bedrockDownloads, setBedrockDownloads] = useState<Record<string, BedrockDownloadProgress>>({})
  /** Which Bedrock edition the dashboard's Play button is pointed at. */
  const [bedrockTargetId, setBedrockTargetId] = useState<string | null>(null)
  /** Which Horizon build the dashboard's Play button is pointed at. */
  const [horizonTarget, setHorizonTarget] = useState<HorizonBuild | null>(null)
  const [launchingHorizonTag, setLaunchingHorizonTag] = useState<string | null>(null)
  const [route, setRoute] = useState<RouteState>({ page: 'home' })
  const [linkIntent, setLinkIntent] = useState<LinkIntent | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [horizonInstallJob, setHorizonInstallJob] = useState<HorizonInstallJob | null>(null)
  const [horizonNativeJob, setHorizonNativeJob] = useState<HorizonNativeJob | null>(null)
  const [installDialog, setInstallDialog] = useState<InstallDialogState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authInitialMode, setAuthInitialMode] = useState<AuthMode | null>(null)
  const [launchError, setLaunchError] = useState<LaunchErrorState | null>(null)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [joinWarning, setJoinWarning] = useState<JoinWarningState | null>(null)
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [storageProgress, setStorageProgress] = useState<StorageProgress | null>(null)
  const dataRef = useRef<Bootstrap | null>(null)
  const toastTimers = useRef(new Map<string, number>())
  const initialised = useRef(false)
  const refreshedJavaJobs = useRef(new Set<string>())
  const versionRequest = useRef(0)
  const javaRequest = useRef(0)
  const bedrockRequest = useRef(0)
  const bedrockVersionsRequest = useRef(0)

  dataRef.current = data

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id)
    if (timer) window.clearTimeout(timer)
    toastTimers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = makeToastId()
      setToasts((current) => [...current.slice(-3), { ...toast, id }])
      const timeout = window.setTimeout(
        () => {
          toastTimers.current.delete(id)
          setToasts((current) => current.filter((item) => item.id !== id))
        },
        toast.level === 'error' ? 10_000 : 6000,
      )
      toastTimers.current.set(id, timeout)
    },
    [],
  )

  // The launcher has one designed look. Style values saved by earlier builds
  // stay in the settings file but no longer change the surface, so the app
  // renders the same on every install.
  const applyTheme = useCallback((settings: Settings) => {
    const root = document.documentElement
    root.dataset.theme = 'midnight'
    root.dataset.accent = 'aqua'
    root.dataset.font = 'minecraft'
    root.dataset.rounding = 'rounded'
    root.dataset.depth = 'false'
    root.dataset.reduceMotion = String(settings.reduceMotion)
    root.dataset.contrast = settings.highContrast ? 'high' : 'normal'
    root.dataset.transparency = settings.reduceTransparency ? 'reduced' : 'normal'
    root.dataset.ambient = String(settings.ambient)
  }, [])

  const refreshJava = useCallback(
    async (force = false) => {
      const requestId = ++javaRequest.current
      setJavaLoading(true)
      setJavaError(null)
      try {
        const result = await api.java.detect({ force })
        if (javaRequest.current === requestId) setJavas(result)
      } catch (error) {
        if (javaRequest.current === requestId) setJavaError(getErrorMessage(error))
      } finally {
        if (javaRequest.current === requestId) setJavaLoading(false)
      }
    },
    [],
  )

  const refreshBedrock = useCallback(async (force = false) => {
    const requestId = ++bedrockRequest.current
    setBedrockLoading(true)
    setBedrockError(null)
    try {
      const result = await api.bedrock.status({ force })
      if (bedrockRequest.current === requestId) setBedrock(result)
    } catch (error) {
      if (bedrockRequest.current === requestId) setBedrockError(getErrorMessage(error))
    } finally {
      if (bedrockRequest.current === requestId) setBedrockLoading(false)
    }
  }, [])

  const refreshVersions = useCallback(async (force = false) => {
    const requestId = ++versionRequest.current
    setVersionsLoading(true)
    setVersionsError(null)
    try {
      const manifest = await api.versions.list({ force })
      if (versionRequest.current !== requestId) return null
      setVersions(manifest)
      if (manifest.error) setVersionsError(manifest.error)
      return manifest
    } catch (error) {
      if (versionRequest.current === requestId) setVersionsError(getErrorMessage(error))
      return null
    } finally {
      if (versionRequest.current === requestId) setVersionsLoading(false)
    }
  }, [])

  /**
   * Horizon and its Rust builds run in the main process. Their current job is read
   * once at boot so work started before this page was opened still appears here;
   * the `horizon-install` and `horizon-native` events keep it current afterwards.
   */
  const refreshHorizonTasks = useCallback(async () => {
    try {
      const status = await api.horizon.status()
      if (status?.install) setHorizonInstallJob(status.install)
    } catch {
      // Horizon is optional, and the launcher works without it.
    }
    try {
      const native = await api.horizon.nativeStatus()
      setHorizonNativeJob(native.job ?? null)
    } catch {
      // A missing Rust toolchain is reported on the Horizon page instead.
    }
  }, [])

  const loadBootstrap = useCallback(async () => {
    setLoading(true)
    setBootError(null)
    try {
      const boot = await api.bootstrap()
      setData(boot)
      setVersions(boot.versions)
      applyTheme(boot.settings)
      if (!boot.settings.onboardingComplete) setSetupOpen(true)
      setLoading(false)
      if (boot.versions?.stale || !boot.versions) void refreshVersions(false)
      void refreshJava(false)
      void refreshBedrock(false)
      void refreshBedrockLibrary()
      void refreshHorizonTasks()
      api.windowControls.getState().then((state) => setWindowMaximized(state.maximized)).catch(() => {})
    } catch (error) {
      setBootError(getErrorMessage(error))
      setLoading(false)
    }
  }, [applyTheme, refreshBedrock, refreshHorizonTasks, refreshJava, refreshVersions])

  useEffect(() => {
    if (initialised.current) return
    initialised.current = true
    const unsubscribe = api.events.subscribe((event) => {
      switch (event.type) {
        case 'installations': {
          const payload = event.payload as EventPayloadMap['installations']
          setData((current) => (current ? { ...current, installations: payload.installations } : current))
          break
        }
        case 'settings': {
          const payload = event.payload as EventPayloadMap['settings']
          setData((current) => (current ? { ...current, settings: payload.settings } : current))
          applyTheme(payload.settings)
          break
        }
        case 'accounts': {
          const payload = event.payload as EventPayloadMap['accounts']
          setData((current) => (current ? { ...current, accounts: payload } : current))
          break
        }
        case 'activity': {
          const payload = event.payload as EventPayloadMap['activity']
          setData((current) =>
            current ? { ...current, activity: payload.activity, sessions: payload.sessions } : current,
          )
          break
        }
        case 'downloads': {
          const payload = event.payload as EventPayloadMap['downloads']
          setData((current) => (current ? { ...current, jobs: payload.jobs } : current))
          break
        }
        case 'game': {
          const payload = event.payload as EventPayloadMap['game']
          setData((current) => (current ? { ...current, game: payload } : current))
          if (payload.status === 'running') {
            setLaunchingId(null)
            setLaunchError(null)
          } else if (payload.status === 'exited' || payload.status === 'crashed') {
            setLaunchingId(null)
          }
          break
        }
        case 'auth': {
          const payload = event.payload as EventPayloadMap['auth']
          setData((current) => (current ? { ...current, auth: payload } : current))
          break
        }
        case 'windowState': {
          const payload = event.payload as EventPayloadMap['windowState']
          setWindowMaximized(payload.maximized)
          break
        }
        case 'notification': {
          const payload = event.payload as EventPayloadMap['notification']
          pushToast({
            level: payload.level,
            title: payload.title,
            message: payload.message,
          })
          break
        }
        case 'notifications': {
          const payload = event.payload as EventPayloadMap['notifications']
          setData((current) => (current ? { ...current, notifications: payload } : current))
          break
        }
        case 'app:route': {
          const payload = event.payload as EventPayloadMap['app:route']
          setLinkIntent(payload.intent)
          break
        }
        case 'bedrock-versions': {
          const payload = event.payload as EventPayloadMap['bedrock-versions']
          setBedrockDownloads((current) => ({ ...current, [payload.version]: payload }))
          break
        }
        case 'horizon-install': {
          const payload = event.payload as EventPayloadMap['horizon-install']
          setHorizonInstallJob(payload)
          break
        }
        case 'horizon-native': {
          const payload = event.payload as EventPayloadMap['horizon-native']
          setHorizonNativeJob(payload)
          break
        }
        case 'storage:progress': {
          const payload = event.payload as EventPayloadMap['storage:progress']
          // A scan reports `done: true`; a cleanup counts up to its candidate total.
          const finished =
            (payload.phase === 'scan' && Boolean(payload.done)) ||
            (payload.phase === 'clean' &&
              typeof payload.done === 'number' &&
              typeof payload.total === 'number' &&
              payload.done >= payload.total)
          setStorageProgress(finished ? null : payload)
          break
        }
        default:
          break
      }
    })
    // The main process holds routed links until this subscription exists.
    void api.rendererReady().catch(() => {})
    void loadBootstrap()
    return () => {
      unsubscribe()
      for (const timer of toastTimers.current.values()) window.clearTimeout(timer)
      toastTimers.current.clear()
    }
  }, [applyTheme, loadBootstrap, pushToast])

  useEffect(() => {
    if (!data) return
    if (data.settings.onboardingComplete && setupOpen) setSetupOpen(false)
  }, [data, setupOpen])

  useEffect(() => {
    if (data?.auth.status === 'success' && authOpen) {
      const timer = window.setTimeout(() => setAuthOpen(false), 1400)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [data?.auth.status, authOpen])

  useEffect(() => {
    if (!data) return
    for (const job of data.jobs) {
      if (job.type === 'java' && job.status === 'completed' && !refreshedJavaJobs.current.has(job.id)) {
        refreshedJavaJobs.current.add(job.id)
        void refreshJava(true)
        if (!job.installationId) {
          pushToast({ level: 'success', title: job.title, message: 'The runtime is now available in Settings.' })
        }
      }
    }
  }, [data, pushToast, refreshJava])

  const navigate = useCallback((page: PageName, params?: RouteState['params']) => {
    setRoute({ page, params })
  }, [])

  const dismissLinkIntent = useCallback(() => setLinkIntent(null), [])

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    const next = await api.notifications.markRead(ids ?? null)
    setData((current) => (current ? { ...current, notifications: next } : current))
  }, [])

  const clearNotifications = useCallback(async () => {
    const next = await api.notifications.clear()
    setData((current) => (current ? { ...current, notifications: next } : current))
  }, [])

  const openInstallDialog = useCallback((state?: Partial<InstallDialogState>) => {
    setInstallDialog({
      mode: state?.mode || 'create',
      installation: state?.installation,
      versionId: state?.versionId,
      edition: state?.edition,
    })
  }, [])

  const closeInstallDialog = useCallback(() => setInstallDialog(null), [])

  const clearLaunchError = useCallback(() => setLaunchError(null), [])

  const refreshInstallations = useCallback(async () => {
    try {
      const installations = await api.installations.list()
      setData((current) => (current ? { ...current, installations } : current))
    } catch {
      // State events will update the list on the next change.
    }
  }, [])

  const launchGame = useCallback(
    async (installationId: string, options: { safeMode?: boolean } = {}) => {
      const current = dataRef.current
      const installation = current?.installations.find((item) => item.id === installationId)
      setLaunchingId(installationId)
      setLaunchError(null)
      try {
        await api.game.launch(installationId, null, options.safeMode === true)
      } catch (error) {
        setLaunchError({
          title: 'Minecraft could not start',
          message: getErrorMessage(error),
          installationId,
        })
      } finally {
        setLaunchingId(null)
        void refreshInstallations()
        if (!installation) return
      }
    },
    [refreshInstallations],
  )

  const launchBedrock = useCallback(
    async (
      editionId: string,
      serverAddress: string | null = null,
      options: { keepTarget?: boolean } = {},
    ) => {
      if (!options.keepTarget) {
        setBedrockTargetId(editionId)
        setHorizonTarget(null)
      }
      try {
        const result = await api.bedrock.launch(editionId, serverAddress)
        if (result.mode === 'join') {
          pushToast({
            level: 'success',
            title: `Joining ${result.address}`,
            message: 'Minecraft for Windows is connecting through its deep link.',
          })
        } else {
          pushToast({
            level: 'success',
            title: 'Launching Minecraft for Windows',
            message: 'Bedrock Edition is starting.',
          })
        }
        return true
      } catch (error) {
        pushToast({ level: 'error', title: 'Bedrock could not start', message: getErrorMessage(error) })
        return false
      }
    },
    [pushToast],
  )

  /** Downloaded Bedrock builds, which live in the launcher's own folder. */
  const refreshBedrockLibrary = useCallback(async () => {
    try {
      const state = await api.bedrock.versionsState()
      setBedrockLibrary([...state.library])
      if (state.installed?.length) {
        setBedrock((current) => (current ? { ...current, editions: state.installed } : current))
      }
      // A targeted edition that is no longer installed must not stay selected.
      setBedrockTargetId((current) =>
        current && !state.installed?.some((edition) => edition.id === current) ? null : current,
      )
    } catch {
      // The library is informational; keep whatever was listed before.
    }
  }, [])

  const refreshBedrockVersions = useCallback(async (force = false) => {
    const requestId = ++bedrockVersionsRequest.current
    setBedrockVersionsLoading(true)
    setBedrockVersionsError(null)
    try {
      const catalog = await api.bedrock.versions({ force })
      if (bedrockVersionsRequest.current !== requestId) return
      setBedrockVersions(catalog)
      if (catalog.error) setBedrockVersionsError(catalog.error)
    } catch (error) {
      if (bedrockVersionsRequest.current === requestId) {
        setBedrockVersionsError(getErrorMessage(error))
      }
    } finally {
      if (bedrockVersionsRequest.current === requestId) setBedrockVersionsLoading(false)
    }
  }, [])

  const downloadBedrockVersion = useCallback(
    async (version: string) => {
      setBedrockDownloads((current) => ({
        ...current,
        [version]: { version, phase: 'resolving', receivedBytes: 0, totalBytes: null },
      }))
      try {
        const result = await api.bedrock.downloadVersion(version)
        void refreshBedrockLibrary()
        pushToast({
          level: 'success',
          title: `Bedrock ${version} downloaded`,
          message:
            result.package === 'appx'
              ? 'Register it to play this build alongside your Store copy.'
              : 'MSIXVC builds install through the Microsoft Store; the package is saved on disk.',
        })
        return true
      } catch (error) {
        pushToast({
          level: 'error',
          title: `Bedrock ${version} could not be downloaded`,
          message: getErrorMessage(error),
        })
        return false
      } finally {
        setBedrockDownloads((current) => {
          const next = { ...current }
          delete next[version]
          return next
        })
      }
    },
    [pushToast, refreshBedrockLibrary],
  )

  const cancelBedrockVersion = useCallback(async (version: string) => {
    try {
      await api.bedrock.cancelVersion(version)
    } catch {
      // The download already stopped.
    }
  }, [])

  const removeBedrockVersion = useCallback(
    async (version: string) => {
      try {
        await api.bedrock.removeVersion(version)
        void refreshBedrockLibrary()
        pushToast({
          level: 'info',
          title: `Bedrock ${version} removed`,
          message: 'The downloaded files were deleted.',
        })
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not remove that version', message: getErrorMessage(error) })
      }
    },
    [pushToast, refreshBedrockLibrary],
  )

  const openBedrockVersionFolder = useCallback(
    async (version: string) => {
      try {
        await api.bedrock.openVersionFolder(version)
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(error) })
      }
    },
    [pushToast],
  )

  const registerBedrockVersion = useCallback(
    async (version: string, options: { ignoreMissingDependencies?: boolean } = {}) => {
      try {
        const result = await api.bedrock.registerVersion(version, options)
        const ignored = result.ignoredDependencies?.length
          ? ` Dropped the missing ${result.ignoredDependencies.join(', ')} requirement, so that part may not work in game.`
          : ''
        const replaced = result.replacedVersion ? ` Windows removed Minecraft ${result.replacedVersion} to make room.` : ''
        pushToast({
          level: 'success',
          title: `Bedrock ${version} registered`,
          message: result.registeredVersion
            ? `Windows now reports ${result.registeredVersion}${result.elevated ? ', installed with administrator approval' : ''}.${replaced}${ignored}`
            : `Windows registered the downloaded build.${replaced}${ignored}`,
        })
        void refreshBedrock(true)
        void refreshBedrockLibrary()
      } catch (error) {
        pushToast({ level: 'error', title: 'Registration failed', message: getErrorMessage(error) })
      }
    },
    [pushToast, refreshBedrock],
  )

  const installBedrockVersion = useCallback(
    async (version: string) => {
      setBedrockDownloads((current) => ({
        ...current,
        [version]: { version, phase: 'installing', receivedBytes: 0, totalBytes: null },
      }))
      try {
        const result = await api.bedrock.installVersion(version)
        const replaced = result.replacedVersion
          ? `Windows replaced Minecraft ${result.replacedVersion}.`
          : 'Windows installed it as Minecraft for Windows.'
        const downgrade = result.forcedDowngrade ? ' The build is older, so it will offer to update when it starts.' : ''
        pushToast({
          level: 'success',
          title: `Minecraft ${result.installedVersion || version} installed`,
          message: `${replaced}${downgrade}`,
        })
        void refreshBedrock(true)
        void refreshBedrockLibrary()
        return true
      } catch (error) {
        pushToast({
          level: 'error',
          title: `Bedrock ${version} could not be installed`,
          message: getErrorMessage(error),
        })
        return false
      } finally {
        setBedrockDownloads((current) => {
          const next = { ...current }
          delete next[version]
          return next
        })
      }
    },
    [pushToast, refreshBedrock, refreshBedrockLibrary],
  )

  const joinServer = useCallback(
    async (
      serverId: string | null,
      address: string,
      edition: ServerEdition = 'java',
      options: { installationId?: string | null; serverName?: string; skipWarnings?: boolean } = {},
    ) => {
      if (edition === 'bedrock') {
        const target = bedrock?.editions[0] ?? null
        if (!target) {
          pushToast({
            level: 'info',
            title: 'Bedrock is not installed',
            message: 'Install Minecraft for Windows from the Microsoft Store to join this server.',
          })
          return false
        }
        try {
          await api.bedrock.launch(target.id, address)
          if (serverId) await api.servers.markJoined(serverId)
          pushToast({ level: 'success', title: `Joining ${address}`, message: `${target.name} is connecting.` })
          return true
        } catch (error) {
          pushToast({ level: 'error', title: 'Bedrock could not start', message: getErrorMessage(error) })
          return false
        }
      }
      const current = dataRef.current
      if (!current) return false
      const boundId =
        typeof options.installationId === 'string' && options.installationId ? options.installationId : null
      const bound = boundId ? current.installations.find((item) => item.id === boundId) || null : null
      const active =
        current.installations.find((item) => item.isActive) || current.installations[0] || null
      const installation = bound || active
      if (!installation) {
        pushToast({
          level: 'info',
          title: 'Create an installation first',
          message: 'A server needs a Minecraft profile to launch.',
        })
        return false
      }
      if (!installation.installed) {
        pushToast({
          level: 'info',
          title: `${installation.name} is not installed`,
          message: 'Download its game files from Installations, then join the server.',
        })
        return false
      }
      if (current.game.status === 'preparing' || current.game.status === 'running') {
        pushToast({
          level: 'info',
          title: 'Minecraft is already running',
          message: 'Close the game before joining another server.',
        })
        return false
      }
      const account =
        current.accounts.accounts.find((item) => item.id === current.accounts.activeAccountId) ?? null
      if (!account) {
        setAuthOpen(true)
        pushToast({
          level: 'info',
          title: 'Add a player profile',
          message: 'Choose a profile to join a server.',
        })
        return false
      }
      if (!options.skipWarnings) {
        let status = null
        try {
          // Version and modded checks come from the status ping. Keep this short:
          // an offline server should not make joining feel frozen.
          status = await api.servers.ping(address, 'java', 2500)
        } catch {
          // Joining can still succeed when status is blocked; the game is the
          // final authority and the existing launch errors still apply.
        }
        const compatibility = analyzeServerCompatibility({
          server: { edition: 'java', installationId: boundId },
          installation,
          accountType: account.type,
          status,
          usedFallback: Boolean(boundId && !bound),
        })
        if (compatibility.issues.length) {
          setJoinWarning({
            serverId,
            serverName: options.serverName?.trim() || address,
            address,
            edition,
            installationId: boundId,
            installationName: installation.name,
            serverVersion: compatibility.serverVersion,
            instanceVersion: compatibility.instanceVersion,
            issues: compatibility.issues,
          })
          return false
        }
      }
      setLaunchingId(installation.id)
      setLaunchError(null)
      try {
        const launched = await api.game.launch(installation.id, address)
        if (serverId) await api.servers.markJoined(serverId)
        if (launched.quickJoinSupported === false) {
          pushToast({
            level: 'info',
            title: `Connect to ${address}`,
            message: `Minecraft ${installation.versionId} does not support one-click join. The game is open — use Multiplayer to connect.`,
          })
        } else {
          pushToast({
            level: 'success',
            title: `Joining ${address}`,
            message: `Minecraft is starting with ${installation.name}.`,
          })
        }
        void refreshInstallations()
        return true
      } catch (error) {
        setLaunchError({
          title: 'Minecraft could not start',
          message: getErrorMessage(error),
          installationId: installation.id,
        })
        return false
      } finally {
        setLaunchingId(null)
      }
    },
    [bedrock, pushToast, refreshInstallations],
  )

  const confirmJoin = useCallback(async () => {
    const pending = joinWarning
    if (!pending) return
    setJoinWarning(null)
    await joinServer(pending.serverId, pending.address, pending.edition, {
      installationId: pending.installationId,
      serverName: pending.serverName,
      skipWarnings: true,
    })
  }, [joinServer, joinWarning])

  const dismissJoinWarning = useCallback(() => setJoinWarning(null), [])

  const installGame = useCallback(
    async (installationId: string) => {
      try {
        const job = await api.installations.install(installationId)
        pushToast({
          level: 'info',
          title: 'Installation started',
          message: 'Game files are downloading in the background.',
        })
        navigate('tasks')
        return job
      } catch (error) {
        setLaunchError({
          title: 'Installation could not start',
          message: getErrorMessage(error),
          installationId,
        })
        return null
      }
    },
    [navigate, pushToast],
  )

  const play = useCallback(
    async (installationId: string, options: { keepTarget?: boolean } = {}) => {
      const current = dataRef.current
      if (!current) return
      const installation = current.installations.find((item) => item.id === installationId)
      if (!installation) {
        pushToast({ level: 'error', title: 'Installation missing', message: 'Choose an installation and try again.' })
        return
      }
      if (!options.keepTarget) {
        // The Play button also points the dashboard at this installation.
        setBedrockTargetId(null)
        setHorizonTarget(null)
        try {
          await api.installations.setActive(installationId)
        } catch (error) {
          pushToast({ level: 'error', title: 'Could not set the Play target', message: getErrorMessage(error) })
        }
      }
      if (current.game.status === 'preparing' || current.game.status === 'running') {
        pushToast({
          level: 'info',
          title: 'Minecraft is already running',
          message: 'Close the game before launching another instance.',
        })
        if (current.game.installationId === installationId) navigate('logs', { category: 'game', installationId })
        return
      }
      if (!current.accounts.activeAccountId) {
        setAuthOpen(true)
        pushToast({
          level: 'info',
          title: 'Add a player profile',
          message: 'Connect Microsoft or create an offline profile to launch Minecraft.',
        })
        return
      }
      const activeInstallJob = current.jobs.find(
        (job) =>
          job.type === 'install' &&
          job.installationId === installationId &&
          (job.status === 'running' || job.status === 'queued'),
      )
      if (activeInstallJob) {
        navigate('tasks')
        return
      }
      if (!installation.installed) {
        try {
          const job = await api.installations.install(installationId)
          setPendingLaunch({ installationId, jobId: job.id })
          navigate('tasks')
          pushToast({
            level: 'info',
            title: 'Installing Minecraft',
            message: 'The game will launch automatically when it is ready.',
          })
        } catch (error) {
          setLaunchError({
            title: 'Installation could not start',
            message: getErrorMessage(error),
            installationId,
          })
        }
        return
      }
      await launchGame(installationId)
    },
    [launchGame, navigate, pushToast],
  )

  useEffect(() => {
    if (!pendingLaunch || !data) return
    const job = data.jobs.find((entry) => entry.id === pendingLaunch.jobId)
    if (!job) return
    if (job.status === 'completed') {
      setPendingLaunch(null)
      void launchGame(pendingLaunch.installationId)
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      setPendingLaunch(null)
    }
  }, [data, launchGame, pendingLaunch])

  const retryLaunch = useCallback(async () => {
    if (!launchError?.installationId) return
    const id = launchError.installationId
    setLaunchError(null)
    await launchGame(id)
  }, [launchError, launchGame])

  const createInstallation = useCallback(
    async (input: InstallationInput) => {
      const installation = await api.installations.create(input as unknown as Record<string, unknown>)
      await refreshInstallations()
      pushToast({
        level: 'success',
        title: 'Installation created',
        message: `${installation.name} is ready to install.`,
      })
      return installation
    },
    [pushToast, refreshInstallations],
  )

  const updateInstallation = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const installation = await api.installations.update(id, patch)
      pushToast({ level: 'success', title: 'Installation updated', message: installation.name })
      return installation
    },
    [pushToast],
  )

  const updateInstallationMeta = useCallback(
    async (id: string, patch: Record<string, unknown>) => api.installations.update(id, patch),
    [],
  )

  const reorderInstallations = useCallback(async (ids: string[]) => {
    await api.installations.reorder(ids)
  }, [])

  const duplicateInstallation = useCallback(
    async (id: string) => {
      try {
        const installation = await api.installations.duplicate(id)
        pushToast({
          level: 'success',
          title: 'Installation duplicated',
          message: `${installation.name} was created with a fresh game folder.`,
        })
        return installation
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not duplicate', message: getErrorMessage(error) })
        return null
      }
    },
    [pushToast],
  )

  const deleteInstallation = useCallback(
    async (id: string) => {
      const installation = dataRef.current?.installations.find((item) => item.id === id)
      const result = await api.installations.remove(id)
      pushToast({
        level: 'info',
        title: 'Installation deleted',
        message: installation ? `${installation.name} was removed. Worlds in ${result.gameDir} were kept.` : 'Game data was kept on disk.',
      })
    },
    [pushToast],
  )

  const setActiveInstallation = useCallback(async (id: string) => {
    setBedrockTargetId(null)
    setHorizonTarget(null)
    await api.installations.setActive(id)
  }, [])

  const selectBedrockTarget = useCallback((editionId: string | null) => {
    setBedrockTargetId(editionId)
    if (editionId) setHorizonTarget(null)
  }, [])

  const selectHorizonTarget = useCallback((build: HorizonBuild | null) => {
    setHorizonTarget(build)
    if (build) setBedrockTargetId(null)
  }, [])

  /** Starts a Horizon build directly and points the dashboard's Play at it. */
  const launchHorizon = useCallback(
    async (build: HorizonBuild, options: { keepTarget?: boolean } = {}) => {
      if (!build.prepared) {
        pushToast({
          level: 'info',
          title: 'Horizon is not ready yet',
          message: 'Install this build again so Aqua can finish preparing its resources.',
        })
        return false
      }
      if (!options.keepTarget) {
        setHorizonTarget(build)
        setBedrockTargetId(null)
      }
      setLaunchingHorizonTag(build.tag)
      try {
        await api.horizon.launch(build.tag)
        pushToast({
          level: 'success',
          title: options.keepTarget ? 'Quick-launching Horizon' : 'Launching Horizon',
          message: `Minecraft ${build.gameVersion} · ${build.tag} is starting.`,
        })
        return true
      } catch (error) {
        pushToast({ level: 'error', title: 'Horizon could not start', message: getErrorMessage(error) })
        return false
      } finally {
        setLaunchingHorizonTag(null)
      }
    },
    [pushToast],
  )

  const openInstallationFolder = useCallback(
    async (id: string) => {
      try {
        await api.installations.openFolder(id)
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not open folder', message: getErrorMessage(error) })
      }
    },
    [pushToast],
  )

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const updated = await api.settings.update(patch)
      setData((current) => (current ? { ...current, settings: updated } : current))
      applyTheme(updated)
      return updated
    },
    [applyTheme],
  )

  const completeSetup = useCallback(
    async (extra?: Partial<Settings>) => {
      await saveSettings({ onboardingComplete: true, ...extra })
      setSetupOpen(false)
    },
    [saveSettings],
  )

  const dismissSetup = useCallback(async () => {
    try {
      await saveSettings({ onboardingComplete: true })
      setSetupOpen(false)
      pushToast({
        level: 'info',
        title: 'Setup skipped',
        message: 'Create an installation any time from the Installations page.',
      })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not save setup state', message: getErrorMessage(error) })
    }
  }, [pushToast, saveSettings])

  const openAuth = useCallback((mode?: AuthMode) => {
    setAuthInitialMode(mode || null)
    setAuthOpen(true)
    const status = dataRef.current?.auth.status
    if (status !== 'waiting' && status !== 'finalizing') {
      api.accounts.cancelLogin().catch(() => {})
    }
  }, [])

  const closeAuth = useCallback(() => setAuthOpen(false), [])

  const beginAuth = useCallback(async () => {
    await api.accounts.beginLogin()
  }, [])

  const signInOffline = useCallback(async (name: string) => {
    const accountsState = await api.accounts.signInOffline(name)
    setData((current) => (current ? { ...current, accounts: accountsState } : current))
  }, [])

  const cancelAuth = useCallback(async () => {
    await api.accounts.cancelLogin()
    setAuthOpen(false)
  }, [])

  const signOut = useCallback(
    async (id: string) => {
      try {
        await api.accounts.signOut(id)
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not sign out', message: getErrorMessage(error) })
        throw error
      }
    },
    [pushToast],
  )

  const switchAccount = useCallback(
    async (id: string) => {
      try {
        await api.accounts.switch(id)
        pushToast({ level: 'success', title: 'Account switched' })
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not switch account', message: getErrorMessage(error) })
        throw error
      }
    },
    [pushToast],
  )

  const refreshAccount = useCallback(
    async (id: string) => {
      try {
        await api.accounts.refresh(id)
        pushToast({ level: 'success', title: 'Session refreshed' })
      } catch (error) {
        pushToast({ level: 'error', title: 'Session refresh failed', message: getErrorMessage(error) })
        throw error
      }
    },
    [pushToast],
  )

  const settings = data?.settings ?? null
  const notifications = data?.notifications ?? []
  const installations = data?.installations ?? []
  const accounts = data?.accounts ?? null
  const activeAccount = accounts?.accounts.find((account) => account.isActive) || null
  const selectedInstallation = installations.find((installation) => installation.isActive) || installations[0] || null
  const activity = data?.activity ?? []
  const sessions = data?.sessions ?? []
  const jobs = data?.jobs ?? []
  const activeJobs = jobs.filter((job) => job.status === 'running' || job.status === 'queued')
  const game = data?.game ?? emptyGame
  const auth = data?.auth ?? emptyAuth
  const authPhase = (auth.status as AuthInputStatus) || 'idle'

  const bedrockTarget = useMemo(
    () =>
      bedrockTargetId
        ? bedrock?.editions.find((edition) => edition.id === bedrockTargetId) || null
        : null,
    [bedrock, bedrockTargetId],
  )

  const value = useMemo<LauncherContextValue>(
    () => ({
      data,
      loading,
      bootError,
      retryBoot: () => void loadBootstrap(),
      settings,
      installations,
      accounts,
      activeAccount,
      selectedInstallation,
      activity,
      sessions,
      jobs,
      activeJobs,
      game,
      auth,
      versions,
      versionsLoading,
      versionsError,
      refreshVersions,
      javas,
      javaLoading,
      javaError,
      refreshJava,
      route,
      navigate,
      toasts,
      pushToast,
      dismissToast,
      notifications,
      markNotificationsRead,
      clearNotifications,
      linkIntent,
      dismissLinkIntent,
      horizonInstallJob,
      horizonNativeJob,
      installDialog,
      openInstallDialog,
      closeInstallDialog,
      setupOpen,
      openSetup: () => setSetupOpen(true),
      completeSetup,
      dismissSetup,
      authOpen,
      authInitialMode,
      openAuth,
      closeAuth,
      beginAuth,
      signInOffline,
      cancelAuth,
      launchError,
      clearLaunchError,
      launchingId,
      bedrock,
      bedrockLoading,
      bedrockError,
      refreshBedrock,
      launchBedrock,
      bedrockTarget,
      selectBedrockTarget,
      launchHorizon,
      horizonTarget,
      selectHorizonTarget,
      launchingHorizonTag,
      bedrockVersions,
      bedrockVersionsLoading,
      bedrockVersionsError,
      bedrockLibrary,
      bedrockDownloads,
      refreshBedrockVersions,
      downloadBedrockVersion,
      cancelBedrockVersion,
      removeBedrockVersion,
      openBedrockVersionFolder,
      registerBedrockVersion,
      installBedrockVersion,
      play,
      joinServer,
      joinWarning,
      confirmJoin,
      dismissJoinWarning,
      launchGame,
      installGame,
      retryLaunch,
      createInstallation,
      updateInstallation,
      updateInstallationMeta,
      reorderInstallations,
      duplicateInstallation,
      deleteInstallation,
      refreshInstallations,
      setActiveInstallation,
      openInstallationFolder,
      saveSettings,
      signOut,
      switchAccount,
      refreshAccount,
      windowMaximized,
      authPhase,
      storageProgress,
    }),
    [
      activeAccount,
      activeJobs,
      activity,
      auth,
      authOpen,
      bedrock,
      bedrockDownloads,
      bedrockLibrary,
      bedrockVersions,
      bedrockVersionsError,
      bedrockVersionsLoading,
      bedrockTarget,
      cancelBedrockVersion,
      downloadBedrockVersion,
      selectBedrockTarget,
      openBedrockVersionFolder,
      refreshBedrockVersions,
      registerBedrockVersion,
      installBedrockVersion,
      removeBedrockVersion,
      authInitialMode,
      authPhase,
      bedrock,
      bedrockError,
      bedrockLoading,
      beginAuth,
      bootError,
      cancelAuth,
      clearLaunchError,
      closeAuth,
      closeInstallDialog,
      completeSetup,
      createInstallation,
      data,
      deleteInstallation,
      dismissSetup,
      dismissToast,
      duplicateInstallation,
      game,
      installDialog,
      installGame,
      installations,
      linkIntent,
      dismissLinkIntent,
      javaError,
      javaLoading,
      javas,
      jobs,
      joinServer,
      joinWarning,
      confirmJoin,
      dismissJoinWarning,
      launchBedrock,
      markNotificationsRead,
      clearNotifications,
      notifications,
      launchError,
      launchGame,
      launchHorizon,
      launchingHorizonTag,
      horizonTarget,
      horizonInstallJob,
      horizonNativeJob,
      selectHorizonTarget,
      launchingId,
      loadBootstrap,
      refreshBedrock,
      loading,
      navigate,
      openAuth,
      openInstallationFolder,
      openInstallDialog,
      accounts,
      play,
      pushToast,
      refreshAccount,
      refreshInstallations,
      refreshJava,
      refreshVersions,
      retryLaunch,
      route,
      signInOffline,
      saveSettings,
      selectedInstallation,
      sessions,
      setActiveInstallation,
      settings,
      setupOpen,
      signOut,
      storageProgress,
      switchAccount,
      toasts,
      updateInstallation,
      updateInstallationMeta,
      reorderInstallations,
      versions,
      versionsError,
      versionsLoading,
      windowMaximized,
    ],
  )

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>
}

export function useLauncher(): LauncherContextValue {
  const context = useContext(LauncherContext)
  if (!context) throw new Error('useLauncher must be used inside LauncherProvider')
  return context
}
