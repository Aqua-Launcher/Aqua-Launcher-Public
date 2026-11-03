import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  applicableLibraries,
  collectArgumentEntries,
  getPlatformContext,
  isModernArguments,
  mavenPath,
  substituteTokens,
} from './minecraft-rules.js'
import {
  assertSafeGameDirectory,
  fileExists,
  findNewestFile,
  isPathInside,
  parseArguments,
  pruneDirectory,
  readJsonFile,
  redactArguments,
} from './util.js'
import { getInstallationState } from './installer.js'
import { analyzeCrash } from './crash-analysis.js'
import { recoverOrphans, restoreStaged, stageContent } from './safe-mode.js'
import { effectiveVersionId } from './installations.js'

const APP_VERSION = '1.0.0'
const RESTARTABLE_STATES = new Set(['idle', 'exited', 'crashed', 'failed'])

/** Quick Play is advertised by Minecraft 1.20+ in its game arguments. */
export function supportsQuickPlay(versionJson) {
  return JSON.stringify(versionJson?.arguments?.game || []).includes('quickPlayMultiplayer')
}

function publicGameState(state) {
  return { ...state }
}

/** Prefer the GUI variant of a Java runtime so no console window is attached. */
async function windowedJavaPath(javaPath) {
  if (process.platform !== 'win32') return javaPath
  if (!/java\.exe$/i.test(javaPath)) return javaPath
  const candidate = path.join(path.dirname(javaPath), 'javaw.exe')
  return (await fileExists(candidate)) ? candidate : javaPath
}

function sanitizeLogChunk(text, secrets) {
  let cleaned = text
  for (const secret of secrets.filter(Boolean)) {
    if (secret.length < 8) continue
    cleaned = cleaned.split(secret).join('<redacted>')
  }
  cleaned = cleaned.replace(/(token:)([^:\s]+)(:[0-9a-f]{32})/gi, '$1<redacted>$3')
  cleaned = cleaned.replace(/(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g, '<redacted-jwt>')
  return cleaned
}

class GameLogWriter {
  constructor(filePath, secrets) {
    this.secrets = secrets
    this.stream = fs.createWriteStream(filePath, { flags: 'a' })
    this.remainder = ''
    this.closed = false
    this.stream.on('error', () => {
      this.closed = true
    })
  }

  write(text) {
    if (this.closed || !text) return
    const combined = this.remainder + String(text)
    const lines = combined.split(/\r?\n/)
    this.remainder = lines.pop() || ''
    if (lines.length) this.stream.write(`${sanitizeLogChunk(lines.join('\n'), this.secrets)}\n`)
  }

  close() {
    if (this.closed) return Promise.resolve()
    this.closed = true
    if (this.remainder) {
      this.stream.write(sanitizeLogChunk(this.remainder, this.secrets))
      this.remainder = ''
    }
    return new Promise((resolve) => {
      this.stream.end(resolve)
    })
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(
    date.getMinutes(),
  )}-${pad(date.getSeconds())}`
}

function effectiveProfileSettings(settings, installation) {
  const memory = installation.memoryOverride || settings.memory
  const windowSettings = installation.windowOverride || settings.window
  return {
    memory,
    window: windowSettings,
    jvmArgs: installation.jvmArgsOverride ?? settings.jvmArgs,
    gameArgs: installation.gameArgsOverride ?? settings.gameArgs,
  }
}

function validateMemory(memory) {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024))
  const minMb = Number(memory?.minMb)
  const maxMb = Number(memory?.maxMb)
  if (!Number.isFinite(minMb) || !Number.isFinite(maxMb)) throw new Error('The memory allocation is invalid.')
  if (minMb < 512) throw new Error('Minimum memory must be at least 512 MB.')
  if (maxMb < minMb) throw new Error('Maximum memory must be greater than minimum memory.')
  if (maxMb > totalMb) throw new Error(`Maximum memory cannot exceed the ${Math.round(totalMb / 1024)} GB installed.`)
  return { minMb: Math.round(minMb), maxMb: Math.round(maxMb) }
}

async function applyFullscreenPreference(gameDir, enabled, logger) {
  if (!enabled) return
  const optionsPath = path.join(gameDir, 'options.txt')
  try {
    let content = ''
    try {
      content = await fsp.readFile(optionsPath, 'utf8')
    } catch {
      content = ''
    }
    const lines = content.split(/\r?\n/)
    let replaced = false
    const next = lines.map((line) => {
      if (line.startsWith('fullscreen:')) {
        replaced = true
        return 'fullscreen:true'
      }
      return line
    })
    if (!replaced) next.push('fullscreen:true')
    await fsp.mkdir(gameDir, { recursive: true })
    await fsp.writeFile(optionsPath, next.join('\n'), 'utf8')
    logger.info('Enabled fullscreen for the next launch', { optionsPath })
  } catch (error) {
    logger.warn('Could not enable fullscreen in options.txt', { message: error.message })
  }
}

export class GameManager {
  constructor({
    paths,
    versionService,
    accountManager,
    javaService,
    store,
    logger,
    minecraftSettingsService,
    emitGame,
    emitActivity,
    emitNotification,
    emitInstallations,
    restoreWindow,
    onSessionEnd = null,
  }) {
    this.paths = paths
    this.versionService = versionService
    this.accountManager = accountManager
    this.javaService = javaService
    this.store = store
    this.logger = logger
    this.minecraftSettingsService = minecraftSettingsService
    this.emitGame = emitGame
    this.emitActivity = emitActivity
    this.emitNotification = emitNotification
    this.emitInstallations = emitInstallations
    this.restoreWindow = restoreWindow
    this.onSessionEnd = onSessionEnd
    this.child = null
    this.current = { status: 'idle' }
    this.logWriter = null
    this.sessionStartedAt = null
    this.safeModeSession = null
  }

  getState() {
    return publicGameState(this.current)
  }

  setState(patch) {
    this.current = { ...this.current, ...patch }
    this.emitGame(this.getState())
  }

  async loadInstalledVersion(versionId) {
    const safeId = path.basename(versionId)
    const candidate = path.join(this.paths.versionsRoot, safeId, `${safeId}.json`)
    return readJsonFile(candidate, null)
  }

  async launch(installationId, { quickPlay = null, safeMode = false } = {}) {
    if (this.child) throw new Error('Minecraft is already running. Close it before launching another instance.')
    if (!RESTARTABLE_STATES.has(this.current.status) && this.current.status !== 'running') {
      throw new Error('The launcher is already preparing a launch.')
    }
    const installation = this.store.getInstallation(installationId)
    if (!installation) throw new Error('Installation not found.')
    const account = this.store.getAccount(this.store.activeAccountId)
    if (!account) throw new Error('Sign in with a Microsoft account before launching Minecraft.')

    this.setState({
      status: 'preparing',
      phase: 'Checking installation',
      installationId: installation.id,
      installationName: installation.name,
      versionId: installation.versionId,
      serverAddress: null,
      startedAt: null,
      logPath: null,
      pid: null,
      error: null,
      exitCode: null,
      analysis: null,
      crashReportPath: null,
      endedAt: null,
      safeMode: { active: false, sessionId: null, movedFiles: 0 },
    })

    const launchVersionId = effectiveVersionId(installation)
    let stagedSafeMode = null
    try {
      const state = await getInstallationState(this.paths, launchVersionId)
      if (!state.installed) {
        throw new Error(`Minecraft ${installation.versionId} is not installed yet. Install it before launching.`)
      }
      const versionJson = await this.loadInstalledVersion(launchVersionId)
      if (!versionJson) {
        throw new Error('The installed version metadata is missing. Verify the installation files and try again.')
      }
      const settings = this.store.settings
      const effective = effectiveProfileSettings(settings, installation)
      const memory = validateMemory(effective.memory)
      if (
        effective.window.width < 320 ||
        effective.window.width > 7680 ||
        effective.window.height < 240 ||
        effective.window.height > 4320
      ) {
        throw new Error('The configured game window size is invalid.')
      }
      assertSafeGameDirectory(installation.gameDir)
      await fsp.mkdir(installation.gameDir, { recursive: true })
      const gameDirStat = await fsp.stat(installation.gameDir).catch(() => null)
      if (!gameDirStat?.isDirectory()) throw new Error('The game directory does not exist or is not a folder.')

      if (safeMode) {
        this.setState({ phase: 'Preparing Safe Mode' })
        stagedSafeMode = await stageContent(installation.gameDir)
        this.safeModeSession = {
          installationId: installation.id,
          gameDir: installation.gameDir,
          sessionId: stagedSafeMode.sessionId,
          movedFiles: stagedSafeMode.movedFiles,
        }
        this.setState({
          safeMode: {
            active: true,
            sessionId: stagedSafeMode.sessionId,
            movedFiles: stagedSafeMode.movedFiles,
          },
        })
        this.logger.info('Safe Mode moved content aside', {
          installation: installation.name,
          sessionId: stagedSafeMode.sessionId,
          movedFiles: stagedSafeMode.movedFiles,
        })
      }

      this.setState({ phase: 'Refreshing account session' })
      const credentials = await this.accountManager.getLaunchCredentials(account.id)
      this.setState({ phase: 'Finding a compatible Java runtime' })
      const java = await this.javaService.chooseJava(versionJson, settings, installation)
      if (java.warning) this.logger.warn('Java compatibility warning', { warning: java.warning })

      this.setState({ phase: 'Preparing launch files' })
      const plan = await this.buildLaunchPlan({
        installation,
        versionJson,
        credentials,
        java,
        settings,
        effective,
        memory,
        quickPlay,
      })

      await this.writeLaunchLog(plan, java, memory, versionJson)
      this.setState({ phase: 'Starting Minecraft', logPath: plan.logPath })
      this.logger.info('Launching Minecraft', {
        installation: installation.name,
        version: installation.versionId,
        java: java.path,
        memory,
      })
      await applyFullscreenPreference(installation.gameDir, effective.window.fullscreen, this.logger)
      // Shared in-game settings are applied just before launch so every instance
      // starts from the same options.txt and shader selection.
      if (this.minecraftSettingsService?.enabled) {
        await this.minecraftSettingsService
          .apply(installation)
          .catch((error) => this.logger.warn('Could not apply global Minecraft settings', { message: error.message }))
      }

      // Minecraft must not be spawned with windowsHide on Windows: the process start
      // flags force its first ShowWindow call to stay hidden, so legacy versions run
      // with sound but no window and no taskbar entry. Use javaw.exe (GUI subsystem)
      // instead, which also avoids flashing a console window.
      const gameExecutable = await windowedJavaPath(java.path)
      const child = spawn(gameExecutable, plan.args, {
        cwd: installation.gameDir,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      this.child = child
      const exitPromise = new Promise((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })
      this.sessionStartedAt = Date.now()

      const secrets = [credentials.accessToken, plan.legacySessionSecret].filter(Boolean)
      this.logWriter = new GameLogWriter(plan.logPath, secrets)
      const appendHeader = `\n[launcher] Java: ${java.path} (Java ${java.major})\n[launcher] Version: ${installation.versionId}\n[launcher] Memory: ${memory.minMb}–${memory.maxMb} MB\n[launcher] Game directory: ${installation.gameDir}\n\n`
      this.logWriter.write(appendHeader)

      const handleOutput = (chunk) => {
        this.logWriter?.write(chunk.toString())
      }
      child.stdout.on('data', handleOutput)
      child.stderr.on('data', handleOutput)
      child.on('error', (error) => {
        this.logWriter?.write(`[launcher] Process error: ${error.message}\n`)
      })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill()
          reject(new Error('Minecraft did not start within 20 seconds.'))
        }, 20_000)
        child.once('spawn', () => {
          clearTimeout(timer)
          resolve()
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(new Error(`Could not start Java: ${error.message}`))
        })
      })

      const startedAt = new Date().toISOString()
      this.setState({
        status: 'running',
        phase: 'Running',
        serverAddress: quickPlay?.address || null,
        pid: child.pid,
        startedAt,
        logPath: plan.logPath,
        javaPath: java.path,
        javaMajor: java.major,
        memory,
        warning: java.warning || null,
      })
      await this.store.updateInstallation(installation.id, { lastPlayedAt: startedAt })
      await this.emitInstallations()
      await this.store.addActivity({
        type: 'game',
        title: `Launched ${installation.name}`,
        detail: `Minecraft ${installation.versionId} · Java ${java.major}`,
        installationId: installation.id,
        status: 'success',
      })
      this.emitActivity()
      await pruneDirectory(path.join(this.paths.gameLogsRoot, installation.id), settings.logging.keepGameLogs)

      exitPromise.then(({ code, signal }) => {
        this.handleExit({
          code,
          signal,
          installation,
          logPath: plan.logPath,
          startedAt,
          safeModeSession: this.safeModeSession,
        }).catch((error) => {
          this.logger.error('Failed to finalize game session', { message: error.message })
        })
      })

      return {
        pid: child.pid,
        logPath: plan.logPath,
        startedAt,
        command: redactArguments(plan.args, secrets).join(' '),
        serverAddress: quickPlay?.address || null,
        quickJoinSupported: plan.quickJoinSupported,
      }
    } catch (error) {
      if (this.child) {
        try {
          this.child.kill()
        } catch {
          // The process may already be gone.
        }
      }
      this.child = null
      this.sessionStartedAt = null
      await this.logWriter?.close().catch(() => {})
      this.logWriter = null
      const restored = stagedSafeMode?.sessionId
        ? await restoreStaged(installation.gameDir, stagedSafeMode.sessionId).catch((restoreError) => {
            this.logger.warn('Could not restore Safe Mode content after a failed launch', {
              message: restoreError.message,
            })
            return null
          })
        : null
      this.safeModeSession = null
      this.setState({
        status: 'failed',
        phase: 'Launch failed',
        error: error.message,
        endedAt: new Date().toISOString(),
        safeMode: {
          active: Boolean(restored?.pending),
          sessionId: stagedSafeMode?.sessionId || null,
          movedFiles: stagedSafeMode?.movedFiles || 0,
          restored: restored?.restored || 0,
          conflicts: restored?.conflicts?.length || 0,
        },
      })
      this.logger.error('Minecraft launch failed', { message: error.message })
      throw error
    }
  }

  async buildLaunchPlan({ installation, versionJson, credentials, java, settings, effective, memory, quickPlay = null }) {
    const context = getPlatformContext({ has_custom_resolution: true })
    const libraries = applicableLibraries(versionJson, context)
    const libraryPaths = []
    const missing = []
    for (const library of libraries) {
      let relative
      if (library.downloads?.artifact) {
        relative = library.downloads.artifact.path || mavenPath(library.name)
      } else if (typeof library.name === 'string' && library.name.split(':').length >= 3 && !library.natives) {
        // Fabric and Quilt profiles describe libraries by Maven coordinate only.
        relative = mavenPath(library.name)
      } else {
        continue
      }
      const fullPath = path.resolve(this.paths.librariesRoot, relative)
      if (!isPathInside(fullPath, this.paths.librariesRoot)) {
        throw new Error('A library path in the version metadata is invalid.')
      }
      if (!(await fileExists(fullPath))) {
        missing.push(relative)
        continue
      }
      libraryPaths.push(fullPath)
    }

    const jarVersionId = versionJson.jarVersionId || versionJson.id
    const clientJar = path.join(this.paths.versionsRoot, jarVersionId, `${jarVersionId}.jar`)
    if (!(await fileExists(clientJar))) missing.push(`versions/${jarVersionId}/${jarVersionId}.jar`)
    if (missing.length) {
      throw new Error(
        `${missing.length} game file${missing.length === 1 ? '' : 's'} are missing (${missing
          .slice(0, 3)
          .join(', ')}). Verify the installation to repair it.`,
      )
    }

    const classpath = [...libraryPaths, clientJar].join(path.delimiter)
    const nativesDir = path.join(this.paths.versionsRoot, versionJson.id || installation.versionId, 'natives')
    for (const name of ['', 'java', 'jna', 'lwjgl', 'netty']) {
      await fsp.mkdir(path.join(nativesDir, name), { recursive: true })
    }

    const loggingFile = versionJson.logging?.client?.file
    let loggingPath = null
    if (loggingFile?.id) {
      loggingPath = path.join(this.paths.assetsRoot, 'log_configs', path.basename(loggingFile.id))
      if (!(await fileExists(loggingPath))) {
        throw new Error('The Minecraft log configuration is missing. Verify the installation to repair it.')
      }
    }

    const assetIndex = versionJson.assetIndex || {}
    const assetIndexId = assetIndex.id || versionJson.assets
    const assetsIndexPath = path.join(this.paths.assetsRoot, 'indexes', `${assetIndexId}.json`)
    if (!(await fileExists(assetsIndexPath))) {
      throw new Error('The Minecraft asset index is missing. Verify the installation to repair it.')
    }
    const virtualAssetsDir = path.join(this.paths.assetsRoot, 'virtual', assetIndexId)
    let gameAssets = this.paths.assetsRoot
    if (assetIndex.virtual || (await fileExists(virtualAssetsDir))) {
      const stat = await fsp.stat(virtualAssetsDir).catch(() => null)
      if (stat?.isDirectory()) gameAssets = virtualAssetsDir
    }

    const uuid = credentials.uuid.replace(/-/g, '')
    const tokens = {
      auth_player_name: credentials.name,
      auth_session: `token:${credentials.accessToken}:${uuid}`,
      auth_access_token: credentials.accessToken,
      auth_uuid: uuid,
      auth_xuid: credentials.xuid || '',
      auth_client_id: credentials.clientId || '',
      clientid: credentials.clientId || '',
      user_type: credentials.userType || 'msa',
      user_properties: '{}',
      profile_properties: '{}',
      version_name: installation.versionId,
      version_type: versionJson.type || installation.versionType || 'release',
      game_directory: installation.gameDir,
      assets_root: this.paths.assetsRoot,
      game_assets: gameAssets,
      assets_index_name: assetIndexId,
      natives_directory: nativesDir,
      library_directory: this.paths.librariesRoot,
      classpath,
      classpath_separator: path.delimiter,
      launcher_name: 'AquaLauncher',
      launcher_version: APP_VERSION,
      resolution_width: String(effective.window.width),
      resolution_height: String(effective.window.height),
      quickPlayPath: '',
      quickPlaySingleplayer: '',
      quickPlayMultiplayer: '',
      quickPlayRealms: '',
      path: loggingPath || '',
    }

    const jvmArgs = [`-Xms${memory.minMb}M`, `-Xmx${memory.maxMb}M`]
    const gameArgs = []
    if (isModernArguments(versionJson)) {
      const versionJvm = collectArgumentEntries(versionJson.arguments.jvm, context).map((value) =>
        substituteTokens(value, tokens),
      )
      const versionGame = collectArgumentEntries(versionJson.arguments.game, context).map((value) =>
        substituteTokens(value, tokens),
      )
      jvmArgs.push(...versionJvm)
      gameArgs.push(...versionGame)
      const hasLibraryPath = jvmArgs.some((argument) => argument.startsWith('-Djava.library.path='))
      if (!hasLibraryPath) jvmArgs.push(`-Djava.library.path=${nativesDir}`)
      if (loggingPath && versionJson.logging?.client?.argument) {
        jvmArgs.push(substituteTokens(versionJson.logging.client.argument, tokens))
      }
      const hasClasspath = jvmArgs.some((argument) => argument === '-cp' || argument === '-classpath')
      if (!hasClasspath) jvmArgs.push('-cp', classpath)
    } else {
      const legacyArgs = String(versionJson.minecraftArguments || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((value) => substituteTokens(value, tokens))
      jvmArgs.push(`-Djava.library.path=${nativesDir}`)
      if (loggingPath && versionJson.logging?.client?.argument) {
        jvmArgs.push(substituteTokens(versionJson.logging.client.argument, tokens))
      }
      jvmArgs.push('-cp', classpath)
      gameArgs.push(...legacyArgs)
      gameArgs.push('--width', String(effective.window.width), '--height', String(effective.window.height))
    }

    const customJvm = parseArguments(effective.jvmArgs)
    const customGame = parseArguments(effective.gameArgs)
    jvmArgs.push(...customJvm)
    // Quick Play arrived in 1.20 and every version that supports it advertises
    // the placeholder in its arguments. Older versions ignore the feature, so
    // leave their command line untouched instead of failing on an unknown flag.
    const quickJoinSupported = supportsQuickPlay(versionJson)
    if (quickJoinSupported && quickPlay?.type === 'multiplayer' && quickPlay.address) {
      gameArgs.push('--quickPlayMultiplayer', quickPlay.address)
    }
    gameArgs.push(...customGame)
    const args = [...jvmArgs, versionJson.mainClass, ...gameArgs]
    const unsafe = args.find((argument) => typeof argument !== 'string' || argument.includes('\0'))
    if (unsafe != null) throw new Error('The launch arguments contain invalid characters.')
    if (!versionJson.mainClass) throw new Error('The version metadata does not include a main class.')

    const logDir = path.join(this.paths.gameLogsRoot, installation.id)
    await fsp.mkdir(logDir, { recursive: true })
    const logPath = path.join(logDir, `${formatTimestamp()}.log`)

    return {
      args,
      logPath,
      classpath,
      loggingPath,
      legacySessionSecret: credentials.accessToken,
      versionJson,
      java,
      quickJoinSupported,
    }
  }

  async writeLaunchLog(plan, java, memory, versionJson) {
    const secrets = [plan.legacySessionSecret].filter(Boolean)
    const header = [
      `[launcher] ${new Date().toISOString()}`,
      `[launcher] Aqua Launcher ${APP_VERSION}`,
      `[launcher] Minecraft ${versionJson.id}`,
      `[launcher] Java ${java.major} · ${java.path}`,
      `[launcher] Memory ${memory.minMb}–${memory.maxMb} MB`,
      `[launcher] Command (redacted): ${redactArguments(plan.args, secrets).join(' ')}`,
      '',
      '',
    ].join('\n')
    await fsp.writeFile(plan.logPath, header, { encoding: 'utf8', flag: 'w' })
  }

  /**
   * Reads the crash report and the tail of the session log, then hands them to
   * the local rules. Nothing here changes a file or reaches the network.
   */
  async analyzeSession({ installation, code, signal, crash, logPath }) {
    const reportText = crash?.path ? await fsp.readFile(crash.path, 'utf8').catch(() => '') : ''
    const logText = await fsp.readFile(logPath, 'utf8').catch(() => '')
    const logTail = logText.split(/\r?\n/).slice(-400).join('\n')
    const installedMods = await fsp.readdir(path.join(installation.gameDir, 'mods')).catch(() => [])
    return analyzeCrash({
      text: `${reportText}\n${logTail}`.slice(-512 * 1024),
      exitCode: code,
      signal,
      memory: this.current.memory,
      javaMajor: this.current.javaMajor,
      installedMods,
    })
  }

  hasPendingSafeMode() {
    return Boolean(this.safeModeSession)
  }

  /** Restores every Safe Mode session, including ones left by a killed launcher. */
  async recoverSafeMode() {
    const directories = [...new Set(this.store.installations.map((entry) => entry.gameDir)), this.paths.instancesRoot]
    const summary = await recoverOrphans(directories)
    if (summary.sessions.length) {
      this.logger.info('Restored Safe Mode content from an earlier session', {
        sessions: summary.sessions.length,
        restored: summary.restored,
        conflicts: summary.conflicts,
      })
    }
    if (summary.conflicts) {
      this.emitNotification({
        level: 'warning',
        title: 'Safe Mode needs attention',
        message: `${summary.conflicts} file${summary.conflicts === 1 ? '' : 's'} changed while Safe Mode was active and were left in the safe-mode folder.`,
      })
    }
    return summary
  }

  /** Called on quit when no game is running, so staging never outlives the app. */
  async restoreSafeModeOnQuit() {
    if (this.child) return { skipped: true }
    if (this.safeModeSession) {
      await restoreStaged(this.safeModeSession.gameDir, this.safeModeSession.sessionId).catch((error) => {
        this.logger.warn('Could not restore Safe Mode content on quit', { message: error.message })
      })
      this.safeModeSession = null
    }
    return this.recoverSafeMode()
  }

  async handleExit({ code, signal, installation, logPath, startedAt, safeModeSession = null }) {
    this.child = null
    const startedMs = new Date(startedAt).getTime()
    const end = Date.now()
    const playtimeMs = Math.max(0, end - startedMs)
    await this.logWriter?.close().catch(() => {})
    this.logWriter = null
    let safeModeRestore = null
    if (safeModeSession?.sessionId) {
      safeModeRestore = await restoreStaged(installation.gameDir, safeModeSession.sessionId).catch((error) => {
        this.logger.warn('Could not restore Safe Mode content', { message: error.message })
        return { restored: 0, conflicts: [], pending: true }
      })
      if (safeModeRestore.conflicts?.length) {
        this.logger.warn('Safe Mode restore had conflicts', {
          installation: installation.name,
          conflicts: safeModeRestore.conflicts.length,
        })
        this.emitNotification({
          level: 'warning',
          title: 'Safe Mode could not restore everything',
          message: `${safeModeRestore.conflicts.length} file${safeModeRestore.conflicts.length === 1 ? '' : 's'} changed during the session and were left in the safe-mode folder.`,
        })
      }
      if (!safeModeRestore.pending) this.safeModeSession = null
    }
    const crash = await findNewestFile(path.join(installation.gameDir, 'crash-reports'), '.txt', startedMs - 2000)
    const crashed = Boolean(crash) || (code != null && code !== 0) || Boolean(signal)
    const endedAt = new Date(end).toISOString()
    const analysis = crashed
      ? await this.analyzeSession({ installation, code, signal, crash, logPath }).catch((error) => {
          this.logger.warn('Could not analyse the crash', { message: error.message })
          return null
        })
      : null
    this.setState({
      status: crashed ? 'crashed' : 'exited',
      phase: crashed ? 'Game crashed' : 'Game closed',
      exitCode: code,
      signal,
      endedAt,
      crashReportPath: crash?.path || null,
      analysis,
      playtimeMs,
      safeMode: safeModeSession
        ? {
            active: Boolean(safeModeRestore?.pending),
            sessionId: safeModeSession.sessionId,
            movedFiles: safeModeSession.movedFiles || 0,
            restored: safeModeRestore?.restored || 0,
            conflicts: safeModeRestore?.conflicts?.length || 0,
          }
        : this.current.safeMode || { active: false, sessionId: null, movedFiles: 0 },
    })
    if (analysis) {
      await this.store
        .addCrash({
          ...analysis,
          installationId: installation.id,
          installationName: installation.name,
          at: endedAt,
          exitCode: code,
          signal,
          reportPath: crash?.path || null,
        })
        .catch((error) => this.logger.warn('Could not save the crash', { message: error.message }))
    }
    this.logger.info('Minecraft session ended', {
      installation: installation.name,
      code,
      signal,
      crashed,
      playtimeMs,
    })
    if (this.minecraftSettingsService?.enabled) {
      // Settings changed in game become the shared ones for every other instance.
      await this.minecraftSettingsService
        .capture(installation)
        .catch((error) => this.logger.warn('Could not save global Minecraft settings', { message: error.message }))
    }
    try {
      await this.store.markInstallationPlayed(installation.id, {
        startedAt,
        endedAt,
        playtimeMs,
      })
      await this.store.addActivity({
        type: 'game',
        title: crashed ? `${installation.name} crashed` : `Closed ${installation.name}`,
        detail: crashed
          ? crash?.path
            ? 'Crash report available in Logs & diagnostics'
            : `Process exited with code ${code ?? 'unknown'}`
          : `Played for ${formatDuration(playtimeMs)}`,
        installationId: installation.id,
        status: crashed ? 'error' : 'info',
      })
      this.emitActivity()
      await this.emitInstallations()
    } catch (error) {
      this.logger.error('Could not save game session', { message: error.message })
    }

    // Backups are queued after the session is recorded; the exit dialog and the
    // next launch never wait for a ZIP to finish.
    if (this.onSessionEnd) {
      try {
        const pending = this.onSessionEnd({
          installationId: installation.id,
          startedAt,
          endedAt,
          crashed,
        })
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => this.logger.warn('Could not queue world backups', { message: error.message }))
        }
      } catch (error) {
        this.logger.warn('Could not queue world backups', { message: error.message })
      }
    }

    if (this.store.settings.startup.reopenOnGameExit) {
      this.restoreWindow?.()
    }
    const reportName = crash?.path ? path.basename(crash.path) : null
    this.emitNotification({
      level: crashed ? 'error' : 'info',
      title: crashed ? 'Minecraft crashed' : 'Minecraft closed',
      message: crashed
        ? `The game exited unexpectedly${code != null ? ` (code ${code})` : ''}. Open Logs & diagnostics for details.`
        : `Session ended after ${formatDuration(playtimeMs)}.`,
      dedupeKey: `game:${installation.id}:${endedAt}`,
      action: crashed
        ? {
            page: 'logs',
            params: {
              category: 'crash',
              installationId: installation.id,
              ...(reportName ? { file: reportName } : {}),
            },
            label: reportName ? 'View crash report' : 'Open crash reports',
          }
        : {
            page: 'logs',
            params: { category: 'game', installationId: installation.id, file: path.basename(logPath) },
            label: 'View game log',
          },
    })
  }
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 1) return `${minutes}m`
  return `${hours}h ${minutes % 60}m`
}

export { effectiveProfileSettings, formatDuration, validateMemory }
