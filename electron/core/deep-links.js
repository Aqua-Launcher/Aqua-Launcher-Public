import { normalizeServerAddress } from './servers.js'

export const LINK_SCHEME = 'aqua'
export const LINK_PAGES = [
  'home',
  'installations',
  'tasks',
  'worlds',
  'screenshots',
  'servers',
  'stats',
  'mods',
  'account',
  'logs',
  'docs',
  'settings',
]
const CONTENT_TYPES = ['mod', 'resourcepack', 'shader', 'datapack']
const MAX_LINK_LENGTH = 2048
const MAX_INSTANCE_LENGTH = 128
const PROJECT_PATTERN = /^[A-Za-z0-9!@$()_.~'-]{1,64}$/
const COMMANDS = ['launch', 'join', 'install', 'status']

export const LINK_EXAMPLES = [
  {
    label: 'Join a server',
    description: 'Opens Quick Join in the launcher. The profile binding for this address is used when one exists.',
    value: 'aqua://join?server=play.example.net',
  },
  {
    label: 'Launch a profile',
    description: 'Starts an installation by name or id after you confirm.',
    value: 'aqua://launch?instance=Survival',
  },
  {
    label: 'Install a modpack',
    description: 'Opens the modpack install flow for a Modrinth project or slug.',
    value: 'aqua://install?pack=fabulously-optimized',
  },
  {
    label: 'Open a page',
    description: 'Jumps straight to a launcher page without running anything.',
    value: 'aqua://open?page=stats',
  },
  {
    label: 'CLI status',
    description: 'Prints local profiles as JSON. No tokens or account secrets are included.',
    value: 'aqua status --json',
  },
  {
    label: 'CLI launch',
    description: '--yes skips the in-app confirmation. Without it, Aqua asks first.',
    value: 'aqua launch "Survival" --yes',
  },
]

function linkText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`)
  return trimmed
}

function optionalLinkText(value, label, maxLength) {
  if (value == null || value === '') return null
  return linkText(value, label, maxLength)
}

function normalizeEdition(value) {
  if (value == null || value === '') return 'java'
  if (value === 'java' || value === 'bedrock') return value
  throw new Error('The server edition must be java or bedrock.')
}

function normalizeProject(value) {
  const project = linkText(value, 'Modrinth project', 64)
  if (!PROJECT_PATTERN.test(project)) {
    throw new Error('The Modrinth project must be an id or slug, not a path or URL.')
  }
  return project
}

/** Parses one untrusted `aqua://` URL into an intent, rejecting everything else. */
export function parseAquaLink(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('That Aqua link is empty.')
  const raw = value.trim()
  if (raw.length > MAX_LINK_LENGTH) throw new Error('That Aqua link is too long.')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('That Aqua link is not a valid URL.')
  }
  if (url.protocol !== `${LINK_SCHEME}:`) throw new Error('Aqua links must start with aqua://.')
  if (url.username || url.password) throw new Error('Aqua links cannot contain credentials.')

  const segments = url.pathname.split('/').filter(Boolean)
  const action = (url.hostname || segments[0] || '').toLowerCase()
  if (!action) throw new Error('That Aqua link has no action.')
  if (url.hostname && segments.length) throw new Error('That Aqua link has an unexpected path.')
  if (url.hostname && segments.length === 0 && url.pathname && url.pathname !== '/') {
    throw new Error('That Aqua link has an unexpected path.')
  }

  const query = url.searchParams
  if (action === 'launch') {
    return {
      kind: 'launch',
      instance: optionalLinkText(query.get('instance'), 'Installation', MAX_INSTANCE_LENGTH),
      confirmed: false,
      source: 'link',
    }
  }

  if (action === 'join') {
    const address = linkText(query.get('server'), 'Server address', 300)
    const edition = normalizeEdition(query.get('edition'))
    // Validate here so a malformed link never reaches the join flow.
    const normalized = normalizeServerAddress(address, { edition })
    return {
      kind: 'join',
      server: normalized.connectAddress,
      instance: optionalLinkText(query.get('instance'), 'Installation', MAX_INSTANCE_LENGTH),
      edition,
      confirmed: false,
      source: 'link',
    }
  }

  if (action === 'install') {
    return {
      kind: 'install',
      project: normalizeProject(query.get('pack')),
      confirmed: false,
      source: 'link',
    }
  }

  if (action === 'open') {
    const page = linkText(query.get('page'), 'Page', 32).toLowerCase()
    if (!LINK_PAGES.includes(page)) throw new Error(`Unknown Aqua page "${page}".`)
    const contentType = query.get('contentType')
    if (contentType && !CONTENT_TYPES.includes(contentType)) throw new Error('Unknown content type.')
    return {
      kind: 'open',
      page,
      ...(contentType ? { contentType } : {}),
      ...(query.get('section') ? { section: linkText(query.get('section'), 'Section', 64) } : {}),
      confirmed: true,
      source: 'link',
    }
  }

  throw new Error(`Unknown Aqua link action "${action}". Use launch, join, install or open.`)
}

function commandTokens(argv) {
  const args = Array.isArray(argv) ? argv.map((value) => String(value)) : []
  if (args.length <= 1) return []
  let index = 1
  // In development Electron's argv is [electron, ., launch, ...]; packaged
  // builds drop the app path entirely.
  if (args[index] === '.' || /\.(?:c|m)?js$/i.test(args[index]) || /app\.asar[/\\]?$/i.test(args[index])) {
    index += 1
  }
  const result = []
  for (; index < args.length; index += 1) {
    const token = args[index]
    if (
      /^--(?:dev|hidden|no-sandbox|enable-logging)$/.test(token) ||
      /^--(?:inspect|inspect-brk|remote-debugging-port|user-data-dir)(?:=|$)/.test(token)
    ) {
      continue
    }
    result.push(token)
  }
  return result
}

function readOptions(tokens, { flags = [], values = [] } = {}) {
  const allowedFlags = new Set(flags)
  const valueFlags = new Set(values)
  const positionals = []
  const options = new Map()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const [name, inline] = token.split('=', 2)
    if (valueFlags.has(name)) {
      const value = inline ?? tokens[index + 1]
      if (value == null || value === '' || (!inline && value.startsWith('--'))) {
        throw new Error(`${name} needs a value.`)
      }
      if (inline == null) index += 1
      options.set(name, value)
      continue
    }
    if (!allowedFlags.has(name) || inline !== undefined) throw new Error(`Unknown option "${name}".`)
    options.set(name, true)
  }
  return { positionals, options }
}

/** Parses a CLI invocation. Returns null when Aqua was started normally. */
export function parseCommandLine(argv) {
  const tokens = commandTokens(argv)
  if (!tokens.length) return null

  const link = tokens.find((token) => /^aqua:\/\//i.test(token))
  if (link) {
    const intent = parseAquaLink(link)
    return {
      ...intent,
      confirmed: tokens.includes('--yes'),
      source: 'cli',
      ...(tokens.includes('--json') ? { json: true } : {}),
    }
  }

  const [command, ...rest] = tokens
  if (!COMMANDS.includes(command)) {
    throw new Error(`Unknown command "${command}". Use launch, join, install or status.`)
  }

  if (command === 'status') {
    const { positionals, options } = readOptions(rest, { flags: ['--json'] })
    if (positionals.length) throw new Error('status does not take any arguments.')
    return { kind: 'status', json: options.has('--json'), source: 'cli' }
  }

  if (command === 'join') {
    const { positionals, options } = readOptions(rest, {
      flags: ['--json', '--yes'],
      values: ['--instance', '--edition'],
    })
    if (positionals.length !== 1) throw new Error('join needs one server address.')
    const edition = normalizeEdition(options.get('--edition'))
    const normalized = normalizeServerAddress(positionals[0], { edition })
    return {
      kind: 'join',
      server: normalized.connectAddress,
      instance: optionalLinkText(options.get('--instance'), 'Installation', MAX_INSTANCE_LENGTH),
      edition,
      confirmed: options.has('--yes'),
      source: 'cli',
      json: options.has('--json'),
    }
  }

  const { positionals, options } = readOptions(rest, { flags: ['--json', '--yes'] })
  if (command === 'launch') {
    if (positionals.length > 1) throw new Error('launch accepts one installation name or id.')
    return {
      kind: 'launch',
      instance: optionalLinkText(positionals[0], 'Installation', MAX_INSTANCE_LENGTH),
      confirmed: options.has('--yes'),
      source: 'cli',
      json: options.has('--json'),
    }
  }

  if (positionals.length !== 1) throw new Error('install needs one Modrinth project or slug.')
  return {
    kind: 'install',
    project: normalizeProject(positionals[0]),
    confirmed: options.has('--yes'),
    source: 'cli',
    json: options.has('--json'),
  }
}

/** Everything `aqua status` may reveal: no tokens, accounts or local paths. */
export function buildStatusPayload({
  appVersion = '0.0.0',
  packaged = false,
  platform = process.platform,
  installations = [],
  activeInstallationId = null,
  launcherRunning = false,
} = {}) {
  const profiles = (Array.isArray(installations) ? installations : [])
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: typeof entry.versionId === 'string' ? entry.versionId : null,
      loader: typeof entry.loader?.type === 'string' ? entry.loader.type : 'vanilla',
      pinned: entry.pinned === true,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string').slice(0, 8) : [],
      lastPlayedAt: typeof entry.lastPlayedAt === 'string' ? entry.lastPlayedAt : null,
    }))
  const active = profiles.find((entry) => entry.id === activeInstallationId) || null
  return {
    app: {
      name: 'Aqua Launcher',
      version: String(appVersion),
      packaged: Boolean(packaged),
      platform: String(platform),
    },
    running: Boolean(launcherRunning),
    activeProfile: active,
    profiles,
    totals: {
      profiles: profiles.length,
      pinned: profiles.filter((entry) => entry.pinned).length,
    },
  }
}

export function formatStatusText(payload) {
  const lines = [
    `${payload.app.name} ${payload.app.version} · ${payload.app.platform}`,
    `Launcher running: ${payload.running ? 'yes' : 'no'}`,
    payload.activeProfile
      ? `Active profile: ${payload.activeProfile.name} (${payload.activeProfile.version || 'unknown version'} · ${payload.activeProfile.loader})`
      : 'Active profile: none',
    `Profiles: ${payload.totals.profiles} (${payload.totals.pinned} pinned)`,
  ]
  for (const profile of payload.profiles) {
    lines.push(
      `- ${profile.name} · ${profile.version || 'unknown version'} · ${profile.loader}${profile.pinned ? ' · pinned' : ''}`,
    )
  }
  return `${lines.join('\n')}\n`
}
