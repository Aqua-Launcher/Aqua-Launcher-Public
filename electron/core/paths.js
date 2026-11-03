import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let cachedPaths = null
let portableInfo = {
  active: false,
  source: null,
  warning: null,
}

/** Set by main.js before the first getPaths() call. */
export function setPortableInfo(info = {}) {
  portableInfo = { ...portableInfo, ...info }
  cachedPaths = null
}

function resolveResourcesRoot() {
  if (process.env.AQUA_RESOURCES) return process.env.AQUA_RESOURCES
  const candidates = [
    path.join(app.getAppPath(), 'build'),
    path.join(path.dirname(process.execPath), 'build'),
    process.resourcesPath ? path.join(process.resourcesPath, 'build') : null,
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

export function getPaths() {
  if (cachedPaths) return cachedPaths
  const dataRoot = app.getPath('userData')
  const minecraftRoot = path.join(dataRoot, 'minecraft')
  const instancesRoot = path.join(dataRoot, 'instances')
  const logsRoot = path.join(dataRoot, 'logs')
  const gameLogsRoot = path.join(logsRoot, 'game')
  const cacheRoot = path.join(dataRoot, 'cache')
  const runtimeRoot = path.join(dataRoot, 'runtime')
  const backupsRoot = path.join(dataRoot, 'backups')
  const bedrockRoot = path.join(dataRoot, 'bedrock')
  const horizonRoot = path.join(dataRoot, 'horizon')
  cachedPaths = {
    dataRoot,
    configFile: path.join(dataRoot, 'launcher.json'),
    accountsFile: path.join(dataRoot, 'accounts.bin'),
    minecraftRoot,
    versionsRoot: path.join(minecraftRoot, 'versions'),
    librariesRoot: path.join(minecraftRoot, 'libraries'),
    assetsRoot: path.join(minecraftRoot, 'assets'),
    instancesRoot,
    logsRoot,
    gameLogsRoot,
    cacheRoot,
    avatarCacheRoot: path.join(cacheRoot, 'avatars'),
    versionCacheRoot: path.join(cacheRoot, 'versions'),
    artworkCacheRoot: path.join(cacheRoot, 'artwork'),
    screenshotsCacheRoot: path.join(cacheRoot, 'screenshots'),
    backgroundsRoot: path.join(dataRoot, 'backgrounds'),
    backupsRoot,
    bedrockRoot,
    bedrockVersionsRoot: path.join(bedrockRoot, 'versions'),
    bedrockDownloadsRoot: path.join(bedrockRoot, 'downloads'),
    horizonRoot,
    horizonVersionsRoot: path.join(horizonRoot, 'versions'),
    horizonDownloadsRoot: path.join(horizonRoot, 'downloads'),
    horizonGameRoot: path.join(horizonRoot, 'game'),
    horizonCacheRoot: path.join(horizonRoot, 'cache'),
    horizonReleasesCacheFile: path.join(horizonRoot, 'cache', 'releases.json'),
    manifestCacheFile: path.join(cacheRoot, 'version-manifest.json'),
    patchNotesCacheFile: path.join(cacheRoot, 'patch-notes.json'),
    dropsCacheFile: path.join(cacheRoot, 'minecraft-drops.json'),
    bedrockVersionsCacheFile: path.join(cacheRoot, 'bedrock-versions.json'),
    runtimeRoot,
    launcherLog: path.join(logsRoot, 'launcher.log'),
    resourcesRoot: resolveResourcesRoot(),
    portable: portableInfo.active,
    portableSource: portableInfo.source,
    portableWarning: portableInfo.warning,
  }
  return cachedPaths
}

export async function ensureAppDirs(paths) {
  for (const dir of [
    paths.dataRoot,
    paths.minecraftRoot,
    paths.versionsRoot,
    paths.librariesRoot,
    paths.assetsRoot,
    paths.instancesRoot,
    paths.logsRoot,
    paths.gameLogsRoot,
    paths.cacheRoot,
    paths.avatarCacheRoot,
    paths.versionCacheRoot,
    paths.artworkCacheRoot,
    paths.screenshotsCacheRoot,
    paths.backgroundsRoot,
    paths.backupsRoot,
    paths.runtimeRoot,
    paths.bedrockRoot,
    paths.bedrockVersionsRoot,
    paths.bedrockDownloadsRoot,
    paths.horizonRoot,
    paths.horizonVersionsRoot,
    paths.horizonDownloadsRoot,
    paths.horizonGameRoot,
    paths.horizonCacheRoot,
  ]) {
    await fs.promises.mkdir(dir, { recursive: true })
  }
}

/** The packaged artwork lives next to the app when it ships. */
function iconCandidates(names) {
  const paths = getPaths()
  const candidates = [
    ...names.map((name) => path.join(paths.resourcesRoot, name)),
    ...names.map((name) => path.join(app.getAppPath(), 'build', name)),
    ...names.map((name) => path.join(path.dirname(process.execPath), 'build', name)),
    ...(process.resourcesPath ? names.map((name) => path.join(process.resourcesPath, 'build', name)) : []),
    path.join(app.getAppPath(), 'public', 'favicon.png'),
  ]
  return [...new Set(candidates)]
}

export function getTrayIconPath() {
  return iconCandidates(['icon.png']).find((candidate) => fs.existsSync(candidate)) || null
}

/**
 * PNG is the format Electron reliably decodes at runtime; the .ico is used by the
 * Windows packaging config for the executable icon and stays as a last resort.
 */
export function getWindowIconPath() {
  return iconCandidates(['icon.png', 'icon-256.png', 'icon.ico']).find((candidate) => fs.existsSync(candidate)) || null
}
