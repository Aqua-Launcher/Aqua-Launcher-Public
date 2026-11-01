import type {
  AccountsState,
  ActivityEntry,
  AuthState,
  Bootstrap,
  DownloadJob,
  GameState,
  HorizonFolderKind,
  HorizonInstallJob,
  HorizonLaunchResult,
  HorizonReleaseCatalog,
  HorizonStatus,
  InstalledContentResult,
  Installation,
  JavaInfo,
  JavaRuntimeOption,
  LoaderType,
  LoaderTypeOption,
  LoaderVersion,
  LogReadResult,
  LogsList,
  MinecraftSettingsApplyAllResult,
  MinecraftSettingsStatus,
  MinecraftSettingsSyncResult,
  ModInstallResult,
  ModpackInstallResult,
  ModRetargetAnalysis,
  ModrinthContentType,
  ModrinthSearchResult,
  ModUpdateResult,
  ModUpdatesResult,
  BedrockAddonImportResult,
  BedrockAddonsResult,
  BedrockCatalog,
  BedrockDownloadProgress,
  BedrockInstallResult,
  BedrockLaunchResult,
  BedrockRegistrationResult,
  BedrockStatus,
  BlockTextureSet,
  BedrockVersionsState,
  BedrockWorldBackup,
  BedrockWorldRestoreResult,
  BedrockWorldsResult,
  ServerEdition,
  ServerEntry,
  ServerStatus,
  SessionEntry,
  Settings,
  StorageCleanResult,
  StorageProgress,
  StorageScan,
  VersionArtwork,
  VersionManifest,
  WorldBackup,
  WorldRestoreResult,
  WorldsResult,
} from './types'

export interface AquaApi {
  bootstrap: () => Promise<Bootstrap>
  openExternal: (url: string) => Promise<boolean>
  reportRendererError: (payload: { message: string; stack?: string }) => Promise<boolean>
  copyText: (text: string) => boolean
  windowControls: {
    minimize: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<boolean>
    getState: () => Promise<{ maximized: boolean; focused: boolean }>
    setZoom: (scale: number) => Promise<boolean>
  }
  versions: {
    list: (options?: { force?: boolean }) => Promise<VersionManifest>
  }
  artwork: {
    versionArt: (versionId: string) => Promise<VersionArtwork | null>
  }
  blockTextures: {
    list: (options?: { force?: boolean }) => Promise<BlockTextureSet>
  }
  installations: {
    list: () => Promise<Installation[]>
    get: (id: string) => Promise<Installation>
    create: (input: Record<string, unknown>) => Promise<Installation>
    update: (id: string, patch: Record<string, unknown>) => Promise<Installation>
    duplicate: (id: string) => Promise<Installation>
    remove: (id: string) => Promise<{ removed: string; gameDir: string }>
    setActive: (id: string) => Promise<Installation>
    install: (id: string) => Promise<DownloadJob>
    openFolder: (id: string) => Promise<string>
  }
  settings: {
    update: (patch: Partial<Settings>) => Promise<Settings>
  }
  minecraftSettings: {
    status: () => Promise<MinecraftSettingsStatus>
    capture: (installationId: string) => Promise<MinecraftSettingsSyncResult>
    apply: (installationId: string) => Promise<MinecraftSettingsSyncResult>
    applyAll: () => Promise<MinecraftSettingsApplyAllResult>
  }
  accounts: {
    list: () => Promise<AccountsState>
    getAuthState: () => Promise<AuthState>
    beginLogin: () => Promise<{ url: string }>
    signInOffline: (name: string) => Promise<AccountsState>
    cancelLogin: () => Promise<boolean>
    switch: (id: string) => Promise<unknown>
    signOut: (id: string) => Promise<AccountsState>
    refresh: (id: string) => Promise<unknown>
  }
  java: {
    detect: (options?: { force?: boolean }) => Promise<JavaInfo[]>
    validate: (path: string) => Promise<JavaInfo>
    runtimeOptions: () => Promise<JavaRuntimeOption[]>
    installRuntime: (component: string) => Promise<DownloadJob>
  }
  loaders: {
    types: () => Promise<LoaderTypeOption[]>
    versions: (type: LoaderType, minecraftVersion: string) => Promise<LoaderVersion[]>
  }
  mods: {
    search: (
      /** Null is allowed for modpacks, which install as their own profile. */
      installationId: string | null,
      options?: { query?: string; offset?: number; limit?: number; contentType?: ModrinthContentType },
    ) => Promise<ModrinthSearchResult>
    list: (installationId: string, contentType?: ModrinthContentType) => Promise<InstalledContentResult>
    install: (
      installationId: string,
      projectId: string,
      versionId?: string | null,
      contentType?: ModrinthContentType,
    ) => Promise<ModInstallResult>
    installModpack: (projectId: string, versionId?: string | null) => Promise<ModpackInstallResult>
    checkUpdates: (installationId: string, contentType?: ModrinthContentType) => Promise<ModUpdatesResult>
    update: (
      installationId: string,
      filename: string,
      versionId: string,
      contentType?: ModrinthContentType,
    ) => Promise<ModUpdateResult>
    toggle: (
      installationId: string,
      filename: string,
      contentType?: ModrinthContentType,
    ) => Promise<{ filename: string; enabled: boolean }>
    remove: (installationId: string, filename: string, contentType?: ModrinthContentType) => Promise<{ filename: string }>
    retargetInfo: (installationId: string, filename: string) => Promise<ModRetargetAnalysis>
    retarget: (installationId: string, filename: string) => Promise<ModRetargetAnalysis>
    retargetUndo: (installationId: string, filename: string) => Promise<ModRetargetAnalysis>
    openFolder: (installationId: string, contentType?: ModrinthContentType) => Promise<string>
  }
  downloads: {
    list: () => Promise<DownloadJob[]>
    cancel: (id: string) => Promise<DownloadJob>
    clearFinished: () => Promise<DownloadJob[]>
  }
  storage: {
    scan: (options?: { force?: boolean }) => Promise<StorageScan>
    clean: (ids: string[], options?: { includeBackups?: boolean }) => Promise<StorageCleanResult>
    cancel: () => Promise<{ cancelled: boolean }>
  }
  game: {
    launch: (
      installationId: string,
      serverAddress?: string | null,
    ) => Promise<{
      pid: number
      logPath: string
      startedAt: string
      command: string
      serverAddress?: string | null
      quickJoinSupported?: boolean
    }>
    getState: () => Promise<GameState>
  }
  worlds: {
    list: (installationId: string) => Promise<WorldsResult>
    backup: (installationId: string, folder: string, note?: string | null) => Promise<WorldBackup>
    restore: (installationId: string, backupId: string) => Promise<WorldRestoreResult>
    deleteBackup: (installationId: string, backupId: string) => Promise<{ id: string }>
    delete: (installationId: string, folder: string) => Promise<{ folder: string }>
    openFolder: (installationId: string, folder?: string | null) => Promise<string>
  }
  servers: {
    list: () => Promise<ServerEntry[]>
    add: (input: { name?: string; address: string; edition?: ServerEdition }) => Promise<ServerEntry>
    update: (id: string, patch: { name?: string; address?: string }) => Promise<ServerEntry>
    remove: (id: string) => Promise<{ id: string; name: string }>
    ping: (address: string, edition?: ServerEdition) => Promise<ServerStatus>
    markJoined: (id: string) => Promise<ServerEntry>
  }
  horizon: {
    status: (options?: { force?: boolean }) => Promise<HorizonStatus>
    releases: (options?: { force?: boolean }) => Promise<HorizonReleaseCatalog>
    install: (tag: string) => Promise<HorizonInstallJob>
    cancelInstall: () => Promise<HorizonInstallJob>
    launch: (version?: string | null) => Promise<HorizonLaunchResult>
    openFolder: (kind: HorizonFolderKind, version?: string | null) => Promise<string>
  }
  bedrock: {
    status: (options?: { force?: boolean }) => Promise<BedrockStatus>
    launch: (id: string, serverAddress?: string | null) => Promise<BedrockLaunchResult>
    worlds: (id: string) => Promise<BedrockWorldsResult>
    openFolder: (id: string, folder?: string | null) => Promise<string>
    backupWorld: (editionId: string, folder: string, note?: string | null) => Promise<BedrockWorldBackup>
    restoreBackup: (editionId: string, backupId: string) => Promise<BedrockWorldRestoreResult>
    deleteBackup: (editionId: string, backupId: string) => Promise<{ id: string; editionId: string }>
    versions: (options?: { force?: boolean }) => Promise<BedrockCatalog>
    versionsState: () => Promise<BedrockVersionsState>
    downloadVersion: (version: string) => Promise<{ version: string; package: string; directory: string; sizeBytes: number }>
    cancelVersion: (version: string) => Promise<{ version: string; cancelled: boolean }>
    removeVersion: (version: string) => Promise<{ version: string }>
    openVersionFolder: (version: string) => Promise<string>
    registerCommand: (version: string) => Promise<{ manifest: string; command: string }>
    registerVersion: (
      version: string,
      options?: { ignoreMissingDependencies?: boolean },
    ) => Promise<BedrockRegistrationResult>
    installVersion: (version: string) => Promise<BedrockInstallResult>
    addons: (editionId: string) => Promise<BedrockAddonsResult>
    importAddon: (editionId: string, filePath: string) => Promise<BedrockAddonImportResult>
    removeAddon: (editionId: string, kind: string, folder: string) => Promise<{ folder: string; kind: string }>
    openAddonFolder: (editionId: string, kind?: string | null) => Promise<string>
  }
  logs: {
    list: () => Promise<LogsList>
    read: (request: {
      category: 'launcher' | 'game' | 'crash'
      file: string
      installationId?: string
    }) => Promise<LogReadResult>
    openFolder: (request?: { category?: string; installationId?: string }) => Promise<string>
    openFile: (request: {
      category: 'launcher' | 'game' | 'crash'
      file: string
      installationId?: string
    }) => Promise<string>
    exportDiagnostics: () => Promise<{ path: string; filename: string }>
  }
  system: {
    openFolder: (
      kind:
        | 'data'
        | 'minecraft'
        | 'instances'
        | 'logs'
        | 'avatars'
        | 'versions'
        | 'assets'
        | 'backups'
        | 'bedrock'
        | 'game',
      installationId?: string,
    ) => Promise<string>
    pathExists: (target: string, type?: 'any' | 'file' | 'directory') => Promise<boolean>
  }
  dialogs: {
    chooseDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>
    chooseJava: () => Promise<string | null>
    chooseAddon: () => Promise<string | null>
  }
  events: {
    subscribe: (handler: (event: { type: string; payload: unknown }) => void) => () => void
  }
}

declare global {
  interface Window {
    aqua?: AquaApi
  }
}

export const api: AquaApi = window.aqua as AquaApi

export const isDesktop = Boolean(window.aqua)

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong. Please try again.'
}

export type EventPayloadMap = {
  installations: { installations: Installation[] }
  settings: { settings: Settings }
  accounts: AccountsState
  activity: { activity: ActivityEntry[]; sessions: SessionEntry[] }
  downloads: { jobs: DownloadJob[] }
  game: GameState
  auth: AuthState
  notification: { level: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string }
  windowState: { maximized: boolean }
  'bedrock-versions': BedrockDownloadProgress
  'horizon-install': HorizonInstallJob
  'storage:progress': StorageProgress
  'bedrock-addons': { editionId: string; installed: string[]; filename: string }
}
