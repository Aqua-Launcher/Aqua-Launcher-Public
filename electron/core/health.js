import AdmZip from 'adm-zip'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applicableLibraries, getPlatformContext, mavenPath } from './minecraft-rules.js'
import { effectiveVersionId } from './installations.js'
import { readInstallMarker } from './installer.js'
import { fileExists, formatBytes, isPathInside, readJsonFile } from './util.js'

const CACHE_MS = 30_000
const MB = 1024 * 1024
const STATUS_RANK = { ok: 0, unknown: 1, warn: 2, error: 3 }
const LOADER_ALIASES = new Set([
  'minecraft',
  'java',
  'fabric',
  'fabricloader',
  'quilt',
  'quilt_loader',
  'forge',
  'neoforge',
  'javafml',
  'lowcodefml',
])
const FIX_KINDS = new Set(['reinstall', 'open-settings', 'open-folder', 'create-directory', 'open-content'])

export function worstStatus(checks) {
  let worst = 'ok'
  for (const check of checks || []) {
    if ((STATUS_RANK[check.status] ?? 0) > (STATUS_RANK[worst] ?? 0)) worst = check.status
  }
  return worst
}

function check(id, status, title, detail, fix = null) {
  return { id, status, title, detail, ...(fix ? { fix } : {}) }
}

function fix(kind, label) {
  if (!FIX_KINDS.has(kind)) throw new Error(`Unsupported health fix: ${kind}`)
  return { kind, label }
}

function readJsonEntry(zip, name) {
  try {
    const entry = zip.getEntry(name)
    if (!entry) return null
    return JSON.parse(entry.getData().toString('utf8'))
  } catch {
    return null
  }
}

function stripTomlValue(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
}

/** Reads the identity and mandatory dependencies from one mod jar. */
export function parseModMetadata(jarPath) {
  let zip
  try {
    zip = new AdmZip(jarPath)
    if (!zip.getEntries().length) return null
  } catch {
    return null
  }

  const fabric = readJsonEntry(zip, 'fabric.mod.json')
  if (fabric) {
    return {
      loader: 'fabric',
      id: stripTomlValue(fabric.id),
      name: stripTomlValue(fabric.name || fabric.id),
      dependencies: Object.keys(fabric.depends && typeof fabric.depends === 'object' ? fabric.depends : {}),
    }
  }

  const quilt = readJsonEntry(zip, 'quilt.mod.json')
  if (quilt) {
    const loader = quilt.quilt_loader && typeof quilt.quilt_loader === 'object' ? quilt.quilt_loader : {}
    const depends = Array.isArray(loader.depends)
      ? loader.depends.map((entry) => stripTomlValue(entry?.id)).filter(Boolean)
      : Object.keys(loader.depends && typeof loader.depends === 'object' ? loader.depends : {})
    return {
      loader: 'quilt',
      id: stripTomlValue(loader.id || quilt.id),
      name: stripTomlValue(loader.metadata?.name || loader.id || quilt.id),
      dependencies: depends,
    }
  }

  const neoforge = zip.getEntry('META-INF/neoforge.mods.toml')
  if (neoforge) return parseForgeToml(neoforge.getData().toString('utf8'), 'neoforge')
  const forge = zip.getEntry('META-INF/mods.toml')
  if (forge) return parseForgeToml(forge.getData().toString('utf8'), 'forge')
  return null
}

/** Minimal TOML block reader for `[[mods]]` and `[[dependencies.<id>]]`. */
export function parseForgeToml(text, loader = 'forge') {
  const lines = String(text || '').split(/\r?\n/)
  const mods = []
  const dependencies = []
  let block = null
  for (const line of lines) {
    if (/^\s*\[\[mods\]\]/.test(line)) {
      block = { kind: 'mods' }
      mods.push(block)
      continue
    }
    if (/^\s*\[\[dependencies\.[^\]]+\]\]/.test(line)) {
      block = { kind: 'dependencies' }
      dependencies.push(block)
      continue
    }
    if (/^\s*\[/.test(line)) {
      block = null
      continue
    }
    if (!block) continue
    const match = /^\s*(modId|displayName|mandatory)\s*=\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    block[match[1]] = stripTomlValue(match[2])
  }
  const primary = mods.find((entry) => entry.modId)
  if (!primary) return null
  return {
    loader,
    id: primary.modId,
    name: primary.displayName || primary.modId,
    dependencies: dependencies
      .filter((entry) => entry.modId && String(entry.mandatory || 'true').toLowerCase() !== 'false')
      .map((entry) => entry.modId),
  }
}

function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative.trim()) return null
  const target = path.resolve(root, relative)
  return isPathInside(target, root) ? target : null
}

function loaderMismatch(installedLoader, modLoader) {
  if (installedLoader === 'fabric') return modLoader !== 'fabric'
  if (installedLoader === 'quilt') return modLoader !== 'fabric' && modLoader !== 'quilt'
  if (installedLoader === 'forge') return modLoader !== 'forge'
  if (installedLoader === 'neoforge') return modLoader !== 'forge' && modLoader !== 'neoforge'
  return true
}

function loaderLabel(value) {
  return { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' }[value] || value
}

/**
 * Answers "is this installation healthy?" without changing anything. Every row
 * carries a plain-English detail; fixes are only the allow-listed safe actions.
 */
export async function checkInstallation(
  { installation, store, paths, javaService, contentIndex },
  options = {},
) {
  const checks = []
  const cheap = options.cheap === true
  const versionId = effectiveVersionId(installation)
  const marker = await readInstallMarker(paths, versionId).catch(() => null)
  const versionFile =
    resolveInside(paths.minecraftRoot, marker?.versionJson) ||
    path.join(paths.versionsRoot, versionId, `${versionId}.json`)
  const versionJson = await readJsonFile(versionFile, null)

  checks.push(
    versionJson
      ? check('version-json', 'ok', 'Version metadata', `${versionId}.json is present and readable.`)
      : check(
          'version-json',
          'error',
          'Version metadata is missing',
          `Aqua could not read versions/${versionId}/${versionId}.json. Repair the installation to download it again.`,
          fix('reinstall', 'Repair install'),
        ),
  )

  if (versionJson) {
    const jarVersionId = versionJson.jarVersionId || versionJson.id || versionId
    const clientJar =
      resolveInside(paths.minecraftRoot, marker?.clientJar) ||
      path.join(paths.versionsRoot, jarVersionId, `${jarVersionId}.jar`)
    const clientPresent = await fileExists(clientJar)
    checks.push(
      clientPresent
        ? check('client-jar', 'ok', 'Client jar', `Minecraft ${jarVersionId} client jar is present.`)
        : check(
            'client-jar',
            'error',
            'Client jar is missing',
            'The game cannot start without its client jar. Repair the installation to download it.',
            fix('reinstall', 'Repair install'),
          ),
    )

    const assetIndexId = versionJson.assetIndex?.id || versionJson.assets
    const assetIndexFile =
      resolveInside(paths.minecraftRoot, marker?.assetIndex) ||
      (assetIndexId ? path.join(paths.assetsRoot, 'indexes', `${assetIndexId}.json`) : null)
    const assetsPresent = assetIndexFile ? await fileExists(assetIndexFile) : false
    checks.push(
      assetsPresent
        ? check('asset-index', 'ok', 'Asset index', `Asset index ${assetIndexId} is present.`)
        : check(
            'asset-index',
            'error',
            'Asset index is missing',
            'Sounds, languages and models come from the asset index. Repair the installation to restore it.',
            fix('reinstall', 'Repair install'),
          ),
    )

    if (!cheap) {
      let checked = 0
      const missing = []
      try {
        const libraries = applicableLibraries(versionJson, getPlatformContext({ has_custom_resolution: false }))
        for (const library of libraries) {
          if (checked >= 80) break
          const relative =
            library.downloads?.artifact?.path ||
            (Array.isArray(library.name?.split(':')) && library.name.split(':').length >= 3 && !library.natives
              ? mavenPath(library.name)
              : null)
          if (!relative) continue
          checked += 1
          const target = path.resolve(paths.librariesRoot, relative)
          if (!isPathInside(target, paths.librariesRoot) || !(await fileExists(target))) missing.push(relative)
        }
      } catch (error) {
        checks.push(
          check('libraries', 'unknown', 'Libraries', `The library list could not be read: ${error.message}`),
        )
      }
      if (!checks.some((entry) => entry.id === 'libraries')) {
        checks.push(
          missing.length
            ? check(
                'libraries',
                'error',
                'Game libraries are missing',
                `${missing.length} of ${checked} checked libraries are missing (${missing.slice(0, 3).join(', ')}). Repair the installation.`,
                fix('reinstall', 'Repair install'),
              )
            : check('libraries', 'ok', 'Game libraries', `${checked} libraries checked and present.`),
        )
      }
    }
  } else {
    checks.push(check('client-jar', 'unknown', 'Client jar', 'Waiting for the version metadata.'))
    checks.push(check('asset-index', 'unknown', 'Asset index', 'Waiting for the version metadata.'))
    if (!cheap) checks.push(check('libraries', 'unknown', 'Game libraries', 'Waiting for the version metadata.'))
  }

  if (javaService?.detect) {
    const required = Number(versionJson?.javaVersion?.majorVersion) || 8
    try {
      const runtimes = await javaService.detect()
      const newest = runtimes.reduce((best, runtime) => (!best || runtime.major > best.major ? runtime : best), null)
      if (!newest) {
        checks.push(
          check(
            'java',
            'error',
            'No Java runtime found',
            `This version needs Java ${required}. Install a runtime from Settings → Java.`,
            fix('open-settings', 'Open Java settings'),
          ),
        )
      } else if (newest.major < required) {
        checks.push(
          check(
            'java',
            'error',
            'Java is too old',
            `Minecraft ${versionId} needs Java ${required}, but the newest installed runtime is Java ${newest.major}.`,
            fix('open-settings', 'Open Java settings'),
          ),
        )
      } else {
        checks.push(check('java', 'ok', 'Java runtime', `Java ${newest.major} is available (Java ${required} required).`))
      }
    } catch (error) {
      checks.push(check('java', 'unknown', 'Java runtime', `Java detection failed: ${error.message}`))
    }
  }

  const memory = installation.memoryOverride || store?.settings?.memory
  const totalMemMb = Number(options.totalMemMb) || Math.round(os.totalmem() / MB)
  if (memory && Number.isFinite(memory.minMb) && Number.isFinite(memory.maxMb)) {
    if (memory.minMb < 512 || memory.maxMb < memory.minMb) {
      checks.push(
        check(
          'memory',
          'error',
          'Memory allocation is invalid',
          `Minimum ${memory.minMb} MB and maximum ${memory.maxMb} MB cannot be used. Set a sane allocation.`,
          fix('open-settings', 'Open memory settings'),
        ),
      )
    } else if (memory.maxMb > totalMemMb) {
      checks.push(
        check(
          'memory',
          'error',
          'Memory allocation exceeds installed RAM',
          `${memory.maxMb} MB is above the ${Math.round(totalMemMb / 1024)} GB installed.`,
          fix('open-settings', 'Open memory settings'),
        ),
      )
    } else if (memory.maxMb > totalMemMb * 0.85) {
      checks.push(
        check(
          'memory',
          'warn',
          'Memory allocation is very high',
          `${memory.maxMb} MB leaves little room for Windows and other apps.`,
          fix('open-settings', 'Open memory settings'),
        ),
      )
    } else {
      checks.push(check('memory', 'ok', 'Memory allocation', `${memory.minMb}–${memory.maxMb} MB is within installed RAM.`))
    }
  }

  let gameDirStat = null
  try {
    gameDirStat = await fsp.stat(installation.gameDir)
  } catch {
    gameDirStat = null
  }
  if (!gameDirStat?.isDirectory()) {
    checks.push(
      check(
        'game-dir',
        'error',
        'Game folder is missing',
        `${installation.gameDir} does not exist. Create it to keep worlds and settings in place.`,
        fix('create-directory', 'Create folder'),
      ),
    )
  } else {
    let writable = true
    try {
      await fsp.access(installation.gameDir, fs.constants.W_OK)
    } catch {
      writable = false
    }
    checks.push(
      writable
        ? check('game-dir', 'ok', 'Game folder', 'The game folder exists and is writable.')
        : check(
            'game-dir',
            'error',
            'Game folder is not writable',
            'Minecraft cannot save worlds or settings without write access.',
            fix('open-folder', 'Open game folder'),
          ),
    )

    let freeBytes = Number(options.freeBytes)
    if (!Number.isFinite(freeBytes)) {
      const stats = await fsp.statfs(installation.gameDir).catch(() => null)
      freeBytes = stats ? Number(stats.bavail) * Number(stats.bsize) : NaN
    }
    if (Number.isFinite(freeBytes)) {
      checks.push(
        freeBytes < 512 * MB
          ? check(
              'disk-space',
              'error',
              'Very little free disk space',
              `${formatBytes(freeBytes)} free. Minecraft needs room for worlds, screenshots and updates.`,
              fix('open-folder', 'Open game folder'),
            )
          : freeBytes < 2 * 1024 * MB
            ? check(
                'disk-space',
                'warn',
                'Low disk space',
                `${formatBytes(freeBytes)} free. Consider freeing space before installing a large modpack.`,
                fix('open-folder', 'Open game folder'),
              )
            : check('disk-space', 'ok', 'Disk space', `${formatBytes(freeBytes)} free.`),
      )
    }

    const normalizePath = (value) => {
      const resolved = path.resolve(value)
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved
    }
    const key = normalizePath(installation.gameDir)
    const shared = (store?.installations || []).filter(
      (other) => other.id !== installation.id && normalizePath(other.gameDir) === key,
    )
    checks.push(
      shared.length
        ? check(
            'shared-directory',
            'warn',
            'Game folder is shared',
            `This folder is also used by ${shared.map((entry) => entry.name).join(', ')}. Mods, worlds and options can overwrite each other.`,
            fix('open-folder', 'Open game folder'),
          )
        : check('shared-directory', 'ok', 'Game folder ownership', 'No other installation uses this game folder.'),
    )
  }

  const installedLoader = installation.loader?.type || 'vanilla'
  if (installedLoader !== 'vanilla') {
    const profileMatches =
      versionJson &&
      versionJson.id === versionId &&
      (!versionJson.inheritsFrom || versionJson.inheritsFrom === installation.versionId)
    checks.push(
      profileMatches
        ? check(
            'loader',
            'ok',
            'Loader profile',
            `${loaderLabel(installedLoader)} profile ${versionId} matches Minecraft ${installation.versionId}.`,
          )
        : check(
            'loader',
            'warn',
            'Loader profile does not match',
            `${loaderLabel(installedLoader)} ${installation.loader?.version || ''} is selected, but the installed profile is ${versionJson?.id || 'missing'}.`,
            fix('reinstall', 'Repair install'),
          ),
    )
  } else {
    const vanillaMatches = versionJson ? versionJson.id === versionId : false
    checks.push(
      vanillaMatches
        ? check('loader', 'ok', 'Loader profile', 'Vanilla profile matches the selected Minecraft version.')
        : check('loader', 'unknown', 'Loader profile', 'The vanilla profile could not be confirmed until the metadata is repaired.'),
    )
  }

  if (!cheap) {
    const modsDir = path.join(installation.gameDir, 'mods')
    const entries = await fsp.readdir(modsDir, { withFileTypes: true }).catch(() => [])
    const jars = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
      .slice(0, 120)
    const disabled = entries.filter((entry) => entry.isFile() && /\.(jar|zip)\.disabled$/i.test(entry.name))
    const mods = []
    for (const jar of jars) {
      const metadata = parseModMetadata(path.join(modsDir, jar.name))
      if (metadata?.id) mods.push({ ...metadata, file: jar.name })
    }

    const byId = new Map()
    for (const mod of mods) {
      const files = byId.get(mod.id) || []
      files.push(mod.file)
      byId.set(mod.id, files)
    }
    for (const [id, files] of byId) {
      if (files.length < 2) continue
      checks.push(
        check(
          'duplicate-mods',
          'error',
          `Duplicate mod ID: ${id}`,
          `The same mod id appears in ${files.join(' and ')}. Keep one copy; the game may behave unpredictably.`,
          fix('open-content', 'Open mods folder'),
        ),
      )
    }

    const wrongLoader = mods.filter((mod) => loaderMismatch(installedLoader, mod.loader))
    if (wrongLoader.length) {
      checks.push(
        check(
          'mod-loader',
          'warn',
          'Mods built for another loader',
          `${wrongLoader.length} mod${wrongLoader.length === 1 ? '' : 's'} do not match ${loaderLabel(installedLoader)}: ${wrongLoader
            .slice(0, 3)
            .map((mod) => mod.file)
            .join(', ')}${wrongLoader.length > 3 ? '…' : ''}. They will not load.`,
          fix('open-content', 'Open mods folder'),
        ),
      )
    } else if (mods.length) {
      checks.push(check('mod-loader', 'ok', 'Mod loader compatibility', `${mods.length} mods match ${loaderLabel(installedLoader)}.`))
    } else {
      checks.push(check('mod-loader', 'ok', 'Mod loader compatibility', 'No loadable mods are installed.'))
    }

    const ids = new Set(mods.map((mod) => mod.id))
    const missingDependencies = []
    for (const mod of mods) {
      for (const dependency of mod.dependencies) {
        if (!dependency || LOADER_ALIASES.has(dependency) || ids.has(dependency)) continue
        missingDependencies.push(`${mod.name || mod.file} needs ${dependency}`)
      }
    }
    if (missingDependencies.length) {
      checks.push(
        check(
          'mod-dependencies',
          'warn',
          'Missing mod dependencies',
          `${missingDependencies.slice(0, 3).join('; ')}${missingDependencies.length > 3 ? `; and ${missingDependencies.length - 3} more` : ''}.`,
          fix('open-content', 'Open mods folder'),
        ),
      )
    } else {
      checks.push(check('mod-dependencies', 'ok', 'Mod dependencies', 'Every declared dependency is installed or provided by the loader.'))
    }

    if (disabled.length) {
      checks.push(
        check(
          'disabled-mods',
          'warn',
          'Disabled mods are still on disk',
          `${disabled.length} file${disabled.length === 1 ? '' : 's'} end in .disabled (${disabled
            .slice(0, 3)
            .map((entry) => entry.name)
            .join(', ')}). Remove or re-enable them when you no longer need them.`,
          fix('open-content', 'Open mods folder'),
        ),
      )
    } else {
      checks.push(check('disabled-mods', 'ok', 'Disabled mods', 'No orphaned .disabled files in the mods folder.'))
    }
  }

  return {
    installationId: installation.id,
    status: worstStatus(checks),
    checks,
    checkedAt: new Date().toISOString(),
    versionId,
  }
}

/** Caches results for 30 seconds and collapses concurrent requests per instance. */
export class HealthService {
  constructor({ store, paths, javaService }) {
    this.store = store
    this.paths = paths
    this.javaService = javaService
    this.cache = new Map()
    this.pending = new Map()
  }

  invalidate(installationId) {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${installationId}:`)) this.cache.delete(key)
    }
  }

  async run(installation, cheap) {
    const key = `${installation.id}:${cheap ? 'summary' : 'full'}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.result
    if (this.pending.has(key)) return this.pending.get(key)
    const pending = checkInstallation(
      {
        installation,
        store: this.store,
        paths: this.paths,
        javaService: this.javaService,
      },
      { cheap },
    )
      .then((result) => {
        this.cache.set(key, { at: Date.now(), result })
        return result
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, pending)
    return pending
  }

  async check(installationId) {
    const installation = this.store.getInstallation(installationId)
    if (!installation) throw new Error('Installation not found.')
    return this.run(installation, false)
  }

  async summary() {
    const installations = await Promise.all(
      this.store.installations.map(async (installation) => ({
        installationId: installation.id,
        status: (await this.run(installation, true)).status,
      })),
    )
    return {
      installations,
      status: worstStatus(installations.map((entry) => ({ status: entry.status }))),
    }
  }
}
