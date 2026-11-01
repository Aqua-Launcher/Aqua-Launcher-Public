import {
  app,
  BrowserWindow,
  Menu,
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
import { BedrockService } from './core/bedrock.js'
import { BedrockAddonsService } from './core/bedrock-addons.js'
import { BedrockVersionsService } from './core/bedrock-versions.js'
import { BlockTextureService } from './core/block-textures.js'
import { GameManager } from './core/game.js'
import { HorizonService } from './core/horizon.js'
import { InstallationService } from './core/installations.js'
import { Installer } from './core/installer.js'
import { JavaService } from './core/java.js'
import { JobManager } from './core/jobs.js'
import { LoaderService } from './core/loaders.js'
import { LogService } from './core/logs.js'
import { MinecraftSettingsService } from './core/minecraft-settings.js'
import { ModrinthService } from './core/modrinth.js'
import { ModRetargetService } from './core/mod-retarget.js'
import { createLogger } from './core/logger.js'
import { ensureAppDirs, getPaths, getTrayIconPath, getWindowIconPath } from './core/paths.js'
import { ServerService } from './core/servers.js'
import { StorageService } from './core/storage.js'
import { Store } from './core/store.js'
import { getSystemInfo } from './core/system.js'
import { VersionService } from './core/versions.js'
import { WorldsService } from './core/worlds.js'
import { registerIpc } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged && process.argv.includes('--dev')
const DEV_URL = 'http://localhost:5173'

app.setName('Aqua Launcher')
app.setPath('userData', path.join(app.getPath('appData'), 'Aqua Launcher'))
if (process.platform === 'win32') app.setAppUserModelId('com.aqua.launcher')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
let tray = null
let logger = null
let services = null
let store = null
let startHidden = false

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
  if (!app.isPackaged) return
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
  logger.setLevel(store.settings.logging.level)

  const versionService = new VersionService({ paths, logger })
  const artworkService = new ArtworkService({ paths, logger })
  const javaService = new JavaService({ paths, logger })
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
  const blockTextureService = new BlockTextureService({ paths, installationService, logger })
  const storageService = new StorageService({
    paths,
    store,
    logger,
    // Cleanup never deletes permanently: everything goes to the OS recycle bin.
    trashItem: (target) => shell.trashItem(target),
    emitProgress: (payload) => broadcast('storage:progress', payload),
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
  const emitNotification = (notification) => broadcast('notification', notification)
  const emitJobs = (jobs) => broadcast('downloads', { jobs })
  const emitGame = (game) => broadcast('game', game)
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

  // Modpacks create their own installation and queue its game download, so the
  // Modrinth service needs those services to exist first.
  const modrinthService = new ModrinthService({ logger, installationService, jobManager, store, paths })
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
  })

  services = {
    paths,
    store,
    logger,
    versionService,
    artworkService,
    loaderService,
    modrinthService,
    modRetargetService,
    minecraftSettingsService,
    worldsService,
    serverService,
    bedrockService,
    bedrockVersionsService,
    bedrockAddonsService,
    horizonService,
    installationService,
    javaService,
    accountManager,
    jobManager,
    gameManager,
    logService,
    blockTextureService,
    storageService,
    systemInfo,
  }

  registerIpc({
    ...services,
    emitInstallations,
    emitActivity,
    emitSettings,
    applyStartupSettings,
    applyUiScale,
    getMainWindow: () => mainWindow,
  })

  Menu.setApplicationMenu(null)
  await applyStartupSettings(store.settings)

  const startMinimized = store.settings.startup.startMinimized && process.argv.includes('--hidden')
  startHidden = startMinimized
  createWindow()

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
  try {
    await initialize()
  } catch (error) {
    try {
      logger?.error('Launcher initialization failed', { message: error.message, stack: error.stack })
    } catch {
      // Ignore.
    }
    dialog.showErrorBox(
      'Aqua Launcher could not start',
      `${error.message}\n\nIf this keeps happening, check the launcher log in your AppData folder.`,
    )
    app.quit()
  }
})

app.on('second-instance', () => {
  showMainWindow()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
  else showMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    services?.accountManager?.dispose()
    services?.horizonService?.dispose()
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
