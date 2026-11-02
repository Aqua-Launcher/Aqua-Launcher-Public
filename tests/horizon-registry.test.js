import AdmZip from 'adm-zip'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  HorizonRegistryService,
  horizonRevoked,
  parseHorizonRegistry,
} from '../electron/core/horizon-registry.js'

function makePaths(root) {
  const horizonRoot = path.join(root, 'horizon')
  return {
    horizonRoot,
    horizonVersionsRoot: path.join(horizonRoot, 'versions'),
    horizonDownloadsRoot: path.join(horizonRoot, 'downloads'),
    horizonGameRoot: path.join(horizonRoot, 'game'),
    horizonCacheRoot: path.join(horizonRoot, 'cache'),
    horizonReleasesCacheFile: path.join(horizonRoot, 'cache', 'releases.json'),
    minecraftRoot: path.join(root, 'minecraft'),
  }
}

function release(name, sha256, size = 1024) {
  return {
    name,
    url: `https://github.com/horizon-rust/horizon-mods/releases/download/test/${name}`,
    size,
    sha256,
    signature: 'untrusted comment: test\nRUTest\n',
  }
}

function payload({ sha256 = 'a'.repeat(64), revoked = [] } = {}) {
  return {
    schema: 1,
    generated: '2026-11-01T23:44:57Z',
    projects: [
      {
        id: 'appleskin',
        kind: 'native-mod',
        name: 'AppleSkin',
        summary: 'Shows how much HP, hunger, and saturation will be restored.',
        description: 'A native mod.',
        authors: ['soufi'],
        owners: ['soufied'],
        license: 'MIT',
        source: 'https://github.com/soufied/AppleSkin-Horizon',
        icon: 'https://horizon-rust.github.io/horizon-mods/icons/appleskin.png',
        downloads: 7670,
        versions: [
          {
            version: '0.1.1',
            game: '26.3',
            published: '2026-10-31',
            changelog: 'added icon',
            api: 'native-1/abc/def',
            file: release('appleskin-0.1.1.hnmod', sha256, 9721),
          },
          {
            version: '0.1.0',
            game: '26.2',
            published: '2026-10-01',
            file: release('appleskin-0.1.0.hnmod', 'c'.repeat(64), 9000),
          },
        ],
      },
      {
        id: 'compass_bar',
        kind: 'mod',
        name: 'Compass Enhanced',
        summary: 'A compass bar with degrees and colored directions.',
        description: 'Content mod.',
        authors: ['Isaac'],
        owners: ['Fernandes585'],
        downloads: 1600,
        versions: [
          {
            version: '0.1.0',
            game: '26.3',
            published: '2026-10-28',
            file: release('compass_bar-0.1.0.hmod', 'b'.repeat(64), 47628),
          },
        ],
      },
      {
        id: 'menu_panorama',
        kind: 'resourcepack',
        name: 'Menu Panorama',
        summary: 'Put your own wallpaper behind the main menu.',
        description: 'A resource pack.',
        authors: ['form1t'],
        downloads: 489,
        versions: [
          {
            version: '1.0.0',
            game: '26.3',
            published: '2026-10-31',
            file: release('menu_panorama-1.0.0.zip', 'd'.repeat(64), 467828),
          },
        ],
      },
      {
        id: 'astral',
        kind: 'shader',
        name: 'Astral Shaders',
        summary: 'Not a file Aqua installs yet.',
        authors: ['someone'],
        downloads: 10,
        versions: [{ version: '1.0.0', game: '26.3', file: release('astral-1.0.0.hshader', 'e'.repeat(64)) }],
      },
      {
        id: 'mixed_up',
        kind: 'native-mod',
        name: 'Wrong extension',
        summary: 'A native mod published as a .hmod.',
        authors: ['someone'],
        downloads: 5,
        versions: [{ version: '1.0.0', game: '26.3', file: release('mixed_up-1.0.0.hmod', 'f'.repeat(64)) }],
      },
    ],
    revoked,
  }
}

async function temporaryRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-registry-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

test('the registry index only lists files Horizon 26.3 can install', () => {
  const catalog = parseHorizonRegistry(payload())
  assert.deepEqual(catalog.projects.map((project) => project.id), ['appleskin', 'compass_bar', 'menu_panorama'])
  assert.equal(catalog.projects[0].kind, 'native')
  assert.equal(catalog.projects[0].versions.length, 1, 'a 26.2 version is left out')
  assert.equal(catalog.projects[0].versions[0].version, '0.1.1')
  assert.equal(catalog.projects[0].official, false)
  assert.equal(catalog.projects[1].kind, 'content')
  assert.equal(catalog.projects[2].kind, 'resourcepack')
  assert.equal(catalog.projects[2].downloads, 489)
  assert.equal(catalog.generated, '2026-11-01T23:44:57Z')
})

test('a revoked file is recognised by project and checksum', () => {
  const catalog = parseHorizonRegistry(
    payload({ revoked: [{ id: 'appleskin', sha256: 'a'.repeat(64), reason: 'crash on load' }] }),
  )
  assert.equal(horizonRevoked(catalog, 'appleskin', 'a'.repeat(64)).reason, 'crash on load')
  assert.equal(horizonRevoked(catalog, 'appleskin', 'b'.repeat(64)), null)
  assert.equal(horizonRevoked(catalog, 'compass_bar', 'a'.repeat(64)), null)
})

test('installing a registry project downloads, verifies, and hands the file to Horizon', async (t) => {
  const root = await temporaryRoot(t)
  const paths = makePaths(root)
  const zip = new AdmZip()
  zip.addFile('horizon-native.json', Buffer.from(JSON.stringify({ id: 'appleskin', version: '0.1.1' })))
  const bytes = zip.toBuffer()
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const imported = []
  const service = new HorizonRegistryService({
    paths,
    horizonService: {
      importMod: async (filePath, options) => {
        imported.push({ filePath, options, existed: await fsp.stat(filePath).then(() => true, () => false) })
        return { filename: 'appleskin.hnmod', title: 'AppleSkin', kind: 'native', id: 'appleskin', version: '0.1.1', size: bytes.length, note: null }
      },
    },
    fetchJsonImpl: async () => payload({ sha256 }),
    downloadFilesImpl: async (files) => {
      await fsp.mkdir(path.dirname(files[0].destination), { recursive: true })
      await fsp.writeFile(files[0].destination, bytes)
    },
    logger: { debug() {}, info() {}, warn() {} },
  })

  const result = await service.install('appleskin')
  assert.equal(result.projectId, 'appleskin')
  assert.equal(result.projectVersion, '0.1.1')
  assert.equal(result.sha256, sha256)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].existed, true)
  assert.deepEqual(imported[0].options, {
    id: 'appleskin',
    sourceUrl: 'https://github.com/horizon-rust/horizon-mods/releases/download/test/appleskin-0.1.1.hnmod',
  })
  assert.equal(await fsp.stat(imported[0].filePath).then(() => true, () => false), false, 'the download is moved, not left behind')
  const cached = JSON.parse(await fsp.readFile(path.join(paths.horizonCacheRoot, 'mod-registry.json'), 'utf8'))
  assert.equal(cached.projects.length, 3)
})

test('a checksum mismatch removes the download and refuses the install', async (t) => {
  const root = await temporaryRoot(t)
  const paths = makePaths(root)
  let imported = false
  const service = new HorizonRegistryService({
    paths,
    horizonService: {
      importMod: async () => {
        imported = true
        return {}
      },
    },
    fetchJsonImpl: async () => payload({ sha256: 'a'.repeat(64) }),
    downloadFilesImpl: async (files) => {
      await fsp.mkdir(path.dirname(files[0].destination), { recursive: true })
      await fsp.writeFile(files[0].destination, 'not the published file')
    },
    logger: { debug() {}, info() {}, warn() {} },
  })

  await assert.rejects(service.install('appleskin'), /SHA-256/)
  assert.equal(imported, false)
  const leftovers = await fsp.readdir(path.join(paths.horizonCacheRoot, 'mod-browser')).catch(() => [])
  assert.deepEqual(leftovers, [])
})

test('a revoked release is refused before anything is downloaded', async (t) => {
  const root = await temporaryRoot(t)
  const paths = makePaths(root)
  let downloaded = false
  const service = new HorizonRegistryService({
    paths,
    horizonService: { importMod: async () => ({}) },
    fetchJsonImpl: async () =>
      payload({ revoked: [{ id: 'appleskin', sha256: 'a'.repeat(64), reason: 'broken' }] }),
    downloadFilesImpl: async () => {
      downloaded = true
    },
    logger: { debug() {}, info() {}, warn() {} },
  })

  await assert.rejects(service.install('appleskin'), /taken down by Horizon’s registry: broken/)
  assert.equal(downloaded, false)
})
