import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  ModrinthService,
  datapackCompatibilityWarning,
  datapackFormatForVersion,
} from '../electron/core/modrinth.js'

async function tempWorld() {
  const gameDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-datapack-'))
  const world = path.join(gameDir, 'saves', 'test-world')
  await fsp.mkdir(path.join(world, 'datapacks'), { recursive: true })
  return { gameDir, world }
}

test('datapack formats cover modern Minecraft and mismatches stay advisory', () => {
  assert.equal(datapackFormatForVersion('1.21.1'), 48)
  assert.equal(datapackFormatForVersion('1.21.4'), 61)
  assert.equal(datapackFormatForVersion('1.20.5'), 41)
  assert.equal(datapackCompatibilityWarning(48, '1.21.1'), null)
  assert.match(datapackCompatibilityWarning(48, '1.21.4'), /pack_format 48.*expects 61/)
  assert.match(datapackCompatibilityWarning(null, '1.21.1'), /No readable pack.mcmeta/)
})

test('datapack paths stay inside the selected world', async () => {
  const { gameDir } = await tempWorld()
  const service = new ModrinthService({})
  const installation = { gameDir }
  assert.equal(
    service.contentDirectoryForWorld(installation, 'datapack', 'test-world'),
    path.join(gameDir, 'saves', 'test-world', 'datapacks'),
  )
  assert.throws(() => service.worldDirectory(installation, '../outside'), /Choose a world|outside/)
  assert.throws(() => service.worldDirectory(installation, 'nested/world'), /Choose a world/)
  await assert.rejects(() => service.requireWorld(installation, 'missing-world'), /no longer exists/)
})

test('datapack toggle and remove operate on the world folder', async () => {
  const { gameDir, world } = await tempWorld()
  const service = new ModrinthService({})
  const installation = { gameDir }
  const datapacks = path.join(world, 'datapacks')
  const file = path.join(datapacks, 'example.zip')
  await fsp.writeFile(file, 'datapack')

  const disabled = await service.toggle(installation, 'example.zip', 'datapack', 'test-world')
  assert.deepEqual(disabled, { filename: 'example.zip.disabled', enabled: false })
  assert.equal(await fsp.stat(path.join(datapacks, 'example.zip.disabled')).then(() => true), true)

  const enabled = await service.toggle(installation, 'example.zip.disabled', 'datapack', 'test-world')
  assert.deepEqual(enabled, { filename: 'example.zip', enabled: true })
  assert.equal(await fsp.readFile(file, 'utf8'), 'datapack')

  assert.deepEqual(await service.remove(installation, 'example.zip', 'datapack', 'test-world'), {
    filename: 'example.zip',
  })
  await assert.rejects(() => fsp.stat(file))
})
