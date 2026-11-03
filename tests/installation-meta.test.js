import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { InstallationService } from '../electron/core/installations.js'
import {
  compareInstallationRecency,
  normalizeInstallationMeta,
  normalizeTags,
} from '../electron/core/installation-meta.js'
import { Store } from '../electron/core/store.js'

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} }

async function makeStore(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const options = {
    configFile: path.join(root, 'launcher.json'),
    instancesRoot: path.join(root, 'instances'),
    totalMemMb: 16_384,
    logger: silentLogger,
  }
  const store = new Store(options)
  await store.init()
  return { root, options, store }
}

test('tags are trimmed, deduplicated case-insensitively and capped', () => {
  const tags = normalizeTags([' Modded ', 'modded', 'Friends', 'fRIENDS', 42, '', 'x'.repeat(40)])
  assert.deepEqual(tags, ['Modded', 'Friends', 'x'.repeat(24)])
  assert.equal(normalizeTags(Array.from({ length: 12 }, (_, index) => `tag-${index}`)).length, 8)
  assert.deepEqual(normalizeTags('not a list'), [])
})

test('installation metadata rejects invalid colours, covers and positions', () => {
  const meta = normalizeInstallationMeta({
    pinned: 1,
    tags: [' a ', 'A'],
    color: 'neon',
    coverPath: 'relative/cover.png',
    sortIndex: -2,
  })
  assert.deepEqual(meta, { pinned: false, tags: ['a'], color: null, coverPath: null, sortIndex: null })
  assert.equal(normalizeInstallationMeta({ pinned: true, color: 'violet', sortIndex: 4 }).color, 'violet')
})

test('pinned profiles sort before recently played ones', () => {
  const pinned = { name: 'Pinned', pinned: true, lastPlayedAt: '2026-01-01T00:00:00.000Z' }
  const newer = { name: 'Newer', pinned: false, lastPlayedAt: '2026-02-01T00:00:00.000Z' }
  assert.deepEqual(
    [newer, pinned].sort(compareInstallationRecency).map((entry) => entry.name),
    ['Pinned', 'Newer'],
  )
})

test('pin, tags, colour and order survive a store restart', async () => {
  const { root, options, store } = await makeStore('aqua-installation-meta-')
  try {
    const coverPath = path.join(root, 'cover.png')
    await store.addInstallation({
      id: 'profile-a',
      name: 'Profile A',
      versionId: '1.21.4',
      gameDir: path.join(root, 'game-a'),
      pinned: true,
      tags: [' Modded ', 'modded', 'Friends'],
      color: 'violet',
      coverPath,
      sortIndex: 0,
    })

    const reloaded = new Store(options)
    await reloaded.init()
    const saved = reloaded.getInstallation('profile-a')
    assert.equal(saved.pinned, true)
    assert.deepEqual(saved.tags, ['Modded', 'Friends'])
    assert.equal(saved.color, 'violet')
    assert.equal(saved.coverPath, coverPath)
    assert.equal(saved.sortIndex, 0)

    await reloaded.removeInstallation('profile-a')
    assert.equal(reloaded.getInstallation('profile-a'), null)
    const afterDelete = new Store(options)
    await afterDelete.init()
    assert.deepEqual(afterDelete.installations, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('metadata updates validate input and leave Recent activity alone', async () => {
  const { root, store } = await makeStore('aqua-installation-update-')
  try {
    await store.addInstallation({
      id: 'a',
      name: 'Profile A',
      versionId: '1.21.4',
      gameDir: path.join(root, 'game-a'),
    })
    const service = new InstallationService({
      paths: { instancesRoot: path.join(root, 'instances') },
      store,
      versionService: {},
      javaService: null,
      logger: silentLogger,
    })
    service.serialize = async (installation) => installation

    await service.update('a', {
      pinned: true,
      tags: ['Ranked', ' ranked ', 'Friends'],
      color: 'teal',
      sortIndex: 2,
    })
    const saved = store.getInstallation('a')
    assert.equal(saved.pinned, true)
    assert.deepEqual(saved.tags, ['Ranked', 'Friends'])
    assert.equal(saved.color, 'teal')
    assert.equal(saved.sortIndex, 2)
    assert.equal(store.activity.length, 0)

    await assert.rejects(() => service.update('a', { color: 'neon' }), /colour/)
    await assert.rejects(() => service.update('a', { tags: 'nope' }), /list/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('drag order persists for every profile and rejects partial lists', async () => {
  const { root, options, store } = await makeStore('aqua-installation-order-')
  try {
    for (const id of ['a', 'b', 'c']) {
      await store.addInstallation({
        id,
        name: `Profile ${id.toUpperCase()}`,
        versionId: '1.21.4',
        gameDir: path.join(root, `game-${id}`),
      })
    }
    const service = new InstallationService({
      paths: { instancesRoot: path.join(root, 'instances') },
      store,
      versionService: {},
      javaService: null,
      logger: silentLogger,
    })
    await service.reorder(['c', 'a', 'b'])
    assert.deepEqual(
      store.installations.map((entry) => [entry.id, entry.sortIndex]),
      [
        ['a', 1],
        ['b', 2],
        ['c', 0],
      ],
    )

    const reloaded = new Store(options)
    await reloaded.init()
    assert.deepEqual(
      reloaded.installations.map((entry) => entry.sortIndex).sort((left, right) => left - right),
      [0, 1, 2],
    )

    await assert.rejects(() => service.reorder(['a', 'b']), /every installation/)
    await assert.rejects(() => service.reorder(['a', 'a', 'b']), /invalid/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
