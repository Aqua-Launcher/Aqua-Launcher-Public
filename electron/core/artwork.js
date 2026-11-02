import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, ensureDir, fetchJson, fetchWithRetry, readJsonFile, sanitizeFileName } from './util.js'

const PATCH_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json'
const NEWS_URL = 'https://launchercontent.mojang.com/v2/news.json'
const UPDATES_PAGE_URL = 'https://www.minecraft.net/en-us/updates'
const COLLECTIBLES_URL = 'https://www.minecraft.net/en-us/collectibles'
const CONTENT_HOST = 'launchercontent.mojang.com'
const SITE_HOST = 'www.minecraft.net'
const CONTENT_BASE = `https://${CONTENT_HOST}`
const SITE_BASE = `https://${SITE_HOST}`
const NOTES_TTL_MS = 6 * 60 * 60 * 1000
const DROPS_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ZIP_BYTES = 40 * 1024 * 1024
// Packs hold 4K PNGs; decoding something absurd is not worth it, and the window
// only ever needs a 1080p-wide still.
const MAX_SOURCE_BYTES = 12 * 1024 * 1024
const MAX_SOURCE_WIDTH = 4096
const OUTPUT_WIDTH = 1920
const OUTPUT_QUALITY = 86
// Bumped whenever the artwork pipeline changes, so stale cache entries from an
// older build are ignored instead of being served forever.
const DROP_CACHE_VERSION = 5
// Aqua serves its own version artwork, so the dashboard does not have to unpack
// Mojang's 4K wallpaper archives. Mojang's packs remain the fallback.
const AQUA_ARTWORK_BASE = 'https://aqua.ch1n.dev/api/launcher/artwork'
const AQUA_ARTWORK_TTL_MS = 24 * 60 * 60 * 1000
// A version with no art yet is retried later, so newly uploaded art appears.
const AQUA_ARTWORK_MISS_TTL_MS = 10 * 60 * 1000
const MAX_AQUA_ARTWORK_BYTES = 12 * 1024 * 1024
// Newer releases are probed in order until the update's artwork is found.
const AQUA_ARTWORK_PROBES = 8
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PAGE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; AquaLauncher/1.0.0)', Accept: 'text/html' }

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Drop names are written differently in every source ("Trails & Tales" in a
 * patch note, "Trails and Tales" in a heading), so they are compared on letters
 * and digits only.
 */
export function normalizeDropName(value) {
  return String(value ?? '')
    .replace(/&#x26;|&amp;/gi, 'and')
    .replace(/&/g, 'and')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Patch-note bodies are escaped HTML; the drop name hides behind entities. */
export function plainText(html) {
  return String(html ?? '')
    .replace(/&#x26;|&amp;/gi, '&')
    .replace(/<[^>]*>/g, ' ')
}

/** The Aqua artwork endpoint for a Minecraft version. */
export function aquaArtworkUrl(versionId) {
  return `${AQUA_ARTWORK_BASE}/${encodeURIComponent(String(versionId ?? '').trim())}.png`
}

/** Dotted numeric versions compare part by part, missing parts counting as 0. */
function compareVersionParts(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = Number(left[index] ?? 0) - Number(right[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/**
 * Releases newer than a version inside its own update line. Artwork is named
 * after the last release of each update, so the first of these that exists is
 * the art covering the version. The line is the leading major.minor, which
 * keeps 1.5 from borrowing 1.6's art.
 */
export function laterReleasesInLine(versions, versionId) {
  const id = String(versionId ?? '').trim()
  const line = /^(\d+)\.(\d+)/.exec(id)
  if (!line) return []
  const asked = (id.match(/\d+/g) || []).slice(0, 3).map(Number)
  const later = []
  for (const entry of Array.isArray(versions) ? versions : []) {
    if (entry?.type !== 'release') continue
    const releaseId = String(entry.id ?? '')
    const parts = releaseId.split('.')
    if (parts.length < 3 || parts.some((part) => !/^\d+$/.test(part))) continue
    if (parts[0] !== line[1] || parts[1] !== line[2]) continue
    const numbers = parts.map((part) => Number(part))
    if (!(compareVersionParts(numbers, asked) > 0)) continue
    later.push({ id: releaseId, numbers })
  }
  return later.sort((a, b) => compareVersionParts(a.numbers, b.numbers)).map((entry) => entry.id)
}

/** The versions that can stand in for a profile's version, newest first. */
export function baseVersionCandidates(versionId) {
  const id = String(versionId ?? '').trim()
  if (!id) return []
  const candidates = [id]
  const parts = id.split('.')
  if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1])) candidates.push(parts.slice(0, -1).join('.'))
  return candidates
}

/** The game drops Mojang lists on its updates page, named by their key art. */
export function parseDropNames(html) {
  const text = String(html ?? '')
  const names = new Map()
  const add = (name) => {
    const key = normalizeDropName(name)
    if (key && !names.has(key)) names.set(key, { key, name })
  }
  const pattern = /key-art\/(MC-Updates_Carousel-N-0_\d{4}_([A-Za-z0-9-]+?)_0\d_\d+x\d+\.(?:jpg|jpeg|png|webp))/gi
  for (const match of text.matchAll(pattern)) {
    const slug = match[2].replace(/-/g, ' ')
    // Mojang's file names drift from the drop's real name ("Trails-and-Tails"
    // for "Trails & Tales"), and the image alt text carries the real one.
    const alt = text.slice(match.index, match.index + 900).match(/alt="([^"]*)"/i)?.[1] || ''
    const named = alt.match(/(?:text reads:|text:)\s*Minecraft\s*(.+)$/i)?.[1]?.trim()
    add(named || slug)
  }
  return names
}

/** The launcher's own news feed announces each drop as "Play <Drop>". */
export function parseDropCardNames(payload) {
  const names = new Map()
  for (const entry of Array.isArray(payload?.entries) ? payload.entries : []) {
    if (!/^play\s+/i.test(entry?.title || '')) continue
    if (!Array.isArray(entry.newsType) || !entry.newsType.includes('Java')) continue
    const name = entry.title.replace(/^play\s+/i, '').replace(/\s+today$/i, '').trim()
    const key = normalizeDropName(name)
    if (key && !names.has(key)) names.set(key, { key, name })
  }
  return names
}

/**
 * Mojang's collectibles page lists one wallpaper pack per drop, each slide
 * carrying the drop's name and the zip that holds every resolution.
 */
export function parseWallpaperPacks(html) {
  const text = String(html ?? '')
  const packs = new Map()
  for (const anchor of text.matchAll(/<a[^>]+href="([^"]+\.zip)"[^>]*>/gi)) {
    const label = anchor[0].match(/aria-label="([^"]*)"/i)?.[1] || ''
    // Game-wide and other-franchise packs are labelled "Download the … wallpaper".
    if (!/themed\s+wallpapers?$/i.test(label)) continue
    const block = text.slice(anchor.index, anchor.index + 2600)
    const heading = block.match(/MC_Carousel_track_slide_text_heading[^>]*>([^<]+)</i)?.[1]
    const name = String(heading || '').replace(/\s+/g, ' ').trim()
    const key = normalizeDropName(name)
    if (!key || packs.has(key)) continue
    try {
      const url = new URL(anchor[1], SITE_BASE)
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== SITE_HOST) continue
      if (!url.toString().includes('/software/')) continue
      packs.set(key, { key, name, zipUrl: url.toString() })
    } catch {
      continue
    }
  }
  return packs
}

/** The drop a version belongs to: whichever drop its patch note names. */
export function findDropForText(drops, text) {
  const haystack = normalizeDropName(text)
  if (!haystack) return null
  let best = null
  for (const [key, drop] of drops) {
    if (!key || !haystack.includes(key)) continue
    if (!best || key.length > best.key.length) best = { key, drop }
  }
  return best?.key ? best.drop : null
}

/** Image dimensions straight from the file header, so no decoder is needed. */
export function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return null
}

/**
 * The packs ship desktop, mobile and square crops of the same art; pick the
 * biggest landscape still and let the window-side encode bring it down to size.
 */
export function pickWallpaper(files) {
  const candidates = []
  for (const file of Array.isArray(files) ? files : []) {
    const size = imageSize(file?.bytes)
    if (!size || !file.bytes?.length) continue
    if (file.bytes.length > MAX_SOURCE_BYTES || size.width > MAX_SOURCE_WIDTH) continue
    candidates.push({ ...file, ...size, area: size.width * size.height })
  }
  const landscape = candidates.filter((file) => file.width >= file.height * 1.2)
  const pool = landscape.length ? landscape : candidates
  return pool.sort((a, b) => b.area - a.area)[0] || null
}

/**
 * Packs are PNGs up to 4K; Electron's own image pipeline turns the chosen still
 * into a window-sized JPEG, so the renderer never receives a multi-megabyte URL.
 */
async function encodeWallpaper(bytes) {
  try {
    const { nativeImage } = await import('electron')
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return null
    const { width } = image.getSize()
    const sized = width > OUTPUT_WIDTH ? image.resize({ width: OUTPUT_WIDTH, quality: 'best' }) : image
    const encoded = sized.toJPEG(OUTPUT_QUALITY)
    return encoded?.length ? encoded : null
  } catch {
    // No Electron image pipeline (unit tests, plain Node): keep the original.
    return null
  }
}

/**
 * The dashboard artwork for Minecraft versions: the wallpaper pack of the game
 * drop each version belongs to, cached locally so it works offline.
 */
export class ArtworkService {
  constructor({ paths, versions = null, logger }) {
    this.paths = paths
    this.versions = versions
    this.logger = logger
    this.index = null
    this.indexAt = 0
    this.pendingIndex = null
    this.drops = null
    this.dropsAt = 0
    this.pendingDrops = null
    this.notes = new Map()
    this.aquaMisses = new Map()
  }

  async getPatchNotes({ force = false } = {}) {
    if (!force && this.index && Date.now() - this.indexAt < NOTES_TTL_MS) return this.index
    if (!force && this.pendingIndex) return this.pendingIndex
    const cached = await readJsonFile(this.paths.patchNotesCacheFile, null)
    const cachedEntries = Array.isArray(cached?.entries) ? cached.entries : null
    const cachedAt = cached?.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0
    if (!force && cachedEntries?.length && Date.now() - cachedAt < NOTES_TTL_MS) {
      this.index = cachedEntries
      this.indexAt = Date.now()
      return this.index
    }

    this.pendingIndex = (async () => {
      try {
        const payload = await fetchJson(
          PATCH_NOTES_URL,
          { headers: { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 2, timeoutMs: 20_000, logger: this.logger },
        )
        const entries = Array.isArray(payload?.entries) ? payload.entries : []
        if (!entries.length) throw new Error('Mojang returned no patch notes.')
        await atomicWriteJson(this.paths.patchNotesCacheFile, { fetchedAt: new Date().toISOString(), entries })
        this.index = entries
        this.indexAt = Date.now()
        return entries
      } catch (error) {
        this.logger.warn('Could not load Minecraft patch notes', { message: error.message })
        if (cachedEntries?.length) {
          this.index = cachedEntries
          this.indexAt = Date.now()
          return cachedEntries
        }
        return []
      } finally {
        this.pendingIndex = null
      }
    })()
    return this.pendingIndex
  }

  async getPageText(url) {
    const response = await fetchWithRetry(url, { headers: PAGE_HEADERS }, { attempts: 2, timeoutMs: 25_000, logger: this.logger })
    return response.text()
  }

  /** Game drops that also have a downloadable wallpaper pack. */
  async getDrops({ force = false } = {}) {
    if (!force && this.drops && Date.now() - this.dropsAt < DROPS_TTL_MS) return this.drops
    if (!force && this.pendingDrops) return this.pendingDrops
    const cached = await readJsonFile(this.paths.dropsCacheFile, null)
    const cachedDrops = Array.isArray(cached?.drops) ? cached.drops : null
    const cachedAt = cached?.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0
    if (!force && cachedDrops?.length && Date.now() - cachedAt < DROPS_TTL_MS) {
      this.drops = new Map(cachedDrops.map((drop) => [drop.key, drop]))
      this.dropsAt = Date.now()
      return this.drops
    }

    this.pendingDrops = (async () => {
      const names = new Map()
      try {
        for (const [key, entry] of parseDropNames(await this.getPageText(UPDATES_PAGE_URL))) names.set(key, entry)
      } catch (error) {
        this.logger.warn('Could not load Minecraft drop names', { message: error.message })
      }
      try {
        const payload = await fetchJson(
          NEWS_URL,
          { headers: { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 2, timeoutMs: 20_000, logger: this.logger },
        )
        for (const [key, entry] of parseDropCardNames(payload)) if (!names.has(key)) names.set(key, entry)
      } catch (error) {
        this.logger.warn('Could not load Minecraft news names', { message: error.message })
      }

      let packs = new Map()
      try {
        packs = parseWallpaperPacks(await this.getPageText(COLLECTIBLES_URL))
      } catch (error) {
        this.logger.warn('Could not load Minecraft wallpaper packs', { message: error.message })
      }

      // Only names Mojang treats as game drops keep a pack, which is what keeps
      // Dungeons, Legends and marketplace wallpapers out of the dashboard.
      const drops = new Map()
      for (const [key, entry] of names) {
        const pack = packs.get(key)
        if (pack) drops.set(key, { key, name: entry.name || pack.name, zipUrl: pack.zipUrl })
      }

      if (drops.size) {
        await atomicWriteJson(this.paths.dropsCacheFile, { fetchedAt: new Date().toISOString(), drops: [...drops.values()] })
        this.drops = drops
        this.dropsAt = Date.now()
        this.logger.info('Loaded Minecraft drop wallpapers', { drops: drops.size })
        return drops
      }
      if (cachedDrops?.length) {
        this.logger.warn('Using cached Minecraft drop wallpapers')
        this.drops = new Map(cachedDrops.map((drop) => [drop.key, drop]))
        this.dropsAt = Date.now()
        return this.drops
      }
      return drops
    })()
    try {
      return await this.pendingDrops
    } finally {
      this.pendingDrops = null
    }
  }

  /** The text of a version's patch notes, used to recognise its drop. */
  async getPatchNoteText(versionId) {
    if (this.notes.has(versionId)) return this.notes.get(versionId)
    let text = ''
    const entries = await this.getPatchNotes()
    const entry = entries.find((each) => each?.version === versionId)
    if (entry?.contentPath) {
      try {
        const response = await fetchWithRetry(
          `${CONTENT_BASE}/v2/${entry.contentPath}`,
          { headers: { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 2, timeoutMs: 20_000, logger: this.logger },
        )
        const payload = JSON.parse(await response.text())
        text = plainText(`${payload?.title || ''} ${payload?.body || ''}`)
      } catch (error) {
        this.logger.debug('Could not read Minecraft patch note text', { version: versionId, message: error.message })
      }
    }
    this.notes.set(versionId, text)
    return text
  }

  async resolveDrop(versionId) {
    const cacheFile = path.join(this.paths.artworkCacheRoot, `${sanitizeFileName(versionId, 'version')}.drop.json`)
    const cached = await readJsonFile(cacheFile, null)
    if (cached?.dropKey && cached.cacheVersion === DROP_CACHE_VERSION) return cached
    const drops = await this.getDrops()
    if (!drops.size) return null
    let resolved = null
    for (const candidate of baseVersionCandidates(versionId)) {
      const drop = findDropForText(drops, await this.getPatchNoteText(candidate))
      if (drop) {
        resolved = { version: candidate, dropKey: drop.key, dropName: drop.name }
        break
      }
    }
    if (!resolved) return null
    await atomicWriteJson(cacheFile, { ...resolved, cacheVersion: DROP_CACHE_VERSION })
    return { ...resolved, cacheVersion: DROP_CACHE_VERSION }
  }

  /** Extract the best image from a drop's wallpaper pack. */
  async wallpaperBytes(pack) {
    const extensionOf = (name) => path.extname(String(name)).toLowerCase()
    const stem = `${sanitizeFileName(pack.key, 'drop')}-wallpaper-${OUTPUT_WIDTH}`
    const cachedName = (await fsp.readdir(this.paths.artworkCacheRoot).catch(() => [])).find(
      (name) => name.startsWith(`${stem}.`) && /\.(jpg|jpeg|png|webp)$/i.test(name),
    )
    if (cachedName) {
      const bytes = await fsp.readFile(path.join(this.paths.artworkCacheRoot, cachedName)).catch(() => null)
      if (bytes?.length) return { bytes, mime: MIME_BY_EXTENSION[extensionOf(cachedName)] || 'image/jpeg', cached: true }
    }

    const zipFile = path.join(this.paths.artworkCacheRoot, `${pack.key}.zip`)
    let zipBytes = await fsp.readFile(zipFile).catch(() => null)
    if (!zipBytes) {
      const response = await fetchWithRetry(
        pack.zipUrl,
        { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
        { attempts: 3, timeoutMs: 60_000, logger: this.logger },
      )
      zipBytes = Buffer.from(await response.arrayBuffer())
      if (!zipBytes.length || zipBytes.length > MAX_ZIP_BYTES) throw new Error('The wallpaper pack is unusable.')
      if (zipBytes.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('The wallpaper pack is not a zip archive.')
      await ensureDir(this.paths.artworkCacheRoot)
      await fsp.writeFile(zipFile, zipBytes)
    }

    const zip = new AdmZip(zipBytes)
    const files = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && /\.(jpg|jpeg|png|webp)$/i.test(entry.entryName))
      .map((entry) => ({ name: entry.entryName, bytes: entry.getData() }))
    const picked = pickWallpaper(files)
    // The pack is only needed until its artwork is on disk; the zip is a one-off
    // download, not something worth keeping in the cache folder.
    await fsp.rm(zipFile, { force: true }).catch(() => {})
    if (!picked) throw new Error('The wallpaper pack held no usable image.')
    const encoded = await encodeWallpaper(picked.bytes)
    const bytes = encoded || picked.bytes
    const extension = encoded ? '.jpg' : extensionOf(picked.name) || '.jpg'
    await ensureDir(this.paths.artworkCacheRoot)
    await fsp.writeFile(path.join(this.paths.artworkCacheRoot, `${stem}${extension}`), bytes)
    return { bytes, mime: MIME_BY_EXTENSION[extension] || 'image/jpeg', cached: false }
  }

  /**
   * Aqua's own artwork for a version, cached on disk so it keeps working
   * offline. A miss is remembered briefly so a version without art does not
   * hit the endpoint on every render.
   */
  async aquaArtwork(versionId) {
    const cacheFile = this.artworkCachePath(versionId)
    const cached = await fsp.readFile(cacheFile).catch(() => null)
    if (cached?.length) {
      const stat = await fsp.stat(cacheFile).catch(() => null)
      if (stat && Date.now() - stat.mtimeMs < AQUA_ARTWORK_TTL_MS) {
        return { version: versionId, bytes: cached, mime: 'image/png', cached: true }
      }
    }

    let resolved = null
    const exact = await this.downloadAquaArt(versionId)
    if (exact) resolved = { version: versionId, bytes: exact }
    if (!resolved) {
      const fallbacks = await this.aquaFallbacks(versionId)
      for (const candidate of fallbacks.slice(0, AQUA_ARTWORK_PROBES)) {
        const bytes = await this.downloadAquaArt(candidate)
        if (bytes) {
          resolved = { version: candidate, bytes }
          break
        }
      }
    }

    if (resolved) {
      // Repeat lookups of this version read the same file.
      if (resolved.version !== versionId) await fsp.writeFile(cacheFile, resolved.bytes).catch(() => {})
      return { ...resolved, mime: 'image/png', cached: false }
    }
    // A stale file still beats no background when the endpoint is unreachable.
    return cached?.length ? { version: versionId, bytes: cached, mime: 'image/png', cached: true } : null
  }

  /** Where a version's artwork lives on disk. */
  artworkCachePath(versionId) {
    return path.join(this.paths.artworkCacheRoot, `${sanitizeFileName(versionId, 'version')}.aqua.png`)
  }

  /** A cached PNG that has not gone stale yet. */
  async freshAquaArt(versionId) {
    const file = this.artworkCachePath(versionId)
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat || Date.now() - stat.mtimeMs >= AQUA_ARTWORK_TTL_MS) return null
    const bytes = await fsp.readFile(file).catch(() => null)
    return bytes?.length ? bytes : null
  }

  /** Download one artwork file, remembering misses so they are not retried. */
  async downloadAquaArt(versionId) {
    if (Date.now() - (this.aquaMisses.get(versionId) || 0) < AQUA_ARTWORK_MISS_TTL_MS) return null
    const cached = await this.freshAquaArt(versionId)
    if (cached) return cached
    try {
      const response = await fetchWithRetry(
        aquaArtworkUrl(versionId),
        { headers: { Accept: 'image/png', 'User-Agent': 'AquaLauncher/1.0.0' } },
        { attempts: 1, timeoutMs: 15_000, logger: this.logger },
      )
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length || bytes.length > MAX_AQUA_ARTWORK_BYTES) throw new Error('The artwork is unusable.')
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('The artwork is not a PNG image.')
      await ensureDir(this.paths.artworkCacheRoot)
      await fsp.writeFile(this.artworkCachePath(versionId), bytes)
      this.aquaMisses.delete(versionId)
      this.logger.info('Downloaded Aqua artwork', { version: versionId })
      return bytes
    } catch (error) {
      this.aquaMisses.set(versionId, Date.now())
      this.logger.debug('No Aqua artwork for this version', { version: versionId, message: error.message })
      return null
    }
  }

  /** Later releases whose update art could cover this version. */
  async aquaFallbacks(versionId) {
    if (!this.versions) return []
    try {
      const manifest = await this.versions.getManifest()
      return laterReleasesInLine(manifest?.versions, versionId)
    } catch (error) {
      this.logger.debug('Could not look up newer releases for artwork', {
        version: versionId,
        message: error.message,
      })
      return []
    }
  }

  async getVersionArt(versionId) {
    const requested = typeof versionId === 'string' ? versionId.trim() : ''
    if (!requested) return null
    try {
      const aqua = await this.aquaArtwork(requested)
      if (aqua) {
        return {
          version: aqua.version,
          title: `Minecraft ${aqua.version}`,
          type: 'aqua',
          dataUrl: `data:${aqua.mime};base64,${aqua.bytes.toString('base64')}`,
        }
      }
    } catch (error) {
      this.logger.warn('Could not load Aqua artwork', { version: requested, message: error.message })
    }
    try {
      const resolved = await this.resolveDrop(requested)
      if (!resolved) return null
      const pack = (await this.getDrops()).get(resolved.dropKey)
      if (!pack?.zipUrl) return null
      const { bytes, mime, cached } = await this.wallpaperBytes(pack)
      if (!cached) {
        this.logger.info('Downloaded Minecraft drop wallpaper', { version: resolved.version, drop: pack.name })
      }
      return {
        version: resolved.version,
        title: pack.name,
        type: 'drop',
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      }
    } catch (error) {
      this.logger.warn('Could not prepare Minecraft drop wallpaper', { version: requested, message: error.message })
      return null
    }
  }
}

export { COLLECTIBLES_URL, CONTENT_HOST, PATCH_NOTES_URL, SITE_HOST, UPDATES_PAGE_URL }
