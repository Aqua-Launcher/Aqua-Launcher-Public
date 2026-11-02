import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { downloadFiles } from './downloader.js'
import { getInstallationState } from './installer.js'
import {
  atomicWriteFile,
  atomicWriteJson,
  ensureDir,
  fetchJson,
  fetchWithRetry,
  fileExists,
  formatBytes,
  isPathInside,
  randomId,
  readJsonFile,
  sanitizeFileName,
} from './util.js'

const RELEASES_URL = 'https://api.github.com/repos/horizon-rust/horizon/releases?per_page=100'
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'AquaLauncher/1.0.0',
}
const RELEASE_CACHE_TTL_MS = 10 * 60 * 1000
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/
const NATIVE_TAG = /^native-[0-9a-f]{7}-[0-9a-f]{12}$/
const GAME_VERSION = /^[0-9][0-9a-z.-]{0,31}$/i
const COMPLETE_MARKER = '.aqua-horizon.json'
const RESOURCES_MANIFEST = 'horizon-resources.json'
const MAX_JSON_BYTES = 512 * 1024
const CACHE_TTL_MS = 20_000
const PREPARE_TIMEOUT_MS = 45 * 60 * 1000

/** Horizon builds the current Java Edition drop; used when a build carries no lock file. */
export const HORIZON_GAME_VERSION = '26.3'
export const HORIZON_SITE_URL = 'https://playhorizon.dev/'
export const HORIZON_FOLDER_KINDS = ['game', 'worlds', 'builds', 'build', 'downloads']

/**
 * Horizon's own mod layout, beside options.txt in the game home. A content mod
 * is a .hmod in `horizon-mods/`, a native mod is a .hnmod bundle the launcher
 * installs into `horizon-native-mods/`, resource packs are .zip files in
 * `resourcepacks/`, and `horizon-mods.txt` holds `mod.<id>:true` switches.
 * Jars from other launchers never load, so they are not accepted here.
 */
export const HORIZON_MODS_FILE = 'horizon-mods.txt'
export const HORIZON_CONTENT_MODS_DIR = 'horizon-mods'
export const HORIZON_NATIVE_MODS_DIR = 'horizon-native-mods'
export const HORIZON_RESOURCE_PACKS_DIR = 'resourcepacks'
export const HORIZON_MOD_KINDS = ['content', 'native', 'resourcepack']
export const HORIZON_MODS_URL = 'https://playhorizon.dev/mods'
export const HORIZON_NATIVE_NOTE =
  'Installed, not built into this game: Horizon runs native mods only in a game its own launcher builds.'

const DROP_NAMES = {
  '26.3': 'Wilderness Bound',
}

function abortError(message = 'Installation cancelled.') {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

function cleanJsonVersion(value) {
  const text = String(value ?? '').trim()
  return GAME_VERSION.test(text) ? text : null
}

/** The display name of the Java Edition drop a Horizon build targets. */
export function horizonDropName(gameVersion) {
  return DROP_NAMES[String(gameVersion ?? '').trim()] || null
}

/** `minecraft.version` from a Horizon build's research-lock.json, else the current drop. */
export function horizonGameVersion(lock) {
  let value = lock
  if (typeof lock === 'string') {
    try {
      value = JSON.parse(lock)
    } catch {
      value = null
    }
  }
  return cleanJsonVersion(value?.minecraft?.version) || HORIZON_GAME_VERSION
}

/** The release archive Horizon publishes for this platform. */
export function horizonAssetName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'horizon-windows-x64.zip'
  if (platform === 'darwin' && arch === 'arm64') return 'horizon-macos-arm64.zip'
  if (platform === 'linux' && arch === 'x64') return 'horizon-linux-x86_64.tar.gz'
  return null
}

export function horizonReleaseSupported(platform = process.platform, arch = process.arch) {
  return Boolean(horizonAssetName(platform, arch))
}

/** The client names a build may use, best first. macOS also wraps it in an app bundle. */
export function horizonClientCandidates(versionDirectory, platform = process.platform) {
  if (platform === 'win32') return [path.join(versionDirectory, 'horizon-client.exe')]
  if (platform === 'darwin') {
    return [
      path.join(versionDirectory, 'Horizon.app', 'Contents', 'MacOS', 'horizon-client'),
      path.join(versionDirectory, 'horizon-client'),
    ]
  }
  return [path.join(versionDirectory, 'horizon-client')]
}

/** Exactly the resource directory Horizon's preparer writes and the client reads. */
export function horizonResourcesDirectory(versionDirectory, gameVersion) {
  return path.join(versionDirectory, '.local', 'horizon-client', gameVersion)
}

/** The arguments the Rust client needs; the game home is supplied as its working directory. */
export function horizonLaunchArgs(resourcesDirectory) {
  return ['--resources', resourcesDirectory]
}

export function horizonPrepareArgs({ buildDirectory, minecraftDirectory, serverJar }) {
  return [
    '--prepare',
    '--server-jar',
    serverJar,
    '--minecraft-dir',
    minecraftDirectory,
    '--root',
    buildDirectory,
  ]
}

export function horizonSoundsArgs({ buildDirectory, minecraftDirectory }) {
  return ['sounds', '--minecraft-dir', minecraftDirectory, '--root', buildDirectory]
}

function compareReleaseTags(a, b) {
  const left = String(a?.tag || a).replace(/^v/i, '').split('.').map((part) => Number(part) || 0)
  const right = String(b?.tag || b).replace(/^v/i, '').split('.').map((part) => Number(part) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0)
    if (difference !== 0) return difference
  }
  return String(b?.tag || b).localeCompare(String(a?.tag || a))
}

function sha256Digest(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^sha256:([0-9a-f]{64})$/i)
  return match ? match[1].toLowerCase() : null
}

/**
 * Turns GitHub's release list into the stable Horizon game releases this build can
 * install. Nightly builds and the old launcher releases are deliberately left out.
 */
export function parseHorizonReleases(payload, { platform = process.platform, arch = process.arch } = {}) {
  const assetName = horizonAssetName(platform, arch)
  if (!assetName) return []
  const releases = []
  for (const release of Array.isArray(payload) ? payload : []) {
    if (!release || release.draft || release.prerelease) continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : ''
    if (!RELEASE_TAG.test(tag)) continue
    const assets = Array.isArray(release.assets) ? release.assets : []
    const asset = assets.find((entry) => entry?.name === assetName)
    if (!asset || !/^https:\/\//i.test(asset.browser_download_url || '')) continue
    const checksums = assets.find((entry) => entry?.name === 'SHA256SUMS')
    const signature = assets.find((entry) => entry?.name === 'SHA256SUMS.sig')
    releases.push({
      tag,
      name: typeof release.name === 'string' && release.name.trim() ? release.name.trim() : `Horizon ${tag}`,
      publishedAt: release.published_at || null,
      notesUrl: release.html_url || null,
      assetName,
      assetUrl: asset.browser_download_url,
      assetSize: Number(asset.size) || null,
      assetDigest: sha256Digest(asset.digest),
      checksumsUrl:
        checksums && /^https:\/\//i.test(checksums.browser_download_url || '')
          ? checksums.browser_download_url
          : null,
      signatureUrl:
        signature && /^https:\/\//i.test(signature.browser_download_url || '')
          ? signature.browser_download_url
          : null,
    })
  }
  return releases.sort(compareReleaseTags)
}

/** SHA256SUMS is `<64 hex><whitespace><name>`, with an optional `*` before the name. */
export function parseChecksums(text) {
  const checksums = new Map()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i)
    if (!match) continue
    checksums.set(match[2].replace(/^\.\//, ''), match[1].toLowerCase())
  }
  return checksums
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function exists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

async function readJsonCapped(file) {
  try {
    const stat = await fsp.stat(file)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_JSON_BYTES) return null
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    const stat = await fsp.stat(candidate).catch(() => null)
    if (stat?.isFile()) return candidate
  }
  return null
}

function safeArchivePath(name) {
  const normalized = String(name ?? '').replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null
  if (normalized.split('/').includes('..')) return null
  return normalized.replace(/^\.\//, '')
}

async function extractZip(archive, destination, signal) {
  const zip = new AdmZip(archive)
  let written = 0
  for (const entry of zip.getEntries()) {
    if (signal?.aborted) throw abortError()
    if (entry.isDirectory) continue
    const name = safeArchivePath(entry.entryName)
    if (!name) throw new Error('The Horizon archive contains an unsafe path.')
    const target = path.resolve(destination, name)
    if (!isPathInside(target, destination)) throw new Error('The Horizon archive escapes its install folder.')
    await ensureDir(path.dirname(target))
    await fsp.writeFile(target, entry.getData())
    written += 1
    if (written % 25 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  return written
}

function runProcess(program, args, { cwd, env, signal, timeoutMs = 10 * 60 * 1000, maxOutput = 200_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(program, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null
    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const onAbort = () => {
      try {
        child.kill()
      } catch {
        // The process may already be gone.
      }
      finish(abortError())
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // The process may already be gone.
      }
      finish(new Error(`${path.basename(program)} did not finish in time.`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-maxOutput)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-maxOutput)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (signal?.aborted) return finish(abortError())
      if (code === 0) return finish(null)
      const detail = stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `exit code ${code}`
      return finish(new Error(`${path.basename(program)} failed: ${detail}`))
    })
  })
}

async function extractTarGz(archive, destination, signal) {
  const listing = await runProcess('tar', ['-tzf', archive], {
    signal,
    timeoutMs: 2 * 60 * 1000,
    maxOutput: 16 * 1024 * 1024,
  })
  for (const line of listing.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!safeArchivePath(line)) throw new Error('The Horizon archive contains an unsafe path.')
  }
  await runProcess('tar', ['-xzf', archive, '-C', destination], { signal, timeoutMs: 5 * 60 * 1000 })
}

export async function extractHorizonArchive(archive, destination, signal) {
  await ensureDir(destination)
  if (/\.zip$/i.test(archive)) return extractZip(archive, destination, signal)
  if (/\.(tar\.gz|tgz)$/i.test(archive)) {
    await extractTarGz(archive, destination, signal)
    return null
  }
  throw new Error('That Horizon release has an unsupported archive format.')
}

/** The release archive wraps its files in one folder; find the folder holding the lock. */
export async function findHorizonReleaseRoot(directory, depth = 3) {
  if (await fileExists(path.join(directory, 'research-lock.json'))) return directory
  if (depth <= 0) return null
  let entries = []
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const found = await findHorizonReleaseRoot(path.join(directory, entry.name), depth - 1)
    if (found) return found
  }
  return null
}

async function makeHorizonExecutables(directory, platform) {
  if (platform === 'win32') return
  const candidates = [
    path.join(directory, 'horizon-prepare'),
    path.join(directory, 'horizon-client'),
    path.join(directory, 'Horizon.app', 'Contents', 'MacOS', 'horizon-client'),
  ]
  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate)
      if (stat.isFile()) await fsp.chmod(candidate, 0o755)
    } catch {
      // That client layout is not part of this release.
    }
  }
}

async function moveIntoPlace(source, destination) {
  await fsp.rm(destination, { recursive: true, force: true })
  await ensureDir(path.dirname(destination))
  try {
    await fsp.rename(source, destination)
  } catch {
    await fsp.cp(source, destination, { recursive: true, force: true })
    await fsp.rm(source, { recursive: true, force: true })
  }
}

async function countWorlds(directory) {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).length
  } catch {
    return 0
  }
}

/**
 * The builds Aqua installed itself. A build is listed once its marker, Rust
 * client, and research lock are all present; Play waits for the resource
 * manifest the bundled preparer writes.
 */
export async function readInstalledHorizonBuilds({
  versionsRoot,
  platform = process.platform,
} = {}) {
  let entries = []
  try {
    entries = await fsp.readdir(versionsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const builds = []
  for (const entry of entries) {
    const native = NATIVE_TAG.test(entry.name)
    if (!entry.isDirectory() || entry.isSymbolicLink() || (!RELEASE_TAG.test(entry.name) && !native)) continue
    const tag = entry.name
    const directory = path.join(versionsRoot, tag)
    const markerStat = await fsp.stat(path.join(directory, COMPLETE_MARKER)).catch(() => null)
    if (!markerStat?.isFile()) continue
    const marker = await readJsonCapped(path.join(directory, COMPLETE_MARKER))
    if (!marker || marker.kind !== (native ? 'aqua-horizon-native' : 'aqua-horizon') || marker.tag !== tag) continue
    const clientPath = await firstExisting(horizonClientCandidates(directory, platform))
    if (!clientPath) continue
    const lock = await readJsonCapped(path.join(directory, 'research-lock.json'))
    const gameVersion = cleanJsonVersion(marker.gameVersion) || horizonGameVersion(lock)
    const resourcesDirectory = horizonResourcesDirectory(directory, gameVersion)
    const prepared = await exists(path.join(resourcesDirectory, RESOURCES_MANIFEST))
    builds.push({
      tag,
      gameVersion,
      directory,
      clientPath,
      resourcesDirectory,
      prepared,
      installedAt:
        typeof marker.installedAt === 'string' && Number.isFinite(new Date(marker.installedAt).getTime())
          ? marker.installedAt
          : markerStat.mtime.toISOString(),
      archiveSha256: typeof marker.archiveSha256 === 'string' ? marker.archiveSha256 : null,
      assetName: typeof marker.assetName === 'string' ? marker.assetName : null,
      javaMajor: Number(marker.javaMajor) || null,
      warning: typeof marker.warning === 'string' ? marker.warning : null,
      native,
      baseTag: native && typeof marker.baseTag === 'string' ? marker.baseTag : null,
      revision: native && typeof marker.revision === 'string' ? marker.revision : null,
      profile: native && typeof marker.profile === 'string' ? marker.profile : null,
      nativeMods: native && Array.isArray(marker.mods) ? marker.mods.length : 0,
    })
  }

  builds.sort((a, b) => {
    const byTime = new Date(b.installedAt).getTime() - new Date(a.installedAt).getTime()
    return byTime || compareReleaseTags(a.tag, b.tag)
  })
  return builds
}

/** The newest build Aqua installed is the one Play starts unless a row asks for another. */
export function selectedHorizonBuild(builds, selected = null) {
  if (!Array.isArray(builds) || builds.length === 0) return null
  return builds.find((build) => build.tag === selected) || builds[0]
}

const MOD_ID = /^[a-z0-9_]{1,64}$/

/** Which Horizon folder a downloaded file belongs in, from its extension. */
export function horizonModKind(filename) {
  const name = String(filename ?? '').toLowerCase()
  if (name.endsWith('.hnmod')) return 'native'
  if (name.endsWith('.hmod')) return 'content'
  if (name.endsWith('.zip')) return 'resourcepack'
  return null
}

/** A file name's mod id, used when its manifest cannot be read. */
export function horizonModId(filename) {
  return path.parse(String(filename ?? '')).name || 'mod'
}

/** `appleskin-0.1.1.hnmod` reads as `appleskin 0.1.1` until a manifest names it. */
export function horizonModTitle(filename) {
  return horizonModId(filename).replace(/[_-]+/g, ' ').trim() || 'Horizon mod'
}

/** `horizon-mods.txt`: `mod.<id>:true` lines plus the player's key binds. */
export function parseHorizonModState(text) {
  const enabled = new Set()
  const disabled = new Set()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!key.startsWith('mod.') || (value !== 'true' && value !== 'false')) continue
    if (value === 'true') enabled.add(key.slice('mod.'.length))
    else disabled.add(key.slice('mod.'.length))
  }
  return { enabled, disabled }
}

/** Rewrites one mod's switch and keeps Horizon's key binds intact. */
export function setHorizonModState(text, id, enabled) {
  const key = `mod.${id}`
  const line = `${key}:${enabled ? 'true' : 'false'}`
  const kept = []
  let written = false
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf(':')
    if (separator > 0 && trimmed.slice(0, separator).trim() === key) {
      if (!written) kept.push(line)
      written = true
      continue
    }
    kept.push(trimmed)
  }
  if (!written) kept.push(line)
  return kept.length ? `${kept.join('\n')}\n` : ''
}

/** Drops a removed mod's switch, leaving every other line alone. */
export function removeHorizonModState(text, id) {
  const key = `mod.${id}`
  const kept = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      const separator = line.indexOf(':')
      return separator <= 0 || line.slice(0, separator).trim() !== key
    })
  return kept.length ? `${kept.join('\n')}\n` : ''
}

function archiveText(entry) {
  if (!entry) return null
  const size = Number(entry.header?.size) || 0
  if (size <= 0 || size > 128 * 1024) return null
  return entry.getData().toString('utf8')
}

function tomlValue(text, key) {
  const match = String(text ?? '').match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))
  return match ? match[1].trim() || null : null
}

function cleanModId(value) {
  const text = String(value ?? '').trim()
  return MOD_ID.test(text) ? text : null
}

/**
 * Horizon reads its own manifests: `horizon-native.json` in a .hnmod,
 * `horizon-mod.toml` in a .hmod, and `pack.mcmeta` in a resource pack. A file
 * without one is not something Horizon would load, so it is refused.
 */
export async function readHorizonModManifest(filePath, kind) {
  try {
    const zip = new AdmZip(filePath)
    if (kind === 'native') {
      const text = archiveText(zip.getEntry('horizon-native.json'))
      if (!text) return null
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') return null
      return {
        id: cleanModId(parsed.id),
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null,
        version: typeof parsed.version === 'string' ? parsed.version : null,
        game: typeof parsed.game === 'string' ? parsed.game : null,
        horizon: /^[0-9a-f]{40}$/i.test(String(parsed.horizon ?? '')) ? String(parsed.horizon).toLowerCase() : null,
        mixins: /^[0-9a-f]{40}$/i.test(String(parsed.mixins ?? '')) ? String(parsed.mixins).toLowerCase() : null,
        hooks: Number.isFinite(Number(parsed.hooks)) ? Number(parsed.hooks) : null,
      }
    }
    if (kind === 'content') {
      const text = archiveText(zip.getEntry('horizon-mod.toml'))
      if (!text) return null
      return {
        id: cleanModId(tomlValue(text, 'id')),
        name: tomlValue(text, 'name'),
        version: tomlValue(text, 'version'),
        game: null,
      }
    }
    const text = archiveText(zip.getEntry('pack.mcmeta'))
    if (!text) return null
    const parsed = JSON.parse(text)
    const description = parsed?.pack?.description
    return {
      id: null,
      name: typeof description === 'string' && description.trim() ? description.trim().slice(0, 160) : null,
      version: null,
      game: null,
    }
  } catch {
    return null
  }
}

function requireHorizonModKind(value) {
  const kind = String(value ?? '')
  if (!HORIZON_MOD_KINDS.includes(kind)) throw new Error('Unknown Horizon mod type.')
  return kind
}

function requireHorizonModFileName(value) {
  if (typeof value !== 'string' || !value.trim() || path.basename(value) !== value) {
    throw new Error('That Horizon mod file is invalid.')
  }
  if (!horizonModKind(value)) throw new Error('Horizon mods must be .hnmod, .hmod, or .zip resource packs.')
  return value
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function spawnFailure(child) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      child.off('spawn', onSpawn)
      child.off('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onSpawn = () => finish(null)
    const onError = (error) => finish(error)
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

export class HorizonService {
  constructor({
    paths,
    installer = null,
    javaService = null,
    logger = null,
    store = null,
    emitActivity = null,
    emitNotification = null,
    emitProgress = null,
    openPath = null,
    spawnImpl = spawn,
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    fetchJsonImpl = fetchJson,
    fetchWithRetryImpl = fetchWithRetry,
  } = {}) {
    this.paths = paths
    this.installer = installer
    this.javaService = javaService
    this.logger = logger
    this.store = store
    this.emitActivity = emitActivity
    this.emitNotification = emitNotification
    this.emitProgress = emitProgress
    this.openPath = openPath
    this.spawnImpl = spawnImpl
    this.platform = platform
    this.arch = arch
    this.env = env
    this.fetchJsonImpl = fetchJsonImpl
    this.fetchWithRetryImpl = fetchWithRetryImpl
    this.assetName = horizonAssetName(platform, arch)
    this.supported = Boolean(this.assetName)
    this.cache = null
    this.pending = null
    this.installJob = null
    this.installAbort = null
    this.installChild = null
    this.installTemp = null
    this.releaseCache = null
    this.checksumCache = new Map()
  }

  roots() {
    if (!this.paths?.horizonRoot) throw new Error('Horizon storage is not configured.')
    return {
      root: this.paths.horizonRoot,
      versionsRoot: this.paths.horizonVersionsRoot,
      downloadsRoot: this.paths.horizonDownloadsRoot,
      gameHome: this.paths.horizonGameRoot,
      cacheRoot: this.paths.horizonCacheRoot,
      releasesCacheFile: this.paths.horizonReleasesCacheFile,
      worldsDirectory: path.join(this.paths.horizonGameRoot, 'saves'),
    }
  }

  /** Detected builds, cached briefly because the page asks again on every visit. */
  async status({ force = false } = {}) {
    const now = Date.now()
    if (!force && this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.status
    if (this.pending) return this.pending
    this.pending = this.detect().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async detect() {
    const roots = this.roots()
    const builds = await readInstalledHorizonBuilds({
      versionsRoot: roots.versionsRoot,
      platform: this.platform,
    })
    const selected = selectedHorizonBuild(builds)
    const selectedTag = selected?.tag || null
    const [dataRootExists, gameHomeExists, worlds] = await Promise.all([
      exists(roots.root),
      exists(roots.gameHome),
      countWorlds(roots.worldsDirectory),
    ])
    const activeJob =
      this.installJob &&
      (this.installJob.status === 'running' ||
        this.installJob.status === 'queued' ||
        this.installJob.status === 'cancelling')
        ? this.publicJob(this.installJob)
        : null
    const status = {
      supported: this.supported,
      supportedReason: this.supported
        ? null
        : `Horizon does not publish a game build for ${this.platform} ${this.arch}.`,
      installed: builds.length > 0,
      name: 'Horizon',
      edition: 'horizon',
      runtime: 'rust',
      gameVersion: selected?.gameVersion || HORIZON_GAME_VERSION,
      drop: horizonDropName(selected?.gameVersion || HORIZON_GAME_VERSION),
      dataRoot: roots.root,
      dataRootExists,
      buildsDirectory: roots.versionsRoot,
      downloadsDirectory: roots.downloadsRoot,
      gameHome: roots.gameHome,
      gameHomeExists,
      worldsDirectory: roots.worldsDirectory,
      worlds,
      builds: builds.map((build, index) => ({ ...build, selected: index === 0 })),
      selectedTag,
      install: activeJob,
      managed: true,
      siteUrl: HORIZON_SITE_URL,
    }
    this.cache = { at: Date.now(), status }
    return status
  }

  /** Starts the Rust game directly, with the resources Aqua's preparer wrote. */
  async launch(tag = null) {
    if (!this.supported) throw new Error(`Horizon is not available for ${this.platform} ${this.arch}.`)
    if (tag != null && typeof tag !== 'string') throw new Error('That Horizon build is invalid.')
    const status = await this.status({ force: true })
    if (!status.builds.length) {
      throw new Error('No Horizon build is installed yet. Install one from the Horizon panel first.')
    }

    const build = tag
      ? status.builds.find((item) => item.tag === tag)
      : selectedHorizonBuild(status.builds, status.selectedTag)
    if (!build) throw new Error('That Horizon build is not installed.')
    if (!build.prepared) {
      throw new Error(`Horizon build ${build.tag} has not finished preparing its resources. Install it again.`)
    }

    const roots = this.roots()
    await ensureDir(roots.gameHome)
    await ensureDir(roots.worldsDirectory)
    let child
    try {
      child = this.spawnImpl(build.clientPath, horizonLaunchArgs(build.resourcesDirectory), {
        cwd: roots.gameHome,
        env: { ...this.env, HORIZON_HOME: roots.gameHome },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      await spawnFailure(child)
    } catch (error) {
      throw new Error(`Horizon could not start: ${error.message}`)
    }
    child.unref()

    this.logger?.info('Launched Horizon', {
      version: build.tag,
      gameVersion: build.gameVersion,
      pid: child.pid ?? null,
      gameHome: roots.gameHome,
    })
    if (this.store?.addActivity) {
      try {
        await this.store.addActivity({
          type: 'game',
          title: 'Launched Horizon',
          detail: `Minecraft ${build.gameVersion}${horizonDropName(build.gameVersion) ? ` · ${horizonDropName(build.gameVersion)}` : ''} · ${build.tag}`,
          installationId: null,
          status: 'success',
        })
        this.emitActivity?.()
      } catch (error) {
        this.logger?.warn('Could not record the Horizon launch', { message: error.message })
      }
    }

    return {
      mode: 'launch',
      version: build.tag,
      gameVersion: build.gameVersion,
      pid: child.pid ?? null,
      gameHome: roots.gameHome,
    }
  }

  /** Opens one of Aqua's own Horizon folders, never a path supplied by the renderer. */
  async openFolder(kind, tag = null) {
    const folderKind = String(kind ?? '')
    if (!HORIZON_FOLDER_KINDS.includes(folderKind)) throw new Error('Unknown Horizon folder.')
    const status = await this.status({ force: true })
    const roots = this.roots()
    let target
    if (folderKind === 'game') target = roots.gameHome
    else if (folderKind === 'worlds') target = roots.worldsDirectory
    else if (folderKind === 'builds') target = roots.versionsRoot
    else if (folderKind === 'downloads') target = roots.downloadsRoot
    else {
      if (tag != null && typeof tag !== 'string') throw new Error('That Horizon build is invalid.')
      const build = status.builds.find((item) => item.tag === tag)
      if (!build) throw new Error('That Horizon build is not installed.')
      target = build.directory
    }
    if (!isPathInside(target, status.dataRoot)) {
      throw new Error('That folder is outside the Horizon data.')
    }
    if (folderKind === 'build') {
      const stat = await fsp.stat(target).catch(() => null)
      if (!stat?.isDirectory()) throw new Error('That Horizon build folder no longer exists.')
    } else {
      await ensureDir(target)
    }
    if (typeof this.openPath === 'function') {
      const error = await this.openPath(target)
      if (error) throw new Error(error)
    }
    return target
  }

  /** The folders and state file Horizon itself reads, beside options.txt. */
  modsDirectories() {
    const roots = this.roots()
    return {
      gameHome: roots.gameHome,
      content: path.join(roots.gameHome, HORIZON_CONTENT_MODS_DIR),
      native: path.join(roots.gameHome, HORIZON_NATIVE_MODS_DIR),
      resourcepack: path.join(roots.gameHome, HORIZON_RESOURCE_PACKS_DIR),
      stateFile: path.join(roots.gameHome, HORIZON_MODS_FILE),
    }
  }

  async readModState(directories = this.modsDirectories()) {
    const text = await fsp.readFile(directories.stateFile, 'utf8').catch(() => '')
    return { text, state: parseHorizonModState(text) }
  }

  /** Every mod Horizon would find in its game home, with its switch state. */
  async listMods() {
    const directories = this.modsDirectories()
    await ensureDir(directories.gameHome)
    const { state } = await this.readModState(directories)
    const mods = []
    for (const [kind, directory] of [
      ['content', directories.content],
      ['native', directories.native],
      ['resourcepack', directories.resourcepack],
    ]) {
      let entries = []
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        if (horizonModKind(entry.name) !== kind) continue
        const filePath = path.join(directory, entry.name)
        const stat = await fsp.stat(filePath).catch(() => null)
        if (!stat?.isFile()) continue
        const manifest = await readHorizonModManifest(filePath, kind)
        const id = manifest?.id || horizonModId(entry.name)
        mods.push({
          filename: entry.name,
          title: manifest?.name || horizonModTitle(entry.name),
          kind,
          id,
          version: manifest?.version || null,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          enabled:
            kind === 'resourcepack' ? true : kind === 'native' ? !state.disabled.has(id) : state.enabled.has(id),
          note: kind === 'native' ? HORIZON_NATIVE_NOTE : null,
        })
      }
    }
    mods.sort(
      (a, b) =>
        HORIZON_MOD_KINDS.indexOf(a.kind) - HORIZON_MOD_KINDS.indexOf(b.kind) ||
        a.title.localeCompare(b.title),
    )
    return {
      gameHome: directories.gameHome,
      directory: directories.content,
      stateFile: directories.stateFile,
      mods,
    }
  }

  /**
   * Installs a downloaded .hnmod, .hmod, or resource pack where Horizon looks
   * for it. The file is checked for the manifest Horizon reads before it lands
   * in the game folder.
   */
  async importMod(filePath, { sourceUrl = null, id: requestedId = null } = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Choose a Horizon mod file.')
    const source = path.resolve(filePath)
    const sourceStat = await fsp.stat(source).catch(() => null)
    if (!sourceStat?.isFile()) throw new Error('That Horizon mod file no longer exists.')
    const kind = horizonModKind(source)
    if (!kind) throw new Error('Horizon mods must be .hnmod, .hmod, or .zip resource packs.')
    const manifest = await readHorizonModManifest(source, kind)
    if (!manifest) {
      throw new Error(
        kind === 'native'
          ? 'That file does not hold Horizon’s horizon-native.json, so it is not a native mod.'
          : kind === 'content'
            ? 'That file does not hold a horizon-mod.toml, so it is not a Horizon content mod.'
            : 'That archive does not hold a pack.mcmeta, so it is not a resource pack.',
      )
    }
    const directories = this.modsDirectories()
    const directory = directories[kind]
    await ensureDir(directory)
    const requested = /^[a-z0-9_]{1,64}$/.test(String(requestedId ?? '')) ? String(requestedId) : null
    const id = manifest.id || requested || horizonModId(source)
    const extension = path.extname(source).toLowerCase()
    const filename = sanitizeFileName(
      kind === 'resourcepack' && !requested ? path.basename(source) : `${id}${extension}`,
      `mod${extension}`,
    )
    const destination = path.join(directory, filename)
    if (!isPathInside(destination, directory)) throw new Error('That Horizon mod would land outside its folder.')
    // Horizon keeps one file per mod id, so a newer download replaces the old one.
    const previous = path.join(directory, path.basename(source))
    if (previous !== destination && previous !== source) await fsp.rm(previous, { force: true }).catch(() => {})
    await fsp.copyFile(source, destination)
    const written = await fsp.stat(destination)
    this.logger?.info('Installed a Horizon mod', {
      filename,
      kind,
      id,
      version: manifest.version,
      sourceUrl,
    })
    return {
      filename,
      title: manifest.name || horizonModTitle(filename),
      kind,
      id,
      version: manifest.version || null,
      size: written.size,
      note: kind === 'native' ? HORIZON_NATIVE_NOTE : null,
    }
  }

  /** Flips Horizon's own `mod.<id>:true|false` line for a content or native mod. */
  async toggleMod(filename, kind) {
    const clean = requireHorizonModFileName(filename)
    const modKind = requireHorizonModKind(kind)
    if (modKind === 'resourcepack') throw new Error('Resource packs are always on; there is no switch for them.')
    const directories = this.modsDirectories()
    const filePath = path.join(directories[modKind], clean)
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('That Horizon mod is no longer installed.')
    const manifest = await readHorizonModManifest(filePath, modKind)
    const id = manifest?.id || horizonModId(clean)
    const { text, state } = await this.readModState(directories)
    // Native mods run until turned off; content mods start off until turned on.
    const enabled = modKind === 'native' ? state.disabled.has(id) : !state.enabled.has(id)
    await atomicWriteFile(directories.stateFile, setHorizonModState(text, id, enabled), 'utf8')
    return { filename: clean, enabled }
  }

  async removeMod(filename, kind) {
    const clean = requireHorizonModFileName(filename)
    const modKind = requireHorizonModKind(kind)
    const directories = this.modsDirectories()
    const filePath = path.join(directories[modKind], clean)
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('That Horizon mod is no longer installed.')
    const manifest = await readHorizonModManifest(filePath, modKind)
    const id = manifest?.id || horizonModId(clean)
    await fsp.rm(filePath, { force: true })
    const { text } = await this.readModState(directories)
    const next = removeHorizonModState(text, id)
    if (next !== text) await atomicWriteFile(directories.stateFile, next, 'utf8')
    return { filename: clean, kind: modKind }
  }

  async openModsFolder(kind = 'content') {
    const modKind = requireHorizonModKind(kind)
    const directory = this.modsDirectories()[modKind]
    await ensureDir(directory)
    if (typeof this.openPath === 'function') {
      const error = await this.openPath(directory)
      if (error) throw new Error(error)
    }
    return directory
  }

  /** The official Horizon releases that ship a build for this machine. */
  async listReleases({ force = false } = {}) {
    const roots = this.roots()
    if (!this.supported) {
      return {
        releases: [],
        platform: this.platform,
        arch: this.arch,
        fetchedAt: null,
        fromCache: false,
        stale: false,
        error: `Horizon does not publish a game build for ${this.platform} ${this.arch}.`,
      }
    }
    const now = Date.now()
    if (!force && this.releaseCache && now - this.releaseCache.at < RELEASE_CACHE_TTL_MS) {
      return this.releaseCache.data
    }
    try {
      const payload = await this.fetchJsonImpl(
        RELEASES_URL,
        { headers: GITHUB_HEADERS },
        { attempts: 2, timeoutMs: 25_000, logger: this.logger },
      )
      const data = {
        releases: parseHorizonReleases(payload, { platform: this.platform, arch: this.arch }),
        platform: this.platform,
        arch: this.arch,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        stale: false,
        error: null,
      }
      this.releaseCache = { at: now, data }
      await atomicWriteJson(roots.releasesCacheFile, data).catch((error) => {
        this.logger?.debug('Could not cache Horizon releases', { message: error.message })
      })
      return data
    } catch (error) {
      const cached = await readJsonFile(roots.releasesCacheFile, null)
      if (Array.isArray(cached?.releases) && cached.releases.length) {
        const data = {
          ...cached,
          platform: this.platform,
          arch: this.arch,
          fromCache: true,
          stale: true,
          error: error.message,
        }
        this.releaseCache = { at: now, data }
        return data
      }
      throw new Error(`Could not load Horizon releases: ${error.message}`)
    }
  }

  async releaseForTag(tag) {
    const cleanTag = String(tag ?? '').trim()
    if (!RELEASE_TAG.test(cleanTag)) throw new Error('That Horizon release is invalid.')
    let catalog = await this.listReleases()
    let release = catalog.releases.find((entry) => entry.tag === cleanTag)
    if (!release) {
      catalog = await this.listReleases({ force: true })
      release = catalog.releases.find((entry) => entry.tag === cleanTag)
    }
    if (!release) {
      throw new Error(`Horizon ${cleanTag} is not available for ${this.platform} ${this.arch}.`)
    }
    return release
  }

  async install(tag) {
    if (!this.supported) throw new Error(`Horizon is not available for ${this.platform} ${this.arch}.`)
    if (!this.installer || !this.javaService) throw new Error('Horizon installation is not available.')
    if (
      this.installJob &&
      (this.installJob.status === 'running' ||
        this.installJob.status === 'queued' ||
        this.installJob.status === 'cancelling')
    ) {
      throw new Error('A Horizon installation is already running. Cancel it before starting another.')
    }
    const release = await this.releaseForTag(tag)
    const job = {
      id: randomId(),
      type: 'horizon',
      tag: release.tag,
      assetName: release.assetName,
      gameVersion: null,
      status: 'queued',
      stage: 'Preparing installation',
      message: null,
      progress: 0,
      indeterminate: true,
      bytesDone: 0,
      bytesTotal: release.assetSize || 0,
      filesDone: 0,
      filesTotal: 0,
      speedBps: 0,
      etaSeconds: null,
      currentFile: null,
      error: null,
      warning: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    }
    this.installJob = job
    this.installAbort = new AbortController()
    this.cache = null
    const signal = this.installAbort.signal
    this.emitProgress?.(this.publicJob(job))
    void this.runInstall(job, release, signal)
    return this.publicJob(job)
  }

  async cancelInstall() {
    if (
      !this.installJob ||
      (this.installJob.status !== 'running' &&
        this.installJob.status !== 'queued' &&
        this.installJob.status !== 'cancelling')
    ) {
      throw new Error('No Horizon installation is running.')
    }
    this.installJob.cancelRequested = true
    this.updateJob(this.installJob, {
      status: 'cancelling',
      stage: 'Cancelling installation',
      indeterminate: true,
    })
    this.installAbort?.abort()
    this.killInstallChild()
    return this.publicJob(this.installJob)
  }

  publicJob(job) {
    return {
      ...job,
      cancelRequested: undefined,
    }
  }

  updateJob(job, patch = {}) {
    Object.assign(job, patch)
    if (job.progress === 100) job.indeterminate = false
    this.cache = null
    this.emitProgress?.(this.publicJob(job))
  }

  killInstallChild() {
    const child = this.installChild
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // The process may already have exited.
    }
  }

  dispose() {
    this.installAbort?.abort()
    this.killInstallChild()
  }

  async archiveChecksum(release) {
    const cached = this.checksumCache.get(release.assetUrl)
    if (cached) return cached
    let published = null
    if (release.checksumsUrl) {
      try {
        const response = await this.fetchWithRetryImpl(
          release.checksumsUrl,
          { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 2, timeoutMs: 20_000, logger: this.logger },
        )
        const text = await response.text()
        published = parseChecksums(text).get(release.assetName) || null
      } catch (error) {
        this.logger?.warn('Could not read Horizon checksums', { message: error.message })
      }
    }
    if (published && release.assetDigest && published !== release.assetDigest) {
      throw new Error('Horizon published conflicting checksums for this release.')
    }
    const expected = release.assetDigest || published
    if (!expected) {
      throw new Error('This Horizon release does not publish a SHA-256 checksum. Installation was stopped.')
    }
    this.checksumCache.set(release.assetUrl, expected)
    return expected
  }

  async downloadArchive(release, expectedSha256, { job, signal }) {
    const roots = this.roots()
    const directory = path.join(roots.downloadsRoot, release.tag)
    await ensureDir(directory)
    const destination = path.join(directory, release.assetName)
    if (await fileExists(destination)) {
      const existing = await sha256File(destination)
      if (existing === expectedSha256) {
        this.updateJob(job, {
          stage: 'Using the downloaded Horizon release',
          progress: 8,
          indeterminate: false,
          bytesDone: release.assetSize || 0,
          bytesTotal: release.assetSize || 0,
          currentFile: release.assetName,
        })
        return destination
      }
      await fsp.rm(destination, { force: true }).catch(() => {})
    }

    this.updateJob(job, {
      stage: `Downloading Horizon ${release.tag}`,
      progress: 1,
      indeterminate: false,
      bytesDone: 0,
      bytesTotal: release.assetSize || 0,
      currentFile: release.assetName,
    })
    await downloadFiles(
      [
        {
          url: release.assetUrl,
          destination,
          sha1: null,
          size: release.assetSize || null,
        },
      ],
      {
        concurrency: 1,
        bandwidthKbps: this.store?.settings?.downloads?.bandwidthKbps || 0,
        signal,
        logger: this.logger,
        attempts: 3,
        root: directory,
        onProgress: (progress) => {
          this.updateJob(job, {
            stage: 'Downloading Horizon release',
            progress:
              progress.bytesTotal > 0
                ? Math.max(1, Math.min(8, Math.round((progress.bytesDone / progress.bytesTotal) * 8)))
                : null,
            indeterminate: !(progress.bytesTotal > 0),
            bytesDone: progress.bytesDone,
            bytesTotal: progress.bytesTotal || release.assetSize || 0,
            speedBps: progress.speedBps,
            etaSeconds: progress.etaSeconds,
            currentFile: progress.currentFile ? path.basename(progress.currentFile) : release.assetName,
          })
        },
      },
    )
    const actual = await sha256File(destination)
    if (actual !== expectedSha256) {
      await fsp.rm(destination, { force: true }).catch(() => {})
      throw new Error(
        `Horizon ${release.tag} failed its SHA-256 check (expected ${expectedSha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`,
      )
    }
    return destination
  }

  async ensureMinecraft(gameVersion, { job, signal }) {
    const roots = this.roots()
    const state = await getInstallationState(this.paths, gameVersion)
    if (state.installed) {
      this.updateJob(job, {
        stage: `Minecraft ${gameVersion} is already installed`,
        progress: 62,
        indeterminate: false,
        message: 'Reusing Aqua’s Minecraft files',
      })
      const { merged } = await this.installer.resolveVersion(gameVersion)
      return merged
    }

    this.updateJob(job, {
      stage: `Downloading Minecraft ${gameVersion}`,
      progress: 10,
      indeterminate: false,
      bytesDone: 0,
      bytesTotal: 0,
    })
    const installation = {
      id: `horizon-${gameVersion}`,
      name: `Horizon Minecraft ${gameVersion}`,
      versionId: gameVersion,
      gameDir: roots.gameHome,
      loader: { type: 'vanilla', version: null },
      javaPath: null,
    }
    const settings = this.store?.settings || {
      downloads: { concurrency: 4, bandwidthKbps: 0 },
    }
    const result = await this.installer.install(installation, {
      settings,
      signal,
      onUpdate: (update) => {
        const percent = Number(update.progress)
        this.updateJob(job, {
          stage: `Minecraft ${gameVersion}: ${update.stage || 'Installing'}`,
          progress: Number.isFinite(percent) ? Math.min(62, 10 + Math.round(percent * 0.52)) : null,
          indeterminate: !Number.isFinite(percent),
          bytesDone: Number(update.bytesDone) || 0,
          bytesTotal: Number(update.bytesTotal) || 0,
          filesDone: Number(update.filesDone) || 0,
          filesTotal: Number(update.filesTotal) || 0,
          speedBps: Number(update.speedBps) || 0,
          etaSeconds: update.etaSeconds ?? null,
          currentFile: update.currentFile || null,
        })
      },
    })
    return result.versionJson
  }

  async ensureServerJar(versionJson, { job, signal, expectedSha1 = null }) {
    const server = versionJson?.downloads?.server
    if (!server?.url || !server?.sha1) {
      throw new Error(`Minecraft ${versionJson?.id || '26.3'} does not publish a server jar.`)
    }
    if (expectedSha1 && server.sha1.toLowerCase() !== String(expectedSha1).toLowerCase()) {
      throw new Error('Minecraft’s server jar does not match the version Horizon pinned.')
    }
    const roots = this.roots()
    await ensureDir(roots.downloadsRoot)
    const destination = path.join(roots.downloadsRoot, `server-${versionJson.id}.jar`)
    this.updateJob(job, {
      stage: 'Downloading the Minecraft server jar',
      progress: 63,
      indeterminate: false,
      currentFile: path.basename(destination),
    })
    await downloadFiles(
      [
        {
          url: server.url,
          destination,
          sha1: server.sha1,
          size: server.size ?? null,
        },
      ],
      {
        concurrency: 1,
        bandwidthKbps: this.store?.settings?.downloads?.bandwidthKbps || 0,
        signal,
        logger: this.logger,
        attempts: 3,
        root: roots.downloadsRoot,
        onProgress: (progress) => {
          this.updateJob(job, {
            stage: 'Downloading the Minecraft server jar',
            progress:
              progress.bytesTotal > 0
                ? 63 + Math.min(3, Math.round((progress.bytesDone / progress.bytesTotal) * 3))
                : 63,
            indeterminate: false,
            bytesDone: progress.bytesDone,
            bytesTotal: progress.bytesTotal || server.size || 0,
            speedBps: progress.speedBps,
            etaSeconds: progress.etaSeconds,
            currentFile: path.basename(destination),
          })
        },
      },
    )
    return destination
  }

  async ensureJava(versionJson, { job, signal }) {
    const required = Number(versionJson?.javaVersion?.majorVersion) || 25
    this.updateJob(job, {
      stage: `Looking for Java ${required}`,
      progress: 66,
      indeterminate: true,
    })
    const runtimes = await this.javaService.detect()
    const exact = runtimes.filter((runtime) => runtime.major === required)
    const compatible = runtimes
      .filter((runtime) => runtime.major > required)
      .sort((a, b) => a.major - b.major)
    if (exact[0] || compatible[0]) {
      const runtime = exact[0] || compatible[0]
      this.updateJob(job, {
        stage: `Using Java ${runtime.major}`,
        progress: 70,
        indeterminate: false,
        message: runtime.path,
      })
      return runtime
    }

    const options = await this.javaService.listRuntimeOptions()
    const option =
      options.find((entry) => entry.major === required) ||
      options
        .filter((entry) => entry.major > required)
        .sort((a, b) => a.major - b.major)[0]
    if (!option) {
      throw new Error(
        `Horizon needs Java ${required}, but no Mojang runtime for it was found. Install Java ${required} in Settings → Java and try again.`,
      )
    }
    this.updateJob(job, {
      stage: `Installing Java ${option.major}`,
      progress: 67,
      indeterminate: false,
      message: option.versionName,
    })
    const runtime = await this.javaService.installRuntime(option.component, {
      settings: this.store?.settings || { downloads: { concurrency: 4, bandwidthKbps: 0 } },
      signal,
      logger: this.logger,
      onProgress: (progress) => {
        this.updateJob(job, {
          stage: `Installing Java ${option.major}`,
          progress:
            progress.bytesTotal > 0
              ? 67 + Math.min(5, Math.round((progress.bytesDone / progress.bytesTotal) * 5))
              : 67,
          indeterminate: !(progress.bytesTotal > 0),
          bytesDone: progress.bytesDone || 0,
          bytesTotal: progress.bytesTotal || 0,
          speedBps: progress.speedBps || 0,
          etaSeconds: progress.etaSeconds ?? null,
          currentFile: progress.currentFile ? path.basename(progress.currentFile) : null,
        })
      },
    })
    return runtime
  }

  /**
   * Horizon verifies the official version JSON by SHA-1. Aqua's installer rewrites
   * its copy after merging metadata, so the preparer gets Mojang's original bytes
   * as `manifest.json` beside the release. The preparer accepts that file even
   * when the launcher copy no longer matches.
   */
  async ensureMojangManifest(buildDirectory, gameVersion, lock, { job, signal }) {
    const versionService = this.installer?.versionService
    if (!versionService?.getManifest) {
      throw new Error('Aqua’s Minecraft version service is not available for Horizon preparation.')
    }
    const manifest = await versionService.getManifest()
    const entry = (manifest?.versions || []).find((version) => version.id === gameVersion)
    const accepted = new Set(
      [lock?.minecraft?.manifest_sha1, ...(lock?.minecraft?.accepted_manifest_sha1 || [])]
        .filter((value) => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value))
        .map((value) => value.toLowerCase()),
    )
    const urls = []
    if (lock?.minecraft?.manifest_sha1) {
      urls.push(
        `https://piston-meta.mojang.com/v1/packages/${lock.minecraft.manifest_sha1}/${encodeURIComponent(gameVersion)}.json`,
      )
    }
    if (entry?.url) urls.push(entry.url)
    let lastError = null
    for (const url of urls.filter(Boolean)) {
      if (signal?.aborted) throw abortError()
      try {
        const response = await this.fetchWithRetryImpl(
          url,
          { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 3, timeoutMs: 30_000, logger: this.logger },
        )
        const text = await response.text()
        const checksum = crypto.createHash('sha1').update(text).digest('hex')
        if (accepted.size && !accepted.has(checksum)) {
          throw new Error(`Mojang’s version file is not the one Horizon pinned (sha1 ${checksum.slice(0, 12)}…).`)
        }
        const parsed = JSON.parse(text)
        if (parsed?.id !== gameVersion) throw new Error('Mojang returned a different Minecraft version.')
        const pinnedClient = lock?.minecraft?.client_sha1
        if (pinnedClient && parsed.downloads?.client?.sha1 !== pinnedClient) {
          throw new Error('Mojang’s client jar does not match the version Horizon pinned.')
        }
        const pinnedServer = lock?.minecraft?.server_sha1
        if (pinnedServer && parsed.downloads?.server?.sha1 !== pinnedServer) {
          throw new Error('Mojang’s server jar does not match the version Horizon pinned.')
        }
        const requiredJava = Number(lock?.minecraft?.java_major) || 25
        if (Number(parsed.javaVersion?.majorVersion) !== requiredJava) {
          throw new Error('Mojang’s version file does not ask for the Java runtime Horizon expects.')
        }
        const manifestDirectory = path.join(buildDirectory, '.local', 'minecraft', gameVersion)
        await ensureDir(manifestDirectory)
        await atomicWriteFile(path.join(manifestDirectory, 'manifest.json'), text, 'utf8')
        this.updateJob(job, {
          stage: 'Saving Mojang’s original version file',
          progress: 62,
          indeterminate: false,
          message: `sha1 ${checksum.slice(0, 12)}…`,
        })
        return
      } catch (error) {
        lastError = error
        this.logger?.warn('Could not use a Mojang version file for Horizon', {
          url,
          message: error.message,
        })
      }
    }
    throw new Error(
      `Could not obtain Mojang’s original ${gameVersion} version file for Horizon: ${
        lastError?.message || 'no version URL was published'
      }`,
    )
  }

  async runPreparer(buildDirectory, javaRuntime, { job, signal, serverJar }) {
    const programCandidates =
      this.platform === 'win32'
        ? [path.join(buildDirectory, 'horizon-prepare.exe')]
        : [path.join(buildDirectory, 'horizon-prepare')]
    const program = await firstExisting(programCandidates)
    if (!program) throw new Error('The Horizon release is missing its resource preparer.')

    const javaHome = javaRuntime.home || (javaRuntime.path ? path.dirname(path.dirname(javaRuntime.path)) : '')
    if (!javaHome) throw new Error('Aqua could not locate the Java runtime Horizon’s preparer needs.')
    const pathKey = Object.keys(this.env).find((key) => key.toLowerCase() === 'path') || 'PATH'
    const separator = this.platform === 'win32' ? ';' : ':'
    const env = {
      ...this.env,
      JAVA_HOME: javaHome,
      [pathKey]: `${path.join(javaHome, 'bin')}${separator}${this.env[pathKey] || ''}`,
    }
    const args = horizonPrepareArgs({
      buildDirectory,
      minecraftDirectory: this.paths.minecraftRoot,
      serverJar,
    })
    this.updateJob(job, {
      stage: 'Preparing Horizon resources',
      progress: 72,
      indeterminate: true,
      message: 'Running Horizon’s bundled preparer',
      currentFile: null,
    })
    await this.runInstallTool(program, args, {
      cwd: buildDirectory,
      env,
      signal,
      timeoutMs: PREPARE_TIMEOUT_MS,
      onLine: (line) => this.notePreparerLine(job, line),
    })

    this.updateJob(job, {
      stage: 'Copying sound assets',
      progress: 96,
      indeterminate: true,
      message: 'Sounds are optional, but they make the game audible',
    })
    try {
      await this.runInstallTool(
        program,
        horizonSoundsArgs({ buildDirectory, minecraftDirectory: this.paths.minecraftRoot }),
        {
          cwd: buildDirectory,
          env,
          signal,
          timeoutMs: PREPARE_TIMEOUT_MS,
          onLine: (line) => this.notePreparerLine(job, line),
        },
      )
      return null
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error
      this.logger?.warn('Horizon sounds could not be copied; the game will be silent', {
        message: error.message,
      })
      return `Sounds were not copied: ${error.message}`
    }
  }

  notePreparerLine(job, rawLine) {
    const line = stripAnsi(rawLine).trim()
    if (!line) return
    const lower = line.toLowerCase()
    let progress = job.progress
    if (lower.includes('importing')) progress = Math.max(74, Number(job.progress) || 0)
    else if (lower.includes('copying')) progress = Math.max(78, Number(job.progress) || 0)
    else if (lower.includes('exporting') || lower.includes('running')) progress = Math.max(82, Number(job.progress) || 0)
    else if (lower.includes('writing') || lower.includes('prepared')) progress = Math.max(92, Number(job.progress) || 0)
    this.updateJob(job, {
      stage: 'Preparing Horizon resources',
      progress,
      indeterminate: false,
      message: line.slice(0, 300),
    })
  }

  runInstallTool(program, args, { cwd, env, signal, timeoutMs, onLine }) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = this.spawnImpl(program, args, {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(error)
        return
      }
      this.installChild = child
      let settled = false
      let timer = null
      const stderrTail = []
      const stdoutTail = []
      const finish = (error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.installChild = null
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => {
        this.killInstallChild()
        finish(abortError())
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        this.killInstallChild()
        finish(new Error('Horizon’s preparer did not finish in time.'))
      }, timeoutMs)
      const wire = (stream, tail, label) => {
        if (!stream) return
        const reader = readline.createInterface({ input: stream })
        reader.on('line', (line) => {
          const text = stripAnsi(line).trim()
          if (!text) return
          tail.push(text)
          if (tail.length > 40) tail.shift()
          onLine?.(text, label)
        })
      }
      wire(child.stdout, stdoutTail, 'stdout')
      wire(child.stderr, stderrTail, 'stderr')
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (signal?.aborted) return finish(abortError())
        if (code === 0) return finish(null)
        const detail = stderrTail.slice(-4).join(' ') || stdoutTail.slice(-4).join(' ') || `exit code ${code}`
        return finish(new Error(`Horizon’s preparer failed: ${detail}`))
      })
    })
  }

  async runInstall(job, release, signal) {
    const roots = this.roots()
    const temp = path.join(roots.root, `.install-${release.tag}-${Date.now()}`)
    this.installTemp = temp
    let buildDirectory = null
    let moved = false
    let warning = null
    try {
      this.updateJob(job, {
        status: 'running',
        startedAt: new Date().toISOString(),
        stage: 'Verifying the Horizon release',
        progress: 0,
        indeterminate: true,
      })
      const checksum = await this.archiveChecksum(release)
      if (signal.aborted) throw abortError()
      const archive = await this.downloadArchive(release, checksum, { job, signal })
      if (signal.aborted) throw abortError()

      this.updateJob(job, {
        stage: 'Extracting Horizon',
        progress: 9,
        indeterminate: false,
        currentFile: release.assetName,
      })
      await ensureDir(temp)
      await extractHorizonArchive(archive, temp, signal)
      const releaseRoot = await findHorizonReleaseRoot(temp)
      if (!releaseRoot) throw new Error('The Horizon archive did not contain a research-lock.json.')
      await makeHorizonExecutables(releaseRoot, this.platform)
      if (signal.aborted) throw abortError()

      const lock = await readJsonCapped(path.join(releaseRoot, 'research-lock.json'))
      const gameVersion = horizonGameVersion(lock)
      job.gameVersion = gameVersion
      this.updateJob(job, {
        stage: `Preparing Minecraft ${gameVersion}`,
        progress: 10,
        indeterminate: false,
      })

      const versionJson = await this.ensureMinecraft(gameVersion, { job, signal })
      if (signal.aborted) throw abortError()
      const expectedClientSha1 = lock?.minecraft?.client_sha1
      if (
        expectedClientSha1 &&
        versionJson?.downloads?.client?.sha1 &&
        String(expectedClientSha1).toLowerCase() !== String(versionJson.downloads.client.sha1).toLowerCase()
      ) {
        throw new Error('Minecraft’s client jar does not match the version Horizon pinned.')
      }
      await this.ensureMojangManifest(releaseRoot, gameVersion, lock, { job, signal })

      const serverJar = await this.ensureServerJar(versionJson, {
        job,
        signal,
        expectedSha1: lock?.minecraft?.server_sha1 || null,
      })
      if (signal.aborted) throw abortError()
      const javaRuntime = await this.ensureJava(versionJson, { job, signal })
      if (signal.aborted) throw abortError()

      warning = await this.runPreparer(releaseRoot, javaRuntime, { job, signal, serverJar })
      if (signal.aborted) throw abortError()
      const preparedManifest = path.join(
        horizonResourcesDirectory(releaseRoot, gameVersion),
        RESOURCES_MANIFEST,
      )
      if (!(await fileExists(preparedManifest))) {
        throw new Error('Horizon’s preparer finished without writing horizon-resources.json.')
      }

      this.updateJob(job, {
        stage: 'Registering Horizon build',
        progress: 98,
        indeterminate: false,
        message: null,
      })
      const installedAt = new Date().toISOString()
      await atomicWriteJson(path.join(releaseRoot, COMPLETE_MARKER), {
        kind: 'aqua-horizon',
        schema: 1,
        tag: release.tag,
        gameVersion,
        assetName: release.assetName,
        archiveSha256: checksum,
        installedAt,
        javaMajor: javaRuntime.major || null,
        javaVersion: javaRuntime.version || null,
        warning,
      })
      buildDirectory = path.join(roots.versionsRoot, release.tag)
      await moveIntoPlace(releaseRoot, buildDirectory)
      moved = true
      await ensureDir(roots.gameHome)
      await ensureDir(roots.worldsDirectory)

      this.cache = null
      this.updateJob(job, {
        status: 'completed',
        stage: 'Installed',
        progress: 100,
        indeterminate: false,
        finishedAt: new Date().toISOString(),
        message: warning || `Minecraft ${gameVersion}`,
        warning,
        bytesDone: job.bytesTotal,
        currentFile: null,
      })
      this.logger?.info('Horizon installation complete', {
        tag: release.tag,
        gameVersion,
        directory: buildDirectory,
      })
      if (this.store?.addActivity) {
        try {
          await this.store.addActivity({
            type: 'install',
            title: `Installed Horizon ${release.tag}`,
            detail: `Minecraft ${gameVersion}${horizonDropName(gameVersion) ? ` · ${horizonDropName(gameVersion)}` : ''}`,
            installationId: null,
            status: 'success',
          })
          this.emitActivity?.()
        } catch (error) {
          this.logger?.warn('Could not record the Horizon installation', { message: error.message })
        }
      }
      this.emitNotification?.({
        level: 'success',
        title: `Horizon ${release.tag} installed`,
        message: `Minecraft ${gameVersion} is ready to play.`,
      })
    } catch (error) {
      const cancelled = signal.aborted || job.cancelRequested || error?.name === 'AbortError'
      if (buildDirectory && !moved) await fsp.rm(buildDirectory, { recursive: true, force: true }).catch(() => {})
      if (cancelled) {
        this.updateJob(job, {
          status: 'cancelled',
          stage: 'Installation cancelled',
          indeterminate: false,
          finishedAt: new Date().toISOString(),
          error: null,
          message: 'The partial download was removed.',
        })
      } else {
        this.logger?.error('Horizon installation failed', {
          tag: release.tag,
          message: error.message,
        })
        this.updateJob(job, {
          status: 'failed',
          stage: 'Installation failed',
          indeterminate: false,
          finishedAt: new Date().toISOString(),
          error: error.message,
          message: null,
        })
        this.emitNotification?.({
          level: 'error',
          title: 'Horizon installation failed',
          message: error.message,
        })
        if (this.store?.addActivity) {
          try {
            await this.store.addActivity({
              type: 'install',
              title: `Horizon ${release.tag} installation failed`,
              detail: error.message,
              installationId: null,
              status: 'error',
            })
            this.emitActivity?.()
          } catch (activityError) {
            this.logger?.warn('Could not record the failed Horizon installation', {
              message: activityError.message,
            })
          }
        }
      }
    } finally {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {})
      this.installTemp = null
      if (this.installJob === job) {
        this.installChild = null
        this.installAbort = null
      }
      this.cache = null
      if (job.status === 'completed') {
        this.logger?.info('Horizon install finished', {
          tag: release.tag,
          size: formatBytes(job.bytesTotal || 0),
        })
      }
    }
  }
}
