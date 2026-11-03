import { Fragment, useState } from 'react'
import {
  BarChart3,
  ChevronRight,
  Download,
  Gamepad2,
  Globe2,
  Home,
  Image as ImageIcon,
  Layers,
  Map,
  Package,
  ScrollText,
  Server,
  Settings,
  UserRound,
} from 'lucide-react'
import { CONTENT_TYPES } from '../../lib/contentTypes'
import { useLauncher } from '../../state/LauncherProvider'
import { useNow } from '../../lib/hooks'
import { elapsedSince } from '../../lib/format'
import { Avatar, cx } from '../ui/primitives'
import { AquaWordmark } from '../brand/Brand'
import type { PageName } from '../../lib/types'

const NAV_ITEMS: Array<{ page: PageName; label: string; icon: typeof Home }> = [
  { page: 'home', label: 'Home', icon: Home },
  { page: 'installations', label: 'Installations', icon: Layers },
  { page: 'stats', label: 'Stats', icon: BarChart3 },
  { page: 'worlds', label: 'Worlds & backups', icon: Globe2 },
  { page: 'screenshots', label: 'Screenshots', icon: ImageIcon },
  { page: 'servers', label: 'Servers', icon: Server },
  { page: 'mods', label: 'Extra content', icon: Package },
  { page: 'account', label: 'Account', icon: UserRound },
  { page: 'logs', label: 'Logs & diagnostics', icon: ScrollText },
  { page: 'docs', label: 'Roadmap & docs', icon: Map },
  { page: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const {
    route,
    navigate,
    activeAccount,
    activeJobs,
    game,
    openAuth,
    data,
  } = useLauncher()
  const [modsMenuOpen, setModsMenuOpen] = useState(false)
  const activeContentType = route.params?.contentType ?? 'mod'
  const gameActive = game.status === 'running' || game.status === 'preparing'
  useNow(gameActive)

  const handleAccount = () => {
    if (activeAccount) navigate('account')
    else openAuth()
  }

  // The Extra content entry doubles as the Modrinth content-type picker.
  const handleModsNav = () => {
    if (route.page !== 'mods') {
      navigate('mods', { contentType: activeContentType })
      setModsMenuOpen(true)
      return
    }
    setModsMenuOpen((open) => !open)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <AquaWordmark />
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = route.page === item.page
          const isMods = item.page === 'mods'
          return (
            <Fragment key={item.page}>
              <button
                type="button"
                className={cx('sidebar__nav-item', isActive && 'is-active')}
                onClick={
                  isMods
                    ? handleModsNav
                    : () => {
                        setModsMenuOpen(false)
                        navigate(item.page)
                      }
                }
                aria-current={isActive ? 'page' : undefined}
                aria-expanded={isMods ? modsMenuOpen : undefined}
                aria-haspopup={isMods ? 'menu' : undefined}
                title={item.label}
              >
                <Icon strokeWidth={isActive ? 2.1 : 1.8} />
                <span className="sidebar__nav-text">{item.label}</span>
              </button>
              {isMods && modsMenuOpen ? (
                <div className="sidebar__subnav" role="menu" aria-label="Modrinth content">
                  {CONTENT_TYPES.map((option) => {
                    const OptionIcon = option.icon
                    const optionActive = option.id === activeContentType
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={optionActive}
                        className={cx('sidebar__subnav-item', optionActive && 'is-active')}
                        onClick={() => navigate('mods', { contentType: option.id })}
                      >
                        <OptionIcon strokeWidth={optionActive ? 2.1 : 1.8} />
                        <span className="sidebar__nav-text">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </nav>

      <div className="sidebar__spacer" />

      <div className="sidebar__footer">
        {gameActive ? (
          <button
            type="button"
            className={cx('sidebar__status', game.status === 'running' && 'is-live')}
            onClick={() => navigate(game.status === 'running' ? 'logs' : 'home', game.status === 'running' ? { category: 'game', installationId: game.installationId } : undefined)}
          >
            <span className="sidebar__status-icon">
              <Gamepad2 />
            </span>
            <span className="sidebar__status-copy">
              <span className="sidebar__status-title">
                {game.status === 'running'
                  ? game.safeMode?.active
                    ? 'Minecraft is running · Safe Mode'
                    : 'Minecraft is running'
                  : game.phase || 'Preparing launch'}
              </span>
              <span className="sidebar__status-meta">
                {game.status === 'running' ? elapsedSince(game.startedAt) : 'Please wait…'}
              </span>
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className={cx('sidebar__tasks', route.page === 'tasks' && 'is-open')}
          onClick={() => navigate('tasks')}
          aria-current={route.page === 'tasks' ? 'page' : undefined}
          title="Tasks"
        >
          <span className="sidebar__tasks-icon">
            <Download />
          </span>
          <span className="sidebar__tasks-copy">
            <span className="sidebar__tasks-title">Tasks</span>
            <span className="sidebar__tasks-meta">
              {activeJobs.length > 0
                ? `${activeJobs.length} running`
                : 'Downloads, builds and scans'}
            </span>
          </span>
          <ChevronRight size={14} className="sidebar__chevron" />
        </button>

        <button type="button" className="sidebar__account" onClick={handleAccount} aria-label={activeAccount ? 'Open account' : 'Sign in with Microsoft'}>
          <Avatar name={activeAccount?.name} src={activeAccount?.avatarDataUrl} size="md" />
          <span className="sidebar__account-copy">
            <span className="sidebar__account-name">{activeAccount?.name || 'Add profile'}</span>
            <span className="sidebar__account-meta">
              {activeAccount
                ? activeAccount.sessionExpired
                  ? 'Session expired'
                  : 'Microsoft account'
                : 'Sign in with Microsoft'}
            </span>
          </span>
          <ChevronRight size={14} className="sidebar__chevron" />
        </button>
        <div className="sidebar__build">Aqua {data?.app.version ? `v${data.app.version}` : ''}</div>
      </div>
    </aside>
  )
}
