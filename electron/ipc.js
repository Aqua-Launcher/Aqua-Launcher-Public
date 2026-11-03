import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { normalizeSettings, validateSettings } from './core/settings.js'
import { analyzeCrash } from './core/crash-analysis.js'
import { normalizeServerAddress } from './core/servers.js'
import { getPlatformLabel, getSystemInfo } from './core/system.js'
import { ensureDir, isAllowedExternalUrl, isPathInside } from './core/util.js'
import { findConflicts } from './core/content-conflicts.js'
import { runImports } from './core/content-import.js'
import { buildPlaytimeStats, sessionsToCsv } from './core/stats.js'

const CONTENT_INDEX_TYPES = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
}

function requireString(value, label, maxLength = 4096) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  if (value.length > maxLength) throw new Error(`${label} is too long.`)
  return value.trim()
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`)
  return value
}

function mergeSettings(current, patch) {
  const merged = { ...current, ...patch }
  for (const key of [
    'java',
    'memory',
    'downloads',
    'window',
    'startup',
    'logging',
    'minecraftSettings',
    'backups',
    'discord',
  ]) {
    if (patch[key] !== undefined) {
      merged[key] = { ...current[key], ...requireObject(patch[key], key) }
    }
  }
  // Custom theme surfaces merge one level deeper so a patch can update a single
  // surface without dropping the other two.
  if (patch.notifications !== undefined) {
    const next = requireObject(patch.notifications, 'Notifications')
    const currentLevels = current.notifications?.levels || {}
    merged.notifications = {
      ...(current.notifications || {}),
      ...next,
      levels: {
        ...currentLevels,
        ...(next.levels && typeof next.levels === 'object' ? next.levels : {}),
      },
    }
  }
  if (patch.customTheme !== undefined) {
    const next = requireObject(patch.customTheme, 'Custom theme')
    const existing = current.customTheme || {}
    const theme = { ...existing, ...next }
    for (const key of ['sidebar', 'titlebar', 'backdrop']) {
      if (next[key] !== undefined) {
        theme[key] = { ...(existing[key] || {}), ...requireObject(next[key], key) }
      }
    }
    merged.customTheme = theme
  }
  return merged
}

export function registerIpc({
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
  accountManager,
  javaService,
  healthService,
  contentIndexService,
  jobManager,
  gameManager,
  backupScheduler,
  discordPresence,
  logService,
  blockTextureService,
  storageService,
  screenshotService,
  emitInstallations,
  emitActivity,
  emitSettings,
  applyStartupSettings,
  applyUiScale,
  getMainWindow,
  linkService,
  onRendererReady,
}) {
  const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender)
  const requireInstallation = (id) => {
    const installation = store.getInstallation(requireString(id, 'Installation ID', 128))
    if (!installation) throw new Error('Installation not found.')
    return installation
  }

  ipcMain.handle('app:bootstrap', async () => {
    const [installations] = await Promise.all([installationService.list()])
    return {
      app: {
        name: 'Aqua Launcher',
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: getPlatformLabel(),
        canLaunchAtLogin: app.isPackaged && !paths.portable,
        portable: paths.portable,
        portableSource: paths.portableSource,
        portableWarning: paths.portableWarning,
      },
      settings: store.settings,
      notifications: store.notifications,
      installations,
      accounts: accountManager.accountsPayload(),
      activity: store.activity,
      sessions: store.sessions,
      jobs: jobManager.list(),
      game: gameManager.getState(),
      backups: backupScheduler.status(),
      auth: accountManager.getAuthState(),
      versions: versionService.getCachedManifestSync(),
      system: getSystemInfo(paths),
      paths: {
        dataRoot: paths.dataRoot,
        minecraftRoot: paths.minecraftRoot,
        instancesRoot: paths.instancesRoot,
        logsRoot: paths.logsRoot,
      },
    }
  })

  ipcMain.handle('block-textures:list', async (_event, options = {}) => {
    const force = options?.force === true
    return blockTextureService.list({ force })
  })

  ipcMain.handle('app:openExternal', async (_event, { url }) => {
    const value = requireString(url, 'URL')
    if (!isAllowedExternalUrl(value)) throw new Error('That link is not allowed.')
    await shell.openExternal(value)
    return true
  })

  ipcMain.handle('app:rendererReady', async () => {
    onRendererReady?.()
    return true
  })

  ipcMain.handle('app:linkStatus', async () => linkService.status())
  ipcMain.handle('app:registerLinks', async () => linkService.register())

  ipcMain.handle('app:rendererError', async (_event, payload) => {
    logger.error('Renderer error', {
      message: String(payload?.message || 'Unknown renderer error').slice(0, 2000),
      stack: String(payload?.stack || '').slice(0, 4000),
    })
    return true
  })

  ipcMain.handle('window:minimize', (event) => {
    senderWindow(event)?.minimize()
    return true
  })

  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = senderWindow(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('window:close', (event) => {
    senderWindow(event)?.close()
    return true
  })

  ipcMain.handle('window:getState', (event) => {
    const win = senderWindow(event)
    return { maximized: Boolean(win?.isMaximized()), focused: Boolean(win?.isFocused()) }
  })

  ipcMain.handle('window:setZoom', (event, { scale } = {}) => {
    const value = Number(scale)
    if (!Number.isFinite(value) || value < 0.8 || value > 1.3) throw new Error('Interface scale is out of range.')
    const win = senderWindow(event)
    if (!win) return false
    win.webContents.setZoomFactor(value)
    return true
  })

  ipcMain.handle('versions:list', async (_event, { force = false } = {}) => {
    return versionService.getManifest({ force: Boolean(force) })
  })

  ipcMain.handle('artwork:versionArt', async (_event, { versionId } = {}) => {
    return artworkService.getVersionArt(typeof versionId === 'string' ? versionId.slice(0, 64) : '')
  })

  // README and ROADMAP images are bundled documents, so the main process fetches
  // them and returns a data URL; the renderer keeps its narrow img-src policy.
  ipcMain.handle('docs:image', async (_event, { url } = {}) => {
    return docImageService.load(requireString(url, 'Image address', 2048))
  })

  ipcMain.handle('installations:list', async () => installationService.list())

  ipcMain.handle('installations:get', async (_event, { id }) => {
    return installationService.get(requireString(id, 'Installation ID', 128))
  })

  ipcMain.handle('installations:create', async (_event, input) => {
    const result = await installationService.create(requireObject(input, 'Installation details'))
    await emitInstallations()
    emitActivity()
    return result
  })

  ipcMain.handle('installations:update', async (_event, { id, patch }) => {
    const result = await installationService.update(
      requireString(id, 'Installation ID', 128),
      requireObject(patch, 'Installation changes'),
    )
    await emitInstallations()
    emitActivity()
    return result
  })

  ipcMain.handle('installations:reorder', async (_event, { ids } = {}) => {
    if (!Array.isArray(ids)) throw new Error('Choose a new installation order.')
    const result = await installationService.reorder(ids)
    await emitInstallations()
    return result
  })

  ipcMain.handle('installations:duplicate', async (_event, { id }) => {
    const result = await installationService.duplicate(requireString(id, 'Installation ID', 128))
    await emitInstallations()
    emitActivity()
    return result
  })

  ipcMain.handle('installations:remove', async (_event, { id }) => {
    const result = await installationService.remove(requireString(id, 'Installation ID', 128))
    await emitInstallations()
    emitActivity()
    return result
  })

  ipcMain.handle('installations:setActive', async (_event, { id }) => {
    const result = await installationService.setActive(requireString(id, 'Installation ID', 128))
    await emitInstallations()
    return result
  })

  ipcMain.handle('installations:install', async (_event, { id }) => {
    const installation = store.getInstallation(requireString(id, 'Installation ID', 128))
    if (!installation) throw new Error('Installation not found.')
    return jobManager.enqueueInstall(installation.id)
  })

  ipcMain.handle('installations:openFolder', async (_event, { id }) => {
    const installation = store.getInstallation(requireString(id, 'Installation ID', 128))
    if (!installation) throw new Error('Installation not found.')
    await ensureDir(installation.gameDir)
    const error = await shell.openPath(installation.gameDir)
    if (error) throw new Error(error)
    return installation.gameDir
  })

  ipcMain.handle('notifications:list', async () => store.notifications)
  ipcMain.handle('notifications:markRead', async (_event, { ids = null } = {}) => {
    const selected = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string').slice(0, 50) : null
    return store.markNotificationsRead(selected)
  })
  ipcMain.handle('notifications:clear', async () => store.clearNotifications())

  ipcMain.handle('stats:summary', async () =>
    buildPlaytimeStats({
      sessions: store.sessions,
      installations: store.installations,
      crashes: store.crashes,
    }),
  )

  ipcMain.handle('stats:exportCsv', async (event) => {
    const { csv, rows } = sessionsToCsv({ sessions: store.sessions, installations: store.installations })
    if (!rows) throw new Error('There are no play sessions to export yet.')
    const result = await dialog.showSaveDialog(senderWindow(event), {
      title: 'Export playtime',
      defaultPath: path.join(
        app.getPath('documents'),
        `aqua-playtime-${new Date().toISOString().slice(0, 10)}.csv`,
      ),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, `\uFEFF${csv}`, 'utf8')
    return { path: result.filePath, rows }
  })

  ipcMain.handle('settings:update', async (_event, patch) => {
    const input = requireObject(patch, 'Settings')
    const merged = mergeSettings(store.settings, input)
    const normalized = normalizeSettings(merged, store.defaults)
    const system = getSystemInfo(paths)
    const validated = await validateSettings(normalized, { totalMemMb: system.totalMemMb })
    if (paths.portable) {
      // Portable mode must not create a Windows login item, even if an older
      // settings file or another surface still asks for one.
      validated.startup = { ...validated.startup, launchAtLogin: false }
    }
    if (validated.java.mode === 'path' && validated.java.path) {
      const info = await javaService.validateJavaPath(validated.java.path)
      validated.java.path = info.path
    }
    const previous = store.settings
    await store.replaceSettings(validated)
    discordPresence?.applySettings(validated.discord)
    logger.setLevel(validated.logging.level)
    if (previous.uiScale !== validated.uiScale) applyUiScale(validated.uiScale)
    if (JSON.stringify(previous.startup) !== JSON.stringify(validated.startup)) {
      await applyStartupSettings(validated)
    }
    emitSettings(validated)
    void backupScheduler.check?.()
    logger.info('Settings updated')
    return validated
  })

  ipcMain.handle('screenshots:list', async (_event, { installationId } = {}) => {
    return screenshotService.list(requireInstallation(installationId))
  })

  ipcMain.handle('screenshots:thumbnail', async (_event, { installationId, filename, size = 480 } = {}) => {
    const installation = requireInstallation(installationId)
    return screenshotService.thumbnail(installation, requireString(filename, 'Screenshot', 255), size)
  })

  ipcMain.handle('screenshots:open', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const target = screenshotService.sourcePath(installation, requireString(filename, 'Screenshot', 255))
    await fsp.access(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  ipcMain.handle('screenshots:reveal', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const target = screenshotService.sourcePath(installation, requireString(filename, 'Screenshot', 255))
    await fsp.access(target)
    shell.showItemInFolder(target)
    return target
  })

  ipcMain.handle('screenshots:copy', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const target = screenshotService.sourcePath(installation, requireString(filename, 'Screenshot', 255))
    const image = nativeImage.createFromPath(target)
    if (!image || image.isEmpty()) throw new Error('This screenshot could not be copied.')
    clipboard.writeImage(image)
    return { filename }
  })

  ipcMain.handle('screenshots:openFolder', async (_event, { installationId } = {}) => {
    const installation = requireInstallation(installationId)
    const target = screenshotService.directoryFor(installation)
    await ensureDir(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  ipcMain.handle('screenshots:delete', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    return screenshotService.delete(installation, requireString(filename, 'Screenshot', 255))
  })

  ipcMain.handle('screenshots:setBackground', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const previous = store.settings.dashboardBackground
    const result = await screenshotService.setAsBackground(
      installation,
      requireString(filename, 'Screenshot', 255),
    )
    try {
      await store.replaceSettings({ ...store.settings, dashboardBackground: result.path })
    } catch (error) {
      await screenshotService.removeBackground(result.path)
      throw error
    }
    if (previous && previous !== result.path) await screenshotService.removeBackground(previous)
    emitSettings(store.settings)
    return { ...result, settings: store.settings }
  })

  ipcMain.handle('screenshots:clearBackground', async () => {
    const previous = store.settings.dashboardBackground
    const settings = { ...store.settings, dashboardBackground: null }
    await store.replaceSettings(settings)
    await screenshotService.removeBackground(previous)
    emitSettings(settings)
    return settings
  })

  ipcMain.handle('screenshots:background', async () => {
    return { dataUrl: await screenshotService.backgroundDataUrl(store.settings.dashboardBackground) }
  })

  ipcMain.handle('accounts:list', async () => accountManager.accountsPayload())
  ipcMain.handle('accounts:getAuthState', async () => accountManager.getAuthState())
  ipcMain.handle('accounts:beginLogin', async () => accountManager.beginLogin())
  ipcMain.handle('accounts:cancelLogin', async () => {
    accountManager.cancelLogin()
    return true
  })
  ipcMain.handle('accounts:switch', async (_event, { id }) => {
    return accountManager.switchAccount(requireString(id, 'Account ID', 64))
  })
  ipcMain.handle('accounts:signOut', async (_event, { id }) => {
    return accountManager.signOut(requireString(id, 'Account ID', 64))
  })
  ipcMain.handle('accounts:refresh', async (_event, { id }) => {
    return accountManager.refreshAccount(requireString(id, 'Account ID', 64))
  })

  ipcMain.handle('java:detect', async (_event, { force = false } = {}) => {
    return javaService.detect({ force: Boolean(force) })
  })
  ipcMain.handle('java:validate', async (_event, { path: javaPath }) => {
    return javaService.validateJavaPath(requireString(javaPath, 'Java path', 4096))
  })
  ipcMain.handle('java:runtimeOptions', async () => javaService.listRuntimeOptions())
  ipcMain.handle('java:installRuntime', async (_event, { component }) => {
    const options = await javaService.listRuntimeOptions()
    const selected = options.find((option) => option.component === component)
    if (!selected) throw new Error('That Java runtime is not available for this system.')
    return jobManager.enqueueJavaRuntime(component, `Installing Java ${selected.major}`)
  })

  ipcMain.handle('loaders:types', async () => loaderService.listTypes())
  ipcMain.handle('loaders:versions', async (_event, { type, minecraftVersion } = {}) => {
    return loaderService.listVersions(
      requireString(type, 'Mod loader', 32),
      requireString(minecraftVersion, 'Minecraft version', 32),
    )
  })
  ipcMain.handle('horizon:mods', async () => horizonService.listMods())
  ipcMain.handle('horizon:importMod', async (_event, { filePath } = {}) => {
    return horizonService.importMod(requireString(filePath, 'Horizon mod file', 4000))
  })
  ipcMain.handle('horizon:toggleMod', async (_event, { filename, kind } = {}) => {
    return horizonService.toggleMod(
      requireString(filename, 'Horizon mod', 260),
      requireString(kind, 'Horizon mod type', 32),
    )
  })
  ipcMain.handle('horizon:removeMod', async (_event, { filename, kind } = {}) => {
    return horizonService.removeMod(
      requireString(filename, 'Horizon mod', 260),
      requireString(kind, 'Horizon mod type', 32),
    )
  })
  ipcMain.handle('horizon:modsFolder', async (_event, { kind = 'content' } = {}) => {
    return horizonService.openModsFolder(requireString(kind, 'Horizon mod type', 32))
  })
  ipcMain.handle('horizon:registry', async (_event, { force = false } = {}) => {
    return horizonRegistryService.list({ force: Boolean(force) })
  })
  ipcMain.handle('horizon:installProject', async (_event, { projectId, version = null } = {}) => {
    return horizonRegistryService.install(
      requireString(projectId, 'Horizon project', 128),
      version ? requireString(version, 'Horizon version', 64) : null,
    )
  })
  ipcMain.handle('horizon:nativeStatus', async () => horizonNativeBuilder.status())
  ipcMain.handle('horizon:buildNative', async (_event, { profile = null } = {}) => {
    if (profile != null && profile !== 'fast' && profile !== 'release') {
      throw new Error('Unknown Horizon build profile.')
    }
    return horizonNativeBuilder.build({ profile })
  })
  ipcMain.handle('horizon:cancelNativeBuild', async () => horizonNativeBuilder.cancel())

  const contentLabel = (contentType) =>
    ({ mod: 'mod', modpack: 'modpack', resourcepack: 'resource pack', shader: 'shader pack' })[contentType] || 'content'

  ipcMain.handle('minecraftSettings:status', async () => minecraftSettingsService.status())

  ipcMain.handle('minecraftSettings:capture', async (_event, { installationId } = {}) => {
    return minecraftSettingsService.capture(requireInstallation(installationId))
  })

  ipcMain.handle('minecraftSettings:apply', async (_event, { installationId } = {}) => {
    return minecraftSettingsService.apply(requireInstallation(installationId))
  })

  ipcMain.handle('minecraftSettings:applyAll', async () => minecraftSettingsService.applyToAll())

  ipcMain.handle('mods:search', async (_event, {
    installationId,
    query = '',
    offset = 0,
    limit = 20,
    contentType = 'mod',
    sort = 'relevance',
    categories = [],
    environment = 'any',
    license = null,
    openSource = false,
    gameVersion = null,
    loader = null,
  } = {}) => {
    // Modpacks are their own profile, so browsing them must not need a selected one.
    const installation = contentType === 'modpack' ? null : requireInstallation(installationId)
    return modrinthService.search(installation, {
      query,
      offset,
      limit,
      contentType,
      sort,
      categories,
      environment,
      license,
      openSource,
      gameVersion,
      loader,
    })
  })

  ipcMain.handle('mods:list', async (_event, { installationId, contentType = 'mod', worldFolder = null } = {}) => {
    const installation = requireInstallation(installationId)
    const payload = await modrinthService.listInstalled(installation, contentType, worldFolder)
    const indexType = CONTENT_INDEX_TYPES[contentType]
    if (!indexType) return payload
    try {
      const indexRoot = contentType === 'datapack' && payload.directory ? path.dirname(payload.directory) : installation.gameDir
      const index = await contentIndexService.list(indexRoot, indexType)
      const byFilename = new Map(index.files.map((file) => [file.filename, file]))
      return {
        ...payload,
        items: payload.items.map((item) => {
          const file = byFilename.get(item.filename)
          return {
            ...item,
            metadata: file?.metadata ?? null,
            metadataReason: file?.reason ?? null,
          }
        }),
      }
    } catch (error) {
      logger.warn?.('Could not read local content metadata', { message: error.message })
      return {
        ...payload,
        items: payload.items.map((item) => ({
          ...item,
          metadata: null,
          metadataReason: 'Local metadata could not be read.',
        })),
      }
    }
  })

  ipcMain.handle('mods:project', async (_event, { projectId } = {}) => {
    return modrinthService.getProject(requireString(projectId, 'Project ID', 128))
  })

  ipcMain.handle('mods:versions', async (_event, { projectId, gameVersion = null, loader = null } = {}) => {
    return modrinthService.getVersions(requireString(projectId, 'Project ID', 128), {
      gameVersion: gameVersion ? requireString(gameVersion, 'Minecraft version', 40) : null,
      loader: loader ? requireString(loader, 'Mod loader', 40) : null,
    })
  })

  ipcMain.handle('mods:install', async (_event, { installationId, projectId, versionId = null, contentType = 'mod', worldFolder = null } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modrinthService.install(installation, {
      projectId: requireString(projectId, 'Modrinth project', 128),
      versionId: typeof versionId === 'string' && versionId ? versionId : null,
      contentType,
      worldFolder,
    })
    await store.addActivity({
      type: 'install',
      title: `Installed ${result.installed[0]?.name || `a ${contentLabel(result.contentType)}`}`,
      detail: `${result.installed.length} file${result.installed.length === 1 ? '' : 's'} added to ${installation.name}`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    logger.info('Installed Modrinth content', {
      installation: installation.name,
      contentType: result.contentType,
      files: result.installed.length,
    })
    return result
  })

  ipcMain.handle('mods:installModpack', async (_event, { projectId, versionId = null } = {}) => {
    const result = await modrinthService.installModpack({
      projectId: requireString(projectId, 'Modrinth project', 128),
      versionId: typeof versionId === 'string' && versionId ? versionId : null,
    })
    await store.addActivity({
      type: 'install',
      title: `Created ${result.installation.name}`,
      detail: `Modpack · Minecraft ${result.modpack.minecraftVersion}${
        result.modpack.loader && result.modpack.loader !== 'vanilla' ? ` · ${result.modpack.loader}` : ''
      }`,
      installationId: result.installation.id,
      status: 'success',
    })
    await emitInstallations()
    emitActivity()
    return result
  })

  ipcMain.handle('mods:inspectPack', async (_event, { path: packPath } = {}) => {
    const target = requireString(packPath, 'Modpack path', 4096)
    if (!path.isAbsolute(target)) throw new Error('Choose an absolute modpack path.')
    return modpackImportService.inspect(target)
  })

  ipcMain.handle('mods:importPack', async (_event, { path: packPath, mode = 'copy' } = {}) => {
    const target = requireString(packPath, 'Modpack path', 4096)
    if (!path.isAbsolute(target)) throw new Error('Choose an absolute modpack path.')
    if (mode !== 'copy' && mode !== 'adopt') throw new Error('Choose whether to copy or adopt the instance.')
    const info = await modpackImportService.inspect(target)
    if (info.kind === 'mrpack' && mode !== 'copy') throw new Error('.mrpack packs are always copied.')
    const job = jobManager.enqueueModpackImport({
      title: `Importing ${info.name}`,
      subtitle: `Minecraft ${info.minecraftVersion}${info.loader.type !== 'vanilla' ? ` · ${info.loader.type}` : ''}`,
      run: ({ signal, onProgress }) => modpackImportService.import(target, { mode, signal, onProgress }),
    })
    return { job, info }
  })

  ipcMain.handle('launcher-import:scan', async (_event, { path: extraPath = null } = {}) => {
    let target = null
    if (extraPath != null) {
      target = requireString(extraPath, 'Folder path', 4096)
      if (!path.isAbsolute(target)) throw new Error('Choose an absolute folder path.')
    }
    return launcherImportService.scan({ extraPath: target })
  })

  ipcMain.handle(
    'launcher-import:start',
    async (_event, { ids, mode = 'adopt', importWorlds = true, path: extraPath = null } = {}) => {
      if (!Array.isArray(ids) || !ids.length) throw new Error('Choose at least one launcher profile.')
      if (ids.length > 50) throw new Error('Import at most 50 profiles at a time.')
      const uniqueIds = [...new Set(ids.map((id) => requireString(id, 'Profile ID', 128)))]
      if (mode !== 'adopt' && mode !== 'copy') {
        throw new Error('Choose whether to adopt or copy the profiles.')
      }
      let target = null
      if (extraPath != null) {
        target = requireString(extraPath, 'Folder path', 4096)
        if (!path.isAbsolute(target)) throw new Error('Choose an absolute folder path.')
      }
      const selection = await launcherImportService.select(uniqueIds, { extraPath: target })
      const job = jobManager.enqueueLauncherImport({
        title: `Importing ${selection.candidates.length} launcher profile${
          selection.candidates.length === 1 ? '' : 's'
        }`,
        subtitle: mode === 'adopt' ? 'Adopting folders in place' : 'Copying game content into Aqua',
        run: ({ signal, onProgress }) =>
          launcherImportService.importCandidates(selection.candidates, {
            mode,
            importWorlds: Boolean(importWorlds),
            signal,
            onProgress,
          }),
      })
      return { job, candidates: selection.candidates }
    },
  )

  ipcMain.handle('mods:exportPreview', async (_event, { installationId, includeWorlds = false } = {}) => {
    return modpackExportService.preview(requireInstallation(installationId), {
      includeWorlds: Boolean(includeWorlds),
    })
  })

  ipcMain.handle('mods:exportPack', async (event, { installationId, includeWorlds = false } = {}) => {
    const installation = requireInstallation(installationId)
    const preview = await modpackExportService.preview(installation, { includeWorlds: Boolean(includeWorlds) })
    const safeName = installation.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Aqua modpack'
    const result = await dialog.showSaveDialog(senderWindow(event), {
      title: 'Export modpack',
      defaultPath: `${safeName}.mrpack`,
      filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
    })
    if (result.canceled || !result.filePath) return null
    return modpackExportService.export(installation, {
      includeWorlds: Boolean(includeWorlds),
      destination: result.filePath,
      preview,
    })
  })

  ipcMain.handle('mods:toggle', async (_event, { installationId, filename, contentType = 'mod', worldFolder = null } = {}) => {
    return modrinthService.toggle(
      requireInstallation(installationId),
      requireString(filename, 'Content file', 260),
      contentType,
      worldFolder,
    )
  })

  ipcMain.handle('mods:remove', async (_event, { installationId, filename, contentType = 'mod', worldFolder = null } = {}) => {
    return modrinthService.remove(
      requireInstallation(installationId),
      requireString(filename, 'Content file', 260),
      contentType,
      worldFolder,
    )
  })

  ipcMain.handle('mods:checkUpdates', async (_event, { installationId, contentType = 'mod', worldFolder = null } = {}) => {
    return modrinthService.checkUpdates(requireInstallation(installationId), contentType, worldFolder)
  })

  ipcMain.handle('mods:update', async (_event, { installationId, filename, versionId, contentType = 'mod', worldFolder = null } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modrinthService.update(installation, {
      filename: requireString(filename, 'Content file', 260),
      versionId: requireString(versionId, 'Modrinth version', 64),
      contentType,
      worldFolder,
    })
    await store.addActivity({
      type: 'install',
      title: `Updated ${result.name || result.previousFilename}`,
      detail: `${contentLabel(result.contentType)} · ${result.versionNumber || 'new version'} in ${installation.name}`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    return result
  })

  ipcMain.handle('mods:retargetInfo', async (_event, { installationId, filename } = {}) => {
    return modRetargetService.inspect(
      requireInstallation(installationId),
      requireString(filename, 'Mod file', 260),
    )
  })

  ipcMain.handle('mods:retarget', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modRetargetService.convert(installation, requireString(filename, 'Mod file', 260))
    await store.addActivity({
      type: 'install',
      title: `Converted ${result.filename}`,
      detail: `Minecraft ${result.targetVersion} · ${installation.name}`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    return result
  })

  ipcMain.handle('mods:retargetUndo', async (_event, { installationId, filename } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modRetargetService.undo(installation, requireString(filename, 'Mod file', 260))
    await store.addActivity({
      type: 'install',
      title: `Restored ${result.filename}`,
      detail: `Original mod file restored in ${installation.name}`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    return result
  })

  ipcMain.handle('mods:openFolder', async (_event, { installationId, contentType = 'mod', worldFolder = null } = {}) => {
    const installation = requireInstallation(installationId)
    const directory =
      contentType === 'modpack'
        ? path.join(installation.gameDir, 'mods')
        : modrinthService.contentDirectoryForWorld(installation, contentType, worldFolder)
    await ensureDir(directory)
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
    return directory
  })

  ipcMain.handle('downloads:list', async () => jobManager.list())
  ipcMain.handle('downloads:cancel', async (_event, { id }) => {
    return jobManager.cancel(requireString(id, 'Download ID', 128))
  })
  ipcMain.handle('downloads:clearFinished', async () => {
    jobManager.clearFinished()
    return jobManager.list()
  })

  ipcMain.handle('storage:scan', async (_event, { force = false } = {}) => {
    return storageService.scan({ force: force === true })
  })

  ipcMain.handle('storage:clean', async (_event, payload = {}) => {
    const input = requireObject(payload, 'Cleanup request')
    if (!Array.isArray(input.ids)) throw new Error('Choose at least one item to clean up.')
    if (input.ids.length > 50) throw new Error('Too many items selected at once.')
    const ids = input.ids.map((id) => requireString(id, 'Cleanup item', 80))
    return storageService.clean({ ids, includeBackups: input.includeBackups === true })
  })

  ipcMain.handle('storage:cancel', async () => storageService.cancel())

  ipcMain.handle('game:launch', async (_event, { installationId, serverAddress, safeMode } = {}) => {
    let quickPlay = null
    if (serverAddress != null && serverAddress !== '') {
      const target = normalizeServerAddress(requireString(serverAddress, 'Server address', 300))
      quickPlay = { type: 'multiplayer', address: target.connectAddress }
    }
    return gameManager.launch(requireString(installationId, 'Installation ID', 128), {
      quickPlay,
      safeMode: safeMode === true,
    })
  })

  ipcMain.handle('game:recoverSafeMode', async () => gameManager.recoverSafeMode())

  ipcMain.handle('backups:status', async () => backupScheduler.status())

  ipcMain.handle('backups:runNow', async (_event, { installationId } = {}) => {
    return backupScheduler.runNow({
      installationId: installationId ? requireString(installationId, 'Installation ID', 128) : null,
      reason: 'manual',
    })
  })

  ipcMain.handle('health:check', async (_event, { installationId } = {}) => {
    return healthService.check(requireString(installationId, 'Installation ID', 128))
  })

  ipcMain.handle('health:summary', async () => healthService.summary())

  ipcMain.handle('content:index', async (_event, { installationId, contentType, worldFolder = null } = {}) => {
    const installation = requireInstallation(installationId)
    const type = requireString(contentType, 'Content type', 32)
    const root = type === 'datapacks' && worldFolder ? modrinthService.worldDirectory(installation, worldFolder) : installation.gameDir
    return contentIndexService.list(root, type)
  })

  ipcMain.handle('content:file', async (_event, { installationId, contentType = 'mod', filename } = {}) => {
    const installation = requireInstallation(installationId)
    const type = requireString(contentType, 'Content type', 32)
    const indexType = CONTENT_INDEX_TYPES[type]
    if (!indexType) throw new Error('That content type cannot be inspected.')
    return contentIndexService.file(installation.gameDir, indexType, requireString(filename, 'File name', 260))
  })

  ipcMain.handle('content:conflicts', async (_event, { installationId, contentType = 'mod' } = {}) => {
    const installation = requireInstallation(installationId)
    const type = requireString(contentType, 'Content type', 32)
    const indexType = CONTENT_INDEX_TYPES[type]
    if (!indexType) {
      return {
        missingDependencies: [],
        duplicateIds: [],
        loaderMismatch: [],
        versionMismatch: [],
        knownIncompatible: [],
        total: 0,
      }
    }
    const index = await contentIndexService.list(installation.gameDir, indexType)
    return findConflicts({
      ...index,
      loader: installation.loader?.type || 'vanilla',
      gameVersion: installation.versionId,
    })
  })

  ipcMain.handle('content:importFiles', async (_event, {
    installationId = null,
    contentType = 'mod',
    paths = [],
    dryRun = false,
    conflictPolicy = 'ask',
    bedrockEditionId = null,
  } = {}) => {
    if (!Array.isArray(paths) || !paths.length) throw new Error('Drop at least one file to import.')
    if (paths.length > 20) throw new Error('Import up to 20 files at a time.')
    const installation = installationId ? requireInstallation(installationId) : null
    const type = requireString(contentType, 'Content type', 32)
    const policy = ['ask', 'replace', 'skip', 'keep-both'].includes(conflictPolicy) ? conflictPolicy : 'ask'
    const editionId = bedrockEditionId ? requireString(bedrockEditionId, 'Bedrock edition', 64) : null
    const game = gameManager.getState()
    const result = await runImports({
      paths,
      gameDir: installation?.gameDir ?? null,
      conflictPolicy: policy,
      bedrockEditionId: editionId,
      bedrockImport: (id, filePath) => bedrockAddonsService.import(id, filePath),
      dryRun: dryRun === true,
      gameRunning: game.status === 'running' || game.status === 'preparing',
    })
    if (!dryRun && result.imported.length) {
      await store.addActivity({
        type: 'install',
        title: `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}`,
        detail: result.imported.map((item) => item.filename).join(', '),
        installationId: installation?.id ?? null,
        status: 'success',
      })
    }
    return { ...result, requestedContentType: type }
  })

  ipcMain.handle('health:fix', async (_event, { installationId, kind } = {}) => {
    const installation = requireInstallation(installationId)
    const allowed = new Set(['reinstall', 'open-settings', 'open-folder', 'create-directory', 'open-content'])
    if (!allowed.has(kind)) throw new Error('That health fix is not supported.')
    healthService.invalidate(installation.id)
    if (kind === 'reinstall') {
      return { kind, job: jobManager.enqueueInstall(installation.id) }
    }
    if (kind === 'open-settings') return { kind, route: 'settings' }
    if (kind === 'create-directory') {
      await ensureDir(installation.gameDir)
      return { kind, path: installation.gameDir }
    }
    const target = kind === 'open-content' ? path.join(installation.gameDir, 'mods') : installation.gameDir
    await ensureDir(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return { kind, path: target }
  })

  ipcMain.handle('worlds:list', async (_event, { installationId } = {}) => {
    return worldsService.list(requireString(installationId, 'Installation ID', 128))
  })

  ipcMain.handle('worlds:searchIndex', async () => worldsService.searchIndex())

  ipcMain.handle('worlds:backup', async (_event, { installationId, folder, note = null } = {}) => {
    const installation = requireInstallation(installationId)
    const backup = await worldsService.backupWorld(installation.id, requireString(folder, 'World folder', 260), {
      note: typeof note === 'string' ? note : null,
    })
    await store.addActivity({
      type: 'world',
      title: `Backed up ${backup.name}`,
      detail: `${installation.name} · ${backup.id}.zip`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    return backup
  })

  ipcMain.handle('worlds:restore', async (_event, { installationId, backupId } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await worldsService.restoreBackup(
      installation.id,
      requireString(backupId, 'Backup ID', 80),
    )
    await store.addActivity({
      type: 'world',
      title: `Restored ${result.name}`,
      detail: `${installation.name} · restored as ${result.folder}`,
      installationId: installation.id,
      status: 'success',
    })
    emitActivity()
    return result
  })

  ipcMain.handle('worlds:deleteBackup', async (_event, { installationId, backupId } = {}) => {
    return worldsService.deleteBackup(
      requireInstallation(installationId).id,
      requireString(backupId, 'Backup ID', 80),
    )
  })

  ipcMain.handle('worlds:delete', async (_event, { installationId, folder } = {}) => {
    const installation = requireInstallation(installationId)
    const game = gameManager.getState()
    if ((game.status === 'running' || game.status === 'preparing') && game.installationId === installation.id) {
      throw new Error('Close Minecraft before deleting a world from this installation.')
    }
    const result = await worldsService.deleteWorld(installation.id, requireString(folder, 'World folder', 260))
    await store.addActivity({
      type: 'world',
      title: `Deleted world ${result.folder}`,
      detail: installation.name,
      installationId: installation.id,
      status: 'info',
    })
    emitActivity()
    return result
  })

  ipcMain.handle('worlds:openFolder', async (_event, { installationId, folder = null } = {}) => {
    const target = await worldsService.folderPath(
      requireInstallation(installationId).id,
      typeof folder === 'string' && folder ? folder : null,
    )
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  ipcMain.handle('servers:lan', async () => lanDiscovery.status())
  ipcMain.handle('servers:list', async () => serverService.list())
  ipcMain.handle('servers:add', async (_event, input = {}) => {
    return serverService.add({
      name: typeof input.name === 'string' ? input.name : undefined,
      address: requireString(input.address, 'Server address', 300),
      edition: input.edition === 'bedrock' ? 'bedrock' : 'java',
      installationId:
        typeof input.installationId === 'string' && input.installationId
          ? requireString(input.installationId, 'Installation ID', 128)
          : null,
    })
  })
  ipcMain.handle('servers:update', async (_event, { id, patch } = {}) => {
    return serverService.update(
      requireString(id, 'Server ID', 64),
      requireObject(patch, 'Server changes'),
    )
  })
  ipcMain.handle('servers:remove', async (_event, { id } = {}) => {
    return serverService.remove(requireString(id, 'Server ID', 64))
  })
  ipcMain.handle('servers:ping', async (_event, { address, edition, timeoutMs } = {}) => {
    return serverService.ping(
      requireString(address, 'Server address', 300),
      edition === 'bedrock' ? 'bedrock' : 'java',
      Number.isFinite(timeoutMs) ? Number(timeoutMs) : undefined,
    )
  })
  ipcMain.handle('servers:markJoined', async (_event, { id } = {}) => {
    return serverService.markJoined(requireString(id, 'Server ID', 64))
  })

  ipcMain.handle('bedrock:status', async (_event, { force = false } = {}) => {
    return bedrockService.status({ force: Boolean(force) })
  })
  ipcMain.handle('bedrock:launch', async (_event, { id, serverAddress = null } = {}) => {
    const editionId = requireString(id, 'Bedrock edition', 64)
    if (serverAddress == null || serverAddress === '') return bedrockService.launch(editionId)
    const target = normalizeServerAddress(
      requireString(serverAddress, 'Server address', 300),
      { edition: 'bedrock' },
    )
    return bedrockService.launch(editionId, { serverAddress: target.address })
  })
  ipcMain.handle('bedrock:worlds', async (_event, { id } = {}) => {
    return bedrockService.worlds(requireString(id, 'Bedrock edition', 64))
  })
  ipcMain.handle('bedrock:openFolder', async (_event, { id, folder = null } = {}) => {
    return bedrockService.openFolder(
      requireString(id, 'Bedrock edition', 64),
      typeof folder === 'string' && folder ? folder : null,
    )
  })
  ipcMain.handle('bedrock:backupWorld', async (_event, { editionId, folder, note = null } = {}) => {
    const backup = await bedrockService.backupWorld(
      requireString(editionId, 'Bedrock edition', 64),
      requireString(folder, 'World folder', 260),
      { note: typeof note === 'string' ? note : null },
    )
    await store.addActivity({
      type: 'world',
      title: `Backed up ${backup.name}`,
      detail: `${backup.editionName} · ${backup.id}.zip`,
      installationId: null,
      status: 'success',
    })
    emitActivity()
    return backup
  })
  ipcMain.handle('bedrock:restoreBackup', async (_event, { editionId, backupId } = {}) => {
    const result = await bedrockService.restoreBackup(
      requireString(editionId, 'Bedrock edition', 64),
      requireString(backupId, 'Backup ID', 80),
    )
    await store.addActivity({
      type: 'world',
      title: `Restored ${result.name}`,
      detail: `${result.editionId} · restored as ${result.folder}`,
      installationId: null,
      status: 'success',
    })
    emitActivity()
    return result
  })
  ipcMain.handle('bedrock:deleteBackup', async (_event, { editionId, backupId } = {}) => {
    return bedrockService.deleteBackup(
      requireString(editionId, 'Bedrock edition', 64),
      requireString(backupId, 'Backup ID', 80),
    )
  })

  ipcMain.handle('bedrock:addons', async (_event, { editionId } = {}) => {
    return bedrockAddonsService.list(requireString(editionId, 'Bedrock edition', 64))
  })
  ipcMain.handle('bedrock:importAddon', async (_event, { editionId, filePath } = {}) => {
    return bedrockAddonsService.import(
      requireString(editionId, 'Bedrock edition', 64),
      requireString(filePath, 'Add-on file', 4096),
    )
  })
  ipcMain.handle('bedrock:removeAddon', async (_event, { editionId, kind, folder } = {}) => {
    return bedrockAddonsService.remove(
      requireString(editionId, 'Bedrock edition', 64),
      requireString(kind, 'Add-on type', 32),
      requireString(folder, 'Pack folder', 200),
    )
  })
  ipcMain.handle('bedrock:addonFolder', async (_event, { editionId, kind = null } = {}) => {
    const target = await bedrockAddonsService.folderPath(
      requireString(editionId, 'Bedrock edition', 64),
      typeof kind === 'string' && kind ? kind : null,
    )
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  const requireVersion = (value) => requireString(value, 'Bedrock version', 40)
  ipcMain.handle('bedrock:versions', async (_event, { force = false } = {}) => {
    return bedrockVersionsService.list({ force: Boolean(force) })
  })
  ipcMain.handle('bedrock:versionsState', async () => {
    const { library, installed } = await bedrockVersionsService.status()
    return { library: [...library.values()], installed }
  })
  ipcMain.handle('bedrock:downloadVersion', async (_event, { version } = {}) => {
    return bedrockVersionsService.download(requireVersion(version))
  })
  ipcMain.handle('bedrock:cancelVersion', async (_event, { version } = {}) => {
    return bedrockVersionsService.cancel(requireVersion(version))
  })
  ipcMain.handle('bedrock:removeVersion', async (_event, { version } = {}) => {
    return bedrockVersionsService.remove(requireVersion(version))
  })
  ipcMain.handle('bedrock:openVersionFolder', async (_event, { version } = {}) => {
    const target = await bedrockVersionsService.openFolder(requireVersion(version))
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })
  ipcMain.handle('bedrock:registerCommand', async (_event, { version } = {}) => {
    return bedrockVersionsService.registerCommand(requireVersion(version))
  })
  ipcMain.handle('bedrock:registerVersion', async (_event, { version, ignoreMissingDependencies = false } = {}) => {
    return bedrockVersionsService.register(requireVersion(version), {
      ignoreMissingDependencies: Boolean(ignoreMissingDependencies),
    })
  })
  ipcMain.handle('bedrock:installVersion', async (_event, { version } = {}) => {
    const result = await bedrockVersionsService.install(requireVersion(version))
    await store.addActivity({
      type: 'install',
      title: `Installed Bedrock ${result.installedVersion || result.version}`,
      detail: result.replacedVersion
        ? `Windows replaced Minecraft ${result.replacedVersion}`
        : 'Windows installed the downloaded build',
      installationId: null,
      status: 'success',
    })
    emitActivity()
    return result
  })
  ipcMain.handle('horizon:status', async (_event, { force = false } = {}) => {
    return horizonService.status({ force: Boolean(force) })
  })
  ipcMain.handle('horizon:releases', async (_event, { force = false } = {}) => {
    return horizonService.listReleases({ force: Boolean(force) })
  })
  ipcMain.handle('horizon:install', async (_event, { tag = null } = {}) => {
    return horizonService.install(requireString(tag, 'Horizon release', 32))
  })
  ipcMain.handle('horizon:cancelInstall', async () => {
    return horizonService.cancelInstall()
  })
  ipcMain.handle('horizon:launch', async (_event, { version = null } = {}) => {
    if (version != null && typeof version !== 'string') throw new Error('That Horizon build is invalid.')
    return horizonService.launch(version ? requireString(version, 'Horizon build', 80) : null)
  })
  ipcMain.handle('horizon:openFolder', async (_event, { kind = 'game', version = null } = {}) => {
    if (version != null && typeof version !== 'string') throw new Error('That Horizon build is invalid.')
    return horizonService.openFolder(
      requireString(kind, 'Horizon folder', 32),
      version ? requireString(version, 'Horizon build', 80) : null,
    )
  })

  ipcMain.handle('game:getState', async () => gameManager.getState())

  ipcMain.handle('crash:last', async () => store.crashes[0] || null)
  ipcMain.handle('crash:list', async () => store.crashes)
  ipcMain.handle('crash:analyze', async (_event, { installationId, file } = {}) => {
    const report = await logService.read({
      category: 'crash',
      file: requireString(file, 'Crash report', 260),
      installationId: requireString(installationId, 'Installation ID', 128),
    })
    return analyzeCrash({ text: report.content, exitCode: 1 })
  })

  ipcMain.handle('logs:list', async () => logService.list())
  ipcMain.handle('logs:read', async (_event, request) => {
    return logService.read(requireObject(request, 'Log request'))
  })
  ipcMain.handle('logs:openFolder', async (_event, request = {}) => {
    return logService.openFolder({ category: request.category, installationId: request.installationId })
  })
  ipcMain.handle('logs:openFile', async (_event, request) => {
    return logService.openFile(requireObject(request, 'Log request'))
  })
  ipcMain.handle('logs:exportDiagnostics', async () => {
    const system = getSystemInfo(paths)
    const javas = await javaService.detect().catch(() => [])
    const installations = await installationService.list()
    const accounts = accountManager.listPublic().map((account) => ({
      name: account.name,
      uuid: account.uuid,
      addedAt: account.addedAt,
      sessionExpired: account.sessionExpired,
    }))
    return logService.exportDiagnostics({
      system: {
        platform: `${system.platform} ${system.release} (${system.arch})`,
        cpu: `${system.cpuModel} · ${system.cpuCount} cores`,
        memory: `${system.totalMemMb} MB total, ${system.freeMemMb} MB free`,
        electron: system.electron,
        node: system.node,
      },
      launcher: {
        version: app.getVersion(),
        packaged: app.isPackaged,
        dataRoot: paths.dataRoot,
        minecraftRoot: paths.minecraftRoot,
        logsRoot: paths.logsRoot,
      },
      settings: store.settings,
      installations: installations.map((installation) => ({
        name: installation.name,
        version: installation.versionId,
        installed: installation.installed,
        gameDir: installation.gameDir,
        lastInstalledAt: installation.lastInstalledAt,
      })),
      java: javas.map((java) => ({
        path: java.path,
        version: java.version,
        major: java.major,
        source: java.source,
      })),
      accounts,
    })
  })

  ipcMain.handle('system:openFolder', async (_event, { kind, installationId } = {}) => {
    let target
    switch (kind) {
      case 'data':
        target = paths.dataRoot
        break
      case 'minecraft':
        target = paths.minecraftRoot
        break
      case 'instances':
        target = paths.instancesRoot
        break
      case 'logs':
        target = paths.logsRoot
        break
      case 'avatars':
        target = paths.avatarCacheRoot
        break
      case 'versions':
        target = paths.versionsRoot
        break
      case 'assets':
        target = paths.assetsRoot
        break
      case 'backups':
        target = paths.backupsRoot
        break
      case 'bedrock':
        target = paths.bedrockRoot
        break
      case 'game': {
        const installation = store.getInstallation(requireString(installationId, 'Installation ID', 128))
        if (!installation) throw new Error('Installation not found.')
        target = installation.gameDir
        break
      }
      default:
        throw new Error('Unknown folder.')
    }
    if (kind !== 'game' && !isPathInside(target, paths.dataRoot)) {
      throw new Error('That folder is outside the launcher data.')
    }
    await ensureDir(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  ipcMain.handle('dialog:chooseDirectory', async (event, options = {}) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win, {
      title: typeof options.title === 'string' ? options.title.slice(0, 100) : 'Choose a folder',
      defaultPath: options.defaultPath && path.isAbsolute(options.defaultPath) ? options.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose folder',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:chooseHorizonMod', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Horizon mod',
      properties: ['openFile'],
      buttonLabel: 'Import mod',
      filters: [{ name: 'Horizon mods', extensions: ['hnmod', 'hmod', 'zip'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:chooseAddon', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Bedrock add-on',
      properties: ['openFile'],
      buttonLabel: 'Import add-on',
      filters: [{ name: 'Bedrock add-ons', extensions: ['mcpack', 'mcaddon', 'mcworld', 'mctemplate', 'zip'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:choosePack', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Modrinth modpack',
      properties: ['openFile'],
      buttonLabel: 'Inspect pack',
      filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:chooseJava', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Java executable',
      properties: ['openFile'],
      buttonLabel: 'Use Java',
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java executable', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:pathExists', async (_event, { path: target, type = 'any' } = {}) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return false
    try {
      const stat = await fsp.stat(target)
      if (type === 'file') return stat.isFile()
      if (type === 'directory') return stat.isDirectory()
      return true
    } catch {
      return false
    }
  })

  logger.info('IPC handlers registered')
}
