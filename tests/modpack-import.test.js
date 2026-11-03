import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  ModpackImportService,
  inspectMrpackArchive,
  inspectPack,
  inspectPrismInstance,
} from '../electron/core/modpack-import.js'

async function tempDir(prefix = 'aqua-pack-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writePack(index, extras = {}) {
  const dir = await tempDir()
  const file = path.join(dir, 'pack.mrpack')
  const zip = new AdmZip()
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index)))
  for (const [name, contents] of Object.entries(extras)) {
    zip.addFile(name, Buffer.from(contents))
  }
  zip.writeZip(file)
  return file
}

const baseIndex = {
  formatVersion: 1,
  name: 'Test Pack',
  versionId: '1.0.0',
  dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.9' },
  files: [
    { path: 'mods/example.jar', downloads: ['https://example.invalid/example.jar'], fileSize: 10, hashes: { sha1: 'abc' } },
  ],
}

test('inspects a valid .mrpack and ignores client-unsupported files', async () => {
  const file = await writePack(
    {
      ...baseIndex,
      files: [
        ...baseIndex.files,
        { path: 'mods/server-only.jar', downloads: ['https://example.invalid/server.jar'], env: { client: 'unsupported' } },
      ],
    },
    { 'overrides/config/test.txt': 'hello', 'client-overrides/options.txt': 'fov:90' },
  )
  const info = await inspectMrpackArchive(file)
  assert.equal(info.kind, 'mrpack')
  assert.equal(info.name, 'Test Pack')
  assert.equal(info.minecraftVersion, '1.21.1')
  assert.deepEqual(info.loader, { type: 'fabric', version: '0.16.9' })
  assert.equal(info.files, 1)
  assert.equal(info.overrides, 2)
})

test('rejects unsupported .mrpack format versions and missing file lists', async () => {
  const versionTwo = await writePack({ ...baseIndex, formatVersion: 2 })
  await assert.rejects(() => inspectMrpackArchive(versionTwo), /format version 1/)
  const noFiles = await writePack({ ...baseIndex, files: undefined })
  await assert.rejects(() => inspectMrpackArchive(noFiles), /no files list/)
})

test('rejects path traversal in manifests and overrides', async () => {
  const manifestTraversal = await writePack({
    ...baseIndex,
    files: [{ path: '../outside.jar', downloads: ['https://example.invalid/a.jar'] }],
  })
  await assert.rejects(() => inspectMrpackArchive(manifestTraversal), /outside the game folder/)

  const overrideTraversal = await writePack(baseIndex)
  const traversalZip = new AdmZip(overrideTraversal)
  traversalZip.addFile('overrides/outside.txt', Buffer.from('no'))
  traversalZip.getEntry('overrides/outside.txt').entryName = 'overrides/../../outside.txt'
  traversalZip.writeZip(overrideTraversal)
  await assert.rejects(() => inspectMrpackArchive(overrideTraversal), /outside the game folder/)
})

test('inspects a Prism instance and finds .minecraft', async () => {
  const dir = await tempDir()
  await fsp.writeFile(
    path.join(dir, 'mmc-pack.json'),
    JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '0.15.11' },
      ],
    }),
  )
  await fsp.writeFile(path.join(dir, 'instance.cfg'), 'name=My Prism Pack\n')
  await fsp.mkdir(path.join(dir, '.minecraft', 'mods'), { recursive: true })
  await fsp.writeFile(path.join(dir, '.minecraft', 'mods', 'example.jar'), 'jar')
  const info = await inspectPrismInstance(dir)
  assert.equal(info.kind, 'prism')
  assert.equal(info.name, 'My Prism Pack')
  assert.equal(info.minecraftVersion, '1.20.1')
  assert.deepEqual(info.loader, { type: 'fabric', version: '0.15.11' })
  assert.equal(info.sourceDir, path.join(dir, '.minecraft'))
  assert.equal(info.files, 1)
})

test('inspectPack routes files and folders and rejects unsupported files', async () => {
  const file = await writePack(baseIndex)
  assert.equal((await inspectPack(file)).kind, 'mrpack')
  const unsupported = path.join(await tempDir(), 'not-a-pack.zip')
  await fsp.writeFile(unsupported, 'not a pack')
  await assert.rejects(() => inspectPack(unsupported), /\.mrpack/)
})

test('loader validation happens before a Prism profile is created', async () => {
  const dir = await tempDir()
  await fsp.writeFile(
    path.join(dir, 'mmc-pack.json'),
    JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '9.9.9' },
      ],
    }),
  )
  let created = 0
  const service = new ModpackImportService({
    modrinthService: {},
    installationService: {
      create: async () => {
        created += 1
      },
    },
    loaderService: { listVersions: async () => [{ version: '0.15.11' }] },
  })
  await assert.rejects(() => service.import(dir, { mode: 'copy' }), /no fabric loader 9\.9\.9/)
  assert.equal(created, 0)
})

test('copying a Prism instance is cancellable and rolls the profile back', async () => {
  const dir = await tempDir()
  await fsp.writeFile(
    path.join(dir, 'mmc-pack.json'),
    JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }] }),
  )
  await fsp.writeFile(path.join(dir, 'instance.cfg'), 'name=Cancel Me\n')
  await fsp.mkdir(path.join(dir, 'minecraft', 'mods'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'minecraft', 'mods', 'one.jar'), 'one')
  await fsp.writeFile(path.join(dir, 'minecraft', 'mods', 'two.jar'), 'two')

  let removed = null
  const service = new ModpackImportService({
    modrinthService: {},
    installationService: {
      create: async () => ({ id: 'profile-1', name: 'Cancel Me', gameDir: path.join(dir, 'copy'), managedGameDir: true }),
      remove: async (id) => {
        removed = id
      },
    },
    loaderService: null,
    jobManager: null,
  })
  const controller = new AbortController()
  await assert.rejects(
    () =>
      service.import(dir, {
        mode: 'copy',
        signal: controller.signal,
        onProgress: (update) => {
          if (update.filesDone) controller.abort()
        },
      }),
    (error) => error.name === 'AbortError',
  )
  assert.equal(removed, 'profile-1')
})
