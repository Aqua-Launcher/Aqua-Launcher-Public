import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  DISCORD_TEXT_LIMIT,
  DiscordFrameReader,
  DiscordPresence,
  buildActivity,
  decodeJoinSecret,
  describeLoader,
  discordIpcCandidates,
  encodeFrame,
  encodeJoinSecret,
} from '../electron/core/discord-presence.js'
import { createDefaultSettings, normalizeSettings } from '../electron/core/settings.js'

const RUNNING = {
  status: 'running',
  installationName: 'Survival',
  versionId: '1.21.4',
  startedAt: '2026-11-03T10:00:00.000Z',
  serverAddress: 'play.example.net',
}

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.written = []
    this.ended = false
  }

  write(frame) {
    this.written.push(Buffer.from(frame))
    return true
  }

  end() {
    if (this.ended) return
    this.ended = true
    this.emit('close')
  }

  destroy() {
    this.end()
  }
}

function framesFor(socket) {
  const reader = new DiscordFrameReader()
  return socket.written.flatMap((chunk) => reader.push(chunk))
}

function quietLogger() {
  const entries = { debug: [], warn: [], error: [] }
  return {
    entries,
    debug: (message) => entries.debug.push(message),
    warn: (message) => entries.warn.push(message),
    error: (message) => entries.error.push(message),
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('discord presence is off by default and normalization is strict', () => {
  const defaults = createDefaultSettings({ totalMemMb: 16_384, instancesRoot: 'C:\\Aqua\\instances' })
  assert.deepEqual(defaults.discord, { enabled: false, showServer: false })
  assert.deepEqual(normalizeSettings({}, defaults).discord, { enabled: false, showServer: false })
  assert.deepEqual(
    normalizeSettings({ discord: { enabled: true, showServer: true } }, defaults).discord,
    { enabled: true, showServer: true },
  )
  assert.deepEqual(
    normalizeSettings({ discord: { enabled: 'yes', showServer: 1 } }, defaults).discord,
    { enabled: false, showServer: false },
  )
})

test('activity carries the profile and hides the server unless opted in', () => {
  const activity = buildActivity(RUNNING, { showServer: false })
  assert.equal(activity.details, 'Playing Survival')
  assert.equal(activity.state, 'Minecraft 1.21.4')
  assert.equal(activity.timestamps.start, Date.parse(RUNNING.startedAt))
  assert.equal(activity.party, undefined)
  assert.equal(activity.secrets, undefined)
  assert.ok(!JSON.stringify(activity).includes('play.example.net'))

  const loaderActivity = buildActivity(
    { ...RUNNING, loader: { type: 'fabric', version: '0.16.9' } },
    { showServer: false },
  )
  assert.equal(loaderActivity.state, 'Minecraft 1.21.4 · Fabric 0.16.9')

  const withServer = buildActivity(RUNNING, { showServer: true })
  assert.ok(withServer.secrets.join)
  assert.equal(decodeJoinSecret(withServer.secrets.join), 'play.example.net')
  assert.match(withServer.party.id, /^[0-9a-f]{32}$/)

  assert.equal(buildActivity(null), null)
  assert.equal(buildActivity({ installationName: '   ' }), null)
})

test('activity text is cleaned and bounded without leaking paths or accounts', () => {
  const activity = buildActivity(
    {
      installationName: `A${'x'.repeat(400)}\nC:\\Users\\someone\\.minecraft`,
      versionId: '1.21.4',
      startedAt: 'not a date',
      loader: { type: 'neoforge' },
    },
    { showServer: true },
  )
  assert.ok(activity.details.length <= DISCORD_TEXT_LIMIT)
  assert.ok(!activity.details.includes('\n'))
  assert.equal(activity.state, 'Minecraft 1.21.4 · NeoForge')
  assert.equal(activity.timestamps, undefined)
  assert.equal(activity.secrets, undefined)
  assert.equal(describeLoader({ type: 'quilt', version: '1.0.1' }), 'Quilt 1.0.1')
})

test('join secrets round-trip a validated address and reject anything else', () => {
  const secret = encodeJoinSecret('play.example.net:25566')
  assert.equal(decodeJoinSecret(secret), 'play.example.net:25566')
  assert.equal(decodeJoinSecret('not-a-secret'), null)
  assert.equal(decodeJoinSecret(Buffer.from('../escape').toString('base64url')), null)
  assert.equal(encodeJoinSecret('https://example.com'), null)
  assert.equal(encodeJoinSecret(''), null)
})

test('frame reader reassembles split frames and reads coalesced frames', () => {
  const frame = encodeFrame(1, { cmd: 'SET_ACTIVITY', value: 42 })
  const reader = new DiscordFrameReader()
  assert.deepEqual(reader.push(frame.subarray(0, 5)), [])
  assert.deepEqual(reader.push(frame.subarray(5)), [{ op: 1, data: { cmd: 'SET_ACTIVITY', value: 42 } }])

  const coalesced = Buffer.concat([encodeFrame(0, { v: 1 }), encodeFrame(3, { ping: true })])
  assert.deepEqual(reader.push(coalesced), [
    { op: 0, data: { v: 1 } },
    { op: 3, data: { ping: true } },
  ])

  const oversized = Buffer.alloc(8)
  oversized.writeInt32LE(1, 0)
  oversized.writeInt32LE(2_000_000, 4)
  assert.deepEqual(reader.push(oversized), [])
})

test('the candidate list follows each platform and stays bounded to ten pipes', () => {
  const windows = discordIpcCandidates({ platform: 'win32', env: {} })
  assert.equal(windows.length, 10)
  assert.equal(windows[0], '\\\\?\\pipe\\discord-ipc-0')

  const linux = discordIpcCandidates({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/tmp/x' } })
  assert.ok(linux.includes('/run/user/1000/discord-ipc-0'))
  assert.ok(linux.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'))
  assert.ok(linux.length >= 30)
})

test('a running game connects lazily, handshakes and publishes presence', async () => {
  const socket = new FakeSocket()
  const logger = quietLogger()
  const presence = new DiscordPresence({
    logger,
    clientId: '1234567890',
    candidates: ['pipe-0'],
    connect: async () => socket,
  })

  // Disabled: nothing connects, even if a game starts.
  presence.updateFromGame(RUNNING)
  await flush()
  assert.equal(socket.written.length, 0)

  presence.applySettings({ enabled: true, showServer: false })
  await flush()
  await flush()

  const frames = framesFor(socket)
  assert.deepEqual(frames[0], { op: 0, data: { v: 1, client_id: '1234567890' } })
  const setActivity = frames.find((frame) => frame.data.cmd === 'SET_ACTIVITY')
  assert.equal(setActivity.data.args.activity.details, 'Playing Survival')
  assert.equal(presence.state, 'connected')
  assert.deepEqual(logger.entries.warn, [])
})

test('disabling clears activity and closes the pipe; exit also clears it', async () => {
  const socket = new FakeSocket()
  const presence = new DiscordPresence({
    clientId: '1234567890',
    candidates: ['pipe-0'],
    connect: async () => socket,
  })
  presence.applySettings({ enabled: true })
  presence.updateFromGame(RUNNING)
  await flush()
  await flush()

  presence.updateFromGame({ status: 'exited' })
  let frames = framesFor(socket)
  assert.equal('activity' in frames.at(-1).data.args, false)

  presence.updateFromGame(RUNNING)
  await flush()
  presence.applySettings({ enabled: false })
  frames = framesFor(socket)
  assert.equal('activity' in frames.at(-1).data.args, false)
  assert.equal(socket.ended, true)
  assert.equal(presence.state, 'disabled')
})

test('a missing Discord instance backs off quietly and retries later', async () => {
  const timers = []
  let attempts = 0
  const logger = quietLogger()
  const presence = new DiscordPresence({
    logger,
    clientId: '1234567890',
    candidates: ['pipe-a', 'pipe-b'],
    connect: async () => {
      attempts += 1
      throw new Error('ENOENT')
    },
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay })
      return timers.length
    },
    clearTimeoutFn: () => {},
  })

  presence.applySettings({ enabled: true })
  presence.updateFromGame(RUNNING)
  await flush()
  await flush()

  assert.equal(attempts, 2)
  assert.equal(presence.state, 'backoff')
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 1_000)
  assert.equal(logger.entries.warn.length, 0)
  assert.equal(logger.entries.error.length, 0)
  assert.equal(logger.entries.debug.length, 1)

  timers[0].callback()
  await flush()
  await flush()
  assert.equal(attempts, 4)
  assert.equal(timers.at(-1).delay, 2_000)
  assert.equal(logger.entries.debug.length, 1)
})

test('an opted-in server can send a Discord join request back to the launcher', async () => {
  const socket = new FakeSocket()
  const joins = []
  const presence = new DiscordPresence({
    clientId: '1234567890',
    candidates: ['pipe-0'],
    connect: async () => socket,
    onJoinRequest: (address) => joins.push(address),
  })
  presence.applySettings({ enabled: true, showServer: true })
  presence.updateFromGame(RUNNING)
  await flush()
  await flush()

  const activity = framesFor(socket).find((frame) => frame.data.cmd === 'SET_ACTIVITY').data.args.activity
  socket.emit('data', encodeFrame(1, { cmd: 'DISPATCH', evt: 'ACTIVITY_JOIN', data: { secret: activity.secrets.join } }))
  assert.deepEqual(joins, ['play.example.net'])

  socket.emit('data', encodeFrame(1, { cmd: 'DISPATCH', evt: 'ACTIVITY_JOIN', data: { secret: 'junk' } }))
  assert.deepEqual(joins, ['play.example.net'])
})

test('an unconfigured build never attempts a connection', async () => {
  let attempts = 0
  const logger = quietLogger()
  const presence = new DiscordPresence({
    logger,
    clientId: '',
    connect: async () => {
      attempts += 1
      throw new Error('should not connect')
    },
  })
  presence.applySettings({ enabled: true })
  presence.updateFromGame(RUNNING)
  await flush()

  assert.equal(attempts, 0)
  assert.equal(presence.state, 'unconfigured')
  assert.equal(logger.entries.debug.length, 1)
  assert.deepEqual(logger.entries.warn, [])
})
