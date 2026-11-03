import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomId, atomicWriteJson, readJsonFile, runId } from './util.js'
import { createDefaultSettings, normalizeSettings } from './settings.js'
import { normalizeBackupPolicy } from './backup-scheduler.js'
import { normalizeInstallationMeta } from './installation-meta.js'
import { normalizeNotification } from './notifications.js'

const SCHEMA_VERSION = 1
const MAX_ACTIVITY = 40
// Sessions are tiny and private; a longer history is what makes the stats page
// meaningful. The list is still bounded so the config cannot grow forever.
const MAX_SESSIONS = 500
const MAX_SERVERS = 100
const MAX_CRASHES = 10
const MAX_NOTIFICATIONS = 50

/** A classified crash is small and self-contained, so it is safe to persist. */
function normalizeCrash(raw) {
  if (!raw || typeof raw !== 'object' || !raw.category || !raw.title) return null
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((line) => typeof line === 'string').slice(0, 5).map((line) => line.slice(0, 300))
    : []
  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .filter((action) => action && typeof action.id === 'string')
        .slice(0, 4)
        .map((action) => ({ id: action.id.slice(0, 40), label: String(action.label || action.id).slice(0, 80) }))
    : []
  return {
    id: typeof raw.id === 'string' ? raw.id : randomId(),
    installationId: typeof raw.installationId === 'string' ? raw.installationId : null,
    installationName: typeof raw.installationName === 'string' ? raw.installationName.slice(0, 80) : null,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    category: String(raw.category).slice(0, 40),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    title: String(raw.title).slice(0, 120),
    summary: String(raw.summary || '').slice(0, 400),
    exitCode: Number.isFinite(raw.exitCode) ? raw.exitCode : null,
    signal: typeof raw.signal === 'string' ? raw.signal.slice(0, 20) : null,
    reportPath: typeof raw.reportPath === 'string' ? raw.reportPath : null,
    evidence,
    actions,
  }
}

/** A profile created from a Modrinth modpack remembers which pack it came from. */
function normalizeModpack(raw) {
  if (!raw || typeof raw !== 'object') return null
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim().slice(0, 64) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  if (!projectId || !name) return null
  return {
    projectId,
    name,
    iconUrl:
      typeof raw.iconUrl === 'string' && /^https:\/\//i.test(raw.iconUrl) ? raw.iconUrl.slice(0, 500) : null,
    versionId: typeof raw.versionId === 'string' && raw.versionId ? raw.versionId.slice(0, 64) : null,
  }
}

function normalizeInstallation(raw, defaultGameDir) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || !raw.name || !raw.versionId) return null
  const now = new Date().toISOString()
  const windowOverride =
    raw.windowOverride && typeof raw.windowOverride === 'object'
      ? {
          width: Number(raw.windowOverride.width) || 1280,
          height: Number(raw.windowOverride.height) || 720,
          fullscreen: Boolean(raw.windowOverride.fullscreen),
        }
      : null
  const memoryOverride =
    raw.memoryOverride && typeof raw.memoryOverride === 'object'
      ? {
          minMb: Number(raw.memoryOverride.minMb) || 1024,
          maxMb: Number(raw.memoryOverride.maxMb) || 4096,
        }
      : null
  const loaderTypes = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
  const loader =
    raw.loader && typeof raw.loader === 'object' && loaderTypes.includes(raw.loader.type) && raw.loader.type !== 'vanilla'
      ? {
          type: raw.loader.type,
          version: typeof raw.loader.version === 'string' && raw.loader.version ? raw.loader.version : null,
          profileId: typeof raw.loader.profileId === 'string' && raw.loader.profileId ? raw.loader.profileId : null,
        }
      : { type: 'vanilla', version: null, profileId: null }
  return {
    id: String(raw.id),
    name: String(raw.name).slice(0, 80),
    versionId: String(raw.versionId),
    versionType: ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(raw.versionType)
      ? raw.versionType
      : 'release',
    loader,
    gameDir:
      typeof raw.gameDir === 'string' && path.isAbsolute(raw.gameDir)
        ? path.normalize(raw.gameDir)
        : defaultGameDir,
    managedGameDir: Boolean(raw.managedGameDir),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    lastPlayedAt: raw.lastPlayedAt || null,
    totalPlaytimeMs: Number.isFinite(raw.totalPlaytimeMs) ? raw.totalPlaytimeMs : 0,
    lastInstalledAt: raw.lastInstalledAt || null,
    modpack: normalizeModpack(raw.modpack),
    javaPath: typeof raw.javaPath === 'string' && raw.javaPath ? raw.javaPath : null,
    memoryOverride,
    windowOverride,
    jvmArgsOverride: typeof raw.jvmArgsOverride === 'string' ? raw.jvmArgsOverride : null,
    gameArgsOverride: typeof raw.gameArgsOverride === 'string' ? raw.gameArgsOverride : null,
    backupPolicy:
      raw.backupPolicy && typeof raw.backupPolicy === 'object'
        ? normalizeBackupPolicy(raw.backupPolicy)
        : null,
    ...normalizeInstallationMeta(raw),
  }
}

function normalizeServer(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || typeof raw.address !== 'string' || !raw.address.trim()) return null
  return {
    id: String(raw.id).slice(0, 64),
    name: String(raw.name || raw.address).slice(0, 60),
    address: raw.address.trim().slice(0, 300),
    connectAddress:
      typeof raw.connectAddress === 'string' && raw.connectAddress.trim()
        ? raw.connectAddress.trim().slice(0, 300)
        : raw.address.trim().slice(0, 300),
    edition: raw.edition === 'bedrock' ? 'bedrock' : 'java',
    installationId:
      raw.edition !== 'bedrock' && typeof raw.installationId === 'string' && raw.installationId.trim()
        ? raw.installationId.trim().slice(0, 128)
        : null,
    addedAt: raw.addedAt || new Date().toISOString(),
    lastJoinedAt: raw.lastJoinedAt || null,
  }
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || !raw.name || !raw.uuid) return null
  const type = raw.type === 'offline' ? 'offline' : 'microsoft'
  return {
    id: String(raw.id),
    type,
    name: String(raw.name).slice(0, 64),
    uuid: String(raw.uuid),
    xuid: type === 'microsoft' && typeof raw.xuid === 'string' ? raw.xuid : null,
    addedAt: raw.addedAt || new Date().toISOString(),
    lastUsedAt: raw.lastUsedAt || raw.addedAt || new Date().toISOString(),
    expiresAt: type === 'offline' ? null : raw.expiresAt || null,
    sessionExpired: type === 'offline' ? false : Boolean(raw.sessionExpired),
    avatarDataUrl: typeof raw.avatarDataUrl === 'string' ? raw.avatarDataUrl : null,
  }
}

export class Store {
  constructor({ configFile, instancesRoot, totalMemMb, logger }) {
    this.configFile = configFile
    this.instancesRoot = instancesRoot
    this.totalMemMb = totalMemMb
    this.logger = logger
    this.defaults = createDefaultSettings({ totalMemMb, instancesRoot })
    this.data = null
    this.writeQueue = Promise.resolve()
  }

  async init() {
    await fsp.mkdir(path.dirname(this.configFile), { recursive: true })
    const raw = await readJsonFile(this.configFile, null)
    const defaults = this.defaults
    this.data = {
      schemaVersion: SCHEMA_VERSION,
      settings: normalizeSettings(raw?.settings, defaults),
      installations: Array.isArray(raw?.installations)
        ? raw.installations.map((item) => normalizeInstallation(item, defaults.defaultGameDir)).filter(Boolean)
        : [],
      activeInstallationId:
        typeof raw?.activeInstallationId === 'string' ? raw.activeInstallationId : null,
      accounts: Array.isArray(raw?.accounts) ? raw.accounts.map(normalizeAccount).filter(Boolean) : [],
      activeAccountId: typeof raw?.activeAccountId === 'string' ? raw.activeAccountId : null,
      servers: Array.isArray(raw?.servers)
        ? raw.servers.map(normalizeServer).filter(Boolean).slice(0, MAX_SERVERS)
        : [],
      activity: Array.isArray(raw?.activity)
        ? raw.activity
            .filter((item) => item && typeof item === 'object' && item.title)
            .slice(0, MAX_ACTIVITY)
        : [],
      sessions: Array.isArray(raw?.sessions)
        ? raw.sessions.filter((item) => item && typeof item === 'object').slice(0, MAX_SESSIONS)
        : [],
      notifications: Array.isArray(raw?.notifications)
        ? raw.notifications.map(normalizeNotification).filter(Boolean).slice(0, MAX_NOTIFICATIONS)
        : [],
      crashes: Array.isArray(raw?.crashes)
        ? raw.crashes.map(normalizeCrash).filter(Boolean).slice(0, MAX_CRASHES)
        : [],
    }

    if (!this.data.installations.find((installation) => installation.id === this.data.activeInstallationId)) {
      this.data.activeInstallationId = this.data.installations[0]?.id || null
    }
    if (!this.data.accounts.find((account) => account.id === this.data.activeAccountId)) {
      this.data.activeAccountId = this.data.accounts[0]?.id || null
    }
    // A profile can disappear outside the launcher (or before an upgrade). Keep
    // the server row, but never leave a binding that cannot resolve.
    for (const server of this.data.servers) {
      if (server.installationId && !this.getInstallation(server.installationId)) {
        server.installationId = null
      }
    }
    if (!raw) {
      await this.save()
      this.logger.info('Created initial launcher configuration', { path: this.configFile })
    }
    return this.data
  }

  get settings() {
    return this.data.settings
  }

  get installations() {
    return this.data.installations
  }

  get accounts() {
    return this.data.accounts
  }

  get activeAccountId() {
    return this.data.activeAccountId
  }

  get activeInstallationId() {
    return this.data.activeInstallationId
  }

  get activity() {
    return this.data.activity
  }

  get sessions() {
    return this.data.sessions
  }

  get servers() {
    return this.data.servers
  }

  get crashes() {
    return this.data.crashes
  }

  get notifications() {
    return this.data.notifications
  }

  get activeInstallation() {
    return this.data.installations.find((item) => item.id === this.data.activeInstallationId) || null
  }

  getInstallation(id) {
    return this.data.installations.find((item) => item.id === id) || null
  }

  getAccount(id) {
    return this.data.accounts.find((item) => item.id === id) || null
  }

  async save() {
    const snapshot = structuredClone(this.data)
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.configFile, snapshot))
    return this.writeQueue
  }

  async replaceSettings(settings) {
    this.data.settings = settings
    await this.save()
    return this.data.settings
  }

  async addInstallation(installation) {
    this.data.installations.push(installation)
    if (!this.data.activeInstallationId) this.data.activeInstallationId = installation.id
    await this.save()
    return installation
  }

  async updateInstallation(id, patch) {
    const installation = this.getInstallation(id)
    if (!installation) throw new Error('Installation not found.')
    Object.assign(installation, patch, { updatedAt: new Date().toISOString() })
    await this.save()
    return installation
  }

  async removeInstallation(id) {
    const index = this.data.installations.findIndex((item) => item.id === id)
    if (index === -1) throw new Error('Installation not found.')
    const [removed] = this.data.installations.splice(index, 1)
    if (this.data.activeInstallationId === id) {
      this.data.activeInstallationId = this.data.installations[0]?.id || null
    }
    for (const server of this.data.servers) {
      if (server.installationId === id) server.installationId = null
    }
    await this.save()
    return removed
  }

  async setActiveInstallation(id) {
    if (!this.getInstallation(id)) throw new Error('Installation not found.')
    this.data.activeInstallationId = id
    await this.save()
  }

  getServer(id) {
    return this.data.servers.find((server) => server.id === id) || null
  }

  async addServer(server) {
    if (this.data.servers.length >= MAX_SERVERS) throw new Error('The server list is full. Remove a server first.')
    this.data.servers.push(server)
    await this.save()
    return server
  }

  async updateServer(id, patch) {
    const server = this.getServer(id)
    if (!server) throw new Error('Server not found.')
    Object.assign(server, patch)
    await this.save()
    return server
  }

  async removeServer(id) {
    const index = this.data.servers.findIndex((server) => server.id === id)
    if (index === -1) throw new Error('Server not found.')
    const [removed] = this.data.servers.splice(index, 1)
    await this.save()
    return removed
  }

  async markServerJoined(id) {
    const server = this.getServer(id)
    if (!server) return null
    server.lastJoinedAt = new Date().toISOString()
    await this.save()
    return server
  }

  async markInstallationPlayed(id, { startedAt, endedAt, playtimeMs = 0 }) {
    const installation = this.getInstallation(id)
    if (!installation) return
    installation.lastPlayedAt = endedAt || startedAt
    installation.totalPlaytimeMs = (installation.totalPlaytimeMs || 0) + Math.max(0, playtimeMs)
    installation.updatedAt = new Date().toISOString()
    this.data.sessions.unshift({
      id: runId(),
      installationId: id,
      startedAt,
      endedAt: endedAt || null,
      playtimeMs: Math.max(0, playtimeMs),
    })
    this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS)
    await this.save()
  }

  async markInstalled(id, installedAt) {
    const installation = this.getInstallation(id)
    if (!installation) return
    installation.lastInstalledAt = installedAt
    installation.updatedAt = new Date().toISOString()
    await this.save()
  }

  async upsertAccount(account) {
    const index = this.data.accounts.findIndex((item) => item.id === account.id)
    if (index >= 0) {
      this.data.accounts[index] = { ...this.data.accounts[index], ...account }
    } else {
      this.data.accounts.push(account)
    }
    await this.save()
    return this.getAccount(account.id)
  }

  async updateAccount(id, patch) {
    const account = this.getAccount(id)
    if (!account) return null
    Object.assign(account, patch)
    await this.save()
    return account
  }

  async removeAccount(id) {
    this.data.accounts = this.data.accounts.filter((item) => item.id !== id)
    if (this.data.activeAccountId === id) {
      this.data.activeAccountId = this.data.accounts[0]?.id || null
    }
    await this.save()
  }

  async setActiveAccount(id) {
    if (!this.getAccount(id)) throw new Error('Account not found.')
    this.data.activeAccountId = id
    const account = this.getAccount(id)
    account.lastUsedAt = new Date().toISOString()
    await this.save()
    return account
  }

  async addActivity(entry) {
    const activity = {
      id: randomId(),
      at: new Date().toISOString(),
      status: 'info',
      ...entry,
    }
    this.data.activity.unshift(activity)
    this.data.activity = this.data.activity.slice(0, MAX_ACTIVITY)
    await this.save()
    return activity
  }

  async clearActivity() {
    this.data.activity = []
    await this.save()
  }

  async addNotification(entry) {
    const notification = normalizeNotification(entry)
    if (!notification) return null
    this.data.notifications.unshift(notification)
    this.data.notifications = this.data.notifications.slice(0, MAX_NOTIFICATIONS)
    await this.save()
    return notification
  }

  async markNotificationsRead(ids = null) {
    const selected = Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string')) : null
    let changed = false
    for (const notification of this.data.notifications) {
      if (!notification.read && (!selected || selected.has(notification.id))) {
        notification.read = true
        changed = true
      }
    }
    if (changed) await this.save()
    return this.data.notifications
  }

  async clearNotifications() {
    this.data.notifications = []
    await this.save()
    return this.data.notifications
  }

  async addCrash(entry) {
    const crash = normalizeCrash({ ...entry, id: entry?.id || randomId(), at: entry?.at || new Date().toISOString() })
    if (!crash) return null
    this.data.crashes.unshift(crash)
    this.data.crashes = this.data.crashes.slice(0, MAX_CRASHES)
    await this.save()
    return crash
  }

  publicServer(server) {
    if (!server) return null
    return {
      id: server.id,
      name: server.name,
      address: server.address,
      connectAddress: server.connectAddress || server.address,
      edition: server.edition === 'bedrock' ? 'bedrock' : 'java',
      installationId: server.installationId || null,
      addedAt: server.addedAt,
      lastJoinedAt: server.lastJoinedAt,
    }
  }

  publicAccount(account) {
    if (!account) return null
    return {
      id: account.id,
      type: account.type || 'microsoft',
      name: account.name,
      uuid: account.uuid,
      addedAt: account.addedAt,
      lastUsedAt: account.lastUsedAt,
      expiresAt: account.expiresAt,
      sessionExpired: account.sessionExpired,
      avatarDataUrl: account.avatarDataUrl,
      isActive: account.id === this.data.activeAccountId,
    }
  }
}
