const { clipboard, contextBridge, ipcRenderer, webUtils } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const api = {
  bootstrap: () => invoke('app:bootstrap'),
  openExternal: (url) => invoke('app:openExternal', { url }),
  files: {
    getPath: (file) => {
      try {
        return webUtils.getPathForFile(file) || ''
      } catch {
        return ''
      }
    },
  },
  reportRendererError: (payload) => invoke('app:rendererError', payload),
  rendererReady: () => invoke('app:rendererReady'),
  links: {
    status: () => invoke('app:linkStatus'),
    register: () => invoke('app:registerLinks'),
  },
  copyText: (text) => {
    if (typeof text !== 'string') return false
    clipboard.writeText(text.slice(0, 100_000))
    return true
  },
  windowControls: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    getState: () => invoke('window:getState'),
    setZoom: (scale) => invoke('window:setZoom', { scale }),
  },
  versions: {
    list: (options = {}) => invoke('versions:list', options),
  },
  artwork: {
    versionArt: (versionId) => invoke('artwork:versionArt', { versionId }),
  },
  docs: {
    image: (url) => invoke('docs:image', { url }),
  },
  stats: {
    summary: () => invoke('stats:summary'),
    exportCsv: () => invoke('stats:exportCsv'),
  },
  blockTextures: {
    list: (options = {}) => invoke('block-textures:list', options),
  },
  launcherImport: {
    scan: (path = null) => invoke('launcher-import:scan', { path }),
    start: (ids, options = {}) => invoke('launcher-import:start', { ids, ...options }),
  },
  installations: {
    list: () => invoke('installations:list'),
    get: (id) => invoke('installations:get', { id }),
    create: (input) => invoke('installations:create', input),
    update: (id, patch) => invoke('installations:update', { id, patch }),
    reorder: (ids) => invoke('installations:reorder', { ids }),
    duplicate: (id) => invoke('installations:duplicate', { id }),
    remove: (id) => invoke('installations:remove', { id }),
    setActive: (id) => invoke('installations:setActive', { id }),
    install: (id) => invoke('installations:install', { id }),
    openFolder: (id) => invoke('installations:openFolder', { id }),
  },
  settings: {
    update: (patch) => invoke('settings:update', patch),
  },
  screenshots: {
    list: (installationId) => invoke('screenshots:list', { installationId }),
    thumbnail: (installationId, filename, size = 480) =>
      invoke('screenshots:thumbnail', { installationId, filename, size }),
    open: (installationId, filename) => invoke('screenshots:open', { installationId, filename }),
    copy: (installationId, filename) => invoke('screenshots:copy', { installationId, filename }),
    reveal: (installationId, filename) => invoke('screenshots:reveal', { installationId, filename }),
    openFolder: (installationId) => invoke('screenshots:openFolder', { installationId }),
    delete: (installationId, filename) => invoke('screenshots:delete', { installationId, filename }),
    setBackground: (installationId, filename) =>
      invoke('screenshots:setBackground', { installationId, filename }),
    clearBackground: () => invoke('screenshots:clearBackground'),
    background: () => invoke('screenshots:background'),
  },
  backups: {
    status: () => invoke('backups:status'),
    runNow: (installationId = null) => invoke('backups:runNow', { installationId }),
  },
  health: {
    check: (installationId) => invoke('health:check', { installationId }),
    summary: () => invoke('health:summary'),
    fix: (installationId, kind) => invoke('health:fix', { installationId, kind }),
  },
  content: {
    index: (installationId, contentType) => invoke('content:index', { installationId, contentType }),
    file: (installationId, contentType, filename) => invoke('content:file', { installationId, contentType, filename }),
    conflicts: (installationId, contentType) => invoke('content:conflicts', { installationId, contentType }),
    importFiles: (request) => invoke('content:importFiles', request),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    getAuthState: () => invoke('accounts:getAuthState'),
    beginLogin: () => invoke('accounts:beginLogin'),
    signInOffline: (name) => invoke('accounts:signInOffline', { name }),
    cancelLogin: () => invoke('accounts:cancelLogin'),
    switch: (id) => invoke('accounts:switch', { id }),
    signOut: (id) => invoke('accounts:signOut', { id }),
    refresh: (id) => invoke('accounts:refresh', { id }),
  },
  java: {
    detect: (options = {}) => invoke('java:detect', options),
    validate: (path) => invoke('java:validate', { path }),
    runtimeOptions: () => invoke('java:runtimeOptions'),
    installRuntime: (component) => invoke('java:installRuntime', { component }),
  },
  loaders: {
    types: () => invoke('loaders:types'),
    versions: (type, minecraftVersion) => invoke('loaders:versions', { type, minecraftVersion }),
  },
  mods: {
    search: (installationId, options = {}) => invoke('mods:search', { installationId, ...options }),
    list: (installationId, contentType = 'mod', worldFolder = null) =>
      invoke('mods:list', { installationId, contentType, worldFolder }),
    install: (installationId, projectId, versionId = null, contentType = 'mod', worldFolder = null) =>
      invoke('mods:install', { installationId, projectId, versionId, contentType, worldFolder }),
    installModpack: (projectId, versionId = null) => invoke('mods:installModpack', { projectId, versionId }),
    inspectPack: (path) => invoke('mods:inspectPack', { path }),
    importPack: (path, mode = 'copy') => invoke('mods:importPack', { path, mode }),
    exportPreview: (installationId, includeWorlds = false) =>
      invoke('mods:exportPreview', { installationId, includeWorlds }),
    exportPack: (installationId, includeWorlds = false) =>
      invoke('mods:exportPack', { installationId, includeWorlds }),
    checkUpdates: (installationId, contentType = 'mod', worldFolder = null) =>
      invoke('mods:checkUpdates', { installationId, contentType, worldFolder }),
    update: (installationId, filename, versionId, contentType = 'mod', worldFolder = null) =>
      invoke('mods:update', { installationId, filename, versionId, contentType, worldFolder }),
    toggle: (installationId, filename, contentType = 'mod', worldFolder = null) =>
      invoke('mods:toggle', { installationId, filename, contentType, worldFolder }),
    remove: (installationId, filename, contentType = 'mod', worldFolder = null) =>
      invoke('mods:remove', { installationId, filename, contentType, worldFolder }),
    retargetInfo: (installationId, filename) => invoke('mods:retargetInfo', { installationId, filename }),
    retarget: (installationId, filename) => invoke('mods:retarget', { installationId, filename }),
    retargetUndo: (installationId, filename) => invoke('mods:retargetUndo', { installationId, filename }),
    openFolder: (installationId, contentType = 'mod', worldFolder = null) =>
      invoke('mods:openFolder', { installationId, contentType, worldFolder }),
    project: (projectId) => invoke('mods:project', { projectId }),
    versions: (projectId, options = {}) => invoke('mods:versions', { projectId, ...options }),
  },
  minecraftSettings: {
    status: () => invoke('minecraftSettings:status'),
    capture: (installationId) => invoke('minecraftSettings:capture', { installationId }),
    apply: (installationId) => invoke('minecraftSettings:apply', { installationId }),
    applyAll: () => invoke('minecraftSettings:applyAll'),
  },
  downloads: {
    list: () => invoke('downloads:list'),
    cancel: (id) => invoke('downloads:cancel', { id }),
    clearFinished: () => invoke('downloads:clearFinished'),
  },
  storage: {
    scan: (options = {}) => invoke('storage:scan', options),
    clean: (ids, options = {}) => invoke('storage:clean', { ids, ...options }),
    cancel: () => invoke('storage:cancel'),
  },
  game: {
    launch: (installationId, serverAddress = null, safeMode = false) =>
      invoke('game:launch', { installationId, serverAddress, safeMode }),
    getState: () => invoke('game:getState'),
    recoverSafeMode: () => invoke('game:recoverSafeMode'),
  },
  crash: {
    last: () => invoke('crash:last'),
    list: () => invoke('crash:list'),
    analyze: (installationId, file) => invoke('crash:analyze', { installationId, file }),
  },
  worlds: {
    list: (installationId) => invoke('worlds:list', { installationId }),
    searchIndex: () => invoke('worlds:searchIndex'),
    backup: (installationId, folder, note = null) => invoke('worlds:backup', { installationId, folder, note }),
    restore: (installationId, backupId) => invoke('worlds:restore', { installationId, backupId }),
    deleteBackup: (installationId, backupId) => invoke('worlds:deleteBackup', { installationId, backupId }),
    delete: (installationId, folder) => invoke('worlds:delete', { installationId, folder }),
    openFolder: (installationId, folder = null) => invoke('worlds:openFolder', { installationId, folder }),
  },
  notifications: {
    list: () => invoke('notifications:list'),
    markRead: (ids = null) => invoke('notifications:markRead', { ids }),
    clear: () => invoke('notifications:clear'),
  },
  servers: {
    lan: () => invoke('servers:lan'),
    list: () => invoke('servers:list'),
    add: (input) => invoke('servers:add', input),
    update: (id, patch) => invoke('servers:update', { id, patch }),
    remove: (id) => invoke('servers:remove', { id }),
    ping: (address, edition = 'java', timeoutMs) => invoke('servers:ping', { address, edition, timeoutMs }),
    markJoined: (id) => invoke('servers:markJoined', { id }),
  },
  horizon: {
    status: (options = {}) => invoke('horizon:status', options),
    releases: (options = {}) => invoke('horizon:releases', options),
    install: (tag) => invoke('horizon:install', { tag }),
    cancelInstall: () => invoke('horizon:cancelInstall'),
    launch: (version = null) => invoke('horizon:launch', { version }),
    openFolder: (kind, version = null) => invoke('horizon:openFolder', { kind, version }),
    mods: () => invoke('horizon:mods'),
    importMod: (filePath) => invoke('horizon:importMod', { filePath }),
    toggleMod: (filename, kind) => invoke('horizon:toggleMod', { filename, kind }),
    removeMod: (filename, kind) => invoke('horizon:removeMod', { filename, kind }),
    modsFolder: (kind = 'content') => invoke('horizon:modsFolder', { kind }),
    registry: (options = {}) => invoke('horizon:registry', options),
    installProject: (projectId, version = null) => invoke('horizon:installProject', { projectId, version }),
    nativeStatus: () => invoke('horizon:nativeStatus'),
    buildNative: (profile = null) => invoke('horizon:buildNative', { profile }),
    cancelNativeBuild: () => invoke('horizon:cancelNativeBuild'),
  },
  bedrock: {
    status: (options = {}) => invoke('bedrock:status', options),
    launch: (id, serverAddress = null) => invoke('bedrock:launch', { id, serverAddress }),
    worlds: (id) => invoke('bedrock:worlds', { id }),
    openFolder: (id, folder = null) => invoke('bedrock:openFolder', { id, folder }),
    backupWorld: (editionId, folder, note = null) => invoke('bedrock:backupWorld', { editionId, folder, note }),
    restoreBackup: (editionId, backupId) => invoke('bedrock:restoreBackup', { editionId, backupId }),
    deleteBackup: (editionId, backupId) => invoke('bedrock:deleteBackup', { editionId, backupId }),
    versions: (options = {}) => invoke('bedrock:versions', options),
    versionsState: () => invoke('bedrock:versionsState'),
    downloadVersion: (version) => invoke('bedrock:downloadVersion', { version }),
    cancelVersion: (version) => invoke('bedrock:cancelVersion', { version }),
    removeVersion: (version) => invoke('bedrock:removeVersion', { version }),
    openVersionFolder: (version) => invoke('bedrock:openVersionFolder', { version }),
    registerCommand: (version) => invoke('bedrock:registerCommand', { version }),
    registerVersion: (version, options = {}) => invoke('bedrock:registerVersion', { version, ...options }),
    installVersion: (version) => invoke('bedrock:installVersion', { version }),
    addons: (editionId) => invoke('bedrock:addons', { editionId }),
    importAddon: (editionId, filePath) => invoke('bedrock:importAddon', { editionId, filePath }),
    removeAddon: (editionId, kind, folder) => invoke('bedrock:removeAddon', { editionId, kind, folder }),
    openAddonFolder: (editionId, kind = null) => invoke('bedrock:addonFolder', { editionId, kind }),
  },
  logs: {
    list: () => invoke('logs:list'),
    read: (request) => invoke('logs:read', request),
    openFolder: (request = {}) => invoke('logs:openFolder', request),
    openFile: (request) => invoke('logs:openFile', request),
    exportDiagnostics: () => invoke('logs:exportDiagnostics'),
  },
  system: {
    openFolder: (kind, installationId) => invoke('system:openFolder', { kind, installationId }),
    pathExists: (target, type = 'any') => invoke('system:pathExists', { path: target, type }),
  },
  dialogs: {
    chooseDirectory: (options = {}) => invoke('dialog:chooseDirectory', options),
    chooseJava: () => invoke('dialog:chooseJava'),
    chooseAddon: () => invoke('dialog:chooseAddon'),
    choosePack: () => invoke('dialog:choosePack'),
    chooseHorizonMod: () => invoke('dialog:chooseHorizonMod'),
  },
  events: {
    subscribe: (handler) => {
      if (typeof handler !== 'function') return () => {}
      const listener = (_event, payload) => handler(payload)
      ipcRenderer.on('app:event', listener)
      return () => ipcRenderer.removeListener('app:event', listener)
    },
  },
}

contextBridge.exposeInMainWorld('aqua', Object.freeze(api))
