export type ThemeName = 'midnight' | 'slate'
export type AuthMode = 'offline' | 'microsoft'
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

export interface Settings {
  onboardingComplete: boolean
  theme: ThemeName
  accent: AccentName
  customTheme: CustomThemeSettings
  fontFamily: FontFamily
  roundedCorners: boolean
  roundedCornersLinked: boolean
  chunkyChrome: boolean
  chunkyChromeLinked: boolean
  uiScale: number
  reduceMotion: boolean
  ambient: boolean
  java: { mode: 'auto' | 'path'; path: string | null }
  memory: { minMb: number; maxMb: number }
  defaultGameDir: string
  downloads: { concurrency: number; bandwidthKbps: number }
  window: { width: number; height: number; fullscreen: boolean }
  jvmArgs: string
  gameArgs: string
  microsoftClientId: string
  minecraftSettings: { sync: boolean }
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

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DownloadJob {
  id: string
  type: 'install' | 'java'
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
}

export type GameStatus = 'idle' | 'preparing' | 'running' | 'exited' | 'crashed' | 'failed'

export interface GameState {
  status: GameStatus
  phase?: string
  installationId?: string
  installationName?: string
  versionId?: string
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
  playtimeMs?: number
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

export interface Bootstrap {
  app: {
    name: string
    version: string
    packaged: boolean
    platform: string
    canLaunchAtLogin: boolean
  }
  settings: Settings
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
  | 'servers'
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
  }
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

export type ModrinthContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader'

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
  hits: ModrinthHit[]
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
  addedAt: string
  lastJoinedAt: string | null
}

export interface ServerStatus {
  edition?: ServerEdition
  address: string
  online: boolean
  latencyMs: number
  motd: string | null
  version: string | null
  protocol: number | null
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
