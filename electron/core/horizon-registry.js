import fsp from 'node:fs/promises'
import path from 'node:path'
import { downloadFiles } from './downloader.js'
import {
  HORIZON_GAME_VERSION,
  horizonModKind,
  readHorizonModManifest,
  sha256File,
} from './horizon.js'
import { atomicWriteJson, ensureDir, fetchJson, fileExists, readJsonFile } from './util.js'

/**
 * Horizon's own launcher browses the registry's index.json directly, and so
 * does Aqua: the projects and their release files are read from the index,
 * filtered to the game version this build runs, downloaded with a size and
 * SHA-256 check, and installed into the folders the Rust client reads.
 */
export const HORIZON_REGISTRY_URL = 'https://horizon-rust.github.io/horizon-mods/index.json'
const REGISTRY_TTL_MS = 10 * 60 * 1000
const CACHE_FILE = 'mod-registry.json'
const MOD_ID = /^[a-z0-9_]{1,64}$/

/** Registry kinds Aqua can install; Horizon's launcher does not run the rest yet. */
const REGISTRY_KINDS = {
  'native-mod': 'native',
  mod: 'content',
  resourcepack: 'resourcepack',
}

const KIND_EXTENSIONS = {
  native: '.hnmod',
  content: '.hmod',
  resourcepack: '.zip',
}

function text(value, limit = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function webUrl(value) {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeVersion(entry, kind) {
  const file = entry?.file
  if (!file || typeof file.url !== 'string') return null
  const url = webUrl(file.url)
  if (!url) return null
  const fileName = path.basename(text(file.name, 200))
  if (!fileName || fileName !== text(file.name, 200)) return null
  if (path.extname(fileName).toLowerCase() !== KIND_EXTENSIONS[kind]) return null
  const sha256 = text(file.sha256, 64).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null
  const size = Number(file.size)
  return {
    version: text(entry.version, 64) || null,
    game: text(entry.game, 32) || null,
    published: text(entry.published, 40) || null,
    changelog: text(entry.changelog, 20_000) || null,
    api: text(entry.api, 80) || null,
    fileName,
    url,
    size: Number.isFinite(size) && size > 0 ? size : 0,
    sha256,
    signature: typeof file.signature === 'string' ? file.signature : null,
  }
}

/**
 * Turns the registry index into the projects Aqua can install: known kinds,
 * with at least one published version for the Minecraft version Horizon runs.
 */
export function parseHorizonRegistry(payload, { gameVersion = HORIZON_GAME_VERSION } = {}) {
  const projects = []
  for (const raw of Array.isArray(payload?.projects) ? payload.projects : []) {
    const kind = REGISTRY_KINDS[raw?.kind]
    if (!kind) continue
    const id = text(raw.id, 64)
    if (!MOD_ID.test(id)) continue
    const versions = (Array.isArray(raw.versions) ? raw.versions : [])
      .map((entry) => normalizeVersion(entry, kind))
      .filter(Boolean)
      .filter((version) => !gameVersion || version.game === gameVersion)
      .sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')))
    if (!versions.length) continue

    const authors = (Array.isArray(raw.authors) ? raw.authors : [])
      .map((author) => text(author, 80))
      .filter(Boolean)
      .slice(0, 12)
    const owners = (Array.isArray(raw.owners) ? raw.owners : []).map((owner) => text(owner, 80))
    const downloads = Number(raw.downloads)
    const summary = text(raw.summary, 400)
    const name = text(raw.name, 120) || id
    projects.push({
      id,
      name,
      summary,
      description: text(raw.description, 20_000),
      authors,
      license: text(raw.license, 60) || null,
      source: webUrl(raw.source),
      icon: webUrl(raw.icon),
      downloads: Number.isFinite(downloads) && downloads > 0 ? downloads : 0,
      kind,
      official: authors.includes('Horizon') || owners.includes('horizon-rust'),
      versions,
    })
  }
  projects.sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name))
  return {
    schema: Number(payload?.schema) || null,
    generated: text(payload?.generated, 40) || null,
    projects,
    revoked: Array.isArray(payload?.revoked) ? payload.revoked : [],
  }
}

/** A registry entry can take a file down; Horizon's launcher refuses it too. */
export function horizonRevoked(catalog, id, sha256) {
  const hash = String(sha256 ?? '').toLowerCase()
  for (const entry of Array.isArray(catalog?.revoked) ? catalog.revoked : []) {
    if (!entry || (entry.id !== id && entry.project !== id)) continue
    if (entry.sha256 && String(entry.sha256).toLowerCase() !== hash) continue
    return entry
  }
  return null
}

export class HorizonRegistryService {
  constructor({
    paths,
    horizonService,
    logger = null,
    store = null,
    emitActivity = null,
    fetchJsonImpl = fetchJson,
    downloadFilesImpl = downloadFiles,
    now = () => Date.now(),
  } = {}) {
    this.paths = paths
    this.horizonService = horizonService
    this.logger = logger
    this.store = store
    this.emitActivity = emitActivity
    this.fetchJsonImpl = fetchJsonImpl
    this.downloadFilesImpl = downloadFilesImpl
    this.now = now
    this.memory = null
    this.pending = null
  }

  cacheFile() {
    if (!this.paths?.horizonCacheRoot) throw new Error('Horizon storage is not configured.')
    return path.join(this.paths.horizonCacheRoot, CACHE_FILE)
  }

  /** The registry, from the last ten minutes, the network, or the last copy on disk. */
  async list({ force = false } = {}) {
    const now = this.now()
    if (!force && this.memory && now - this.memory.at < REGISTRY_TTL_MS) return this.memory.data
    if (this.pending) return this.pending
    this.pending = this.refresh().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async refresh() {
    const file = this.cacheFile()
    try {
      const payload = await this.fetchJsonImpl(
        HORIZON_REGISTRY_URL,
        { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
        { attempts: 2, timeoutMs: 30_000, logger: this.logger },
      )
      const data = {
        ...parseHorizonRegistry(payload),
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        stale: false,
        error: null,
      }
      this.memory = { at: this.now(), data }
      await atomicWriteJson(file, data).catch((error) => {
        this.logger?.debug('Could not cache the Horizon registry', { message: error.message })
      })
      return data
    } catch (error) {
      const cached = await readJsonFile(file, null)
      if (cached && Array.isArray(cached.projects) && cached.projects.length) {
        const data = { ...cached, fromCache: true, stale: true, error: error.message }
        this.memory = { at: this.now(), data }
        return data
      }
      throw new Error(`Could not load Horizon’s mod registry: ${error.message}`)
    }
  }

  /** Installs the newest published version, or the one the caller names. */
  async install(projectId, versionNumber = null, { onProgress } = {}) {
    const id = String(projectId ?? '')
    if (!MOD_ID.test(id)) throw new Error('That Horizon project is invalid.')
    const catalog = await this.list()
    const project = catalog.projects.find((entry) => entry.id === id)
    if (!project) throw new Error('That project is not in Horizon’s registry.')
    const version = versionNumber
      ? project.versions.find((entry) => entry.version === versionNumber)
      : project.versions[0]
    if (!version) {
      throw new Error(
        `${project.name} ${versionNumber} is not published for Minecraft ${HORIZON_GAME_VERSION}.`,
      )
    }
    const revoked = horizonRevoked(catalog, project.id, version.sha256)
    if (revoked) {
      throw new Error(
        `${project.name} ${version.version ?? ''} was taken down by Horizon’s registry${
          typeof revoked.reason === 'string' && revoked.reason ? `: ${revoked.reason}` : '.'
        }`.trim(),
      )
    }

    const directory = path.join(this.paths.horizonCacheRoot, 'mod-browser')
    await ensureDir(directory)
    const extension = path.extname(version.fileName).toLowerCase()
    const target = path.join(directory, `${version.sha256}${extension}`)
    if (await fileExists(target)) {
      const existing = await sha256File(target).catch(() => null)
      if (existing !== version.sha256) await fsp.rm(target, { force: true }).catch(() => {})
    }

    try {
      if (!(await fileExists(target))) {
        await this.downloadFilesImpl(
          [{ url: version.url, destination: target, sha1: null, size: version.size || null }],
          {
            concurrency: 1,
            attempts: 3,
            root: directory,
            logger: this.logger,
            onProgress,
          },
        )
      }
      const actual = await sha256File(target)
      if (actual !== version.sha256) {
        throw new Error(`${project.name} failed its SHA-256 check (expected ${version.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`)
      }
      const kind = horizonModKind(version.fileName)
      const manifest = await readHorizonModManifest(target, kind)
      if (!manifest) {
        throw new Error(`${project.name} does not contain the manifest Horizon reads for a ${kind} file.`)
      }
      if (manifest.id && manifest.id !== project.id) {
        throw new Error(`${project.name} declares itself as ${manifest.id}, not ${project.id}. Installation was stopped.`)
      }
      const imported = await this.horizonService.importMod(target, { id: project.id, sourceUrl: version.url })
      this.logger?.info('Installed a Horizon registry project', {
        project: project.id,
        version: version.version,
        filename: imported.filename,
      })
      if (this.store?.addActivity) {
        await this.store.addActivity({
          type: 'install',
          title: `Installed ${imported.title}`,
          detail: `Horizon registry${version.version ? ` · ${version.version}` : ''}`,
          installationId: null,
          status: 'success',
        })
        this.emitActivity?.()
      }
      return {
        ...imported,
        projectId: project.id,
        projectName: project.name,
        projectVersion: version.version,
        sha256: version.sha256,
      }
    } finally {
      await fsp.rm(target, { force: true }).catch(() => {})
    }
  }
}
