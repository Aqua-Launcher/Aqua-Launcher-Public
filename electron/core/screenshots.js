import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from './util.js'

export const SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])
const MAX_HEADER_BYTES = 512 * 1024
const THUMBNAIL_CONCURRENCY = 3

function dimensionsFromPng(bytes) {
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null
  if (bytes[0] !== 0x89 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function dimensionsFromJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (sofMarkers.has(marker) && length >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

/** Reads only the header bytes needed for dimensions; full decode would stall on a large folder. */
export async function readImageDimensions(file) {
  let handle
  try {
    handle = await fsp.open(file, 'r')
    const buffer = Buffer.alloc(MAX_HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (!bytesRead) return null
    const bytes = buffer.subarray(0, bytesRead)
    return dimensionsFromPng(bytes) || dimensionsFromJpeg(bytes)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

function validateFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('Choose a screenshot.')
  if (filename.length > 255 || filename !== path.basename(filename) || filename.includes('\0')) {
    throw new Error('That screenshot name is invalid.')
  }
  if (!SCREENSHOT_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
    throw new Error('That file is not a supported screenshot.')
  }
  return filename
}

export class ScreenshotService {
  constructor({ paths, nativeImage, trashItem, logger } = {}) {
    this.paths = paths || {}
    this.nativeImage = nativeImage || null
    this.trashItem = trashItem || null
    this.logger = logger || null
    this.active = 0
    this.waiters = []
    this.pendingThumbnails = new Map()
  }

  directoryFor(installation) {
    if (!installation?.gameDir) throw new Error('Installation not found.')
    return path.join(installation.gameDir, 'screenshots')
  }

  sourcePath(installation, filename) {
    return path.join(this.directoryFor(installation), validateFilename(filename))
  }

  cacheFilename(source, mtimeMs, width = 480) {
    const key = crypto.createHash('sha1').update(path.resolve(source)).digest('hex')
    return `${key}-${Math.round(mtimeMs)}-${Math.round(width)}.png`
  }

  cachePath(source, mtimeMs, width = 480) {
    if (!this.paths.screenshotsCacheRoot) throw new Error('Screenshot cache is unavailable.')
    return path.join(this.paths.screenshotsCacheRoot, this.cacheFilename(source, mtimeMs, width))
  }

  async list(installation) {
    const directory = this.directoryFor(installation)
    let entries
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return { directory, exists: false, images: [] }
      }
      throw error
    }

    const images = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const extension = path.extname(entry.name).toLowerCase()
      if (!SCREENSHOT_EXTENSIONS.has(extension)) continue
      const file = path.join(directory, entry.name)
      let stat
      try {
        stat = await fsp.stat(file)
      } catch {
        continue
      }
      const dimensions = await readImageDimensions(file)
      images.push({
        filename: entry.name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      })
    }
    images.sort((a, b) => b.modified.localeCompare(a.modified) || a.filename.localeCompare(b.filename))
    return { directory, exists: true, images }
  }

  async runLimited(task) {
    if (this.active >= THUMBNAIL_CONCURRENCY) {
      await new Promise((resolve) => this.waiters.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }

  async thumbnail(installation, filename, size = 480) {
    const source = this.sourcePath(installation, filename)
    const width = Math.min(2048, Math.max(64, Math.round(Number(size) || 480)))
    const stat = await fsp.stat(source)
    if (!stat.isFile()) throw new Error('That screenshot no longer exists.')
    const target = this.cachePath(source, stat.mtimeMs, width)

    const cached = await fsp.readFile(target).catch(() => null)
    if (cached) return this.thumbnailPayload(cached)

    const existing = this.pendingThumbnails.get(target)
    if (existing) return existing

    const task = this.runLimited(async () => {
      const again = await fsp.readFile(target).catch(() => null)
      if (again) return this.thumbnailPayload(again)
      if (!this.nativeImage) throw new Error('Thumbnail generation is unavailable.')
      let image = null
      try {
        image = await this.nativeImage.createThumbnailFromPath(source, { width, height: Math.round(width * 0.75) })
      } catch {
        image = null
      }
      if (!image || image.isEmpty()) {
        image = this.nativeImage.createFromPath(source)
        const currentWidth = image?.getSize?.().width || 0
        if (image && !image.isEmpty() && currentWidth > width) image = image.resize({ width, quality: 'best' })
      }
      if (!image || image.isEmpty()) throw new Error('This screenshot could not be decoded.')
      const png = image.toPNG()
      await fsp.mkdir(this.paths.screenshotsCacheRoot, { recursive: true })
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      await fsp.writeFile(temporary, png)
      await fsp.rename(temporary, target)
      return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: image.getSize().width, height: image.getSize().height }
    })

    this.pendingThumbnails.set(target, task)
    task.finally(() => this.pendingThumbnails.delete(target)).catch(() => {})
    return task
  }

  thumbnailPayload(bytes) {
    const dimensions = dimensionsFromPng(bytes)
    return {
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    }
  }

  async removeCachedThumbnails(source) {
    if (!this.paths.screenshotsCacheRoot) return
    const prefix = crypto.createHash('sha1').update(path.resolve(source)).digest('hex')
    const entries = await fsp.readdir(this.paths.screenshotsCacheRoot).catch(() => [])
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(`${prefix}-`))
        .map((entry) => fsp.rm(path.join(this.paths.screenshotsCacheRoot, entry), { force: true })),
    )
  }

  async delete(installation, filename) {
    const source = this.sourcePath(installation, filename)
    const stat = await fsp.stat(source).catch(() => null)
    if (!stat?.isFile()) throw new Error('That screenshot no longer exists.')
    if (!this.trashItem) throw new Error('The recycle bin is unavailable.')
    await this.trashItem(source)
    await this.removeCachedThumbnails(source)
    return { filename }
  }

  isOwnedBackground(target) {
    if (!this.paths.backgroundsRoot || typeof target !== 'string') return false
    return isPathInside(target, this.paths.backgroundsRoot)
  }

  async setAsBackground(installation, filename) {
    const source = this.sourcePath(installation, filename)
    const stat = await fsp.stat(source)
    if (!stat.isFile()) throw new Error('That screenshot no longer exists.')
    if (!this.paths.backgroundsRoot) throw new Error('The background folder is unavailable.')
    const extension = path.extname(filename).toLowerCase()
    const key = crypto.createHash('sha1').update(path.resolve(source)).digest('hex').slice(0, 20)
    const destination = path.join(this.paths.backgroundsRoot, `dashboard-${key}${extension}`)
    await fsp.mkdir(this.paths.backgroundsRoot, { recursive: true })
    await fsp.copyFile(source, destination)
    return { path: destination }
  }

  async removeBackground(target) {
    if (!this.isOwnedBackground(target)) return
    await fsp.rm(target, { force: true })
  }

  async backgroundDataUrl(target, maxWidth = 1920) {
    if (!this.isOwnedBackground(target) || !this.nativeImage) return null
    const image = this.nativeImage.createFromPath(target)
    if (!image || image.isEmpty()) return null
    const width = image.getSize().width
    const sized = width > maxWidth ? image.resize({ width: maxWidth, quality: 'best' }) : image
    return sized.toDataURL()
  }
}

export { validateFilename as validateScreenshotFilename }