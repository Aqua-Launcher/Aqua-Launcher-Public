/**
 * A deliberately small version-range evaluator for Minecraft mod metadata.
 * It supports the forms Fabric, Quilt, Forge and NeoForge commonly write:
 * exact versions, x/* wildcards, comparators, Maven brackets and simple
 * hyphen ranges. Anything else returns null so the caller does not report a
 * conflict it cannot prove.
 */

function versionParts(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))
}

export function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const first = a[index] ?? 0
    const second = b[index] ?? 0
    if (typeof first === 'number' && typeof second === 'number') {
      if (first !== second) return first < second ? -1 : 1
      continue
    }
    const result = String(first).localeCompare(String(second))
    if (result !== 0) return result < 0 ? -1 : 1
  }
  return 0
}

function wildcardMatches(version, pattern) {
  const patternParts = String(pattern)
    .toLowerCase()
    .split('.')
    .filter(Boolean)
  if (!patternParts.some((part) => part === 'x' || part === '*')) return null
  const versionPartsValue = versionParts(version)
  return patternParts.every((part, index) => {
    if (part === 'x' || part === '*') return true
    return String(versionPartsValue[index] ?? '') === part
  })
}

function bumpVersion(value, index) {
  const parts = versionParts(value).map((part) => (typeof part === 'number' ? part : 0))
  while (parts.length <= index) parts.push(0)
  parts[index] += 1
  return parts.slice(0, index + 1).join('.')
}

function comparatorSatisfied(version, token) {
  const wildcard = wildcardMatches(version, token)
  if (wildcard !== null) return wildcard
  const match = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(String(token).trim())
  if (!match) return null
  const operator = match[1] || '='
  const target = match[2].trim()
  const targetParts = versionParts(target)
  const versionPartsValue = versionParts(version)
  if (
    !target ||
    !targetParts.length ||
    !versionPartsValue.length ||
    !targetParts.some((part) => typeof part === 'number')
  ) {
    return null
  }
  const comparison = compareVersions(version, target)
  if (operator === '>=') return comparison >= 0
  if (operator === '>') return comparison > 0
  if (operator === '<=') return comparison <= 0
  if (operator === '<') return comparison < 0
  if (operator === '=') return comparison === 0
  if (operator === '~') {
    return comparison >= 0 && compareVersions(version, bumpVersion(target, target.split('.').length > 1 ? 1 : 0)) < 0
  }
  if (operator === '^') {
    return comparison >= 0 && compareVersions(version, bumpVersion(target, 0)) < 0
  }
  return null
}

export function satisfiesVersionRange(version, range) {
  if (range == null) return true
  const value = String(range).trim()
  if (!value || value === '*') return true
  if (!versionParts(version).length) return null

  if (value.includes('||')) {
    const results = value.split('||').map((part) => satisfiesVersionRange(version, part))
    if (results.some((result) => result === true)) return true
    return results.some((result) => result === null) ? null : false
  }

  // Forge writes Maven ranges such as [1.20.1,1.21) or (,1.21].
  const maven = /^([[(])\s*([^,\]]*)\s*,\s*([^)\]]*)\s*([\])])$/.exec(value)
  if (maven) {
    const lower = maven[2].trim()
    const upper = maven[3].trim()
    if (lower) {
      const comparison = compareVersions(version, lower)
      if (maven[1] === '[' ? comparison < 0 : comparison <= 0) return false
    }
    if (upper) {
      const comparison = compareVersions(version, upper)
      if (maven[4] === ']' ? comparison > 0 : comparison >= 0) return false
    }
    return true
  }

  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(value)
  if (hyphen) {
    return compareVersions(version, hyphen[1]) >= 0 && compareVersions(version, hyphen[2]) <= 0
  }

  let unknown = false
  for (const token of value.split(/[\s,]+/).filter(Boolean)) {
    const result = comparatorSatisfied(version, token)
    if (result === null) unknown = true
    else if (!result) return false
  }
  return unknown ? null : true
}

const BUILT_IN_DEPENDENCIES = new Set([
  'minecraft',
  'java',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'quilt-loader',
  'forge',
  'neoforge',
])

/**
 * Conservative, documented pairs. Only add a pair when the projects themselves
 * say they replace or conflict with each other; a false positive is worse than
 * a missed warning.
 */
export const KNOWN_INCOMPATIBLE = [
  {
    left: 'sodium',
    right: 'optifine',
    reason: 'Both replace Minecraft’s rendering pipeline; OptiFine is not compatible with Sodium.',
    source: 'Sodium FAQ — “OptiFine is not compatible with Sodium.”',
  },
  {
    left: 'rubidium',
    right: 'sodium',
    reason: 'Rubidium is a Sodium port for Forge; running both replaces the renderer twice.',
    source: 'Rubidium project page — “A Sodium port for Forge.”',
  },
  {
    left: 'embeddium',
    right: 'sodium',
    reason: 'Embeddium is a Sodium fork; both cannot own the renderer at once.',
    source: 'Embeddium project page — “A Sodium fork for Forge/NeoForge.”',
  },
  {
    left: 'iris',
    right: 'optifine',
    reason: 'Both install shader loaders and renderer patches that conflict.',
    source: 'Iris compatibility notes — use Iris with Sodium instead of OptiFine.',
  },
  {
    left: 'oculus',
    right: 'iris',
    reason: 'Both provide the Iris shader loader; install only one for the active loader.',
    source: 'Oculus project page — an Iris port for Forge.',
  },
]

function identity(file) {
  const metadata = file?.metadata && typeof file.metadata === 'object' ? file.metadata : {}
  const modId = typeof metadata.modId === 'string' && metadata.modId.trim() ? metadata.modId.trim().toLowerCase() : null
  return {
    filename: file?.filename || 'unknown file',
    name: metadata.name || file?.filename || 'Unknown mod',
    modId,
    metadata,
  }
}

function dependencyId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/** Pure conflict analysis over a content-index result plus profile loader/version. */
export function findConflicts(index = {}) {
  const files = (Array.isArray(index.files) ? index.files : [])
    .filter((file) => file && file.enabled !== false)
    .map(identity)
  const expectedLoader = typeof index.loader === 'string' && index.loader !== 'vanilla' ? index.loader : null
  const gameVersion = typeof index.gameVersion === 'string' && index.gameVersion.trim() ? index.gameVersion.trim() : null

  const byId = new Map()
  for (const file of files) {
    if (!file.modId) continue
    byId.set(file.modId, [...(byId.get(file.modId) ?? []), file])
  }

  const installedIds = new Set(byId.keys())
  const missingDependencies = []
  const duplicateIds = []
  const loaderMismatch = []
  const versionMismatch = []
  const seenMissing = new Set()

  for (const file of files) {
    const modId = file.modId
    const metadata = file.metadata
    for (const dependency of Array.isArray(metadata.requiredDependencies) ? metadata.requiredDependencies : []) {
      const id = dependencyId(dependency)
      if (!id || id === modId || BUILT_IN_DEPENDENCIES.has(id) || installedIds.has(id)) continue
      const key = `${file.filename}:${id}`
      if (seenMissing.has(key)) continue
      seenMissing.add(key)
      missingDependencies.push({
        dependencyId: id,
        filename: file.filename,
        modId,
        modName: file.name,
      })
    }

    if (expectedLoader && metadata.loader && metadata.loader !== expectedLoader) {
      loaderMismatch.push({
        filename: file.filename,
        name: file.name,
        modId,
        loader: metadata.loader,
        expectedLoader,
      })
    }

    if (gameVersion && metadata.mcRange) {
      const compatible = satisfiesVersionRange(gameVersion, metadata.mcRange)
      if (compatible === false) {
        versionMismatch.push({
          filename: file.filename,
          name: file.name,
          modId,
          range: metadata.mcRange,
          gameVersion,
        })
      }
    }
  }

  for (const [modId, entries] of byId) {
    if (entries.length < 2) continue
    duplicateIds.push({
      modId,
      files: entries.map((entry) => ({ filename: entry.filename, name: entry.name })),
    })
  }

  const knownIncompatible = []
  for (const pair of KNOWN_INCOMPATIBLE) {
    const left = byId.get(pair.left)?.[0]
    const right = byId.get(pair.right)?.[0]
    if (!left || !right) continue
    knownIncompatible.push({
      left: { filename: left.filename, name: left.name },
      right: { filename: right.filename, name: right.name },
      reason: pair.reason,
      source: pair.source,
    })
  }

  return {
    missingDependencies,
    duplicateIds,
    loaderMismatch,
    versionMismatch,
    knownIncompatible,
    total:
      missingDependencies.length +
      duplicateIds.length +
      loaderMismatch.length +
      versionMismatch.length +
      knownIncompatible.length,
  }
}
