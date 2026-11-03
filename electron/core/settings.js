import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { assertAbsolutePath, assertSafeGameDirectory, clamp, parseArguments, parseJavaMajorVersion } from './util.js'
import { recommendMaxRam } from './system.js'
import { normalizeBackupPolicy } from './backup-scheduler.js'
import { normalizeContentFilters } from './modrinth.js'

export const THEMES = ['midnight', 'slate']
export const ACCENTS = ['aqua', 'ocean', 'steel']
export const FONT_FAMILIES = ['minecraft', 'quicksand']
const LEGACY_ACCENTS = { grass: 'aqua', emerald: 'ocean', lime: 'steel', violet: 'aqua' }
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

const SURFACE_MODES = ['block', 'color', 'off']
const BLOCK_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}$/
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

/** Defaults for Settings → Appearance → Custom block theme. */
export const DEFAULT_CUSTOM_THEME = {
  enabled: false,
  sidebar: { mode: 'block', block: 'grass_block', color: '#6aa84f', opacity: 45, pixelSize: 48 },
  titlebar: { mode: 'block', block: 'oak_planks', color: '#b08b52', opacity: 35, pixelSize: 40 },
  backdrop: { mode: 'off', block: 'stone', color: '#8f8f8f', opacity: 18, pixelSize: 96 },
  accentMode: 'theme',
  accentColor: '#2f7fe0',
}

export function createDefaultSettings({ totalMemMb, instancesRoot }) {
  const recommended = recommendMaxRam(totalMemMb)
  return {
    onboardingComplete: false,
    theme: 'midnight',
    accent: 'aqua',
    customTheme: normalizeCustomTheme({}, DEFAULT_CUSTOM_THEME),
    fontFamily: 'minecraft',
    // The locks keep rounding on and 3D chrome off while they are engaged;
    // unlinking hands each choice to its own switch.
    roundedCorners: true,
    roundedCornersLinked: true,
    chunkyChrome: false,
    chunkyChromeLinked: true,
    uiScale: 1,
    reduceMotion: false,
    highContrast: false,
    reduceTransparency: false,
    ambient: true,
    dashboardBackground: null,
    java: { mode: 'auto', path: null },
    memory: {
      minMb: Math.min(1024, Math.max(512, recommended - 1536)),
      maxMb: Math.min(recommended, Math.max(2048, totalMemMb - 1024)),
    },
    defaultGameDir: instancesRoot,
    downloads: { concurrency: 8, bandwidthKbps: 0 },
    window: { width: 1280, height: 720, fullscreen: false },
    jvmArgs: '',
    gameArgs: '',
    microsoftClientId: '',
    minecraftSettings: { sync: true },
    backups: normalizeBackupPolicy({}),
    contentFilters: {},
    notifications: {
      enabled: true,
      native: true,
      levels: { success: true, info: true, warning: true, error: true },
    },
    discord: { enabled: false, showServer: false },
    startup: {
      launchAtLogin: false,
      startMinimized: false,
      reopenOnGameExit: true,
      refreshJavaOnStart: true,
    },
    logging: { level: 'info', keepGameLogs: 20 },
  }
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asInt(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asHex(value, fallback) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

function normalizeSurface(raw, base) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    mode: SURFACE_MODES.includes(source.mode) ? source.mode : base.mode,
    block: typeof source.block === 'string' && BLOCK_ID_PATTERN.test(source.block) ? source.block : base.block,
    color: asHex(source.color, base.color),
    opacity: clamp(asInt(source.opacity, base.opacity), 0, 100),
    pixelSize: clamp(asInt(source.pixelSize, base.pixelSize), 16, 128),
  }
}

function normalizeCustomTheme(raw, base) {
  const fallback = base && typeof base === 'object' ? base : DEFAULT_CUSTOM_THEME
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: asBoolean(source.enabled, fallback.enabled),
    sidebar: normalizeSurface(source.sidebar, fallback.sidebar || DEFAULT_CUSTOM_THEME.sidebar),
    titlebar: normalizeSurface(source.titlebar, fallback.titlebar || DEFAULT_CUSTOM_THEME.titlebar),
    backdrop: normalizeSurface(source.backdrop, fallback.backdrop || DEFAULT_CUSTOM_THEME.backdrop),
    accentMode: source.accentMode === 'custom' ? 'custom' : 'theme',
    accentColor: asHex(source.accentColor, fallback.accentColor || DEFAULT_CUSTOM_THEME.accentColor),
  }
}

function clampUiScale(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(1.3, Math.max(0.8, Math.round(parsed * 100) / 100))
}

export function normalizeSettings(raw, defaults) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const base = defaults
  const java = source.java && typeof source.java === 'object' ? source.java : {}
  const memory = source.memory && typeof source.memory === 'object' ? source.memory : {}
  const downloads = source.downloads && typeof source.downloads === 'object' ? source.downloads : {}
  const window = source.window && typeof source.window === 'object' ? source.window : {}
  const startup = source.startup && typeof source.startup === 'object' ? source.startup : {}
  const logging = source.logging && typeof source.logging === 'object' ? source.logging : {}
  const minecraftSettings =
    source.minecraftSettings && typeof source.minecraftSettings === 'object' ? source.minecraftSettings : {}
  const backups = source.backups && typeof source.backups === 'object' ? source.backups : {}
  const notifications =
    source.notifications && typeof source.notifications === 'object' ? source.notifications : {}
  const discord = source.discord && typeof source.discord === 'object' ? source.discord : {}
  const notificationLevels =
    notifications.levels && typeof notifications.levels === 'object' ? notifications.levels : {}
  return {
    onboardingComplete: asBoolean(source.onboardingComplete, base.onboardingComplete),
    theme: THEMES.includes(source.theme) ? source.theme : base.theme,
    accent: ACCENTS.includes(source.accent) ? source.accent : LEGACY_ACCENTS[source.accent] || base.accent,
    customTheme: normalizeCustomTheme(source.customTheme, base.customTheme),
    fontFamily: FONT_FAMILIES.includes(source.fontFamily) ? source.fontFamily : base.fontFamily,
    roundedCorners: asBoolean(source.roundedCorners, base.roundedCorners),
    roundedCornersLinked: asBoolean(source.roundedCornersLinked, base.roundedCornersLinked),
    chunkyChrome: asBoolean(source.chunkyChrome, base.chunkyChrome),
    chunkyChromeLinked: asBoolean(source.chunkyChromeLinked, base.chunkyChromeLinked),
    uiScale: clampUiScale(source.uiScale),
    reduceMotion: asBoolean(source.reduceMotion, base.reduceMotion),
    highContrast: asBoolean(source.highContrast, base.highContrast),
    reduceTransparency: asBoolean(source.reduceTransparency, base.reduceTransparency),
    ambient: asBoolean(source.ambient, base.ambient),
    dashboardBackground:
      typeof source.dashboardBackground === 'string' && source.dashboardBackground.trim()
        ? source.dashboardBackground.trim()
        : null,
    java: {
      mode: java.mode === 'path' ? 'path' : 'auto',
      path: typeof java.path === 'string' && java.path.trim() ? java.path.trim() : null,
    },
    memory: {
      minMb: asInt(memory.minMb, base.memory.minMb),
      maxMb: asInt(memory.maxMb, base.memory.maxMb),
    },
    defaultGameDir: asString(source.defaultGameDir, base.defaultGameDir),
    downloads: {
      concurrency: asInt(downloads.concurrency, base.downloads.concurrency),
      bandwidthKbps: asInt(downloads.bandwidthKbps, base.downloads.bandwidthKbps),
    },
    window: {
      width: asInt(window.width, base.window.width),
      height: asInt(window.height, base.window.height),
      fullscreen: asBoolean(window.fullscreen, base.window.fullscreen),
    },
    jvmArgs: asString(source.jvmArgs, base.jvmArgs),
    gameArgs: asString(source.gameArgs, base.gameArgs),
    microsoftClientId: asString(source.microsoftClientId, base.microsoftClientId).trim(),
    minecraftSettings: {
      sync: asBoolean(minecraftSettings.sync, base.minecraftSettings?.sync ?? true),
    },
    backups: normalizeBackupPolicy(backups, base.backups),
    contentFilters: normalizeContentFilters(source.contentFilters),
    notifications: {
      enabled: asBoolean(notifications.enabled, base.notifications?.enabled ?? true),
      native: asBoolean(notifications.native, base.notifications?.native ?? true),
      levels: {
        success: asBoolean(notificationLevels.success, base.notifications?.levels?.success ?? true),
        info: asBoolean(notificationLevels.info, base.notifications?.levels?.info ?? true),
        warning: asBoolean(notificationLevels.warning, base.notifications?.levels?.warning ?? true),
        error: asBoolean(notificationLevels.error, base.notifications?.levels?.error ?? true),
      },
    },
    discord: {
      enabled: asBoolean(discord.enabled, base.discord?.enabled ?? false),
      showServer: asBoolean(discord.showServer, base.discord?.showServer ?? false),
    },
    startup: {
      launchAtLogin: asBoolean(startup.launchAtLogin, base.startup.launchAtLogin),
      startMinimized: asBoolean(startup.startMinimized, base.startup.startMinimized),
      reopenOnGameExit: asBoolean(startup.reopenOnGameExit, base.startup.reopenOnGameExit),
      refreshJavaOnStart: asBoolean(startup.refreshJavaOnStart, base.startup.refreshJavaOnStart),
    },
    logging: {
      level: LOG_LEVELS.includes(logging.level) ? logging.level : base.logging.level,
      keepGameLogs: asInt(logging.keepGameLogs, base.logging.keepGameLogs),
    },
  }
}

export async function validateSettings(settings, context) {
  const { totalMemMb } = context
  const errors = []
  if (!THEMES.includes(settings.theme)) errors.push('Choose a valid theme.')
  if (!ACCENTS.includes(settings.accent)) errors.push('Choose a valid accent color.')
  if (!FONT_FAMILIES.includes(settings.fontFamily)) errors.push('Choose a valid interface font.')
  if (!Number.isFinite(settings.uiScale) || settings.uiScale < 0.8 || settings.uiScale > 1.3) {
    errors.push('Interface scale must be between 80% and 130%.')
  }

  if (settings.java.mode === 'path') {
    if (!settings.java.path) {
      errors.push('Choose a Java executable or switch to automatic detection.')
    } else {
      try {
        assertAbsolutePath(settings.java.path, 'Java path')
      } catch (error) {
        errors.push(error.message)
      }
    }
  }

  const minMb = settings.memory.minMb
  const maxMb = settings.memory.maxMb
  if (!Number.isFinite(minMb) || minMb < 512 || minMb > totalMemMb) {
    errors.push('Minimum memory must be between 512 MB and your installed RAM.')
  }
  if (!Number.isFinite(maxMb) || maxMb < 1024 || maxMb > totalMemMb) {
    errors.push('Maximum memory must be between 1024 MB and your installed RAM.')
  }
  if (minMb > maxMb) errors.push('Minimum memory cannot be greater than maximum memory.')

  if (!Number.isFinite(settings.downloads.concurrency) || settings.downloads.concurrency < 1 || settings.downloads.concurrency > 32) {
    errors.push('Download concurrency must be between 1 and 32.')
  }
  if (
    !Number.isFinite(settings.downloads.bandwidthKbps) ||
    settings.downloads.bandwidthKbps < 0 ||
    settings.downloads.bandwidthKbps > 1_000_000
  ) {
    errors.push('Bandwidth limit must be between 0 and 1,000,000 KB/s.')
  }

  const width = settings.window.width
  const height = settings.window.height
  if (!Number.isInteger(width) || width < 320 || width > 7680) errors.push('Window width must be between 320 and 7680.')
  if (!Number.isInteger(height) || height < 240 || height > 4320) errors.push('Window height must be between 240 and 4320.')

  if (!LOG_LEVELS.includes(settings.logging.level)) errors.push('Choose a valid log level.')
  if (settings.dashboardBackground && !path.isAbsolute(settings.dashboardBackground)) {
    errors.push('The dashboard background path is invalid.')
  }
  if (
    !Number.isInteger(settings.logging.keepGameLogs) ||
    settings.logging.keepGameLogs < 1 ||
    settings.logging.keepGameLogs > 200
  ) {
    errors.push('Game log retention must be between 1 and 200 files.')
  }

  if (!Number.isInteger(settings.backups.dailyHour) || settings.backups.dailyHour < 0 || settings.backups.dailyHour > 23) {
    errors.push('The daily backup hour must be between 0 and 23.')
  }
  if (
    !Number.isInteger(settings.backups.retentionCount) ||
    settings.backups.retentionCount < 1 ||
    settings.backups.retentionCount > 50
  ) {
    errors.push('Backup retention must be between 1 and 50 copies.')
  }
  if (
    !Number.isInteger(settings.backups.maxTotalMb) ||
    settings.backups.maxTotalMb < 0 ||
    settings.backups.maxTotalMb > 102_400
  ) {
    errors.push('The backup storage limit must be between 0 and 102,400 MB.')
  }

  const clientId = settings.microsoftClientId
  if (clientId && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientId)) {
    errors.push('The Microsoft application (client) ID must be a valid GUID.')
  }

  try {
    const safeGameDir = assertSafeGameDirectory(settings.defaultGameDir)
    await fsp.mkdir(safeGameDir, { recursive: true })
    const stat = await fsp.stat(safeGameDir)
    if (!stat.isDirectory()) throw new Error('The path is not a folder.')
    await fsp.access(safeGameDir, fs.constants.W_OK)
  } catch (error) {
    errors.push(`Default game directory is not usable: ${error.message}`)
  }

  try {
    parseArguments(settings.jvmArgs)
    parseArguments(settings.gameArgs)
  } catch (error) {
    errors.push(error.message)
  }
  if (settings.jvmArgs.length > 4000 || settings.gameArgs.length > 4000) {
    errors.push('Custom arguments must be 4,000 characters or fewer.')
  }

  if (!Number.isInteger(settings.memory.maxMb)) errors.push('Invalid memory setting.')

  if (errors.length) {
    const error = new Error(errors[0])
    error.validationErrors = errors
    throw error
  }

  const sanitized = normalizeSettings(settings, settings)
  sanitized.defaultGameDir = path.normalize(settings.defaultGameDir)
  sanitized.memory.maxMb = clamp(sanitized.memory.maxMb, 1024, totalMemMb)
  sanitized.memory.minMb = Math.min(sanitized.memory.minMb, sanitized.memory.maxMb)
  return sanitized
}

export function describeJavaRequirement(major) {
  return major ? `Java ${parseJavaMajorVersion(major)}` : 'Java'
}
