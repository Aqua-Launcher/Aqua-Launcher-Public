import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { normalizeServerAddress } from './servers.js'

export const DISCORD_IPC_PIPES = 10
export const DISCORD_RETRY_BASE_MS = 1_000
export const DISCORD_RETRY_MAX_MS = 60_000
export const DISCORD_CONNECT_TIMEOUT_MS = 5_000
export const DISCORD_TEXT_LIMIT = 128
export const DISCORD_JOIN_SECRET_LIMIT = 128

/**
 * Register an application at https://discord.com/developers/applications and
 * provide its id through AQUA_DISCORD_CLIENT_ID (or replace this fallback) for
 * a build that should show presence. Without an id the feature stays inert.
 */
export const DISCORD_APPLICATION_ID = (process.env.AQUA_DISCORD_CLIENT_ID || '').trim()

const LOADER_LABELS = new Map([
  ['vanilla', 'Vanilla'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
])

/** Every local socket Discord may listen on, in the order the client tries them. */
export function discordIpcCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    return Array.from({ length: DISCORD_IPC_PIPES }, (_value, index) => `\\\\?\\pipe\\discord-ipc-${index}`)
  }

  const directories = []
  if (platform === 'darwin') {
    if (env.TMPDIR) directories.push(env.TMPDIR)
  } else {
    if (env.XDG_RUNTIME_DIR) {
      directories.push(
        env.XDG_RUNTIME_DIR,
        path.posix.join(env.XDG_RUNTIME_DIR, 'app/com.discordapp.Discord'),
        path.posix.join(env.XDG_RUNTIME_DIR, 'app/com.discordapp.DiscordCanary'),
        path.posix.join(env.XDG_RUNTIME_DIR, 'snap.discord'),
      )
    }
    if (env.TMPDIR) directories.push(env.TMPDIR)
    directories.push('/tmp')
  }

  const candidates = []
  for (const directory of new Set(directories.filter(Boolean))) {
    for (let index = 0; index < DISCORD_IPC_PIPES; index += 1) {
      // The host may be Windows even when this list is built for another
      // platform (tests, packaging checks); Discord always wants POSIX here.
      candidates.push(path.posix.join(directory, `discord-ipc-${index}`))
    }
  }
  return candidates
}

/** Discord IPC frames are a little-endian opcode and length followed by JSON. */
export function encodeFrame(op, payload = {}) {
  const body = Buffer.from(JSON.stringify(payload ?? {}), 'utf8')
  const frame = Buffer.allocUnsafe(8 + body.length)
  frame.writeInt32LE(op, 0)
  frame.writeInt32LE(body.length, 4)
  body.copy(frame, 8)
  return frame
}

/** Reassembles frames from arbitrarily split or coalesced socket chunks. */
export class DiscordFrameReader {
  constructor({ maxBytes = 1 << 20 } = {}) {
    this.maxBytes = maxBytes
    this.buffer = Buffer.alloc(0)
  }

  push(chunk) {
    if (!chunk?.length) return []
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > this.maxBytes) {
      this.buffer = Buffer.alloc(0)
      return []
    }

    const frames = []
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const length = this.buffer.readInt32LE(4)
      if (length < 0 || length > this.maxBytes) {
        this.buffer = Buffer.alloc(0)
        return frames
      }
      if (this.buffer.length < 8 + length) break
      const body = this.buffer.subarray(8, 8 + length)
      this.buffer = this.buffer.subarray(8 + length)
      let data = {}
      try {
        data = body.length ? JSON.parse(body.toString('utf8')) : {}
      } catch {
        data = {}
      }
      frames.push({ op, data })
    }
    return frames
  }
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

export function truncateDiscordText(value, limit = DISCORD_TEXT_LIMIT) {
  const text = cleanText(value)
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

export function describeLoader(loader) {
  const type = typeof loader === 'string' ? loader : loader?.type
  if (!type) return null
  const label = LOADER_LABELS.get(String(type).toLowerCase()) || cleanText(type)
  const version = typeof loader === 'object' && loader?.version ? cleanText(loader.version) : ''
  return version ? `${label} ${version}` : label
}

/**
 * The join secret is opaque to Discord, so it carries the normalized server
 * address for the same application on the friend's machine. Anything longer
 * than Discord accepts is dropped rather than truncated into a bad address.
 */
export function encodeJoinSecret(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let address
  try {
    address = normalizeServerAddress(value, { edition: 'java' }).connectAddress
  } catch {
    return null
  }
  const secret = Buffer.from(address, 'utf8').toString('base64url')
  return secret.length <= DISCORD_JOIN_SECRET_LIMIT ? secret : null
}

export function decodeJoinSecret(secret) {
  if (typeof secret !== 'string' || !secret || secret.length > 512) return null
  let value
  try {
    value = Buffer.from(secret, 'base64url').toString('utf8')
  } catch {
    return null
  }
  try {
    return normalizeServerAddress(value, { edition: 'java' }).connectAddress
  } catch {
    return null
  }
}

/**
 * Only the instance name, version, loader and (when both switches allow it)
 * the server address leave the machine. Account names, UUIDs and paths never
 * enter this object.
 */
export function buildActivity(session, { showServer = false } = {}) {
  if (!session || !cleanText(session.installationName)) return null
  const activity = {
    details: truncateDiscordText(`Playing ${session.installationName}`),
    state: truncateDiscordText(
      [
        session.versionId ? `Minecraft ${session.versionId}` : null,
        describeLoader(session.loader),
      ]
        .filter(Boolean)
        .join(' · ') || 'Minecraft',
    ),
  }

  const started = Date.parse(session.startedAt || '')
  if (Number.isFinite(started)) activity.timestamps = { start: started }

  if (showServer && session.serverAddress) {
    const secret = encodeJoinSecret(session.serverAddress)
    if (secret) {
      activity.party = {
        id: crypto.createHash('sha1').update(secret).digest('hex').slice(0, 32),
        size: [1, 20],
      }
      activity.secrets = { join: secret }
    }
  }

  return activity
}

function defaultConnect(candidate, timeoutMs = DISCORD_CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(candidate)
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener('error', onError)
      if (error) {
        socket.destroy()
        reject(error)
      } else {
        resolve(socket)
      }
    }
    const onError = (error) => finish(error)
    const timer = setTimeout(() => finish(new Error('Discord IPC connection timed out.')), timeoutMs)
    socket.once('connect', () => finish(null))
    socket.once('error', onError)
  })
}

/**
 * Connects lazily to the local Discord client, never throws for a missing
 * client, and retries with exponential backoff while a game is running.
 */
export class DiscordPresence {
  constructor({
    logger = null,
    clientId = DISCORD_APPLICATION_ID,
    connect = defaultConnect,
    candidates = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onJoinRequest = null,
  } = {}) {
    this.logger = logger
    this.clientId = typeof clientId === 'string' ? clientId.trim() : ''
    this.connect = connect
    this.candidates = candidates
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.onJoinRequest = onJoinRequest

    this.enabled = false
    this.showServer = false
    this.disposed = false
    this.session = null
    this.socket = null
    this.reader = null
    this.state = 'disabled'
    this.attempt = 0
    this.retryTimer = null
    this.connectPromise = null
    this.loggedUnavailable = false
    this.loggedUnconfigured = false
  }

  applySettings(discord = {}) {
    if (this.disposed) return
    const enabled = discord?.enabled === true
    this.showServer = discord?.showServer === true

    if (!enabled) {
      this.enabled = false
      this.stopRetry()
      this.state = 'disabled'
      if (this.socket) {
        this.sendActivity(null)
        const socket = this.socket
        this.socket = null
        try {
          socket.end()
        } catch {
          // The client may already be gone.
        }
      }
      return
    }

    const wasEnabled = this.enabled
    this.enabled = true
    if (!this.clientId) {
      this.state = 'unconfigured'
      if (!this.loggedUnconfigured) {
        this.logger?.debug?.('Discord Rich Presence needs an application ID; presence stays disabled')
        this.loggedUnconfigured = true
      }
      return
    }
    if (!wasEnabled) {
      this.attempt = 0
      this.loggedUnavailable = false
      this.state = 'idle'
    }
    this.sync()
  }

  /** Game transitions are the only source of presence; idle states clear it. */
  updateFromGame(game, { loader = null } = {}) {
    if (this.disposed) return
    if (!game || game.status !== 'running' || !cleanText(game.installationName)) {
      const hadActivity = Boolean(this.session)
      this.session = null
      if (hadActivity && this.socket) this.sendActivity(null)
      return
    }

    this.session = {
      installationName: game.installationName,
      versionId: game.versionId || null,
      loader,
      startedAt: game.startedAt || null,
      serverAddress: game.serverAddress || null,
    }
    if (this.enabled) this.sync()
  }

  sync() {
    if (!this.enabled || this.disposed) return
    if (!this.clientId) {
      this.state = 'unconfigured'
      return
    }
    if (this.socket) {
      this.sendActivity(buildActivity(this.session, { showServer: this.showServer }))
      return
    }
    if (!this.session || this.connectPromise) return
    this.connectPromise = this.connectLoop().finally(() => {
      this.connectPromise = null
    })
  }

  async connectLoop() {
    this.stopRetry()
    this.state = 'connecting'
    const candidates = this.candidates || discordIpcCandidates()

    for (const candidate of candidates) {
      if (!this.enabled || this.disposed) return
      let socket
      try {
        socket = await this.connect(candidate, DISCORD_CONNECT_TIMEOUT_MS)
      } catch {
        continue
      }
      if (!this.enabled || this.disposed) {
        try {
          socket.destroy?.()
        } catch {
          // Ignore a socket that closed while the setting changed.
        }
        return
      }
      this.attach(socket)
      this.state = 'connected'
      this.attempt = 0
      this.loggedUnavailable = false
      this.writeFrame(0, { v: 1, client_id: this.clientId })
      this.sendActivity(buildActivity(this.session, { showServer: this.showServer }))
      return
    }

    if (!this.enabled || this.disposed) return
    this.state = 'backoff'
    if (!this.loggedUnavailable) {
      // Missing Discord is normal. One debug line avoids retry-log spam.
      this.logger?.debug?.('Discord is not running; Rich Presence will retry while a game is active')
      this.loggedUnavailable = true
    }
    this.scheduleRetry()
  }

  scheduleRetry() {
    if (this.retryTimer || !this.enabled || this.disposed || !this.session) return
    const delay = Math.min(DISCORD_RETRY_BASE_MS * 2 ** this.attempt, DISCORD_RETRY_MAX_MS)
    this.attempt += 1
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null
      this.sync()
    }, delay)
  }

  stopRetry() {
    if (!this.retryTimer) return
    this.clearTimeoutFn(this.retryTimer)
    this.retryTimer = null
  }

  attach(socket) {
    this.socket = socket
    this.reader = new DiscordFrameReader()
    socket.on('data', (chunk) => this.handleData(chunk))
    // A broken pipe must never become an unhandled error or a toast.
    socket.on('error', () => {})
    socket.on('close', () => this.handleClose(socket))
  }

  handleData(chunk) {
    if (!this.reader) return
    for (const frame of this.reader.push(chunk)) {
      if (frame.op === 3) {
        this.writeFrame(4, frame.data)
        continue
      }
      if (frame.op === 2) {
        try {
          this.socket?.end()
        } catch {
          // Ignore a close frame on an already-closed socket.
        }
        continue
      }
      if (frame.op !== 1 || frame.data?.evt !== 'ACTIVITY_JOIN') continue
      const address = decodeJoinSecret(frame.data?.data?.secret)
      if (!address || typeof this.onJoinRequest !== 'function') continue
      try {
        this.onJoinRequest(address)
      } catch (error) {
        this.logger?.debug?.('Could not route a Discord join request', { message: error.message })
      }
    }
  }

  handleClose(socket) {
    if (this.socket !== socket) return
    this.socket = null
    this.reader = null
    if (this.enabled && this.session && !this.disposed) {
      this.state = 'backoff'
      this.scheduleRetry()
    } else {
      this.state = this.enabled ? 'idle' : 'disabled'
    }
  }

  writeFrame(op, payload) {
    if (!this.socket) return
    try {
      this.socket.write(encodeFrame(op, payload))
    } catch {
      // The next close event schedules the retry.
    }
  }

  sendActivity(activity) {
    const args = { pid: process.pid }
    // Discord clears presence when the activity field is absent. Some clients
    // reject an explicit null, so never send one.
    if (activity) args.activity = activity
    this.writeFrame(1, {
      cmd: 'SET_ACTIVITY',
      args,
      nonce: crypto.randomUUID(),
    })
  }

  dispose() {
    if (this.disposed) return
    this.enabled = false
    this.disposed = true
    this.stopRetry()
    this.state = 'disposed'
    if (this.socket) {
      this.sendActivity(null)
      const socket = this.socket
      this.socket = null
      try {
        socket.end()
      } catch {
        // Shutting down anyway.
      }
    }
  }
}
