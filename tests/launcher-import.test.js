import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  LauncherImportService,
  copyProfileContent,
  defaultLauncherRoots,
  discoverCandidates,
  inferLoaderFromVersionId,
} from '../electron/core/launcher-import.js'

async function tempDir(prefix = 'aqua-launcher-import-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function write(filePath, contents = 'x') {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, contents)
}

async function makePrismInstance(root, name = 'Prism Pack') {
  const instance = path.join(root, 'instances', name.replace(/\s+/g, '-'))
  await write(
    path.join(instance, 'mmc-pack.json'),
    JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '0.15.11' },
      ],
    }),
  )
  await write(path.join(instance, 'instance.cfg'), `name=${name}\n`)
  await write(path.join(instance, 'minecraft', 'mods', 'one.jar'), 'one')
  await write(path.join(instance, 'minecraft', 'mods', 'two.jar'), 'two')
  await write(path.join(instance, 'minecraft', 'config', 'example.toml'), 'config')
  await write(path.join(instance, 'minecraft', 'saves', 'World', 'level.dat'), 'level')
  return instance
}

test('standard launcher roots cover Windows, macOS and Linux layouts', () => {
  const windows = defaultLauncherRoots({
    platform: 'win32',
    home: 'C:\\Users\\Aqua',
    appData: 'C:\\Users\\Aqua\\AppData\\Roaming',
  })
  assert.ok(windows.some((root) => root.launcher === 'vanilla' && root.path.endsWith('.minecraft')))
  assert.ok(windows.some((root) => root.launcher === 'prism' && root.path.includes('PrismLauncher')))
  assert.ok(windows.some((root) => root.launcher === 'multimc' && root.path.includes('MultiMC')))
  assert.ok(windows.some((root) => root.launcher === 'curseforge' && root.path.includes('CurseForge')))
  assert.ok(windows.some((root) => root.launcher === 'atlauncher' && root.path.includes('ATLauncher')))

  const linux = defaultLauncherRoots({ platform: 'linux', home: '/home/aqua' })
  assert.ok(linux.some((root) => root.launcher === 'prism' && root.path.includes('PrismLauncher')))
  assert.ok(linux.some((root) => root.launcher === 'vanilla' && root.path.endsWith('.minecraft')))
})

test('version ids expose vanilla and modded loader metadata', () => {
  assert.deepEqual(inferLoaderFromVersionId('fabric-loader-0.15.11-1.20.1'), {
    loader: { type: 'fabric', version: '0.15.11' },
    minecraftVersion: '1.20.1',
  })
  assert.deepEqual(inferLoaderFromVersionId('1.20.1-forge-47.2.0'), {
    loader: { type: 'forge', version: '47.2.0' },
    minecraftVersion: '1.20.1',
  })
  assert.deepEqual(inferLoaderFromVersionId('1.20.1'), {
    loader: { type: 'vanilla', version: null },
    minecraftVersion: '1.20.1',
  })
  assert.equal(inferLoaderFromVersionId('neoforge-21.1.80').minecraftVersion, '')
})

test('vanilla profiles keep their custom game folder and count mods and worlds', async () => {
  const root = await tempDir()
  const gameDir = path.join(root, 'Custom Game')
  await write(path.join(gameDir, 'mods', 'one.jar'), 'one')
  await write(path.join(gameDir, 'mods', 'two.jar.disabled'), 'two')
  await write(path.join(gameDir, 'saves', 'World', 'level.dat'), 'level')
  await write(path.join(root, 'saves', 'Old World', 'level.dat'), 'old')
  await write(path.join(root, 'launcher_profiles.json'), JSON.stringify({
    profiles: {
      fabric: {
        name: 'Fabric Fun',
        lastVersionId: 'fabric-loader-0.15.11-1.20.1',
        gameDir,
      },
      vanilla: { name: 'Vanilla 1.20.1', lastVersionId: '1.20.1' },
    },
  }))
  await write(
    path.join(root, 'versions', 'fabric-loader-0.15.11-1.20.1', 'fabric-loader-0.15.11-1.20.1.json'),
    JSON.stringify({ id: 'fabric-loader-0.15.11-1.20.1', inheritsFrom: '1.20.1' }),
  )

  const result = await discoverCandidates({
    roots: [{ launcher: 'vanilla', path: root, kind: 'vanilla' }],
  })
  assert.equal(result.errors.length, 0)
  assert.equal(result.candidates.length, 2)
  const fabric = result.candidates.find((candidate) => candidate.name === 'Fabric Fun')
  assert.ok(fabric)
  assert.equal(fabric.minecraftVersion, '1.20.1')
  assert.deepEqual(fabric.loader, { type: 'fabric', version: '0.15.11' })
  assert.equal(fabric.sourceDir, path.resolve(gameDir))
  assert.equal(fabric.mods, 2)
  assert.equal(fabric.worlds, 1)
  assert.ok(fabric.bytes > 0)
  assert.deepEqual(fabric.modes, ['adopt', 'copy'])
})

test('discovers Prism, CurseForge and ATLauncher profiles', async () => {
  const root = await tempDir()
  await makePrismInstance(root, 'Prism Pack')

  const curseForge = path.join(root, 'curseforge', 'Instances', 'Forge Pack')
  await write(
    path.join(curseForge, 'minecraftinstance.json'),
    JSON.stringify({
      name: 'Forge Pack',
      gameVersion: '1.19.2',
      baseModLoader: { name: 'forge-43.2.0', forgeVersion: '43.2.0' },
    }),
  )
  await write(path.join(curseForge, 'mods', 'example.jar'), 'jar')

  const atlauncher = path.join(root, 'atl', 'instances', 'ATL Pack')
  await write(
    path.join(atlauncher, 'instance.json'),
    JSON.stringify({
      id: '1.18.2',
      launcher: {
        name: 'ATL Pack',
        vanillaInstance: false,
        loaderVersion: { type: 'Fabric', version: '0.14.0' },
      },
    }),
  )
  await write(path.join(atlauncher, 'mods', 'fabric.jar'), 'jar')

  const result = await discoverCandidates({
    roots: [
      { launcher: 'prism', path: path.join(root, 'instances'), kind: 'instances' },
      { launcher: 'curseforge', path: path.join(root, 'curseforge', 'Instances'), kind: 'instances' },
      { launcher: 'atlauncher', path: path.join(root, 'atl', 'instances'), kind: 'instances' },
    ],
  })
  assert.equal(result.errors.length, 0)
  assert.equal(result.candidates.length, 3)
  const prism = result.candidates.find((candidate) => candidate.launcher === 'prism')
  assert.equal(prism.name, 'Prism Pack')
  assert.deepEqual(prism.loader, { type: 'fabric', version: '0.15.11' })
  assert.equal(prism.mods, 2)
  assert.equal(prism.worlds, 1)

  const forge = result.candidates.find((candidate) => candidate.launcher === 'curseforge')
  assert.equal(forge.minecraftVersion, '1.19.2')
  assert.deepEqual(forge.loader, { type: 'forge', version: '43.2.0' })
  assert.equal(forge.mods, 1)

  const atl = result.candidates.find((candidate) => candidate.launcher === 'atlauncher')
  assert.equal(atl.minecraftVersion, '1.18.2')
  assert.deepEqual(atl.loader, { type: 'fabric', version: '0.14.0' })
})

test('copying a profile brings content and worlds but skips shared and cached data', async () => {
  const source = await tempDir()
  const destination = path.join(await tempDir(), 'copy')
  const sourceFiles = {
    'mods/example.jar': 'jar',
    'config/example.toml': 'config',
    'saves/World/level.dat': 'level',
    'libraries/shared.jar': 'library',
    'versions/1.20.1/1.20.1.jar': 'version',
    'logs/latest.log': 'log',
    'cache/index.json': '{}',
    'launcher_profiles.json': '{}',
    'instance.cfg': 'name=Source',
  }
  for (const [name, contents] of Object.entries(sourceFiles)) {
    await write(path.join(source, name), contents)
  }
  const before = new Map()
  for (const [name, contents] of Object.entries(sourceFiles)) before.set(name, contents)

  const result = await copyProfileContent(source, destination, { importWorlds: true, totalFiles: 3 })
  assert.equal(result.files, 3)
  assert.equal(await fsp.readFile(path.join(destination, 'mods', 'example.jar'), 'utf8'), 'jar')
  assert.equal(await fsp.readFile(path.join(destination, 'config', 'example.toml'), 'utf8'), 'config')
  assert.equal(await fsp.readFile(path.join(destination, 'saves', 'World', 'level.dat'), 'utf8'), 'level')
  for (const skipped of ['libraries', 'versions', 'logs', 'cache', 'launcher_profiles.json', 'instance.cfg']) {
    await assert.rejects(() => fsp.stat(path.join(destination, skipped)), { code: 'ENOENT' })
  }

  const withoutWorlds = path.join(await tempDir(), 'copy')
  await copyProfileContent(source, withoutWorlds, { importWorlds: false })
  await assert.rejects(() => fsp.stat(path.join(withoutWorlds, 'saves')), { code: 'ENOENT' })
  assert.equal(await fsp.readFile(path.join(withoutWorlds, 'mods', 'example.jar'), 'utf8'), 'jar')

  for (const [name, contents] of before) {
    assert.equal(await fsp.readFile(path.join(source, name), 'utf8'), contents)
  }
})

test('a directly chosen instance is scanned without its parent', async () => {
  const root = await tempDir()
  const prismInstance = await makePrismInstance(root, 'Direct Prism')
  const prismResult = await discoverCandidates({ roots: [], extraPath: prismInstance })
  assert.equal(prismResult.candidates.length, 1)
  assert.equal(prismResult.candidates[0].name, 'Direct Prism')
  assert.equal(prismResult.candidates[0].minecraftVersion, '1.20.1')

  const curseForgeInstance = path.join(root, 'curseforge', 'Instances', 'Direct Forge')
  await write(
    path.join(curseForgeInstance, 'minecraftinstance.json'),
    JSON.stringify({ name: 'Direct Forge', gameVersion: '1.19.2', baseModLoader: { name: 'forge-43.2.0' } }),
  )
  const curseForgeResult = await discoverCandidates({ roots: [], extraPath: curseForgeInstance })
  assert.equal(curseForgeResult.candidates.length, 1)
  assert.equal(curseForgeResult.candidates[0].launcher, 'curseforge')
  assert.deepEqual(curseForgeResult.candidates[0].loader, { type: 'forge', version: '43.2.0' })
})

test('adopting uses the source folder and suffixes a duplicate name', async () => {
  const root = await tempDir()
  const instance = await makePrismInstance(root, 'Pack')
  const { candidates } = await discoverCandidates({
    roots: [{ launcher: 'prism', path: path.join(root, 'instances'), kind: 'instances' }],
  })
  const created = []
  const service = new LauncherImportService({
    installationService: {
      create: async (input) => {
        created.push(input)
        return {
          id: 'new-profile',
          name: input.name,
          gameDir: input.gameDir,
          managedGameDir: false,
        }
      },
      remove: async () => {},
    },
    store: {
      installations: [{ name: 'Pack' }],
      addActivity: async () => {},
    },
  })
  const result = await service.importCandidates(candidates, { mode: 'adopt', importWorlds: true })
  assert.equal(result.imported.length, 1)
  assert.equal(result.failed.length, 0)
  assert.equal(created.length, 1)
  assert.equal(created[0].name, 'Pack (2)')
  assert.equal(created[0].gameDir, path.join(instance, 'minecraft'))
  assert.equal(result.imported[0].mode, 'adopt')
})

test('a failed copy removes the half-profile and leaves the source untouched', async () => {
  const root = await tempDir()
  const instance = await makePrismInstance(root, 'Broken Copy')
  const { candidates } = await discoverCandidates({
    roots: [{ launcher: 'prism', path: path.join(root, 'instances'), kind: 'instances' }],
  })
  const brokenGameDir = path.join(await tempDir(), 'broken-profile')
  await write(path.join(brokenGameDir, 'mods'), 'this file blocks the mods folder')
  let removed = null
  const service = new LauncherImportService({
    installationService: {
      create: async (input) => ({
        id: 'half-profile',
        name: input.name,
        gameDir: brokenGameDir,
        managedGameDir: true,
      }),
      remove: async (id) => {
        removed = id
      },
    },
    store: { installations: [], addActivity: async () => {} },
  })

  const result = await service.importCandidates(candidates, { mode: 'copy', importWorlds: true })
  assert.equal(result.imported.length, 0)
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].error, /EEXIST|file already exists|not a directory/i)
  assert.equal(removed, 'half-profile')
  assert.equal(await fsp.readFile(path.join(instance, 'minecraft', 'mods', 'one.jar'), 'utf8'), 'one')
})

test('one failed profile does not stop the rest of the batch', async () => {
  const root = await tempDir()
  await makePrismInstance(root, 'Good Pack')
  await makePrismInstance(root, 'Bad Pack')
  const { candidates } = await discoverCandidates({
    roots: [{ launcher: 'prism', path: path.join(root, 'instances'), kind: 'instances' }],
  })
  assert.equal(candidates.length, 2)
  const service = new LauncherImportService({
    installationService: {
      create: async (input) => {
        if (input.name === 'Bad Pack') throw new Error('This pack is deliberately broken.')
        return { id: 'good', name: input.name, gameDir: input.gameDir, managedGameDir: false }
      },
      remove: async () => {},
    },
    store: { installations: [], addActivity: async () => {} },
  })
  const result = await service.importCandidates(candidates, { mode: 'adopt', importWorlds: true })
  assert.equal(result.imported.length, 1)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].name, 'Bad Pack')
})
