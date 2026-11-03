import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, ensureDir, isPathInside, readJsonFile } from './util.js'

const CACHE_VERSION = 1
const CONTENT_TYPES = {
  mods: { folder: 'mods', extensions: ['.jar'], kind: 'mod' },
  resourcepacks: { folder: 'resourcepacks', extensions: ['.zip'], kind: 'pack' },
  shaderpacks: { folder: 'shaderpacks', extensions: ['.zip'], kind: 'pack' },
  datapacks: { folder: 'datapacks', extensions: ['.zip'], kind: 'pack' },
}

const hashText = (value) => crypto.createHash('sha1').update(value).digest('hex')

function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function stringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : text(entry?.name)))
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function rangeValue(value) {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const parts = value.filter((entry) => typeof entry === 'string' && entry.trim())
    return parts.length ? parts.join(', ') : null
  }
  return null
}

function readEntry(zip, name) {
  try {
    const entry = zip.getEntry(name)
    return entry ? entry.getData().toString('utf8') : null
  } catch {
    return null
  }
}

function readJsonEntry(zip, name) {
  const raw = readEntry(zip, name)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function tomlValue(raw) {
  return text(raw)
    .trim()
    .replace(/^["']|["']$/g, '')
}

/**
 * A deliberately small `mods.toml` reader: only the keys the launcher shows.
 * It never pretends to be a general TOML parser.
 */
export function parseForgeToml(source, loader = 'forge') {
  const lines = text(source).split(/\r?\n/)
  const mods = []
  const dependencies = []
  let block = null
  for (const line of lines) {
    if (/^\s*\[\[mods\]\]\s*(?:#.*)?$/.test(line)) {
      block = { kind: 'mod' }
      mods.push(block)
      continue
    }
    if (/^\s*\[\[dependencies\.[^\]]+\]\]\s*(?:#.*)?$/.test(line)) {
      block = { kind: 'dependency' }
      dependencies.push(block)
      continue
    }
    if (/^\s*\[/.test(line)) {
      block = null
      continue
    }
    if (!block) continue
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    block[match[1]] = tomlValue(match[2])
  }

  const primary = mods.find((entry) => entry.modId)
  if (!primary) return null
  const minecraftRange = dependencies.find((entry) => entry.modId === 'minecraft')?.versionRange || null
  return {
    modId: primary.modId,
    name: primary.displayName || primary.modId,
    version: primary.version || null,
    authors: stringList(primary.authors || primary.authorList),
    loader,
    mcRange: minecraftRange,
    requiredDependencies: dependencies
      .filter((entry) => entry.modId && text(entry.mandatory || 'true').toLowerCase() !== 'false')
      .map((entry) => entry.modId),
  }
}

/**
 * Reads identity metadata from one mod jar. A malformed archive returns null;
 * scanning a folder never fails because one jar is broken.
 */
export function readJarMetadata(filePath) {
  let zip
  try {
    zip = new AdmZip(filePath)
    if (!zip.getEntries().length) return null
  } catch {
    return null
  }

  const fabric = readJsonEntry(zip, 'fabric.mod.json')
  if (fabric) {
    return {
      modId: text(fabric.id).trim() || null,
      name: text(fabric.name || fabric.id).trim() || null,
      version: text(fabric.version).trim() || null,
      authors: stringList(fabric.authors),
      loader: 'fabric',
      mcRange: rangeValue(fabric.depends?.minecraft),
      requiredDependencies: Object.keys(fabric.depends && typeof fabric.depends === 'object' ? fabric.depends : {}),
    }
  }

  const quilt = readJsonEntry(zip, 'quilt.mod.json')
  if (quilt) {
    const loader = quilt.quilt_loader && typeof quilt.quilt_loader === 'object' ? quilt.quilt_loader : {}
    const metadata = loader.metadata && typeof loader.metadata === 'object' ? loader.metadata : {}
    const depends = Array.isArray(loader.depends)
      ? loader.depends.map((entry) => text(entry?.id)).filter(Boolean)
      : Object.keys(loader.depends && typeof loader.depends === 'object' ? loader.depends : {})
    const minecraft = Array.isArray(loader.depends)
      ? loader.depends.find((entry) => entry?.id === 'minecraft')
      : null
    return {
      modId: text(loader.id || quilt.id).trim() || null,
      name: text(metadata.name || loader.id || quilt.id).trim() || null,
      version: text(metadata.version || loader.version).trim() || null,
      authors: [
        ...stringList(metadata.authors),
        ...Object.keys(metadata.contributors && typeof metadata.contributors === 'object' ? metadata.contributors : {}),
      ],
      loader: 'quilt',
      mcRange: rangeValue(minecraft?.versions || (typeof loader.depends === 'object' ? loader.depends?.minecraft : null)),
      requiredDependencies: depends,
    }
  }

  const neoforge = readEntry(zip, 'META-INF/neoforge.mods.toml')
  if (neoforge) return parseForgeToml(neoforge, 'neoforge')
  const forge = readEntry(zip, 'META-INF/mods.toml')
  if (forge) return parseForgeToml(forge, 'forge')

  const legacy = readJsonEntry(zip, 'mcmod.info')
  if (legacy) {
    const list = Array.isArray(legacy) ? legacy : Array.isArray(legacy.modList) ? legacy.modList : [legacy]
    const mod = list.find((entry) => entry && (entry.modid || entry.modId))
    if (mod) {
      return {
        modId: text(mod.modid || mod.modId).trim() || null,
        name: text(mod.name || mod.modid || mod.modId).trim() || null,
        version: text(mod.version).trim() || null,
        authors: stringList(mod.authorList || mod.authors || mod.author),
        loader: 'forge',
        mcRange: rangeValue(mod.mcversion),
        requiredDependencies: stringList(mod.requiredMods || mod.dependencies).map((entry) => entry.split(':')[0]),
      }
    }
  }

  return null
}

/** The manifest a user would see if they opened the jar, capped for the UI. */
export function readRawJarManifest(filePath) {
  let zip
  try {
    zip = new AdmZip(filePath)
    if (!zip.getEntries().length) return null
  } catch {
    return null
  }

  const candidates = [
    ['fabric.mod.json', 'json'],
    ['quilt.mod.json', 'json'],
    ['META-INF/neoforge.mods.toml', 'toml'],
    ['META-INF/mods.toml', 'toml'],
    ['mcmod.info', 'json'],
  ]
  for (const [name, format] of candidates) {
    const raw = readEntry(zip, name)
    if (!raw) continue
    let content = raw
    if (format === 'json') {
      try {
        content = JSON.stringify(JSON.parse(raw), null, 2)
      } catch {
        content = raw
      }
    }
    return { source: name, format, content: content.slice(0, 20_000) }
  }
  return null
}

function descriptionText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return text(value.text || value.translate || value.key)
  return ''
}

/**
 * Reads `pack.mcmeta` and, for shaderpacks, the shader folders. The type is
 * inferred from the archive layout because a shaderpack is also a resource pack.
 */
export function readPackMetadata(filePath) {
  let zip
  try {
    zip = new AdmZip(filePath)
    if (!zip.getEntries().length) return null
  } catch {
    return null
  }

  const entries = zip.getEntries().map((entry) => entry.entryName.replace(/\\/g, '/'))
  const shaders = new Set()
  for (const entryName of entries) {
    const match = /^shaders\/([^/]+)\//.exec(entryName)
    if (match) shaders.add(match[1])
  }

  let mcmeta = null
  const raw = readEntry(zip, 'pack.mcmeta')
  if (raw) {
    try {
      mcmeta = JSON.parse(raw)
    } catch {
      mcmeta = null
    }
  }
  const pack = mcmeta?.pack && typeof mcmeta.pack === 'object' ? mcmeta.pack : {}
  const described = pack.description ?? mcmeta?.description
  const format = Number(pack.pack_format ?? mcmeta?.pack_format)
  const hasAssets = entries.some((entry) => entry.startsWith('assets/'))
  const hasData = entries.some((entry) => entry.startsWith('data/'))
  const type = shaders.size ? 'shaderpack' : hasData && !hasAssets ? 'datapack' : 'resourcepack'

  return {
    modId: null,
    name: path.basename(filePath).replace(/\.zip(?:\.disabled)?$/i, ''),
    version: null,
    authors: [],
    loader: null,
    mcRange: null,
    requiredDependencies: [],
    description: descriptionText(described) || null,
    format: Number.isFinite(format) ? format : null,
    shaders: [...shaders].sort(),
    type,
  }
}

function contentType(value) {
  const normalized = text(value).trim()
  if (!CONTENT_TYPES[normalized]) throw new Error('Choose a valid content type.')
  return normalized
}

/** Scans one content folder without touching the network or the cache. */
export async function scanContent(gameDir, type) {
  const contentTypeId = contentType(type)
  const config = CONTENT_TYPES[contentTypeId]
  const directory = path.join(gameDir, config.folder)
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const disabled = entry.name.toLowerCase().endsWith('.disabled')
    const base = disabled ? entry.name.slice(0, -'.disabled'.length) : entry.name
    if (!config.extensions.some((extension) => base.toLowerCase().endsWith(extension))) continue
    const fullPath = path.join(directory, entry.name)
    const stat = await fsp.stat(fullPath).catch(() => null)
    if (!stat?.isFile()) continue

    let metadata = null
    let reason = null
    try {
      metadata = config.kind === 'mod' ? readJarMetadata(fullPath) : readPackMetadata(fullPath)
      if (!metadata) reason = 'No readable metadata was found in this file.'
    } catch (error) {
      reason = `The archive could not be read: ${error.message}`
    }

    files.push({
      filename: entry.name,
      enabled: !disabled,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      metadata,
      reason,
    })
  }

  files.sort((a, b) => a.filename.localeCompare(b.filename))
  return { directory, exists: entries.length > 0, files }
}

async function directorySignature(directory) {
  const stat = await fsp.stat(directory).catch(() => null)
  if (!stat?.isDirectory()) return 'missing'
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fileStat = await fsp.stat(path.join(directory, entry.name)).catch(() => null)
    if (!fileStat) continue
    files.push([entry.name, fileStat.size, fileStat.mtimeMs])
  }
  files.sort((a, b) => a[0].localeCompare(b[0]))
  return hashText(JSON.stringify({ directoryMtime: stat.mtimeMs, files }))
}

/** Disk-backed content index; a signature mismatch rebuilds it automatically. */
export class ContentIndexService {
  constructor({ paths, logger }) {
    this.paths = paths
    this.logger = logger
    this.cacheRoot = path.join(paths.cacheRoot, 'content-index')
  }

  cacheFile(gameDir, type) {
    const key = hashText(`${path.resolve(gameDir).toLowerCase()}|${type}`).slice(0, 24)
    return path.join(this.cacheRoot, `${key}.json`)
  }

  /** One file, including the raw manifest, for the installed-content inspector. */
  async file(gameDir, type, filename) {
    const contentTypeId = contentType(type)
    const config = CONTENT_TYPES[contentTypeId]
    const directory = path.join(gameDir, config.folder)
    if (typeof filename !== 'string' || !filename.trim() || filename !== path.basename(filename)) {
      throw new Error('That file is outside the content folder.')
    }
    const disabled = filename.toLowerCase().endsWith('.disabled')
    const base = disabled ? filename.slice(0, -'.disabled'.length) : filename
    if (!config.extensions.some((extension) => base.toLowerCase().endsWith(extension))) {
      throw new Error('That file is not content this folder can inspect.')
    }
    const target = path.resolve(directory, filename)
    if (!isPathInside(target, directory)) throw new Error('That file is outside the content folder.')
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat?.isFile()) throw new Error('That content file no longer exists.')

    const metadata = config.kind === 'mod' ? readJarMetadata(target) : readPackMetadata(target)
    return {
      filename,
      enabled: !disabled,
      directory,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      installedAt: new Date(stat.mtimeMs).toISOString(),
      metadata,
      reason: metadata ? null : 'No readable metadata was found in this file.',
      raw: config.kind === 'mod' ? readRawJarManifest(target) : null,
    }
  }

  async list(gameDir, type, { force = false } = {}) {
    const contentTypeId = contentType(type)
    if (!isPathInside(path.resolve(gameDir), path.resolve(gameDir))) throw new Error('Invalid game directory.')
    const directory = path.join(gameDir, CONTENT_TYPES[contentTypeId].folder)
    const signature = await directorySignature(directory)
    const file = this.cacheFile(gameDir, contentTypeId)

    if (!force) {
      const cached = await readJsonFile(file, null)
      if (cached?.version === CACHE_VERSION && cached.signature === signature && Array.isArray(cached.files)) {
        return { ...cached, cached: true }
      }
    }

    const scanned = await scanContent(gameDir, contentTypeId)
    const result = {
      version: CACHE_VERSION,
      gameDir,
      contentType: contentTypeId,
      directory: scanned.directory,
      exists: scanned.exists,
      files: scanned.files,
      signature,
      scannedAt: new Date().toISOString(),
      cached: false,
    }
    try {
      await ensureDir(this.cacheRoot)
      await atomicWriteJson(file, result)
    } catch (error) {
      this.logger?.warn('Could not write the content index cache', { message: error.message })
    }
    return result
  }
}
