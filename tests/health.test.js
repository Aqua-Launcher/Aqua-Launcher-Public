import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkInstallation, parseModMetadata, worstStatus } from '../electron/core/health.js'

async function fixture(t, { loader = 'vanilla' } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-health-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const minecraftRoot = path.join(root, 'minecraft')
  const versionsRoot = path.join(minecraftRoot, 'versions')
  const librariesRoot = path.join(minecraftRoot, 'libraries')
  const assetsRoot = path.join(minecraftRoot, 'assets')
  const gameDir = path.join(root, 'instance')
  const versionId = '1.21.1'
  await fsp.mkdir(path.join(versionsRoot, versionId), { recursive: true })
  await fsp.mkdir(path.join(assetsRoot, 'indexes'), { recursive: true })
  await fsp.mkdir(path.join(librariesRoot), { recursive: true })
  await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true })
  await fsp.mkdir(path.join(gameDir, 'saves'), { recursive: true })
  await fsp.writeFile(path.join(versionsRoot, versionId, `${versionId}.jar`), 'jar')
  await fsp.writeFile(path.join(assetsRoot, 'indexes', '17.json'), '{"objects":{}}')
  const versionJson = {
    id: versionId,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { majorVersion: 21 },
    assetIndex: { id: '17' },
    assets: '17',
    downloads: { client: { path: `${versionId}.jar` } },
    libraries: [],
  }
  await fsp.writeFile(path.join(versionsRoot, versionId, `${versionId}.json`), JSON.stringify(versionJson, null, 2))
  const installation = {
    id: 'instance-1',
    name: 'Test instance',
    versionId,
    loader: { type: loader, version: loader === 'vanilla' ? null : '0.16.0', profileId: null },
    gameDir,
    installed: true,
    memoryOverride: null,
    javaPath: null,
  }
  const paths = { minecraftRoot, versionsRoot, librariesRoot, assetsRoot, instancesRoot: root }
  const store = { settings: { memory: { minMb: 1024, maxMb: 4096 } }, installations: [installation] }
  const javaService = { detect: async () => [{ major: 21, path: '/java' }] }
  return { root, paths, store, installation, javaService, gameDir, versionsRoot, versionId }
}

function writeJar(filePath, metadataPath, metadata) {
  const zip = new AdmZip()
  zip.addFile(metadataPath, Buffer.from(JSON.stringify(metadata)))
  zip.writeZip(filePath)
}

function byId(result, id) {
  return result.checks.find((entry) => entry.id === id)
}

test('a healthy vanilla instance is all ok and green', async (t) => {
  const data = await fixture(t)
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  assert.equal(result.status, 'ok')
  assert.equal(byId(result, 'client-jar').status, 'ok')
  assert.equal(byId(result, 'asset-index').status, 'ok')
  assert.equal(byId(result, 'java').status, 'ok')
  assert.equal(byId(result, 'memory').status, 'ok')
  assert.equal(byId(result, 'shared-directory').status, 'ok')
})

test('deleting the client jar is an error with a repair action', async (t) => {
  const data = await fixture(t)
  await fsp.rm(path.join(data.versionsRoot, data.versionId, `${data.versionId}.jar`))
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  const client = byId(result, 'client-jar')
  assert.equal(client.status, 'error')
  assert.equal(client.fix.kind, 'reinstall')
  assert.equal(result.status, 'error')
})

test('duplicate mod IDs name both files', async (t) => {
  const data = await fixture(t)
  writeJar(path.join(data.gameDir, 'mods', 'first.jar'), 'fabric.mod.json', { id: 'sodium', name: 'Sodium', depends: {} })
  writeJar(path.join(data.gameDir, 'mods', 'second.jar'), 'fabric.mod.json', { id: 'sodium', name: 'Sodium', depends: {} })
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  const duplicate = byId(result, 'duplicate-mods')
  assert.equal(duplicate.status, 'error')
  assert.match(duplicate.detail, /first\.jar/)
  assert.match(duplicate.detail, /second\.jar/)
})

test('a shared game directory is flagged with the other installation name', async (t) => {
  const data = await fixture(t)
  data.store.installations.push({ ...data.installation, id: 'instance-2', name: 'Shared profile' })
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  const shared = byId(result, 'shared-directory')
  assert.equal(shared.status, 'warn')
  assert.match(shared.detail, /Shared profile/)
})

test('a Forge jar in a vanilla profile is reported as the wrong loader', async (t) => {
  const data = await fixture(t)
  const zip = new AdmZip()
  zip.addFile(
    'META-INF/mods.toml',
    Buffer.from('[[mods]]\nmodId="jei"\ndisplayName="JEI"\n[[dependencies.jei]]\nmodId="minecraft"\nmandatory=true\n'),
  )
  zip.writeZip(path.join(data.gameDir, 'mods', 'jei.jar'))
  const metadata = parseModMetadata(path.join(data.gameDir, 'mods', 'jei.jar'))
  assert.equal(metadata.loader, 'forge')
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  assert.equal(byId(result, 'mod-loader').status, 'warn')
})

test('a missing declared dependency is reported by name', async (t) => {
  const data = await fixture(t)
  writeJar(path.join(data.gameDir, 'mods', 'create-addon.jar'), 'fabric.mod.json', {
    id: 'create_addon',
    name: 'Create Addon',
    depends: { minecraft: '1.21.1', fabricloader: '>=0.16', create: '>=0.5' },
  })
  const result = await checkInstallation(data, { totalMemMb: 16_384, freeBytes: 10 * 1024 * 1024 * 1024 })
  const dependency = byId(result, 'mod-dependencies')
  assert.equal(dependency.status, 'warn')
  assert.match(dependency.detail, /Create Addon needs create/)
})

test('worstStatus ranks errors above warnings and warnings above unknown', () => {
  assert.equal(worstStatus([{ status: 'ok' }, { status: 'unknown' }]), 'unknown')
  assert.equal(worstStatus([{ status: 'unknown' }, { status: 'warn' }]), 'warn')
  assert.equal(worstStatus([{ status: 'warn' }, { status: 'error' }]), 'error')
  assert.equal(worstStatus([]), 'ok')
})
