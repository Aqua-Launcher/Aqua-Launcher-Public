import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { normalizeSettings, validateSettings } from './core/settings.js'
import { normalizeServerAddress } from './core/servers.js'
import { getPlatformLabel, getSystemInfo } from './core/system.js'
import { ensureDir, isAllowedExternalUrl, isPathInside } from './core/util.js'

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
  for (const key of ['java', 'memory', 'downloads', 'window', 'startup', 'logging', 'minecraftSettings']) {
    if (patch[key] !== undefined) {
      merged[key] = { ...current[key], ...requireObject(patch[key], key) }
    }
  }
  // Custom theme surfaces merge one level deeper so a patch can update a single
  // surface without dropping the other two.
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
  accountManager,
  javaService,
  jobManager,
  gameManager,
  logService,
  blockTextureService,
  storageService,
  emitInstallations,
  emitActivity,
  emitSettings,
  applyStartupSettings,
  applyUiScale,
  getMainWindow,
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
        canLaunchAtLogin: app.isPackaged,
      },
      settings: store.settings,
      installations,
      accounts: accountManager.accountsPayload(),
      activity: store.activity,
      sessions: store.sessions,
      jobs: jobManager.list(),
      game: gameManager.getState(),
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

  ipcMain.handle('settings:update', async (_event, patch) => {
    const input = requireObject(patch, 'Settings')
    const merged = mergeSettings(store.settings, input)
    const normalized = normalizeSettings(merged, store.defaults)
    const system = getSystemInfo(paths)
    const validated = await validateSettings(normalized, { totalMemMb: system.totalMemMb })
    if (validated.java.mode === 'path' && validated.java.path) {
      const info = await javaService.validateJavaPath(validated.java.path)
      validated.java.path = info.path
    }
    const previous = store.settings
    await store.replaceSettings(validated)
    logger.setLevel(validated.logging.level)
    if (previous.uiScale !== validated.uiScale) applyUiScale(validated.uiScale)
    if (JSON.stringify(previous.startup) !== JSON.stringify(validated.startup)) {
      await applyStartupSettings(validated)
    }
    emitSettings(validated)
    logger.info('Settings updated')
    return validated
  })

  ipcMain.handle('accounts:list', async () => accountManager.accountsPayload())
  ipcMain.handle('accounts:getAuthState', async () => accountManager.getAuthState())
  ipcMain.handle('accounts:beginLogin', async () => accountManager.beginLogin())
  ipcMain.handle('accounts:signInOffline', async (_event, { name }) => {
    return accountManager.signInOffline(requireString(name, 'Username', 16))
  })
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

  ipcMain.handle('mods:search', async (_event, { installationId, query = '', offset = 0, limit = 20, contentType = 'mod' } = {}) => {
    // Modpacks are their own profile, so browsing them must not need a selected one.
    const installation = contentType === 'modpack' ? null : requireInstallation(installationId)
    return modrinthService.search(installation, { query, offset, limit, contentType })
  })

  ipcMain.handle('mods:list', async (_event, { installationId, contentType = 'mod' } = {}) => {
    return modrinthService.listInstalled(requireInstallation(installationId), contentType)
  })

  ipcMain.handle('mods:install', async (_event, { installationId, projectId, versionId = null, contentType = 'mod' } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modrinthService.install(installation, {
      projectId: requireString(projectId, 'Modrinth project', 128),
      versionId: typeof versionId === 'string' && versionId ? versionId : null,
      contentType,
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

  ipcMain.handle('mods:toggle', async (_event, { installationId, filename, contentType = 'mod' } = {}) => {
    return modrinthService.toggle(
      requireInstallation(installationId),
      requireString(filename, 'Content file', 260),
      contentType,
    )
  })

  ipcMain.handle('mods:remove', async (_event, { installationId, filename, contentType = 'mod' } = {}) => {
    return modrinthService.remove(
      requireInstallation(installationId),
      requireString(filename, 'Content file', 260),
      contentType,
    )
  })

  ipcMain.handle('mods:checkUpdates', async (_event, { installationId, contentType = 'mod' } = {}) => {
    return modrinthService.checkUpdates(requireInstallation(installationId), contentType)
  })

  ipcMain.handle('mods:update', async (_event, { installationId, filename, versionId, contentType = 'mod' } = {}) => {
    const installation = requireInstallation(installationId)
    const result = await modrinthService.update(installation, {
      filename: requireString(filename, 'Content file', 260),
      versionId: requireString(versionId, 'Modrinth version', 64),
      contentType,
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

  ipcMain.handle('mods:openFolder', async (_event, { installationId, contentType = 'mod' } = {}) => {
    const installation = requireInstallation(installationId)
    const directory =
      contentType === 'modpack' ? path.join(installation.gameDir, 'mods') : modrinthService.contentDirectory(installation, contentType)
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

  ipcMain.handle('game:launch', async (_event, { installationId, serverAddress } = {}) => {
    let quickPlay = null
    if (serverAddress != null && serverAddress !== '') {
      const target = normalizeServerAddress(requireString(serverAddress, 'Server address', 300))
      quickPlay = { type: 'multiplayer', address: target.connectAddress }
    }
    return gameManager.launch(requireString(installationId, 'Installation ID', 128), { quickPlay })
  })

  ipcMain.handle('worlds:list', async (_event, { installationId } = {}) => {
    return worldsService.list(requireString(installationId, 'Installation ID', 128))
  })

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

  ipcMain.handle('servers:list', async () => serverService.list())
  ipcMain.handle('servers:add', async (_event, input = {}) => {
    return serverService.add({
      name: typeof input.name === 'string' ? input.name : undefined,
      address: requireString(input.address, 'Server address', 300),
      edition: input.edition === 'bedrock' ? 'bedrock' : 'java',
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
  ipcMain.handle('servers:ping', async (_event, { address, edition } = {}) => {
    return serverService.ping(
      requireString(address, 'Server address', 300),
      edition === 'bedrock' ? 'bedrock' : 'java',
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
