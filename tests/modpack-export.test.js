import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ModpackExportService } from '../electron/core/modpack-export.js'

async function tempDir(prefix = 'aqua-export-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function put(root, relative, contents = relative) {
  const target = path.join(root, relative)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, contents)
  return target
}

function sha(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function sha512(value) {
  return crypto.createHash('sha512').update(value).digest('hex')
}

test('export preview separates Modrinth downloads from bundled overrides', async () => {
  const gameDir = await tempDir()
  const matched = 'matched mod'
  await put(gameDir, 'mods/matched.jar', matched)
  await put(gameDir, 'mods/local.jar', 'local mod')
  await put(gameDir, 'config/example.toml', 'setting=true')
  await put(gameDir, 'saves/world/level.dat', 'world')
  await put(gameDir, 'logs/latest.log', 'ignored')
  const service = new ModpackExportService({
    modrinthService: {
      lookupHashes: async () => ({
        [sha(matched)]: {
          project_id: 'project-1',
          id: 'version-1',
          files: [
            {
              filename: 'matched.jar',
              url: 'https://cdn.modrinth.com/matched.jar',
              hashes: { sha1: sha(matched), sha512: sha512(matched) },
              size: Buffer.byteLength(matched),
            },
          ],
        },
      }),
    },
  })
  const installation = {
    name: 'My Pack',
    versionId: '1.21.1',
    loader: { type: 'fabric', version: '0.16.9' },
    gameDir,
    modpack: { name: 'My Pack', versionId: '1.2.3' },
  }
  const preview = await service.preview(installation)
  assert.equal(preview.name, 'My Pack')
  assert.equal(preview.downloadable, 1)
  assert.equal(preview.bundled, 2)
  assert.equal(preview.worldFiles, 1)
  assert.equal(preview.includeWorlds, false)
  assert.ok(preview.files.some((file) => file.path === 'mods/local.jar' && file.kind === 'override'))
  assert.ok(!preview.files.some((file) => file.path === 'logs/latest.log'))
  assert.ok(preview.warnings.some((warning) => /world/i.test(warning)) === false)

  const output = path.join(await tempDir(), 'export.mrpack')
  const result = await service.export(installation, { destination: output, preview })
  assert.equal(result.filename, 'export.mrpack')
  const zip = new AdmZip(output)
  const index = JSON.parse(zip.getEntry('modrinth.index.json').getData().toString('utf8'))
  assert.equal(index.formatVersion, 1)
  assert.equal(index.name, 'My Pack')
  assert.equal(index.versionId, '1.2.3')
  assert.deepEqual(index.dependencies, { minecraft: '1.21.1', 'fabric-loader': '0.16.9' })
  assert.equal(index.files.length, 1)
  assert.equal(index.files[0].path, 'mods/matched.jar')
  assert.equal(index.files[0].downloads[0], 'https://cdn.modrinth.com/matched.jar')
  assert.equal(index.files[0].hashes.sha1, sha(matched))
  assert.equal(zip.getEntry('overrides/mods/local.jar').getData().toString(), 'local mod')
  assert.equal(zip.getEntry('overrides/config/example.toml').getData().toString(), 'setting=true')
  assert.equal(zip.getEntry('overrides/saves/world/level.dat'), null)
})

test('worlds are included only when explicitly enabled', async () => {
  const gameDir = await tempDir()
  await put(gameDir, 'saves/world/level.dat', 'world')
  const service = new ModpackExportService({})
  const installation = { name: 'World Pack', versionId: '1.20.1', gameDir }
  const output = path.join(await tempDir(), 'worlds.mrpack')
  const preview = await service.preview(installation, { includeWorlds: true })
  assert.equal(preview.worldFiles, 1)
  assert.ok(preview.warnings.some((warning) => /world file/i.test(warning)))
  await service.export(installation, { includeWorlds: true, destination: output, preview })
  const zip = new AdmZip(output)
  assert.equal(zip.getEntry('overrides/saves/world/level.dat').getData().toString(), 'world')
  const index = JSON.parse(zip.getEntry('modrinth.index.json').getData().toString('utf8'))
  assert.equal(index.files.length, 0)
})

test('export writes a modpack that the importer can inspect', async () => {
  const gameDir = await tempDir()
  await put(gameDir, 'mods/example.jar', 'example')
  const service = new ModpackExportService({})
  const output = path.join(await tempDir(), 'roundtrip.mrpack')
  await service.export(
    { name: 'Round Trip', versionId: '1.21.1', loader: { type: 'vanilla', version: null }, gameDir },
    { destination: output },
  )
  const { inspectMrpackArchive } = await import('../electron/core/modpack-import.js')
  const info = await inspectMrpackArchive(output)
  assert.equal(info.name, 'Round Trip')
  assert.equal(info.minecraftVersion, '1.21.1')
  assert.equal(info.files, 0)
  assert.equal(info.overrides, 1)
})
