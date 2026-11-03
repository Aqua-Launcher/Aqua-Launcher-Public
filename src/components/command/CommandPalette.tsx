import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarChart3,
  Download,
  FolderOpen,
  Globe2,
  Home,
  Image as ImageIcon,
  Layers,
  Map,
  Package,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import {
  groupCommands,
  searchCommandGroups,
  type CommandGroup,
  type CommandSearchItem,
} from '../../lib/commandPalette'
import { useLauncher } from '../../state/LauncherProvider'
import type { InstalledMod, ServerEntry, Settings as SettingsShape, WorldSearchEntry } from '../../lib/types'
import { cx, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const OPEN_EVENT = 'aqua:open-command-palette'
const RECENT_KEY = 'aqua.command-palette.recent.v1'
const RECENT_LIMIT = 6

const SETTINGS_SECTIONS = [
  ['settings-appearance', 'Display'],
  ['settings-java', 'Java'],
  ['settings-memory', 'Memory'],
  ['settings-minecraft', 'Minecraft settings'],
  ['settings-backups', 'Backups'],
  ['settings-game', 'Game & downloads'],
  ['settings-storage', 'Storage'],
  ['settings-window', 'Window'],
  ['settings-advanced', 'Advanced'],
  ['settings-startup', 'Startup'],
  ['settings-links', 'Links & CLI'],
  ['settings-troubleshooting', 'Troubleshooting'],
  ['settings-about', 'About'],
] as const

interface PaletteCommand extends CommandSearchItem {
  icon: ReactNode
  hint?: string
  run: () => unknown
}

interface DisplayGroup {
  title: string
  items: PaletteCommand[]
}

function readRecent() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function groupTitle(group: CommandGroup) {
  return group
}

export function CommandPalette() {
  const {
    installations,
    selectedInstallation,
    settings,
    data,
    accounts,
    activeAccount,
    navigate,
    play,
    launchGame,
    installGame,
    openInstallationFolder,
    openInstallDialog,
    setActiveInstallation,
    joinServer,
    openAuth,
    switchAccount,
    saveSettings,
    pushToast,
  } = useLauncher()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>(readRecent)
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [worlds, setWorlds] = useState<WorldSearchEntry[]>([])
  const [content, setContent] = useState<InstalledMod[]>([])
  const [indexing, setIndexing] = useState({ servers: true, worlds: true, content: false })
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void api.servers
      .list()
      .then((value) => {
        if (!cancelled) setServers(value)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIndexing((current) => ({ ...current, servers: false }))
      })

    // World metadata is read off the main thread; delaying it keeps first paint
    // responsive while still having the index ready before most palette uses.
    const timer = window.setTimeout(() => {
      void api.worlds
        .searchIndex()
        .then((value) => {
          if (!cancelled) setWorlds(value)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIndexing((current) => ({ ...current, worlds: false }))
        })
    }, 700)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!selectedInstallation?.id) {
      setContent([])
      return
    }
    let cancelled = false
    setIndexing((current) => ({ ...current, content: true }))
    void api.mods
      .list(selectedInstallation.id, 'mod')
      .then((result) => {
        if (!cancelled) setContent(result.items)
      })
      .catch(() => {
        if (!cancelled) setContent([])
      })
      .finally(() => {
        if (!cancelled) setIndexing((current) => ({ ...current, content: false }))
      })
    return () => {
      cancelled = true
    }
  }, [selectedInstallation?.id])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return
      const modalOpen = Boolean(document.querySelector('.modal-overlay'))
      if (!open && (isEditableTarget(event.target) || modalOpen)) return
      event.preventDefault()
      if (open) close()
      else setOpen(true)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [close, open])

  const remember = useCallback((id: string) => {
    setRecentIds((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, RECENT_LIMIT)
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Recent commands are a convenience; a blocked localStorage is harmless.
      }
      return next
    })
  }, [])

  const toggleSetting = useCallback(
    async (label: string, enabled: boolean, patch: Partial<SettingsShape>) => {
      try {
        await saveSettings(patch)
        pushToast({ level: 'success', title: `${label} ${enabled ? 'enabled' : 'disabled'}` })
      } catch (error) {
        pushToast({ level: 'error', title: `Could not update ${label.toLowerCase()}`, message: getErrorMessage(error) })
      }
    },
    [pushToast, saveSettings],
  )

  const commands = useMemo<PaletteCommand[]>(() => {
    const items: PaletteCommand[] = []
    const add = (command: PaletteCommand) => items.push(command)

    add({ id: 'page-home', label: 'Home', description: 'Dashboard, Play and recent activity', group: 'Pages', icon: <Home />, run: () => navigate('home') })
    add({ id: 'page-installations', label: 'Installations', description: 'Profiles, versions and game folders', group: 'Pages', icon: <Layers />, run: () => navigate('installations') })
    add({ id: 'page-stats', label: 'Stats', description: 'Playtime, streaks and activity heatmap', group: 'Pages', icon: <BarChart3 />, run: () => navigate('stats') })
    add({ id: 'page-worlds', label: 'Worlds & backups', description: 'Worlds, backups and datapacks', group: 'Pages', icon: <Globe2 />, run: () => navigate('worlds') })
    add({ id: 'page-screenshots', label: 'Screenshots', description: 'Gallery, lightbox and dashboard backgrounds', group: 'Pages', icon: <ImageIcon />, run: () => navigate('screenshots') })
    add({ id: 'page-servers', label: 'Servers', description: 'Saved servers and status', group: 'Pages', icon: <Server />, run: () => navigate('servers') })
    add({ id: 'page-mods', label: 'Extra content', description: 'Mods, resource packs, shaders and datapacks', group: 'Pages', icon: <Package />, run: () => navigate('mods', { contentType: 'mod' }) })
    add({ id: 'page-account', label: 'Account', description: 'Player profiles and Microsoft account', group: 'Pages', icon: <UserRound />, run: () => navigate('account') })
    add({ id: 'page-logs', label: 'Logs & diagnostics', description: 'Game logs, crashes and diagnostics', group: 'Pages', icon: <ScrollText />, run: () => navigate('logs') })
    add({ id: 'page-docs', label: 'Roadmap & docs', description: 'README and launcher roadmap', group: 'Pages', icon: <Map />, run: () => navigate('docs') })
    add({ id: 'page-settings', label: 'Settings', description: 'Appearance, Java, memory and more', group: 'Pages', icon: <Settings />, run: () => navigate('settings') })

    add({ id: 'new-installation', label: 'New installation', description: 'Create a Minecraft profile', group: 'Commands', icon: <Plus />, hint: 'Open dialog', run: () => openInstallDialog({ mode: 'create' }) })
    add({ id: 'install-version', label: 'Install a version', description: 'Choose a Minecraft version and create a profile', group: 'Commands', icon: <Plus />, hint: 'Open dialog', run: () => openInstallDialog({ mode: 'create' }) })
    add({ id: 'open-downloads', label: 'Downloads & tasks', description: 'Active downloads, builds and scans', group: 'Commands', icon: <Download />, run: () => navigate('tasks') })
    add({ id: 'open-data-folder', label: 'Open launcher data folder', description: 'Config, cache and logs', group: 'Commands', icon: <FolderOpen />, run: () => void api.system.openFolder('data') })
    if (selectedInstallation) {
      add({ id: 'open-game-folder', label: 'Open game folder', description: selectedInstallation.name, group: 'Commands', icon: <FolderOpen />, run: () => openInstallationFolder(selectedInstallation.id) })
      add({ id: 'check-updates', label: 'Check content updates', description: `Check mods installed in ${selectedInstallation.name}`, group: 'Commands', icon: <RefreshCw />, run: () => navigate('mods', { contentType: 'mod', action: 'check-updates' }) })
    }
    add({ id: 'add-profile', label: 'Add player profile', description: 'Microsoft account', group: 'Commands', icon: <UserRound />, run: () => openAuth() })

    if (settings) {
      for (const [id, label] of SETTINGS_SECTIONS) {
        add({
          id: `settings-${id}`,
          label: `Settings: ${label}`,
          description: 'Open this settings section',
          group: 'Settings',
          icon: <Settings />,
          run: () => navigate('settings', { section: id }),
        })
      }

      const toggles: Array<{
        id: string
        label: string
        description: string
        enabled: boolean
        patch: Partial<SettingsShape>
      }> = [
        { id: 'toggle-reduce-motion', label: 'Reduce motion', description: 'Disable interface animation', enabled: settings.reduceMotion, patch: { reduceMotion: !settings.reduceMotion } },
        { id: 'toggle-high-contrast', label: 'High contrast', description: 'Stronger text, borders and surfaces', enabled: settings.highContrast, patch: { highContrast: !settings.highContrast } },
        { id: 'toggle-reduce-transparency', label: 'Reduce transparency', description: 'Use opaque overlays and chrome', enabled: settings.reduceTransparency, patch: { reduceTransparency: !settings.reduceTransparency } },
        { id: 'toggle-ambient', label: 'Ambient effects', description: 'Background particles and glow', enabled: settings.ambient, patch: { ambient: !settings.ambient } },
        { id: 'toggle-rounded', label: 'Rounded corners', description: 'Soft corners across the launcher', enabled: settings.roundedCorners, patch: { roundedCorners: !settings.roundedCorners } },
        ...(data?.app.portable ? [] : [{ id: 'toggle-launch-at-login', label: 'Launch at login', description: 'Start Aqua with Windows', enabled: settings.startup.launchAtLogin, patch: { startup: { ...settings.startup, launchAtLogin: !settings.startup.launchAtLogin } } }]),
        { id: 'toggle-reopen-on-exit', label: 'Reopen after game exit', description: 'Bring Aqua back when Minecraft closes', enabled: settings.startup.reopenOnGameExit, patch: { startup: { ...settings.startup, reopenOnGameExit: !settings.startup.reopenOnGameExit } } },
        { id: 'toggle-backup-on-exit', label: 'Back up worlds after play', description: 'Automatic backup when a session ends', enabled: settings.backups.onExit, patch: { backups: { ...settings.backups, onExit: !settings.backups.onExit } } },
        { id: 'toggle-daily-backups', label: 'Daily world backups', description: 'Run automatic backups once a day', enabled: settings.backups.daily, patch: { backups: { ...settings.backups, daily: !settings.backups.daily } } },
        { id: 'toggle-minecraft-settings', label: 'Sync Minecraft settings', description: 'Share options, controls and servers across profiles', enabled: settings.minecraftSettings.sync, patch: { minecraftSettings: { ...settings.minecraftSettings, sync: !settings.minecraftSettings.sync } } },
      ]
      for (const toggle of toggles) {
        add({
          id: toggle.id,
          label: toggle.label,
          description: `${toggle.enabled ? 'On' : 'Off'} · ${toggle.description}`,
          group: 'Settings',
          icon: <Settings />,
          hint: toggle.enabled ? 'On' : 'Off',
          keywords: ['toggle', 'setting', toggle.label],
          run: () => toggleSetting(toggle.label, !toggle.enabled, toggle.patch),
        })
      }
    }

    for (const installation of installations) {
      const loader = installation.loader?.type || 'vanilla'
      const details = `${installation.versionId} · ${loader} · ${installation.name}`
      add({ id: `launch-${installation.id}`, label: `Launch ${installation.name}`, description: details, group: 'Installations', icon: <Play />, hint: 'Play', keywords: ['play', installation.versionId, loader], run: () => play(installation.id) })
      add({ id: `safe-${installation.id}`, label: `Launch ${installation.name} in Safe Mode`, description: 'Start without mods, resource packs or shaders', group: 'Installations', icon: <ShieldCheck />, keywords: ['safe mode', installation.versionId], run: () => launchGame(installation.id, { safeMode: true }) })
      add({ id: `folder-${installation.id}`, label: `Open ${installation.name} folder`, description: 'Game directory, mods and screenshots', group: 'Installations', icon: <FolderOpen />, run: () => openInstallationFolder(installation.id) })
      add({ id: `verify-${installation.id}`, label: `Verify ${installation.name} files`, description: 'Download missing or damaged game files', group: 'Installations', icon: <RefreshCw />, run: () => installGame(installation.id) })
    }

    for (const world of worlds) {
      add({
        id: `world-${world.installationId}-${world.folder}`,
        label: world.name,
        description: `${world.installationName} · ${world.gameMode}${world.versionName ? ` · ${world.versionName}` : ''}`,
        group: 'Worlds',
        icon: <Globe2 />,
        hint: 'Open',
        keywords: [world.folder, world.installationName, world.gameMode, 'world'],
        run: async () => {
          if (selectedInstallation?.id !== world.installationId) await setActiveInstallation(world.installationId)
          navigate('worlds')
        },
      })
    }

    for (const server of servers) {
      add({
        id: `server-${server.id}`,
        label: server.name,
        description: `${server.address} · ${server.edition === 'bedrock' ? 'Bedrock' : 'Java'}`,
        group: 'Servers',
        icon: <Server />,
        hint: 'Join',
        keywords: [server.address, server.edition, 'join'],
        run: () =>
          joinServer(server.id, server.connectAddress || server.address, server.edition, {
            installationId: server.installationId,
            serverName: server.name,
          }),
      })
    }

    for (const mod of content) {
      add({
        id: `content-${mod.filename}`,
        label: mod.title || mod.filename,
        description: `${selectedInstallation?.name || 'Selected profile'} · ${mod.filename}`,
        group: 'Content',
        icon: <Package />,
        hint: 'Browse',
        keywords: [mod.filename, mod.versionNumber || '', 'mod'],
        run: () => navigate('mods', { contentType: 'mod' }),
      })
    }

    for (const account of accounts?.accounts ?? []) {
      add({
        id: `account-${account.id}`,
        label: account.name,
        description: account.id === activeAccount?.id ? 'Current player profile' : 'Switch player profile',
        group: 'Accounts',
        icon: <UserRound />,
        hint: account.id === activeAccount?.id ? 'Current' : 'Switch',
        run: async () => {
          if (account.id !== activeAccount?.id) await switchAccount(account.id)
          navigate('account')
        },
      })
    }

    return items
  }, [
    accounts,
    activeAccount,
    content,
    installations,
    installGame,
    joinServer,
    launchGame,
    navigate,
    openAuth,
    openInstallationFolder,
    openInstallDialog,
    play,
    selectedInstallation,
    servers,
    setActiveInstallation,
    settings,
    switchAccount,
    toggleSetting,
    worlds,
  ])

  const displayGroups = useMemo<DisplayGroup[]>(() => {
    if (query.trim()) {
      return searchCommandGroups(commands, query, 80).map((group) => ({ title: groupTitle(group.group), items: group.items }))
    }
    const recentItems = recentIds
      .map((id) => commands.find((command) => command.id === id))
      .filter((command): command is PaletteCommand => Boolean(command))
    const recentIdsSet = new Set(recentItems.map((command) => command.id))
    const defaults = commands.filter(
      (command) =>
        !recentIdsSet.has(command.id) &&
        (command.group === 'Pages' || command.id === 'new-installation' || command.id === 'open-downloads' || command.id === 'check-updates'),
    )
    const groups: DisplayGroup[] = []
    if (recentItems.length) groups.push({ title: 'Recent', items: recentItems })
    groups.push(...groupCommands(defaults).map((group) => ({ title: groupTitle(group.group), items: group.items })))
    return groups
  }, [commands, query, recentIds])

  const flatResults = useMemo(() => displayGroups.flatMap((group) => group.items), [displayGroups])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (activeIndex >= flatResults.length) setActiveIndex(Math.max(0, flatResults.length - 1))
  }, [activeIndex, flatResults.length])

  useEffect(() => {
    resultsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const execute = useCallback(
    (command: PaletteCommand | undefined) => {
      if (!command) return
      close()
      remember(command.id)
      void Promise.resolve(command.run()).catch((error) => {
        pushToast({ level: 'error', title: 'Command failed', message: getErrorMessage(error) })
      })
    },
    [close, pushToast, remember],
  )

  const move = (delta: number) => {
    if (!flatResults.length) return
    setActiveIndex((current) => (current + delta + flatResults.length) % flatResults.length)
  }

  let rowIndex = 0
  const indexingNow = indexing.worlds || indexing.servers || indexing.content

  return (
    <Modal
      open={open}
      onClose={close}
      title="Search Aqua"
      className="command-palette"
      footer={
        <div className="command-palette__footer">
          <span>{indexingNow ? <><Spinner /> Indexing worlds and content…</> : `${flatResults.length} result${flatResults.length === 1 ? '' : 's'}`}</span>
          <span className="command-palette__keys">
            <kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>Enter</kbd> Open <kbd>Esc</kbd> Close
          </span>
        </div>
      }
    >
      <div className="command-palette__search">
        <Search />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              execute(flatResults[activeIndex])
            }
          }}
          role="combobox"
          aria-label="Search Aqua"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={flatResults.length ? `command-option-${activeIndex}` : undefined}
          placeholder="Search pages, installations, worlds, servers, settings…"
        />
      </div>
      <div className="command-palette__results" id="command-palette-results" role="listbox" ref={resultsRef}>
        {displayGroups.length === 0 ? (
          <div className="command-palette__empty">No matches for “{query}”. Try a page, world, server or setting.</div>
        ) : (
          displayGroups.map((group) => (
            <section className="command-palette__group" key={group.title}>
              <div className="command-palette__group-title">{group.title}</div>
              {group.items.map((command) => {
                const index = rowIndex++
                const active = index === activeIndex
                return (
                  <button
                    key={command.id}
                    id={`command-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cx('command-palette__item', active && 'is-active')}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => execute(command)}
                  >
                    <span className="command-palette__icon">{command.icon}</span>
                    <span className="command-palette__copy">
                      <strong>{command.label}</strong>
                      {command.description ? <small>{command.description}</small> : null}
                    </span>
                    {command.hint ? <span className="command-palette__hint">{command.hint}</span> : null}
                  </button>
                )
              })}
            </section>
          ))
        )}
      </div>
    </Modal>
  )
}