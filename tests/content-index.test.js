import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  ContentIndexService,
  parseForgeToml,
  readJarMetadata,
  readPackMetadata,
  scanContent,
} from '../electron/core/content-index.js'

async function tempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-content-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

function writeArchive(filePath, entries) {
  const zip = new AdmZip()
  for (const [name, value] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))
  }
  zip.writeZip(filePath)
}

test('Fabric metadata exposes id, name, version, authors and dependencies', async (t) => {
  const root = await tempRoot(t)
  const jar = path.join(root, 'sodium.jar')
  writeArchive(jar, {
    'fabric.mod.json': {
      id: 'sodium',
      name: 'Sodium',
      version: '0.5.11',
      authors: ['jellysquid3'],
      depends: { minecraft: '>=1.21', fabricloader: '>=0.16', indium: '*' },
    },
  })
  const metadata = readJarMetadata(jar)
  assert.equal(metadata.modId, 'sodium')
  assert.equal(metadata.name, 'Sodium')
  assert.equal(metadata.version, '0.5.11')
  assert.deepEqual(metadata.authors, ['jellysquid3'])
  assert.equal(metadata.loader, 'fabric')
  assert.equal(metadata.mcRange, '>=1.21')
  assert.deepEqual(metadata.requiredDependencies, ['minecraft', 'fabricloader', 'indium'])
})

test('Quilt metadata reads quilt_loader fields and contributor names', async (t) => {
  const root = await tempRoot(t)
  const jar = path.join(root, 'quilt.jar')
  writeArchive(jar, {
    'quilt.mod.json': {
      quilt_loader: {
        id: 'bettergrass',
        metadata: { name: 'Better Grass', version: '2.1.0', contributors: { Alice: 'Owner' } },
        depends: [
          { id: 'minecraft', versions: '1.20.x' },
          { id: 'qsl', versions: '*' },
        ],
      },
    },
  })
  const metadata = readJarMetadata(jar)
  assert.equal(metadata.modId, 'bettergrass')
  assert.equal(metadata.name, 'Better Grass')
  assert.equal(metadata.version, '2.1.0')
  assert.deepEqual(metadata.authors, ['Alice'])
  assert.equal(metadata.loader, 'quilt')
  assert.equal(metadata.mcRange, '1.20.x')
})

test('Forge and NeoForge mods.toml blocks produce the same shape', async (t) => {
  const root = await tempRoot(t)
  const toml = [
    'modLoader="javafml"',
    '[[mods]]',
    'modId="jei"',
    'version="15.0.0"',
    'displayName="Just Enough Items"',
    'authors="mezz"',
    '[[dependencies.jei]]',
    'modId="minecraft"',
    'versionRange="[1.21,1.22)"',
    'mandatory=true',
    '[[dependencies.jei]]',
    'modId="forge"',
    'versionRange="[47,)"',
    'mandatory=true',
  ].join('\n')
  const forge = path.join(root, 'jei.jar')
  writeArchive(forge, { 'META-INF/mods.toml': toml })
  const forgeMetadata = readJarMetadata(forge)
  assert.equal(forgeMetadata.loader, 'forge')
  assert.equal(forgeMetadata.modId, 'jei')
  assert.equal(forgeMetadata.version, '15.0.0')
  assert.deepEqual(forgeMetadata.authors, ['mezz'])
  assert.equal(forgeMetadata.mcRange, '[1.21,1.22)')
  assert.ok(forgeMetadata.requiredDependencies.includes('forge'))

  const neo = path.join(root, 'neo.jar')
  writeArchive(neo, { 'META-INF/neoforge.mods.toml': toml })
  assert.equal(readJarMetadata(neo).loader, 'neoforge')
})

test('legacy mcmod.info is still recognised', async (t) => {
  const root = await tempRoot(t)
  const jar = path.join(root, 'legacy.jar')
  writeArchive(jar, {
    'mcmod.info': [
      {
        modid: 'oldmod',
        name: 'Old Mod',
        version: '1.2',
        authorList: ['Someone'],
        mcversion: '1.12.2',
        requiredMods: ['forge:14.23', 'codechickenlib:3.2'],
      },
    ],
  })
  const metadata = readJarMetadata(jar)
  assert.equal(metadata.modId, 'oldmod')
  assert.equal(metadata.loader, 'forge')
  assert.equal(metadata.mcRange, '1.12.2')
  assert.deepEqual(metadata.authors, ['Someone'])
  assert.deepEqual(metadata.requiredDependencies, ['forge', 'codechickenlib'])
})

test('a corrupt jar is a null row rather than a failed scan', async (t) => {
  const root = await tempRoot(t)
  await fsp.mkdir(path.join(root, 'mods'))
  await fsp.writeFile(path.join(root, 'mods', 'broken.jar'), 'not a zip')
  await fsp.writeFile(path.join(root, 'mods', 'notes.txt'), 'ignored')
  const result = await scanContent(root, 'mods')
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].metadata, null)
  assert.match(result.files[0].reason, /could not|No readable/)
})

test('disabled content is listed with enabled false', async (t) => {
  const root = await tempRoot(t)
  await fsp.mkdir(path.join(root, 'mods'))
  writeArchive(path.join(root, 'mods', 'on.jar'), { 'fabric.mod.json': { id: 'on', name: 'On' } })
  writeArchive(path.join(root, 'mods', 'off.jar.disabled'), { 'fabric.mod.json': { id: 'off', name: 'Off' } })
  const result = await scanContent(root, 'mods')
  assert.equal(result.files.length, 2)
  assert.equal(result.files.find((file) => file.filename === 'on.jar').enabled, true)
  assert.equal(result.files.find((file) => file.filename === 'off.jar.disabled').enabled, false)
})

test('resource packs and shaderpacks read pack.mcmeta and shader folders', async (t) => {
  const root = await tempRoot(t)
  await fsp.mkdir(path.join(root, 'resourcepacks'))
  await fsp.mkdir(path.join(root, 'shaderpacks'))
  writeArchive(path.join(root, 'resourcepacks', 'faithful.zip'), {
    'pack.mcmeta': { pack: { pack_format: 34, description: 'Faithful' } },
    'assets/minecraft/textures/block/stone.png': 'png',
  })
  writeArchive(path.join(root, 'shaderpacks', 'bsl.zip'), {
    'shaders/bsl/shader.fsh': 'void main() {}',
    'shaders/bsl/shader.vsh': 'void main() {}',
  })
  const packs = await scanContent(root, 'resourcepacks')
  assert.equal(packs.files[0].metadata.type, 'resourcepack')
  assert.equal(packs.files[0].metadata.description, 'Faithful')
  assert.equal(packs.files[0].metadata.format, 34)

  const shaders = await scanContent(root, 'shaderpacks')
  assert.equal(shaders.files[0].metadata.type, 'shaderpack')
  assert.deepEqual(shaders.files[0].metadata.shaders, ['bsl'])
  assert.equal(readPackMetadata(path.join(root, 'shaderpacks', 'bsl.zip')).type, 'shaderpack')
})

test('the disk cache is reused and invalidates when a jar changes or disappears', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'instance')
  await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true })
  const jar = path.join(gameDir, 'mods', 'one.jar')
  writeArchive(jar, { 'fabric.mod.json': { id: 'one', name: 'One', version: '1.0' } })
  const service = new ContentIndexService({ paths: { cacheRoot: path.join(root, 'cache') } })

  const first = await service.list(gameDir, 'mods')
  assert.equal(first.cached, false)
  assert.equal(first.files[0].metadata.modId, 'one')

  const warm = await service.list(gameDir, 'mods')
  assert.equal(warm.cached, true)
  assert.equal(warm.files[0].metadata.modId, 'one')

  writeArchive(jar, { 'fabric.mod.json': { id: 'one', name: 'One', version: '2.0.0-longer' } })
  const changed = await service.list(gameDir, 'mods')
  assert.equal(changed.cached, false)
  assert.equal(changed.files[0].metadata.version, '2.0.0-longer')

  await fsp.rm(jar)
  const removed = await service.list(gameDir, 'mods')
  assert.equal(removed.cached, false)
  assert.equal(removed.files.length, 0)
})

test('parseForgeToml ignores optional dependencies and non-mod blocks', () => {
  const metadata = parseForgeToml(
    [
      '[[dependencies.example]]',
      'modId="optionalmod"',
      'mandatory=false',
      '[[mods]]',
      'modId="example"',
      'displayName="Example"',
    ].join('\n'),
  )
  assert.equal(metadata.modId, 'example')
  assert.deepEqual(metadata.requiredDependencies, [])
})

test('one jar can be inspected with metadata and its raw manifest', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const modsDir = path.join(gameDir, 'mods')
  await fsp.mkdir(modsDir, { recursive: true })
  writeArchive(path.join(modsDir, 'sodium.jar'), {
    'fabric.mod.json': {
      id: 'sodium',
      name: 'Sodium',
      version: '0.6.0',
      authors: ['jellysquid3'],
      depends: { minecraft: '>=1.21', fabricloader: '>=0.16' },
    },
  })

  const service = new ContentIndexService({ paths: { cacheRoot: path.join(root, 'cache') }, logger: null })
  const detail = await service.file(gameDir, 'mods', 'sodium.jar')
  assert.equal(detail.metadata.name, 'Sodium')
  assert.equal(detail.metadata.version, '0.6.0')
  assert.equal(detail.raw.source, 'fabric.mod.json')
  assert.match(detail.raw.content, /"id": "sodium"/)
  assert.equal(detail.enabled, true)
  assert.ok(detail.installedAt)
  assert.equal(detail.directory, modsDir)

  await assert.rejects(() => service.file(gameDir, 'mods', '../sodium.jar'), /outside/i)
  await assert.rejects(() => service.file(gameDir, 'mods', 'notes.txt'), /not content/i)
})

test('a file without metadata is still inspectable and reports why', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const modsDir = path.join(gameDir, 'mods')
  await fsp.mkdir(modsDir, { recursive: true })
  writeArchive(path.join(modsDir, 'mystery.jar.disabled'), { 'readme.txt': 'nothing to see' })

  const service = new ContentIndexService({ paths: { cacheRoot: path.join(root, 'cache') }, logger: null })
  const detail = await service.file(gameDir, 'mods', 'mystery.jar.disabled')
  assert.equal(detail.metadata, null)
  assert.match(detail.reason, /No readable metadata/i)
  assert.equal(detail.raw, null)
  assert.equal(detail.enabled, false)
})
