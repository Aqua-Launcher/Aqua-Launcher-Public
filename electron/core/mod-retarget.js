import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, randomId } from './util.js'

const RELEASE_VERSION = /^(\d+)\.(\d+)(?:\.(\d+))?$/
const SIGNED_ENTRY = /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i

const METADATA_PATHS = {
  fabric: 'fabric.mod.json',
  quilt: 'quilt.mod.json',
  forge: 'META-INF/mods.toml',
  neoforge: 'META-INF/neoforge.mods.toml',
}

const LOADER_LABELS = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  vanilla: 'Vanilla',
}

const MOD_LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge'])

function rangeList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return null
}

function formatRange(value) {
  const list = rangeList(value)
  return list ? list.join(' or ') : null
}

export function parseMinecraftRelease(value) {
  const match = RELEASE_VERSION.exec(String(value ?? '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  }
}

export function sameMinecraftLine(left, right) {
  const first = typeof left === 'string' ? parseMinecraftRelease(left) : left
  const second = typeof right === 'string' ? parseMinecraftRelease(right) : right
  return Boolean(first && second && first.major === second.major && first.minor === second.minor)
}

function versionParts(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/^[vV]/, '')
    .replace(/-$/, '')
  if (!/^\d+(?:\.\d+){0,3}$/.test(text)) return null
  return text.split('.').map(Number)
}

function compareVersions(left, right) {
  const first = versionParts(left)
  const second = versionParts(right)
  if (!first || !second) return null
  const length = Math.max(first.length, second.length)
  for (let index = 0; index < length; index += 1) {
    const a = first[index] ?? 0
    const b = second[index] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

function mavenIncludes(range, version) {
  const opening = range[0]
  const closing = range[range.length - 1]
  if (!'[('.includes(opening) || !')]'.includes(closing)) return null
  const body = range.slice(1, -1)
  if (!body.includes(',')) {
    return compareVersions(version, body.trim()) === 0
  }
  const [lowerText, upperText] = body.split(',')
  const lower = lowerText.trim()
  const upper = upperText.trim()
  if (lower) {
    const comparison = compareVersions(version, lower)
    if (comparison == null) return null
    if (opening === '[' ? comparison < 0 : comparison <= 0) return false
  }
  if (upper) {
    const comparison = compareVersions(version, upper)
    if (comparison == null) return null
    if (closing === ']' ? comparison > 0 : comparison >= 0) return false
  }
  return true
}

function predicateIncludes(predicate, version) {
  const text = String(predicate ?? '').trim()
  if (!text) return null
  if (text === '*') return true
  if (/^[\[(]/.test(text)) return mavenIncludes(text, version)

  // `1.x`, `1.21.x` and `1.21.*` all mean every patch in that line.
  if (/[xX*]/.test(text)) {
    const target = versionParts(version)
    if (!target) return null
    const segments = text.split('.')
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (/^[xX*]$/.test(segment)) return true
      if (!/^\d+$/.test(segment)) return null
      if (Number(segment) !== (target[index] ?? 0)) return false
    }
    return true
  }

  if (text.startsWith('~') || text.startsWith('^')) {
    const raw = text.slice(1).trim()
    const lower = versionParts(raw)
    const comparison = compareVersions(version, raw)
    if (!lower || comparison == null) return null
    if (comparison < 0) return false
    if (text.startsWith('~')) {
      const upper = `${lower[0]}.${(lower[1] ?? 0) + 1}`
      return compareVersions(version, upper) < 0
    }
    return compareVersions(version, String(lower[0] + 1)) < 0
  }

  const match = /^(>=|<=|>|<|==|=)?\s*(.+)$/.exec(text)
  if (!match) return null
  const comparison = compareVersions(version, match[2].trim())
  if (comparison == null) return null
  switch (match[1]) {
    case '>=':
      return comparison >= 0
    case '>':
      return comparison > 0
    case '<=':
      return comparison <= 0
    case '<':
      return comparison < 0
    case '=':
    case '==':
      return comparison === 0
    default:
      return comparison === 0
  }
}

function entryIncludes(entry, version) {
  const predicates = entry.split(/\s+/).filter(Boolean)
  let matched = true
  let foundUnknown = false
  for (const predicate of predicates) {
    const result = predicateIncludes(predicate, version)
    if (result === false) {
      matched = false
      break
    }
    if (result === null) foundUnknown = true
  }
  return matched && !foundUnknown ? true : foundUnknown ? null : false
}

/**
 * Fabric/Quilt treat a list of ranges as alternatives; Forge dependencies are
 * separate constraints, so every declared Minecraft range has to allow the
 * target there.
 */
/**
 * Matches a declared loader range against a Minecraft version. Returns true or
 * false, or null when the range uses a format this launcher does not parse.
 */
export function rangeIncludes(range, version, mode = 'any') {
  const list = rangeList(range)
  if (!list) return null

  if (mode === 'all') {
    let unknown = false
    for (const entry of list) {
      // Forge stores a single Maven range per dependency table, so spaces
      // inside it (for example after a comma) belong to the same range.
      const result = predicateIncludes(entry, version)
      if (result === false) return false
      if (result === null) unknown = true
    }
    return unknown ? null : true
  }

  let unknown = false
  for (const entry of list) {
    const result = entryIncludes(entry, version)
    if (result === true) return true
    if (result === null) unknown = true
  }
  return unknown ? null : false
}

function baseVersionOfRange(range) {
  const list = rangeList(range)
  if (!list) return null
  let candidate = list[0]
  if (/^[\[(]/.test(candidate)) {
    const body = candidate.slice(1, -1)
    candidate = body.split(',')[0]
  } else {
    candidate = candidate.split(/\s+/)[0]
  }
  candidate = candidate
    .replace(/^(>=|<=|>|<|==|=|~|\^)+/, '')
    .trim()
    .replace(/[xX*]/g, '0')
    .replace(/-$/, '')
  return parseMinecraftRelease(candidate)
}

function suggestedRangeFor(version, loader) {
  const line = `${version.major}.${version.minor}`
  const nextLine = `${version.major}.${version.minor + 1}`
  if (loader === 'forge' || loader === 'neoforge') return `[${line},${nextLine})`
  return `>=${line} <${nextLine}`
}

/** Walks `[[dependencies.<mod>]]` tables without pulling in a TOML parser. */
function forgeBlocks(lines) {
  const blocks = []
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[\[dependencies\.[^\]]+\]\]\s*(?:#.*)?$/.test(lines[index])) {
      if (start >= 0) blocks.push([start, index])
      start = index
    }
  }
  if (start >= 0) blocks.push([start, lines.length])
  return blocks
}

function readForgeRanges(text) {
  const lines = text.split(/\r?\n/)
  const ranges = []
  for (const [start, end] of forgeBlocks(lines)) {
    const block = lines.slice(start, end)
    if (!block.some((line) => /^\s*modId\s*=\s*["']minecraft["']/.test(line))) continue
    for (const line of block) {
      const match = /^\s*versionRange\s*=\s*["']([^"']*)["']/.exec(line)
      if (match && match[1].trim()) ranges.push(match[1].trim())
    }
  }
  return ranges
}

function replaceForgeRange(text, range) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let changed = false
  for (const [start, end] of forgeBlocks(lines)) {
    const block = lines.slice(start, end)
    if (!block.some((line) => /^\s*modId\s*=\s*["']minecraft["']/.test(line))) continue
    for (let index = start; index < end; index += 1) {
      if (!/^\s*versionRange\s*=\s*["'][^"']*["']/.test(lines[index])) continue
      lines[index] = lines[index].replace(/versionRange\s*=\s*["'][^"']*["']/, `versionRange="${range}"`)
      changed = true
    }
  }
  return changed ? lines.join(newline) : null
}

function readJson(zip, entryName) {
  const entry = zip.getEntry(entryName)
  if (!entry) return null
  return JSON.parse(entry.getData().toString('utf8'))
}

function loadedLabel(loader) {
  return LOADER_LABELS[loader] || loader || 'unknown'
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

/**
 * A mod built for one Minecraft patch can often declare support for another
 * patch in the same release line. This service only changes that declaration:
 * the mod's code is not recompiled or remapped, so a mod that calls changed
 * APIs can still fail. The original jar is kept beside the profile so the
 * player can restore it.
 */
export class ModRetargetService {
  constructor({ logger, modrinthService }) {
    this.logger = logger
    this.modrinthService = modrinthService
  }

  contentDirectory(installation) {
    return this.modrinthService.contentDirectory(installation, 'mod')
  }

  backupDirectory(installation) {
    return path.join(this.contentDirectory(installation), '.aqua', 'retargets')
  }

  recordPath(installation, filename) {
    return path.join(this.backupDirectory(installation), `${filename}.json`)
  }

  async readRecord(installation, filename) {
    try {
      return JSON.parse(await fsp.readFile(this.recordPath(installation, filename), 'utf8'))
    } catch {
      return null
    }
  }

  async inspect(installation, filename) {
    const target = parseMinecraftRelease(installation.versionId)
    const targetLoader = installation.loader?.type || 'vanilla'
    const jarPath = this.modrinthService.resolveContentFile(installation, 'mod', filename)
    const record = await this.readRecord(installation, filename)
    const backupPath = path.join(this.backupDirectory(installation), filename)
    const backupExists = await fileExists(backupPath)
    // A record only describes this exact jar. If the player reinstalled or
    // edited the file since, the stale backup must not be offered as an undo.
    let converted = Boolean(record && backupExists)
    if (converted && record.convertedSha1) {
      const currentSha1 = await sha1OfFile(jarPath)
      converted = Boolean(currentSha1 && currentSha1 === record.convertedSha1)
    }

    const analysis = {
      filename,
      targetVersion: String(installation.versionId ?? ''),
      targetLoader,
      modLoader: null,
      metadataPath: null,
      declaredRange: null,
      suggestedRange: null,
      status: 'blocked',
      reason: null,
      warnings: [],
      converted,
      canUndo: converted && backupExists,
      convertedAt: record?.convertedAt || null,
      convertedVersion: record?.targetVersion || null,
      originalRange: formatRange(record?.originalRange),
    }

    const blocked = (reason, extra = {}) => ({ ...analysis, ...extra, status: 'blocked', reason })

    if (!target) {
      return blocked('This profile does not run a Minecraft release version, so its mods cannot be safely retargeted.')
    }
    if (!MOD_LOADERS.has(targetLoader)) {
      return blocked('Add Fabric, Quilt, Forge, or NeoForge to this profile before converting mods.')
    }
    if (!/\.jar(?:\.disabled)?$/i.test(filename)) {
      return blocked('Only .jar mod files can be converted.')
    }
    if (!(await fileExists(jarPath))) {
      throw new Error('That mod file is no longer in this profile.')
    }

    let zip
    try {
      zip = new AdmZip(jarPath)
      if (!zip.getEntries().length) return blocked('That file is empty or not a readable .jar archive.')
    } catch {
      return blocked('That file is not a readable .jar archive.')
    }

    const entries = zip.getEntries()
    const has = (entryName) => entries.some((entry) => entry.entryName === entryName)
    if (entries.some((entry) => SIGNED_ENTRY.test(entry.entryName))) {
      return blocked('This jar is signed. Converting it would break the signature, so the game would refuse to load it.')
    }

    const found = []
    if (has(METADATA_PATHS.fabric)) found.push('fabric')
    if (has(METADATA_PATHS.quilt)) found.push('quilt')
    if (has(METADATA_PATHS.neoforge)) found.push('neoforge')
    if (has(METADATA_PATHS.forge)) found.push('forge')

    let sourceLoader = null
    if (targetLoader === 'fabric') {
      sourceLoader = found.includes('fabric') ? 'fabric' : null
    } else if (targetLoader === 'quilt') {
      sourceLoader = found.includes('quilt') ? 'quilt' : found.includes('fabric') ? 'fabric' : null
    } else if (targetLoader === 'forge') {
      sourceLoader = found.includes('forge') ? 'forge' : null
    } else if (targetLoader === 'neoforge') {
      sourceLoader = found.includes('neoforge') ? 'neoforge' : found.includes('forge') ? 'forge' : null
    }

    if (!sourceLoader) {
      if (found.length) {
        return blocked(
          `This is a ${loadedLabel(found[0])} mod, but this profile uses ${loadedLabel(targetLoader)}. The mod loader has to match.`,
          { modLoader: found[0], metadataPath: METADATA_PATHS[found[0]] },
        )
      }
      return blocked('No Fabric, Quilt, Forge, or NeoForge metadata was found in this jar. It may be a legacy mod or not a mod at all.')
    }

    const metadataPath = METADATA_PATHS[sourceLoader]
    let declaredRange = null
    try {
      if (sourceLoader === 'fabric') {
        const metadata = readJson(zip, metadataPath)
        declaredRange = metadata?.depends?.minecraft ?? null
      } else if (sourceLoader === 'quilt') {
        const metadata = readJson(zip, metadataPath)
        const depends = metadata?.quilt_loader?.depends
        const minecraft = Array.isArray(depends)
          ? depends.find((entry) => entry && entry.id === 'minecraft')
          : null
        declaredRange = minecraft?.versions ?? null
      } else {
        const entry = zip.getEntry(metadataPath)
        if (!entry) return blocked('The mod metadata file could not be read.')
        const ranges = readForgeRanges(entry.getData().toString('utf8'))
        declaredRange = ranges.length ? ranges : null
      }
    } catch {
      return blocked(`The mod's ${metadataPath} could not be read, so its version cannot be changed safely.`, {
        modLoader: sourceLoader,
        metadataPath,
      })
    }

    analysis.modLoader = sourceLoader
    analysis.metadataPath = metadataPath
    analysis.declaredRange = formatRange(declaredRange)

    if (!declaredRange) {
      return {
        ...analysis,
        status: 'compatible',
        reason: null,
      }
    }

    const forgeFamily = sourceLoader === 'forge' || sourceLoader === 'neoforge'
    const includes = rangeIncludes(declaredRange, analysis.targetVersion, forgeFamily ? 'all' : 'any')
    const base = baseVersionOfRange(declaredRange)
    const sameLine = Boolean(base && sameMinecraftLine(base, target))
    const warnings = []

    if (includes === true) {
      return {
        ...analysis,
        status: 'compatible',
        reason: null,
      }
    }

    if (includes === false && !sameLine) {
      return blocked(
        `This mod is built for Minecraft ${formatRange(declaredRange)}. That is outside the ${target.major}.${target.minor}.x line this profile runs, so converting it would not be safe.`,
      )
    }

    if (includes === null && !sameLine) {
      return blocked(
        `Aqua could not read the supported Minecraft versions (${formatRange(declaredRange)}) well enough to convert this mod safely.`,
      )
    }

    if (includes === null) {
      warnings.push('The version declaration uses a format Aqua does not fully understand. It will be replaced with a standard range for this Minecraft line.')
    }
    warnings.push(
      `The mod's code is not recompiled. If it uses APIs that changed in Minecraft ${targetVersionString(target)}, the game may crash.`,
    )
    if (targetLoader === 'forge' || targetLoader === 'neoforge') {
      warnings.push('Forge and NeoForge mods are normally rebuilt for each Minecraft version, so this is more likely to fail than a Fabric mod.')
    }

    return {
      ...analysis,
      status: 'ready',
      reason: null,
      suggestedRange: suggestedRangeFor(target, targetLoader),
      warnings,
    }
  }

  async convert(installation, filename) {
    const analysis = await this.inspect(installation, filename)
    if (analysis.status !== 'ready') {
      throw new Error(analysis.reason || 'This mod does not need converting for this profile.')
    }

    if (!analysis.suggestedRange) throw new Error('The converted version range is missing.')

    const jarPath = this.modrinthService.resolveContentFile(installation, 'mod', filename)
    const backupDir = this.backupDirectory(installation)
    const backupPath = path.join(backupDir, filename)
    const record = await this.readRecord(installation, filename)
    const originalRange = record?.originalRange ?? analysis.declaredRange

    await ensureDir(backupDir)
    if (!(await fileExists(backupPath))) {
      await fsp.copyFile(jarPath, backupPath)
    }

    let zip
    try {
      zip = new AdmZip(jarPath)
      this.rewriteMetadata(zip, analysis.metadataPath, analysis.suggestedRange)
    } catch (error) {
      throw new Error(`Could not update the mod metadata: ${error.message}`)
    }

    const temporaryPath = path.join(path.dirname(jarPath), `.${path.basename(jarPath)}.${randomId()}.tmp`)
    try {
      zip.writeZip(temporaryPath)
      await fsp.rename(temporaryPath, jarPath)
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {})
      if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw new Error('Could not write the mod file. Close Minecraft and try again.')
      }
      throw new Error(`Could not write the converted mod: ${error.message}`)
    }

    const convertedSha1 = await sha1OfFile(jarPath)
    try {
      await fsp.writeFile(
        this.recordPath(installation, filename),
        `${JSON.stringify(
          {
            filename,
            metadataPath: analysis.metadataPath,
            modLoader: analysis.modLoader,
            targetVersion: analysis.targetVersion,
            originalRange,
            convertedRange: analysis.suggestedRange,
            convertedAt: new Date().toISOString(),
            convertedSha1,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
    } catch (error) {
      // Without its record the converted jar could not be restored, so put the
      // original back rather than leaving a changed mod with no undo path.
      await fsp.copyFile(backupPath, jarPath).catch(() => {})
      throw new Error(`The conversion record could not be written, so the original was restored: ${error.message}`)
    }

    this.logger?.info('Converted mod version declaration', {
      installation: installation.name,
      filename,
      from: formatRange(originalRange),
      to: analysis.targetVersion,
      loader: analysis.modLoader,
    })

    return this.inspect(installation, filename)
  }

  async undo(installation, filename) {
    const record = await this.readRecord(installation, filename)
    if (!record) throw new Error('There is no conversion backup for this mod.')
    const backupPath = path.join(this.backupDirectory(installation), filename)
    if (!(await fileExists(backupPath))) throw new Error('The conversion backup is missing.')

    const jarPath = this.modrinthService.resolveContentFile(installation, 'mod', filename)
    const currentSha1 = await sha1OfFile(jarPath)
    if (record.convertedSha1 && currentSha1 && record.convertedSha1 !== currentSha1) {
      throw new Error('This mod changed after it was converted, so the original backup was not restored.')
    }

    try {
      await fsp.copyFile(backupPath, jarPath)
    } catch (error) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw new Error('Could not restore the mod file. Close Minecraft and try again.')
      }
      throw new Error(`Could not restore the original mod: ${error.message}`)
    }

    await fsp.rm(this.recordPath(installation, filename), { force: true }).catch(() => {})
    await fsp.rm(backupPath, { force: true }).catch(() => {})
    this.logger?.info('Restored original mod after conversion', {
      installation: installation.name,
      filename,
    })
    return this.inspect(installation, filename)
  }

  rewriteMetadata(zip, metadataPath, range) {
    if (!metadataPath) throw new Error('The mod metadata path is missing.')
    const entry = zip.getEntry(metadataPath)
    if (!entry) throw new Error('The mod metadata file is missing.')

    if (/\.toml$/i.test(metadataPath)) {
      const text = entry.getData().toString('utf8')
      const updated = replaceForgeRange(text, range)
      if (!updated) throw new Error('The mod does not declare a Minecraft version range.')
      zip.updateFile(metadataPath, Buffer.from(updated, 'utf8'))
      return
    }

    const metadata = JSON.parse(entry.getData().toString('utf8'))
    if (metadataPath === METADATA_PATHS.fabric) {
      if (!metadata.depends || typeof metadata.depends !== 'object' || Array.isArray(metadata.depends)) {
        metadata.depends = {}
      }
      metadata.depends.minecraft = range
    } else {
      const depends = metadata?.quilt_loader?.depends
      const minecraft = Array.isArray(depends) ? depends.find((item) => item && item.id === 'minecraft') : null
      if (!minecraft) throw new Error('The mod does not declare a Minecraft version.')
      minecraft.versions = range
    }
    zip.updateFile(metadataPath, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'))
  }
}

function targetVersionString(target) {
  return `${target.major}.${target.minor}${target.patch ? `.${target.patch}` : ''}`
}
