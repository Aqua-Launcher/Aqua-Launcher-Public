import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { recoverOrphans, restoreStaged, stageContent } from '../electron/core/safe-mode.js'
import { sha1File } from '../electron/core/util.js'

async function makeGameDir(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-safe-mode-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

async function write(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

test('staging moves loose content and writes a manifest before restoring it', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'alpha')
  await write(path.join(gameDir, 'mods', 'beta.jar'), 'beta')
  await write(path.join(gameDir, 'resourcepacks', 'pack.zip'), 'pack')
  await write(path.join(gameDir, 'shaderpacks', 'shader.zip'), 'shader')
  await write(path.join(gameDir, 'mods', 'disabled.jar.disabled'), 'off')
  await write(path.join(gameDir, 'mods', 'readme.txt'), 'notes')

  const result = await stageContent(gameDir, { sessionId: 'session-1' })
  assert.equal(result.movedFiles, 4)
  assert.equal(result.sessionId, 'session-1')

  for (const relative of ['mods/alpha.jar', 'mods/beta.jar', 'resourcepacks/pack.zip', 'shaderpacks/shader.zip']) {
    const original = path.join(gameDir, relative)
    assert.equal(await fsp.readFile(original).catch(() => null), null, `${relative} should have moved`)
    const staged = path.join(gameDir, '.aqua', 'safe-mode', 'session-1', 'files', relative)
    assert.ok(await fsp.readFile(staged, 'utf8'))
  }
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'disabled.jar.disabled'), 'utf8'), 'off')
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'readme.txt'), 'utf8'), 'notes')

  const manifest = JSON.parse(
    await fsp.readFile(path.join(gameDir, '.aqua', 'safe-mode', 'session-1', 'manifest.json'), 'utf8'),
  )
  assert.equal(manifest.files.length, 4)
  const alpha = manifest.files.find((entry) => entry.relative === path.join('mods', 'alpha.jar'))
  assert.equal(alpha.sha1, await sha1File(path.join(gameDir, '.aqua', 'safe-mode', 'session-1', 'files', alpha.relative)))
})

test('restoring returns every file byte-for-byte and removes the staging folder', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'alpha-bytes')
  await write(path.join(gameDir, 'resourcepacks', 'pack.zip'), 'pack-bytes')
  await stageContent(gameDir, { sessionId: 'restore-1' })

  const result = await restoreStaged(gameDir, 'restore-1')
  assert.equal(result.restored, 2)
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.pending, false)
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'alpha.jar'), 'utf8'), 'alpha-bytes')
  assert.equal(await fsp.readFile(path.join(gameDir, 'resourcepacks', 'pack.zip'), 'utf8'), 'pack-bytes')
  assert.equal(await fsp.stat(path.join(gameDir, '.aqua', 'safe-mode', 'restore-1')).catch(() => null), null)
})

test('an interrupted restore finishes from the manifest', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'alpha')
  await write(path.join(gameDir, 'mods', 'beta.jar'), 'beta')
  await stageContent(gameDir, { sessionId: 'interrupted' })

  // The launcher died after putting the first file back but before cleaning up.
  const first = path.join(gameDir, '.aqua', 'safe-mode', 'interrupted', 'files', 'mods', 'alpha.jar')
  await write(path.join(gameDir, 'mods', 'alpha.jar'), await fsp.readFile(first, 'utf8'))
  await fsp.rm(first)

  const result = await restoreStaged(gameDir, 'interrupted')
  assert.equal(result.restored, 2)
  assert.equal(result.pending, false)
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'alpha.jar'), 'utf8'), 'alpha')
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'beta.jar'), 'utf8'), 'beta')
})

test('a file changed during Safe Mode is reported instead of overwritten', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'original')
  await stageContent(gameDir, { sessionId: 'conflict' })
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'changed-while-safe')

  const result = await restoreStaged(gameDir, 'conflict')
  assert.equal(result.restored, 0)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].relative, path.join('mods', 'alpha.jar'))
  assert.equal(result.pending, true)
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'alpha.jar'), 'utf8'), 'changed-while-safe')
  assert.equal(
    await fsp.readFile(path.join(gameDir, '.aqua', 'safe-mode', 'conflict', 'files', 'mods', 'alpha.jar'), 'utf8'),
    'original',
  )
})

test('a partial staging failure puts moved files back and refuses to launch', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'alpha')
  await write(path.join(gameDir, 'mods', 'zeta.jar'), 'zeta')
  // Make the second destination impossible to write, simulating a locked file.
  await fsp.mkdir(path.join(gameDir, '.aqua', 'safe-mode', 'rollback', 'files', 'mods', 'zeta.jar'), {
    recursive: true,
  })

  await assert.rejects(() => stageContent(gameDir, { sessionId: 'rollback' }), /Safe Mode could not move/)
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'alpha.jar'), 'utf8'), 'alpha')
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'zeta.jar'), 'utf8'), 'zeta')
  assert.equal(
    await fsp.readFile(path.join(gameDir, '.aqua', 'safe-mode', 'rollback', 'manifest.json'), 'utf8').catch(() => null),
    null,
  )
})

test('a missing or empty content folder is not an error', async (t) => {
  const gameDir = await makeGameDir(t)
  const result = await stageContent(gameDir)
  assert.equal(result.movedFiles, 0)
  assert.equal(await fsp.stat(path.join(gameDir, '.aqua')).catch(() => null), null)

  await fsp.mkdir(path.join(gameDir, 'mods'))
  const empty = await stageContent(gameDir)
  assert.equal(empty.movedFiles, 0)
})

test('orphan recovery restores a session left by a killed launcher', async (t) => {
  const gameDir = await makeGameDir(t)
  await write(path.join(gameDir, 'mods', 'alpha.jar'), 'alpha')
  await stageContent(gameDir, { sessionId: 'orphan' })

  const summary = await recoverOrphans([gameDir, gameDir])
  assert.equal(summary.restored, 1)
  assert.equal(summary.conflicts, 0)
  assert.equal(summary.pending, false)
  assert.equal(summary.sessions.length, 1)
  assert.equal(await fsp.readFile(path.join(gameDir, 'mods', 'alpha.jar'), 'utf8'), 'alpha')
})
