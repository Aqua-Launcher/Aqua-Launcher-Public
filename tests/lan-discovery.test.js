import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  LAN_MULTICAST_ADDRESS,
  LAN_PORT,
  LanDiscoveryService,
  LanRegistry,
  parseLanBroadcast,
} from '../electron/core/lan-discovery.js'

test('LAN broadcasts expose the world name and game port', () => {
  assert.deepEqual(parseLanBroadcast('[MOTD]Survival \u00a7aworld[/MOTD][AD]54321[/AD]'), {
    motd: 'Survival world',
    port: 54321,
  })
  assert.equal(parseLanBroadcast('[MOTD]No port[/MOTD]'), null)
  assert.equal(parseLanBroadcast('[MOTD]Bad[/MOTD][AD]70000[/AD]'), null)
  assert.equal(parseLanBroadcast('[MOTD]Zero[/MOTD][AD]0[/AD]'), null)
  assert.equal(parseLanBroadcast('x'.repeat(5000)), null)
  assert.equal(parseLanBroadcast(null), null)
})

test('the LAN registry deduplicates by source and port and expires silent worlds', () => {
  let now = 1_000
  const registry = new LanRegistry({ ttlMs: 10_000, now: () => now })
  assert.equal(registry.ingest('[MOTD]One[/MOTD][AD]25565[/AD]', '192.168.1.20', now), true)
  assert.equal(registry.ingest('[MOTD]Two[/MOTD][AD]25565[/AD]', '192.168.1.21', now), true)
  assert.equal(registry.ingest('[MOTD]One again[/MOTD][AD]25565[/AD]', '192.168.1.20', now + 1_000), true)

  let worlds = registry.list(now + 1_000)
  assert.equal(worlds.length, 2)
  assert.equal(worlds.find((world) => world.sourceAddress === '192.168.1.20').motd, 'One again')
  assert.equal(worlds[0].address.startsWith('localhost:'), true)

  now = 2_000
  now += 10_001
  assert.deepEqual(registry.list(now), [])
})

test('the LAN registry keeps the newest entries under its cap', () => {
  let now = 1_000
  const registry = new LanRegistry({ maxEntries: 2, now: () => now })
  registry.ingest('[MOTD]One[/MOTD][AD]25565[/AD]', '10.0.0.1', now)
  now += 10
  registry.ingest('[MOTD]Two[/MOTD][AD]25566[/AD]', '10.0.0.2', now)
  now += 10
  registry.ingest('[MOTD]Three[/MOTD][AD]25567[/AD]', '10.0.0.3', now)
  const worlds = registry.list(now)
  assert.equal(worlds.length, 2)
  assert.deepEqual(
    worlds.map((world) => world.motd).sort(),
    ['Three', 'Two'],
  )
})

test('the UDP service starts idempotently, publishes, and closes cleanly', () => {
  class FakeSocket extends EventEmitter {
    constructor() {
      super()
      this.memberships = []
      this.closed = false
      this.options = null
    }

    bind(options) {
      this.options = options
      this.emit('listening')
    }

    addMembership(group, address) {
      this.memberships.push({ group, address })
    }

    close() {
      if (this.closed) return
      this.closed = true
      this.emit('close')
    }
  }

  const socket = new FakeSocket()
  const snapshots = []
  const service = new LanDiscoveryService({
    createSocket: () => socket,
    networkInterfaces: () => ({
      Ethernet: [{ family: 'IPv4', address: '192.168.1.10', internal: false }],
      Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    }),
    registry: new LanRegistry({ now: () => 1_000 }),
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  assert.equal(service.start(), true)
  assert.equal(socket.options.port, LAN_PORT)
  assert.deepEqual(socket.memberships, [{ group: LAN_MULTICAST_ADDRESS, address: '192.168.1.10' }])
  assert.equal(service.status().listening, true)

  socket.emit('message', Buffer.from('[MOTD]Alex world[/MOTD][AD]25565[/AD]'), {
    address: '192.168.1.42',
  })
  assert.equal(service.status().worlds.length, 1)
  assert.equal(service.status().worlds[0].sourceAddress, '192.168.1.42')
  assert.equal(snapshots.at(-1).worlds[0].motd, 'Alex world')

  assert.equal(service.start(), true)
  assert.equal(snapshots.length > 1, true)

  service.stop()
  assert.equal(socket.closed, true)
  assert.equal(service.status().listening, false)
  assert.equal(service.status().worlds.length, 1)
  service.stop()
})

test('a bind failure is reported without throwing', () => {
  class FailingSocket extends EventEmitter {
    bind() {
      throw Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' })
    }

    close() {
      this.closed = true
    }
  }

  const service = new LanDiscoveryService({
    createSocket: () => new FailingSocket(),
    networkInterfaces: () => ({}),
  })
  assert.equal(service.start(), false)
  assert.equal(service.status().listening, false)
  assert.match(service.status().error, /4445 is already in use/i)
})
