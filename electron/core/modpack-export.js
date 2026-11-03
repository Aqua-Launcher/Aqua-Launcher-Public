import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, randomId } from './util.js'

const CONTENT_DIRECTORIES = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'defaultconfigs']
const LOADER_DEPENDENCIES = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
}

function normalizedRelative(gameDir, filePath) {
  return path.relative(gameDir, filePath).split(path.sep).join('/')
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const sha1 = crypto.createHash('sha1')
    const sha512 = crypto.createHash('sha512')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      sha1.update(chunk)
      sha512.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ sha1: sha1.digest('hex'), sha512: sha512.digest('hex') }))
  })
}

function wantsFile(directory, filename) {
  const lower = filename.toLowerCase()
  if (directory === 'mods') return lower.endsWith('.jar') || lower.endsWith('.jar.disabled')
  if (directory === 'resourcepacks' || directory === 'shaderpacks') {
    return lower.endsWith('.zip') || lower.endsWith('.zip.disabled')
  }
  return true
}

async function walk(root, { relative = '', directory = '', hash = true, skipped = [] } = {}) {
  const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const nextRelative = relative ? path.join(relative, entry.name) : entry.name
    const absolute = path.join(root, nextRelative)
    if (entry.isSymbolicLink()) {
      skipped.push(normalizedRelative(root, absolute))
      continue
    }
    if (entry.isDirectory()) {
      files.push(...(await walk(root, { relative: nextRelative, directory: directory || entry.name, hash, skipped })))
      continue
    }
    if (!entry.isFile()) continue
    if (directory === 'mods' || directory === 'resourcepacks' || directory === 'shaderpacks') {
      if (!wantsFile(directory, entry.name)) continue
    }
    const stat = await fsp.lstat(absolute).catch(() => null)
    if (!stat?.isFile()) continue
    files.push({
      absolute,
      relative: normalizedRelative(root, absolute),
      size: stat.size,
      ...(hash ? await hashFile(absolute) : {}),
    })
  }
  return files
}

function contentKind(relative) {
  const top = relative.split('/')[0]
  return CONTENT_DIRECTORIES.includes(top) ? top : null
}

function safePackName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  return (name || 'Aqua modpack').slice(0, 80)
}

function downloadFile(version, sha1) {
  const files = Array.isArray(version?.files) ? version.files : []
  return (
    files.find((file) => file?.hashes?.sha1 === sha1) ||
    files.find((file) => typeof file?.url === 'string' && /^https?:\/\//.test(file.url))
  )
}

/**
 * Builds an .mrpack without leaving the game folder. Matched hashes become
 * verified downloads; every other content/config file is bundled as an override.
 * Worlds are deliberately excluded unless the caller opts in.
 */
export class ModpackExportService {
  constructor({ modrinthService = null, logger = null }) {
    this.modrinthService = modrinthService
    this.logger = logger
  }

  async scan(installation, includeWorlds = false) {
    if (!installation?.gameDir) throw new Error('That installation has no game folder.')
    const gameDir = path.resolve(installation.gameDir)
    const skipped = []
    const content = []
    for (const directory of CONTENT_DIRECTORIES) {
      const directoryRoot = path.join(gameDir, directory)
      const found = await walk(directoryRoot, { directory, hash: true, skipped })
      content.push(...found.map((file) => ({ ...file, relative: normalizedRelative(gameDir, file.absolute) })))
    }

    const worldRoot = path.join(gameDir, 'saves')
    const worldFiles = await walk(worldRoot, { hash: false, skipped })
    const worlds = worldFiles.map((file) => ({
      ...file,
      relative: normalizedRelative(gameDir, file.absolute),
    }))

    const contentHashes = [...new Set(content.map((file) => file.sha1).filter(Boolean))]
    let versions = {}
    let matchWarning = null
    if (contentHashes.length && this.modrinthService?.lookupHashes) {
      try {
        versions = await this.modrinthService.lookupHashes(contentHashes)
      } catch (error) {
        matchWarning = `Modrinth matching failed; all content will be bundled: ${error.message}`
      }
    }

    const files = content.map((file) => {
      const version = file.sha1 ? versions[file.sha1] : null
      const remote = file.relative.endsWith('.disabled') ? null : downloadFile(version, file.sha1)
      if (remote?.url) {
        return {
          absolute: file.absolute,
          path: file.relative,
          kind: 'download',
          sha1: file.sha1,
          sha512: file.sha512,
          size: file.size,
          url: remote.url,
          projectId: version.project_id || null,
          versionId: version.id || null,
        }
      }
      return {
        absolute: file.absolute,
        path: file.relative,
        kind: 'override',
        sha1: file.sha1,
        sha512: file.sha512,
        size: file.size,
        projectId: version?.project_id || null,
        versionId: version?.id || null,
      }
    })

    if (includeWorlds) {
      for (const file of worlds) {
        files.push({
          absolute: file.absolute,
          path: file.relative,
          kind: 'world',
          size: file.size,
        })
      }
    }

    const downloadable = files.filter((file) => file.kind === 'download')
    const bundled = files.filter((file) => file.kind === 'override')
    const worldBytes = worlds.reduce((total, file) => total + file.size, 0)
    const warnings = []
    if (skipped.length) warnings.push(`${skipped.length} symlinked file${skipped.length === 1 ? '' : 's'} skipped.`)
    if (matchWarning) warnings.push(matchWarning)
    if (!downloadable.length && !bundled.length) warnings.push('No mods, packs, or configs were found in this game folder.')
    if (includeWorlds && worlds.length) {
      warnings.push(`${worlds.length} world file${worlds.length === 1 ? '' : 's'} will be bundled (${formatSize(worldBytes)}).`)
    }

    return {
      gameDir,
      files,
      downloadable,
      bundled,
      worlds,
      worldBytes,
      skipped,
      warnings,
      name: safePackName(installation.modpack?.name || installation.name),
      versionId: installation.modpack?.versionId || '1.0.0',
      minecraftVersion: installation.versionId,
      loader: installation.loader || { type: 'vanilla', version: null },
    }
  }

  async preview(installation, { includeWorlds = false } = {}) {
    const scanned = await this.scan(installation, Boolean(includeWorlds))
    return {
      name: scanned.name,
      versionId: scanned.versionId,
      minecraftVersion: scanned.minecraftVersion,
      loader: scanned.loader,
      includeWorlds: Boolean(includeWorlds),
      downloadable: scanned.downloadable.length,
      downloadableBytes: scanned.downloadable.reduce((total, file) => total + file.size, 0),
      bundled: scanned.bundled.length,
      bundledBytes: scanned.bundled.reduce((total, file) => total + file.size, 0),
      worldFiles: scanned.worlds.length,
      worldBytes: scanned.worldBytes,
      totalBytes:
        scanned.files.reduce((total, file) => total + file.size, 0),
      warnings: scanned.warnings,
      files: scanned.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        size: file.size,
        projectId: file.projectId || null,
        versionId: file.versionId || null,
      })),
    }
  }

  async export(installation, { includeWorlds = false, destination, preview = null, onProgress = () => {} } = {}) {
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
      throw new Error('Choose where to save the modpack.')
    }
    const plan = preview && preview.includeWorlds === Boolean(includeWorlds)
      ? preview
      : await this.preview(installation, { includeWorlds })
    const scanned = await this.scan(installation, Boolean(includeWorlds))
    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: plan.versionId,
      name: plan.name,
      files: scanned.downloadable.map((file) => ({
        path: file.path,
        hashes: { sha1: file.sha1, sha512: file.sha512 },
        downloads: [file.url],
        fileSize: file.size,
      })),
      dependencies: {
        minecraft: scanned.minecraftVersion,
      },
    }
    if (scanned.loader?.type && scanned.loader.type !== 'vanilla' && scanned.loader.version) {
      index.dependencies[LOADER_DEPENDENCIES[scanned.loader.type] || scanned.loader.type] = scanned.loader.version
    }

    const zip = new AdmZip()
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)))
    const overrides = scanned.files.filter((file) => file.kind === 'override' || file.kind === 'world')
    for (const file of overrides) {
      const parent = path.posix.dirname(file.path)
      const folder = parent === '.' ? 'overrides' : `overrides/${parent}`
      zip.addLocalFile(file.absolute, folder, path.posix.basename(file.path))
    }

    await ensureDir(path.dirname(destination))
    const temporary = `${destination}.${randomId()}.tmp`
    onProgress({ stage: 'Writing modpack', progress: null })
    try {
      zip.writeZip(temporary)
      await fsp.rename(temporary, destination)
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {})
      throw new Error(`Could not write the modpack: ${error.message}`)
    }

    this.logger?.info('Exported Modrinth modpack', {
      name: plan.name,
      downloadable: scanned.downloadable.length,
      overrides: overrides.length,
      includeWorlds: Boolean(includeWorlds),
    })
    return {
      path: destination,
      filename: path.basename(destination),
      ...plan,
      includeWorlds: Boolean(includeWorlds),
      totalBytes: scanned.files.reduce((total, file) => total + file.size, 0),
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export { contentKind }
