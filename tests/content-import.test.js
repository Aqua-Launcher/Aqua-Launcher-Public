import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importExtension, planImports, runImports } from '../electron/core/content-import.js'

async function tempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-import-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

function writeZip(filePath, entries) {
  const zip = new AdmZip()
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value))
  zip.writeZip(filePath)
}

test('extensions route jars, packs and Bedrock files', () => {
  assert.equal(importExtension('Sodium.jar'), 'mod')
  assert.equal(importExtension('pack.ZIP'), 'zip')
  assert.equal(importExtension('pack.mrpack'), 'mrpack')
  assert.equal(importExtension('readme.txt'), null)
})

test('zip contents distinguish shader packs from resource packs', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const shader = path.join(root, 'shader.zip')
  const resource = path.join(root, 'resource.zip')
  writeZip(shader, { 'shaders/example/shader.frag': 'void main() {}' })
  writeZip(resource, { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34 } }), 'assets/example/a.txt': 'a' })

  const items = await planImports({ paths: [shader, resource], gameDir })
  assert.equal(items[0].target, 'shader')
  assert.equal(items[0].destination, path.join(gameDir, 'shaderpacks', 'shader.zip'))
  assert.equal(items[1].target, 'resourcepack')
  assert.equal(items[1].destination, path.join(gameDir, 'resourcepacks', 'resource.zip'))
})

test('a jar is copied rather than moved and conflicts follow the selected policy', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const source = path.join(root, 'example.jar')
  const mods = path.join(gameDir, 'mods')
  const destination = path.join(mods, 'example.jar')
  await fsp.mkdir(mods, { recursive: true })
  await fsp.writeFile(source, 'new bytes')
  await fsp.writeFile(destination, 'old bytes')

  const skipped = await runImports({
    paths: [source],
    gameDir,
    conflictPolicy: 'skip',
  })
  assert.equal(skipped.imported.length, 0)
  assert.equal(skipped.skipped.length, 1)
  assert.equal(await fsp.readFile(destination, 'utf8'), 'old bytes')
  assert.equal(await fsp.readFile(source, 'utf8'), 'new bytes')

  const kept = await runImports({
    paths: [source],
    gameDir,
    conflictPolicy: 'keep-both',
  })
  assert.equal(kept.imported.length, 1)
  assert.match(kept.imported[0].filename, /example \(2\)\.jar/)
  assert.equal(await fsp.readFile(source, 'utf8'), 'new bytes')

  const replaced = await runImports({
    paths: [source],
    gameDir,
    conflictPolicy: 'replace',
  })
  assert.equal(replaced.imported.length, 1)
  assert.equal(await fsp.readFile(destination, 'utf8'), 'new bytes')
  assert.equal(await fsp.readFile(source, 'utf8'), 'new bytes')
})

test('ask returns conflicts without writing anything', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const mods = path.join(gameDir, 'mods')
  const source = path.join(root, 'example.jar')
  await fsp.mkdir(mods, { recursive: true })
  await fsp.writeFile(source, 'new')
  await fsp.writeFile(path.join(mods, 'example.jar'), 'old')

  const result = await runImports({ paths: [source], gameDir, conflictPolicy: 'ask' })
  assert.equal(result.imported.length, 0)
  assert.equal(result.conflicts.length, 1)
  assert.equal(await fsp.readFile(path.join(mods, 'example.jar'), 'utf8'), 'old')
})

test('unsafe and unsupported paths become errors', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const pack = path.join(root, 'pack.mrpack')
  await fsp.writeFile(pack, 'not a pack')
  await fsp.mkdir(gameDir, { recursive: true })

  const result = await runImports({ paths: ['relative.jar', pack], gameDir, conflictPolicy: 'skip' })
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0].reason, /absolute/i)
  assert.match(result.errors[1].reason, /Modpack import/i)
})

test('dry runs return the plan without copying', async (t) => {
  const root = await tempRoot(t)
  const gameDir = path.join(root, 'game')
  const source = path.join(root, 'example.jar')
  await fsp.writeFile(source, 'new')
  const result = await runImports({ paths: [source], gameDir, dryRun: true })
  assert.equal(result.items[0].target, 'mod')
  assert.equal(result.imported.length, 0)
  await assert.rejects(() => fsp.stat(path.join(gameDir, 'mods', 'example.jar')), /ENOENT/)
})
