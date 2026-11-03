import fsp from 'node:fs/promises'
import path from 'node:path'
import { sha1File, sha1Text } from './util.js'

export const DEFAULT_BACKUP_POLICY = {
  enabled: false,
  onExit: true,
  daily: false,
  dailyHour: 3,
  retentionCount: 5,
  maxTotalMb: 2048,
}

/** Clamp a stored or user-supplied policy so a bad value can never disable safety. */
export function normalizeBackupPolicy(raw, base = DEFAULT_BACKUP_POLICY) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const fallback = base && typeof base === 'object' ? base : DEFAULT_BACKUP_POLICY
  const bool = (value, defaultValue) => (typeof value === 'boolean' ? value : defaultValue)
  const int = (value, defaultValue, min, max) => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
    const numeric = Number.isFinite(parsed) ? Math.round(parsed) : defaultValue
    return Math.min(max, Math.max(min, numeric))
  }
  return {
    enabled: bool(source.enabled, fallback.enabled),
    onExit: bool(source.onExit, fallback.onExit),
    daily: bool(source.daily, fallback.daily),
    dailyHour: int(source.dailyHour, fallback.dailyHour, 0, 23),
    retentionCount: int(source.retentionCount, fallback.retentionCount, 1, 50),
    maxTotalMb: int(source.maxTotalMb, fallback.maxTotalMb, 0, 102_400),
  }
}

/**
 * True when the most recent scheduled daily backup has not run yet. A missed
 * day stays due until the run finishes, after which it is not due again.
 */
export function isDue(policy, now = new Date(), lastBackupAt = null) {
  if (!policy?.enabled || !policy.daily) return false
  const hour = Math.min(23, Math.max(0, Math.round(Number(policy.dailyHour) || 0)))
  const today = new Date(now)
  today.setHours(hour, 0, 0, 0)
  const scheduled = today.getTime() <= now.getTime() ? today : new Date(today.getTime() - 86_400_000)
  if (!lastBackupAt) return true
  const last = new Date(lastBackupAt).getTime()
  return Number.isFinite(last) ? last < scheduled.getTime() : true
}

/** The next scheduled run, or null when daily backups are off. */
export function nextRunAt(policy, now = new Date()) {
  if (!policy?.enabled || !policy.daily) return null
  const hour = Math.min(23, Math.max(0, Math.round(Number(policy.dailyHour) || 0)))
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

/**
 * Retention keeps pinned backups unconditionally, then the newest
 * `retentionCount` unpinned backups, then the total size limit. Oldest first
 * for deletion, so a failed prune can only ever remove the least useful copy.
 */
export function planRetention(backups, policy = {}) {
  const list = Array.isArray(backups) ? backups.filter((entry) => entry && typeof entry.id === 'string') : []
  const keepCount = Number.isFinite(Number(policy.retentionCount))
    ? Math.max(1, Math.floor(Number(policy.retentionCount)))
    : DEFAULT_BACKUP_POLICY.retentionCount
  const maxBytes =
    Number.isFinite(Number(policy.maxTotalMb)) && Number(policy.maxTotalMb) > 0
      ? Math.floor(Number(policy.maxTotalMb) * 1024 * 1024)
      : 0
  const ordered = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const keptIds = []
  const deleteIds = []
  let unpinnedKept = 0
  let keptBytes = 0

  for (const entry of ordered) {
    const size = Math.max(0, Number(entry.sizeBytes) || 0)
    if (entry.pinned === true) {
      keptIds.push(entry.id)
      keptBytes += size
      continue
    }
    const overCount = unpinnedKept >= keepCount
    const overSize = maxBytes > 0 && keptBytes + size > maxBytes
    if (overCount || overSize) {
      deleteIds.push(entry.id)
      continue
    }
    keptIds.push(entry.id)
    unpinnedKept += 1
    keptBytes += size
  }

  return {
    deleteIds,
    keptIds,
    freedBytes: ordered
      .filter((entry) => deleteIds.includes(entry.id))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.sizeBytes) || 0), 0),
  }
}

/**
 * A cheap fingerprint of what matters when a world changes: level.dat plus the
 * newest region file. Used to skip unchanged worlds without reading the save.
 */
export async function worldContentSignature(worldDir) {
  const levelPath = path.join(worldDir, 'level.dat')
  const levelStat = await fsp.stat(levelPath).catch(() => null)
  if (!levelStat?.isFile()) {
    return { levelMtimeMs: 0, levelSha1: null, newestRegionMtimeMs: 0, contentHash: 'missing-level' }
  }
  const levelSha1 = await sha1File(levelPath).catch(() => null)
  let newestRegionMtimeMs = 0
  for (const folder of ['region', 'entities', 'poi']) {
    const entries = await fsp.readdir(path.join(worldDir, folder), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(mca|mcr)$/i.test(entry.name)) continue
      const stat = await fsp.stat(path.join(worldDir, folder, entry.name)).catch(() => null)
      if (stat) newestRegionMtimeMs = Math.max(newestRegionMtimeMs, stat.mtimeMs)
    }
  }
  return {
    levelMtimeMs: levelStat.mtimeMs,
    levelSha1,
    newestRegionMtimeMs,
    contentHash: await sha1Text(`${levelStat.size}:${levelStat.mtimeMs}:${levelSha1}:${newestRegionMtimeMs}`),
  }
}

/**
 * Runs automatic backups for changed worlds and manual runs for every world.
 * Work is queued as one JobManager `backup` job, so it survives the exit dialog
 * and remains cancellable from Tasks.
 */
export class BackupScheduler {
  constructor({ store, worldsService, jobManager, logger, emitBackups, emitActivity, emitNotification }) {
    this.store = store
    this.worldsService = worldsService
    this.jobManager = jobManager
    this.logger = logger
    this.emitBackups = emitBackups
    this.emitActivity = emitActivity
    this.emitNotification = emitNotification
    this.running = false
    this.lastRunAt = null
    this.lastResult = null
    this.timer = null
  }

  status() {
    return {
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      nextRunAt: nextRunAt(this.store.settings.backups, new Date()),
    }
  }

  emitStatus() {
    this.emitBackups?.(this.status())
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.check(), 15 * 60 * 1000)
    this.timer.unref?.()
    void this.check()
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  /** Newest automatic backup across installations, used to decide "missed". */
  async lastAutomaticAt() {
    let latest = null
    for (const installation of this.store.installations) {
      const backups = await this.worldsService.readBackupIndex(installation.id).catch(() => [])
      for (const backup of backups) {
        if (!backup.automatic || !backup.createdAt) continue
        if (!latest || new Date(backup.createdAt).getTime() > new Date(latest).getTime()) latest = backup.createdAt
      }
    }
    return latest
  }

  async check() {
    if (this.running) return this.status()
    try {
      if (!isDue(this.store.settings.backups, new Date(), await this.lastAutomaticAt())) return this.status()
      return await this.runNow({ reason: 'daily' })
    } catch (error) {
      this.logger.warn('Could not check the backup schedule', { message: error.message })
      return this.status()
    }
  }

  /** Called after a session is recorded. Never awaited by the game exit path. */
  onGameExit(installationId) {
    const installation = this.store.getInstallation(installationId)
    if (!installation) return
    const policy = installation.backupPolicy || this.store.settings.backups
    if (!policy.enabled || !policy.onExit) return
    void this.runNow({ installationId, reason: 'exit' })
  }

  async plan(installations, reason) {
    const plan = []
    let skipped = 0
    for (const installation of installations) {
      const policy = installation.backupPolicy || this.store.settings.backups
      if (reason === 'daily' && (!policy.enabled || !policy.daily)) continue
      if (reason === 'exit' && (!policy.enabled || !policy.onExit)) continue
      const worlds = await this.worldsService.listWorldSignatures(installation.id).catch((error) => {
        this.logger.warn('Could not inspect worlds for backup', {
          installation: installation.name,
          message: error.message,
        })
        return []
      })
      const backups = await this.worldsService.readBackupIndex(installation.id).catch(() => [])
      for (const world of worlds) {
        const previous = backups
          .filter((backup) => backup.worldFolder === world.folder)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
        const changed = !previous || previous.contentHash !== world.signature.contentHash
        if (reason !== 'manual' && !changed) {
          skipped += 1
          continue
        }
        plan.push({ installation, world, policy })
      }
    }
    return { plan, skipped }
  }

  async runNow({ installationId = null, reason = 'manual' } = {}) {
    if (this.running) return { ...this.status(), started: false }
    let installations
    try {
      installations = installationId
        ? [this.worldsService.installation(installationId)]
        : this.store.installations
    } catch (error) {
      this.logger.warn('Backup requested for an unknown installation', { message: error.message })
      return { ...this.status(), started: false }
    }

    const { plan, skipped } = await this.plan(installations, reason)
    if (!plan.length) {
      this.lastRunAt = new Date().toISOString()
      this.lastResult = { at: this.lastRunAt, reason, backedUp: 0, skipped, failed: 0, failedWorlds: [] }
      this.emitStatus()
      return { ...this.status(), started: false }
    }

    this.running = true
    this.emitStatus()
    const total = plan.length
    let job
    try {
      job = this.jobManager.enqueueBackup({
        installationId: installationId || null,
        title: reason === 'manual' ? 'Backing up worlds' : 'Automatic world backup',
        subtitle: `${total} world${total === 1 ? '' : 's'} · ${skipped} unchanged`,
        run: async ({ signal, onProgress }) => {
          try {
            const summary = await this.execute(plan, reason, { signal, onProgress })
            await this.finish(summary, reason, skipped)
            return summary
          } finally {
            this.running = false
            this.emitStatus()
          }
        },
      })
    } catch (error) {
      this.running = false
      this.emitStatus()
      throw error
    }
    return { ...this.status(), started: true, job }
  }

  async execute(plan, reason, { signal, onProgress }) {
    const summary = { backedUp: 0, failed: 0, failedWorlds: [] }
    for (let index = 0; index < plan.length; index += 1) {
      if (signal.aborted) throw Object.assign(new Error('Backup cancelled.'), { name: 'AbortError' })
      const item = plan[index]
      onProgress({
        stage: `Backing up ${item.world.folder}`,
        progress: Math.round((index / plan.length) * 100),
        indeterminate: false,
        filesDone: index,
        filesTotal: plan.length,
        currentFile: item.world.folder,
      })
      try {
        await this.worldsService.backupWorld(item.installation.id, item.world.folder, {
          automatic: reason !== 'manual',
          contentHash: item.world.signature.contentHash,
        })
        summary.backedUp += 1
      } catch (error) {
        summary.failed += 1
        summary.failedWorlds.push({ folder: item.world.folder, message: error.message })
        this.logger.warn('World backup failed', {
          installation: item.installation.name,
          world: item.world.folder,
          message: error.message,
        })
      }
    }
    if (signal.aborted) throw Object.assign(new Error('Backup cancelled.'), { name: 'AbortError' })
    onProgress({ stage: 'Backed up', progress: 100, indeterminate: false, filesDone: plan.length, filesTotal: plan.length })
    return summary
  }

  async finish(summary, reason, skipped) {
    const at = new Date().toISOString()
    this.lastRunAt = at
    this.lastResult = { at, reason, backedUp: summary.backedUp, skipped, failed: summary.failed }
    const installationIds = [...new Set(this.store.installations.map((installation) => installation.id))]
    for (const id of installationIds) {
      const installation = this.store.getInstallation(id)
      const policy = installation?.backupPolicy || this.store.settings.backups
      await this.worldsService.pruneBackups(id, policy).catch((error) => {
        this.logger.warn('Could not prune world backups', { installationId: id, message: error.message })
      })
    }
    if (summary.backedUp || summary.failed) {
      const detail = `${summary.backedUp} backed up · ${skipped} unchanged${summary.failed ? ` · ${summary.failed} failed` : ''}`
      await this.store
        .addActivity({
          type: 'world',
          title:
            reason === 'daily'
              ? 'Daily world backup finished'
              : reason === 'exit'
                ? 'Backed up worlds after playing'
                : 'World backup finished',
          detail,
          installationId: null,
          status: summary.failed ? 'error' : 'success',
        })
        .catch(() => {})
      this.emitActivity?.()
    }
    if (summary.failed) {
      this.emitNotification?.({
        level: 'error',
        title: 'Some worlds could not be backed up',
        message: `${summary.failed} world${summary.failed === 1 ? '' : 's'} failed. ${summary.failedWorlds[0]?.message || 'Open Tasks for details.'}`,
      })
    }
  }
}
