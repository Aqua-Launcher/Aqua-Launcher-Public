import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  ModRetargetService,
  parseMinecraftRelease,
  rangeIncludes,
  sameMinecraftLine,
} from '../electron/core/mod-retarget.js'

async function fixture(loader, versionId, metadata) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-retarget-'))
  const gameDir = path.join(root, 'game')
  const modsDir = path.join(gameDir, 'mods')
  await fs.mkdir(modsDir, { recursive: true })

  const zip = new AdmZip()
  for (const [entryName, contents] of Object.entries(metadata)) {
    zip.addFile(entryName, Buffer.from(contents))
  }
  zip.addFile('com/example/Example.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
  zip.writeZip(path.join(modsDir, 'example.jar'))

  const installation = {
    id: 'fixture',
    name: 'Fixture',
    versionId,
    loader: { type: loader, version: '1.0.0' },
    gameDir,
  }
  const modrinthService = {
    contentDirectory: (target, contentType) => {
      assert.equal(contentType, 'mod')
      return path.join(target.gameDir, 'mods')
    },
    resolveContentFile: (target, contentType, filename) => {
      assert.equal(contentType, 'mod')
      return path.join(target.gameDir, 'mods', filename)
    },
  }
  const service = new ModRetargetService({ logger: null, modrinthService })
  return { root, gameDir, modsDir, installation, service }
}

function fabricMetadata(range) {
  return {
    'fabric.mod.json': JSON.stringify({
      schemaVersion: 1,
      id: 'example',
      version: '1.0.0',
      depends: { minecraft: range, fabricloader: '>=0.16.0' },
    }),
  }
}

function forgeMetadata(loader, range) {
  const file = loader === 'neoforge' ? 'META-INF/neoforge.mods.toml' : 'META-INF/mods.toml'
  return {
    [file]: `modLoader="javafml"
loaderVersion="[47,)"
license="MIT"
[[mods]]
modId="example"
version="1.0.0"

[[dependencies.example]]
    modId="forge"
    mandatory=true
    versionRange="[47,)"
    ordering="NONE"
    side="BOTH"

[[dependencies.example]]
    modId="minecraft"
    mandatory=true
    versionRange="${range}"
    ordering="NONE"
    side="BOTH"
`,
  }
}

function readMetadata(jarPath, entryName) {
  return new AdmZip(jarPath).readAsText(entryName)
}

test('Minecraft release lines are compared by major and minor', () => {
  assert.equal(sameMinecraftLine('1.21.1', '1.21.4'), true)
  assert.equal(sameMinecraftLine('1.21', '1.21.6'), true)
  assert.equal(sameMinecraftLine('1.20.6', '1.21.1'), false)
  assert.equal(sameMinecraftLine('1.21.4', '1.22'), false)
  assert.equal(parseMinecraftRelease('1.21.4').patch, 4)
  assert.equal(parseMinecraftRelease('1.21.4-pre1'), null)
})

test('loader version ranges are matched in Fabric, Maven and wildcard forms', () => {
  assert.equal(rangeIncludes('>=1.21 <1.22', '1.21.4'), true)
  assert.equal(rangeIncludes('>=1.21 <1.22', '1.22'), false)
  assert.equal(rangeIncludes('1.21.1', '1.21.4'), false)
  assert.equal(rangeIncludes(['1.21.1', '1.21.4'], '1.21.4'), true)
  assert.equal(rangeIncludes('~1.21.1', '1.21.4'), true)
  assert.equal(rangeIncludes('1.21.x', '1.21.4'), true)
  assert.equal(rangeIncludes('1.20.x', '1.21.4'), false)
  assert.equal(rangeIncludes('[1.21,1.22)', '1.21.4'), true)
  assert.equal(rangeIncludes('[1.21,1.22)', '1.22'), false)
  assert.equal(rangeIncludes('[1.21.1]', '1.21.1'), true)
  assert.equal(rangeIncludes(['[1.21,1.21.2)', '[1.21.1,1.22)'], '1.21.4', 'all'), false)
  assert.equal(rangeIncludes(['[1.21,1.21.2)', '[1.21.1,1.22)'], '1.21.4'), true)
  assert.equal(rangeIncludes('>=1.21 || 1.20', '1.21.4'), null)
})

test('a Fabric mod can be converted within its release line and restored', async () => {
  const { root, modsDir, installation, service } = await fixture(
    'fabric',
    '1.21.4',
    fabricMetadata('1.21.1'),
  )
  try {
    const before = await service.inspect(installation, 'example.jar')
    assert.equal(before.status, 'ready')
    assert.equal(before.modLoader, 'fabric')
    assert.equal(before.declaredRange, '1.21.1')
    assert.equal(before.suggestedRange, '>=1.21 <1.22')
    assert.equal(before.canUndo, false)

    const converted = await service.convert(installation, 'example.jar')
    assert.equal(converted.converted, true)
    assert.equal(converted.canUndo, true)
    assert.equal(converted.status, 'compatible')

    const metadata = JSON.parse(readMetadata(path.join(modsDir, 'example.jar'), 'fabric.mod.json'))
    assert.equal(metadata.depends.minecraft, '>=1.21 <1.22')
    assert.equal(metadata.depends.fabricloader, '>=0.16.0')

    const backup = path.join(modsDir, '.aqua', 'retargets', 'example.jar')
    assert.equal(await fs.stat(backup).then(() => true), true)
    assert.equal(
      JSON.parse(readMetadata(backup, 'fabric.mod.json')).depends.minecraft,
      '1.21.1',
    )

    const restored = await service.undo(installation, 'example.jar')
    assert.equal(restored.converted, false)
    assert.equal(restored.declaredRange, '1.21.1')
    assert.equal(
      JSON.parse(readMetadata(path.join(modsDir, 'example.jar'), 'fabric.mod.json')).depends.minecraft,
      '1.21.1',
    )
    await assert.rejects(fs.stat(backup))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a Quilt mod rewrites its quilt_loader Minecraft dependency', async () => {
  const quiltMetadata = {
    'quilt.mod.json': JSON.stringify({
      schema_version: 1,
      quilt_loader: {
        group: 'com.example',
        id: 'example',
        version: '1.0.0',
        intermediate_mappings: 'net.fabricmc:intermediary',
        depends: [
          { id: 'quilt_loader', versions: '>=0.19.1' },
          { id: 'minecraft', versions: '1.21.1' },
        ],
      },
    }),
  }
  const { root, modsDir, installation, service } = await fixture('quilt', '1.21.4', quiltMetadata)
  try {
    const before = await service.inspect(installation, 'example.jar')
    assert.equal(before.status, 'ready')
    assert.equal(before.modLoader, 'quilt')

    await service.convert(installation, 'example.jar')
    const metadata = JSON.parse(readMetadata(path.join(modsDir, 'example.jar'), 'quilt.mod.json'))
    assert.equal(metadata.quilt_loader.depends[1].versions, '>=1.21 <1.22')
    assert.equal(metadata.quilt_loader.depends[0].versions, '>=0.19.1')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Forge and NeoForge metadata ranges are rewritten without touching other dependencies', async () => {
  for (const loader of ['forge', 'neoforge']) {
    const { root, modsDir, installation, service } = await fixture(
      loader,
      '1.21.4',
      forgeMetadata(loader, '[1.21.1,1.21.2)'),
    )
    try {
      const before = await service.inspect(installation, 'example.jar')
      assert.equal(before.status, 'ready')
      await service.convert(installation, 'example.jar')

      const entry = loader === 'neoforge' ? 'META-INF/neoforge.mods.toml' : 'META-INF/mods.toml'
      const text = readMetadata(path.join(modsDir, 'example.jar'), entry)
      assert.match(text, /modId="minecraft"[\s\S]*?versionRange="\[1\.21,1\.22\)"/)
      assert.match(text, /modId="forge"[\s\S]*?versionRange="\[47,\)"/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
})

test('a converted jar that changed afterwards no longer offers its stale backup', async () => {
  const { root, modsDir, installation, service } = await fixture(
    'fabric',
    '1.21.4',
    fabricMetadata('1.21.1'),
  )
  try {
    await service.convert(installation, 'example.jar')
    await fs.appendFile(path.join(modsDir, 'example.jar'), Buffer.from([0]))

    const analysis = await service.inspect(installation, 'example.jar')
    assert.equal(analysis.converted, false)
    assert.equal(analysis.canUndo, false)
    await assert.rejects(service.undo(installation, 'example.jar'), /changed after it was converted/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a different Minecraft release line is refused', async () => {
  const { root, installation, service } = await fixture(
    'fabric',
    '1.21.4',
    fabricMetadata('1.20.1'),
  )
  try {
    const analysis = await service.inspect(installation, 'example.jar')
    assert.equal(analysis.status, 'blocked')
    assert.match(analysis.reason, /outside the 1\.21\.x line/)
    await assert.rejects(service.convert(installation, 'example.jar'), /outside the 1\.21\.x line/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('signed jars and non-release targets are refused', async () => {
  const signed = await fixture('fabric', '1.21.4', {
    ...fabricMetadata('1.21.1'),
    'META-INF/EXAMPLE.SF': 'signature',
  })
  try {
    const analysis = await signed.service.inspect(signed.installation, 'example.jar')
    assert.equal(analysis.status, 'blocked')
    assert.match(analysis.reason, /signed/)
  } finally {
    await fs.rm(signed.root, { recursive: true, force: true })
  }

  const snapshot = await fixture('fabric', '1.21.4-pre1', fabricMetadata('1.21.1'))
  try {
    const analysis = await snapshot.service.inspect(snapshot.installation, 'example.jar')
    assert.equal(analysis.status, 'blocked')
    assert.match(analysis.reason, /release version/)
  } finally {
    await fs.rm(snapshot.root, { recursive: true, force: true })
  }
})

test('a mod with no matching loader metadata is refused', async () => {
  const { root, installation, service } = await fixture('forge', '1.21.4', fabricMetadata('1.21.1'))
  try {
    const analysis = await service.inspect(installation, 'example.jar')
    assert.equal(analysis.status, 'blocked')
    assert.match(analysis.reason, /Fabric mod.*Forge/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
