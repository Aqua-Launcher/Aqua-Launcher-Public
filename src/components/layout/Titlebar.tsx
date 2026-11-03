import { Minus, Search, X } from 'lucide-react'
import { api } from '../../lib/api'
import { openCommandPalette } from '../command/CommandPalette'
import { useLauncher } from '../../state/LauncherProvider'
import { AppIcon } from '../brand/Brand'
import { NotificationCenter } from './NotificationCenter'

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2.2" y="0.8" width="7" height="7" rx="0.7" stroke="currentColor" strokeWidth="1" />
      <path d="M0.8 3.2V8.5C0.8 8.9 1.1 9.2 1.5 9.2H6.8" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export function Titlebar() {
  const { data, navigate, windowMaximized } = useLauncher()
  const toggleMaximize = () => {
    void api.windowControls.toggleMaximize()
  }

  return (
    <header className="titlebar">
      <div className="titlebar__brand no-drag">
        <button type="button" className="titlebar__brand-btn" onClick={() => navigate('home')} aria-label="Go to home">
          <AppIcon size={18} />
          <span className="titlebar__name">Aqua</span>
          <span className="titlebar__divider">/</span>
          <span className="titlebar__product">Launcher</span>
        </button>
      </div>
      <div className="titlebar__drag" onDoubleClick={toggleMaximize} aria-hidden="true" />
      <div className="titlebar__meta no-drag">
        <button
          type="button"
          className="titlebar__search"
          onClick={openCommandPalette}
          aria-label="Search Aqua (Ctrl+K)"
          title="Search Aqua (Ctrl+K)"
        >
          <Search size={12} strokeWidth={1.9} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <NotificationCenter />
        <span className="titlebar__version">v{data?.app.version || '1.0.0'}</span>
      </div>
      <div className="titlebar__controls no-drag">
        <button
          type="button"
          className="titlebar__control"
          onClick={() => void api.windowControls.minimize()}
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="titlebar__control"
          onClick={toggleMaximize}
          aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
          title={windowMaximized ? 'Restore' : 'Maximize'}
        >
          {windowMaximized ? <RestoreIcon /> : <span className="titlebar__square" />}
        </button>
        <button
          type="button"
          className="titlebar__control titlebar__control--close"
          onClick={() => void api.windowControls.close()}
          aria-label="Close launcher"
          title="Close"
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}
