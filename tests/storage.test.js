import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { StorageService, uniqueRoots } from '../electron/core/storage.js'

const DAY_MS = 24 * 60 * 60 * 1000

async function writeFile(target, contents) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, contents)
  return target
}

/** Builds a launcher layout shaped like the real one, with known file sizes. */
async function createFixture() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-storage-'))
  const paths = {
    dataRoot,
    versionsRoot: path.join(dataRoot, 'minecraft', 'versions'),
    librariesRoot: path.join(dataRoot, 'minecraft', 'libraries'),
    assetsRoot: path.join(dataRoot, 'minecraft', 'assets'),
    instancesRoot: path.join(dataRoot, 'instances'),
    logsRoot: path.join(dataRoot, 'logs'),
    gameLogsRoot: path.join(dataRoot, 'logs', 'game'),
    cacheRoot: path.join(dataRoot, 'cache'),
    avatarCacheRoot: path.join(dataRoot, 'cache', 'avatars'),
    versionCacheRoot: path.join(dataRoot, 'cache', 'versions'),
    artworkCacheRoot: path.join(dataRoot, 'cache', 'artwork'),
    backupsRoot: path.join(dataRoot, 'backups'),
    manifestCacheFile: path.join(dataRoot, 'cache', 'version-manifest.json'),
    patchNotesCacheFile: path.join(dataRoot, 'cache', 'patch-notes.json'),
    dropsCacheFile: path.join(dataRoot, 'cache', 'minecraft-drops.json'),
    launcherLog: path.join(dataRoot, 'logs', 'launcher.log'),
  }

  await writeFile(path.join(paths.instancesRoot, 'demo', 'saves', 'world', 'level.dat'), 'world-data')
  await writeFile(path.join(paths.instancesRoot, 'demo', 'mods', 'example.jar'), 'jar-bytes')
  await writeFile(path.join(paths.versionsRoot, '1.21', '1.21.json'), 'version-json')
  await writeFile(path.join(paths.versionsRoot, 'unused', 'unused.json'), 'stale-json')
  await writeFile(path.join(paths.librariesRoot, 'lib.jar'), 'library')
  await writeFile(path.join(paths.assetsRoot, 'indexes', '5.json'), 'asset-index')
  await writeFile(path.join(paths.backupsRoot, 'demo', 'world-1.zip'), 'backup')
  await writeFile(paths.launcherLog, 'launcher-output')
  await writeFile(path.join(paths.logsRoot, 'launcher.log.1'), 'rotated-log')
  await writeFile(path.join(paths.gameLogsRoot, 'new.log'), 'fresh-log')
  const oldLog = await writeFile(path.join(paths.gameLogsRoot, 'old.log'), 'stale-log')
  await writeFile(path.join(paths.artworkCacheRoot, 'drop.png'), 'png-bytes')
  await writeFile(path.join(paths.avatarCacheRoot, 'avatar.png'), 'avatar-bytes')
  await writeFile(path.join(paths.versionCacheRoot, 'tile.png'), 'tile-bytes')
  await writeFile(paths.manifestCacheFile, '{"versions":[]}')

  const stale = new Date(Date.now() - 30 * DAY_MS)
  await fs.utimes(oldLog, stale, stale)
  await fs.utimes(path.join(paths.logsRoot, 'launcher.log.1'), stale, stale)

  const installations = [
    {
      id: 'demo',
      name: 'Demo',
      gameDir: path.join(paths.instancesRoot, 'demo'),
      versionId: '1.21',
      loader: { type: 'vanilla', version: null, profileId: null },
    },
  ]

  return { dataRoot, paths, installations }
}

function createService(fixture, overrides = {}) {
  const trashed = []
  const service = new StorageService({
    paths: fixture.paths,
    store: { installations: fixture.installations },
    logger: null,
    trashItem: async (target) => {
      trashed.push(target)
    },
    ...overrides,
  })
  return { service, trashed }
}

async function directoryBytes(target) {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    let stats
    try {
      stats = await fs.stat(current)
    } catch {
      continue
    }
    if (stats.isFile()) {
      total += stats.size
      continue
    }
    for (const entry of await fs.readdir(current)) stack.push(path.join(current, entry))
  }
  return total
}

/** What a plain `du` would report: each physical file once, hardlinks included once. */
async function physicalBytes(target) {
  const seen = new Set()
  let total = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    let stats
    try {
      stats = await fs.stat(current)
    } catch {
      continue
    }
    if (stats.isFile()) {
      const key = stats.ino ? `${stats.dev}:${stats.ino}` : current
      if (seen.has(key)) continue
      seen.add(key)
      total += stats.size
      continue
    }
    for (const entry of await fs.readdir(current)) stack.push(path.join(current, entry))
  }
  return total
}

test('uniqueRoots keeps a nested folder from being measured twice', () => {
  const base = path.join(os.tmpdir(), 'aqua-roots')
  const a = path.join(base, 'a')
  const nested = path.join(base, 'a', 'b')
  const b = path.join(base, 'b')
  const c = path.join(base, 'c')

  assert.deepEqual(uniqueRoots([a, nested, c, c, b]), [a, c, b])
  assert.deepEqual(uniqueRoots([undefined, null, a]), [a])
})

test('a scan measures every launcher folder and adds up to its total', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service } = createService(fixture)

  const scan = await service.scan()
  const byId = Object.fromEntries(scan.categories.map((category) => [category.id, category]))

  assert.equal(scan.cancelled, false)
  assert.equal(scan.truncated, false)
  assert.equal(byId.instances.bytes, 'world-data'.length + 'jar-bytes'.length)
  assert.equal(byId.versions.bytes, 'version-json'.length + 'stale-json'.length)
  assert.equal(byId.backups.bytes, 'backup'.length)
  assert.equal(byId.caches.bytes, 'png-bytes'.length + 'avatar-bytes'.length + 'tile-bytes'.length + '{"versions":[]}'.length)
  assert.equal(
    scan.totalBytes,
    scan.categories.reduce((sum, category) => sum + category.bytes, 0),
    'the total is the sum of its categories',
  )
  assert.equal(byId.instances.path, path.join(fixture.paths.instancesRoot, 'demo'))
})

test('versions in use are never cleanup candidates', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service } = createService(fixture)

  const scan = await service.scan()
  const unused = scan.candidates.find((candidate) => candidate.id === 'versions:unused')

  assert.ok(unused, 'the unused version is offered for cleanup')
  assert.equal(unused.kind, 'versions')
  assert.equal(unused.safeByDefault, false, 'removing a version is never the default')
  assert.ok(!unused.label.includes('1.21'))

  const internal = await service.collectCandidates()
  const unusedPaths = internal.find((candidate) => candidate.id === 'versions:unused').paths
  assert.deepEqual(unusedPaths, [path.join(fixture.paths.versionsRoot, 'unused')])
})

test('only old logs and regenerable caches are cleanup candidates', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service } = createService(fixture)

  const scan = await service.scan()
  const ids = scan.candidates.map((candidate) => candidate.id)

  assert.ok(ids.includes('cache:artwork'))
  assert.ok(ids.includes('cache:avatars'))
  assert.ok(ids.includes('cache:metadata'))
  assert.ok(ids.includes('logs:game'), 'the month-old game log is offered')
  assert.ok(ids.includes('logs:launcher'), 'the rotated launcher log is offered')

  const gameLogs = await service.collectCandidates()
  const gameLog = gameLogs.find((candidate) => candidate.id === 'logs:game')
  assert.deepEqual(gameLog.paths, [path.join(fixture.paths.gameLogsRoot, 'old.log')], 'fresh logs are kept')

  // The public list the renderer sees carries no filesystem paths.
  for (const candidate of scan.candidates) {
    assert.equal(candidate.paths, undefined)
  }

  // A world, a mod and an asset are never offered, whatever their age.
  const labels = scan.candidates.map((candidate) => candidate.label.toLowerCase())
  for (const protectedLabel of ['world', 'mod', 'asset', 'resource pack', 'library']) {
    assert.ok(!labels.some((label) => label.includes(protectedLabel)), `${protectedLabel} is never a candidate`)
  }
})

test('cleanup resolves ids to paths it owns and leaves worlds alone', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service, trashed } = createService(fixture)

  const artworkBytes = await directoryBytes(fixture.paths.artworkCacheRoot)
  const result = await service.clean({ ids: ['cache:artwork', 'logs:game'] })

  assert.equal(result.failed.length, 0)
  assert.equal(result.removed.length, 2)
  assert.equal(result.freedBytes, artworkBytes + 'stale-log'.length)
  assert.deepEqual(trashed, [
    fixture.paths.artworkCacheRoot,
    path.join(fixture.paths.gameLogsRoot, 'old.log'),
  ])
  await fs.access(path.join(fixture.paths.instancesRoot, 'demo', 'saves', 'world', 'level.dat'))
  await fs.access(path.join(fixture.paths.instancesRoot, 'demo', 'mods', 'example.jar'))
})

test('an unknown cleanup id is rejected instead of guessed at', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service, trashed } = createService(fixture)

  await assert.rejects(() => service.clean({ ids: ['../../etc'] }), /Nothing to clean up/)
  await assert.rejects(() => service.clean({ ids: [] }), /at least one item/)
  assert.equal(trashed.length, 0)
})

test('cleanup refuses anything outside the launcher data folder or inside a game directory', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const outsider = await writeFile(path.join(os.tmpdir(), `aqua-outsider-${Date.now()}.txt`), 'not mine')
  t.after(() => fs.rm(outsider, { force: true }))
  const { service, trashed } = createService(fixture)

  service.collectCandidates = async () => [
    {
      id: 'fake:outsider',
      kind: 'cache',
      label: 'Outside the data folder',
      bytes: 0,
      files: 1,
      safeByDefault: true,
      reason: 'test',
      root: fixture.paths.dataRoot,
      paths: [outsider],
    },
    {
      id: 'fake:game-dir',
      kind: 'cache',
      label: 'Inside a game directory',
      bytes: 0,
      files: 1,
      safeByDefault: true,
      reason: 'test',
      root: fixture.paths.dataRoot,
      paths: [path.join(fixture.paths.instancesRoot, 'demo', 'saves', 'world', 'level.dat')],
    },
    {
      id: 'fake:data-root',
      kind: 'cache',
      label: 'The data folder itself',
      bytes: 0,
      files: 1,
      safeByDefault: true,
      reason: 'test',
      root: fixture.paths.dataRoot,
      paths: [fixture.paths.dataRoot],
    },
  ]

  const result = await service.clean({ ids: ['fake:outsider', 'fake:game-dir', 'fake:data-root'] })

  assert.equal(trashed.length, 0, 'nothing was touched')
  assert.equal(result.removed.length, 0)
  assert.equal(result.freedBytes, 0)
  assert.equal(result.failed.length, 3)
  assert.match(result.failed[0].error, /not managed by the launcher/)
  await fs.access(outsider)
  await fs.access(path.join(fixture.paths.instancesRoot, 'demo', 'saves', 'world', 'level.dat'))
})

test('hardlinked files are counted once per scan', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const original = await writeFile(path.join(fixture.paths.librariesRoot, 'shared.jar'), 'shared-bytes')
  const linked = path.join(fixture.paths.assetsRoot, 'shared-copy.jar')
  try {
    await fs.mkdir(path.dirname(linked), { recursive: true })
    await fs.link(original, linked)
  } catch {
    t.skip('this filesystem does not support hard links')
    return
  }
  const { service } = createService(fixture)

  const scan = await service.scan()
  const libraries = scan.categories.find((category) => category.id === 'libraries')
  const assets = scan.categories.find((category) => category.id === 'assets')
  const seenInCategories = libraries.bytes + assets.bytes

  assert.equal(
    seenInCategories,
    'library'.length + 'shared-bytes'.length + 'asset-index'.length,
    'the linked file is charged to the first category that sees it',
  )
  assert.equal(scan.totalBytes, await physicalBytes(fixture.dataRoot), 'the total counts each physical file once')
  assert.ok(
    scan.totalBytes < (await directoryBytes(fixture.dataRoot)),
    'counting the link twice would overshoot the real size',
  )
})

test('cancelling a scan returns partial numbers and no candidates', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service } = createService(fixture)

  const pending = service.scan()
  service.cancel()
  const scan = await pending

  assert.equal(scan.cancelled, true)
  assert.deepEqual(scan.candidates, [])
  assert.equal(service.lastScan, null, 'a cancelled scan is not cached')
})

test('a finished scan is reused, and an explicit scan refreshes it', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.dataRoot, { recursive: true, force: true }))
  const { service } = createService(fixture)

  const first = await service.scan()
  const reused = await service.scan()
  assert.equal(reused.scannedAt, first.scannedAt)

  await writeFile(path.join(fixture.paths.assetsRoot, 'added.json'), 'more-bytes')
  const forced = await service.scan({ force: true })
  assert.notEqual(forced.scannedAt, first.scannedAt)
  assert.equal(forced.totalBytes, first.totalBytes + 'more-bytes'.length)
})
