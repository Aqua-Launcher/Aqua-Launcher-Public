import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, isPathInside } from './util.js'

const LOADER_COMPONENTS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseInstanceConfig(source) {
  const values = {}
  for (const line of String(source || '').split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index < 1) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^\"|\"$/g, '')
  }
  return values
}

async function countFiles(directory, limit = 100_000) {
  let count = 0
  const walk = async (current) => {
    if (count >= limit) return
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (count >= limit) return
      if (entry.isDirectory()) await walk(path.join(current, entry.name))
      else if (entry.isFile()) count += 1
    }
  }
  await walk(directory)
  return count
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return
  throw Object.assign(new Error('Modpack import cancelled.'), { name: 'AbortError' })
}

async function copyInstance(source, destination, { signal, onProgress, total }) {
  let done = 0
  const walk = async (from, to) => {
    throwIfCancelled(signal)
    await ensureDir(to)
    const entries = await fsp.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      throwIfCancelled(signal)
      const sourcePath = path.join(from, entry.name)
      const destinationPath = path.join(to, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not imported.')
      if (entry.isDirectory()) {
        await walk(sourcePath, destinationPath)
      } else if (entry.isFile()) {
        await fsp.copyFile(sourcePath, destinationPath)
        done += 1
        onProgress({
          stage: 'Copying instance files',
          progress: total ? (done / total) * 100 : null,
          indeterminate: !total,
          filesDone: done,
          filesTotal: total,
          currentFile: entry.name,
        })
      }
    }
  }
  await walk(source, destination)
}

export async function inspectPrismInstance(instancePath) {
  const stat = await fsp.lstat(instancePath).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('That Prism instance folder could not be read.')
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not imported.')

  const config = await fsp.readFile(path.join(instancePath, 'instance.cfg'), 'utf8').catch(() => null)
  const pack = await fsp.readFile(path.join(instancePath, 'mmc-pack.json'), 'utf8').catch(() => null)
  if (!pack) throw new Error('That folder has no mmc-pack.json; choose a Prism or MultiMC instance.')
  let manifest
  try {
    manifest = JSON.parse(pack)
  } catch {
    throw new Error('The Prism mmc-pack.json manifest could not be read.')
  }

  const components = Array.isArray(manifest?.components) ? manifest.components : []
  const minecraft = components.find((component) => component?.uid === 'net.minecraft')
  const minecraftVersion = text(minecraft?.version)
  if (!minecraftVersion) throw new Error('The Prism instance does not specify a Minecraft version.')

  let loader = { type: 'vanilla', version: null }
  for (const component of components) {
    const type = LOADER_COMPONENTS[component?.uid]
    if (!type) continue
    const version = text(component?.version)
    if (!version) throw new Error(`The Prism instance does not specify a ${type} loader version.`)
    loader = { type, version }
    break
  }

  const minecraftDir = path.join(instancePath, 'minecraft')
  const dotMinecraftDir = path.join(instancePath, '.minecraft')
  const minecraftStat = await fsp.stat(minecraftDir).catch(() => null)
  const dotMinecraftStat = await fsp.stat(dotMinecraftDir).catch(() => null)
  const sourceDir = minecraftStat?.isDirectory()
    ? minecraftDir
    : dotMinecraftStat?.isDirectory()
      ? dotMinecraftDir
      : instancePath
  const configValues = parseInstanceConfig(config)
  const name = text(configValues.name) || path.basename(instancePath)
  return {
    kind: 'prism',
    path: instancePath,
    name,
    minecraftVersion,
    loader,
    sourceDir,
    files: await countFiles(sourceDir),
    overrides: 0,
    modes: ['copy', 'adopt'],
  }
}

export async function inspectMrpackArchive(archivePath) {
  const stat = await fsp.lstat(archivePath).catch(() => null)
  if (!stat?.isFile()) throw new Error('That .mrpack file could not be read.')
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not imported.')
  let zip
  try {
    zip = new AdmZip(archivePath)
  } catch {
    throw new Error('That file is not a valid .mrpack archive.')
  }
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) throw new Error('That .mrpack is missing its modrinth.index.json manifest.')
  let index
  try {
    index = JSON.parse(entry.getData().toString('utf8'))
  } catch {
    throw new Error('The modpack manifest could not be read.')
  }
  if (Number(index?.formatVersion) !== 1) {
    throw new Error('Only .mrpack format version 1 is supported.')
  }
  if (!Array.isArray(index.files)) throw new Error('The modpack manifest has no files list.')
  const dependencies = index?.dependencies && typeof index.dependencies === 'object' ? index.dependencies : {}
  const minecraftVersion = text(dependencies.minecraft)
  if (!minecraftVersion) throw new Error('The modpack does not specify a Minecraft version.')

  let loader = { type: 'vanilla', version: null }
  const candidates = [
    ['fabric', dependencies['fabric-loader']],
    ['quilt', dependencies['quilt-loader']],
    ['neoforge', dependencies.neoforge],
    ['forge', dependencies.forge],
  ]
  for (const [type, version] of candidates) {
    if (typeof version === 'string' && version.trim()) {
      loader = { type, version: version.trim() }
      break
    }
  }
  if (loader.type !== 'vanilla' && !loader.version) {
    throw new Error(`The modpack does not specify a ${loader.type} loader version.`)
  }

  const root = path.resolve('/aqua-modpack-inspect')
  let files = 0
  for (const file of Array.isArray(index.files) ? index.files : []) {
    if (!file || typeof file.path !== 'string' || !file.path.trim()) continue
    if (!isPathInside(path.resolve(root, file.path), root)) {
      throw new Error('That modpack tries to write outside the game folder.')
    }
    if (file.env?.client !== 'unsupported') files += 1
  }
  let overrides = 0
  for (const item of zip.getEntries()) {
    const entryName = String(item.entryName || '').replace(/\\/g, '/')
    const match = /^(?:client-)?overrides\/(.+)$/.exec(entryName)
    if (!match || item.isDirectory) continue
    if (!isPathInside(path.resolve(root, match[1]), root)) {
      throw new Error('That modpack override tries to write outside the game folder.')
    }
    overrides += 1
  }

  return {
    kind: 'mrpack',
    path: archivePath,
    name: text(index.name) || path.basename(archivePath, path.extname(archivePath)),
    minecraftVersion,
    loader,
    files,
    overrides,
    modes: ['copy'],
  }
}

export async function inspectPack(sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw new Error('Choose a valid .mrpack or Prism instance folder.')
  }
  const stat = await fsp.lstat(sourcePath).catch(() => null)
  if (!stat) throw new Error('That pack could not be read.')
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not imported.')
  if (stat.isDirectory()) return inspectPrismInstance(sourcePath)
  if (!/\.mrpack$/i.test(sourcePath)) throw new Error('Choose a .mrpack file or a Prism instance folder.')
  return inspectMrpackArchive(sourcePath)
}

export class ModpackImportService {
  constructor({ modrinthService, installationService, loaderService = null, jobManager = null, logger = null }) {
    this.modrinthService = modrinthService
    this.installationService = installationService
    this.loaderService = loaderService
    this.jobManager = jobManager
    this.logger = logger
  }

  async inspect(sourcePath) {
    return inspectPack(sourcePath)
  }

  async validateLoader(loader, minecraftVersion) {
    if (!loader || loader.type === 'vanilla') return
    if (!loader.version) throw new Error(`The pack does not specify a ${loader.type} loader version.`)
    if (!this.loaderService) return
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

  async import(sourcePath, { mode = 'copy', signal = null, onProgress = () => {} } = {}) {
    const info = await this.inspect(sourcePath)
    await this.validateLoader(info.loader, info.minecraftVersion)
    throwIfCancelled(signal)
    if (info.kind === 'mrpack') {
      return this.modrinthService.installModpackArchive(sourcePath, null, null, { signal, onProgress })
    }

    const gameDir = mode === 'adopt' ? info.sourceDir : null
    const installation = await this.installationService.create({
      name: info.name,
      versionId: info.minecraftVersion,
      loader: info.loader.type === 'vanilla' ? null : info.loader,
      gameDir,
    })
    try {
      if (mode !== 'adopt') {
        onProgress({ stage: 'Copying instance files', indeterminate: true, filesDone: 0, filesTotal: info.files })
        await copyInstance(info.sourceDir, installation.gameDir, { signal, onProgress, total: info.files })
      }
      const job = this.jobManager?.enqueueInstall(installation.id) || null
      return {
        installation,
        job,
        modpack: {
          name: installation.name,
          packName: info.name,
          version: '',
          minecraftVersion: info.minecraftVersion,
          loader: info.loader.type,
          loaderVersion: info.loader.version,
          files: info.files,
          overrides: 0,
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
}
