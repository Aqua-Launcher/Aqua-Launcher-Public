import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  nativeImage,
  net,
  session,
  shell,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccountManager } from './core/accounts.js'
import {
  ADDON_BROWSER_PARTITION,
  allowAddonBrowserWebviews,
  attachAddonDownloads,
} from './core/addon-browser.js'
import { ArtworkService } from './core/artwork.js'
import { BackupScheduler } from './core/backup-scheduler.js'
import { BedrockService } from './core/bedrock.js'
import { BedrockAddonsService } from './core/bedrock-addons.js'
import { BedrockVersionsService } from './core/bedrock-versions.js'
import { BlockTextureService } from './core/block-textures.js'
import { ContentIndexService } from './core/content-index.js'
import { DocImageService } from './core/doc-images.js'
import { GameManager } from './core/game.js'
import { HorizonService } from './core/horizon.js'
import { HealthService } from './core/health.js'
import { HorizonRegistryService } from './core/horizon-registry.js'
import { HorizonNativeBuilder } from './core/horizon-native.js'
import { InstallationService } from './core/installations.js'
import { Installer } from './core/installer.js'
import { JavaService } from './core/java.js'
import { JobManager } from './core/jobs.js'
import { LanDiscoveryService } from './core/lan-discovery.js'
import { LauncherImportService } from './core/launcher-import.js'
import { LoaderService } from './core/loaders.js'
import { LogService } from './core/logs.js'
import { MinecraftSettingsService } from './core/minecraft-settings.js'
import { ModrinthService } from './core/modrinth.js'
import { ModpackImportService } from './core/modpack-import.js'
import { ModpackExportService } from './core/modpack-export.js'
import { ModRetargetService } from './core/mod-retarget.js'
import { NotificationService } from './core/notifications.js'
import { createLogger } from './core/logger.js'
import { ensureAppDirs, getPaths, getTrayIconPath, getWindowIconPath, setPortableInfo } from './core/paths.js'
import { buildPortablePlan, preparePortableDataRoot } from './core/portable.js'
import { DiscordPresence } from './core/discord-presence.js'
import { ServerService } from './core/servers.js'
import { ScreenshotService } from './core/screenshots.js'
import { StorageService } from './core/storage.js'
import { Store } from './core/store.js'
import { getSystemInfo } from './core/system.js'
import { VersionService } from './core/versions.js'
import { WorldsService } from './core/worlds.js'
import {
  LINK_EXAMPLES,
  LINK_SCHEME,
  buildStatusPayload,
  formatStatusText,
  parseAquaLink,
  parseCommandLine,
} from './core/deep-links.js'
import { readJsonFile } from './core/util.js'
import { registerIpc } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged && process.argv.includes('--dev')
const DEV_URL = 'http://localhost:5173'

app.setName('Aqua Launcher')
const defaultUserData = path.join(app.getPath('appData'), 'Aqua Launcher')
const portablePlan = buildPortablePlan({
  argv: process.argv,
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  appPath: app.getAppPath(),
})
const portableState = {
  active: false,
  source: portablePlan.source,
  warning: null,
}
let portableStartupWarning = null
if (portablePlan.requested) {
  const prepared = preparePortableDataRoot(portablePlan.dataRoot)
  if (prepared.ok) {
    portableState.active = true
    for (const [name, value] of Object.entries(prepared.overrides)) app.setPath(name, value)
  } else {
    portableState.warning = `Portable mode could not use ${portablePlan.dataRoot}: ${prepared.error}. Aqua is using ${defaultUserData} instead.`
    portableStartupWarning = portableState.warning
    app.setPath('userData', defaultUserData)
  }
} else {
  app.setPath('userData', defaultUserData)
}
setPortableInfo(portableState)
if (process.platform === 'win32') app.setAppUserModelId('com.aqua.launcher')

const gotLock = app.requestSingleInstanceLock()

let startupArgument = null
let startupArgumentError = null
try {
  startupArgument = parseCommandLine(process.argv)
} catch (error) {
  startupArgumentError = error
}

let mainWindow = null
let tray = null
let logger = null
let services = null
let store = null
let startHidden = false
let quitting = false
let rendererReady = false
let pendingIntents = []

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs')
}

function broadcast(type, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:event', { type, payload })
    }
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  startHidden = false
}

function protocolClientArguments() {
  if (app.isPackaged || process.platform !== 'win32') return []
  const appEntry = process.argv[1] ? path.resolve(process.argv[1]) : path.join(__dirname, '..')
  return [appEntry]
}

function registerProtocolClient() {
  if (portableState.active) return false
  try {
    const args = protocolClientArguments()
    return app.isPackaged || !args.length
      ? app.setAsDefaultProtocolClient(LINK_SCHEME)
      : app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, args)
  } catch (error) {
    logger?.warn('Could not register aqua:// links', { message: error.message })
    return false
  }
}

function protocolClientState() {
  if (portableState.active) return false
  try {
    const args = protocolClientArguments()
    return app.isPackaged || !args.length
      ? app.isDefaultProtocolClient(LINK_SCHEME)
      : app.isDefaultProtocolClient(LINK_SCHEME, process.execPath, args)
  } catch {
    return false
  }
}

function protocolStatus() {
  return {
    scheme: `${LINK_SCHEME}://`,
    registered: protocolClientState(),
    portable: portableState.active,
    examples: LINK_EXAMPLES,
  }
}

function writeCli(text, stream = process.stdout) {
  try {
    stream.write(text)
  } catch {
    // A GUI process without an attached console has nowhere to print.
  }
}

function printCliError(error) {
  writeCli(`Aqua: ${error?.message || error}\n`, process.stderr)
  process.exitCode = 1
}

async function readStatusPayload(launcherRunning) {
  const paths = getPaths()
  const config = await readJsonFile(paths.configFile, null)
  return buildStatusPayload({
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    installations: Array.isArray(config?.installations) ? config.installations : [],
    activeInstallationId: typeof config?.activeInstallationId === 'string' ? config.activeInstallationId : null,
    launcherRunning,
  })
}

async function printStatus(json, launcherRunning) {
  const payload = await readStatusPayload(launcherRunning)
  writeCli(json ? `${JSON.stringify(payload, null, 2)}\n` : formatStatusText(payload))
}

function flushPendingIntents() {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return
  const queued = pendingIntents
  pendingIntents = []
  for (const intent of queued) broadcast('app:route', { intent })
}

/** Routes one validated action into the same handlers the UI uses. */
function dispatchIntent(intent) {
  if (!intent || intent.kind === 'status') return
  pendingIntents = [...pendingIntents, intent].slice(-10)
  if (!mainWindow || mainWindow.isDestroyed()) return
  showMainWindow()
  flushPendingIntents()
}

function createTray() {
  if (tray) return
  const iconPath = getTrayIconPath()
  if (!iconPath) {
    logger?.warn('Tray icon not found; showing the launcher window instead of starting hidden')
    showMainWindow()
    return
  }
  try {
    let icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      logger.warn('Tray icon could not be loaded')
      showMainWindow()
      return
    }
    icon = icon.resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('Aqua Launcher')
    const menu = Menu.buildFromTemplate([
      { label: 'Open Aqua Launcher', click: () => showMainWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => showMainWindow())
  } catch (error) {
    logger?.warn('Could not create system tray icon', { message: error.message })
    tray = null
    showMainWindow()
  }
}

function createWindow() {
  rendererReady = false
  const iconPath = getWindowIconPath()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    frame: false,
    thickFrame: true,
    backgroundColor: '#0e091c',
    title: 'Aqua Launcher',
    icon: iconPath || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Only the Bedrock add-on browser attaches a webview, and only into its
      // own locked-down session (see core/addon-browser.js).
      webviewTag: true,
      spellcheck: false,
      devTools: isDev,
    },
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      createTray()
      if (!tray) showMainWindow()
    } else {
      mainWindow?.show()
    }
  })

  const emitWindowState = () => {
    broadcast('windowState', { maximized: mainWindow?.isMaximized() || false })
  }
  mainWindow.on('maximize', emitWindowState)
  mainWindow.on('unmaximize', emitWindowState)
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(DEV_URL)) return
    event.preventDefault()
    logger?.warn('Blocked renderer navigation', { url })
  })
  allowAddonBrowserWebviews(mainWindow, {
    openExternal: (url) => {
      shell.openExternal(url).catch((error) => logger?.warn('Could not open a browser link', { message: error.message }))
    },
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('Renderer process exited unexpectedly', { reason: details.reason })
    if (!mainWindow?.isDestroyed() && mainWindow) {
      mainWindow.webContents.reload()
    }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, description, url) => {
    logger?.error('Renderer failed to load', { errorCode, description, url })
  })
  mainWindow.webContents.on('did-finish-load', () => {
    applyUiScale(store?.settings.uiScale)
  })
  return mainWindow
}

function applyUiScale(scale) {
  const value = Number(scale)
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!Number.isFinite(value) || value < 0.5 || value > 2) return
  mainWindow.webContents.setZoomFactor(value)
}

async function applyStartupSettings(settings) {
  if (!app.isPackaged || portableState.active) return
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: settings.startup.launchAtLogin,
        path: process.execPath,
        args: ['--hidden'],
      })
    } else {
      app.setLoginItemSettings({ openAtLogin: settings.startup.launchAtLogin })
    }
  } catch (error) {
    logger?.warn('Could not update the login item setting', { message: error.message })
  }
}

async function initialize() {
  const paths = getPaths()
  await ensureAppDirs(paths)
  logger = createLogger(paths, 'info')
  logger.info('Aqua Launcher starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dev: isDev,
    dataRoot: paths.dataRoot,
  })

  const systemInfo = getSystemInfo(paths)
  store = new Store({
    configFile: paths.configFile,
    instancesRoot: paths.instancesRoot,
    totalMemMb: systemInfo.totalMemMb,
    logger,
  })
  await store.init()
  if (paths.portable && store.settings.startup.launchAtLogin) {
    await store.replaceSettings({
      ...store.settings,
      startup: { ...store.settings.startup, launchAtLogin: false },
    })
    logger.info('Disabled launch at login for portable mode')
  }
  logger.setLevel(store.settings.logging.level)

  const versionService = new VersionService({ paths, logger })
  const artworkService = new ArtworkService({ paths, versions: versionService, logger })
  const docImageService = new DocImageService({ logger })
  const javaService = new JavaService({ paths, logger })
  const healthService = new HealthService({ store, paths, javaService })
  const loaderService = new LoaderService({ paths, versionService, javaService, logger })
  const installer = new Installer({ paths, versionService, loaderService, logger })
  const installationService = new InstallationService({
    paths,
    store,
    versionService,
    javaService,
    logger,
  })
  const logService = new LogService({ paths, store, logger })
  const minecraftSettingsService = new MinecraftSettingsService({ paths, store, logger })
  const worldsService = new WorldsService({ paths, store, logger })
  const serverService = new ServerService({ store, logger })
  const lanDiscovery = new LanDiscoveryService({
    logger,
    onChange: (snapshot) => broadcast('servers:lan', snapshot),
  })
  const blockTextureService = new BlockTextureService({ paths, installationService, logger })
  const contentIndexService = new ContentIndexService({ paths, logger })
  const storageService = new StorageService({
    paths,
    store,
    logger,
    // Cleanup never deletes permanently: everything goes to the OS recycle bin.
    trashItem: (target) => shell.trashItem(target),
    emitProgress: (payload) => broadcast('storage:progress', payload),
  })
  const screenshotService = new ScreenshotService({
    paths,
    nativeImage,
    trashItem: (target) => shell.trashItem(target),
    logger,
  })
  const bedrockService = new BedrockService({
    logger,
    store,
    paths,
    openExternal: (url) => shell.openExternal(url),
    openPath: (target) => shell.openPath(target),
    // Defined below; the launcher is already up by the time a game can launch.
    emitActivity: () => emitActivity(),
  })
  const horizonService = new HorizonService({
    paths,
    installer,
    javaService,
    logger,
    store,
    openPath: (target) => shell.openPath(target),
    // Defined below; the launcher is already up by the time an install or launch happens.
    emitActivity: () => emitActivity(),
    emitNotification: (notification) => emitNotification(notification),
    emitProgress: (job) => broadcast('horizon-install', job),
  })
  const horizonRegistryService = new HorizonRegistryService({
    paths,
    horizonService,
    logger,
    store,
    emitActivity: () => emitActivity(),
  })
  const horizonNativeBuilder = new HorizonNativeBuilder({
    paths,
    horizonService,
    logger,
    store,
    emitProgress: (job) => broadcast('horizon-native', job),
    emitNotification: (notification) => emitNotification(notification),
    emitActivity: () => emitActivity(),
  })
  const bedrockAddonsService = new BedrockAddonsService({ logger, bedrockService })
  const bedrockVersionsService = new BedrockVersionsService({
    paths,
    logger,
    bedrockService,
    // Electron's own network stack, so proxied or TLS-inspected connections keep working.
    fetchImpl: (url, options) => net.fetch(url, options),
    emitProgress: (payload) => broadcast('bedrock-versions', payload),
  })

  let installationEmitQueue = Promise.resolve()
  const emitInstallations = () => {
    installationEmitQueue = installationEmitQueue
      .catch(() => {})
      .then(async () => {
        const installations = await installationService.list()
        broadcast('installations', { installations })
        return installations
      })
    installationEmitQueue.catch((error) => logger.error('Could not broadcast installations', { message: error.message }))
    return installationEmitQueue
  }
  const emitActivity = () => broadcast('activity', { activity: store.activity, sessions: store.sessions })
  const notificationService = new NotificationService({
    store,
    logger,
    broadcast,
    isWindowActive: () =>
      Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()),
    showNative: (notification) => {
      if (!Notification.isSupported()) return
      const native = new Notification({
        title: notification.title,
        body: notification.message || undefined,
      })
      native.on('click', () => showMainWindow())
      native.show()
    },
  })
  const emitNotification = (notification) => {
    void notificationService.notify(notification).catch((error) => {
      logger?.warn?.('Notification delivery failed', { message: error.message })
    })
  }
  const discordPresence = new DiscordPresence({
    logger,
    onJoinRequest: (server) =>
      dispatchIntent({
        kind: 'join',
        server,
        instance: null,
        edition: 'java',
        confirmed: false,
        source: 'link',
      }),
  })
  discordPresence.applySettings(store.settings.discord)
  const emitJobs = (jobs) => broadcast('downloads', { jobs })
  const emitGame = (game) => {
    broadcast('game', game)
    const installation = game?.installationId ? store.getInstallation(game.installationId) : null
    discordPresence.updateFromGame(game, { loader: installation?.loader || null })
  }
  const emitSettings = (settings) => broadcast('settings', { settings })
  const emitAccounts = (payload) => broadcast('accounts', payload)
  const emitAuth = (auth) => broadcast('auth', auth)

  const accountManager = new AccountManager({
    paths,
    store,
    logger,
    emitAccounts,
    emitAuth,
    emitActivity,
    emitNotification,
  })
  await accountManager.init()

  const jobManager = new JobManager({
    store,
    installer,
    javaService,
    paths,
    logger,
    emitJobs,
    emitActivity,
    emitInstallation: emitInstallations,
    emitNotification,
    emitInstallations,
  })

  const backupScheduler = new BackupScheduler({
    store,
    worldsService,
    jobManager,
    logger,
    emitBackups: (status) => broadcast('backups', status),
    emitActivity,
    emitNotification,
  })

  // Modpacks create their own installation and queue its game download, so the
  // Modrinth service needs those services to exist first.
  const modrinthService = new ModrinthService({ logger, installationService, jobManager, store, paths, loaderService })
  const modpackImportService = new ModpackImportService({
    modrinthService,
    installationService,
    loaderService,
    jobManager,
    logger,
  })
  const launcherImportService = new LauncherImportService({
    installationService,
    modpackImportService,
    loaderService,
    jobManager,
    store,
    logger,
  })
  const modpackExportService = new ModpackExportService({ modrinthService, logger })
  const modRetargetService = new ModRetargetService({ logger, modrinthService })

  const gameManager = new GameManager({
    paths,
    versionService,
    accountManager,
    javaService,
    store,
    logger,
    minecraftSettingsService,
    emitGame,
    emitActivity,
    emitNotification,
    emitInstallations,
    restoreWindow: showMainWindow,
    onSessionEnd: (session) => backupScheduler.onGameExit(session.installationId),
  })

  services = {
    paths,
    store,
    logger,
    versionService,
    artworkService,
    docImageService,
    loaderService,
    modrinthService,
    modpackImportService,
    launcherImportService,
    modpackExportService,
    modRetargetService,
    minecraftSettingsService,
    worldsService,
    serverService,
    lanDiscovery,
    bedrockService,
    bedrockVersionsService,
    bedrockAddonsService,
    horizonService,
    horizonRegistryService,
    horizonNativeBuilder,
    installationService,
    javaService,
    healthService,
    accountManager,
    jobManager,
    backupScheduler,
    gameManager,
    discordPresence,
    logService,
    blockTextureService,
    contentIndexService,
    storageService,
    screenshotService,
    systemInfo,
  }

  lanDiscovery.start()

  registerIpc({
    ...services,
    emitInstallations,
    emitActivity,
    emitSettings,
    applyStartupSettings,
    applyUiScale,
    getMainWindow: () => mainWindow,
    linkService: {
      status: protocolStatus,
      register: () => {
        registerProtocolClient()
        return protocolStatus()
      },
    },
    onRendererReady: () => {
      rendererReady = true
      flushPendingIntents()
    },
  })

  Menu.setApplicationMenu(null)
  await applyStartupSettings(store.settings)

  // A previous launcher or game may have been killed while Safe Mode had
  // content staged. Put it back before the window appears, so the user never
  // sees (or launches) a half-safe game directory.
  try {
    const recovered = await gameManager.recoverSafeMode()
    if (recovered.sessions.length) {
      logger.info('Safe Mode recovery finished before startup', {
        sessions: recovered.sessions.length,
        restored: recovered.restored,
        conflicts: recovered.conflicts,
      })
    }
  } catch (error) {
    logger.warn('Safe Mode recovery failed at startup', { message: error.message })
  }

  const startMinimized = store.settings.startup.startMinimized && process.argv.includes('--hidden')
  startHidden = startMinimized
  createWindow()
  backupScheduler.start()
  mainWindow?.on('focus', () => void backupScheduler.check())

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  // The add-on browser is a separate session: no permissions, no shared cookies
  // with the launcher, and Bedrock pack downloads install themselves.
  const addonBrowserSession = session.fromPartition(ADDON_BROWSER_PARTITION)
  addonBrowserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  addonBrowserSession.setPermissionCheckHandler(() => false)
  attachAddonDownloads({
    browserSession: addonBrowserSession,
    bedrockService,
    bedrockAddonsService,
    downloadsDirectory: app.getPath('downloads'),
    logger,
    notify: emitNotification,
    onImported: ({ editionId }) => broadcast('bedrock-addons', { editionId }),
  })

  accountManager.restoreActiveSession().catch((error) => {
    logger.warn('Could not restore the active account session', { message: error.message })
  })
  if (store.settings.startup.refreshJavaOnStart) {
    javaService.detect().catch((error) => logger.debug('Background Java detection failed', { message: error.message }))
  }
  versionService.getManifest().catch((error) => logger.debug('Background version sync failed', { message: error.message }))
}

app.whenReady().then(async () => {
  if (!gotLock) {
    // The primary instance is authoritative; it receives this process's argv
    // through second-instance. Status is read-only, so it can answer here.
    if (startupArgumentError) {
      printCliError(startupArgumentError)
    } else if (startupArgument?.kind === 'status') {
      try {
        await printStatus(startupArgument.json === true, true)
      } catch (error) {
        printCliError(error)
      }
    } else if (startupArgument) {
      if (startupArgument.json) {
        writeCli(`${JSON.stringify({ forwarded: true, action: startupArgument.kind })}\n`)
      } else {
        writeCli('Sent to the running Aqua Launcher. Confirm the action there.\n')
      }
    }
    app.quit()
    return
  }

  if (startupArgumentError) {
    printCliError(startupArgumentError)
    app.quit()
    return
  }
  if (startupArgument?.kind === 'status') {
    try {
      await printStatus(startupArgument.json === true, false)
    } catch (error) {
      printCliError(error)
    }
    app.quit()
    return
  }

  if (portableStartupWarning) {
    dialog.showErrorBox('Portable mode unavailable', portableStartupWarning)
  }

  try {
    registerProtocolClient()
    await initialize()
    if (startupArgument) dispatchIntent(startupArgument)
  } catch (error) {
    try {
      logger?.error('Launcher initialization failed', { message: error.message, stack: error.stack })
    } catch {
      // Ignore.
    }
    dialog.showErrorBox(
      'Aqua Launcher could not start',
      `${error.message}\n\nIf this keeps happening, check the launcher log in ${portableState.active ? 'AquaData\\logs' : 'your AppData folder'}.`,
    )
    app.quit()
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  try {
    dispatchIntent(parseAquaLink(url))
  } catch (error) {
    logger?.warn('Ignored an invalid Aqua link', { message: error.message })
  }
})

app.on('second-instance', (_event, argv) => {
  let intent = null
  try {
    intent = parseCommandLine(argv)
  } catch (error) {
    logger?.warn('Ignored an invalid command line', { message: error.message })
    return
  }
  if (!intent) {
    showMainWindow()
    return
  }
  if (intent.kind !== 'status') dispatchIntent(intent)
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
  else showMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  // Give Safe Mode one async chance to put content back. If the restore keeps
  // failing the second pass quits anyway; startup recovery will retry.
  if (!quitting && services?.gameManager?.hasPendingSafeMode?.()) {
    event.preventDefault()
    quitting = true
    services.gameManager
      .restoreSafeModeOnQuit()
      .catch((error) => logger?.warn('Could not restore Safe Mode content on quit', { message: error.message }))
      .finally(() => app.quit())
    return
  }
  try {
    services?.lanDiscovery?.stop()
    services?.accountManager?.dispose()
    services?.backupScheduler?.stop()
    services?.discordPresence?.dispose()
    services?.horizonService?.dispose()
    services?.horizonNativeBuilder?.dispose()
    logger?.info('Aqua Launcher shutting down')
  } catch {
    // Ignore shutdown logging failures.
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
})

process.on('uncaughtException', (error) => {
  logger?.error('Uncaught exception', { message: error?.message, stack: error?.stack })
})

process.on('unhandledRejection', (reason) => {
  logger?.error('Unhandled promise rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

process.on('exit', () => {
  try {
    if (fs.existsSync(app.getPath('userData'))) {
      // Nothing else to flush; the logger writes synchronously.
    }
  } catch {
    // Ignore.
  }
})
