import AdmZip from 'adm-zip'
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ensureDir, isPathInside, readJsonFile, atomicWriteJson } from './util.js'

const execFileAsync = promisify(execFile)

/** Community-maintained Bedrock package catalogs, the same ones the version switchers read. */
const UWP_CATALOG_URL =
  'https://raw.githubusercontent.com/ddf8196/mc-w10-versiondb-auto-update/master/versions.json.min'
const GDK_CATALOG_URL =
  'https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json'
const UPDATE_SERVICE_URL = 'https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx'

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000
const CATALOG_VERSION = 1
const MAX_CATALOG_BYTES = 8 * 1024 * 1024
const VERSION_PATTERN = /^\d+(\.\d+){1,3}$/
const CHANNELS = ['release', 'beta', 'preview']

const CHANNEL_BY_TYPE = { 0: 'release', 1: 'beta', 2: 'preview' }

function cleanVersion(value) {
  const version = String(value ?? '').trim()
  return VERSION_PATTERN.test(version) ? version : null
}

function versionKey(version) {
  return version.split('.').map((part) => Number(part) || 0)
}

/** Newest first, comparing each dotted component numerically. */
export function compareVersions(a, b) {
  const left = versionKey(a)
  const right = versionKey(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** The UWP catalog is a list of `[version, update id, type]` tuples. */
export function parseUwpCatalog(raw) {
  if (!Array.isArray(raw)) return []
  const versions = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const version = cleanVersion(entry[0])
    const updateId = typeof entry[1] === 'string' && /^[0-9a-f-]{36}$/i.test(entry[1].trim()) ? entry[1].trim() : null
    if (!version || !updateId) continue
    versions.push({
      version,
      package: 'appx',
      channel: CHANNEL_BY_TYPE[Number(entry[2])] || 'release',
      updateId,
      url: null,
    })
  }
  return versions
}

/** The GDK catalog maps versions to direct MSIXVC download URLs. */
export function parseGdkCatalog(raw) {
  if (!raw || typeof raw !== 'object') return []
  const versions = []
  for (const [channel, entries] of [
    ['release', raw.release],
    ['preview', raw.preview],
  ]) {
    if (!entries || typeof entries !== 'object') continue
    for (const [key, urls] of Object.entries(entries)) {
      const version = cleanVersion(key)
      const url = Array.isArray(urls) ? urls.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item)) : null
      if (!version || !url) continue
      versions.push({ version, package: 'msixvc', channel, updateId: null, url })
    }
  }
  return versions
}

/** Both catalogs in one list: UWP-era APPX builds first, then MSIXVC builds. */
export function mergeCatalogs(uwp, gdk) {
  const byVersion = new Map()
  // MSIXVC entries win: a version published in both formats is a GDK build.
  for (const entry of [...uwp, ...gdk]) {
    const existing = byVersion.get(entry.version)
    if (!existing || (existing.package === 'appx' && entry.package === 'msixvc')) byVersion.set(entry.version, entry)
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(a.version, b.version))
}

/** The Windows Update request that turns an update identity into a package URL. */
export function buildUpdateInfoEnvelope(updateId) {
  if (typeof updateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(updateId.trim())) {
    throw new Error('That version has no update identity.')
  }
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>' +
    '<a:Action>http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService/GetExtendedUpdateInfo2</a:Action>' +
    '<a:MessageID>urn:uuid:0ffc5961-414a-4019-9c0f-9247281674d4</a:MessageID>' +
    `<a:To s:mustUnderstand="1">${UPDATE_SERVICE_URL}</a:To>` +
    '<o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    '<wuws:WindowsUpdateTicketsToken wsu:id="ClientMSA" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:wuws="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization">' +
    '<TicketType Name="AAD" Version="1.0" Policy="MBI_SSL"></TicketType></wuws:WindowsUpdateTicketsToken></o:Security></s:Header>' +
    '<s:Body><GetExtendedUpdateInfo2 xmlns="http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService"><updateIDs>' +
    `<UpdateIdentity><UpdateID>${updateId.trim()}</UpdateID><RevisionNumber>1</RevisionNumber></UpdateIdentity>` +
    '</updateIDs><infoTypes><XmlUpdateFragmentType>FileUrl</XmlUpdateFragmentType></infoTypes></GetExtendedUpdateInfo2></s:Body></s:Envelope>'
  )
}

/**
 * Pulls the delivery URL out of the SOAP response. Microsoft puts it in a
 * FileLocation/Url element, and the host has changed over the years, so the
 * first tagged URL wins and an untagged delivery link is the fallback.
 */
export function parseUpdateInfoResponse(xml) {
  const text = String(xml ?? '')
  const tagged = text.match(/<(?:Url|URL|FileLocation|FileUrl|fileUrl)>([^<]+)</)
  const loose = text.match(/https?:\/\/[^<>"'\s]+/i)
  for (const candidate of [tagged?.[1], loose?.[0]]) {
    const url = (candidate || '').replace(/&amp;/g, '&').trim()
    if (/^https?:\/\/[^\s]+$/i.test(url)) return url
  }
  return null
}

/**
 * Unpacks an APPX/zip package entry by entry. Entries are written individually
 * so a ~1 GB package never freezes the app and a path outside the target folder
 * is skipped rather than written.
 */
export async function extractPackage(archive, directory) {
  const zip = new AdmZip(archive)
  const root = path.resolve(directory)
  let written = 0
  for (const entry of zip.getEntries()) {
    const name = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!name || name.split('/').includes('..')) continue
    const target = path.resolve(root, name)
    if (target === root || !isPathInside(target, root)) continue
    if (entry.isDirectory) {
      await ensureDir(target)
      continue
    }
    await ensureDir(path.dirname(target))
    await pipeline(Readable.from(entry.getData()), createWriteStream(target))
    written += 1
    if (written % 8 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  return written
}

/** Electron hands back a web stream; tests and other callers may pass a Node one. */
const INSTALLED_TTL_MS = 60000

/** The framework packages a manifest declares, e.g. Microsoft.VCLibs.140.00. */
export function parsePackageDependencies(xml) {
  const text = String(xml ?? '')
  const dependencies = []
  for (const match of text.matchAll(/<PackageDependency\b([^>]*)>/g)) {
    const name = /Name="([^"]+)"/.exec(match[1])?.[1]
    if (!name) continue
    const minVersion = /MinVersion="([^"]+)"/.exec(match[1])?.[1] || '0.0.0.0'
    dependencies.push({ name, minVersion })
  }
  return dependencies
}

/**
 * The package name and version a downloaded build declares in its own manifest.
 * Registering a build only counts when Windows lists this exact version.
 */
export function parseManifestIdentity(xml) {
  const text = String(xml ?? '')
  const identity = /<Identity\b([^>]*)>/i.exec(text)?.[1]
  if (!identity) return { name: null, version: null }
  const name = /Name="([^"]+)"/i.exec(identity)?.[1]?.trim() || null
  const declared = /Version="([^"]+)"/i.exec(identity)?.[1]?.trim() || null
  return { name, version: declared && /^\d+(\.\d+){1,3}$/.test(declared) ? declared : null }
}

/** Dotted version comparison, used to check MinVersion requirements. */
export function comparePackageVersions(a, b) {
  const left = String(a ?? '').split('.').map((part) => Number(part) || 0)
  const right = String(b ?? '').split('.').map((part) => Number(part) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}

/** Turns a deployment failure into the one line worth showing. */
export function describeDeploymentFailure(result) {
  const output = `${result?.stderr || ''}\n${result?.stdout || ''}`
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const interesting =
    output.find((line) => /0x8[0-9a-f]{7}/i.test(line)) || output.find((line) => /HRESULT/i.test(line)) || output[0]
  return (interesting || result?.message || 'Windows refused to install the package.').slice(0, 300)
}

async function runCommand(file, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    })
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') }
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
      message: error.message,
    }
  }
}

async function readStreamBody(response) {
  const body = response.body
  if (body && typeof body.getReader === 'function') return Readable.fromWeb(body)
  return body
}

export class BedrockVersionsService {
  constructor({ paths, logger, fetchImpl, bedrockService, emitProgress, runCommand: runOverride }) {
    this.paths = paths
    this.logger = logger
    this.fetch = fetchImpl
    this.bedrockService = bedrockService
    this.emitProgress = emitProgress || (() => {})
    this.run = runOverride || runCommand
    this.cache = null
    this.installedCache = null
    this.inFlight = new Map()
  }



  versionDirectory(version) {
    const clean = cleanVersion(version)
    if (!clean) throw new Error('That Bedrock version is invalid.')
    const root = path.resolve(this.paths.bedrockVersionsRoot)
    const target = path.resolve(root, clean)
    if (!isPathInside(target, root) || target === root) throw new Error('That Bedrock version is invalid.')
    return target
  }

  /** Extracted (APPX) or downloaded (MSIXVC) versions already on disk. */
  async library() {
    let entries = []
    try {
      entries = await fsp.readdir(this.paths.bedrockVersionsRoot, { withFileTypes: true })
    } catch {
      return new Map()
    }
    const library = new Map()
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const version = cleanVersion(entry.name)
      if (!version) continue
      const directory = path.join(this.paths.bedrockVersionsRoot, entry.name)
      const manifest = path.join(directory, 'AppxManifest.xml')
      const msixvc = path.join(directory, 'package.msixvc')
      const manifestStat = await fsp.stat(manifest).catch(() => null)
      const msixvcStat = await fsp.stat(msixvc).catch(() => null)
      if (!manifestStat?.isFile() && !msixvcStat?.isFile()) continue
      library.set(version, {
        version,
        directory,
        layout: manifestStat?.isFile() ? 'appx' : 'msixvc',
        sizeBytes: await directorySize(directory),
      })
    }
    return library
  }

  async status() {
    const [library, installed] = await Promise.all([
      this.library(),
      this.bedrockService.status().catch(() => ({ editions: [] })),
    ])
    return { library, installed: installed?.editions || [] }
  }

  async list({ force = false } = {}) {
    const cached = force ? null : await this.readCache()
    if (cached) return cached

    const warnings = []
    const catalogs = await Promise.all([
      this.fetchCatalog(UWP_CATALOG_URL, 'The UWP version list'),
      this.fetchCatalog(GDK_CATALOG_URL, 'The GDK version list'),
    ])
    const [uwp, gdk] = catalogs
    for (const [name, result] of [
      ['uwp', uwp],
      ['gdk', gdk],
    ]) {
      if (result.error) warnings.push(`${name}: ${result.error}`)
    }

    const merged = mergeCatalogs(uwp.versions, gdk.versions)
    if (!merged.length) {
      const error = warnings.join(' · ') || 'No Bedrock versions could be listed.'
      throw new Error(error)
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      stale: false,
      error: warnings.length ? `Some sources failed (${warnings.join(' · ')}).` : null,
      versions: merged,
    }
    await this.writeCache(payload)
    return payload
  }

  async fetchCatalog(url, label) {
    try {
      const response = await this.fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > MAX_CATALOG_BYTES) throw new Error('the list is too large')
      const raw = JSON.parse(text)
      return { versions: url === UWP_CATALOG_URL ? parseUwpCatalog(raw) : parseGdkCatalog(raw), error: null }
    } catch (error) {
      this.logger?.warn('Could not read a Bedrock version list', { url, message: error.message })
      return { versions: [], error: `${label} could not be read (${error.message}).` }
    }
  }

  async readCache() {
    const raw = await readJsonFile(this.paths.bedrockVersionsCacheFile, null)
    if (!raw || raw.version !== CATALOG_VERSION || !Array.isArray(raw.versions)) return null
    const age = Date.now() - new Date(raw.fetchedAt || 0).getTime()
    if (!Number.isFinite(age) || age > CATALOG_TTL_MS) return null
    return { fetchedAt: raw.fetchedAt, fromCache: true, stale: false, error: null, versions: raw.versions }
  }

  async writeCache(payload) {
    await ensureDir(path.dirname(this.paths.bedrockVersionsCacheFile))
    await atomicWriteJson(this.paths.bedrockVersionsCacheFile, {
      version: CATALOG_VERSION,
      fetchedAt: payload.fetchedAt,
      versions: payload.versions,
    }).catch(() => {})
  }

  async findVersion(version) {
    const list = await this.list()
    return list.versions.find((entry) => entry.version === version) || null
  }

  /** Turns an update identity into a downloadable package URL. */
  async resolveDownloadUrl(entry) {
    if (entry.package === 'msixvc') {
      if (!entry.url) throw new Error('That build has no download link.')
      return entry.url
    }
    const response = await this.fetch(UPDATE_SERVICE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
      body: buildUpdateInfoEnvelope(entry.updateId),
    })
    if (!response.ok) throw new Error(`Microsoft's update service answered HTTP ${response.status}.`)
    const url = parseUpdateInfoResponse(await response.text())
    if (!url) throw new Error('Microsoft no longer serves a package for that version.')
    return url
  }

  progress(version, payload) {
    this.emitProgress({ version, ...payload })
  }

  cancel(version) {
    const controller = this.inFlight.get(version)
    if (!controller) return { version, cancelled: false }
    controller.abort()
    this.inFlight.delete(version)
    return { version, cancelled: true }
  }

  /**
   * Downloads a version into the launcher's Bedrock folder. APPX packages are
   * unpacked in place (the signature is dropped, exactly as the version
   * switchers do) so Windows can register them; MSIXVC packages stay as files,
   * because Windows only takes those by installing them.
   */
  async download(version) {
    const entry = await this.findVersion(version)
    if (!entry) throw new Error('That Bedrock version is not in the catalog.')
    if (this.inFlight.has(version)) throw new Error('That version is already downloading.')

    const directory = this.versionDirectory(version)
    const archive = path.join(this.paths.bedrockDownloadsRoot, `${version}.${entry.package === 'appx' ? 'appx' : 'msixvc'}`)
    const controller = new AbortController()
    this.inFlight.set(version, controller)
    await ensureDir(this.paths.bedrockDownloadsRoot)

    try {
      this.progress(version, { phase: 'resolving', receivedBytes: 0, totalBytes: null })
      const url = await this.resolveDownloadUrl(entry)

      let response
      try {
        response = await this.fetch(url, { signal: controller.signal })
      } catch (error) {
        if (controller.signal.aborted) throw new Error('The download was cancelled.')
        throw new Error(`The package could not be downloaded (${error.message}).`)
      }
      if (!response.ok) throw new Error(`The package server answered HTTP ${response.status}.`)
      if (!response.body) throw new Error('The package server sent an empty response.')

      const totalBytes = Number(response.headers.get('content-length')) || null
      let receivedBytes = 0
      let lastEmit = 0
      const body = await readStreamBody(response)
      body.on('data', (chunk) => {
        receivedBytes += chunk.length
        const now = Date.now()
        if (now - lastEmit > 200) {
          lastEmit = now
          this.progress(version, { phase: 'downloading', receivedBytes, totalBytes })
        }
      })
      await pipeline(body, createWriteStream(archive))
      this.progress(version, { phase: 'downloading', receivedBytes, totalBytes })

      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {})
      await ensureDir(directory)

      if (entry.package === 'appx') {
        this.progress(version, { phase: 'extracting', receivedBytes, totalBytes })
        await extractPackage(archive, directory)
        await fsp.rm(path.join(directory, 'AppxSignature.p7x'), { force: true }).catch(() => {})
        const manifest = await fsp.stat(path.join(directory, 'AppxManifest.xml')).catch(() => null)
        if (!manifest?.isFile()) {
          await fsp.rm(directory, { recursive: true, force: true }).catch(() => {})
          throw new Error('That package did not contain an app manifest.')
        }
        await fsp.rm(archive, { force: true }).catch(() => {})
      } else {
        await fsp.rename(archive, path.join(directory, 'package.msixvc'))
      }

      this.logger?.info('Downloaded a Bedrock version', { version, package: entry.package })
      const sizeBytes = await directorySize(directory)
      this.progress(version, { phase: 'done', receivedBytes: sizeBytes, totalBytes: sizeBytes, sizeBytes })
      return { version, package: entry.package, directory, sizeBytes }
    } catch (error) {
      await fsp.rm(archive, { force: true }).catch(() => {})
      const message = controller.signal.aborted ? 'The download was cancelled.' : error.message
      this.progress(version, { phase: controller.signal.aborted ? 'cancelled' : 'error', error: message })
      throw new Error(message)
    } finally {
      this.inFlight.delete(version)
    }
  }

  async remove(version) {
    const directory = path.resolve(this.versionDirectory(version))
    // A loose-file registration points straight at this folder: deleting it would
    // leave Windows with a broken Minecraft package.
    const state = await this.bedrockService.status().catch(() => null)
    const inUse = (state?.editions || []).find((edition) => {
      if (!edition.installLocation) return false
      const location = path.resolve(edition.installLocation)
      return location === directory || isPathInside(location, directory)
    })
    if (inUse) {
      throw new Error(
        `${inUse.name} is currently registered from this folder. Uninstall it in Windows Settings first, then remove the files.`,
      )
    }
    await fsp.rm(directory, { recursive: true, force: true })
    this.logger?.info('Removed a Bedrock version', { version })
    return { version }
  }

  /** Framework packages the downloaded build declares, as written in its manifest. */
  async dependencies(version) {
    const directory = this.versionDirectory(version)
    const manifest = path.join(directory, 'AppxManifest.xml')
    const xml = await fsp.readFile(manifest, 'utf8').catch(() => null)
    if (xml == null) throw new Error('Download that version first.')
    return parsePackageDependencies(xml)
  }

  /** Declared dependencies that this Windows install does not satisfy. */
  async missingDependencies(version) {
    const dependencies = await this.dependencies(version)
    if (!dependencies.length) return []
    const installed = await this.installedPackages()
    return dependencies.filter((dependency) => {
      const have = installed.get(dependency.name.toLowerCase())
      return !have || comparePackageVersions(have, dependency.minVersion) < 0
    })
  }

  /** Installed package name to version, cached briefly because the query is slow. */
  async installedPackages() {
    const now = Date.now()
    if (this.installedCache && now - this.installedCache.at < INSTALLED_TTL_MS) return this.installedCache.packages
    const result = await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-AppxPackage | ForEach-Object { $_.Name + ' ' + $_.Version.ToString() }",
    ], { timeout: 60000 })
    const packages = new Map()
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const match = /^(\S+)\s+(\d+(?:\.\d+)*)$/.exec(line.trim())
      if (match) packages.set(match[1].toLowerCase(), match[2])
    }
    this.installedCache = { at: now, packages }
    return packages
  }

  async openFolder(version) {
    const directory = this.versionDirectory(version)
    const stat = await fsp.stat(directory).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('That version has not been downloaded yet.')
    return directory
  }

  /** The exact command Windows needs to register an unpacked build. */
  async registerCommand(version) {
    const entry = await this.findVersion(version)
    if (entry && entry.package !== 'appx') {
      throw new Error('MSIXVC builds install through Windows instead. Use Install build.')
    }
    const directory = this.versionDirectory(version)
    const manifest = path.join(directory, 'AppxManifest.xml')
    const stat = await fsp.stat(manifest).catch(() => null)
    if (!stat?.isFile()) throw new Error('Download that version first.')
    return {
      manifest,
      command: `Add-AppxPackage -Path "${manifest}" -Register -ForceApplicationShutdown`,
    }
  }

  /**
   * Installs a downloaded MSIXVC build. Those packages are encrypted Store
   * containers with no manifest to point at, so Windows has to deploy them — which
   * replaces the copy it is currently running.
   *
   * Deployment deliberately runs unelevated: an administrator prompt would install
   * the build for the administrator's account instead of the player's, exactly as
   * with registration.
   */
  async install(version) {
    if (process.platform !== 'win32') throw new Error('Installing a Bedrock build needs Windows.')
    const entry = await this.findVersion(version)
    if (entry && entry.package !== 'msixvc') {
      throw new Error('That build unpacks into a folder. Register it instead of installing it.')
    }

    const file = path.join(this.versionDirectory(version), 'package.msixvc')
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) throw new Error('Download that version first.')

    const before = await this.bedrockService.status({ force: true }).catch(() => null)
    const replacedVersion = before?.editions?.[0]?.version || null
    // Windows refuses an older package unless replacing the newer one is explicit.
    const downgrade = replacedVersion ? compareVersions(replacedVersion, version) < 0 : false
    const command = `Add-AppxPackage -Path "${file}"${downgrade ? ' -ForceUpdateFromAnyVersion' : ''}`

    this.progress(version, { phase: 'installing', receivedBytes: 0, totalBytes: null })
    const result = await this.run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference = 'Stop'; ${command}`,
      ],
      { timeout: 60 * 60 * 1000 },
    )

    // The framework list is only meaningful for the build Windows is running.
    this.installedCache = null
    const after = await this.bedrockService.status({ force: true }).catch(() => null)
    const installed = after?.editions?.[0] || null
    // Windows renumbers some packages, so a listed Minecraft plus a clean exit is
    // the success signal; a served version match alone is the fallback.
    const applied = Boolean(installed) && (result.ok || installed.version === version)
    if (!applied) {
      const message = describeDeploymentFailure(result) || 'Windows did not install that build.'
      this.logger?.warn('Could not install a Bedrock build', { version, message })
      throw new Error(message)
    }

    this.logger?.info('Installed a Bedrock build', { version, replaced: replacedVersion, detected: installed.version })
    this.progress(version, { phase: 'done', receivedBytes: 0, totalBytes: null })
    return {
      version,
      file,
      command,
      replacedVersion,
      forcedDowngrade: downgrade,
      installedVersion: installed.version || null,
      packageVersion: installed.packageVersion || null,
      installLocation: installed.installLocation || null,
    }
  }

  /** The package name and version a downloaded build declares about itself. */
  async manifestIdentity(version) {
    const directory = this.versionDirectory(version)
    const xml = await fsp.readFile(path.join(directory, 'AppxManifest.xml'), 'utf8').catch(() => null)
    return { ...parseManifestIdentity(xml), directory }
  }

  /** The edition Windows currently lists for the build's package family. */
  async registeredState(identity) {
    const state = await this.bedrockService.status({ force: true }).catch(() => null)
    const editions = state?.editions || []
    const name = String(identity.name || '').toLowerCase()
    const edition = name
      ? editions.find((item) => String(item.packageName || '').toLowerCase() === name) || null
      : editions.find((item) => item.id === 'bedrock') || null
    return { editions, edition, developerMode: state?.developerMode ?? null }
  }

  /** Whether the listed edition really is the build that was just registered. */
  isRegisteredBuild(edition, identity, directory) {
    if (!edition) return false
    if (identity.version) return String(edition.packageVersion || '') === identity.version
    if (!edition.installLocation) return false
    const location = path.resolve(edition.installLocation)
    return location === directory || isPathInside(location, directory)
  }

  /** Windows updates its package database behind the deployment call, so re-ask. */
  async waitForRegistration(identity, directory, attempts = 3) {
    let state = await this.registeredState(identity)
    for (let attempt = 1; attempt < attempts && !this.isRegisteredBuild(state.edition, identity, directory); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      state = await this.registeredState(identity)
    }
    return state
  }

  /**
   * Windows keeps the copy it already has registered, so neither an older build
   * nor a second copy of the same version can take the package family over until
   * that registration is removed.
   */
  async removeRegistration(edition) {
    const name = String(edition?.packageName || '').replace(/[^A-Za-z0-9._-]/g, '')
    if (!name) {
      return { ok: false, stdout: '', stderr: '', message: 'Windows did not report the registered package name.' }
    }
    const result = await this.run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference = 'Stop'; Get-AppxPackage -Name '${name}' | Remove-AppxPackage`,
      ],
      { timeout: 15 * 60 * 1000 },
    )
    this.logger?.info('Removed the registered Bedrock package to make room for another build', {
      package: name,
      ok: result.ok,
    })
    return result
  }

  /**
   * Registers the unpacked build for this Windows account. With Developer Mode on
   * the deployment runs unelevated, as the signed-in user — which matters on a
   * standard-user PC, where an elevated prompt would run as somebody else and
   * register the build for the wrong account. Only if that fails does it fall back
   * to the approved administrator prompt.
   */
  async register(version, { ignoreMissingDependencies = false } = {}) {
    if (process.platform !== 'win32') throw new Error('Registering a Bedrock build needs Windows.')
    const { manifest, command } = await this.registerCommand(version)
    const identity = await this.manifestIdentity(version)

    let ignored = []
    let missing = await this.missingDependencies(version)
    if (missing.length) {
      if (!ignoreMissingDependencies) {
        throw new Error(
          `Windows is missing ${missing
            .map((dependency) => `${dependency.name} ${dependency.minVersion}`)
            .join(', ')}. Install Minecraft for Windows from the Microsoft Store to bring the frameworks with it, or register anyway to drop the requirement.`,
        )
      }
      ignored = await this.stripMissingDependencies(version)
      missing = await this.missingDependencies(version)
      if (missing.length) {
        throw new Error(`Windows is missing ${missing.map((dependency) => dependency.name).join(', ')}.`)
      }
    }

    // Windows refuses a build it already has at the same or a newer version and
    // keeps listing that copy afterwards, which reads as a silent failure, so the
    // registered copy goes first. That is what the confirmation describes: the
    // Store copy stops working until it is installed again.
    let replacedVersion = null
    const before = await this.registeredState(identity)
    if (before.edition && !this.isRegisteredBuild(before.edition, identity, identity.directory)) {
      const current = String(before.edition.packageVersion || '')
      const blocked = identity.version && current ? comparePackageVersions(current, identity.version) >= 0 : false
      if (blocked) {
        const currentLabel = before.edition.version || current
        if (before.developerMode === false) {
          throw new Error(
            `Windows already has Minecraft ${currentLabel} registered, and without Developer Mode registration runs as an administrator. Turn on Developer Mode, remove Minecraft in Windows Settings, then register this build.`,
          )
        }
        const removal = await this.removeRegistration(before.edition)
        if (!removal.ok) {
          throw new Error(
            `Windows has Minecraft ${currentLabel} registered and would not remove it (${describeDeploymentFailure(removal)}). Remove it in Windows Settings, then register again.`,
          )
        }
        replacedVersion = currentLabel
      }
    }

    this.progress(version, { phase: 'registering', receivedBytes: 0, totalBytes: null })
    let elevated = false
    let result = await this.run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 15 * 60 * 1000 },
    )

    if (!result.ok) {
      const first = describeDeploymentFailure(result)
      elevated = true
      result = await this.runElevated(version, manifest, command)
      if (!result.ok) {
        this.logger?.warn('Could not register a Bedrock build', { version, message: first })
        throw new Error(describeDeploymentFailure(result) || first)
      }
    }

    // Registration is only real once Windows lists this exact build: a Store or
    // earlier registered copy staying in the list is not a success.
    const state = await this.waitForRegistration(identity, identity.directory)
    if (!this.isRegisteredBuild(state.edition, identity, identity.directory)) {
      const detected = state.edition?.version || state.edition?.packageVersion || null
      this.logger?.warn('A Bedrock build was not registered', { version, detected })
      throw new Error(
        detected
          ? `Windows still lists Minecraft ${detected}, not this build. Remove it in Windows Settings, then register again.`
          : describeDeploymentFailure(result) ||
            'Windows did not list the build after registering it. Check Developer Mode and try again.',
      )
    }

    const registered = state.edition
    this.logger?.info('Registered a Bedrock build', {
      version,
      elevated,
      detected: registered.version,
      replaced: replacedVersion,
    })
    this.progress(version, { phase: 'done', receivedBytes: 0, totalBytes: null })
    return {
      version,
      manifest,
      command,
      elevated,
      ignoredDependencies: ignored,
      replacedVersion,
      registeredVersion: registered.version || null,
      packageVersion: registered.packageVersion || null,
    }
  }

  /**
   * Old builds declare frameworks that current Windows no longer ships. Loose-file
   * registration does not need them, so the requirements can be dropped from the
   * build's own manifest; the game keeps a backup to restore from.
   */
  async stripMissingDependencies(version) {
    const missing = await this.missingDependencies(version)
    if (!missing.length) return []
    const manifestPath = path.join(this.versionDirectory(version), 'AppxManifest.xml')
    const xml = await fsp.readFile(manifestPath, 'utf8').catch(() => null)
    if (xml == null) return []
    let next = xml
    for (const dependency of missing) {
      const escaped = dependency.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      next = next.replace(new RegExp(`\\s*<PackageDependency\\b[^>]*Name="${escaped}"[^>]*/>`, 'g'), '')
    }
    if (next === xml) return []
    await fsp.writeFile(`${manifestPath}.bak`, xml, 'utf8')
    await fsp.writeFile(manifestPath, next, 'utf8')
    this.logger?.info('Dropped unavailable framework requirements', {
      version,
      names: missing.map((dependency) => dependency.name),
    })
    return missing.map((dependency) => dependency.name)
  }

  /**
   * The administrator path, for PCs without Developer Mode. The window's exit
   * code and transcript come back, because the elevated process is what fails —
   * the launcher's own Start-Process call succeeds either way.
   */
  async runElevated(version, manifest, command) {
    const directory = path.dirname(manifest)
    const scriptPath = path.join(directory, 'register.ps1')
    const logPath = path.join(directory, 'register.log')
    await fsp.writeFile(
      scriptPath,
      [
        '$ErrorActionPreference = "Stop"',
        `Start-Transcript -Path "${logPath}" -Force | Out-Null`,
        'try {',
        `  Write-Host "Registering Bedrock ${version}..."`,
        '  Write-Host "This replaces the Microsoft Store copy of Minecraft for Windows for this account."',
        '  Write-Host "To undo it, open the Microsoft Store, find Minecraft for Windows under Library, and install it again."',
        `  ${command}`,
        '  Write-Host "Done. Aqua can now launch this build."',
        '  Start-Sleep -Seconds 4',
        '  Stop-Transcript | Out-Null',
        '  exit 0',
        '} catch {',
        '  Write-Host "Registration failed: $($_.Exception.Message)"',
        '  Start-Sleep -Seconds 8',
        '  Stop-Transcript | Out-Null',
        '  exit 1',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    const quoted = scriptPath.replace(/'/g, "''")
    const wrapper = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${quoted}')`,
      '  exit [int]$p.ExitCode',
      '} catch {',
      '  [Console]::Error.WriteLine($_.Exception.Message)',
      '  exit 1',
      '}',
    ].join('\n')
    const result = await this.run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', wrapper],
      { timeout: 15 * 60 * 1000 },
    )
    // The transcript is where Windows writes the deployment error, and the
    // elevated window's own output never reaches this process.
    const transcript = await fsp.readFile(logPath, 'utf8').catch(() => '')
    return { ...result, stdout: `${result.stdout || ''}\n${transcript}`.trim() }
  }
}

async function directorySize(root) {
  let total = 0
  const walk = async (current, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
      } else if (entry.isFile()) {
        const stat = await fsp.stat(entryPath).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }
  await walk(root, 0)
  return total
}

export { CHANNELS, UWP_CATALOG_URL, GDK_CATALOG_URL }
