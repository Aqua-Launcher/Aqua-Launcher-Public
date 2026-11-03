import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertSafeGameDirectory,
  cleanDisplayName,
  directoryExists,
  isPathInside,
  parseArguments,
  randomId,
  safeSegment,
  slugify,
  uniqueName,
} from './util.js'
import { getInstallationState } from './installer.js'
import { normalizeBackupPolicy } from './backup-scheduler.js'
import {
  compareInstallationRecency,
  INSTALLATION_COLORS,
  normalizeColor,
  normalizeCoverPath,
  normalizeSortIndex,
  normalizeTags,
} from './installation-meta.js'
import { LOADER_TYPES, loaderProfileId } from './loaders.js'

/** The version folder that actually holds game files: the loader profile when modded. */
export function effectiveVersionId(installation) {
  const loader = installation?.loader
  if (!loader || loader.type === 'vanilla') return installation?.versionId
  return loader.profileId || loaderProfileId(loader.type, installation.versionId, loader.version)
}

const VANILLA_LOADER = { type: 'vanilla', version: null, profileId: null }
const META_PATCH_KEYS = new Set(['pinned', 'tags', 'color', 'coverPath', 'sortIndex'])

function validateLoader(input) {
  if (input == null) return VANILLA_LOADER
  if (typeof input !== 'object') throw new Error('Mod loader details are invalid.')
  const type = input.type === undefined ? 'vanilla' : input.type
  if (!LOADER_TYPES.includes(type)) throw new Error('Choose a supported mod loader.')
  if (type === 'vanilla') return VANILLA_LOADER
  const version = safeSegment(input.version, 'Loader version', 64)
  return { type, version, profileId: input.profileId || null }
}

/** Modpack profiles keep a pointer to the Modrinth project they were made from. */
function validateModpack(input) {
  if (input == null) return null
  if (typeof input !== 'object') return null
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim().slice(0, 64) : ''
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
  if (!projectId || !name) return null
  return {
    projectId,
    name,
    iconUrl:
      typeof input.iconUrl === 'string' && /^https:\/\//i.test(input.iconUrl) ? input.iconUrl.slice(0, 500) : null,
    versionId: typeof input.versionId === 'string' && input.versionId ? input.versionId.slice(0, 64) : null,
  }
}

function validateWindowOverride(windowSettings) {
  if (windowSettings == null) return null
  const width = Number(windowSettings.width)
  const height = Number(windowSettings.height)
  if (!Number.isInteger(width) || width < 320 || width > 7680) throw new Error('Window width must be between 320 and 7680.')
  if (!Number.isInteger(height) || height < 240 || height > 4320) throw new Error('Window height must be between 240 and 4320.')
  return { width, height, fullscreen: Boolean(windowSettings.fullscreen) }
}

function validateMemoryOverride(memory) {
  if (memory == null) return null
  const totalMb = Math.round(os.totalmem() / (1024 * 1024))
  const minMb = Number(memory.minMb)
  const maxMb = Number(memory.maxMb)
  if (!Number.isInteger(minMb) || minMb < 512) throw new Error('Minimum memory must be at least 512 MB.')
  if (!Number.isInteger(maxMb) || maxMb < 1024) throw new Error('Maximum memory must be at least 1024 MB.')
  if (minMb > maxMb) throw new Error('Minimum memory cannot be greater than maximum memory.')
  if (maxMb > totalMb) throw new Error(`Maximum memory cannot exceed the ${Math.round(totalMb / 1024)} GB installed.`)
  return { minMb, maxMb }
}

function validateArgs(value, label) {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 4000) throw new Error(`${label} must be 4,000 characters or fewer.`)
  parseArguments(trimmed)
  return trimmed
}

async function validateJavaOverride(javaPath, javaService) {
  if (javaPath == null || javaPath === '') return null
  if (typeof javaPath !== 'string') throw new Error('Java path must be text.')
  const absolute = assertAbsolutePath(javaPath, 'Java path')
  if (javaService) {
    const info = await javaService.validateJavaPath(absolute)
    return info.path
  }
  return absolute
}

async function validateGameDir(gameDir) {
  const absolute = assertSafeGameDirectory(gameDir)
  await fsp.mkdir(absolute, { recursive: true })
  const stat = await fsp.stat(absolute)
  if (!stat.isDirectory()) throw new Error('The game directory path is not a folder.')
  await fsp.access(absolute, fs.constants.W_OK)
  return absolute
}

export class InstallationService {
  constructor({ paths, store, versionService, javaService, logger }) {
    this.paths = paths
    this.store = store
    this.versionService = versionService
    this.javaService = javaService
    this.logger = logger
  }

  async statusFor(installation) {
    const [state, worlds] = await Promise.all([
      getInstallationState(this.paths, effectiveVersionId(installation)),
      this.countWorlds(installation.gameDir),
    ])
    return {
      installed: state.installed,
      installedAt: state.installedAt,
      assetIndexId: state.assetIndexId,
      worlds,
      directoryExists: await directoryExists(installation.gameDir),
    }
  }

  async countWorlds(gameDir) {
    try {
      const entries = await fsp.readdir(path.join(gameDir, 'saves'), { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).length
    } catch {
      return 0
    }
  }

  async serialize(installation) {
    const status = await this.statusFor(installation)
    return {
      ...installation,
      versionType: installation.versionType,
      effectiveVersionId: effectiveVersionId(installation),
      isActive: this.store.activeInstallationId === installation.id,
      ...status,
      managedGameDir: isPathInside(installation.gameDir, this.paths.instancesRoot),
    }
  }

  async list() {
    const results = await Promise.all(this.store.installations.map((installation) => this.serialize(installation)))
    return results.sort(compareInstallationRecency)
  }

  async get(id) {
    const installation = this.store.getInstallation(id)
    if (!installation) throw new Error('Installation not found.')
    return this.serialize(installation)
  }

  ensureUniqueName(name, exceptId = null) {
    const normalized = name.trim().toLowerCase()
    if (
      this.store.installations.some(
        (installation) => installation.id !== exceptId && installation.name.trim().toLowerCase() === normalized,
      )
    ) {
      throw new Error('An installation with that name already exists.')
    }
  }

  async resolveVersion(versionId) {
    const manifest = await this.versionService.getManifest()
    const entry = manifest.versions.find((version) => version.id === versionId)
    if (!entry) throw new Error(`Minecraft version "${versionId}" is not available.`)
    return { manifest, entry }
  }

  managedDirectory(name) {
    const slug = slugify(name) || 'installation'
    return path.join(this.paths.instancesRoot, `${slug}-${randomId().slice(0, 8)}`)
  }

  async create(input) {
    if (!input || typeof input !== 'object') throw new Error('Installation details are missing.')
    const name = cleanDisplayName(input.name)
    this.ensureUniqueName(name)
    const versionId = safeSegment(input.versionId, 'Version ID')
    const { entry } = await this.resolveVersion(versionId)
    const managedPath = this.managedDirectory(name)
    const gameDir = input.gameDir
      ? await validateGameDir(input.gameDir)
      : await validateGameDir(managedPath)
    if (this.store.installations.some((installation) => installation.gameDir.toLowerCase() === gameDir.toLowerCase())) {
      // Shared directories are valid for Minecraft, but warn in the log so duplicated profiles are diagnosable.
      this.logger.info('Creating an installation that shares a game directory', { gameDir })
    }
    const loader = validateLoader(input.loader)
    const now = new Date().toISOString()
    const installation = {
      id: randomId(),
      name,
      versionId,
      versionType: entry.type || 'release',
      loader:
        loader.type === 'vanilla'
          ? { ...VANILLA_LOADER }
          : { ...loader, profileId: loaderProfileId(loader.type, versionId, loader.version) },
      gameDir,
      managedGameDir: isPathInside(gameDir, this.paths.instancesRoot),
      modpack: validateModpack(input.modpack),
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      totalPlaytimeMs: 0,
      lastInstalledAt: null,
      javaPath: await validateJavaOverride(input.javaPath, this.javaService),
      memoryOverride: validateMemoryOverride(input.memory),
      windowOverride: validateWindowOverride(input.window),
      jvmArgsOverride: validateArgs(input.jvmArgs, 'JVM arguments'),
      gameArgsOverride: validateArgs(input.gameArgs, 'Game arguments'),
      pinned: false,
      tags: [],
      color: null,
      coverPath: null,
      sortIndex: null,
    }
    await this.store.addInstallation(installation)
    await this.store.setActiveInstallation(installation.id)
    await this.store.addActivity({
      type: 'installation',
      title: `Created ${installation.name}`,
      detail: `Minecraft ${versionId}`,
      installationId: installation.id,
      status: 'success',
    })
    this.logger.info('Installation created', {
      name,
      versionId,
      loader: installation.loader.type,
      gameDir,
      custom: !installation.managedGameDir,
    })
    return this.serialize(installation)
  }

  async update(id, patch) {
    const existing = this.store.getInstallation(id)
    if (!existing) throw new Error('Installation not found.')
    if (!patch || typeof patch !== 'object') throw new Error('No changes were supplied.')
    const updates = {}
    if (patch.name !== undefined) {
      const name = cleanDisplayName(patch.name)
      this.ensureUniqueName(name, id)
      updates.name = name
    }
    if (patch.versionId !== undefined) {
      const versionId = safeSegment(patch.versionId, 'Version ID')
      const { entry } = await this.resolveVersion(versionId)
      updates.versionId = versionId
      updates.versionType = entry.type || 'release'
      if (versionId !== existing.versionId) updates.lastInstalledAt = null
    }
    if (patch.loader !== undefined) {
      const loader = validateLoader(patch.loader)
      const targetVersion = updates.versionId || existing.versionId
      const next = loader.type === 'vanilla' ? { ...VANILLA_LOADER } : loader
      const changed =
        (existing.loader?.type || 'vanilla') !== next.type || (existing.loader?.version || null) !== next.version
      updates.loader =
        next.type === 'vanilla'
          ? next
          : {
              ...next,
              profileId: changed ? loaderProfileId(next.type, targetVersion, next.version) : next.profileId,
            }
      if (changed) updates.lastInstalledAt = null
    } else if (updates.versionId && existing.loader && existing.loader.type !== 'vanilla') {
      // A loader profile is tied to one Minecraft version, so re-point it at the new one.
      updates.loader = {
        ...existing.loader,
        profileId: loaderProfileId(existing.loader.type, updates.versionId, existing.loader.version),
      }
      updates.lastInstalledAt = null
    }
    if (patch.gameDir !== undefined) {
      updates.gameDir = await validateGameDir(patch.gameDir)
      updates.managedGameDir = isPathInside(updates.gameDir, this.paths.instancesRoot)
    }
    if (patch.javaPath !== undefined) updates.javaPath = await validateJavaOverride(patch.javaPath, this.javaService)
    if (patch.memory !== undefined) updates.memoryOverride = validateMemoryOverride(patch.memory)
    if (patch.window !== undefined) updates.windowOverride = validateWindowOverride(patch.window)
    if (patch.jvmArgs !== undefined) updates.jvmArgsOverride = validateArgs(patch.jvmArgs, 'JVM arguments')
    if (patch.gameArgs !== undefined) updates.gameArgsOverride = validateArgs(patch.gameArgs, 'Game arguments')
    if (patch.backupPolicy !== undefined) {
      updates.backupPolicy = patch.backupPolicy ? normalizeBackupPolicy(patch.backupPolicy) : null
    }
    if (patch.pinned !== undefined) updates.pinned = Boolean(patch.pinned)
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags)) throw new Error('Tags must be a list.')
      updates.tags = normalizeTags(patch.tags)
    }
    if (patch.color !== undefined) {
      if (patch.color !== null && !INSTALLATION_COLORS.includes(patch.color)) {
        throw new Error('Choose a supported profile colour.')
      }
      updates.color = normalizeColor(patch.color)
    }
    if (patch.coverPath !== undefined) {
      const coverPath = normalizeCoverPath(patch.coverPath)
      if (patch.coverPath !== null && coverPath === null) throw new Error('That cover image path is not valid.')
      updates.coverPath = coverPath
    }
    if (patch.sortIndex !== undefined) {
      if (patch.sortIndex !== null && normalizeSortIndex(patch.sortIndex) === null) {
        throw new Error('That sort position is not valid.')
      }
      updates.sortIndex = normalizeSortIndex(patch.sortIndex)
    }
    const onlyMetadata = Object.keys(patch).every((key) => META_PATCH_KEYS.has(key))
    await this.store.updateInstallation(id, updates)
    if (patch.setActive) await this.store.setActiveInstallation(id)
    // Pinning or retagging a profile should not flood Recent activity.
    if (!onlyMetadata) {
      await this.store.addActivity({
        type: 'installation',
        title: `Updated ${updates.name || existing.name}`,
        detail: `Minecraft ${updates.versionId || existing.versionId}`,
        installationId: id,
        status: 'info',
      })
    }
    return this.serialize(this.store.getInstallation(id))
  }

  async duplicate(id) {
    const existing = this.store.getInstallation(id)
    if (!existing) throw new Error('Installation not found.')
    const name = uniqueName(
      existing.name,
      this.store.installations.map((installation) => installation.name),
    )
    const gameDir = await validateGameDir(this.managedDirectory(name))
    const now = new Date().toISOString()
    const duplicate = {
      ...existing,
      id: randomId(),
      name,
      gameDir,
      managedGameDir: true,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      totalPlaytimeMs: 0,
      lastInstalledAt: null,
      pinned: false,
      tags: [...(existing.tags || [])],
      color: existing.color || null,
      coverPath: null,
      sortIndex: null,
    }
    await this.store.addInstallation(duplicate)
    await this.store.setActiveInstallation(duplicate.id)
    await this.store.addActivity({
      type: 'installation',
      title: `Duplicated ${existing.name}`,
      detail: `Created ${name}`,
      installationId: duplicate.id,
      status: 'success',
    })
    return this.serialize(duplicate)
  }

  async remove(id) {
    const existing = this.store.getInstallation(id)
    if (!existing) throw new Error('Installation not found.')
    await this.store.removeInstallation(id)
    await this.store.addActivity({
      type: 'installation',
      title: `Deleted ${existing.name}`,
      detail: 'Game world and downloaded files were kept on disk',
      installationId: null,
      status: 'info',
    })
    this.logger.info('Installation deleted; game data preserved', {
      name: existing.name,
      gameDir: existing.gameDir,
    })
    return { removed: existing.name, gameDir: existing.gameDir }
  }

  /**
   * Drag-to-reorder persists an explicit position for every Java profile.
   * Requiring the full list keeps a filtered subset from overwriting positions.
   */
  async reorder(ids) {
    if (!Array.isArray(ids)) throw new Error('Choose a new installation order.')
    const installations = this.store.installations
    if (ids.length !== installations.length) throw new Error('The order must include every installation.')
    const seen = new Set()
    for (const id of ids) {
      if (typeof id !== 'string' || seen.has(id)) throw new Error('The installation order is invalid.')
      seen.add(id)
    }
    if (installations.some((installation) => !seen.has(installation.id))) {
      throw new Error('The installation order is invalid.')
    }
    ids.forEach((id, index) => {
      this.store.getInstallation(id).sortIndex = index
    })
    await this.store.save()
    this.logger.info('Installation order updated', { installations: ids.length })
    return true
  }

  async setActive(id) {
    await this.store.setActiveInstallation(id)
    return this.serialize(this.store.getInstallation(id))
  }
}

export { validateArgs, validateGameDir, validateJavaOverride, validateMemoryOverride, validateWindowOverride }
