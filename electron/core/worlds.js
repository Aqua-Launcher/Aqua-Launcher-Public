import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { atomicWriteJson, ensureDir, isPathInside, randomId, readJsonFile, slugify } from './util.js'
import { planRetention, worldContentSignature } from './backup-scheduler.js'

const MAX_LEVEL_BYTES = 32 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_ICON_BYTES = 1024 * 1024
const BACKUP_INDEX_VERSION = 1
const BACKUP_ID_PATTERN = /^[a-z0-9-]{8,80}$/i
const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator']
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard']

/** Minimal big-endian NBT reader for the handful of tags level.dat uses. */
class NbtReader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  ensure(bytes) {
    if (this.offset + bytes > this.buffer.length) throw new Error('The level data ended unexpectedly.')
  }

  u8() {
    this.ensure(1)
    return this.buffer.readUInt8(this.offset++)
  }

  i8() {
    this.ensure(1)
    return this.buffer.readInt8(this.offset++)
  }

  i16() {
    this.ensure(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  u16() {
    this.ensure(2)
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  i32() {
    this.ensure(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  i64() {
    this.ensure(8)
    const value = this.buffer.readBigInt64BE(this.offset)
    this.offset += 8
    return value
  }

  f32() {
    this.ensure(4)
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  f64() {
    this.ensure(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  string() {
    const length = this.u16()
    this.ensure(length)
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }

  payload(type) {
    switch (type) {
      case 1:
        return this.i8()
      case 2:
        return this.i16()
      case 3:
        return this.i32()
      case 4:
        return this.i64()
      case 5:
        return this.f32()
      case 6:
        return this.f64()
      case 7: {
        const length = this.i32()
        if (length < 0 || length > MAX_UNCOMPRESSED_BYTES) throw new Error('The level data is too large.')
        this.ensure(length)
        this.offset += length
        return null
      }
      case 8:
        return this.string()
      case 9: {
        const itemType = this.u8()
        const length = this.i32()
        if (length < 0 || length > 1_000_000) throw new Error('The level data is too large.')
        const list = []
        for (let index = 0; index < length; index += 1) list.push(this.payload(itemType))
        return list
      }
      case 10: {
        const compound = {}
        for (;;) {
          const childType = this.u8()
          if (childType === 0) break
          const name = this.string()
          compound[name] = this.payload(childType)
        }
        return compound
      }
      case 11: {
        const length = this.i32()
        if (length < 0 || length > 1_000_000) throw new Error('The level data is too large.')
        const values = []
        for (let index = 0; index < length; index += 1) values.push(this.i32())
        return values
      }
      case 12: {
        const length = this.i32()
        if (length < 0 || length > 1_000_000) throw new Error('The level data is too large.')
        const values = []
        for (let index = 0; index < length; index += 1) values.push(this.i64())
        return values
      }
      default:
        throw new Error('The level data uses an unsupported tag.')
    }
  }
}

/** Parses a decompressed level.dat payload into a plain object. */
export function parseNbtRoot(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) throw new Error('The level data is empty.')
  const reader = new NbtReader(buffer)
  const type = reader.u8()
  if (type !== 10) throw new Error('The level data is not a compound tag.')
  reader.string()
  return reader.payload(10)
}

function safeNumber(value, fallback = 0) {
  if (typeof value === 'bigint') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeLastPlayed(value, fallbackMs) {
  const numeric = safeNumber(value, 0)
  // LastPlayed is epoch milliseconds. Ignore zero and obviously bogus values.
  if (numeric > 100_000_000_000 && numeric < 4_102_444_800_000) return new Date(numeric).toISOString()
  return fallbackMs ? new Date(fallbackMs).toISOString() : null
}

async function directoryStats(dirPath) {
  const result = { bytes: 0, files: 0 }
  const walk = async (current, depth) => {
    if (depth > 24) return
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(entryPath)
          result.bytes += stat.size
          result.files += 1
        } catch {
          // A file can disappear while a world is saving; skip it.
        }
      }
    }
  }
  await walk(dirPath, 0)
  return result
}

async function readWorldIcon(worldDir) {
  const iconPath = path.join(worldDir, 'icon.png')
  try {
    const stat = await fsp.stat(iconPath)
    if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return null
    const bytes = await fsp.readFile(iconPath)
    return `data:image/png;base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Reads the display metadata Minecraft stores in a world's level.dat. */
export async function readWorldMetadata(worldDir) {
  const fallback = { name: path.basename(worldDir), lastPlayed: null, versionName: null }
  let level = null
  try {
    const compressed = await fsp.readFile(path.join(worldDir, 'level.dat'))
    if (compressed.length > MAX_LEVEL_BYTES) throw new Error('The level data is too large.')
    const raw = zlib.gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES })
    const root = parseNbtRoot(raw)
    level = root?.Data && typeof root.Data === 'object' ? root.Data : root
  } catch {
    level = null
  }
  if (!level || typeof level !== 'object') return fallback

  const name = typeof level.LevelName === 'string' && level.LevelName.trim() ? level.LevelName.trim() : fallback.name
  const gameType = Math.max(0, Math.min(3, Math.round(safeNumber(level.GameType, 0))))
  const difficulty = Math.max(0, Math.min(3, Math.round(safeNumber(level.Difficulty, 2))))
  const version = level.Version && typeof level.Version === 'object' ? level.Version : {}
  return {
    name,
    lastPlayed: normalizeLastPlayed(level.LastPlayed, 0),
    gameType,
    gameMode: GAME_MODES[gameType] || 'survival',
    hardcore: safeNumber(level.hardcore, 0) === 1,
    difficulty: DIFFICULTIES[difficulty] || 'normal',
    versionName: typeof version.Name === 'string' ? version.Name : null,
    dataVersion: safeNumber(version.Id, 0) || null,
    cheats: safeNumber(level.allowCommands, 0) === 1,
  }
}

function backupIndexFile(installationId) {
  return path.join(installationId, 'index.json')
}

export class WorldsService {
  constructor({ paths, store, logger }) {
    this.paths = paths
    this.store = store
    this.logger = logger
  }

  installation(installationId) {
    const installation = this.store.getInstallation(installationId)
    if (!installation) throw new Error('Installation not found.')
    return installation
  }

  savesDirectory(installation) {
    return path.join(installation.gameDir, 'saves')
  }

  backupsDirectory(installationId) {
    return path.join(this.paths.backupsRoot, installationId)
  }

  async resolveWorld(installation, folder) {
    if (typeof folder !== 'string' || !folder.trim()) throw new Error('Choose a world.')
    if (folder !== path.basename(folder) || folder === '.' || folder === '..') {
      throw new Error('That world folder is invalid.')
    }
    const saves = this.savesDirectory(installation)
    const target = path.resolve(saves, folder)
    if (!isPathInside(target, saves) || target === path.resolve(saves)) {
      throw new Error('That world is outside the saves folder.')
    }
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('That world folder no longer exists.')
    return target
  }

  async list(installationId) {
    const installation = this.installation(installationId)
    const saves = this.savesDirectory(installation)
    let entries = []
    try {
      entries = await fsp.readdir(saves, { withFileTypes: true })
    } catch {
      entries = []
    }

    const worlds = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const worldDir = path.join(saves, entry.name)
      const stat = await fsp.stat(worldDir).catch(() => null)
      if (!stat?.isDirectory()) continue
      const [metadata, size, iconDataUrl] = await Promise.all([
        readWorldMetadata(worldDir),
        directoryStats(worldDir),
        readWorldIcon(worldDir),
      ])
      worlds.push({
        folder: entry.name,
        name: metadata.name,
        lastPlayed: metadata.lastPlayed || stat.mtime.toISOString(),
        gameMode: metadata.gameMode || 'survival',
        hardcore: Boolean(metadata.hardcore),
        difficulty: metadata.difficulty || 'normal',
        versionName: metadata.versionName || null,
        cheats: Boolean(metadata.cheats),
        sizeBytes: size.bytes,
        files: size.files,
        iconDataUrl,
      })
    }
    worlds.sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())

    return {
      directory: saves,
      exists: entries.length > 0,
      worlds,
      backups: await this.listBackups(installationId),
    }
  }

  /** Lightweight names for the command palette; no icons, sizes or backups. */
  async searchIndex() {
    const records = []
    for (const installation of this.store.installations) {
      const saves = this.savesDirectory(installation)
      const entries = await fsp.readdir(saves, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const worldDir = path.join(saves, entry.name)
        const stat = await fsp.stat(worldDir).catch(() => null)
        if (!stat?.isDirectory()) continue
        records.push({ installation, folder: entry.name, worldDir, modified: stat.mtime.toISOString() })
      }
    }

    const worlds = []
    for (let index = 0; index < records.length; index += 12) {
      const batch = records.slice(index, index + 12)
      const loaded = await Promise.all(
        batch.map(async (record) => {
          const metadata = await readWorldMetadata(record.worldDir)
          return {
            installationId: record.installation.id,
            installationName: record.installation.name,
            folder: record.folder,
            name: metadata.name,
            gameMode: metadata.gameMode || 'survival',
            versionName: metadata.versionName || null,
            lastPlayed: metadata.lastPlayed || record.modified,
          }
        }),
      )
      worlds.push(...loaded)
    }
    worlds.sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())
    return worlds
  }

  async readBackupIndex(installationId) {
    const indexFile = path.join(this.paths.backupsRoot, backupIndexFile(installationId))
    const raw = await readJsonFile(indexFile, null)
    if (!raw || raw.version !== BACKUP_INDEX_VERSION || !Array.isArray(raw.backups)) return []
    return raw.backups
      .filter((backup) => backup && typeof backup.id === 'string' && BACKUP_ID_PATTERN.test(backup.id))
      .map((backup) => ({
        id: backup.id,
        worldFolder: typeof backup.worldFolder === 'string' ? backup.worldFolder : '',
        name: typeof backup.name === 'string' ? backup.name : backup.worldFolder || 'World',
        createdAt: typeof backup.createdAt === 'string' ? backup.createdAt : new Date(0).toISOString(),
        sizeBytes: Number(backup.sizeBytes) || 0,
        note: typeof backup.note === 'string' ? backup.note : null,
        pinned: backup.pinned === true,
        automatic: backup.automatic === true,
        contentHash: typeof backup.contentHash === 'string' ? backup.contentHash : null,
        lastBackupAt:
          typeof backup.lastBackupAt === 'string'
            ? backup.lastBackupAt
            : typeof backup.createdAt === 'string'
              ? backup.createdAt
              : null,
      }))
  }

  async writeBackupIndex(installationId, backups) {
    const directory = this.backupsDirectory(installationId)
    await ensureDir(directory)
    await atomicWriteJson(path.join(directory, 'index.json'), {
      version: BACKUP_INDEX_VERSION,
      backups,
    })
  }

  async listBackups(installationId) {
    const backups = await this.readBackupIndex(installationId)
    const result = []
    for (const backup of backups) {
      const file = path.join(this.backupsDirectory(installationId), `${backup.id}.zip`)
      const stat = await fsp.stat(file).catch(() => null)
      if (!stat?.isFile()) continue
      result.push({ ...backup, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() })
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  /** Zips a world into the launcher's backup folder. */
  /** Folders and their content fingerprints, without the cost of icons/metadata. */
  async listWorldSignatures(installationId) {
    const installation = this.installation(installationId)
    const saves = this.savesDirectory(installation)
    const entries = await fsp.readdir(saves, { withFileTypes: true }).catch(() => [])
    const worlds = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const worldDir = path.join(saves, entry.name)
      worlds.push({ folder: entry.name, signature: await worldContentSignature(worldDir) })
    }
    return worlds
  }

  async backupWorld(installationId, folder, { note = null, automatic = false, contentHash = null } = {}) {
    const installation = this.installation(installationId)
    const worldDir = await this.resolveWorld(installation, folder)
    const metadata = await readWorldMetadata(worldDir)
    // Keep the archive name readable when someone opens the backups folder.
    const slug = slugify(folder).slice(0, 32) || 'world'
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14)
    const id = `${slug}-${stamp}-${randomId().slice(0, 8)}`
    const directory = this.backupsDirectory(installationId)
    await ensureDir(directory)
    const target = path.join(directory, `${id}.zip`)
    const temporary = `${target}.part`

    try {
      const zip = new AdmZip()
      zip.addLocalFolder(worldDir, folder)
      // A partly written archive must never replace or confuse the previous good one.
      await fsp.writeFile(temporary, zip.toBuffer())
      await fsp.rename(temporary, target)
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {})
      await fsp.rm(target, { force: true }).catch(() => {})
      throw new Error(`Could not create the world backup: ${error.message}`)
    }

    const stat = await fsp.stat(target)
    const backup = {
      id,
      worldFolder: folder,
      name: metadata.name || folder,
      createdAt: new Date().toISOString(),
      sizeBytes: stat.size,
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : null,
      pinned: false,
      automatic: automatic === true,
      contentHash: typeof contentHash === 'string' ? contentHash : null,
      lastBackupAt: new Date().toISOString(),
    }
    const backups = await this.readBackupIndex(installationId)
    backups.unshift(backup)
    await this.writeBackupIndex(installationId, backups)
    this.logger.info('Created world backup', { installation: installation.name, world: folder, backup: id })
    return backup
  }

  /** Applies the count/size policy. Index rows are only removed after the ZIPs. */
  async pruneBackups(installationId, policy) {
    const backups = await this.listBackups(installationId)
    const plan = planRetention(backups, policy)
    if (!plan.deleteIds.length) return { deleted: 0, freedBytes: 0 }
    for (const id of plan.deleteIds) {
      await fsp.rm(this.backupFile(installationId, id), { force: true }).catch(() => {})
    }
    const remaining = (await this.readBackupIndex(installationId)).filter(
      (backup) => !plan.deleteIds.includes(backup.id),
    )
    await this.writeBackupIndex(installationId, remaining)
    this.logger.info('Pruned world backups', { installationId, deleted: plan.deleteIds.length })
    return { deleted: plan.deleteIds.length, freedBytes: plan.freedBytes }
  }

  backupFile(installationId, backupId) {
    if (typeof backupId !== 'string' || !BACKUP_ID_PATTERN.test(backupId)) {
      throw new Error('That backup is invalid.')
    }
    const file = path.resolve(this.backupsDirectory(installationId), `${backupId}.zip`)
    if (!isPathInside(file, this.backupsDirectory(installationId))) throw new Error('That backup is invalid.')
    return file
  }

  /**
   * Restores a backup next to the existing world instead of overwriting it, so a
   * bad restore can never destroy the current save.
   */
  async restoreBackup(installationId, backupId) {
    const installation = this.installation(installationId)
    const backups = await this.readBackupIndex(installationId)
    const backup = backups.find((item) => item.id === backupId)
    if (!backup) throw new Error('That backup is no longer available.')
    const zipFile = this.backupFile(installationId, backupId)
    const stat = await fsp.stat(zipFile).catch(() => null)
    if (!stat?.isFile()) throw new Error('The backup file is missing.')

    let zip
    try {
      zip = new AdmZip(zipFile)
    } catch {
      throw new Error('That backup archive could not be opened.')
    }

    const tempRoot = path.join(this.paths.cacheRoot, 'world-restore', `${backupId}-${Date.now()}`)
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    await ensureDir(tempRoot)

    try {
      let files = 0
      for (const entry of zip.getEntries()) {
        const entryName = String(entry.entryName || '').replace(/\\/g, '/')
        if (!entryName || entryName.endsWith('/') || entry.isDirectory) continue
        if (entryName.startsWith('/') || entryName.includes('\0')) continue
        const parts = entryName.split('/')
        if (parts.some((part) => !part || part === '.' || part === '..')) continue
        const destination = path.resolve(tempRoot, entryName)
        if (!isPathInside(destination, tempRoot)) continue
        await ensureDir(path.dirname(destination))
        await fsp.writeFile(destination, entry.getData())
        files += 1
      }
      if (!files) throw new Error('That backup archive is empty.')

      const extracted = await fsp.readdir(tempRoot, { withFileTypes: true })
      const source = extracted.find((entry) => entry.isDirectory())
      if (!source) throw new Error('The backup does not contain a world folder.')

      const saves = this.savesDirectory(installation)
      await ensureDir(saves)
      const base = backup.worldFolder || source.name
      const destinationFolder = await this.uniqueFolder(saves, base)
      const destination = path.join(saves, destinationFolder)
      await moveDirectory(path.join(tempRoot, source.name), destination)
      return {
        folder: destinationFolder,
        name: backup.name,
        files,
        note: backup.note,
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    }
  }

  async uniqueFolder(saves, base) {
    const root = typeof base === 'string' && base.trim() ? base.trim() : 'World'
    let candidate = root
    if (!(await exists(path.join(saves, candidate)))) return candidate
    candidate = `${root} (restored)`
    let index = 2
    while (await exists(path.join(saves, candidate))) {
      candidate = `${root} (restored ${index})`
      index += 1
    }
    return candidate
  }

  async deleteBackup(installationId, backupId) {
    this.installation(installationId)
    const file = this.backupFile(installationId, backupId)
    await fsp.rm(file, { force: true })
    const backups = (await this.readBackupIndex(installationId)).filter((backup) => backup.id !== backupId)
    await this.writeBackupIndex(installationId, backups)
    return { id: backupId }
  }

  /** Permanently deletes a world folder from the installation. */
  async deleteWorld(installationId, folder) {
    const installation = this.installation(installationId)
    const worldDir = await this.resolveWorld(installation, folder)
    await fsp.rm(worldDir, { recursive: true, force: true })
    this.logger.info('Deleted Minecraft world', { installation: installation.name, world: folder })
    return { folder }
  }

  /** Resolves the saves root, or one world folder, for the open-in-explorer action. */
  async folderPath(installationId, folder = null) {
    const installation = this.installation(installationId)
    if (folder != null && folder !== '') return this.resolveWorld(installation, folder)
    const saves = this.savesDirectory(installation)
    await ensureDir(saves)
    return saves
  }
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/** Move a directory, falling back to copy + remove across drive boundaries. */
async function moveDirectory(source, destination) {
  try {
    await fsp.rename(source, destination)
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error
    await fsp.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
    await fsp.rm(source, { recursive: true, force: true })
  }
}

export { directoryStats, GAME_MODES }
