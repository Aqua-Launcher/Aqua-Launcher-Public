import { useEffect, useRef } from 'react'
import { useLauncher } from './state/LauncherProvider'
import { Titlebar } from './components/layout/Titlebar'
import { Sidebar } from './components/layout/Sidebar'
import { BootScreen } from './components/layout/BootScreen'
import { LaunchErrorDialog } from './components/layout/LaunchErrorDialog'
import { InstallationDialog } from './components/dialogs/InstallationDialog'
import { SetupWizard } from './components/dialogs/SetupWizard'
import { AuthModal } from './components/dialogs/AuthModal'
import { ToastHost } from './components/ui/overlays'
import { HomePage } from './pages/HomePage'
import { InstallationsPage } from './pages/InstallationsPage'
import { TasksPage } from './pages/TasksPage'
import { WorldsPage } from './pages/WorldsPage'
import { ServersPage } from './pages/ServersPage'
import { ModsPage } from './pages/ModsPage'
import { AccountPage } from './pages/AccountPage'
import { LogsPage } from './pages/LogsPage'
import { DocsPage } from './pages/DocsPage'
import { SettingsPage } from './pages/SettingsPage'

function Page() {
  const { route } = useLauncher()
  switch (route.page) {
    case 'installations':
      return <InstallationsPage />
    case 'tasks':
      return <TasksPage />
    case 'worlds':
      return <WorldsPage />
    case 'servers':
      return <ServersPage />
    case 'mods':
      return <ModsPage />
    case 'account':
      return <AccountPage />
    case 'logs':
      return <LogsPage />
    case 'docs':
      return <DocsPage />
    case 'settings':
      return <SettingsPage />
    case 'home':
    default:
      return <HomePage />
  }
}

export default function App() {
  const { data, loading, bootError, retryBoot, route, toasts, dismissToast } = useLauncher()
  const mainRef = useRef<HTMLElement>(null)
  const routeKey = `${route.page}:${route.params?.category ?? ''}:${route.params?.installationId ?? ''}:${
    route.params?.file ?? ''
  }:${route.params?.contentType ?? ''}`

  useEffect(() => {
    if (!data) return
    const labels: Record<string, string> = {
      home: 'Home',
      installations: 'Installations',
      tasks: 'Tasks',
      worlds: 'Worlds',
      servers: 'Servers',
      mods: 'Extra content',
      account: 'Account',
      logs: 'Logs & diagnostics',
      docs: 'Roadmap & docs',
      settings: 'Settings',
    }
    document.title = `${labels[route.page]} · Aqua Launcher`
  }, [route.page, data])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [routeKey])

  if (!data) {
    return <BootScreen error={bootError} onRetry={retryBoot} />
  }

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main" ref={mainRef} aria-label="Aqua Launcher">
          <div className="app-page" key={routeKey}>
            <Page />
          </div>
        </main>
      </div>

      {loading ? (
        <div className="app-refresh-indicator" role="status" aria-live="polite">
          Refreshing…
        </div>
      ) : null}

      <InstallationDialog />
      <SetupWizard />
      <AuthModal />
      <LaunchErrorDialog />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
