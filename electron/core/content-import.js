import fsp from 'node:fs/promises'
import path from 'node:path'
import { readPackMetadata } from './content-index.js'
import { isPathInside } from './util.js'

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024
const MAX_IMPORT_FILES = 20
const FOLDERS = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
}

const TARGET_LABELS = {
  mod: 'Mods',
  resourcepack: 'Resource packs',
  shader: 'Shader packs',
  bedrock: 'Bedrock add-ons',
}

export function importExtension(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase()
  if (name.endsWith('.jar')) return 'mod'
  if (name.endsWith('.zip')) return 'zip'
  if (name.endsWith('.mrpack')) return 'mrpack'
  if (name.endsWith('.mcpack') || name.endsWith('.mcaddon') || name.endsWith('.mcworld')) return 'bedrock'
  return null
}

export function importTargetLabel(target) {
  return TARGET_LABELS[target] || 'Content'
}

/**
 * Read-only plan for a drop. Every path is treated as hostile input: it must be
 * absolute, a regular file, not a symlink, and within the size cap.
 */
export async function planImports({ paths = [], gameDir = null, bedrockEditionId = null } = {}) {
  const list = Array.isArray(paths) ? paths.slice(0, MAX_IMPORT_FILES) : []
  const items = []

  for (const sourcePath of list) {
    const filename = path.basename(String(sourcePath || '')) || 'unknown file'
    const item = {
      sourcePath: typeof sourcePath === 'string' ? sourcePath : '',
      filename,
      target: 'unsupported',
      destination: null,
      conflict: false,
      reason: null,
    }
    try {
      if (typeof sourcePath !== 'string' || !sourcePath.trim() || !path.isAbsolute(sourcePath)) {
        throw new Error('Only absolute file paths can be imported.')
      }
      const stat = await fsp.lstat(sourcePath).catch(() => null)
      if (!stat) throw new Error('That file could not be read.')
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not imported.')
      if (!stat.isFile()) throw new Error('Folders are not supported yet. Drop a file instead.')
      if (stat.size > MAX_IMPORT_BYTES) throw new Error('That file is too large to import.')
      if (!stat.size && !/\.(jar|zip|mcpack|mcaddon|mcworld)$/i.test(sourcePath)) {
        throw new Error('That file is empty or is not a supported content file.')
      }

      const kind = importExtension(sourcePath)
      if (!kind) throw new Error('Drop a .jar, .zip, .mrpack, .mcpack, or .mcaddon file.')
      if (kind === 'mrpack') throw new Error('Modpack import is not available yet. Install a modpack from Modrinth for now.')
      if (kind === 'bedrock') {
        if (!bedrockEditionId) throw new Error('Choose a Bedrock edition before importing this add-on.')
        item.target = 'bedrock'
        items.push(item)
        continue
      }

      let target = 'mod'
      if (kind === 'zip') {
        const metadata = readPackMetadata(sourcePath)
        if (!metadata) throw new Error('That zip does not contain readable resource-pack or shader-pack metadata.')
        if (metadata.type === 'shaderpack') target = 'shader'
        else if (metadata.type === 'resourcepack') target = 'resourcepack'
        else throw new Error('Datapack import is not available yet.')
      }

      if (!gameDir) throw new Error('Choose a Java installation before importing this file.')
      const folder = FOLDERS[target]
      const directory = path.resolve(gameDir, folder)
      if (!isPathInside(directory, path.resolve(gameDir))) throw new Error('That content folder is invalid.')
      const destination = path.resolve(directory, filename)
      if (!isPathInside(destination, directory) || destination === directory) {
        throw new Error('That file name is outside the content folder.')
      }

      item.target = target
      item.destination = destination
      item.conflict = Boolean(await fsp.stat(destination).catch(() => null))
      items.push(item)
    } catch (error) {
      item.reason = error.message
      items.push(item)
    }
  }
  return items
}

async function uniqueDestination(destination) {
  const extension = path.extname(destination)
  const base = destination.slice(0, -extension.length)
  let candidate = destination
  let index = 2
  while (await fsp.stat(candidate).catch(() => null)) {
    candidate = `${base} (${index})${extension}`
    index += 1
  }
  return candidate
}

async function copyAtomic(source, destination, replace) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.aqua-import-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await fsp.copyFile(source, temporary)
    if (replace) await fsp.rm(destination, { force: true })
    await fsp.rename(temporary, destination)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Execute (or preflight with `dryRun`) a drop. A dropped original is always
 * copied, never moved. `conflictPolicy: 'ask'` performs no Java writes if any
 * destination already exists, so the caller can ask the user.
 */
export async function runImports({
  paths = [],
  gameDir = null,
  conflictPolicy = 'ask',
  bedrockEditionId = null,
  bedrockImport = null,
  dryRun = false,
  gameRunning = false,
} = {}) {
  const items = await planImports({ paths, gameDir, bedrockEditionId })
  const conflicts = items
    .filter((item) => item.conflict && !item.reason)
    .map((item) => ({ filename: item.filename, destination: item.destination }))
  const errors = items
    .filter((item) => item.reason)
    .map((item) => ({ filename: item.filename, reason: item.reason }))
  const skipped = []
  const imported = []

  if (dryRun || (conflictPolicy === 'ask' && conflicts.length)) {
    return { items, imported, skipped, conflicts, errors, gameRunning }
  }

  for (const item of items) {
    if (item.reason) continue
    if (item.target === 'bedrock') {
      if (!bedrockImport) {
        errors.push({ filename: item.filename, reason: 'Bedrock add-on import is not available.' })
        continue
      }
      try {
        const result = await bedrockImport(bedrockEditionId, item.sourcePath)
        const names = [
          ...result.installed.map((pack) => pack.name),
          ...result.worlds,
        ]
        imported.push({
          filename: item.filename,
          contentType: 'bedrock',
          destination: names.join(', ') || item.filename,
        })
        for (const name of result.skipped) skipped.push({ filename: item.filename, reason: `Skipped ${name}` })
      } catch (error) {
        errors.push({ filename: item.filename, reason: error.message })
      }
      continue
    }

    if (item.conflict && conflictPolicy === 'skip') {
      skipped.push({ filename: item.filename, reason: 'A file with that name already exists.' })
      continue
    }
    try {
      const destination =
        item.conflict && conflictPolicy === 'keep-both' ? await uniqueDestination(item.destination) : item.destination
      await copyAtomic(item.sourcePath, destination, item.conflict && conflictPolicy === 'replace')
      imported.push({
        filename: path.basename(destination),
        contentType: item.target,
        destination,
      })
    } catch (error) {
      errors.push({ filename: item.filename, reason: error.message })
    }
  }

  return { items, imported, skipped, conflicts, errors, gameRunning }
}
