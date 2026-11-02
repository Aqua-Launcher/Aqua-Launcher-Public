const { clipboard, contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const api = {
  bootstrap: () => invoke('app:bootstrap'),
  openExternal: (url) => invoke('app:openExternal', { url }),
  reportRendererError: (payload) => invoke('app:rendererError', payload),
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
  blockTextures: {
    list: (options = {}) => invoke('block-textures:list', options),
  },
  installations: {
    list: () => invoke('installations:list'),
    get: (id) => invoke('installations:get', { id }),
    create: (input) => invoke('installations:create', input),
    update: (id, patch) => invoke('installations:update', { id, patch }),
    duplicate: (id) => invoke('installations:duplicate', { id }),
    remove: (id) => invoke('installations:remove', { id }),
    setActive: (id) => invoke('installations:setActive', { id }),
    install: (id) => invoke('installations:install', { id }),
    openFolder: (id) => invoke('installations:openFolder', { id }),
  },
  settings: {
    update: (patch) => invoke('settings:update', patch),
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
    list: (installationId, contentType = 'mod') => invoke('mods:list', { installationId, contentType }),
    install: (installationId, projectId, versionId = null, contentType = 'mod') =>
      invoke('mods:install', { installationId, projectId, versionId, contentType }),
    installModpack: (projectId, versionId = null) => invoke('mods:installModpack', { projectId, versionId }),
    checkUpdates: (installationId, contentType = 'mod') => invoke('mods:checkUpdates', { installationId, contentType }),
    update: (installationId, filename, versionId, contentType = 'mod') =>
      invoke('mods:update', { installationId, filename, versionId, contentType }),
    toggle: (installationId, filename, contentType = 'mod') =>
      invoke('mods:toggle', { installationId, filename, contentType }),
    remove: (installationId, filename, contentType = 'mod') =>
      invoke('mods:remove', { installationId, filename, contentType }),
    retargetInfo: (installationId, filename) => invoke('mods:retargetInfo', { installationId, filename }),
    retarget: (installationId, filename) => invoke('mods:retarget', { installationId, filename }),
    retargetUndo: (installationId, filename) => invoke('mods:retargetUndo', { installationId, filename }),
    openFolder: (installationId, contentType = 'mod') => invoke('mods:openFolder', { installationId, contentType }),
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
    launch: (installationId, serverAddress = null) => invoke('game:launch', { installationId, serverAddress }),
    getState: () => invoke('game:getState'),
  },
  worlds: {
    list: (installationId) => invoke('worlds:list', { installationId }),
    backup: (installationId, folder, note = null) => invoke('worlds:backup', { installationId, folder, note }),
    restore: (installationId, backupId) => invoke('worlds:restore', { installationId, backupId }),
    deleteBackup: (installationId, backupId) => invoke('worlds:deleteBackup', { installationId, backupId }),
    delete: (installationId, folder) => invoke('worlds:delete', { installationId, folder }),
    openFolder: (installationId, folder = null) => invoke('worlds:openFolder', { installationId, folder }),
  },
  servers: {
    list: () => invoke('servers:list'),
    add: (input) => invoke('servers:add', input),
    update: (id, patch) => invoke('servers:update', { id, patch }),
    remove: (id) => invoke('servers:remove', { id }),
    ping: (address, edition = 'java') => invoke('servers:ping', { address, edition }),
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
