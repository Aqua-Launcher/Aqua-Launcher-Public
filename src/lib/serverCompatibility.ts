import type { Installation, ServerEdition, ServerEntry, ServerStatus } from './types'

export type ServerCompatibilityLevel = 'ok' | 'warning' | 'error' | 'unknown'

export interface ServerCompatibilityIssue {
  code: 'profile' | 'version' | 'mods' | 'account' | 'fallback' | 'edition'
  title: string
  detail: string
}

export interface ServerCompatibility {
  level: ServerCompatibilityLevel
  /** A short card badge, or null when there is nothing useful to say yet. */
  label: string | null
  issues: ServerCompatibilityIssue[]
  serverVersion: string | null
  instanceVersion: string | null
}

export interface JoinWarningState {
  serverId: string | null
  serverName: string
  address: string
  edition: ServerEdition
  installationId: string | null
  installationName: string
  serverVersion: string | null
  instanceVersion: string | null
  issues: ServerCompatibilityIssue[]
}

interface CompatibilityInput {
  server: Pick<ServerEntry, 'edition' | 'installationId'> | null
  installation: Pick<Installation, 'name' | 'versionId' | 'loader' | 'installed'> | null
  status: ServerStatus | null
  /** True when the saved profile disappeared and the active profile is used. */
  usedFallback?: boolean
}

/** Server software often prefixes its Minecraft version, such as `Paper 1.21.4`. */
export function extractMinecraftVersion(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  return match ? match[1] : null
}

/**
 * A server list sample exposes player UUIDs. Online-mode servers issue v4
 * UUIDs, while offline-mode servers derive v3 name UUIDs. Samples are optional,
 * so null means "not enough information" rather than offline mode.
 */
export function detectOnlineMode(status: ServerStatus | null): boolean | null {
  const sample = status?.players?.sample
  if (!Array.isArray(sample) || !sample.length) return null
  let sawKnown = false
  for (const player of sample) {
    const compact = String(player?.id ?? '').replace(/-/g, '').toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(compact)) continue
    const version = compact[12]
    if (version === '4') return true
    if (version === '3') sawKnown = true
  }
  return sawKnown ? false : null
}

export function analyzeServerCompatibility({
  server,
  installation,
  status,
  usedFallback = false,
}: CompatibilityInput): ServerCompatibility {
  const serverVersion = extractMinecraftVersion(status?.version)
  const instanceVersion = installation?.versionId ?? null
  const issues: ServerCompatibilityIssue[] = []

  if (!server || server.edition === 'bedrock') {
    return { level: 'ok', label: null, issues, serverVersion, instanceVersion }
  }

  if (usedFallback) {
    issues.push({
      code: 'fallback',
      title: 'Saved profile missing',
      detail: installation
        ? `The profile saved for this server is gone. Aqua will use ${installation.name} instead.`
        : 'The profile saved for this server is gone. Choose a profile before joining.',
    })
  }

  if (!installation) {
    issues.push({
      code: 'profile',
      title: 'No profile',
      detail: 'Create or select a Java profile before joining this server.',
    })
  } else if (!installation.installed) {
    issues.push({
      code: 'profile',
      title: 'Profile not installed',
      detail: `${installation.name} has not downloaded its game files yet.`,
    })
  }

  if (installation && status?.online) {
    if (serverVersion && instanceVersion && serverVersion !== instanceVersion) {
      issues.push({
        code: 'version',
        title: 'Version mismatch',
        detail: `${installation.name} runs Minecraft ${instanceVersion}, but the server reports ${serverVersion}.`,
      })
    }

    if (status.modded && (installation.loader?.type ?? 'vanilla') === 'vanilla') {
      issues.push({
        code: 'mods',
        title: 'Modded server',
        detail: 'The server advertises Forge or NeoForge. A vanilla profile will usually be disconnected while joining.',
      })
    }

  }

  if (issues.length) {
    const level = issues.some((issue) => issue.code === 'profile') ? 'error' : 'warning'
    return { level, label: issues[0].title, issues, serverVersion, instanceVersion }
  }

  return {
    level: status?.online ? 'ok' : 'unknown',
    label: status?.online ? 'Compatible' : null,
    issues,
    serverVersion,
    instanceVersion,
  }
}
