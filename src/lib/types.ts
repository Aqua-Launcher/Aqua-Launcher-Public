export type ThemeName = 'midnight' | 'slate'
export type AccentName = 'aqua' | 'ocean' | 'steel'
export type FontFamily = 'minecraft' | 'quicksand'

/** Block ids match the texture mapping in `electron/core/block-textures.js`. */
export type BlockId =
  | 'grass_block'
  | 'dirt'
  | 'stone'
  | 'cobblestone'
  | 'mossy_cobblestone'
  | 'gravel'
  | 'sand'
  | 'oak_planks'
  | 'spruce_planks'
  | 'oak_log'
  | 'leaves'
  | 'glass'
  | 'netherrack'
  | 'nether_bricks'
  | 'soul_sand'
  | 'end_stone'
  | 'purpur_block'
  | 'obsidian'
  | 'bedrock'
  | 'deepslate'
  | 'sculk'
  | 'amethyst_block'
  | 'diamond_ore'
  | 'gold_ore'
  | 'redstone_ore'
  | 'emerald_ore'
  | 'diamond_block'
  | 'gold_block'
  | 'emerald_block'
  | 'netherite_block'
  | 'prismarine'
  | 'ice'

/** How one launcher surface (sidebar, title bar, window background) is painted. */
export type SurfaceMode = 'block' | 'color' | 'off'

export interface ThemeSurface {
  mode: SurfaceMode
  block: BlockId
  /** Hex colour used when the surface mode is "color", and for the picker swatch. */
  color: string
  /** Layer opacity, 0–100. */
  opacity: number
  /** Tiled texture size in CSS pixels, 16–128. */
  pixelSize: number
}

/** Block textures extracted from an installed Minecraft client jar. */
export interface BlockTextureSet {
  available: boolean
  /** Client jar version the textures were read from, if any. */
  versionId: string | null
  /** Theme block id → PNG data URL. */
  textures: Record<string, string>
  /** Theme block ids the installed version does not ship. */
  missing: string[]
}

export interface CustomThemeSettings {
  enabled: boolean
  sidebar: ThemeSurface
  titlebar: ThemeSurface
  backdrop: ThemeSurface
  /** "theme" keeps the preset accent from Settings; "custom" uses `accentColor`. */
  accentMode: 'theme' | 'custom'
  accentColor: string
}
export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface LoaderSelection {
  type: LoaderType
  version: string | null
  profileId?: string | null
}

export interface LoaderTypeOption {
  id: LoaderType
  label: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface BackupPolicy {
  enabled: boolean
  onExit: boolean
  daily: boolean
  dailyHour: number
  retentionCount: number
  maxTotalMb: number
}

export interface BackupStatus {
  running: boolean
  lastRunAt: string | null
  lastResult: {
    at: string
    reason: 'daily' | 'exit' | 'manual'
    backedUp: number
    skipped: number
    failed: number
  } | null
  nextRunAt: string | null
}

export type ContentFilterEnvironment = 'any' | 'client' | 'server'
export type ContentFilterSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'

export interface ContentFilterEntry {
  categories: string[]
  environment: ContentFilterEnvironment
  license: string | null
  openSource: boolean
  sort: ContentFilterSort
}

export type ContentFilters = Partial<Record<ModrinthContentType, ContentFilterEntry>>

export interface Settings {
  onboardingComplete: boolean
  theme: ThemeName
  accent: AccentName
  /** Launcher-owned image path used behind the dashboard, or null. */
  dashboardBackground: string | null
  customTheme: CustomThemeSettings
  fontFamily: FontFamily
  roundedCorners: boolean
  roundedCornersLinked: boolean
  chunkyChrome: boolean
  chunkyChromeLinked: boolean
  uiScale: number
  reduceMotion: boolean
  highContrast: boolean
  reduceTransparency: boolean
  ambient: boolean
  java: { mode: 'auto' | 'path'; path: string | null }
  memory: { minMb: number; maxMb: number }
  defaultGameDir: string
  downloads: { concurrency: number; bandwidthKbps: number }
  window: { width: number; height: number; fullscreen: boolean }
  jvmArgs: string
  gameArgs: string
  minecraftSettings: { sync: boolean }
  backups: BackupPolicy
  contentFilters: ContentFilters
  notifications: {
    enabled: boolean
    native: boolean
    levels: {
      success: boolean
      info: boolean
      warning: boolean
      error: boolean
    }
  }
  /** Opt-in Discord Rich Presence; off by default. */
  discord: { enabled: boolean; showServer: boolean }
  startup: {
    launchAtLogin: boolean
    startMinimized: boolean
    reopenOnGameExit: boolean
    refreshJavaOnStart: boolean
  }
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; keepGameLogs: number }
}

export interface InstallationModpack {
  projectId: string
  name: string
  iconUrl: string | null
  versionId: string | null
}

export type InstallationColor = 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet'

export interface Installation {
  id: string
  name: string
  versionId: string
  versionType: VersionType
  loader: LoaderSelection
  effectiveVersionId: string
  gameDir: string
  managedGameDir: boolean
  createdAt: string
  updatedAt: string
  lastPlayedAt: string | null
  totalPlaytimeMs: number
  lastInstalledAt: string | null
  /** Set when the profile was created from a Modrinth modpack. */
  modpack: InstallationModpack | null
  javaPath: string | null
  memoryOverride: { minMb: number; maxMb: number } | null
  windowOverride: { width: number; height: number; fullscreen: boolean } | null
  jvmArgsOverride: string | null
  gameArgsOverride: string | null
  backupPolicy: BackupPolicy | null
  /** Pinned profiles sort above everything else without changing the Play target. */
  pinned: boolean
  tags: string[]
  color: InstallationColor | null
  coverPath: string | null
  /** Explicit drag-to-reorder position; null follows the default sorting. */
  sortIndex: number | null
  installed: boolean
  installedAt: string | null
  assetIndexId: string | null
  worlds: number
  directoryExists: boolean
  isActive: boolean
}

export interface Account {
  id: string
  type: 'microsoft' | 'offline'
  name: string
  uuid: string
  addedAt: string
  lastUsedAt: string
  expiresAt: string | null
  sessionExpired: boolean
  avatarDataUrl: string | null
  isActive: boolean
}

export interface AccountsState {
  accounts: Account[]
  activeAccountId: string | null
  secureStorageAvailable: boolean
  storageLabel: string
}

export interface VersionEntry {
  id: string
  type: VersionType
  url: string
  time: string
  releaseTime: string
  sha1: string | null
  complianceLevel: number
}

/** Mojang's update artwork for a Minecraft version, cached by the main process. */
export interface VersionArtwork {
  version: string
  title: string
  type: string
  dataUrl: string
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: VersionEntry[]
  fetchedAt: string | null
  fromCache: boolean
  stale: boolean
  error?: string
}

export interface ActivityEntry {
  id: string
  type: 'game' | 'install' | 'installation' | 'account' | 'java' | 'world'
  title: string
  detail?: string
  installationId?: string | null
  status: 'success' | 'info' | 'error'
  at: string
}

export interface SessionEntry {
  id: string
  installationId: string
  startedAt: string
  endedAt: string | null
  playtimeMs: number
}

export interface StatsDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  playtimeMs: number
  sessions: number
}

export interface StatsTotals {
  playtimeMs: number
  sessions: number
  activeDays: number
  averageSessionMs: number
  longestSessionMs: number
  firstSessionAt: string | null
  lastSessionAt: string | null
}

export interface StatsInstallation {
  installationId: string
  name: string
  versionId: string | null
  missing: boolean
  playtimeMs: number
  sessions: number
  lastPlayedAt: string | null
}

export interface StatsVersion {
  versionId: string
  playtimeMs: number
  sessions: number
}

export interface StatsCrash {
  id: string
  at: string
  title: string
  category: string
  installationId: string | null
  installationName: string | null
}

export interface PlaytimeStats {
  generatedAt: string
  range: { start: string; end: string; weeks: number }
  hasHistory: boolean
  totals: StatsTotals
  days: StatsDay[]
  topInstallations: StatsInstallation[]
  versions: StatsVersion[]
  streak: { currentDays: number; longestDays: number }
  recentCrashes: StatsCrash[]
}

export interface StatsExportResult {
  path: string
  rows: number
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DownloadJob {
  id: string
  type: 'install' | 'java' | 'backup' | 'modpack-import' | 'launcher-import'
  installationId: string | null
  installationName: string | null
  versionId: string | null
  component?: string
  title: string
  subtitle: string
  status: JobStatus
  stage: string
  progress: number | null
  indeterminate: boolean
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  speedBps: number
  etaSeconds: number | null
  currentFile: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  result?: unknown
}

export type GameStatus = 'idle' | 'preparing' | 'running' | 'exited' | 'crashed' | 'failed'

export interface GameState {
  status: GameStatus
  phase?: string
  installationId?: string
  installationName?: string
  versionId?: string
  /** Set when this session was started straight into a server. */
  serverAddress?: string | null
  pid?: number | null
  startedAt?: string | null
  endedAt?: string | null
  logPath?: string | null
  javaPath?: string
  javaMajor?: number
  memory?: { minMb: number; maxMb: number }
  warning?: string | null
  error?: string | null
  exitCode?: number | null
  signal?: string | null
  crashReportPath?: string | null
  /** Crash Guard's classification of a failed session. */
  analysis?: CrashAnalysis | null
  playtimeMs?: number
  /** Present while Safe Mode content is staged, and after a restore attempt. */
  safeMode?: {
    active: boolean
    sessionId: string | null
    movedFiles: number
    restored?: number
    conflicts?: number
  }
}

export interface CrashAction {
  id: string
  label: string
}

export interface CrashAnalysis {
  category: string
  confidence: 'high' | 'medium' | 'low'
  title: string
  summary: string
  evidence: string[]
  actions: CrashAction[]
}

export interface CrashRecord extends CrashAnalysis {
  id: string
  installationId: string | null
  installationName: string | null
  at: string
  exitCode: number | null
  signal: string | null
  reportPath: string | null
}

export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown'
export type HealthFixKind = 'reinstall' | 'open-settings' | 'open-folder' | 'create-directory' | 'open-content'

export interface HealthCheck {
  id: string
  status: HealthStatus
  title: string
  detail: string
  fix?: { kind: HealthFixKind; label: string }
}

export interface HealthResult {
  installationId: string
  status: HealthStatus
  checks: HealthCheck[]
  checkedAt: string
  versionId: string
}

export interface HealthSummary {
  installations: { installationId: string; status: HealthStatus }[]
  status: HealthStatus
}

export type ContentType = 'mods' | 'resourcepacks' | 'shaderpacks' | 'datapacks'

export interface ContentMetadata {
  modId: string | null
  name: string | null
  version: string | null
  authors: string[]
  loader: string | null
  mcRange: string | null
  requiredDependencies: string[]
  description?: string | null
  format?: number | null
  shaders?: string[]
  type?: 'resourcepack' | 'datapack' | 'shaderpack'
}

export interface ContentFile {
  filename: string
  enabled: boolean
  sizeBytes: number
  mtimeMs: number
  metadata: ContentMetadata | null
  reason: string | null
}

export interface RawContentManifest {
  source: string
  format: 'json' | 'toml'
  content: string
}

export interface ContentFileDetail {
  filename: string
  enabled: boolean
  directory: string
  sizeBytes: number
  mtimeMs: number
  installedAt: string
  metadata: ContentMetadata | null
  reason: string | null
  raw: RawContentManifest | null
}

export interface MissingDependencyConflict {
  dependencyId: string
  filename: string
  modId: string | null
  modName: string
}

export interface DuplicateIdConflict {
  modId: string
  files: { filename: string; name: string }[]
}

export interface LoaderMismatchConflict {
  filename: string
  name: string
  modId: string | null
  loader: string
  expectedLoader: string
}

export interface VersionMismatchConflict {
  filename: string
  name: string
  modId: string | null
  range: string
  gameVersion: string
}

export interface KnownIncompatibleConflict {
  left: { filename: string; name: string }
  right: { filename: string; name: string }
  reason: string
  source: string
}

export interface ContentConflictsResult {
  missingDependencies: MissingDependencyConflict[]
  duplicateIds: DuplicateIdConflict[]
  loaderMismatch: LoaderMismatchConflict[]
  versionMismatch: VersionMismatchConflict[]
  knownIncompatible: KnownIncompatibleConflict[]
  total: number
}

export type ContentImportTarget = 'mod' | 'resourcepack' | 'shader' | 'bedrock' | 'unsupported'
export type ContentImportContentType = 'mod' | 'resourcepack' | 'shader' | 'bedrock'
export type ContentImportPolicy = 'ask' | 'replace' | 'skip' | 'keep-both'

export interface ContentImportItem {
  sourcePath: string
  filename: string
  target: ContentImportTarget
  destination: string | null
  conflict: boolean
  reason: string | null
}

export interface ContentImportResult {
  items: ContentImportItem[]
  imported: Array<{ filename: string; contentType: ContentImportContentType; destination: string }>
  skipped: Array<{ filename: string; reason: string }>
  conflicts: Array<{ filename: string; destination: string | null }>
  errors: Array<{ filename: string; reason: string }>
  gameRunning: boolean
}

export interface ContentImportRequest {
  installationId: string | null
  contentType: ModrinthContentType
  paths: string[]
  dryRun?: boolean
  conflictPolicy?: ContentImportPolicy
  bedrockEditionId?: string | null
}

export interface ContentIndexResult {
  directory: string
  contentType: ContentType
  exists: boolean
  files: ContentFile[]
  cached: boolean
  scannedAt: string
}

export interface JavaInfo {
  path: string
  home: string
  version: string
  major: number
  vendor: string
  arch: string
  source: string
  component: string | null
}

export interface JavaRuntimeOption {
  component: string
  versionName: string
  major: number
  released: string | null
  installed: boolean
  path: string
  recommended: boolean
  legacy: boolean
}

export interface SystemInfo {
  platform: string
  release: string
  arch: string
  totalMemMb: number
  freeMemMb: number
  cpuModel: string
  cpuCount: number
  recommendedMaxRamMb: number
  electron: string | null
  node: string
  chrome: string | null
  dataRoot: string
  minecraftRoot: string
  instancesRoot: string
  logsRoot: string
}

export type AuthStatus = 'idle' | 'starting' | 'waiting' | 'finalizing' | 'success' | 'error'

export interface AuthState {
  status: AuthStatus
  message?: string
  url?: string
  startedAt?: string
  finishedAt?: string
  secureStorageAvailable?: boolean
}

export type NotificationLevel = 'success' | 'error' | 'info' | 'warning'

export interface NotificationAction {
  page: PageName
  params?: RouteState['params']
  label?: string
}

export interface LinkExample {
  label: string
  description: string
  value: string
}

export interface LinkStatus {
  scheme: string
  registered: boolean
  portable: boolean
  examples: LinkExample[]
}

/** One validated action from `aqua://` or the CLI, handed to the renderer. */
export type LinkIntent =
  | {
      kind: 'launch'
      instance: string | null
      confirmed: boolean
      source: 'link' | 'cli'
      json?: boolean
    }
  | {
      kind: 'join'
      server: string
      instance: string | null
      edition: ServerEdition
      confirmed: boolean
      source: 'link' | 'cli'
      json?: boolean
    }
  | {
      kind: 'install'
      project: string
      confirmed: boolean
      source: 'link' | 'cli'
      json?: boolean
    }
  | {
      kind: 'open'
      page: PageName
      contentType?: ModrinthContentType
      section?: string
      confirmed: boolean
      source: 'link' | 'cli'
      json?: boolean
    }

export interface AppNotification {
  id: string
  level: NotificationLevel
  title: string
  message: string
  at: string
  read: boolean
  action: NotificationAction | null
}

export interface Bootstrap {
  app: {
    name: string
    version: string
    packaged: boolean
    platform: string
    canLaunchAtLogin: boolean
    portable: boolean
    portableSource: 'flag' | 'marker' | null
    portableWarning: string | null
  }
  settings: Settings
  notifications: AppNotification[]
  installations: Installation[]
  accounts: AccountsState
  activity: ActivityEntry[]
  sessions: SessionEntry[]
  jobs: DownloadJob[]
  game: GameState
  auth: AuthState
  versions: VersionManifest | null
  system: SystemInfo
  paths: {
    dataRoot: string
    minecraftRoot: string
    instancesRoot: string
    logsRoot: string
  }
}

export interface LogFile {
  name: string
  size: number
  modified: string
}

export interface LogsList {
  launcher: LogFile[]
  games: Array<{
    installationId: string
    installationName: string
    versionId: string | null
    files: LogFile[]
  }>
  crashes: Array<{
    installationId: string
    installationName: string
    filename: string
    size: number
    modified: string
  }>
}

export interface LogReadResult {
  content: string
  truncated: boolean
  size: number
  modified: string
  name: string
}

export interface NotificationPayload {
  level: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
}

export type AppEvent =
  | { type: 'installations'; payload: { installations: Installation[] } }
  | { type: 'settings'; payload: { settings: Settings } }
  | { type: 'accounts'; payload: AccountsState }
  | { type: 'activity'; payload: { activity: ActivityEntry[]; sessions: SessionEntry[] } }
  | { type: 'downloads'; payload: { jobs: DownloadJob[] } }
  | { type: 'game'; payload: GameState }
  | { type: 'auth'; payload: AuthState }
  | { type: 'notification'; payload: NotificationPayload }
  | { type: 'app:route'; payload: { intent: LinkIntent } }
  | { type: 'windowState'; payload: { maximized: boolean } }

export interface Toast {
  id: string
  level: NotificationPayload['level']
  title: string
  message?: string
  actionLabel?: string
  action?: () => void
}

export type PageName =
  | 'home'
  | 'installations'
  | 'tasks'
  | 'worlds'
  | 'screenshots'
  | 'servers'
  | 'stats'
  | 'mods'
  | 'account'
  | 'logs'
  | 'docs'
  | 'settings'

export interface RouteState {
  page: PageName
  params?: {
    category?: 'launcher' | 'game' | 'crash'
    installationId?: string
    file?: string
    contentType?: ModrinthContentType
    section?: string
    action?: 'check-updates'
  }
}

export interface ScreenshotImage {
  filename: string
  size: number
  modified: string
  width: number | null
  height: number | null
}

export interface ScreenshotList {
  directory: string
  exists: boolean
  images: ScreenshotImage[]
}

export interface ScreenshotThumbnail {
  dataUrl: string
  width: number | null
  height: number | null
}

export interface DashboardBackground {
  dataUrl: string | null
}

export interface WorldSearchEntry {
  installationId: string
  installationName: string
  folder: string
  name: string
  gameMode: string
  versionName: string | null
  lastPlayed: string
}

/** The three editions that can be installed from the one installation screen. */
export type InstallEdition = 'java' | 'bedrock' | 'horizon'

export interface InstallDialogState {
  mode: 'create' | 'edit'
  installation?: Installation
  versionId?: string
  /** Which edition the dialog opens on; Java when omitted. */
  edition?: InstallEdition
}

export interface InstallationInput {
  name: string
  versionId: string
  loader?: LoaderSelection | null
  gameDir?: string
  javaPath?: string | null
  memory?: { minMb: number; maxMb: number } | null
  window?: { width: number; height: number; fullscreen: boolean } | null
  jvmArgs?: string | null
  gameArgs?: string | null
}

export type ModrinthContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack'

export interface ModrinthHit {
  id: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  follows: number
  categories: string[]
  versions: string[]
  projectType: string
  updated: string | null
}

export interface ModrinthSearchResult {
  contentType: ModrinthContentType
  total: number
  offset: number
  limit: number
  loader: string | null
  minecraftVersion: string | null
  sort: ContentFilterSort
  categories: string[]
  environment: ContentFilterEnvironment
  license: string | null
  openSource: boolean
  hits: ModrinthHit[]
}

export interface ModrinthProjectDetail {
  id: string
  slug: string | null
  title: string
  description: string
  body: string
  iconUrl: string | null
  author: string | null
  downloads: number
  followers: number
  categories: string[]
  projectType: string | null
  clientSide: string | null
  serverSide: string | null
  license: { id: string | null; name: string | null; url: string | null } | null
  sourceUrl: string | null
  issuesUrl: string | null
  wikiUrl: string | null
  discordUrl: string | null
  gallery: { url: string; title: string | null; description: string | null; featured: boolean }[]
  published: string | null
  updated: string | null
}

export interface ModrinthVersion {
  id: string
  name: string
  versionNumber: string
  versionType: string
  gameVersions: string[]
  loaders: string[]
  datePublished: string | null
  downloads: number
  changelog: string
  files: { url: string; filename: string; size: number; primary: boolean }[]
  dependencies: { projectId: string | null; versionId: string | null; dependencyType: string }[]
}

export interface InstalledMod {
  filename: string
  enabled: boolean
  size: number
  modified: string
  sha1: string | null
  projectId: string | null
  versionId: string | null
  title: string
  description: string | null
  iconUrl: string | null
  versionNumber: string | null
  matched: boolean
  metadata: ContentMetadata | null
  metadataReason: string | null
}

export interface InstalledContentResult {
  contentType: ModrinthContentType
  directory: string | null
  items: InstalledMod[]
}

export interface ModUpdate {
  filename: string
  projectId: string
  title: string
  iconUrl: string | null
  currentVersionId: string
  currentVersionNumber: string | null
  latestVersionId: string
  latestVersionNumber: string | null
  latestFilename: string
  enabled: boolean
}

export interface ModUpdatesResult {
  contentType: ModrinthContentType
  checked: number
  updates: ModUpdate[]
}

export interface ModUpdateResult {
  contentType: ModrinthContentType
  filename: string
  previousFilename: string
  versionId: string
  versionNumber: string | null
  name: string | null
}

export interface ModInstallResult {
  contentType: ModrinthContentType
  installed: Array<{
    projectId: string
    versionId: string
    name: string
    versionNumber: string
    filename: string
  }>
  skipped: string[]
  warnings: string[]
}

export type ModRetargetStatus = 'ready' | 'compatible' | 'blocked'

/** What the launcher found in one installed mod jar's Minecraft version gate. */
export interface ModRetargetAnalysis {
  filename: string
  targetVersion: string
  targetLoader: string
  modLoader: string | null
  metadataPath: string | null
  declaredRange: string | null
  suggestedRange: string | null
  status: ModRetargetStatus
  reason: string | null
  warnings: string[]
  converted: boolean
  canUndo: boolean
  convertedAt: string | null
  convertedVersion: string | null
  originalRange: string | null
}

export interface ModpackInstallResult {
  installation: Installation
  job: DownloadJob
  modpack: {
    name: string
    packName: string
    version: string
    minecraftVersion: string
    loader: string
    loaderVersion: string | null
    files: number
    overrides: number
  }
}

export interface ModpackInspection {
  kind: 'mrpack' | 'prism'
  path: string
  name: string
  minecraftVersion: string
  loader: { type: string; version: string | null }
  files: number
  overrides: number
  modes: Array<'copy' | 'adopt'>
  sourceDir?: string
}

export interface ModpackImportSubmission {
  job: DownloadJob
  info: ModpackInspection
}

export type LauncherId = 'vanilla' | 'prism' | 'multimc' | 'curseforge' | 'atlauncher'

export interface LauncherProfileCandidate {
  id: string
  launcher: LauncherId
  launcherName: string
  path: string
  sourceDir: string
  name: string
  minecraftVersion: string
  loader: { type: string; version: string | null }
  modes: Array<'copy' | 'adopt'>
  mods: number
  worlds: number
  files: number
  bytes: number
  sizeCapped: boolean
}

export interface LauncherScanResult {
  candidates: LauncherProfileCandidate[]
  roots: Array<{ launcher: LauncherId; path: string; kind: string }>
  errors: string[]
}

export interface LauncherImportProfileResult {
  candidateId: string
  installationId: string
  name: string
  launcher: LauncherId
  minecraftVersion: string
  loader: { type: string; version: string | null }
  mode: 'copy' | 'adopt'
  files: number
  bytes: number
  warnings: string[]
  installJob: string | null
}

export interface LauncherImportFailure {
  candidateId: string
  name: string
  launcher: LauncherId
  minecraftVersion: string
  error: string
}

export interface LauncherImportResult {
  imported: LauncherImportProfileResult[]
  failed: LauncherImportFailure[]
}

export interface LauncherImportSubmission {
  job: DownloadJob
  candidates: LauncherProfileCandidate[]
}

export interface ModpackExportFile {
  path: string
  kind: 'download' | 'override' | 'world'
  size: number
  projectId: string | null
  versionId: string | null
}

export interface ModpackExportPreview {
  name: string
  versionId: string
  minecraftVersion: string
  loader: { type: string; version: string | null }
  includeWorlds: boolean
  downloadable: number
  downloadableBytes: number
  bundled: number
  bundledBytes: number
  worldFiles: number
  worldBytes: number
  totalBytes: number
  warnings: string[]
  files: ModpackExportFile[]
}

export interface ModpackExportResult extends ModpackExportPreview {
  path: string
  filename: string
}

export interface WorldSummary {
  folder: string
  name: string
  lastPlayed: string | null
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator'
  hardcore: boolean
  difficulty: string
  versionName: string | null
  cheats: boolean
  sizeBytes: number
  files: number
  iconDataUrl: string | null
}

export interface WorldBackup {
  id: string
  worldFolder: string
  name: string
  createdAt: string
  sizeBytes: number
  note: string | null
  pinned?: boolean
  automatic?: boolean
  contentHash?: string | null
  lastBackupAt?: string | null
}

export interface WorldsResult {
  directory: string
  exists: boolean
  worlds: WorldSummary[]
  backups: WorldBackup[]
}

export interface WorldRestoreResult {
  folder: string
  name: string
  files: number
  note: string | null
}

export type ServerEdition = 'java' | 'bedrock'

export interface ServerEntry {
  id: string
  name: string
  address: string
  connectAddress: string
  edition: ServerEdition
  /** The Java profile this server launches with, or null for the active one. */
  installationId: string | null
  addedAt: string
  lastJoinedAt: string | null
}

export interface LanWorld {
  id: string
  motd: string
  port: number
  sourceAddress: string
  /** The address passed to Quick Play; always localhost. */
  address: string
  lastSeenAt: string
}

export interface LanDiscoverySnapshot {
  worlds: LanWorld[]
  listening: boolean
  error: string | null
}

export interface ServerStatus {
  edition?: ServerEdition
  address: string
  online: boolean
  latencyMs: number
  motd: string | null
  version: string | null
  protocol: number | null
  /** The server advertises Forge or NeoForge mod metadata. */
  modded?: boolean
  players: {
    online: number
    max: number
    sample: Array<{ name: string; id: string | null }>
  }
  favicon: string | null
  error: string | null
}

/** A Store edition of Minecraft Bedrock (Minecraft for Windows or Preview). */
export interface BedrockEdition {
  id: string
  edition: 'bedrock'
  name: string
  packageName: string
  packageFamilyName: string
  packageVersion: string
  version: string | null
  installLocation: string | null
  status: string | null
  appUserModelId: string | null
  dataRoot: string
  dataRootExists: boolean
  worldsDirectory: string
}

export interface BedrockStatus {
  supported: boolean
  editions: BedrockEdition[]
  /** Windows Developer Mode, which side-loading a downloaded build needs. */
  developerMode: boolean | null
  storeUrl: string
}

/** One downloadable Bedrock build from the community version lists. */
export interface BedrockCatalogEntry {
  version: string
  /** `appx` packages unpack into a folder and register; `msixvc` builds install, replacing the current copy. */
  package: 'appx' | 'msixvc'
  channel: 'release' | 'beta' | 'preview'
  updateId: string | null
  url: string | null
}

export interface BedrockCatalog {
  fetchedAt: string
  fromCache: boolean
  stale: boolean
  error: string | null
  versions: BedrockCatalogEntry[]
}

/** A version already unpacked into the launcher's Bedrock folder. */
export interface BedrockLibraryEntry {
  version: string
  directory: string
  layout: 'appx' | 'msixvc'
  sizeBytes: number
}

export interface BedrockVersionsState {
  library: BedrockLibraryEntry[]
  installed: BedrockEdition[]
}

export interface BedrockDownloadProgress {
  version: string
  phase: 'resolving' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error' | 'cancelled'
  receivedBytes: number
  totalBytes: number | null
  sizeBytes?: number
  error?: string
}

export type BedrockAddonKind = 'behavior_pack' | 'resource_pack' | 'skin_pack'

export interface BedrockAddon {
  folder: string
  kind: BedrockAddonKind
  /** The kind the pack's own manifest reports, when it differs from the folder. */
  packKind: BedrockAddonKind | null
  name: string
  description: string | null
  uuid: string | null
  version: string | null
  sizeBytes: number
  files: number
  modified: string | null
}

export interface BedrockAddonsResult {
  editionId: string
  editionName: string
  dataRoot: string
  worldsDirectory: string
  packs: BedrockAddon[]
}

export interface BedrockAddonImportResult {
  installed: Array<{ kind: BedrockAddonKind; kindLabel: string; name: string; folder: string; version: string | null }>
  skipped: string[]
  worlds: string[]
}

export interface BedrockRegistrationResult {
  version: string
  manifest: string
  command: string
  /** True when Windows needed the approved administrator prompt. */
  elevated: boolean
  /** Framework requirements that were dropped from the build's manifest. */
  ignoredDependencies: string[]
  /** The Minecraft build Windows had registered before this one took over. */
  replacedVersion: string | null
  registeredVersion: string | null
  packageVersion: string | null
}

export interface BedrockInstallResult {
  version: string
  file: string
  command: string
  /** The Minecraft version Windows was running before the install. */
  replacedVersion: string | null
  /** True when the build was older and Windows had to be told to replace the newer one. */
  forcedDowngrade: boolean
  installedVersion: string | null
  packageVersion: string | null
  installLocation: string | null
}

export interface BedrockLaunchResult {
  mode: 'launch' | 'join'
  editionId: string
  address?: string
  url?: string
  appUserModelId?: string | null
}

export interface BedrockWorldSummary {
  folder: string
  name: string
  sizeBytes: number
  files: number
  lastPlayed: string | null
  iconDataUrl: string | null
}

export interface BedrockWorldBackup {
  id: string
  editionId: string
  editionName: string
  name: string
  worldFolder: string
  createdAt: string
  sizeBytes: number
  files: number
  note: string | null
}

export interface BedrockWorldRestoreResult {
  editionId: string
  name: string
  folder: string
  files: number
  bytes: number
}

export interface BedrockWorldsResult {
  directory: string
  exists: boolean
  worlds: BedrockWorldSummary[]
  backups: BedrockWorldBackup[]
}

export interface HorizonRelease {
  tag: string
  name: string
  publishedAt: string | null
  notesUrl: string | null
  assetName: string
  assetUrl: string
  assetSize: number | null
  assetDigest: string | null
  checksumsUrl: string | null
  signatureUrl: string | null
}

export interface HorizonReleaseCatalog {
  releases: HorizonRelease[]
  platform: string
  arch: string
  fetchedAt: string | null
  fromCache: boolean
  stale: boolean
  error: string | null
}

export type HorizonInstallStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

export interface HorizonInstallJob {
  id: string
  type: 'horizon'
  tag: string
  assetName: string
  gameVersion: string | null
  status: HorizonInstallStatus
  stage: string
  message: string | null
  progress: number | null
  indeterminate: boolean
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  speedBps: number
  etaSeconds: number | null
  currentFile: string | null
  error: string | null
  warning: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** One Horizon build installed and prepared by Aqua. */
export interface HorizonBuild {
  tag: string
  /** The Minecraft: Java Edition drop this build targets, from its research lock. */
  gameVersion: string
  directory: string
  clientPath: string
  resourcesDirectory: string
  /** Aqua's bundled Horizon preparer has written the game resources. */
  prepared: boolean
  /** The newest installed build is the one Play starts by default. */
  selected: boolean
  installedAt: string | null
  archiveSha256: string | null
  assetName: string | null
  javaMajor: number | null
  warning: string | null
  /** Compiled by Aqua with native mods, rather than a published release. */
  native?: boolean
  baseTag?: string | null
  revision?: string | null
  profile?: string | null
  nativeMods?: number
}

export interface HorizonStatus {
  supported: boolean
  supportedReason: string | null
  installed: boolean
  name: 'Horizon'
  edition: 'horizon'
  runtime: 'rust'
  gameVersion: string | null
  /** The named Java Edition drop, e.g. Wilderness Bound for 26.3. */
  drop: string | null
  dataRoot: string
  dataRootExists: boolean
  buildsDirectory: string
  downloadsDirectory: string
  gameHome: string
  gameHomeExists: boolean
  worldsDirectory: string
  worlds: number
  builds: HorizonBuild[]
  selectedTag: string | null
  install: HorizonInstallJob | null
  managed: boolean
  siteUrl: string
}

export interface HorizonLaunchResult {
  mode: 'launch'
  version: string
  gameVersion: string
  pid: number | null
  gameHome: string
}

export type HorizonFolderKind = 'game' | 'worlds' | 'builds' | 'build' | 'downloads'

/** Horizon's three mod files: .hmod content, .hnmod native, and .zip packs. */
export type HorizonModKind = 'content' | 'native' | 'resourcepack'

export interface HorizonMod {
  filename: string
  title: string
  kind: HorizonModKind
  id: string
  version: string | null
  size: number
  modified: string
  enabled: boolean
  note: string | null
}

export interface HorizonModsResult {
  gameHome: string
  directory: string
  stateFile: string
  mods: HorizonMod[]
}

export interface HorizonModImportResult {
  filename: string
  title: string
  kind: HorizonModKind
  id: string
  version: string | null
  size: number
  note: string | null
}

/** One published release file in Horizon's registry. */
export interface HorizonRegistryVersion {
  version: string | null
  game: string | null
  published: string | null
  changelog: string | null
  api: string | null
  fileName: string
  url: string
  size: number
  sha256: string
  signature: string | null
}

export interface HorizonRegistryProject {
  id: string
  name: string
  summary: string
  description: string
  authors: string[]
  license: string | null
  source: string | null
  icon: string | null
  downloads: number
  kind: HorizonModKind
  official: boolean
  versions: HorizonRegistryVersion[]
}

export interface HorizonRegistryResult {
  schema: number | null
  generated: string | null
  projects: HorizonRegistryProject[]
  revoked: unknown[]
  fetchedAt: string | null
  fromCache: boolean
  stale: boolean
  error: string | null
}

export interface HorizonProjectInstallResult extends HorizonModImportResult {
  projectId: string
  projectName: string
  projectVersion: string | null
  sha256: string
}

export type HorizonNativeBuildStatus = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

export interface HorizonNativeJob {
  id: string
  type: 'horizon-native'
  status: HorizonNativeBuildStatus
  stage: string
  message: string | null
  profile: string | null
  revision: string | null
  mixins: string | null
  tag: string | null
  mods: number
  startedAt: string
  finishedAt: string | null
  error: string | null
  progress?: number | null
  logTail?: string[]
}

export interface HorizonNativeStatus {
  rust: {
    available: boolean
    version: string | null
    source: 'aqua' | 'system' | null
    canDownload: boolean
    error: string | null
  }
  enabledNativeMods: number
  baseTag: string | null
  baseBuilds: number
  gameVersion: string | null
  canBuild: boolean
  reason: string | null
  job: HorizonNativeJob | null
}

export interface MinecraftSettingsFile {
  name: string
  size: number
  modified: string
}

export interface MinecraftSettingsStatus {
  directory: string
  files: MinecraftSettingsFile[]
  updatedAt: string | null
  enabled: boolean
  installations: number
}

export interface MinecraftSettingsSyncResult {
  files: string[]
  skipped: string[]
  directory: string
  installation?: string
  source?: string
}

export interface MinecraftSettingsApplyAllResult {
  directory: string
  installations: Array<{ id: string; name: string; files: string[] }>
}

export interface LaunchErrorState {
  title: string
  message: string
  installationId?: string
}

export interface StorageCategory {
  id: string
  label: string
  explanation: string
  path: string | null
  bytes: number
  files: number
}

export interface StorageCleanupCandidate {
  id: string
  kind: 'cache' | 'logs' | 'versions' | 'backups'
  label: string
  bytes: number
  files: number
  safeByDefault: boolean
  reason: string
  root: string
}

export interface StorageScan {
  scannedAt: string
  durationMs: number
  totalBytes: number
  files: number
  categories: StorageCategory[]
  candidates: StorageCleanupCandidate[]
  truncated: boolean
  cancelled: boolean
  unreadable: number
}

export interface StorageCleanResult {
  removed: Array<{ id: string; label: string; bytes: number; files: number }>
  failed: Array<{ id: string; label: string; error: string }>
  freedBytes: number
}

export interface StorageProgress {
  phase: 'scan' | 'clean'
  label?: string
  categories?: number
  done?: boolean | number
  total?: number
}
