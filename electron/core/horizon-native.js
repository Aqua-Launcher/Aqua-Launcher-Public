import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { downloadFiles } from './downloader.js'
import { readHorizonModManifest, sha256File } from './horizon.js'
import { ensureDir, fetchJson, fetchWithRetry, fileExists, formatBytes, isPathInside, randomId } from './util.js'

/**
 * Horizon's native mods are Rust source mixins compiled into the game. Horizon's
 * own launcher does the build itself; Aqua runs the same steps with the Rust
 * toolchain already installed on this computer:
 *
 * 1. Horizon's source at the pinned commit (codeload archive, cached),
 * 2. horizon-mixins built once for the commit the mods name,
 * 3. `horizon-mixins apply` over that source,
 * 4. `cargo build --locked --profile fast --features horizon-client/mods`,
 * 5. a new Horizon version holding the built client and the base build's resources.
 *
 * Nothing is downloaded except the source, the crates and the mod's own files.
 */
export const HORIZON_REPO = 'horizon-rust/horizon'
export const HORIZON_MIXINS_GIT = 'https://github.com/horizon-rust/horizon-mixins'
/** horizon-mixins' revision, for bundles that do not name one. */
export const HORIZON_MIXINS_REV = 'ddd9700b21997c95d95ac6ee5ecafe3830cf622a'
export const HORIZON_NATIVE_TAG = /^native-[0-9a-f]{7}-[0-9a-f]{12}$/
export const HORIZON_NATIVE_FEATURE = 'horizon-client/mods'
export const RUSTUP_DIST_URL = 'https://static.rust-lang.org/rustup/dist'

const REVISION = /^[0-9a-f]{40}$/
const BUILD_TIMEOUT_MS = 120 * 60 * 1000
const TOOL_TIMEOUT_MS = 30 * 60 * 1000
const CARGO_LINE = /^\s*(Compiling|Building|Finished|error|warning:)/i
const CARGO_PROGRESS = /Building\s*\[[^\]]*\]\s*(\d+)\/(\d+)/

const RUSTUP_TARGETS = {
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
}

/** The rustup-init build for this computer. */
export function rustupTarget(platform, arch) {
  const target = RUSTUP_TARGETS[platform]?.[arch]
  if (!target) throw new Error(`Rust cannot be downloaded automatically for ${platform} ${arch}.`)
  return target
}

/**
 * Windows has two Rust ABIs: MSVC when Visual Studio's C++ tools are present,
 * otherwise GNU, which needs no Visual Studio for basic crates.
 */
export function rustDefaultHost({ platform, arch, hasMsvc = false }) {
  const target = rustupTarget(platform, arch)
  if (platform === 'win32' && arch === 'x64' && !hasMsvc) return 'x86_64-pc-windows-gnu'
  return target
}

/** rustup publishes `<digest>  rustup-init[.exe]` beside every installer. */
export function rustupChecksum(text) {
  const match = String(text ?? '').match(/\b[0-9a-fA-F]{64}\b/)
  if (!match) throw new Error('Rust’s checksum file did not hold a SHA-256 digest.')
  return match[0].toLowerCase()
}

export function rustupDownloadUrls(target) {
  const name = `rustup-init${String(target).includes('windows') ? '.exe' : ''}`
  const init = `${RUSTUP_DIST_URL}/${target}/${name}`
  return { init, checksum: `${init}.sha256` }
}

function abortError(message = 'Build cancelled.') {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

export function horizonSourceUrl(revision) {
  const value = String(revision ?? '').trim()
  if (!REVISION.test(value)) throw new Error('That Horizon revision is invalid.')
  return `https://codeload.github.com/${HORIZON_REPO}/tar.gz/${value}`
}

/**
 * Which Horizon commit and horizon-mixins commit a set of native mods builds on.
 * The mods' pins win when they agree; otherwise the commit of the release the
 * build starts from is used, as Horizon's launcher does.
 */
export function nativeBuildPlan({ mods, gameCommit = null }) {
  const horizonPins = [...new Set(mods.map((mod) => mod.horizon).filter(Boolean))]
  if (horizonPins.length > 1) {
    throw new Error(
      `Those native mods were made for different Horizon revisions (${horizonPins
        .map((revision) => revision.slice(0, 7))
        .join(', ')}). Install versions made for the same one.`,
    )
  }
  const mixinsPins = [...new Set(mods.map((mod) => mod.mixins).filter(Boolean))]
  if (mixinsPins.length > 1) {
    throw new Error(
      `Those native mods need different horizon-mixins revisions (${mixinsPins
        .map((revision) => revision.slice(0, 7))
        .join(', ')}). Install versions made for the same one.`,
    )
  }
  const revision = horizonPins[0] || gameCommit
  if (!REVISION.test(String(revision ?? ''))) {
    throw new Error('Aqua could not tell which Horizon commit these mods build on.')
  }
  return { revision, mixins: mixinsPins[0] || HORIZON_MIXINS_REV }
}

/** The version folder name: `native-<7 of the revision>-<12 of the build key>`. */
export function nativeBuildKey({ revision, mixins, profile, mods }) {
  const digest = crypto.createHash('sha256')
  digest.update(
    JSON.stringify({
      revision,
      mixins,
      profile,
      mods: [...mods].sort((a, b) => a.id.localeCompare(b.id)).map((mod) => ({ id: mod.id, sha256: mod.sha256 })),
    }),
  )
  return digest.digest('hex').slice(0, 12)
}

export function nativeBuildTag({ revision, key }) {
  if (!REVISION.test(String(revision ?? ''))) throw new Error('That Horizon revision is invalid.')
  return `native-${String(revision).slice(0, 7)}-${key}`
}

/** `fast` is the workspace's own profile; older revisions only have `release`. */
export function nativeProfileFor(cargoToml) {
  return /^\s*\[profile\.fast\]/m.test(String(cargoToml ?? '')) ? 'fast' : 'release'
}

function addHorizonRevision(toml, revision) {
  const text = String(toml ?? '')
  const lines = text.split(/\r?\n/)
  const compatibility = lines.findIndex((line) => /^\s*\[compatibility\]\s*(?:#.*)?$/.test(line))
  if (compatibility < 0) {
    const trimmed = text.trimEnd()
    return `${trimmed}${trimmed ? '\n\n' : ''}[compatibility]\nhorizon_revision = "${revision}"\n`
  }

  let end = lines.findIndex((line, index) => index > compatibility && /^\s*\[/.test(line))
  if (end < 0) end = lines.length
  if (lines.slice(compatibility + 1, end).some((line) => /^\s*horizon_revision\s*=/.test(line))) return text

  lines.splice(compatibility + 1, 0, `horizon_revision = "${revision}"`)
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n')
}

/**
 * Copies each installed `.hnmod`'s `mixins/<id>/` tree into a mods folder
 * horizon-mixins reads, one folder per mod.
 */
export async function stageNativeMods(mods, destination, { signal, horizonRevision } = {}) {
  await fsp.rm(destination, { recursive: true, force: true })
  await ensureDir(destination)
  for (const mod of mods) {
    if (signal?.aborted) throw abortError()
    if (!/^[a-z0-9_]{1,64}$/.test(mod.id)) throw new Error('That native mod has an invalid id.')
    const directory = path.join(destination, mod.id)
    const zip = new AdmZip(mod.filePath)
    const prefix = `mixins/${mod.id}/`
    let written = 0
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const name = String(entry.entryName ?? '').replace(/\\/g, '/')
      if (!name.startsWith(prefix)) continue
      const relative = name.slice(prefix.length)
      if (!relative || relative.split('/').includes('..') || relative.includes('\0')) {
        throw new Error(`${mod.id} contains an unsafe path.`)
      }
      const target = path.resolve(directory, relative)
      if (!isPathInside(target, directory)) throw new Error(`${mod.id} escapes its mod folder.`)
      await ensureDir(path.dirname(target))
      await fsp.writeFile(target, entry.getData())
      written += 1
    }
    const manifestPath = path.join(directory, 'horizon-mixin.toml')
    if (!written || !(await fileExists(manifestPath))) {
      throw new Error(`${mod.id} does not contain the mixins Horizon's build expects.`)
    }
    const revision = mod.horizon || horizonRevision
    if (!REVISION.test(String(revision ?? ''))) throw new Error(`${mod.id} has no valid Horizon revision to pin.`)
    const manifest = await fsp.readFile(manifestPath, 'utf8')
    await fsp.writeFile(manifestPath, addHorizonRevision(manifest, revision))
  }
}

async function normalizeWorkspaceSymlinks(root) {
  const realRoot = await fsp.realpath(root)
  const links = []
  const collect = async (directory) => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) links.push(target)
      else if (entry.isDirectory()) await collect(target)
    }
  }
  await collect(root)

  const replacements = []
  for (const link of links) {
    const target = await fsp.realpath(link)
    const realLink = path.join(await fsp.realpath(path.dirname(link)), path.basename(link))
    if (!isPathInside(target, realRoot) || path.resolve(target) === path.resolve(realRoot)) {
      throw new Error(`Horizon source symlink escapes its workspace: ${path.relative(root, link)}`)
    }
    const stats = await fsp.stat(target)
    if (!stats.isFile() && !stats.isDirectory()) {
      throw new Error(`Horizon source symlink has an unsupported target: ${path.relative(root, link)}`)
    }
    if (stats.isDirectory() && isPathInside(realLink, target)) {
      throw new Error(`Horizon source symlink creates a directory cycle: ${path.relative(root, link)}`)
    }
    replacements.push({ link, target })
  }

  for (const { link, target } of replacements) {
    await fsp.rm(link, { recursive: true, force: true })
    await fsp.cp(target, link, { recursive: true, dereference: true })
  }
}

async function pinWorkspaceRevision(root, revision) {
  await fsp.writeFile(path.join(root, '.horizon-revision'), `${revision}\n`)
}

export class HorizonNativeBuilder {
  constructor({
    paths,
    horizonService,
    logger = null,
    store = null,
    emitProgress = null,
    emitNotification = null,
    emitActivity = null,
    spawnImpl = spawn,
    fetchJsonImpl = fetchJson,
    downloadFilesImpl = downloadFiles,
    platform = process.platform,
    arch = process.arch,
    fetchTextImpl = null,
    hasMsvcImpl = null,
  } = {}) {
    this.paths = paths
    this.horizonService = horizonService
    this.logger = logger
    this.store = store
    this.emitProgress = emitProgress
    this.emitNotification = emitNotification
    this.emitActivity = emitActivity
    this.spawnImpl = spawnImpl
    this.fetchJsonImpl = fetchJsonImpl
    this.downloadFilesImpl = downloadFilesImpl
    this.platform = platform
    this.arch = arch
    this.fetchTextImpl = fetchTextImpl || ((url, signal) => this.fetchText(url, signal))
    this.hasMsvcImpl = hasMsvcImpl
    this.job = null
    this.abort = null
    this.child = null
    this.rustCache = null
    this.revisionCache = new Map()
  }

  nativeRoot() {
    if (!this.paths?.horizonRoot) throw new Error('Horizon storage is not configured.')
    return path.join(this.paths.horizonRoot, 'native')
  }

  /** Rust lives inside Aqua's own folder, never in the user's profile or PATH. */
  rustPaths() {
    const root = path.join(this.nativeRoot(), 'toolchain')
    const exe = this.platform === 'win32' ? '.exe' : ''
    const cargoHome = path.join(root, 'cargo')
    return {
      root,
      cargoHome,
      rustupHome: path.join(root, 'rustup'),
      downloads: path.join(root, 'downloads'),
      installer: path.join(root, 'downloads', `rustup-init${exe}`),
      cargo: path.join(cargoHome, 'bin', `cargo${exe}`),
    }
  }

  rustEnv() {
    const paths = this.rustPaths()
    const env = this.toolEnv()
    const bin = path.dirname(paths.cargo)
    env.CARGO_HOME = paths.cargoHome
    env.RUSTUP_HOME = paths.rustupHome
    env.PATH = `${bin}${path.delimiter}${env.PATH || env.Path || ''}`
    if (this.platform === 'win32') env.Path = env.PATH
    return env
  }

  async fetchText(url, signal) {
    const response = await fetchWithRetry(
      url,
      { signal },
      { attempts: 3, timeoutMs: 30_000, logger: this.logger },
    )
    return response.text()
  }

  async hasMsvcToolchain() {
    if (this.platform !== 'win32') return false
    if (process.env.VCINSTALLDIR) return true
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
    for (const root of roots) {
      const vswhere = path.join(root, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
      if (!(await fileExists(vswhere))) continue
      try {
        const result = await this.runProcess(
          vswhere,
          [
            '-latest',
            '-products',
            '*',
            '-requires',
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
            '-property',
            'installationPath',
          ],
          { timeoutMs: 20_000, env: this.toolEnv() },
        )
        if (String(result.stdout ?? '').trim()) return true
      } catch {
        // Try the next install, then fall back to the GNU toolchain.
      }
    }
    return false
  }

  publicJob(job) {
    return { ...job, cancelRequested: undefined }
  }

  updateJob(job, patch) {
    Object.assign(job, patch)
    if (job.logTail && job.logTail.length > 200) job.logTail = job.logTail.slice(-200)
    this.emitProgress?.(this.publicJob(job))
  }

  async detectRust() {
    const now = Date.now()
    if (this.rustCache && now - this.rustCache.at < 60_000) return this.rustCache.value
    const paths = this.rustPaths()
    let failure = null
    if (await fileExists(paths.cargo)) {
      try {
        const result = await this.runProcess(paths.cargo, ['--version'], {
          timeoutMs: 20_000,
          env: this.rustEnv(),
        })
        const version = String(result.stdout ?? '')
          .trim()
          .split(/\r?\n/)[0]
        const value = {
          available: true,
          version: version || null,
          error: null,
          source: 'aqua',
          canDownload: false,
        }
        this.rustCache = { at: now, value }
        return value
      } catch (error) {
        failure = error
      }
    }
    try {
      const result = await this.runProcess('cargo', ['--version'], { timeoutMs: 20_000, env: this.toolEnv() })
      const version = String(result.stdout ?? '')
        .trim()
        .split(/\r?\n/)[0]
      const value = {
        available: true,
        version: version || null,
        error: null,
        source: 'system',
        canDownload: false,
      }
      this.rustCache = { at: now, value }
      return value
    } catch (error) {
      if (!failure || error?.code !== 'ENOENT') failure = error
    }
    let canDownload = true
    let downloadError = null
    try {
      rustupTarget(this.platform, this.arch)
    } catch (error) {
      canDownload = false
      downloadError = error.message
    }
    const checked = failure && failure.code !== 'ENOENT' ? `Rust could not be checked: ${failure.message}` : null
    const value = {
      available: false,
      version: null,
      error: canDownload ? checked : downloadError,
      source: null,
      canDownload,
    }
    this.rustCache = { at: now, value }
    return value
  }

  /** Downloads and installs Rust into Aqua, or reuses a working toolchain. */
  async ensureRust(job, signal) {
    const detected = await this.detectRust()
    if (detected.available) {
      return {
        cargo: detected.source === 'aqua' ? this.rustPaths().cargo : 'cargo',
        env: detected.source === 'aqua' ? this.rustEnv() : this.toolEnv(),
        source: detected.source,
        version: detected.version,
      }
    }
    return this.installRust(job, signal)
  }

  rustLines(job) {
    if (!Array.isArray(job.logTail)) job.logTail = []
    return (line) => {
      job.logTail.push(line)
      if (/^info:.*(download|install|default|toolchain)/i.test(line) || /^(warn|error)/i.test(line)) {
        this.updateJob(job, { message: line.replace(/^info:\s*/i, '').slice(0, 300) })
      } else if (job.logTail.length % 10 === 0) {
        this.updateJob(job, {})
      }
    }
  }

  async installRust(job, signal) {
    const target = rustupTarget(this.platform, this.arch)
    const host = rustDefaultHost({
      platform: this.platform,
      arch: this.arch,
      hasMsvc: this.hasMsvcImpl ? await this.hasMsvcImpl() : await this.hasMsvcToolchain(),
    })
    const urls = rustupDownloadUrls(target)
    const paths = this.rustPaths()
    await ensureDir(paths.downloads)
    await ensureDir(paths.cargoHome)
    await ensureDir(paths.rustupHome)

    this.updateJob(job, {
      stage: 'Downloading Rust',
      message: 'Checking the installer’s checksum',
      indeterminate: true,
    })
    let digest
    try {
      digest = rustupChecksum(await this.fetchTextImpl(urls.checksum, signal))
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw new Error(`Rust’s checksum could not be read: ${error.message}`)
    }

    const valid = async () =>
      (await fileExists(paths.installer)) && (await sha256File(paths.installer)) === digest
    if (!(await valid())) {
      await fsp.rm(paths.installer, { force: true }).catch(() => {})
      this.updateJob(job, {
        stage: 'Downloading Rust',
        message: 'rustup installer · about 10 MB',
        indeterminate: true,
      })
      await this.downloadFilesImpl(
        [{ url: urls.init, destination: paths.installer, sha1: null, size: null }],
        {
          concurrency: 1,
          attempts: 3,
          root: paths.downloads,
          logger: this.logger,
          signal,
          onProgress: (progress) => {
            this.updateJob(job, {
              message: `${formatBytes(progress.bytesDone || 0)}${
                progress.bytesTotal ? ` of ${formatBytes(progress.bytesTotal)}` : ''
              }`,
            })
          },
        },
      )
    }
    if (!(await valid())) {
      await fsp.rm(paths.installer, { force: true }).catch(() => {})
      throw new Error('The Rust installer failed its checksum check, so Aqua did not run it.')
    }
    await fsp.chmod(paths.installer, 0o755).catch(() => {})
    if (signal?.aborted) throw abortError()

    this.updateJob(job, {
      stage: 'Installing Rust',
      message: `stable · ${host.includes('gnu') ? 'GNU' : 'MSVC'} toolchain · about 600 MB on disk`,
      indeterminate: true,
    })
    const args = ['-y', '--no-modify-path', '--profile', 'minimal', '--default-toolchain', 'stable']
    if (this.platform === 'win32') args.push('--default-host', host)
    try {
      await this.runProcess(paths.installer, args, {
        cwd: paths.root,
        env: this.rustEnv(),
        signal,
        timeoutMs: TOOL_TIMEOUT_MS,
        onLine: this.rustLines(job),
      })
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError()
      throw new Error(`Rust could not be installed: ${error.message}`)
    }
    if (!(await fileExists(paths.cargo))) throw new Error('Rust finished installing without cargo.')
    this.rustCache = null
    const installed = await this.detectRust()
    if (!installed.available) throw new Error('Rust was installed, but cargo could not be started.')
    this.logger?.info('Rust toolchain installed for native builds', { host, version: installed.version })
    return {
      cargo: paths.cargo,
      env: this.rustEnv(),
      source: 'aqua',
      version: installed.version,
    }
  }

  /** Enabled native mods, read from the files Horizon will load. */
  async enabledNativeMods() {
    const directories = this.horizonService.modsDirectories()
    const listed = await this.horizonService.listMods()
    const mods = []
    for (const mod of listed.mods) {
      if (mod.kind !== 'native' || !mod.enabled) continue
      const filePath = path.join(directories.native, mod.filename)
      const manifest = await readHorizonModManifest(filePath, 'native')
      if (!manifest?.id) continue
      mods.push({
        id: manifest.id,
        filePath,
        filename: mod.filename,
        title: mod.title,
        horizon: manifest.horizon || null,
        mixins: manifest.mixins || null,
        hooks: manifest.hooks || null,
        sha256: await sha256File(filePath).catch(() => null),
      })
    }
    return mods
  }

  async status() {
    const active =
      this.job && (this.job.status === 'running' || this.job.status === 'cancelling')
        ? this.publicJob(this.job)
        : null
    const rust = await this.detectRust()
    let mods = []
    let builds = []
    let gameVersion = null
    try {
      mods = await this.enabledNativeMods()
    } catch (error) {
      this.logger?.warn('Could not read native mods', { message: error.message })
    }
    try {
      const horizon = await this.horizonService.status({ force: true })
      builds = horizon.builds
      gameVersion = horizon.gameVersion
    } catch (error) {
      this.logger?.warn('Could not read Horizon builds', { message: error.message })
    }
    const base = builds.find((build) => !build.native) || null
    let reason = null
    if (active) reason = 'A native build is already running.'
    else if (!rust.available && !rust.canDownload) reason = rust.error
    else if (!mods.length) reason = 'Turn on at least one native mod before building.'
    else if (!base) reason = 'Install a Horizon release before building native mods.'
    return {
      rust,
      enabledNativeMods: mods.length,
      baseTag: base?.tag || null,
      baseBuilds: builds.filter((build) => build.native).length,
      gameVersion,
      canBuild: !reason,
      reason,
      job: active,
    }
  }

  async build({ profile = null } = {}) {
    if (this.job && (this.job.status === 'running' || this.job.status === 'cancelling')) {
      throw new Error('A native build is already running.')
    }
    if (profile && profile !== 'fast' && profile !== 'release') throw new Error('Unknown build profile.')
    const status = await this.status()
    if (!status.canBuild) throw new Error(status.reason || 'This Horizon build cannot be made right now.')
    const job = {
      id: randomId(),
      type: 'horizon-native',
      status: 'running',
      stage: 'Preparing the build',
      message: null,
      profile,
      revision: null,
      mixins: null,
      tag: null,
      mods: status.enabledNativeMods,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      progress: null,
      logTail: [],
    }
    this.job = job
    this.abort = new AbortController()
    this.updateJob(job, {})
    void this.runBuild(job, this.abort.signal)
    return this.publicJob(job)
  }

  async cancel() {
    if (!this.job || (this.job.status !== 'running' && this.job.status !== 'cancelling')) {
      throw new Error('No native build is running.')
    }
    this.job.cancelRequested = true
    this.updateJob(this.job, { status: 'cancelling', stage: 'Cancelling the build', message: null })
    this.abort?.abort()
    this.killChild()
    return this.publicJob(this.job)
  }

  dispose() {
    this.abort?.abort()
    this.killChild()
  }

  killChild() {
    const child = this.child
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // The process may already be gone.
    }
  }

  runProcess(program, args, { cwd, env, signal, timeoutMs = BUILD_TIMEOUT_MS, onLine } = {}) {
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
      this.child = child
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer = null
      const finish = (error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (this.child === child) this.child = null
        if (error) reject(error)
        else resolve({ stdout, stderr })
      }
      const onAbort = () => {
        killTree(child)
        finish(abortError())
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        killTree(child)
        finish(new Error(`${path.basename(program)} did not finish in time.`))
      }, timeoutMs)
      const wire = (stream) => {
        if (!stream) return
        const reader = readline.createInterface({ input: stream })
        reader.on('line', (line) => {
          const text = line.trim()
          if (!text) return
          onLine?.(text)
        })
      }
      wire(child.stdout)
      wire(child.stderr)
      child.stdout?.on('data', (chunk) => {
        stdout = `${stdout}${chunk.toString()}`.slice(-200_000)
      })
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-200_000)
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (signal?.aborted) return finish(abortError())
        if (code === 0) return finish(null)
        const detail =
          stderr
            .trim()
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .slice(-4)
            .join(' ') || `exit code ${code}`
        return finish(new Error(`${path.basename(program)} failed: ${detail}`))
      })
    })
  }

  async fetchGameCommit(tag) {
    const cached = this.revisionCache.get(tag)
    if (cached) return cached
    const payload = await this.fetchJsonImpl(
      `https://api.github.com/repos/${HORIZON_REPO}/commits/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AquaLauncher/1.0.0',
        },
      },
      { attempts: 2, timeoutMs: 25_000, logger: this.logger },
    )
    const sha = String(payload?.sha ?? '').toLowerCase()
    if (!REVISION.test(sha)) throw new Error(`GitHub did not return the commit of Horizon ${tag}.`)
    this.revisionCache.set(tag, sha)
    return sha
  }

  async ensureSource(revision, job, signal) {
    const root = this.nativeRoot()
    const directory = path.join(root, 'source', revision.slice(0, 12))
    if (await fileExists(path.join(directory, 'Cargo.toml'))) {
      await normalizeWorkspaceSymlinks(directory)
      await pinWorkspaceRevision(directory, revision)
      return directory
    }
    const downloads = path.join(root, 'downloads')
    await ensureDir(downloads)
    const archive = path.join(downloads, `${revision}.tar.gz`)
    if (!(await fileExists(archive))) {
      this.updateJob(job, {
        stage: 'Downloading Horizon’s source',
        message: `${revision.slice(0, 7)} · about 63 MB once unpacked`,
        indeterminate: true,
      })
      await this.downloadFilesImpl([{ url: horizonSourceUrl(revision), destination: archive, sha1: null, size: null }], {
        concurrency: 1,
        attempts: 3,
        root: downloads,
        logger: this.logger,
        signal,
        onProgress: (progress) => {
          this.updateJob(job, {
            message: `${formatBytes(progress.bytesDone || 0)}${
              progress.bytesTotal ? ` of ${formatBytes(progress.bytesTotal)}` : ''
            }`,
          })
        },
      })
    }
    if (signal?.aborted) throw abortError()
    const temporary = path.join(root, `source-unpack-${randomId()}`)
    await ensureDir(temporary)
    try {
      await this.runProcess('tar', ['-xzf', archive, '-C', temporary], {
        signal,
        timeoutMs: 10 * 60 * 1000,
      })
      const entries = (await fsp.readdir(temporary, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
      )
      if (entries.length !== 1) throw new Error('The Horizon source archive did not hold one folder.')
      const unpacked = path.join(temporary, entries[0].name)
      if (!(await fileExists(path.join(unpacked, 'Cargo.toml')))) {
        throw new Error('The Horizon source archive did not hold the game’s Cargo.toml.')
      }
      await normalizeWorkspaceSymlinks(unpacked)
      await pinWorkspaceRevision(unpacked, revision)
      await fsp.rm(directory, { recursive: true, force: true })
      await ensureDir(path.dirname(directory))
      await fsp.rename(unpacked, directory).catch(async () => {
        await fsp.cp(unpacked, directory, { recursive: true, force: true })
      })
      return directory
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {})
    }
  }

  async ensureMixinsTool(mixins, job, signal, rust) {
    const directory = path.join(this.nativeRoot(), 'tools', mixins.slice(0, 12))
    const binary = path.join(directory, 'bin', this.platform === 'win32' ? 'horizon-mixins.exe' : 'horizon-mixins')
    if (await fileExists(binary)) return binary
    this.updateJob(job, {
      stage: 'Building horizon-mixins',
      message: `${mixins.slice(0, 7)} · once per revision, a few minutes`,
      indeterminate: true,
    })
    await this.runProcess(
      rust.cargo,
      ['install', '--locked', '--git', HORIZON_MIXINS_GIT, '--rev', mixins, '--root', directory, 'horizon-mixins-cli'],
      { cwd: this.workingDirectory(), signal, timeoutMs: TOOL_TIMEOUT_MS, env: rust.env },
    )
    if (!(await fileExists(binary))) throw new Error('horizon-mixins did not produce its binary.')
    return binary
  }

  workingDirectory() {
    const directory = path.join(this.nativeRoot(), 'cargo-work')
    return directory
  }

  toolEnv() {
    const env = {
      ...process.env,
      CARGO_TERM_COLOR: 'never',
      CARGO_TERM_PROGRESS_WHEN: 'always',
      CARGO_TERM_PROGRESS_WIDTH: '80',
    }
    for (const key of Object.keys(env)) {
      if (/^(RUSTFLAGS|RUSTDOCFLAGS|CARGO_INCREMENTAL|CARGO_BUILD_|CARGO_PROFILE_|CARGO_TARGET_|RUSTC_WRAPPER)/.test(key)) {
        delete env[key]
      }
    }
    return env
  }

  cargoLines(job) {
    let last = 0
    return (line) => {
      if (!CARGO_LINE.test(line)) {
        const progress = line.match(CARGO_PROGRESS)
        if (progress) {
          const done = Number(progress[1])
          const total = Number(progress[2])
          if (total > 0 && Date.now() - last > 400) {
            last = Date.now()
            this.updateJob(job, {
              message: `${done} of ${total} crates`,
              progress: Math.max(1, Math.min(99, Math.round((done / total) * 100))),
            })
          }
        }
        return
      }
      job.logTail.push(line)
      if (/^error/i.test(line)) this.updateJob(job, { message: line.slice(0, 300) })
      else if (job.logTail.length % 5 === 0) this.updateJob(job, {})
    }
  }

  async runBuild(job, signal) {
    const roots = this.nativeRoot()
    await ensureDir(roots)
    await ensureDir(this.workingDirectory())
    let destination = null
    let staged = null
    try {
      const mods = await this.enabledNativeMods()
      if (!mods.length) throw new Error('Turn on at least one native mod before building.')
      const status = await this.horizonService.status({ force: true })
      const base = status.builds.find((build) => !build.native)
      if (!base) throw new Error('Install a Horizon release before building native mods.')

      let plan
      if (mods.every((mod) => mod.horizon)) {
        plan = nativeBuildPlan({ mods })
      } else {
        this.updateJob(job, { stage: 'Finding the Horizon commit', message: base.tag })
        const gameCommit = await this.fetchGameCommit(base.tag)
        plan = nativeBuildPlan({ mods, gameCommit })
      }
      const rust = await this.ensureRust(job, signal)
      if (signal?.aborted) throw abortError()
      this.updateJob(job, {
        revision: plan.revision,
        mixins: plan.mixins,
        stage: 'Preparing Horizon’s source',
        message: `${plan.revision.slice(0, 7)} · ${base.tag}`,
        indeterminate: true,
      })
      const source = await this.ensureSource(plan.revision, job, signal)
      if (signal?.aborted) throw abortError()

      const cargoToml = await fsp.readFile(path.join(source, 'Cargo.toml'), 'utf8').catch(() => '')
      const profile = job.profile || nativeProfileFor(cargoToml)
      const key = nativeBuildKey({ revision: plan.revision, mixins: plan.mixins, profile, mods })
      const tag = nativeBuildTag({ revision: plan.revision, key })
      this.updateJob(job, { profile, tag })

      const modsDirectory = path.join(roots, 'mods', key)
      this.updateJob(job, {
        stage: 'Staging native mods',
        message: mods.map((mod) => mod.title).join(', ').slice(0, 300),
      })
      await stageNativeMods(mods, modsDirectory, { signal, horizonRevision: plan.revision })

      const tool = await this.ensureMixinsTool(plan.mixins, job, signal, rust)
      if (signal?.aborted) throw abortError()

      staged = path.join(roots, 'stage', key)
      await fsp.rm(staged, { recursive: true, force: true })
      await ensureDir(path.dirname(staged))
      this.updateJob(job, {
        stage: 'Applying mixins',
        message: `${mods.length} mod${mods.length === 1 ? '' : 's'} · horizon-mixins ${plan.mixins.slice(0, 7)}`,
        progress: null,
      })
      await this.runProcess(
        tool,
        ['apply', '--workspace', source, '--mods', modsDirectory, '--out', staged],
        { cwd: this.workingDirectory(), signal, timeoutMs: TOOL_TIMEOUT_MS, env: rust.env },
      )
      if (signal?.aborted) throw abortError()

      const stagedCargo = await fsp.readFile(path.join(staged, 'Cargo.toml'), 'utf8').catch(() => '')
      const chosenProfile = nativeProfileFor(stagedCargo)
      if (chosenProfile !== profile) {
        // The mixins stage is the source the build compiles; its profile decides.
        this.updateJob(job, { profile: chosenProfile, tag: null })
        const stagedKey = nativeBuildKey({ revision: plan.revision, mixins: plan.mixins, profile: chosenProfile, mods })
        this.updateJob(job, { tag: nativeBuildTag({ revision: plan.revision, key: stagedKey }) })
      }
      const finalProfile = chosenProfile
      const finalKey = nativeBuildKey({ revision: plan.revision, mixins: plan.mixins, profile: finalProfile, mods })
      const finalTag = nativeBuildTag({ revision: plan.revision, key: finalKey })
      this.updateJob(job, { profile: finalProfile, tag: finalTag })

      const clientCargo = await fsp
        .readFile(path.join(staged, 'crates', 'horizon-client', 'Cargo.toml'), 'utf8')
        .catch(() => '')
      const args = ['build', '--locked', '--profile', finalProfile]
      if (/^\s*mods\s*=/m.test(clientCargo)) args.push('--features', HORIZON_NATIVE_FEATURE)
      args.push(
        '-p',
        'horizon-client',
        '--bin',
        'horizon-client',
        '--manifest-path',
        path.join(staged, 'Cargo.toml'),
        '--target-dir',
        path.join(roots, 'target'),
      )
      const config = path.join(staged, '.cargo', 'config.toml')
      if (await fileExists(config)) args.splice(1, 0, '--config', config)

      this.updateJob(job, {
        stage: 'Compiling Horizon',
        message: `profile ${finalProfile} · the first build can take 20–30 minutes`,
        progress: null,
        indeterminate: true,
      })
      await this.runProcess(rust.cargo, args, {
        cwd: this.workingDirectory(),
        env: rust.env,
        signal,
        timeoutMs: BUILD_TIMEOUT_MS,
        onLine: this.cargoLines(job),
      })
      if (signal?.aborted) throw abortError()

      const binary = path.join(
        roots,
        'target',
        finalProfile,
        this.platform === 'win32' ? 'horizon-client.exe' : 'horizon-client',
      )
      if (!(await fileExists(binary))) throw new Error('Cargo finished without a horizon-client binary.')

      this.updateJob(job, {
        stage: 'Installing the native build',
        message: finalTag,
        indeterminate: true,
      })
      await ensureDir(this.paths.horizonVersionsRoot)
      destination = path.join(this.paths.horizonVersionsRoot, finalTag)
      const temporary = path.join(this.paths.horizonVersionsRoot, `.${finalTag}-${Date.now()}`)
      await fsp.rm(temporary, { recursive: true, force: true })
      await fsp.cp(base.directory, temporary, { recursive: true })
      const client = await this.clientPath(temporary)
      await fsp.rm(client, { force: true })
      await fsp.copyFile(binary, client)
      if (this.platform !== 'win32') await fsp.chmod(client, 0o755)

      const gameVersion = base.gameVersion
      const installedAt = new Date().toISOString()
      const marker = {
        kind: 'aqua-horizon-native',
        schema: 1,
        tag: finalTag,
        gameVersion,
        baseTag: base.tag,
        revision: plan.revision,
        mixins: plan.mixins,
        profile: finalProfile,
        mods: mods.map((mod) => mod.id),
        installedAt,
        javaMajor: base.javaMajor || null,
      }
      await fsp.writeFile(path.join(temporary, '.aqua-horizon.json'), JSON.stringify(marker, null, 2))
      await fsp.writeFile(
        path.join(temporary, 'native-mods.json'),
        JSON.stringify(
          {
            base: base.tag,
            horizon: plan.revision,
            target: 'client',
            mixins: plan.mixins,
            profile: finalProfile,
            mods: mods.map((mod) => mod.id),
          },
          null,
          2,
        ),
      )
      await fsp.rm(destination, { recursive: true, force: true })
      await fsp.rename(temporary, destination).catch(async (error) => {
        await fsp.rm(destination, { recursive: true, force: true }).catch(() => {})
        await fsp.cp(temporary, destination, { recursive: true })
        await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {})
        if (!(await fileExists(path.join(destination, '.aqua-horizon.json')))) throw error
      })
      this.horizonService.cache = null

      this.updateJob(job, {
        status: 'completed',
        stage: 'Native build ready',
        message: `${finalTag} · Minecraft ${gameVersion}`,
        progress: 100,
        indeterminate: false,
        finishedAt: new Date().toISOString(),
      })
      this.logger?.info('Horizon native build complete', { tag: finalTag, revision: plan.revision, mods: mods.length })
      if (this.store?.addActivity) {
        try {
          await this.store.addActivity({
            type: 'install',
            title: 'Built Horizon with native mods',
            detail: `${mods.map((mod) => mod.title).join(', ')} · ${finalTag}`,
            installationId: null,
            status: 'success',
          })
          this.emitActivity?.()
        } catch (error) {
          this.logger?.warn('Could not record the native build', { message: error.message })
        }
      }
      this.emitNotification?.({
        level: 'success',
        title: 'Horizon native build ready',
        message: `${mods.length} native mod${mods.length === 1 ? '' : 's'} compiled. Play it from the Horizon panel.`,
      })
    } catch (error) {
      const cancelled = signal.aborted || job.cancelRequested || error?.name === 'AbortError'
      this.updateJob(job, {
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'Build cancelled' : 'Build failed',
        message: cancelled ? null : error.message,
        error: cancelled ? null : error.message,
        indeterminate: false,
        finishedAt: new Date().toISOString(),
      })
      if (!cancelled) {
        this.logger?.error('Horizon native build failed', { message: error.message })
        this.emitNotification?.({ level: 'error', title: 'Horizon native build failed', message: error.message })
      }
      await fsp.rm(staged, { recursive: true, force: true }).catch(() => {})
    } finally {
      if (this.job === job) {
        this.child = null
        this.abort = null
      }
    }
  }

  /** The base build's client file, wherever its platform layout puts it. */
  async clientPath(directory) {
    const candidates =
      this.platform === 'win32'
        ? [path.join(directory, 'horizon-client.exe')]
        : this.platform === 'darwin'
          ? [
              path.join(directory, 'Horizon.app', 'Contents', 'MacOS', 'horizon-client'),
              path.join(directory, 'horizon-client'),
            ]
          : [path.join(directory, 'horizon-client')]
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate
    }
    return candidates[0]
  }
}

function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // The process may already be gone.
  }
}
