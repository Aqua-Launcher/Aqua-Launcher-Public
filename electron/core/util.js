import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

const EXTERNAL_HOSTS = [
  'minecraft.net',
  'mojang.com',
  'microsoft.com',
  'microsoftonline.com',
  'live.com',
  'xbox.com',
  'azure.com',
  'aka.ms',
  'java.com',
  'adoptium.net',
  'crafatar.com',
  'mc-heads.net',
  'apps.microsoft.com',
  // Horizon (Minecraft: Java Edition rewritten in Rust) and its downloads.
  'playhorizon.dev',
  'github.com',
  // Bedrock add-on catalogues the launcher's in-app browser links out to.
  'mcpedl.com',
  'mcpeaddons.com',
  'modbay.org',
  'planetminecraft.com',
  'bedrocktweaks.net',
]

/** Windows Settings pages, e.g. `ms-settings:developers`. */
const SETTINGS_PAGE = /^[a-z0-9-]{2,64}$/

/**
 * Renderer-supplied links only open on an allow-listed web host, plus the
 * Windows Settings pages the launcher points people at.
 */
export function isAllowedExternalUrl(value, platform = process.platform) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return false
  }
  if (url.protocol === 'ms-settings:') {
    if (platform !== 'win32') return false
    const page = `${url.hostname}${url.pathname}`.replace(/^[/]+|[/]+$/g, '')
    return !url.search && !url.hash && SETTINGS_PAGE.test(page)
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return EXTERNAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function isPathInside(childPath, parentPath) {
  if (typeof childPath !== 'string' || typeof parentPath !== 'string') return false
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertPathInside(childPath, parentPath, label = 'Path') {
  if (!isPathInside(childPath, parentPath)) {
    throw new Error(`${label} must stay inside ${parentPath}`)
  }
  return path.resolve(childPath)
}

export function assertAbsolutePath(value, label = 'Path') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required.`)
  }
  if (value.includes('\0')) throw new Error(`${label} contains invalid characters.`)
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`)
  return path.normalize(value)
}

function resolvedForComparison(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrInside(childPath, parentPath) {
  const relative = path.relative(resolvedForComparison(parentPath), resolvedForComparison(childPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function canonicalizePath(value) {
  const resolved = path.resolve(value)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    try {
      return path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved))
    } catch {
      return resolved
    }
  }
}

/**
 * Reject game directories that would write launcher data into operating-system
 * protected locations. User folders, alternate drives and custom game folders
 * remain supported.
 */
export function assertSafeGameDirectory(value) {
  const absolute = assertAbsolutePath(value, 'Game directory')
  const canonical = canonicalizePath(absolute)
  const parsed = path.parse(canonical)
  if (resolvedForComparison(canonical) === resolvedForComparison(parsed.root)) {
    throw new Error('Choose a game folder rather than a drive root.')
  }

  const protectedRoots = []
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData']) {
      if (process.env[key]) protectedRoots.push(process.env[key])
    }
    for (const name of ['$Recycle.Bin', 'System Volume Information', 'Recovery']) {
      protectedRoots.push(path.join(parsed.root, name))
    }
  } else if (process.platform === 'darwin') {
    protectedRoots.push('/System', '/Library', '/private', '/usr', '/bin', '/sbin', '/dev')
  } else {
    protectedRoots.push('/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var')
  }

  for (const protectedRoot of protectedRoots) {
    if (protectedRoot && isSameOrInside(canonical, protectedRoot)) {
      throw new Error('Choose a game folder outside protected system locations.')
    }
  }
  return absolute
}

export function safeSegment(value, label = 'Name', maxLength = 96) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`)
  if (trimmed === '.' || trimmed === '..') throw new Error(`${label} is invalid.`)
  if (!/^[A-Za-z0-9._+() -]+$/.test(trimmed)) {
    throw new Error(`${label} can only contain letters, numbers, spaces, and . _ + ( ) -`)
  }
  return trimmed
}

export function cleanDisplayName(value, maxLength = 48) {
  if (typeof value !== 'string') throw new Error('Name is required.')
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name) throw new Error('Name is required.')
  if (name.length > maxLength) throw new Error(`Name must be ${maxLength} characters or fewer.`)
  return name
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 36)
}

export function sanitizeFileName(value, fallback = 'file') {
  const name = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  return name || fallback
}

export function parseJavaMajorVersion(versionString) {
  if (!versionString) return 0
  const value = String(versionString).trim()
  if (value.startsWith('1.')) {
    const major = Number(value.split('.')[1])
    return Number.isFinite(major) ? major : 0
  }
  const match = value.match(/^(\d+)/)
  return match ? Number(match[1]) : 0
}

/** Parse user supplied arguments without invoking a shell. Supports quotes and escapes. */
export function parseArguments(input) {
  if (!input || !String(input).trim()) return []
  const source = String(input)
  if (source.length > 8000) throw new Error('Custom arguments are too long.')
  if (source.includes('\0')) throw new Error('Custom arguments contain invalid characters.')
  const args = []
  let current = ''
  let quote = null
  let escaping = false
  let hasContent = false
  for (const char of source) {
    if (escaping) {
      current += char
      escaping = false
      hasContent = true
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      hasContent = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasContent = true
      continue
    }
    if (/\s/.test(char)) {
      if (hasContent) {
        args.push(current)
        current = ''
        hasContent = false
      }
      continue
    }
    current += char
    hasContent = true
  }
  if (escaping) current += '\\'
  if (quote) throw new Error('Custom arguments contain an unclosed quote.')
  if (hasContent) args.push(current)
  return args
}

export function tokenizeMcString(value) {
  if (typeof value !== 'string') return []
  return value.split(/\s+/).filter(Boolean)
}

export async function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function sha1Text(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

export async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

export async function directoryExists(dirPath) {
  try {
    const stat = await fsp.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true })
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

export async function atomicWriteFile(filePath, data, options = {}) {
  const directory = path.dirname(filePath)
  await ensureDir(directory)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tempPath, data, options)
  try {
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {})
    await fsp.rename(tempPath, filePath)
    if (error && error.code !== 'EEXIST' && error.code !== 'EPERM') {
      // A retry after removing the destination will surface a real filesystem error.
    }
  }
}

export async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
}

export function relativeTime(dateValue) {
  const date = new Date(dateValue)
  const diff = Date.now() - date.getTime()
  if (!Number.isFinite(diff)) return 'Unknown'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

export function errorMessage(error) {
  if (!error) return 'Unknown error'
  if (error instanceof Error) return error.message
  return String(error)
}

export function redactArguments(args, secrets = []) {
  const sensitiveFlags = new Set([
    '--accessToken',
    '--identityToken',
    '--clientSecret',
    '--refreshToken',
    '--sessionToken',
  ])
  const secretList = secrets.filter(Boolean)
  return args.map((arg, index) => {
    if (sensitiveFlags.has(args[index - 1])) return '<redacted>'
    if (secretList.some((secret) => arg === secret)) return '<redacted>'
    return arg
  })
}

export async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    attempts = 2,
    timeoutMs = 25_000,
    logger = null,
    retryStatuses = [408, 425, 429, 500, 502, 503, 504],
  } = config
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      })
      if (!response.ok) {
        if (retryStatuses.includes(response.status) && attempt < attempts) {
          await sleep(400 * attempt)
          continue
        }
        const body = await response.text().catch(() => '')
        throw Object.assign(
          new Error(`Request failed (HTTP ${response.status})${body ? `: ${body.slice(0, 240)}` : ''}`),
          { status: response.status, url, body },
        )
      }
      return response
    } catch (error) {
      lastError = error
      if (error?.name === 'AbortError' && options.signal?.aborted) throw error
      if (attempt >= attempts) throw error
      logger?.debug?.(`Retrying request (${attempt}/${attempts}): ${url}`, {
        message: errorMessage(error),
      })
      await sleep(500 * attempt)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

export async function fetchJson(url, options = {}, config = {}) {
  const response = await fetchWithRetry(
    url,
    {
      ...options,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AquaLauncher/1.0.0',
        ...(options.headers || {}),
      },
    },
    config,
  )
  return response.json()
}

export function randomId() {
  return crypto.randomUUID()
}

export function runId() {
  return `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

export function uniqueName(baseName, existingNames) {
  const names = new Set(existingNames.map((name) => name.toLowerCase()))
  if (!names.has(baseName.toLowerCase())) return baseName
  let copy = `${baseName} Copy`
  if (!names.has(copy.toLowerCase())) return copy
  let index = 2
  while (names.has(`${baseName} Copy ${index}`.toLowerCase())) index += 1
  return `${baseName} Copy ${index}`
}

export async function findNewestFile(dirPath, extension = '.txt', afterMs = 0) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const candidates = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (extension && !entry.name.toLowerCase().endsWith(extension)) continue
      const filePath = path.join(dirPath, entry.name)
      const stat = await fsp.stat(filePath)
      if (stat.mtimeMs >= afterMs) candidates.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size })
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return candidates[0] || null
  } catch {
    return null
  }
}

export async function pruneDirectory(dirPath, keepFiles = 20) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const filePath = path.join(dirPath, entry.name)
      const stat = await fsp.stat(filePath)
      files.push({ filePath, mtimeMs: stat.mtimeMs })
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    await Promise.all(files.slice(keepFiles).map((file) => fsp.rm(file.filePath, { force: true })))
  } catch {
    // Pruning is best effort.
  }
}
