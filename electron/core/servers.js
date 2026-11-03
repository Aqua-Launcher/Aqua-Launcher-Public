import { promises as dns } from 'node:dns'
import dgram from 'node:dgram'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { cleanDisplayName, randomId } from './util.js'

const DEFAULT_PORT = 25565
const DEFAULT_BEDROCK_PORT = 19132
const MAX_ADDRESS_LENGTH = 300
const STATUS_PROTOCOL = 769
const MAX_RESPONSE_BYTES = 1024 * 1024
const SERVER_EDITIONS = ['java', 'bedrock']

/** RakNet's Unconnected Ping and Pong, the query Bedrock servers answer. */
const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex')
const RAKNET_PING = 0x01
const RAKNET_PONG = 0x1c
const RAKNET_PING_BYTES = 33
const RAKNET_PONG_HEADER_BYTES = 35

function clampTimeout(timeoutMs, fallback = 5000) {
  return Math.max(1000, Math.min(Number(timeoutMs) || fallback, 15000))
}

function encodeVarInt(value) {
  let remaining = Number(value) >>> 0
  const bytes = []
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return Buffer.from(bytes)
}

function decodeVarInt(buffer, offset = 0) {
  let value = 0
  let shift = 0
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= buffer.length) return null
    const byte = buffer[offset + index]
    value |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) return { value: value >>> 0, size: index + 1 }
    shift += 7
  }
  throw new Error('The server sent an invalid response.')
}

function encodeString(value) {
  const bytes = Buffer.from(String(value), 'utf8')
  return Buffer.concat([encodeVarInt(bytes.length), bytes])
}

function packet(packetId, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([encodeVarInt(packetId), payload])
  return Buffer.concat([encodeVarInt(body.length), body])
}

function stripFormatting(value) {
  return String(value)
    .replace(/\u00a7[0-9a-fk-orx]/gi, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function collectMotdText(description) {
  if (description == null) return ''
  if (typeof description === 'string') return description
  if (Array.isArray(description)) return description.map((part) => collectMotdText(part)).join('')
  if (typeof description !== 'object') return ''
  const text = typeof description.text === 'string' ? description.text : ''
  const translate = typeof description.translate === 'string' ? description.translate : ''
  const withParts = Array.isArray(description.with)
    ? description.with.map((part) => collectMotdText(part)).join('')
    : ''
  const extra = Array.isArray(description.extra) ? description.extra.map((part) => collectMotdText(part)).join('') : ''
  return `${text}${text ? '' : translate}${withParts}${extra}`
}

/** Players see a chat component, but the server list only needs its plain text. */
export function motdToText(description) {
  return stripFormatting(collectMotdText(description))
}

/**
 * Accepts the forms people paste into Minecraft: host, host:port, and the
 * bracketed IPv6 form, with an optional minecraft:// prefix.
 */
export function normalizeServerAddress(value, { edition = 'java' } = {}) {
  if (!SERVER_EDITIONS.includes(edition)) throw new Error('That server edition is not supported.')
  const bedrock = edition === 'bedrock'
  if (typeof value !== 'string') throw new Error('Enter a server address.')
  let input = value.trim()
  if (!input) throw new Error('Enter a server address.')
  if (input.length > MAX_ADDRESS_LENGTH) throw new Error('That server address is too long.')
  if (/^minecraft:\/\//i.test(input)) input = input.slice('minecraft://'.length).replace(/\/+$/, '')
  if (!input) throw new Error('Enter a server address.')
  if (/[\s/\\?#]/.test(input)) throw new Error('Server addresses cannot contain spaces or URLs.')
  if (input.includes('@')) throw new Error('Enter a host name, not an email address.')

  let host = ''
  let portText = null
  const ipv6 = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(input)
  if (ipv6) {
    host = ipv6[1]
    portText = ipv6[2] ?? null
  } else {
    const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(input)
    if (!match) throw new Error('Use a host name such as play.example.com or an IP address.')
    host = match[1]
    portText = match[2] ?? null
  }

  host = host.trim().toLowerCase().replace(/\.$/, '')
  if (!host) throw new Error('Enter a server address.')
  if (host.length > 253) throw new Error('That server address is too long.')
  const isIpv6 = net.isIP(host) === 6
  if (!isIpv6 && !/^[a-z0-9._-]+$/i.test(host)) {
    throw new Error('That server address contains invalid characters.')
  }
  const explicitPort = portText != null
  const port = explicitPort ? Number(portText) : bedrock ? DEFAULT_BEDROCK_PORT : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The server port must be between 1 and 65535.')

  const displayHost = isIpv6 ? `[${host}]` : host
  return {
    edition,
    host,
    port,
    explicitPort,
    address: `${displayHost}:${port}`,
    // Quick join keeps an omitted port omitted so Minecraft can follow SRV records.
    // Bedrock has no SRV lookup, so it always gets an explicit port.
    connectAddress: bedrock || explicitPort ? `${displayHost}:${port}` : displayHost,
  }
}

/** Resolve _minecraft._tcp SRV records for addresses entered without a port. */
async function resolveMinecraftTarget(target) {
  if (target.explicitPort || net.isIP(target.host)) return { host: target.host, port: target.port }
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${target.host}`)
    const candidates = records
      .filter((record) => record && typeof record.name === 'string' && record.name.trim() && record.port > 0)
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight)
    if (candidates.length) {
      return { host: candidates[0].name.replace(/\.$/, ''), port: candidates[0].port }
    }
  } catch {
    // No SRV record (or DNS refused the query): fall back to the plain host.
  }
  return { host: target.host, port: target.port }
}

function friendlyNetworkError(error) {
  switch (error?.code) {
    case 'ECONNREFUSED':
      return 'Connection refused — the server may be offline.'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'That server address could not be found.'
    case 'ETIMEDOUT':
      return 'The server did not respond in time.'
    case 'ECONNRESET':
      return 'The server closed the connection.'
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'That server cannot be reached from this network.'
    default:
      return error?.message || 'Could not reach the server.'
  }
}

/** RakNet Unconnected Ping: id, time, magic, client GUID. */
export function encodeUnconnectedPing(guid = randomBytes(8), time = Date.now()) {
  const buffer = Buffer.alloc(RAKNET_PING_BYTES)
  buffer.writeUInt8(RAKNET_PING, 0)
  buffer.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(Number(time) || 0))), 1)
  RAKNET_MAGIC.copy(buffer, 9)
  const clientGuid = Buffer.isBuffer(guid) && guid.length === 8 ? guid : randomBytes(8)
  clientGuid.copy(buffer, 25)
  return buffer
}

function statusNumber(value, fallback = 0) {
  const numeric = Number(String(value ?? '').trim())
  return Number.isFinite(numeric) ? numeric : fallback
}

/**
 * RakNet Unconnected Pong, whose payload is a semicolon-delimited status line:
 * `MCPE;MOTD;protocol;version;players;max;serverId;levelName;gameMode;modeId;port;port;`
 */
export function parseUnconnectedPong(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < RAKNET_PONG_HEADER_BYTES) return null
  if (buffer.readUInt8(0) !== RAKNET_PONG) return null
  // Pong layout: id, echoed time, server GUID, magic, then the status string.
  if (!buffer.subarray(17, 33).equals(RAKNET_MAGIC)) return null
  const length = buffer.readUInt16BE(33)
  const start = RAKNET_PONG_HEADER_BYTES
  if (length <= 0 || buffer.length < start + length) return null
  const parts = buffer.toString('utf8', start, start + length).split(';')
  if (parts.length < 6 || !/^MCPE|^MCEE/i.test(parts[0].trim())) return null

  const motd = stripFormatting(parts[1] ?? '')
  // The in-game second MOTD line is the level name.
  const levelName = stripFormatting(parts[7] ?? '')
  return {
    edition: parts[0].trim(),
    motd: levelName && levelName !== motd ? `${motd}\n${levelName}`.trim() : motd,
    levelName,
    protocol: statusNumber(parts[2], null),
    version: parts[3]?.trim() || null,
    players: {
      online: Math.max(0, Math.round(statusNumber(parts[4], 0))),
      max: Math.max(0, Math.round(statusNumber(parts[5], 0))),
    },
    gameMode: parts[8]?.trim() || null,
    ports: { ipv4: statusNumber(parts[10], null), ipv6: statusNumber(parts[11], null) },
  }
}

function queryBedrockStatus(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIP(target.host) === 6 ? 'udp6' : 'udp4')
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      if (error) reject(error)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      finish(Object.assign(new Error('The server did not respond in time.'), { code: 'ETIMEDOUT' }))
    }, clampTimeout(timeoutMs))

    socket.on('message', (message) => {
      let status = null
      try {
        status = parseUnconnectedPong(message)
      } catch (error) {
        finish(error)
        return
      }
      if (status) finish(null, status)
    })
    socket.once('error', (error) => finish(error))
    socket.send(encodeUnconnectedPing(), target.port, target.host, (error) => {
      if (error) finish(error)
    })
  })
}

function parseStatusPacket(buffer) {
  const length = decodeVarInt(buffer, 0)
  if (!length) return null
  if (length.value > MAX_RESPONSE_BYTES) throw new Error('The server response was too large.')
  const frameEnd = length.size + length.value
  if (buffer.length < frameEnd) return null
  const frame = buffer.subarray(length.size, frameEnd)
  const packetId = decodeVarInt(frame, 0)
  if (!packetId) return null
  if (packetId.value !== 0) throw new Error('The server sent an unexpected response.')
  const stringLength = decodeVarInt(frame, packetId.size)
  if (!stringLength) return null
  const start = packetId.size + stringLength.size
  const end = start + stringLength.value
  if (frame.length < end) return null
  const json = frame.toString('utf8', start, end)
  try {
    return JSON.parse(json)
  } catch {
    throw new Error('The server sent an unreadable status response.')
  }
}

/**
 * Server List Ping (the same handshake the game's multiplayer screen uses) for
 * Java worlds, and RakNet's Unconnected Ping for Bedrock. Network failures
 * resolve as offline statuses so the UI can still show them.
 */
export async function pingServer(address, { timeoutMs = 5000, edition = 'java' } = {}) {
  const target = normalizeServerAddress(address, { edition })
  const startedAt = Date.now()
  try {
    if (target.edition === 'bedrock') {
      const status = await queryBedrockStatus({ host: target.host, port: target.port }, timeoutMs)
      return {
        edition: target.edition,
        address: target.connectAddress,
        online: true,
        latencyMs: Date.now() - startedAt,
        motd: status.motd || 'A Minecraft server',
        version: status.version,
        protocol: status.protocol,
        modded: false,
        players: { online: status.players.online, max: status.players.max, sample: [] },
        favicon: null,
        error: null,
      }
    }
    const resolved = await resolveMinecraftTarget(target)
    const status = await queryStatus(target, resolved, timeoutMs)
    const players = status?.players && typeof status.players === 'object' ? status.players : {}
    const version = status?.version && typeof status.version === 'object' ? status.version : {}
    const favicon = typeof status.favicon === 'string' && status.favicon.startsWith('data:image/png;base64,')
      ? status.favicon
      : null
    return {
      edition: target.edition,
      address: target.connectAddress,
      online: true,
      latencyMs: Date.now() - startedAt,
      motd: motdToText(status.description) || 'A Minecraft server',
      version: typeof version.name === 'string' ? version.name : null,
      protocol: Number.isFinite(Number(version.protocol)) ? Number(version.protocol) : null,
      // Forge and NeoForge add their own status payload; a vanilla-compatible
      // server does not, even when it is running plugins.
      modded: Boolean(
        status?.forgeData ||
          status?.modinfo ||
          status?.neoforgeData ||
          Number(status?.fmlNetworkVersion) > 0,
      ),
      players: {
        online: Math.max(0, Number(players.online) || 0),
        max: Math.max(0, Number(players.max) || 0),
        sample: Array.isArray(players.sample)
          ? players.sample
              .slice(0, 12)
              .filter((player) => player && typeof player.name === 'string')
              .map((player) => ({
                name: stripFormatting(player.name).slice(0, 64),
                id: typeof player.id === 'string' ? player.id : null,
              }))
          : [],
      },
      favicon,
      error: null,
    }
  } catch (error) {
    return {
      edition: target.edition,
      address: target.connectAddress,
      online: false,
      latencyMs: Date.now() - startedAt,
      motd: null,
      version: null,
      protocol: null,
      modded: false,
      players: { online: 0, max: 0, sample: [] },
      favicon: null,
      error: friendlyNetworkError(error),
    }
  }
}

export class ServerService {
  constructor({ store, logger }) {
    this.store = store
    this.logger = logger
  }

  list() {
    return this.store.servers.map((server) => this.store.publicServer(server))
  }

  findDuplicate(address, exceptId = null, edition = 'java') {
    const normalized = normalizeServerAddress(address, { edition }).address.toLowerCase()
    return this.store.servers.some((server) => {
      if (server.id === exceptId) return false
      if ((server.edition || 'java') !== edition) return false
      try {
        return normalizeServerAddress(server.address, { edition }).address.toLowerCase() === normalized
      } catch {
        return false
      }
    })
  }

  bindingFor(installationId, edition) {
    if (edition === 'bedrock' || installationId == null || installationId === '') return null
    if (typeof installationId !== 'string' || !installationId.trim()) {
      throw new Error('That installation is invalid.')
    }
    const installation = this.store.getInstallation(installationId.trim())
    if (!installation) throw new Error('That installation no longer exists.')
    return installation.id
  }

  async add({ name, address, edition = 'java', installationId = null } = {}) {
    const target = normalizeServerAddress(address, { edition })
    if (this.findDuplicate(target.address, null, target.edition)) throw new Error('That server is already in your list.')
    const displayName = name == null || !String(name).trim() ? target.address : cleanDisplayName(name, 60)
    const boundInstallationId = this.bindingFor(installationId, target.edition)
    const server = {
      id: randomId(),
      name: displayName,
      address: target.address,
      connectAddress: target.connectAddress,
      edition: target.edition,
      installationId: boundInstallationId,
      addedAt: new Date().toISOString(),
      lastJoinedAt: null,
    }
    await this.store.addServer(server)
    this.logger?.info('Added Minecraft server', {
      name: displayName,
      address: target.address,
      edition: target.edition,
      installationId: boundInstallationId,
    })
    return this.store.publicServer(server)
  }

  async update(id, patch = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Server ID is required.')
    const existing = this.store.getServer(id)
    if (!existing) throw new Error('Server not found.')
    const edition = existing.edition === 'bedrock' ? 'bedrock' : 'java'
    const updates = {}
    if (patch.name !== undefined) updates.name = cleanDisplayName(patch.name, 60)
    if (patch.address !== undefined) {
      const target = normalizeServerAddress(patch.address, { edition })
      if (this.findDuplicate(target.address, id, edition)) throw new Error('That server is already in your list.')
      updates.address = target.address
      updates.connectAddress = target.connectAddress
    }
    if (patch.installationId !== undefined) {
      updates.installationId = this.bindingFor(patch.installationId, edition)
    }
    await this.store.updateServer(id, updates)
    return this.store.publicServer(this.store.getServer(id))
  }

  async remove(id) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Server ID is required.')
    const removed = await this.store.removeServer(id)
    return { id: removed.id, name: removed.name }
  }

  ping(address, edition = 'java', timeoutMs = undefined) {
    return pingServer(address, { edition, timeoutMs })
  }

  async markJoined(id) {
    const server = await this.store.markServerJoined(id)
    return this.store.publicServer(server)
  }
}

function queryStatus(target, resolved, timeoutMs) {
  return new Promise((resolve, reject) => {
    const handshake = packet(
      0,
      Buffer.concat([
        encodeVarInt(STATUS_PROTOCOL),
        encodeString(target.host),
        Buffer.from([(target.port >> 8) & 0xff, target.port & 0xff]),
        encodeVarInt(1),
      ]),
    )
    const request = packet(0)
    // Connect to the SRV target, but keep the original hostname in the handshake
    // so shared proxies can route the virtual host correctly.
    const socket = net.createConnection({ host: resolved.host, port: resolved.port })
    const chunks = []
    let total = 0
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      finish(Object.assign(new Error('The server did not respond in time.'), { code: 'ETIMEDOUT' }))
    }, Math.max(1000, Math.min(Number(timeoutMs) || 5000, 15000)))

    socket.once('connect', () => {
      socket.write(Buffer.concat([handshake, request]))
    })
    socket.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_RESPONSE_BYTES) {
        finish(new Error('The server response was too large.'))
        return
      }
      chunks.push(chunk)
      try {
        const status = parseStatusPacket(Buffer.concat(chunks))
        if (status) finish(null, status)
      } catch (error) {
        finish(error)
      }
    })
    socket.once('error', (error) => finish(error))
    socket.once('close', () => {
      // Some proxies close right after the response; give the parser one last look.
      try {
        const status = parseStatusPacket(Buffer.concat(chunks))
        if (status) finish(null, status)
        else finish(new Error('The server closed the connection without a status response.'))
      } catch (error) {
        finish(error)
      }
    })
  })
}
