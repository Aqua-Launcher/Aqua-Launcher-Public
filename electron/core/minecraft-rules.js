import os from 'node:os'

export const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'

export function getPlatformContext(features = {}) {
  const architecture = os.arch()
  return {
    os: {
      name: OS_NAME,
      arch: architecture === 'x64' ? 'x86_64' : architecture === 'ia32' ? 'x86' : architecture,
      version: os.release(),
    },
    features: {
      is_demo_user: false,
      has_custom_resolution: true,
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false,
      ...features,
    },
  }
}

export function ruleMatches(rule, context) {
  if (!rule || typeof rule !== 'object') return false
  if (rule.os) {
    if (rule.os.name && rule.os.name !== context.os.name) return false
    if (rule.os.arch && rule.os.arch !== context.os.arch) return false
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(context.os.version)) return false
      } catch {
        return false
      }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if (Boolean(context.features?.[key]) !== Boolean(value)) return false
    }
  }
  return true
}

export function rulesAllow(rules, context) {
  if (!Array.isArray(rules) || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (!ruleMatches(rule, context)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

export function mavenPath(name) {
  if (typeof name !== 'string') throw new Error('Invalid Maven coordinate.')
  const [coordinate, extension = 'jar'] = name.split('@')
  const parts = coordinate.split(':')
  if (parts.length < 3) throw new Error(`Invalid Maven coordinate: ${name}`)
  const [group, artifact, version, classifier] = parts
  const groupPath = group.split('.').join('/')
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`
  return `${groupPath}/${artifact}/${version}/${fileName}`
}

export function nativeClassifier(library, context) {
  const template = library?.natives?.[context.os.name]
  if (!template) return null
  const archBits = context.os.arch === 'x86_64' || context.os.arch === 'arm64' ? '64' : '32'
  return template.replace('${arch}', archBits)
}

/**
 * Identifies a library by Maven artifact rather than by its full coordinate.
 * Loader profiles inherit a Mojang version and often carry a newer build of the
 * same artifact (ASM is the common one). Java can only load one copy of a
 * class, so the classpath keeps the loader's build and drops the parent's.
 */
export function libraryArtifactKey(library) {
  const name = typeof library?.name === 'string' ? library.name.trim() : ''
  if (!name) return null
  const [coordinate, extension = 'jar'] = name.split('@')
  const parts = coordinate.split(':')
  if (parts.length < 3) return null
  const [group, artifact, , classifier] = parts
  if (!group || !artifact) return null
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}@${extension}`
}

/**
 * Later entries win, matching the parent→child order produced by mergeVersions.
 * Different classifiers (base jars, natives) and extensions stay separate.
 */
export function dedupeLibraries(libraries) {
  const unique = new Map()
  for (const library of libraries) {
    const key = libraryArtifactKey(library)
    if (!key) {
      // Unnamed entries cannot be compared safely, so keep them all.
      unique.set(Symbol('library'), library)
      continue
    }
    unique.set(key, library)
  }
  return [...unique.values()]
}

export function applicableLibraries(version, context) {
  const libraries = Array.isArray(version?.libraries) ? version.libraries : []
  // Rules run first: if a loader's OS-specific override does not apply here,
  // the Mojang library it would have replaced must remain on the classpath.
  return dedupeLibraries(libraries.filter((library) => rulesAllow(library.rules, context)))
}

export function collectArgumentEntries(entries, context) {
  const output = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry === 'string') {
      output.push(entry)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    if (!rulesAllow(entry.rules, context)) continue
    if (Array.isArray(entry.value)) output.push(...entry.value.filter((item) => typeof item === 'string'))
    else if (typeof entry.value === 'string') output.push(entry.value)
  }
  return output
}

export function substituteTokens(value, tokens, { strict = false } = {}) {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{([^}]+)\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) {
      return tokens[key] == null ? '' : String(tokens[key])
    }
    if (strict) throw new Error(`Unknown launch placeholder: \${${key}}`)
    return ''
  })
}

export function mergeVersions(parent, child) {
  if (!parent) return { ...child, jarVersionId: child.jarVersionId || child.id }
  const libraryMap = new Map()
  for (const library of [...(parent.libraries || []), ...(child.libraries || [])]) {
    const key = library.name || `${library.downloads?.artifact?.path || ''}-${library.natives ? 'native' : 'lib'}`
    libraryMap.set(key, library)
  }
  const argumentsMerged = {
    game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
    jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
  }
  const merged = {
    ...parent,
    ...child,
    id: child.id,
    inheritsFrom: undefined,
    libraries: [...libraryMap.values()],
    arguments: argumentsMerged,
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    mainClass: child.mainClass || parent.mainClass,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    javaVersion: child.javaVersion || parent.javaVersion,
    logging: child.logging || parent.logging,
    downloads: child.downloads?.client ? child.downloads : parent.downloads,
    jarVersionId: child.downloads?.client ? child.id : parent.jarVersionId || parent.id,
  }
  if (!argumentsMerged.game.length && !argumentsMerged.jvm.length) delete merged.arguments
  return merged
}

export function isModernArguments(version) {
  return Boolean(version?.arguments && (Array.isArray(version.arguments.game) || Array.isArray(version.arguments.jvm)))
}

export function versionTypeLabel(type) {
  switch (type) {
    case 'release':
      return 'Release'
    case 'snapshot':
      return 'Snapshot'
    case 'old_beta':
      return 'Beta'
    case 'old_alpha':
      return 'Alpha'
    default:
      return type || 'Release'
  }
}
