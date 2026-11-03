import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectPrismInstance } from './modpack-import.js'
import { ensureDir, isPathInside } from './util.js'

export const LAUNCHER_LABELS = {
  vanilla: 'Minecraft launcher',
  prism: 'Prism Launcher',
  multimc: 'MultiMC',
  curseforge: 'CurseForge',
  atlauncher: 'ATLauncher',
}

const LOADER_TYPES = new Set(['fabric', 'quilt', 'forge', 'neoforge'])
const MAX_SCAN_FILES = 50_000
const MAX_NAME_LENGTH = 48

/** Top-level folders Aqua can recreate or should never read during an import. */
const SKIPPED_TOP_LEVEL = new Set([
  'assets',
  'backups',
  'cache',
  '.cache',
  'crash-reports',
  'downloads',
  'libraries',
  'logs',
  'node_modules',
  'temp',
  'tmp',
  'versions',
])

const SKIPPED_METADATA_FILES = new Set([
  'instance.cfg',
  'instance.json',
  'launcher_accounts.json',
  'launcher_msa_credentials.json',
  'launcher_profiles.json',
  'minecraftinstance.json',
  'mmc-pack.json',
  'usercache.json',
])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, MAX_NAME_LENGTH)
}

function profileId(launcher, sourceDir, minecraftVersion, name) {
  return crypto
    .createHash('sha1')
    .update([launcher, path.resolve(sourceDir), minecraftVersion, name].join('\0'))
    .digest('hex')
    .slice(0, 16)
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return
  throw Object.assign(new Error('Launcher import cancelled.'), { name: 'AbortError' })
}

async function boundedJson(filePath) {
  const stat = await fsp.lstat(filePath).catch(() => null)
  if (!stat?.isFile() || stat.size > 4 * 1024 * 1024) return null
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function directoryExists(directory) {
  const stat = await fsp.stat(directory).catch(() => null)
  return Boolean(stat?.isDirectory())
}

/** Standard launcher data locations. Kept pure so tests can exercise every platform. */
export function defaultLauncherRoots({
  platform = process.platform,
  home = os.homedir(),
  appData = process.env.APPDATA,
} = {}) {
  const roots = []
  const add = (launcher, directory, kind = 'instances') => {
    if (directory) roots.push({ launcher, path: path.normalize(directory), kind })
  }

  if (platform === 'win32') {
    const roaming = appData || (home ? path.join(home, 'AppData', 'Roaming') : '')
    add('vanilla', roaming ? path.join(roaming, '.minecraft') : '', 'vanilla')
    add('prism', roaming ? path.join(roaming, 'PrismLauncher', 'instances') : '')
    add('multimc', roaming ? path.join(roaming, 'MultiMC', 'instances') : '')
    add('curseforge', roaming ? path.join(roaming, 'CurseForge', 'minecraft', 'Instances') : '')
    add('curseforge', home ? path.join(home, 'curseforge', 'minecraft', 'Instances') : '')
    add('atlauncher', roaming ? path.join(roaming, 'ATLauncher', 'instances') : '')
  } else if (platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support')
    add('vanilla', path.join(support, 'minecraft'), 'vanilla')
    add('prism', path.join(support, 'PrismLauncher', 'instances'))
    add('multimc', path.join(support, 'MultiMC', 'instances'))
    add('curseforge', path.join(support, 'CurseForge', 'minecraft', 'Instances'))
    add('atlauncher', path.join(support, 'ATLauncher', 'instances'))
  } else {
    add('vanilla', path.join(home, '.minecraft'), 'vanilla')
    add('prism', path.join(home, '.local', 'share', 'PrismLauncher', 'instances'))
    add('multimc', path.join(home, '.local', 'share', 'MultiMC', 'instances'))
    add('multimc', path.join(home, '.multimc', 'instances'))
    add('curseforge', path.join(home, '.local', 'share', 'CurseForge', 'minecraft', 'Instances'))
    add('curseforge', path.join(home, 'curseforge', 'minecraft', 'Instances'))
    add('atlauncher', path.join(home, '.local', 'share', 'ATLauncher', 'instances'))
  }
  return roots
}

/**
 * Names such as `fabric-loader-0.15.11-1.20.1` or `1.20.1-forge-47.2.0`
 * carry everything needed when the launcher's version JSON is unavailable.
 */
export function inferLoaderFromVersionId(value) {
  const id = text(value)
  const lower = id.toLowerCase()
  if (!lower) return { loader: { type: 'vanilla', version: null }, minecraftVersion: '' }

  const patterns = [
    {
      type: 'fabric',
      match: /^fabric-loader-(.+)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/i,
      minecraft: 2,
      loader: 1,
    },
    {
      type: 'quilt',
      match: /^quilt-loader-(.+)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/i,
      minecraft: 2,
      loader: 1,
    },
    {
      type: 'forge',
      match: /^(\d+\.\d+(?:\.\d+)?)-forge-(.+)$/i,
      minecraft: 1,
      loader: 2,
    },
    {
      type: 'forge',
      match: /^forge-(\d+\.\d+(?:\.\d+)?)-(.+)$/i,
      minecraft: 1,
      loader: 2,
    },
    {
      type: 'neoforge',
      match: /^neoforge-(\d+\.\d+(?:\.\d+)?)-(.+)$/i,
      minecraft: 1,
      loader: 2,
    },
  ]

  for (const pattern of patterns) {
    const match = lower.match(pattern.match)
    if (!match) continue
    const loaderVersion = text(match[pattern.loader])
    if (!loaderVersion) continue
    return {
      loader: { type: pattern.type, version: loaderVersion },
      minecraftVersion: text(match[pattern.minecraft]),
    }
  }

  const loaderOnly = lower.match(/^(fabric|quilt|legacyfabric)-loader-(.+)$/)
  if (loaderOnly) {
    const type = loaderOnly[1] === 'legacyfabric' ? 'fabric' : loaderOnly[1]
    return { loader: { type, version: text(loaderOnly[2]) }, minecraftVersion: '' }
  }
  const forgeOnly = lower.match(/^(neoforge|forge)-(.+)$/)
  if (forgeOnly) {
    return { loader: { type: forgeOnly[1], version: text(forgeOnly[2]) }, minecraftVersion: '' }
  }
  return { loader: { type: 'vanilla', version: null }, minecraftVersion: id }
}

async function readVersionMetadata(root, versionId) {
  const id = text(versionId)
  if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..') return null
  const folder = path.join(root, 'versions', id)
  const manifest = await boundedJson(path.join(folder, `${id}.json`))
  if (!manifest) return null
  const inherited = text(manifest.inheritsFrom)
  const ownId = text(manifest.id) || id
  const inferred = inferLoaderFromVersionId(ownId)
  return {
    minecraftVersion: inherited || inferred.minecraftVersion || ownId,
    loader: inferred.loader,
  }
}

async function inspectVanillaProfile(root, key, profile) {
  const name = safeName(profile?.name, key || 'Minecraft')
  const versionId = text(profile?.lastVersionId)
  const metadata = versionId ? await readVersionMetadata(root, versionId) : null
  const inferred = versionId ? inferLoaderFromVersionId(versionId) : null
  const minecraftVersion = metadata?.minecraftVersion || inferred?.minecraftVersion
  if (!minecraftVersion) {
    throw new Error(`${name} has no Minecraft version Aqua can read.`)
  }
  const gameDirValue = text(profile?.gameDir)
  const sourceDir = gameDirValue ? path.resolve(root, gameDirValue) : root
  if (!(await directoryExists(sourceDir))) {
    throw new Error(`${name} points at a game folder that no longer exists.`)
  }
  return {
    launcher: 'vanilla',
    launcherName: LAUNCHER_LABELS.vanilla,
    path: root,
    sourceDir,
    name,
    minecraftVersion,
    loader: metadata?.loader || inferred?.loader || { type: 'vanilla', version: null },
    modes: ['adopt', 'copy'],
    versionId,
  }
}

async function latestVanillaVersion(root) {
  const entries = await fsp.readdir(path.join(root, 'versions'), { withFileTypes: true }).catch(() => [])
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!(await boundedJson(path.join(root, 'versions', entry.name, `${entry.name}.json`)))) continue
    const stat = await fsp.stat(path.join(root, 'versions', entry.name)).catch(() => null)
    candidates.push({ id: entry.name, mtimeMs: stat?.mtimeMs || 0 })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return candidates[0]?.id || null
}

async function measureProfile(sourceDir) {
  let files = 0
  let bytes = 0
  let sizeCapped = false

  const walk = async (directory, depth) => {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files >= MAX_SCAN_FILES) {
        sizeCapped = true
        return
      }
      const entryPath = path.join(directory, entry.name)
      if (depth === 0 && SKIPPED_TOP_LEVEL.has(entry.name.toLowerCase())) continue
      if (depth === 0 && SKIPPED_METADATA_FILES.has(entry.name.toLowerCase())) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
      } else if (entry.isFile()) {
        const stat = await fsp.stat(entryPath).catch(() => null)
        if (!stat) continue
        files += 1
        bytes += stat.size
      }
    }
  }
  await walk(sourceDir, 0)

  const countEntries = async (folder, predicate) => {
    const entries = await fsp.readdir(path.join(sourceDir, folder), { withFileTypes: true }).catch(() => [])
    return entries.filter(predicate).length
  }
  const mods = await countEntries('mods', (entry) => entry.isFile() && /\.jar(?:\.disabled)?$/i.test(entry.name))
  const worlds = await countEntries('saves', (entry) => entry.isDirectory())
  return { files, bytes, mods, worlds, sizeCapped }
}

async function makeCandidate({ launcher, launcherName, root, sourceDir, name, minecraftVersion, loader, path: profilePath }) {
  const metrics = await measureProfile(sourceDir)
  const profileName = safeName(name, path.basename(sourceDir || root))
  return {
    id: profileId(launcher, sourceDir, minecraftVersion, profileName),
    launcher,
    launcherName: launcherName || LAUNCHER_LABELS[launcher] || 'Launcher',
    path: profilePath || root,
    sourceDir,
    name: profileName,
    minecraftVersion,
    loader,
    modes: ['adopt', 'copy'],
    mods: metrics.mods,
    worlds: metrics.worlds,
    files: metrics.files,
    bytes: metrics.bytes,
    sizeCapped: metrics.sizeCapped,
  }
}

async function scanVanillaRoot(root, errors) {
  const candidates = []
  const profilesFile = path.join(root, 'launcher_profiles.json')
  const profiles = await boundedJson(profilesFile)
  const entries = profiles?.profiles && typeof profiles.profiles === 'object' ? Object.entries(profiles.profiles) : []
  for (const [key, profile] of entries) {
    if (!profile || typeof profile !== 'object') continue
    try {
      const candidate = await inspectVanillaProfile(root, key, profile)
      candidates.push(
        await makeCandidate({
          launcher: 'vanilla',
          launcherName: LAUNCHER_LABELS.vanilla,
          root,
          sourceDir: candidate.sourceDir,
          name: candidate.name,
          minecraftVersion: candidate.minecraftVersion,
          loader: candidate.loader,
        }),
      )
    } catch (error) {
      errors.push(`${LAUNCHER_LABELS.vanilla}: ${error.message}`)
    }
  }

  if (!candidates.length) {
    const version = await latestVanillaVersion(root)
    if (!version) {
      if (await directoryExists(path.join(root, 'saves'))) {
        errors.push(`${LAUNCHER_LABELS.vanilla}: no installed Minecraft versions were found.`)
      }
      return candidates
    }
    try {
      candidates.push(
        await makeCandidate({
          launcher: 'vanilla',
          launcherName: LAUNCHER_LABELS.vanilla,
          root,
          sourceDir: root,
          name: `Minecraft ${version}`,
          minecraftVersion: version,
          loader: { type: 'vanilla', version: null },
        }),
      )
    } catch (error) {
      errors.push(`${LAUNCHER_LABELS.vanilla}: ${error.message}`)
    }
  }
  return candidates
}

async function scanPrismRoot(root, launcher, errors) {
  const candidates = []
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const instancePath = path.join(root, entry.name)
    try {
      const info = await inspectPrismInstance(instancePath)
      candidates.push(
        await makeCandidate({
          launcher,
          launcherName: LAUNCHER_LABELS[launcher],
          root,
          sourceDir: info.sourceDir,
          name: info.name,
          minecraftVersion: info.minecraftVersion,
          loader: info.loader,
          path: instancePath,
        }),
      )
    } catch (error) {
      errors.push(`${LAUNCHER_LABELS[launcher]}: ${entry.name} — ${error.message}`)
    }
  }
  return candidates
}

function curseForgeLoader(instance) {
  const base = instance?.baseModLoader && typeof instance.baseModLoader === 'object' ? instance.baseModLoader : {}
  const name = text(base.name).toLowerCase()
  const declared = [
    ['forge', text(base.forgeVersion) || text(base.forge)],
    ['fabric', text(base.fabricLoaderVersion) || text(base.fabricVersion)],
    ['quilt', text(base.quiltLoaderVersion) || text(base.quiltVersion)],
    ['neoforge', text(base.neoForgeVersion) || text(base.neoforgeVersion)],
  ].find(([, version]) => version)

  if (declared) return { type: declared[0], version: declared[1] }
  if (name.startsWith('vanilla') || name === 'release' || name === 'recommended') {
    return { type: 'vanilla', version: null }
  }
  const fromName = name.match(/^(forge|fabric|quilt|neoforge)-(.+)$/)
  if (fromName) return { type: fromName[1], version: text(fromName[2]) }
  const inferred = inferLoaderFromVersionId(name)
  return inferred.loader
}

async function inspectCurseForgeInstance(instancePath) {
  const instance = await boundedJson(path.join(instancePath, 'minecraftinstance.json'))
  if (!instance) throw new Error('minecraftinstance.json could not be read.')
  const base = instance.baseModLoader && typeof instance.baseModLoader === 'object' ? instance.baseModLoader : {}
  const name = safeName(instance.name || instance.installedModpack?.name, path.basename(instancePath))
  const minecraftVersion = text(instance.gameVersion) || text(base.minecraftVersion)
  if (!minecraftVersion) throw new Error(`${name} does not record a Minecraft version.`)
  const loader = curseForgeLoader(instance)
  if (loader.type !== 'vanilla' && !loader.version) {
    throw new Error(`${name} does not record a ${loader.type} loader version.`)
  }
  return { name, minecraftVersion, loader }
}

async function scanCurseForgeRoot(root, errors) {
  const candidates = []
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (!(await boundedJson(path.join(root, entry.name, 'minecraftinstance.json')))) continue
    try {
      const info = await inspectCurseForgeInstance(path.join(root, entry.name))
      candidates.push(
        await makeCandidate({
          launcher: 'curseforge',
          launcherName: LAUNCHER_LABELS.curseforge,
          root,
          sourceDir: path.join(root, entry.name),
          name: info.name,
          minecraftVersion: info.minecraftVersion,
          loader: info.loader,
          path: path.join(root, entry.name),
        }),
      )
    } catch (error) {
      errors.push(`${LAUNCHER_LABELS.curseforge}: ${entry.name} — ${error.message}`)
    }
  }
  return candidates
}

async function inspectAtLauncherInstance(instancePath) {
  const instance = await boundedJson(path.join(instancePath, 'instance.json'))
  if (!instance) throw new Error('instance.json could not be read.')
  const launcher = instance.launcher && typeof instance.launcher === 'object' ? instance.launcher : {}
  const name = safeName(launcher.name || instance.name, path.basename(instancePath))
  const minecraftVersion =
    text(instance.minecraftVersion) || text(launcher.minecraftVersion) || text(instance.id)
  if (!minecraftVersion) throw new Error(`${name} does not record a Minecraft version.`)

  const loaderVersion = launcher.loaderVersion && typeof launcher.loaderVersion === 'object' ? launcher.loaderVersion : {}
  const type = text(loaderVersion.type).toLowerCase()
  if (launcher.vanillaInstance || !type || type === 'vanilla' || type === 'none' || type === 'dummy') {
    return { name, minecraftVersion, loader: { type: 'vanilla', version: null } }
  }
  if (!LOADER_TYPES.has(type)) {
    throw new Error(`${name} uses an unsupported ${loaderVersion.type} loader.`)
  }
  const loaderVersionValue = text(loaderVersion.version)
  if (!loaderVersionValue) throw new Error(`${name} does not record a ${type} loader version.`)
  return { name, minecraftVersion, loader: { type, version: loaderVersionValue } }
}

async function scanAtLauncherRoot(root, errors) {
  const candidates = []
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (!(await boundedJson(path.join(root, entry.name, 'instance.json')))) continue
    try {
      const info = await inspectAtLauncherInstance(path.join(root, entry.name))
      candidates.push(
        await makeCandidate({
          launcher: 'atlauncher',
          launcherName: LAUNCHER_LABELS.atlauncher,
          root,
          sourceDir: path.join(root, entry.name),
          name: info.name,
          minecraftVersion: info.minecraftVersion,
          loader: info.loader,
          path: path.join(root, entry.name),
        }),
      )
    } catch (error) {
      errors.push(`${LAUNCHER_LABELS.atlauncher}: ${entry.name} — ${error.message}`)
    }
  }
  return candidates
}

async function extraRoots(extraPath, errors) {
  const target = path.resolve(extraPath)
  const stat = await fsp.lstat(target).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('Choose a folder that contains a launcher profile.')
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not scanned.')

  if (await boundedJson(path.join(target, 'minecraftinstance.json'))) {
    return [{ launcher: 'curseforge', path: target, kind: 'curseforge-instance' }]
  }
  if (await boundedJson(path.join(target, 'instance.json'))) {
    return [{ launcher: 'atlauncher', path: target, kind: 'atlauncher-instance' }]
  }
  if (
    (await boundedJson(path.join(target, 'mmc-pack.json'))) ||
    (await directoryExists(path.join(target, 'instance.cfg')))
  ) {
    return [{ launcher: 'prism', path: target, kind: 'prism-instance' }]
  }

  const base = path.basename(target).toLowerCase()
  if (base === 'instances') {
    const parent = path.basename(path.dirname(target)).toLowerCase()
    const grandparent = path.basename(path.dirname(path.dirname(target))).toLowerCase()
    const launcher = parent.includes('prism')
      ? 'prism'
      : parent.includes('multimc')
        ? 'multimc'
        : parent.includes('atlauncher')
          ? 'atlauncher'
          : parent === 'minecraft' && grandparent.includes('curseforge')
            ? 'curseforge'
            : null
    if (launcher) return [{ launcher, path: target, kind: 'instances' }]
  }
  if (await directoryExists(path.join(target, 'instances'))) {
    const launcher = base.includes('prism')
      ? 'prism'
      : base.includes('multimc')
        ? 'multimc'
        : base.includes('atlauncher')
          ? 'atlauncher'
          : null
    if (launcher) return [{ launcher, path: path.join(target, 'instances'), kind: 'instances' }]
  }
  if (await directoryExists(path.join(target, 'minecraft', 'Instances'))) {
    return [{ launcher: 'curseforge', path: path.join(target, 'minecraft', 'Instances'), kind: 'instances' }]
  }
  if (
    (await directoryExists(path.join(target, 'versions'))) ||
    (await boundedJson(path.join(target, 'launcher_profiles.json')))
  ) {
    return [{ launcher: 'vanilla', path: target, kind: 'vanilla' }]
  }

  // A single instance with no manifest can still be a vanilla game folder.
  if ((await directoryExists(path.join(target, 'saves'))) || (await directoryExists(path.join(target, 'mods')))) {
    errors.push('That folder has game data but no launcher metadata, so its Minecraft version is unknown.')
  }
  throw new Error('That folder does not look like a vanilla, Prism/MultiMC, CurseForge, or ATLauncher profile.')
}

/**
 * Reads standard roots and an optional user-chosen folder. It only ever reads:
 * no source file is copied from here, and no manifest is rewritten.
 */
export async function discoverCandidates({
  roots = defaultLauncherRoots(),
  extraPath = null,
  logger = null,
} = {}) {
  const errors = []
  const scannedRoots = []
  const allRoots = [...roots]
  if (extraPath) allRoots.push(...(await extraRoots(extraPath, errors)))

  const seenRoots = new Set()
  const candidates = []
  for (const root of allRoots) {
    if (!root?.path) continue
    const key = `${root.kind || 'instances'}:${path.resolve(root.path).toLowerCase()}`
    if (seenRoots.has(key)) continue
    seenRoots.add(key)
    if (!(await directoryExists(root.path))) continue
    scannedRoots.push({ launcher: root.launcher, path: path.resolve(root.path), kind: root.kind || 'instances' })

    try {
      if (root.kind === 'vanilla') {
        candidates.push(...(await scanVanillaRoot(path.resolve(root.path), errors)))
      } else if (
        root.kind !== 'prism-instance' &&
        (root.launcher === 'prism' || root.launcher === 'multimc')
      ) {
        candidates.push(...(await scanPrismRoot(path.resolve(root.path), root.launcher, errors)))
      } else if (root.kind !== 'curseforge-instance' && root.launcher === 'curseforge') {
        candidates.push(...(await scanCurseForgeRoot(path.resolve(root.path), errors)))
      } else if (root.kind !== 'atlauncher-instance' && root.launcher === 'atlauncher') {
        candidates.push(...(await scanAtLauncherRoot(path.resolve(root.path), errors)))
      } else if (root.kind === 'curseforge-instance') {
        const instancePath = path.resolve(root.path)
        const info = await inspectCurseForgeInstance(instancePath)
        candidates.push(
          await makeCandidate({
            launcher: 'curseforge',
            launcherName: LAUNCHER_LABELS.curseforge,
            root: path.dirname(instancePath),
            sourceDir: instancePath,
            name: info.name,
            minecraftVersion: info.minecraftVersion,
            loader: info.loader,
            path: instancePath,
          }),
        )
      } else if (root.kind === 'atlauncher-instance') {
        const instancePath = path.resolve(root.path)
        const info = await inspectAtLauncherInstance(instancePath)
        candidates.push(
          await makeCandidate({
            launcher: 'atlauncher',
            launcherName: LAUNCHER_LABELS.atlauncher,
            root: path.dirname(instancePath),
            sourceDir: instancePath,
            name: info.name,
            minecraftVersion: info.minecraftVersion,
            loader: info.loader,
            path: instancePath,
          }),
        )
      } else if (root.kind === 'prism-instance') {
        const instancePath = path.resolve(root.path)
        const info = await inspectPrismInstance(instancePath)
        candidates.push(
          await makeCandidate({
            launcher: 'prism',
            launcherName: LAUNCHER_LABELS.prism,
            root: path.dirname(instancePath),
            sourceDir: info.sourceDir,
            name: info.name,
            minecraftVersion: info.minecraftVersion,
            loader: info.loader,
            path: instancePath,
          }),
        )
      }
    } catch (error) {
      const label = LAUNCHER_LABELS[root.launcher] || 'Launcher'
      errors.push(`${label}: ${error.message}`)
      logger?.warn?.('Launcher scan failed', { path: root.path, message: error.message })
    }
  }

  const deduped = []
  const seen = new Set()
  for (const candidate of candidates.sort((left, right) => {
    const launcherOrder = Object.keys(LAUNCHER_LABELS).indexOf(left.launcher) - Object.keys(LAUNCHER_LABELS).indexOf(right.launcher)
    return launcherOrder || left.name.localeCompare(right.name) || left.minecraftVersion.localeCompare(right.minecraftVersion)
  })) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    deduped.push(candidate)
  }
  return { candidates: deduped, roots: scannedRoots, errors }
}

function uniqueProfileName(baseName, existingNames) {
  const existing = new Set(existingNames.map((name) => name.toLowerCase()))
  const base = baseName.slice(0, MAX_NAME_LENGTH)
  if (!existing.has(base.toLowerCase())) return base
  let index = 2
  while (index < 10_000) {
    const suffix = ` (${index})`
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`
    if (!existing.has(candidate.toLowerCase())) return candidate
    index += 1
  }
  return `${base.slice(0, MAX_NAME_LENGTH - 8)} (copy)`
}

/**
 * Copies the content a profile owns, never the launcher's shared versions,
 * libraries, assets or caches. The source is opened read-only.
 */
export async function copyProfileContent(
  sourceDir,
  destinationDir,
  { importWorlds = true, signal = null, onProgress = () => {}, totalFiles = null, totalBytes = null } = {},
) {
  const source = path.resolve(sourceDir)
  const destination = path.resolve(destinationDir)
  const stat = await fsp.lstat(source).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('The source game folder could not be read.')
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not imported.')
  if (isPathInside(destination, source)) {
    throw new Error('The copy destination cannot be inside the source folder.')
  }

  let filesDone = 0
  let bytesDone = 0
  const warnings = []
  const walk = async (from, to, depth, topLevel) => {
    throwIfCancelled(signal)
    await ensureDir(to)
    const entries = await fsp.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      throwIfCancelled(signal)
      if (depth === 0 && SKIPPED_TOP_LEVEL.has(entry.name.toLowerCase())) continue
      if (depth === 0 && SKIPPED_METADATA_FILES.has(entry.name.toLowerCase())) continue
      if (depth === 0 && !importWorlds && entry.name.toLowerCase() === 'saves') continue
      const fromPath = path.join(from, entry.name)
      const toPath = path.join(to, entry.name)
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link ${path.join(topLevel || '', entry.name)}.`)
        continue
      }
      if (entry.isDirectory()) {
        await walk(fromPath, toPath, depth + 1, topLevel || entry.name)
      } else if (entry.isFile()) {
        const fileStat = await fsp.stat(fromPath).catch(() => null)
        await fsp.copyFile(fromPath, toPath)
        filesDone += 1
        bytesDone += fileStat?.size || 0
        onProgress({
          stage: 'Copying game content',
          progress: totalFiles ? Math.min(99, (filesDone / totalFiles) * 100) : null,
          indeterminate: !totalFiles,
          filesDone,
          filesTotal: totalFiles,
          bytesDone,
          bytesTotal: totalBytes,
          currentFile: entry.name,
        })
      }
    }
  }
  await walk(source, destination, 0, null)
  return { files: filesDone, bytes: bytesDone, warnings }
}

export class LauncherImportService {
  constructor({
    installationService,
    modpackImportService = null,
    loaderService = null,
    jobManager = null,
    store = null,
    logger = null,
    roots = null,
  }) {
    this.installationService = installationService
    this.modpackImportService = modpackImportService
    this.loaderService = loaderService
    this.jobManager = jobManager
    this.store = store
    this.logger = logger
    this.roots = roots
  }

  async scan({ extraPath = null } = {}) {
    return discoverCandidates({
      roots: this.roots || defaultLauncherRoots(),
      extraPath,
      logger: this.logger,
    })
  }

  async select(ids, { extraPath = null } = {}) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Choose at least one launcher profile.')
    const wanted = new Set(ids.map((id) => String(id)))
    const { candidates, errors } = await this.scan({ extraPath })
    const selected = candidates.filter((candidate) => wanted.has(candidate.id))
    if (!selected.length) {
      throw new Error(
        errors[0] || 'None of those profiles could be found. Rescan the launcher and try again.',
      )
    }
    return { candidates: selected, scanErrors: errors }
  }

  async importCandidates(candidates, { mode = 'adopt', importWorlds = true, signal = null, onProgress = () => {} } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error('Choose at least one launcher profile.')
    if (mode !== 'adopt' && mode !== 'copy') throw new Error('Choose whether to adopt or copy the profiles.')

    const result = { imported: [], failed: [] }
    const totalProfiles = candidates.length
    const totalFiles = candidates.reduce((sum, candidate) => sum + (candidate.files || 0), 0)
    const totalBytes = candidates.reduce((sum, candidate) => sum + (candidate.bytes || 0), 0)
    let filesDone = 0
    let bytesDone = 0
    const existingNames = (this.store?.installations || []).map((installation) => installation.name)

    for (let index = 0; index < candidates.length; index += 1) {
      throwIfCancelled(signal)
      const candidate = candidates[index]
      let installation = null
      const baseProgress = totalProfiles ? (index / totalProfiles) * 100 : null
      onProgress({
        stage: `Importing ${candidate.name} (${index + 1}/${totalProfiles})`,
        progress: baseProgress,
        indeterminate: false,
        filesDone,
        filesTotal: totalFiles,
        bytesDone,
        bytesTotal: totalBytes,
        currentFile: null,
      })

      try {
        if (this.modpackImportService?.validateLoader) {
          await this.modpackImportService.validateLoader(candidate.loader, candidate.minecraftVersion)
        }
        throwIfCancelled(signal)

        const name = uniqueProfileName(candidate.name, existingNames)
        installation = await this.installationService.create({
          name,
          versionId: candidate.minecraftVersion,
          loader: candidate.loader.type === 'vanilla' ? null : candidate.loader,
          gameDir: mode === 'adopt' ? candidate.sourceDir : null,
        })
        existingNames.push(installation.name)
        throwIfCancelled(signal)

        let copied = { files: 0, bytes: 0, warnings: [] }
        if (mode === 'copy') {
          copied = await copyProfileContent(candidate.sourceDir, installation.gameDir, {
            importWorlds,
            signal,
            totalFiles: candidate.files,
            totalBytes: candidate.bytes,
            onProgress: (update) => {
              const instanceFraction = update.filesTotal ? update.filesDone / update.filesTotal : 0
              onProgress({
                ...update,
                stage: `Copying ${candidate.name} (${index + 1}/${totalProfiles})`,
                progress: totalProfiles ? ((index + instanceFraction) / totalProfiles) * 100 : null,
                filesDone: filesDone + update.filesDone,
                filesTotal: totalFiles,
                bytesDone: bytesDone + (update.bytesDone || 0),
                bytesTotal: totalBytes,
              })
            },
          })
        }

        filesDone += candidate.files || copied.files
        bytesDone += candidate.bytes || copied.bytes
        const importJob = this.jobManager?.enqueueInstall(installation.id) || null
        const entry = {
          candidateId: candidate.id,
          installationId: installation.id,
          name: installation.name,
          launcher: candidate.launcher,
          minecraftVersion: candidate.minecraftVersion,
          loader: candidate.loader,
          mode,
          files: copied.files,
          bytes: copied.bytes,
          warnings: copied.warnings,
          installJob: importJob?.id || null,
        }
        result.imported.push(entry)
        await this.store
          ?.addActivity({
            type: 'installation',
            title: `Imported ${installation.name}`,
            detail: `${candidate.launcherName} · Minecraft ${candidate.minecraftVersion}${candidate.loader.type !== 'vanilla' ? ` · ${candidate.loader.type}` : ''}`,
            installationId: installation.id,
            status: 'success',
          })
          .catch(() => {})
        onProgress({
          stage: `Imported ${installation.name}`,
          progress: totalProfiles ? ((index + 1) / totalProfiles) * 100 : null,
          indeterminate: false,
          filesDone,
          filesTotal: totalFiles,
          bytesDone,
          bytesTotal: totalBytes,
          currentFile: null,
        })
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) {
          if (installation) {
            await this.rollback(installation).catch(() => {})
          }
          throw Object.assign(new Error('Launcher import cancelled.'), { name: 'AbortError' })
        }
        if (installation) await this.rollback(installation).catch(() => {})
        result.failed.push({
          candidateId: candidate.id,
          name: candidate.name,
          launcher: candidate.launcher,
          minecraftVersion: candidate.minecraftVersion,
          error: error.message || 'The profile could not be imported.',
        })
        await this.store
          ?.addActivity({
            type: 'installation',
            title: `Could not import ${candidate.name}`,
            detail: error.message || 'The profile could not be imported.',
            installationId: null,
            status: 'error',
          })
          .catch(() => {})
        this.logger?.warn?.('Launcher profile import failed', {
          name: candidate.name,
          path: candidate.sourceDir,
          message: error.message,
        })
      }
    }

    return result
  }

  async rollback(installation) {
    await this.installationService.remove(installation.id)
    if (installation.managedGameDir) {
      await fsp.rm(installation.gameDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
