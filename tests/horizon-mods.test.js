import AdmZip from 'adm-zip'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  HORIZON_CONTENT_MODS_DIR,
  HORIZON_MODS_FILE,
  HORIZON_NATIVE_MODS_DIR,
  HORIZON_NATIVE_NOTE,
  HORIZON_RESOURCE_PACKS_DIR,
  HorizonService,
  horizonModKind,
  horizonModTitle,
  parseHorizonModState,
  readHorizonModManifest,
  removeHorizonModState,
  setHorizonModState,
} from '../electron/core/horizon.js'

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

function writeZip(file, entries) {
  const zip = new AdmZip()
  for (const [name, contents] of Object.entries(entries)) zip.addFile(name, Buffer.from(contents))
  zip.writeZip(file)
}

async function temporaryRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-mods-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

test('Horizon mod downloads are routed by the extension Horizon reads', () => {
  assert.equal(horizonModKind('zoom-2.0.0.hnmod'), 'native')
  assert.equal(horizonModKind('MY-MOD.HMOD'), 'content')
  assert.equal(horizonModKind('Menu Panorama.zip'), 'resourcepack')
  assert.equal(horizonModKind('fabric-api.jar'), null)
  assert.equal(horizonModKind('pack.mcpack'), null)
  assert.equal(horizonModTitle('appleskin-0.1.1.hnmod'), 'appleskin 0.1.1')
})

test('horizon-mods.txt switches change without dropping Horizon key binds', () => {
  const text = 'mod.zoom:true\nkey.zoom.toggle:key.keyboard.z\nmod.minimap:false\n'
  const state = parseHorizonModState(text)
  assert.deepEqual([...state.enabled], ['zoom'])
  assert.deepEqual([...state.disabled], ['minimap'])

  const toggled = setHorizonModState(text, 'zoom', false)
  assert.equal(toggled, 'mod.zoom:false\nkey.zoom.toggle:key.keyboard.z\nmod.minimap:false\n')
  const added = setHorizonModState(toggled, 'coords_hud', true)
  assert.match(added, /mod\.coords_hud:true\n$/)
  assert.match(added, /key\.zoom\.toggle:key\.keyboard\.z/)
  assert.equal(
    removeHorizonModState(added, 'minimap'),
    'mod.zoom:false\nkey.zoom.toggle:key.keyboard.z\nmod.coords_hud:true\n',
  )
})

test('each Horizon file is read through the manifest Horizon itself uses', async (t) => {
  const root = await temporaryRoot(t)
  const native = path.join(root, 'appleskin-0.1.1.hnmod')
  writeZip(native, {
    'horizon-native.json': JSON.stringify({ schema: 1, id: 'appleskin', version: '0.1.1', game: '26.3' }),
    'mixins/appleskin/bar.rs': '// mixin',
  })
  assert.deepEqual(await readHorizonModManifest(native, 'native'), {
    id: 'appleskin',
    name: null,
    version: '0.1.1',
    game: '26.3',
    horizon: null,
    mixins: null,
    hooks: null,
  })

  const content = path.join(root, 'compass_bar.hmod')
  writeZip(content, {
    'horizon-mod.toml': 'id = "compass_bar"\nname = "Compass Enhanced"\nversion = "0.1.0"\napi = "0.1"\n',
  })
  assert.deepEqual(await readHorizonModManifest(content, 'content'), {
    id: 'compass_bar',
    name: 'Compass Enhanced',
    version: '0.1.0',
    game: null,
  })

  const pack = path.join(root, 'Menu Panorama.zip')
  writeZip(pack, { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: 'Menu Panorama' } }) })
  assert.deepEqual(await readHorizonModManifest(pack, 'resourcepack'), {
    id: null,
    name: 'Menu Panorama',
    version: null,
    game: null,
  })

  const broken = path.join(root, 'broken.hmod')
  writeZip(broken, { 'assets/broken/x.txt': 'not a mod' })
  assert.equal(await readHorizonModManifest(broken, 'content'), null)
})

test('Horizon mods install into the folders and switches the Rust client reads', async (t) => {
  const root = await temporaryRoot(t)
  const paths = makePaths(root)
  const downloads = path.join(root, 'downloads')
  await fsp.mkdir(downloads, { recursive: true })
  const service = new HorizonService({ paths, platform: 'win32', arch: 'x64' })
  const gameHome = paths.horizonGameRoot

  const hmod = path.join(downloads, 'my-mod-1.0.0.hmod')
  writeZip(hmod, {
    'horizon-mod.toml': 'id = "my_mod"\nname = "My Mod"\nversion = "1.0.0"\n',
    'assets/my_mod/thing.json': '{}',
  })
  const content = await service.importMod(hmod)
  assert.equal(content.filename, 'my_mod.hmod')
  assert.equal(content.kind, 'content')
  assert.equal(content.title, 'My Mod')
  assert.equal(content.version, '1.0.0')
  await fsp.access(path.join(gameHome, HORIZON_CONTENT_MODS_DIR, 'my_mod.hmod'))

  let listed = await service.listMods()
  assert.equal(listed.mods.length, 1)
  assert.equal(listed.mods[0].enabled, false, 'content mods start off, as Horizon does')
  await service.toggleMod('my_mod.hmod', 'content')
  listed = await service.listMods()
  assert.equal(listed.mods[0].enabled, true)
  assert.equal(await fsp.readFile(path.join(gameHome, HORIZON_MODS_FILE), 'utf8'), 'mod.my_mod:true\n')

  const hnmod = path.join(downloads, 'zoom-2.0.0.hnmod')
  writeZip(hnmod, {
    'horizon-native.json': JSON.stringify({ schema: 1, id: 'zoom', version: '2.0.0', game: '26.3' }),
    'mixins/zoom/zoom.rs': '// mixin',
  })
  const native = await service.importMod(hnmod)
  assert.equal(native.filename, 'zoom.hnmod')
  assert.equal(native.kind, 'native')
  assert.equal(native.note, HORIZON_NATIVE_NOTE)
  await fsp.access(path.join(gameHome, HORIZON_NATIVE_MODS_DIR, 'zoom.hnmod'))
  listed = await service.listMods()
  assert.equal(listed.mods.find((mod) => mod.id === 'zoom').enabled, true, 'native mods run until switched off')
  await service.toggleMod('zoom.hnmod', 'native')
  assert.equal((await service.listMods()).mods.find((mod) => mod.id === 'zoom').enabled, false)
  assert.match(await fsp.readFile(path.join(gameHome, HORIZON_MODS_FILE), 'utf8'), /mod\.zoom:false/)

  const pack = path.join(downloads, 'Menu Panorama.zip')
  writeZip(pack, { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: 'Menu Panorama' } }) })
  const resourcePack = await service.importMod(pack)
  assert.equal(resourcePack.kind, 'resourcepack')
  assert.equal(resourcePack.filename, 'Menu Panorama.zip')
  await fsp.access(path.join(gameHome, HORIZON_RESOURCE_PACKS_DIR, 'Menu Panorama.zip'))
  await assert.rejects(service.toggleMod('Menu Panorama.zip', 'resourcepack'), /no switch/)

  await service.removeMod('my_mod.hmod', 'content')
  assert.doesNotMatch(await fsp.readFile(path.join(gameHome, HORIZON_MODS_FILE), 'utf8'), /mod\.my_mod/)
  await assert.rejects(service.removeMod('../outside.hmod', 'content'), /invalid/)
})

test('a mod without the manifest Horizon reads is refused', async (t) => {
  const root = await temporaryRoot(t)
  const service = new HorizonService({ paths: makePaths(root), platform: 'win32', arch: 'x64' })
  const downloads = path.join(root, 'downloads')
  await fsp.mkdir(downloads, { recursive: true })

  const fake = path.join(downloads, 'fake.hmod')
  writeZip(fake, { 'assets/fake/x.json': '{}' })
  await assert.rejects(service.importMod(fake), /horizon-mod\.toml/)

  const jar = path.join(downloads, 'fabric.jar')
  await fsp.writeFile(jar, 'not horizon')
  await assert.rejects(service.importMod(jar), /\.hnmod, \.hmod, or \.zip/)
})
