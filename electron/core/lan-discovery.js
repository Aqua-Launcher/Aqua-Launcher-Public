import dgram from 'node:dgram'
import os from 'node:os'

export const LAN_PORT = 4445
export const LAN_MULTICAST_ADDRESS = '224.0.2.60'
const MAX_PACKET_BYTES = 4096
const MAX_ENTRIES = 64
const DEFAULT_TTL_MS = 10_000
const PRUNE_INTERVAL_MS = 2_000

function stripFormatting(value) {
  return String(value)
    .replace(/\u00a7[0-9a-fk-orx]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Minecraft's LAN broadcast is a single UDP datagram:
 * `[MOTD]A world[/MOTD][AD]54321[/AD]`.
 */
export function parseLanBroadcast(input) {
  if (Buffer.isBuffer(input)) {
    if (input.length > MAX_PACKET_BYTES) return null
  } else if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_PACKET_BYTES) return null
  } else {
    return null
  }

  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input
  const motdMatch = /\[MOTD\]([\s\S]*?)\[\/MOTD\]/i.exec(text)
  const portMatch = /\[AD\](\d{1,5})\[\/AD\]/i.exec(text)
  if (!motdMatch || !portMatch) return null

  const port = Number(portMatch[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null

  const motd = stripFormatting(motdMatch[1]).slice(0, 120) || 'Minecraft LAN world'
  return { motd, port }
}

function friendlyLanError(error) {
  switch (error?.code) {
    case 'EADDRINUSE':
      return 'UDP 4445 is already in use. Close the other launcher and restart Aqua.'
    case 'EACCES':
    case 'EPERM':
      return 'Windows blocked LAN discovery. Allow Aqua through Windows Firewall.'
    case 'EADDRNOTAVAIL':
      return 'No usable network adapter was found for LAN discovery.'
    default:
      return 'LAN discovery is unavailable. Check your network adapter and firewall.'
  }
}

/** Keeps the last broadcast per source address and game port. */
export class LanRegistry {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES, now = Date.now } = {}) {
    this.ttlMs = Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS)
    this.maxEntries = Math.max(1, Number(maxEntries) || MAX_ENTRIES)
    this.now = typeof now === 'function' ? now : Date.now
    this.entries = new Map()
  }

  ingest(packet, sourceAddress, at = this.now()) {
    const parsed = parseLanBroadcast(packet)
    if (!parsed || typeof sourceAddress !== 'string' || !sourceAddress.trim()) return false
    const source = sourceAddress.trim().slice(0, 80)
    const id = `${source}:${parsed.port}`
    this.entries.set(id, {
      id,
      motd: parsed.motd,
      port: parsed.port,
      sourceAddress: source,
      seenAt: Number.isFinite(Number(at)) ? Number(at) : this.now(),
    })

    while (this.entries.size > this.maxEntries) {
      let oldestKey = null
      let oldestAt = Infinity
      for (const [key, entry] of this.entries) {
        if (entry.seenAt < oldestAt) {
          oldestAt = entry.seenAt
          oldestKey = key
        }
      }
      if (!oldestKey) break
      this.entries.delete(oldestKey)
    }
    return true
  }

  prune(at = this.now()) {
    const now = Number.isFinite(Number(at)) ? Number(at) : this.now()
    let changed = false
    for (const [key, entry] of this.entries) {
      if (now - entry.seenAt > this.ttlMs) {
        this.entries.delete(key)
        changed = true
      }
    }
    return changed
  }

  list(at = this.now()) {
    this.prune(at)
    return [...this.entries.values()]
      .sort((left, right) => right.seenAt - left.seenAt || left.id.localeCompare(right.id))
      .map((entry) => ({
        id: entry.id,
        motd: entry.motd,
        port: entry.port,
        sourceAddress: entry.sourceAddress,
        address: `localhost:${entry.port}`,
        lastSeenAt: new Date(entry.seenAt).toISOString(),
      }))
  }
}

/**
 * Listens for the multicast packets the game sends when a world is opened to
 * LAN. A failure to bind is a normal state (firewall, another socket), not a
 * reason to take down the launcher.
 */
export class LanDiscoveryService {
  constructor({
    logger = null,
    registry = null,
    onChange = () => {},
    createSocket = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }),
    networkInterfaces = () => os.networkInterfaces(),
    port = LAN_PORT,
    group = LAN_MULTICAST_ADDRESS,
    pruneIntervalMs = PRUNE_INTERVAL_MS,
  } = {}) {
    this.logger = logger
    this.registry = registry || new LanRegistry()
    this.onChange = onChange
    this.createSocket = createSocket
    this.networkInterfaces = networkInterfaces
    this.port = port
    this.group = group
    this.pruneIntervalMs = Math.max(500, Number(pruneIntervalMs) || PRUNE_INTERVAL_MS)
    this.socket = null
    this.timer = null
    this.listening = false
    this.error = null
  }

  status() {
    return { worlds: this.registry.list(), listening: this.listening, error: this.error }
  }

  publish() {
    try {
      this.onChange(this.status())
    } catch (error) {
      this.logger?.warn('LAN discovery update could not be delivered', { message: error.message })
    }
  }

  fail(error) {
    this.listening = false
    this.error = friendlyLanError(error)
    this.logger?.warn('LAN discovery failed', {
      code: error?.code || null,
      message: error?.message || String(error),
    })
    this.publish()
  }

  joinInterfaces(socket) {
    const rows = this.networkInterfaces() || {}
    const addresses = []
    for (const group of Object.values(rows)) {
      if (!Array.isArray(group)) continue
      for (const row of group) {
        if (!row || row.internal) continue
        if (row.family !== 'IPv4' && row.family !== 4) continue
        if (typeof row.address === 'string' && row.address) addresses.push(row.address)
      }
    }

    // Join each physical adapter so a machine with Ethernet, Wi-Fi and a VPN
    // still sees the broadcast. Some adapters reject multicast membership; that
    // must not stop the others from working.
    for (const address of [...new Set(addresses)]) {
      try {
        socket.addMembership(this.group, address)
      } catch (error) {
        this.logger?.debug('Could not join LAN multicast on an adapter', {
          address,
          message: error.message,
        })
      }
    }
    if (!addresses.length) {
      try {
        socket.addMembership(this.group)
      } catch (error) {
        this.logger?.debug('Could not join the default LAN multicast interface', { message: error.message })
      }
    }
  }

  start() {
    if (this.socket) return true
    let socket
    try {
      socket = this.createSocket()
    } catch (error) {
      this.fail(error)
      return false
    }

    this.socket = socket
    this.listening = false
    this.error = null

    socket.on('message', (message, rinfo) => {
      if (this.registry.ingest(message, rinfo?.address)) this.publish()
    })
    socket.on('listening', () => {
      this.listening = true
      this.error = null
      this.joinInterfaces(socket)
      this.publish()
    })
    socket.on('error', (error) => {
      this.fail(error)
    })
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.listening = false
      }
    })

    try {
      socket.bind({ port: this.port, address: '0.0.0.0', exclusive: false })
    } catch (error) {
      this.fail(error)
      this.socket = null
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      return false
    }

    this.timer = setInterval(() => {
      if (this.registry.prune()) this.publish()
    }, this.pruneIntervalMs)
    this.timer.unref?.()
    return true
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const socket = this.socket
    this.socket = null
    this.listening = false
    this.error = null
    if (socket) {
      try {
        socket.close()
      } catch {
        // A failed bind or an earlier close already released it.
      }
    }
    this.publish()
  }
}
