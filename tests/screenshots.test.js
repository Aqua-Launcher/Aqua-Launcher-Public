import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDefaultSettings, normalizeSettings } from '../electron/core/settings.js'
import { ScreenshotService, readImageDimensions, validateScreenshotFilename } from '../electron/core/screenshots.js'
import { Store } from '../electron/core/store.js'

function pngBytes(width, height) {
  const bytes = Buffer.alloc(33)
  bytes[0] = 0x89
  bytes.write('PNG', 1, 'ascii')
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-screenshots-'))
  const gameDir = path.join(root, 'game')
  const directory = path.join(gameDir, 'screenshots')
  const screenshotsCacheRoot = path.join(root, 'cache', 'screenshots')
  const backgroundsRoot = path.join(root, 'backgrounds')
  await fsp.mkdir(directory, { recursive: true })
  await fsp.mkdir(screenshotsCacheRoot, { recursive: true })
  const thumbnailPng = pngBytes(480, 270)
  const calls = { decode: 0, create: 0, active: 0, maxActive: 0, trashed: null }
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 480, height: 270 }),
    resize: () => image,
    toPNG: () => thumbnailPng,
    toDataURL: () => `data:image/png;base64,${thumbnailPng.toString('base64')}`,
  }
  const nativeImage = {
    createFromPath: () => {
      calls.decode += 1
      return image
    },
    createThumbnailFromPath: async () => {
      calls.create += 1
      calls.active += 1
      calls.maxActive = Math.max(calls.maxActive, calls.active)
      await new Promise((resolve) => setTimeout(resolve, 8))
      calls.active -= 1
      return image
    },
  }
  const paths = { screenshotsCacheRoot, backgroundsRoot }
  const service = new ScreenshotService({
    paths,
    nativeImage,
    trashItem: async (target) => {
      calls.trashed = target
      await fsp.rm(target, { force: true })
    },
  })
  return { root, gameDir, directory, screenshotsCacheRoot, backgroundsRoot, service, calls }
}

test('screenshot listing ignores non-images, reads dimensions, and sorts newest first', async () => {
  const { directory, service } = await fixture()
  const older = path.join(directory, 'older.png')
  const newer = path.join(directory, 'newer.png')
  await fsp.writeFile(older, pngBytes(1920, 1080))
  await fsp.writeFile(newer, pngBytes(2560, 1440))
  await fsp.writeFile(path.join(directory, 'notes.txt'), 'not an image')
  await fsp.mkdir(path.join(directory, 'nested.png'))
  await fsp.utimes(older, new Date(2026, 0, 1), new Date(2026, 0, 1))
  await fsp.utimes(newer, new Date(2026, 0, 2), new Date(2026, 0, 2))

  const result = await service.list({ gameDir: path.dirname(directory) })
  assert.equal(result.exists, true)
  assert.deepEqual(result.images.map((image) => image.filename), ['newer.png', 'older.png'])
  assert.deepEqual(
    { width: result.images[1].width, height: result.images[1].height },
    { width: 1920, height: 1080 },
  )
  assert.equal(await readImageDimensions(older).then((value) => value.width), 1920)
  assert.throws(() => validateScreenshotFilename('../outside.png'), /invalid/)
  assert.throws(() => validateScreenshotFilename('notes.txt'), /not a supported/)
})

test('a large folder lists without decoding every image', async () => {
  const { directory, service, calls } = await fixture()
  await Promise.all(
    Array.from({ length: 500 }, (_, index) =>
      fsp.writeFile(path.join(directory, `shot-${String(index).padStart(3, '0')}.png`), pngBytes(1920, 1080)),
    ),
  )
  const result = await service.list({ gameDir: path.dirname(directory) })
  assert.equal(result.images.length, 500)
  assert.equal(calls.decode, 0)
})

test('thumbnails are cached by path and mtime, invalidate, and stay within the concurrency limit', async () => {
  const { directory, screenshotsCacheRoot, service, calls } = await fixture()
  const files = Array.from({ length: 8 }, (_, index) => `shot-${index}.png`)
  await Promise.all(files.map((file) => fsp.writeFile(path.join(directory, file), pngBytes(1920, 1080))))

  const results = await Promise.all(files.map((file) => service.thumbnail({ gameDir: path.dirname(directory) }, file, 320)))
  assert.equal(results.length, 8)
  assert.match(results[0].dataUrl, /^data:image\/png;base64,/)
  assert.equal(results[0].width, 480)
  assert.ok(calls.maxActive <= 3, `expected at most 3 thumbnail jobs, saw ${calls.maxActive}`)
  assert.equal((await fsp.readdir(screenshotsCacheRoot)).length, 8)

  const before = calls.create
  await service.thumbnail({ gameDir: path.dirname(directory) }, files[0], 320)
  assert.equal(calls.create, before)
  await fsp.utimes(path.join(directory, files[0]), new Date(), new Date(Date.now() + 10_000))
  await service.thumbnail({ gameDir: path.dirname(directory) }, files[0], 320)
  assert.equal(calls.create, before + 1)
  await service.thumbnail({ gameDir: path.dirname(directory) }, files[1], 1800)
  assert.equal((await fsp.readdir(screenshotsCacheRoot)).length, 10)
})

test('deleting uses the OS trash and removes the cached thumbnail', async () => {
  const { directory, screenshotsCacheRoot, service, calls } = await fixture()
  const file = path.join(directory, 'delete-me.png')
  await fsp.writeFile(file, pngBytes(1920, 1080))
  await service.thumbnail({ gameDir: path.dirname(directory) }, 'delete-me.png', 320)
  assert.equal((await fsp.readdir(screenshotsCacheRoot)).length, 1)

  const deleted = await service.delete({ gameDir: path.dirname(directory) }, 'delete-me.png')
  assert.deepEqual(deleted, { filename: 'delete-me.png' })
  assert.equal(calls.trashed, file)
  await assert.rejects(() => fsp.stat(file))
  assert.equal((await fsp.readdir(screenshotsCacheRoot)).length, 0)
})

test('dashboard backgrounds copy into launcher-owned storage and clear cleanly', async () => {
  const { root, directory, backgroundsRoot, service } = await fixture()
  await fsp.writeFile(path.join(directory, 'art.png'), pngBytes(1920, 1080))
  const result = await service.setAsBackground({ gameDir: path.dirname(directory) }, 'art.png')
  assert.equal(path.dirname(result.path), backgroundsRoot)
  assert.match(await service.backgroundDataUrl(result.path), /^data:image\/png;base64,/)
  await service.removeBackground(result.path)
  await assert.rejects(() => fsp.stat(result.path))

  const settings = createDefaultSettings({ totalMemMb: 8192, instancesRoot: path.join(os.tmpdir(), 'instances') })
  assert.equal(settings.dashboardBackground, null)
  const normalized = normalizeSettings({ ...settings, dashboardBackground: result.path }, settings)
  assert.equal(normalized.dashboardBackground, result.path)
  assert.equal(normalizeSettings({ ...settings, dashboardBackground: null }, settings).dashboardBackground, null)

  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  const options = {
    configFile: path.join(root, 'launcher.json'),
    instancesRoot: path.join(root, 'instances'),
    totalMemMb: 8192,
    logger,
  }
  const store = new Store(options)
  await store.init()
  await store.replaceSettings({ ...store.settings, dashboardBackground: result.path })
  const reopened = new Store(options)
  await reopened.init()
  assert.equal(reopened.settings.dashboardBackground, result.path)
  await reopened.replaceSettings({ ...reopened.settings, dashboardBackground: null })
  const cleared = new Store(options)
  await cleared.init()
  assert.equal(cleared.settings.dashboardBackground, null)
})