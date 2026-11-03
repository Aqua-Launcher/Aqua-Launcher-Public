import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  analyzeServerCompatibility,
  detectOnlineMode,
  extractMinecraftVersion,
} from '../src/lib/serverCompatibility.ts'

const ONLINE_UUID = '8b3f6f2e-3a9e-4c5b-9d1a-2f7c8e9b0a1c'
const OFFLINE_UUID = '8b3f6f2e-3a9e-3c5b-8d1a-2f7c8e9b0a1c'

function server(overrides = {}) {
  return { edition: 'java', installationId: 'profile-1', ...overrides }
}

function installation(overrides = {}) {
  return {
    name: 'Survival',
    versionId: '1.21.4',
    loader: { type: 'vanilla' },
    installed: true,
    ...overrides,
  }
}

function status(overrides = {}) {
  return {
    online: true,
    version: '1.21.4',
    protocol: 769,
    modded: false,
    players: {
      online: 1,
      max: 20,
      sample: [{ name: 'Steve', id: ONLINE_UUID }],
    },
    ...overrides,
  }
}

test('a version mismatch names both the server and profile versions', () => {
  const result = analyzeServerCompatibility({
    server: server(),
    installation: installation(),
    accountType: 'microsoft',
    status: status({ version: 'Paper 1.21.5' }),
  })

  assert.equal(result.level, 'warning')
  assert.equal(result.label, 'Version mismatch')
  assert.equal(result.serverVersion, '1.21.5')
  assert.equal(result.instanceVersion, '1.21.4')
  assert.equal(result.issues[0].code, 'version')
  assert.match(result.issues[0].detail, /1\.21\.5/)
  assert.match(result.issues[0].detail, /1\.21\.4/)
})

test('an offline account is warned about an online-mode server', () => {
  const result = analyzeServerCompatibility({
    server: server(),
    installation: installation(),
    accountType: 'offline',
    status: status(),
  })

  assert.equal(detectOnlineMode(status()), true)
  assert.equal(detectOnlineMode(status({ players: { online: 1, max: 20, sample: [{ name: 'Alex', id: OFFLINE_UUID }] } })), false)
  assert.equal(detectOnlineMode(status({ players: { online: 0, max: 20, sample: [] } })), null)
  assert.equal(result.level, 'warning')
  assert.ok(result.issues.some((issue) => issue.code === 'account'))
})

test('a Forge server warns a vanilla profile, but a modded profile does not', () => {
  const vanilla = analyzeServerCompatibility({
    server: server(),
    installation: installation(),
    accountType: 'microsoft',
    status: status({ modded: true }),
  })
  assert.ok(vanilla.issues.some((issue) => issue.code === 'mods'))

  const modded = analyzeServerCompatibility({
    server: server(),
    installation: installation({ loader: { type: 'forge' } }),
    accountType: 'microsoft',
    status: status({ modded: true }),
  })
  assert.equal(modded.level, 'ok')
  assert.equal(modded.issues.length, 0)
})

test('matching profiles have no warnings, and a deleted binding is called out', () => {
  const matching = analyzeServerCompatibility({
    server: server(),
    installation: installation(),
    accountType: 'microsoft',
    status: status(),
  })
  assert.equal(matching.level, 'ok')
  assert.equal(matching.label, 'Compatible')
  assert.deepEqual(matching.issues, [])

  const fallback = analyzeServerCompatibility({
    server: server(),
    installation: installation({ name: 'Active profile' }),
    accountType: 'microsoft',
    status: status(),
    usedFallback: true,
  })
  assert.equal(fallback.level, 'warning')
  assert.equal(fallback.label, 'Saved profile missing')
  assert.match(fallback.issues[0].detail, /Active profile/)
})

test('version text and Bedrock servers stay conservative', () => {
  assert.equal(extractMinecraftVersion('Fabric 1.21.4'), '1.21.4')
  assert.equal(extractMinecraftVersion('1.21'), '1.21')
  assert.equal(extractMinecraftVersion('unknown'), null)

  const bedrock = analyzeServerCompatibility({
    server: { edition: 'bedrock', installationId: null },
    installation: null,
    accountType: null,
    status: status(),
  })
  assert.equal(bedrock.level, 'ok')
  assert.equal(bedrock.label, null)
})

test('deleting a profile clears its server binding without removing the row', async () => {
  const { Store } = await import('../electron/core/store.js')
  const { ServerService } = await import('../electron/core/servers.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-binding-'))
  const logger = { info() {}, warn() {}, debug() {}, error() {} }
  try {
    const store = new Store({
      configFile: path.join(root, 'launcher.json'),
      instancesRoot: path.join(root, 'instances'),
      totalMemMb: 16_384,
      logger,
    })
    await store.init()
    await store.addInstallation({
      id: 'profile-1',
      name: 'Survival',
      versionId: '1.21.4',
      loader: { type: 'vanilla', version: null, profileId: null },
    })
    const service = new ServerService({ store, logger: null })
    const added = await service.add({
      name: 'SMP',
      address: 'play.example.com',
      installationId: 'profile-1',
    })

    assert.equal(added.installationId, 'profile-1')
    assert.equal(store.getServer(added.id).installationId, 'profile-1')

    await store.removeInstallation('profile-1')
    assert.equal(store.servers.length, 1)
    assert.equal(store.getServer(added.id).installationId, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a binding to a missing profile is rejected before a server row is written', async () => {
  const { ServerService } = await import('../electron/core/servers.js')
  const records = []
  const store = {
    get servers() {
      return records
    },
    getInstallation() {
      return null
    },
    async addServer(row) {
      records.push(row)
    },
    publicServer(row) {
      return row ? { ...row } : null
    },
  }
  const service = new ServerService({ store, logger: null })
  await assert.rejects(
    () => service.add({ name: 'SMP', address: 'play.example.com', installationId: 'deleted-profile' }),
    /no longer exists/i,
  )
  assert.deepEqual(records, [])
})
