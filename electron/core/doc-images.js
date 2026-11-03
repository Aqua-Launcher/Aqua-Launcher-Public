/**
 * Images referenced by the two bundled documents (README.md and ROADMAP.md).
 *
 * The renderer's CSP keeps `img-src` narrow, and the documents are bundled
 * rather than user-supplied text, so the main process fetches an https image
 * once, checks that it really is an image and not absurdly large, and hands the
 * renderer a data URL. The cache is in memory only: the documents are static,
 * and a restart should not keep a stale image forever.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const CACHE_ENTRIES = 24
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
])
// Literal private/local hosts are refused so a document cannot be edited into a
// probe of the machine or its network. DNS names that resolve privately are the
// network's responsibility, not something a URL check can settle.
const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\]|.*\.local)$/i

/** Validates an image address from a document. Throws a sentence on failure. */
export function parseDocImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('An image address is required.')
  if (value.length > 2048) throw new Error('That image address is too long.')
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('That image address is not valid.')
  }
  if (url.protocol !== 'https:') throw new Error('Document images must use https.')
  if (url.username || url.password) throw new Error('That image address is not allowed.')
  if (PRIVATE_HOST.test(url.hostname)) throw new Error('That image host is not allowed.')
  return url
}

export class DocImageService {
  constructor({ logger = null, fetchImpl = globalThis.fetch } = {}) {
    this.logger = logger
    this.fetchImpl = fetchImpl
    /** @type {Map<string, Promise<string>>} */
    this.cache = new Map()
  }

  async load(value) {
    const url = parseDocImageUrl(value)
    const key = url.href
    const cached = this.cache.get(key)
    if (cached) return cached

    const pending = this.download(url)
    this.cache.set(key, pending)
    while (this.cache.size > CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (!oldest || oldest === key) break
      this.cache.delete(oldest)
    }

    try {
      return await pending
    } catch (error) {
      this.cache.delete(key)
      this.logger?.warn('Could not load a document image', { url: key, message: error.message })
      throw error
    }
  }

  async download(url) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Images cannot be loaded in this build.')
    const response = await this.fetchImpl(url.href, {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response?.ok) {
      throw new Error(`The image could not be loaded (HTTP ${response?.status ?? 0}).`)
    }
    const type = String(response.headers?.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!IMAGE_TYPES.has(type)) throw new Error('That address did not return an image.')
    const declared = Number(response.headers?.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      throw new Error('That image is too large to show in the launcher.')
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('That image is too large to show in the launcher.')
    return `data:${type};base64,${bytes.toString('base64')}`
  }
}
