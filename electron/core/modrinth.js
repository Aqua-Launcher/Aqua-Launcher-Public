import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { downloadFiles } from './downloader.js'
import { readPackMetadata } from './content-index.js'
import { atomicWriteJson, ensureDir, fetchJson, fileExists, isPathInside, randomId, readJsonFile, uniqueName } from './util.js'

const API = 'https://api.modrinth.com/v2'
const MOD_LOADER_CATEGORIES = new Set(['fabric', 'quilt', 'forge', 'neoforge'])
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/
const DETAIL_CACHE_MS = 10 * 60 * 1000
const GAME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/

export const SEARCH_SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated']
export const SEARCH_ENVIRONMENTS = ['any', 'client', 'server']
export const SEARCH_LICENSES = [
  'mit',
  'apache-2.0',
  'gpl-3.0',
  'lgpl-3.0',
  'mpl-2.0',
  'bsd-3-clause',
  'cc0-1.0',
  'unlicense',
]

/** Category facets each Modrinth content type accepts, shared with Settings. */
export const SEARCH_CATEGORIES = {
  mod: [
    'optimization',
    'library',
    'utility',
    'technology',
    'magic',
    'adventure',
    'worldgen',
    'decoration',
    'storage',
    'equipment',
    'mobs',
    'transportation',
    'food',
    'game-mechanics',
  ],
  modpack: [
    'adventure',
    'combat',
    'kitchen-sink',
    'lightweight',
    'magic',
    'multiplayer',
    'optimization',
    'quests',
    'technology',
    'vanilla-like',
  ],
  resourcepack: [
    'blocks',
    'combat',
    'decoration',
    'entities',
    'environment',
    'equipment',
    'gui',
    'items',
    'realistic',
    'simplistic',
    'themed',
    'vanilla-like',
  ],
  shader: [
    'cartoon',
    'fantasy',
    'realistic',
    'semi-realistic',
    'simplistic',
    'vanilla-like',
    'atmosphere',
    'colored-lighting',
    'shadows',
    'water',
  ],
  datapack: ['adventure', 'decoration', 'worldgen', 'utility', 'technology', 'magic', 'storage', 'game-mechanics'],
}

/**
 * Modrinth project types that install into a folder inside the game directory.
 * Modpacks are handled separately: they become their own installation.
 */
const CONTENT_TYPES = {
  mod: { label: 'mod', directory: 'mods', extension: '.jar', needsLoader: true },
  resourcepack: { label: 'resource pack', directory: 'resourcepacks', extension: '.zip', needsLoader: false },
  shader: { label: 'shader pack', directory: 'shaderpacks', extension: '.zip', needsLoader: false },
  datapack: { label: 'datapack', directory: 'datapacks', extension: '.zip', needsLoader: false, needsWorld: true },
}

const CONTENT_TYPE_IDS = ['mod', 'modpack', 'resourcepack', 'shader', 'datapack']

const DATAPACK_FORMATS = [
  ['1.21.7', 81],
  ['1.21.6', 80],
  ['1.21.5', 71],
  ['1.21.4', 61],
  ['1.21.2', 57],
  ['1.21', 48],
  ['1.20.5', 41],
  ['1.20.3', 26],
  ['1.20.2', 18],
  ['1.20', 15],
  ['1.19.4', 12],
  ['1.19', 9],
  ['1.18', 8],
  ['1.17', 7],
  ['1.16.2', 6],
  ['1.16', 5],
  ['1.15', 4],
  ['1.14', 4],
  ['1.13', 4],
]

export function datapackFormatForVersion(version) {
  const value = typeof version === 'string' ? version.trim() : ''
  if (!value) return null
  const match = DATAPACK_FORMATS.find(([prefix]) => value === prefix || value.startsWith(`${prefix}.`))
  return match ? match[1] : null
}

/** A mismatch is advisory: Minecraft can still load a datapack that only needs a newer format. */
export function datapackCompatibilityWarning(format, minecraftVersion) {
  if (format == null || !Number.isFinite(Number(format))) {
    return 'No readable pack.mcmeta pack_format was found.'
  }
  const expected = datapackFormatForVersion(minecraftVersion)
  if (expected == null) return `Could not verify pack_format ${format} for Minecraft ${minecraftVersion}.`
  if (Number(format) !== expected) {
    return `This datapack uses pack_format ${format}, but Minecraft ${minecraftVersion} expects ${expected}. It may still work.`
  }
  return null
}

function normalizeContentType(value) {
  const type = typeof value === 'string' && value ? value : 'mod'
  if (!CONTENT_TYPE_IDS.includes(type)) throw new Error('That Modrinth content type is not supported.')
  return type
}

function modrinthLoader(installation) {
  const type = installation.loader?.type || 'vanilla'
  return MOD_LOADER_CATEGORIES.has(type) ? type : null
}

function validProjectId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error('That Modrinth project id is invalid.')
  return id
}

function clip(value, length) {
  return typeof value === 'string' ? value.slice(0, length) : ''
}

function httpUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeProjectDetail(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  const license = raw.license && typeof raw.license === 'object' ? raw.license : null
  const gallery = Array.isArray(raw.gallery)
    ? raw.gallery
        .map((image) => ({
          url: httpUrl(image?.url),
          title: clip(image?.title, 200) || null,
          description: clip(image?.description, 500) || null,
          featured: image?.featured === true,
        }))
        .filter((image) => image.url)
        .slice(0, 8)
    : []
  return {
    id: String(raw.id),
    slug: clip(raw.slug, 80) || null,
    title: clip(raw.title, 200) || 'Modrinth project',
    description: clip(raw.description, 1_000),
    body: clip(raw.body, 80_000),
    iconUrl: httpUrl(raw.icon_url),
    author: null,
    downloads: Number(raw.downloads) || 0,
    followers: Number(raw.followers) || 0,
    categories: Array.isArray(raw.categories)
      ? raw.categories.filter((entry) => typeof entry === 'string').slice(0, 20)
      : [],
    projectType: clip(raw.project_type, 40) || null,
    clientSide: clip(raw.client_side, 20) || null,
    serverSide: clip(raw.server_side, 20) || null,
    license: license
      ? {
          id: clip(license.id, 80) || null,
          name: clip(license.name, 200) || null,
          url: httpUrl(license.url),
        }
      : null,
    sourceUrl: httpUrl(raw.source_url),
    issuesUrl: httpUrl(raw.issues_url),
    wikiUrl: httpUrl(raw.wiki_url),
    discordUrl: httpUrl(raw.discord_url),
    gallery,
    published: clip(raw.published, 40) || null,
    updated: clip(raw.updated, 40) || null,
  }
}

export function normalizeVersion(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  return {
    id: String(raw.id),
    name: clip(raw.name, 200) || clip(raw.version_number, 80) || 'Version',
    versionNumber: clip(raw.version_number, 80),
    versionType: clip(raw.version_type, 20) || 'release',
    gameVersions: Array.isArray(raw.game_versions)
      ? raw.game_versions.filter((entry) => typeof entry === 'string').slice(0, 30)
      : [],
    loaders: Array.isArray(raw.loaders) ? raw.loaders.filter((entry) => typeof entry === 'string') : [],
    datePublished: clip(raw.date_published, 40) || null,
    downloads: Number(raw.downloads) || 0,
    changelog: clip(raw.changelog, 20_000),
    files: Array.isArray(raw.files)
      ? raw.files
          .map((file) => ({
            url: httpUrl(file?.url),
            filename: clip(file?.filename, 260),
            size: Number(file?.size) || 0,
            primary: file?.primary === true,
          }))
          .filter((file) => file.url && file.filename)
          .slice(0, 10)
      : [],
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies
          .map((dependency) => ({
            projectId: clip(dependency?.project_id, 80) || null,
            versionId: clip(dependency?.version_id, 80) || null,
            dependencyType: clip(dependency?.dependency_type, 20) || 'required',
          }))
          .filter((dependency) => dependency.projectId)
          .slice(0, 30)
      : [],
  }
}

export function filterVersions(versions, { gameVersion = null, loader = null } = {}) {
  const list = Array.isArray(versions) ? versions.filter((version) => version && version.id) : []
  return list
    .filter((version) => !gameVersion || version.gameVersions.includes(gameVersion))
    .filter(
      (version) =>
        !loader || version.loaders.some((entry) => String(entry).toLowerCase() === String(loader).toLowerCase()),
    )
    .sort((a, b) => new Date(b.datePublished || 0).getTime() - new Date(a.datePublished || 0).getTime())
}

/** Validate the persisted, non-profile filters stored in `settings.contentFilters`. */
export function normalizeContentFilters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const result = {}
  for (const type of CONTENT_TYPE_IDS) {
    const entry = source[type]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const allowed = SEARCH_CATEGORIES[type] || []
    result[type] = {
      categories: Array.isArray(entry.categories)
        ? [...new Set(entry.categories.filter((category) => allowed.includes(category)))].slice(0, 8)
        : [],
      environment: SEARCH_ENVIRONMENTS.includes(entry.environment) ? entry.environment : 'any',
      license: SEARCH_LICENSES.includes(entry.license) ? entry.license : null,
      openSource: entry.openSource === true,
      sort: SEARCH_SORTS.includes(entry.sort) ? entry.sort : 'relevance',
    }
  }
  return result
}

/** Validate one search request. Profile version/loader defaults are applied by `search`. */
export function normalizeSearchFilters({
  contentType = 'mod',
  sort = 'relevance',
  categories = [],
  environment = 'any',
  license = null,
  openSource = false,
  gameVersion = null,
  loader = null,
} = {}) {
  const type = normalizeContentType(contentType)
  const allowed = SEARCH_CATEGORIES[type] || []
  return {
    contentType: type,
    sort: SEARCH_SORTS.includes(sort) ? sort : 'relevance',
    categories: Array.isArray(categories)
      ? [...new Set(categories.filter((category) => typeof category === 'string' && allowed.includes(category)))].slice(0, 8)
      : [],
    environment: SEARCH_ENVIRONMENTS.includes(environment) ? environment : 'any',
    license: SEARCH_LICENSES.includes(license) ? license : null,
    openSource: openSource === true,
    gameVersion:
      type !== 'modpack' && typeof gameVersion === 'string' && GAME_VERSION_PATTERN.test(gameVersion.trim())
        ? gameVersion.trim()
        : null,
    loader: type === 'mod' && MOD_LOADER_CATEGORIES.has(loader) ? loader : null,
  }
}

/** Modrinth facets are ANDed between groups and ORed inside each group. */
export function buildSearchFacets(filters) {
  const facets = [[`project_type:${filters.contentType}`]]
  if (filters.categories.length) facets.push(filters.categories.map((category) => `categories:${category}`))
  if (filters.loader) facets.push([`categories:${filters.loader}`])
  if (filters.gameVersion) facets.push([`versions:${filters.gameVersion}`])
  if (filters.environment === 'client') facets.push(['client_side:required', 'client_side:optional'])
  if (filters.environment === 'server') facets.push(['server_side:required', 'server_side:optional'])
  if (filters.license) facets.push([`license:${filters.license}`])
  if (filters.openSource) facets.push(['open_source:true'])
  return facets
}

/** Modpacks declare their loader in `dependencies`, e.g. `fabric-loader` or `neoforge`. */
export function resolvePackLoader(dependencies) {
  const candidates = [
    ['fabric', dependencies['fabric-loader']],
    ['quilt', dependencies['quilt-loader']],
    ['neoforge', dependencies.neoforge],
    ['forge', dependencies.forge],
  ]
  for (const [type, version] of candidates) {
    if (typeof version === 'string' && version.trim()) return { type, version: version.trim() }
  }
  return { type: 'vanilla', version: null }
}

function normalizeModFiles(version) {
  const files = Array.isArray(version?.files) ? version.files : []
  const primary = files.find((file) => file.primary) || files[0]
  if (!primary?.url || !primary?.filename) throw new Error('That Modrinth version has no downloadable file.')
  return {
    url: primary.url,
    filename: path.basename(primary.filename),
    sha1: primary.hashes?.sha1 || null,
    size: Number.isFinite(primary.size) ? primary.size : null,
  }
}

async function sha1OfFile(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => resolve(null))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export class ModrinthService {
  constructor({ logger, installationService = null, jobManager = null, store = null, paths = null, loaderService = null }) {
    this.logger = logger
    this.installationService = installationService
    this.jobManager = jobManager
    this.store = store
    this.paths = paths
    this.loaderService = loaderService
  }

  headers() {
    return { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0 (github.com/aqua-launcher)' }
  }

  ensureModdable(installation) {
    const loader = modrinthLoader(installation)
    if (!loader) {
      throw new Error('Add Fabric, Quilt, Forge, or NeoForge to this installation before using mods.')
    }
    return loader
  }

  contentDirectory(installation, contentType) {
    return this.contentDirectoryForWorld(installation, contentType, null)
  }

  worldDirectory(installation, worldFolder) {
    const saves = path.join(installation.gameDir, 'saves')
    if (typeof worldFolder !== 'string' || !worldFolder.trim() || worldFolder !== path.basename(worldFolder)) {
      throw new Error('Choose a world before installing a datapack.')
    }
    const directory = path.resolve(saves, worldFolder)
    if (!isPathInside(directory, saves)) throw new Error('That world is outside the saves folder.')
    return directory
  }

  async requireWorld(installation, worldFolder) {
    const directory = this.worldDirectory(installation, worldFolder)
    const stat = await fsp.stat(directory).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('That world no longer exists.')
    return directory
  }

  contentDirectoryForWorld(installation, contentType, worldFolder = null) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks do not install into a folder.')
    if (spec.needsWorld) {
      return path.join(this.worldDirectory(installation, worldFolder), spec.directory)
    }
    return path.join(installation.gameDir, spec.directory)
  }

  /** Reject anything that is not a plain file name inside the content folder. */
  resolveContentFile(installation, contentType, filename, worldFolder = null) {
    if (typeof filename !== 'string' || !filename.trim()) throw new Error('A file name is required.')
    if (filename !== path.basename(filename)) throw new Error('That file is outside the content folder.')
    const directory = this.contentDirectoryForWorld(installation, contentType, worldFolder)
    const target = path.resolve(directory, filename)
    if (!isPathInside(target, directory)) throw new Error('That file is outside the content folder.')
    return target
  }

  resolveModFile(installation, filename) {
    return this.resolveContentFile(installation, 'mod', filename)
  }

  async search(installation, { query = '', offset = 0, limit = 20, ...options } = {}) {
    const filters = normalizeSearchFilters(options)
    const type = filters.contentType
    // Modpacks carry their own Minecraft version and loader — installing one creates a
    // profile — so they can be browsed before any installation exists.
    if (type !== 'modpack' && !installation) {
      throw new Error('Choose an installation before browsing this content.')
    }

    const hasLoader = Object.prototype.hasOwnProperty.call(options, 'loader')
    const hasGameVersion = Object.prototype.hasOwnProperty.call(options, 'gameVersion')
    let loader = null
    if (type === 'mod') {
      const profileLoader = this.ensureModdable(installation)
      loader = hasLoader ? filters.loader : profileLoader
    }
    const gameVersion = type !== 'modpack' ? (hasGameVersion ? filters.gameVersion : installation.versionId) : null
    const requested = { ...filters, loader, gameVersion }
    const facets = buildSearchFacets(requested)

    const params = new URLSearchParams({
      query: String(query || '').slice(0, 120),
      facets: JSON.stringify(facets),
      index: requested.sort,
      limit: String(Math.min(Math.max(Number(limit) || 20, 1), 40)),
      offset: String(Math.max(Number(offset) || 0, 0)),
    })
    const payload = await fetchJson(`${API}/search?${params.toString()}`, { headers: this.headers() }, { logger: this.logger })
    const hits = Array.isArray(payload?.hits) ? payload.hits : []
    return {
      contentType: type,
      total: Number(payload?.total_hits) || 0,
      offset: Number(payload?.offset) || 0,
      limit: Number(payload?.limit) || hits.length,
      loader,
      minecraftVersion: gameVersion,
      sort: requested.sort,
      categories: requested.categories,
      environment: requested.environment,
      license: requested.license,
      openSource: requested.openSource,
      hits: hits.map((hit) => ({
        id: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        iconUrl: hit.icon_url || null,
        downloads: Number(hit.downloads) || 0,
        follows: Number(hit.follows) || 0,
        projectType: hit.project_type || type,
        categories: Array.isArray(hit.categories) ? hit.categories : [],
        versions: Array.isArray(hit.versions) ? hit.versions : [],
        updated: hit.date_modified || null,
      })),
    }
  }

  async versions(projectId, { loader, minecraftVersion } = {}) {
    const params = new URLSearchParams()
    if (loader) params.set('loaders', JSON.stringify([loader]))
    if (minecraftVersion) params.set('game_versions', JSON.stringify([minecraftVersion]))
    const query = params.toString()
    const list = await fetchJson(
      `${API}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ''}`,
      { headers: this.headers() },
      { logger: this.logger },
    )
    return Array.isArray(list) ? list : []
  }

  cacheFile(name) {
    return this.paths ? path.join(this.paths.cacheRoot, 'modrinth', name) : null
  }

  async cached(name, load) {
    const file = this.cacheFile(name)
    const cached = file ? await readJsonFile(file, null) : null
    if (cached?.savedAt && Date.now() - cached.savedAt < DETAIL_CACHE_MS && cached.data) return cached.data
    try {
      const data = await load()
      if (file) {
        await ensureDir(path.dirname(file))
        await atomicWriteJson(file, { savedAt: Date.now(), data })
      }
      return data
    } catch (error) {
      // A stale copy is better than an empty drawer while Modrinth is unavailable.
      if (cached?.data) return cached.data
      throw error
    }
  }

  async getProject(projectId) {
    const id = validProjectId(projectId)
    return this.cached(`project-${id}.json`, async () => {
      const payload = await fetchJson(`${API}/project/${encodeURIComponent(id)}`, { headers: this.headers() }, {
        logger: this.logger,
      })
      const project = normalizeProjectDetail(payload)
      if (!project) throw new Error('Modrinth returned an incomplete project.')
      return project
    })
  }

  async getVersions(projectId, { gameVersion = null, loader = null } = {}) {
    const id = validProjectId(projectId)
    const all = await this.cached(`versions-${id}.json`, async () => {
      const payload = await fetchJson(
        `${API}/project/${encodeURIComponent(id)}/version`,
        { headers: this.headers() },
        { logger: this.logger },
      )
      // Cap the list: a drawer never needs hundreds of historical files.
      const list = Array.isArray(payload) ? payload.slice(0, 300) : []
      return list.map(normalizeVersion).filter(Boolean)
    })
    return filterVersions(all, {
      gameVersion: typeof gameVersion === 'string' ? gameVersion : null,
      loader: typeof loader === 'string' ? loader : null,
    })
  }

  async install(installation, { projectId, versionId = null, contentType = 'mod', worldFolder = null } = {}) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are installed as their own installation.')
    if (!projectId) throw new Error(`Choose a ${spec.label} to install.`)

    const loader = spec.needsLoader ? this.ensureModdable(installation) : null
    const minecraftVersion = installation.versionId
    if (spec.needsWorld) await this.requireWorld(installation, worldFolder)
    const contentDir = this.contentDirectoryForWorld(installation, type, worldFolder)
    await ensureDir(contentDir)

    const candidates = await this.versions(projectId, {
      loader: spec.needsLoader ? loader : null,
      minecraftVersion,
    })
    if (!candidates.length) {
      throw new Error(`No ${spec.label} file is available for Minecraft ${minecraftVersion}${loader ? ` on ${loader}` : ''}.`)
    }

    const queue = []
    const seenProjects = new Set()
    const skipped = []

    const collect = async (id, wantedVersionId = null, depth = 0) => {
      if (!id || seenProjects.has(id) || depth > 4) return
      seenProjects.add(id)
      let pool = await this.versions(id, {
        loader: spec.needsLoader ? loader : null,
        minecraftVersion,
      })
      if (!pool.length) {
        skipped.push(id)
        return
      }
      let chosen = wantedVersionId ? pool.find((version) => version.id === wantedVersionId) : null
      chosen = chosen || pool[0]
      const files = normalizeModFiles(chosen)
      queue.push({
        projectId: id,
        versionId: chosen.id,
        name: chosen.name || chosen.version_number || files.filename,
        versionNumber: chosen.version_number || '',
        file: files,
      })
      // Only mods pull in required dependencies; packs are standalone files.
      if (!spec.needsLoader) return
      for (const dependency of Array.isArray(chosen.dependencies) ? chosen.dependencies : []) {
        if (dependency?.dependency_type !== 'required' || !dependency?.project_id) continue
        await collect(dependency.project_id, dependency.version_id || null, depth + 1)
      }
    }

    await collect(projectId, versionId)

    const downloads = []
    for (const entry of queue) {
      downloads.push({
        url: entry.file.url,
        destination: this.resolveContentFile(installation, type, entry.file.filename, worldFolder),
        sha1: entry.file.sha1,
        size: entry.file.size,
      })
    }

    if (downloads.length) {
      await downloadFiles(downloads, {
        concurrency: 3,
        logger: this.logger,
        attempts: 3,
      })
    }

    this.logger?.info(`Installed Modrinth ${spec.label}`, {
      installation: installation.name,
      loader,
      minecraftVersion,
      contentType: type,
      files: downloads.length,
    })

    const warnings = []
    if (type === 'datapack') {
      for (const entry of queue) {
        const filePath = this.resolveContentFile(installation, type, entry.file.filename, worldFolder)
        const metadata = readPackMetadata(filePath)
        const warning = datapackCompatibilityWarning(metadata?.format, installation.versionId)
        if (warning) warnings.push(`${entry.file.filename}: ${warning}`)
      }
    }

    return {
      contentType: type,
      installed: queue.map((entry) => ({
        projectId: entry.projectId,
        versionId: entry.versionId,
        name: entry.name,
        versionNumber: entry.versionNumber,
        filename: entry.file.filename,
      })),
      skipped,
      warnings,
    }
  }

  /**
   * Installs a Modrinth modpack (.mrpack) as a fresh installation:
   * the pack manifest names its Minecraft version, loader, overrides and files.
   */
  async installModpack({ projectId, versionId = null } = {}) {
    if (!projectId) throw new Error('Choose a modpack to install.')
    if (!this.installationService || !this.jobManager || !this.paths) {
      throw new Error('Modpack installation is not available in this build.')
    }
    const versions = await this.versions(projectId)
    const chosen = (versionId && versions.find((version) => version.id === versionId)) || versions[0]
    if (!chosen) throw new Error('That modpack has no downloadable versions.')

    const file = normalizeModFiles(chosen)
    if (!/\.mrpack$/i.test(file.filename)) throw new Error('That modpack does not provide a .mrpack file.')
    const cacheDir = path.join(this.paths.cacheRoot, 'modpacks')
    await ensureDir(cacheDir)
    const archivePath = path.join(cacheDir, `${randomId()}-${path.basename(file.filename)}`)
    await downloadFiles([{ url: file.url, destination: archivePath, sha1: file.sha1, size: file.size }], {
      concurrency: 1,
      logger: this.logger,
      attempts: 3,
    })

    // The pack becomes a profile, so remember which project it came from along
    // with its Modrinth icon; that is what the profile then shows as its logo.
    const projectKey = chosen.project_id || projectId
    const project = projectKey ? (await this.lookupProjects([projectKey]))[projectKey] : null
    const packProject = {
      projectId: project?.id || projectKey || null,
      name: project?.title || chosen.name || null,
      iconUrl: project?.icon_url || null,
      versionId: chosen.id || null,
    }

    try {
      return await this.installModpackArchive(archivePath, chosen, packProject)
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => {})
    }
  }

  async installModpackArchive(archivePath, chosenVersion, packProject = null, options = {}) {
    const { signal = null, onProgress = () => {} } = options
    let zip
    try {
      zip = new AdmZip(archivePath)
    } catch {
      throw new Error('That modpack download is not a valid .mrpack archive.')
    }
    const indexEntry = zip.getEntry('modrinth.index.json')
    if (!indexEntry) throw new Error('That modpack is missing its modrinth.index.json manifest.')
    let index
    try {
      index = JSON.parse(indexEntry.getData().toString('utf8'))
    } catch {
      throw new Error('The modpack manifest could not be read.')
    }

    if (Number(index?.formatVersion) !== 1) {
      throw new Error('Only .mrpack format version 1 is supported.')
    }
    if (!Array.isArray(index.files)) throw new Error('The modpack manifest has no files list.')

    const dependencies = index?.dependencies && typeof index.dependencies === 'object' ? index.dependencies : {}
    const minecraftVersion = typeof dependencies.minecraft === 'string' ? dependencies.minecraft.trim() : ''
    if (!minecraftVersion) throw new Error('The modpack does not specify a Minecraft version.')
    const loader = resolvePackLoader(dependencies)
    if (loader.type !== 'vanilla') {
      if (!loader.version) throw new Error(`The modpack does not specify a ${loader.type} loader version.`)
      if (this.loaderService) {
        let versions = []
        try {
          versions = await this.loaderService.listVersions(loader.type, minecraftVersion)
        } catch (error) {
          throw new Error(`Could not check ${loader.type} loader versions: ${error.message}`)
        }
        if (Array.isArray(versions) && versions.length && !versions.some((entry) => entry.version === loader.version)) {
          throw new Error(`Minecraft ${minecraftVersion} has no ${loader.type} loader ${loader.version}.`)
        }
      }
    }

    const packVersion = typeof index.versionId === 'string' ? index.versionId : chosenVersion?.version_number || ''
    const preferredName =
      (typeof index.name === 'string' && index.name.trim()) || chosenVersion?.name || 'Modpack'
    const name = uniqueName(
      preferredName.trim().slice(0, 48),
      this.store?.installations?.map((installation) => installation.name) || [],
    )

    if (signal?.aborted) {
      throw Object.assign(new Error('Modpack import cancelled.'), { name: 'AbortError' })
    }

    // Validate file paths before creating anything so a malformed pack cannot
    // leave a half-made installation behind.
    const packRoot = path.resolve(os.tmpdir(), 'aqua-modpack-root')
    const packFiles = []
    for (const entry of Array.isArray(index.files) ? index.files : []) {
      if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) continue
      if (entry.env?.client === 'unsupported') continue
      const urls = Array.isArray(entry.downloads) ? entry.downloads.filter((url) => typeof url === 'string') : []
      if (!urls.length) continue
      if (!isPathInside(path.resolve(packRoot, entry.path), packRoot)) {
        throw new Error('That modpack tries to write outside the game folder.')
      }
      packFiles.push({
        relativePath: entry.path,
        url: urls[0],
        sha1: entry.hashes?.sha1 || null,
        size: Number.isFinite(entry.fileSize) ? entry.fileSize : null,
      })
    }

    const installation = await this.installationService.create({
      name,
      versionId: minecraftVersion,
      loader: loader.type === 'vanilla' ? null : { type: loader.type, version: loader.version },
      modpack: packProject?.projectId
        ? {
            projectId: packProject.projectId,
            name: (packProject.name || preferredName).trim().slice(0, 80),
            iconUrl: packProject.iconUrl || null,
            versionId: packProject.versionId || null,
          }
        : null,
    })

    try {
    const overrides = await this.extractPackOverrides(zip, installation.gameDir)
    const downloads = packFiles.map((entry) => ({
      url: entry.url,
      destination: path.resolve(installation.gameDir, entry.relativePath),
      sha1: entry.sha1,
      size: entry.size,
    }))

    if (downloads.length) {
      await downloadFiles(downloads, {
        concurrency: 6,
        logger: this.logger,
        attempts: 3,
        signal,
        onProgress: (update) => onProgress({ stage: 'Downloading pack files', ...update }),
      })
    }

    // Game files (Minecraft, loader profile, libraries) still need downloading.
    const job = this.jobManager.enqueueInstall(installation.id)
    this.logger?.info('Installed Modrinth modpack', {
      name: installation.name,
      minecraftVersion,
      loader: loader.type,
      files: downloads.length,
      overrides,
    })

    return {
      installation,
      job,
      modpack: {
        name: installation.name,
        packName: preferredName,
        version: packVersion,
        minecraftVersion,
        loader: loader.type,
        loaderVersion: loader.version,
        files: downloads.length,
        overrides,
      },
    }
    } catch (error) {
      await this.installationService.remove(installation.id).catch(() => {})
      if (installation.managedGameDir) {
        await fsp.rm(installation.gameDir, { recursive: true, force: true }).catch(() => {})
      }
      throw error
    }
  }

  /** Copies `overrides/` and `client-overrides/` out of an .mrpack into the game directory. */
  async extractPackOverrides(zip, gameDir) {
    let written = 0
    for (const entry of zip.getEntries()) {
      const entryName = String(entry.entryName || '').replace(/\\/g, '/')
      const match = /^(?:client-)?overrides\/(.+)$/.exec(entryName)
      if (!match || entry.isDirectory) continue
      const relative = match[1]
      if (!relative || relative.endsWith('/') || relative.includes('\0')) continue
      const destination = path.resolve(gameDir, relative)
      if (!isPathInside(destination, gameDir)) {
        throw new Error('That modpack override tries to write outside the game folder.')
      }
      await ensureDir(path.dirname(destination))
      await fsp.writeFile(destination, entry.getData())
      written += 1
    }
    return written
  }

  async listInstalled(installation, contentType = 'mod', worldFolder = null) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) return { contentType: type, directory: null, items: [] }
    const directory = this.contentDirectoryForWorld(installation, type, worldFolder)
    let entries = []
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return { contentType: type, directory, items: [] }
    }

    const files = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(spec.extension) && !entry.name.toLowerCase().endsWith(`${spec.extension}.disabled`)) {
        continue
      }
      const fullPath = path.join(directory, entry.name)
      const stat = await fsp.stat(fullPath).catch(() => null)
      if (!stat) continue
      files.push({
        filename: entry.name,
        enabled: !entry.name.endsWith('.disabled'),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        sha1: await sha1OfFile(fullPath),
      })
    }

    const metadata = files.length ? await this.lookupHashes(files.map((file) => file.sha1).filter(Boolean)) : {}
    const projects = await this.lookupProjects(Object.values(metadata).map((version) => version.project_id))

    const items = files.map((file) => {
      const version = file.sha1 ? metadata[file.sha1] : null
      const project = version ? projects[version.project_id] : null
      return {
        ...file,
        projectId: project?.id || version?.project_id || null,
        versionId: version?.id || null,
        title: project?.title || file.filename.replace(new RegExp(`\\${spec.extension}(\\.disabled)?$`, 'i'), ''),
        description: project?.description || null,
        iconUrl: project?.icon_url || null,
        versionNumber: version?.version_number || null,
        matched: Boolean(version),
      }
    })

    items.sort((a, b) => a.title.localeCompare(b.title))
    return { contentType: type, directory, items }
  }

  async lookupHashes(hashes) {
    const output = {}
    const unique = [...new Set(hashes)]
    for (let index = 0; index < unique.length; index += 80) {
      const batch = unique.slice(index, index + 80)
      try {
        const payload = await fetchJson(
          `${API}/version_files`,
          {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: batch, algorithm: 'sha1' }),
          },
          { logger: this.logger },
        )
        if (payload && typeof payload === 'object') Object.assign(output, payload)
      } catch (error) {
        this.logger?.warn('Could not match installed content with Modrinth', { message: error.message })
        break
      }
    }
    return output
  }

  async lookupProjects(ids) {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {}
    try {
      const list = await fetchJson(
        `${API}/projects?ids=${encodeURIComponent(JSON.stringify(unique.slice(0, 100)))}`,
        { headers: this.headers() },
        { logger: this.logger },
      )
      const map = {}
      for (const project of Array.isArray(list) ? list : []) map[project.id] = project
      return map
    } catch (error) {
      this.logger?.warn('Could not load Modrinth project details', { message: error.message })
      return {}
    }
  }

  /**
   * Asks Modrinth for the newest compatible file behind each installed hash.
   * Mods go through the batch endpoint; packs and shaders are looked up per
   * project because their version loaders are not tied to the mod loader.
   */
  async checkUpdates(installation, contentType = 'mod', worldFolder = null) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are updated by installing a new pack version.')
    const installed = await this.listInstalled(installation, type, worldFolder)
    const candidates = installed.items.filter(
      (item) => item.enabled && item.matched && item.sha1 && item.projectId && item.versionId,
    )
    if (!candidates.length) return { contentType: type, checked: installed.items.length, updates: [] }

    const latestByHash = new Map()
    if (type === 'mod') {
      const loader = this.ensureModdable(installation)
      try {
        const payload = await fetchJson(
          `${API}/version_files/update`,
          {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hashes: candidates.map((item) => item.sha1),
              algorithm: 'sha1',
              loaders: [loader],
              game_versions: [installation.versionId],
            }),
          },
          { logger: this.logger },
        )
        if (payload && typeof payload === 'object') {
          for (const [hash, version] of Object.entries(payload)) latestByHash.set(hash, version)
        }
      } catch (error) {
        this.logger?.warn('Could not check Modrinth updates', { message: error.message })
        throw new Error(`Could not check for updates: ${error.message}`)
      }
    } else {
      const seen = new Set()
      let attempts = 0
      let failures = 0
      let lastError = null
      for (const item of candidates) {
        if (!item.projectId || seen.has(item.projectId)) continue
        seen.add(item.projectId)
        attempts += 1
        try {
          const versions = await this.versions(item.projectId, { minecraftVersion: installation.versionId })
          if (versions[0]) latestByHash.set(item.sha1, versions[0])
        } catch (error) {
          failures += 1
          lastError = error
          this.logger?.debug('Could not check one Modrinth project for updates', {
            projectId: item.projectId,
            message: error.message,
          })
        }
      }
      // A total outage must not be reported as "everything is up to date".
      if (attempts > 0 && failures === attempts) {
        throw new Error(`Could not check for updates: ${lastError?.message || 'Modrinth did not respond.'}`)
      }
    }

    const updates = []
    for (const item of candidates) {
      const latest = latestByHash.get(item.sha1)
      if (!latest || !latest.id || latest.id === item.versionId) continue
      let file
      try {
        file = normalizeModFiles(latest)
      } catch {
        continue
      }
      updates.push({
        filename: item.filename,
        projectId: item.projectId,
        title: item.title,
        iconUrl: item.iconUrl,
        currentVersionId: item.versionId,
        currentVersionNumber: item.versionNumber,
        latestVersionId: latest.id,
        latestVersionNumber: latest.version_number || null,
        latestFilename: file.filename,
        enabled: item.enabled,
      })
    }
    return { contentType: type, checked: candidates.length, updates }
  }

  /** Replaces one installed content file with a specific Modrinth version. */
  async update(installation, { filename, versionId, contentType = 'mod', worldFolder = null } = {}) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are installed as their own profile.')
    if (!versionId || typeof versionId !== 'string') throw new Error('Choose an update to install.')
    const currentPath = this.resolveContentFile(installation, type, filename, worldFolder)
    if (!(await fileExists(currentPath))) throw new Error('That content file is no longer on disk.')

    const version = await fetchJson(
      `${API}/version/${encodeURIComponent(versionId)}`,
      { headers: this.headers() },
      { logger: this.logger },
    )
    if (!version || version.id !== versionId) throw new Error('That Modrinth version is not available.')
    if (Array.isArray(version.game_versions) && !version.game_versions.includes(installation.versionId)) {
      throw new Error(`That update does not support Minecraft ${installation.versionId}.`)
    }
    if (spec.needsLoader) {
      const loader = this.ensureModdable(installation)
      if (Array.isArray(version.loaders) && !version.loaders.includes(loader)) {
        throw new Error(`That update is not compatible with ${loader}.`)
      }
    }

    const file = normalizeModFiles(version)
    if (!file.filename.toLowerCase().endsWith(spec.extension)) {
      throw new Error('That update does not contain the expected file type.')
    }
    const disabled = filename.endsWith('.disabled')
    const destinationName = disabled ? `${file.filename}.disabled` : file.filename
    const destination = this.resolveContentFile(installation, type, destinationName, worldFolder)
    await ensureDir(path.dirname(destination))
    await downloadFiles([{ url: file.url, destination, sha1: file.sha1, size: file.size }], {
      concurrency: 1,
      logger: this.logger,
      attempts: 3,
    })
    if (path.basename(currentPath) !== path.basename(destination)) {
      await fsp.rm(currentPath, { force: true })
    }
    this.logger?.info('Updated Modrinth content', {
      installation: installation.name,
      project: version.project_id,
      from: filename,
      to: destinationName,
      version: version.version_number,
    })
    return {
      contentType: type,
      filename: destinationName,
      previousFilename: filename,
      versionId: version.id,
      versionNumber: version.version_number || null,
      name: version.name || null,
    }
  }

  async toggle(installation, filename, contentType = 'mod', worldFolder = null) {
    const target = this.resolveContentFile(installation, contentType, filename, worldFolder)
    if (!(await fileExists(target))) throw new Error('That file is no longer on disk.')
    const directory = this.contentDirectoryForWorld(installation, contentType, worldFolder)
    const next = filename.endsWith('.disabled') ? target.slice(0, -'.disabled'.length) : `${target}.disabled`
    if (!isPathInside(next, directory)) throw new Error('That file is outside the content folder.')
    await fsp.rename(target, next)
    return { filename: path.basename(next), enabled: !path.basename(next).endsWith('.disabled') }
  }

  async remove(installation, filename, contentType = 'mod', worldFolder = null) {
    const target = this.resolveContentFile(installation, contentType, filename, worldFolder)
    await fsp.rm(target, { force: true })
    return { filename }
  }
}

export { CONTENT_TYPE_IDS, CONTENT_TYPES, MOD_LOADER_CATEGORIES, normalizeContentType }
