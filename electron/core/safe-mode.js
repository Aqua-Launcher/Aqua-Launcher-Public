import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, sha1File } from './util.js'

/**
 * Safe Mode is deliberately narrow: only loose content files are moved aside.
 * Worlds, options, configs and datapacks are never touched, and anything a mod
 * manager already disabled stays where it is.
 */
const CONTENT_SOURCES = [
  { folder: 'mods', extensions: ['.jar'] },
  { folder: 'resourcepacks', extensions: ['.zip'] },
  { folder: 'shaderpacks', extensions: ['.zip'] },
]

const SAFE_DIRECTORY = path.join('.aqua', 'safe-mode')
const MANIFEST_NAME = 'manifest.json'

function manifestPath(gameDir, sessionId) {
  return path.join(gameDir, SAFE_DIRECTORY, sessionId, MANIFEST_NAME)
}

function stagedRoot(gameDir, sessionId) {
  return path.join(gameDir, SAFE_DIRECTORY, sessionId)
}

function stagedPath(gameDir, sessionId, relative) {
  return path.join(stagedRoot(gameDir, sessionId), 'files', relative)
}

async function statFile(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

async function readManifest(filePath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'))
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files)) return null
    parsed.files = parsed.files.filter(
      (entry) => entry && typeof entry.relative === 'string' && typeof entry.sha1 === 'string',
    )
    return parsed
  } catch {
    return null
  }
}

async function writeManifest(filePath, manifest) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  await fsp.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
  await fsp.rename(temporary, filePath)
}

/**
 * Renaming is atomic within one volume. A library on another drive falls back
 * to copy + hash verification + remove, so a half-copied file is never kept.
 */
async function moveFile(source, destination, expectedSha1) {
  try {
    await fsp.rename(source, destination)
    return
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
  }
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL)
  if (expectedSha1) {
    const actual = await sha1File(destination)
    if (actual.toLowerCase() !== expectedSha1.toLowerCase()) {
      await fsp.rm(destination, { force: true }).catch(() => {})
      throw new Error('A copied file did not match its checksum.')
    }
  }
  await fsp.rm(source, { force: true })
}

async function removeEmptySafeDirectories(gameDir, sessionId) {
  const root = stagedRoot(gameDir, sessionId)
  await fsp.rmdir(path.dirname(root)).catch(() => {})
  await fsp.rmdir(path.join(gameDir, '.aqua')).catch(() => {})
}

/**
 * Moves mods, resource packs and shaders into `.aqua/safe-mode/<sessionId>/`.
 * The manifest is written before every move, so a killed launcher can always
 * find its way back. A partial failure rolls everything back and refuses the
 * launch rather than starting half-safe.
 */
export async function stageContent(gameDir, { sessionId = crypto.randomUUID() } = {}) {
  if (typeof gameDir !== 'string' || !gameDir) throw new Error('A game directory is required.')
  const safeSessionId = path.basename(String(sessionId))
  if (!safeSessionId || safeSessionId !== String(sessionId)) throw new Error('The Safe Mode session id is invalid.')

  const candidates = []
  for (const source of CONTENT_SOURCES) {
    const folder = path.join(gameDir, source.folder)
    let entries
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const name = entry.name.toLowerCase()
      if (name.endsWith('.disabled')) continue
      if (!source.extensions.some((extension) => name.endsWith(extension))) continue
      const original = path.join(folder, entry.name)
      const stat = await statFile(original)
      if (!stat) continue
      candidates.push({
        original,
        relative: path.join(source.folder, entry.name),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha1: await sha1File(original),
      })
    }
  }

  if (!candidates.length) return { sessionId: safeSessionId, movedFiles: 0, stagedRoot: null }

  const sessionRoot = stagedRoot(gameDir, safeSessionId)
  const file = manifestPath(gameDir, safeSessionId)
  const manifest = {
    version: 1,
    sessionId: safeSessionId,
    createdAt: new Date().toISOString(),
    files: [],
  }
  await fsp.mkdir(path.join(sessionRoot, 'files'), { recursive: true })

  try {
    for (const candidate of candidates) {
      const record = {
        relative: candidate.relative,
        size: candidate.size,
        mtimeMs: candidate.mtimeMs,
        sha1: candidate.sha1,
      }
      manifest.files.push(record)
      await writeManifest(file, manifest)
      const destination = stagedPath(gameDir, safeSessionId, candidate.relative)
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      await moveFile(candidate.original, destination, candidate.sha1)
    }
  } catch (error) {
    await restoreStaged(gameDir, safeSessionId).catch(() => {})
    throw new Error(`Safe Mode could not move your content aside: ${error.message}`)
  }

  return { sessionId: safeSessionId, movedFiles: manifest.files.length, stagedRoot: sessionRoot }
}

/**
 * Puts staged files back. A file that changed while Safe Mode was active is
 * reported as a conflict and left untouched in the staged folder; it is never
 * overwritten. Running this twice is safe.
 */
export async function restoreStaged(gameDir, sessionId) {
  if (typeof gameDir !== 'string' || !gameDir) throw new Error('A game directory is required.')
  const safeSessionId = path.basename(String(sessionId))
  if (!safeSessionId || safeSessionId !== String(sessionId)) throw new Error('The Safe Mode session id is invalid.')

  const file = manifestPath(gameDir, safeSessionId)
  const manifest = await readManifest(file)
  if (!manifest) {
    return { sessionId: safeSessionId, present: false, restored: 0, conflicts: [], missing: 0, errors: 0, pending: false }
  }

  const sessionRoot = stagedRoot(gameDir, safeSessionId)
  const remaining = []
  const conflicts = []
  let restored = 0
  let missing = 0
  let errors = 0

  for (const record of manifest.files) {
    // A manifest is data on disk, so never trust its paths blindly.
    const original = path.resolve(gameDir, record.relative)
    const staged = stagedPath(gameDir, safeSessionId, record.relative)
    if (!isPathInside(original, gameDir) || !isPathInside(staged, sessionRoot)) {
      conflicts.push({ relative: record.relative, reason: 'invalid-path' })
      remaining.push(record)
      continue
    }

    const stagedStat = await statFile(staged)
    if (!stagedStat) {
      const originalStat = await statFile(original)
      if (originalStat) {
        const current = await sha1File(original)
        if (current.toLowerCase() === record.sha1.toLowerCase()) {
          restored += 1
          continue
        }
      }
      // Nothing can be put back; report it and stop carrying the record.
      missing += 1
      continue
    }

    const originalStat = await statFile(original)
    if (originalStat) {
      const current = await sha1File(original)
      if (current.toLowerCase() === record.sha1.toLowerCase()) {
        // Already restored by an earlier pass.
        await fsp.rm(staged, { force: true }).catch(() => {})
        restored += 1
        continue
      }
      conflicts.push({ relative: record.relative, reason: 'changed' })
      remaining.push(record)
      continue
    }

    try {
      await fsp.mkdir(path.dirname(original), { recursive: true })
      await moveFile(staged, original, record.sha1)
      restored += 1
    } catch (error) {
      errors += 1
      remaining.push(record)
    }
  }

  if (remaining.length) {
    manifest.files = remaining
    manifest.updatedAt = new Date().toISOString()
    await writeManifest(file, manifest)
  } else {
    await fsp.rm(sessionRoot, { recursive: true, force: true })
    await removeEmptySafeDirectories(gameDir, safeSessionId)
  }

  return {
    sessionId: safeSessionId,
    present: true,
    restored,
    conflicts,
    missing,
    errors,
    pending: remaining.length > 0,
  }
}

/**
 * Restores every session left behind in the given game directories. This runs
 * at startup and on quit, so a killed launcher or game cannot strand content.
 */
export async function recoverOrphans(gameDirs = []) {
  const directories = [...new Set(gameDirs.filter(Boolean).map((dir) => path.resolve(dir)))]
  const sessions = []
  let restored = 0
  let conflicts = 0

  for (const gameDir of directories) {
    let entries
    try {
      entries = await fsp.readdir(path.join(gameDir, SAFE_DIRECTORY), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const result = await restoreStaged(gameDir, entry.name).catch((error) => ({
        sessionId: entry.name,
        present: true,
        restored: 0,
        conflicts: [],
        missing: 0,
        errors: 1,
        pending: true,
        error: error.message,
      }))
      if (!result.present) continue
      restored += result.restored
      conflicts += result.conflicts.length
      sessions.push({ gameDir, ...result })
    }
  }

  return { sessions, restored, conflicts, pending: sessions.some((session) => session.pending) }
}
