import { useEffect, useRef, useState } from 'react'
import { useLauncher } from './state/LauncherProvider'
import { Titlebar } from './components/layout/Titlebar'
import { Sidebar } from './components/layout/Sidebar'
import { BootScreen } from './components/layout/BootScreen'
import { LaunchErrorDialog } from './components/layout/LaunchErrorDialog'
import { JoinWarningDialog } from './components/layout/JoinWarningDialog'
import { CrashDialog } from './components/layout/CrashDialog'
import { LinkIntentDialog } from './components/layout/LinkIntentDialog'
import { DropImportOverlay } from './components/content/DropImportOverlay'
import { CommandPalette } from './components/command/CommandPalette'
import { InstallationDialog } from './components/dialogs/InstallationDialog'
import { SetupWizard } from './components/dialogs/SetupWizard'
import { AuthModal } from './components/dialogs/AuthModal'
import { ToastHost } from './components/ui/overlays'
import { HomePage } from './pages/HomePage'
import { InstallationsPage } from './pages/InstallationsPage'
import { TasksPage } from './pages/TasksPage'
import { WorldsPage } from './pages/WorldsPage'
import { ScreenshotsPage } from './pages/ScreenshotsPage'
import { ServersPage } from './pages/ServersPage'
import { StatsPage } from './pages/StatsPage'
import { ModsPage } from './pages/ModsPage'
import { AccountPage } from './pages/AccountPage'
import { LogsPage } from './pages/LogsPage'
import { DocsPage } from './pages/DocsPage'
import { SettingsPage } from './pages/SettingsPage'

const PAGE_LABELS: Record<string, string> = {
  home: 'Home',
  installations: 'Installations',
  tasks: 'Tasks',
  worlds: 'Worlds',
  screenshots: 'Screenshots',
  servers: 'Servers',
  stats: 'Stats',
  mods: 'Extra content',
  account: 'Account',
  logs: 'Logs & diagnostics',
  docs: 'Roadmap & docs',
  settings: 'Settings',
}

function Page() {
  const { route } = useLauncher()
  switch (route.page) {
    case 'installations':
      return <InstallationsPage />
    case 'tasks':
      return <TasksPage />
    case 'worlds':
      return <WorldsPage />
    case 'screenshots':
      return <ScreenshotsPage />
    case 'servers':
      return <ServersPage />
    case 'stats':
      return <StatsPage />
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
  const { data, loading, bootError, retryBoot, route, toasts, dismissToast, jobs } = useLauncher()
  const mainRef = useRef<HTMLElement>(null)
  const previousJobStates = useRef(new Map<string, string>())
  const [pageAnnouncement, setPageAnnouncement] = useState('')
  const [jobAnnouncement, setJobAnnouncement] = useState('')
  const booted = Boolean(data)
  const routeKey = `${route.page}:${route.params?.category ?? ''}:${route.params?.installationId ?? ''}:${
    route.params?.file ?? ''
  }:${route.params?.contentType ?? ''}:${route.params?.section ?? ''}:${route.params?.action ?? ''}`

  useEffect(() => {
    if (!booted) return
    const label = PAGE_LABELS[route.page] || 'Home'
    document.title = `${label} · Aqua Launcher`
    setPageAnnouncement(`${label} page`)
  }, [booted, route.page])

  useEffect(() => {
    if (!booted) return
    const previous = previousJobStates.current
    const finished: string[] = []
    for (const job of jobs) {
      const before = previous.get(job.id)
      if (before && before !== job.status && ['completed', 'failed', 'cancelled'].includes(job.status)) {
        finished.push(`${job.title} ${job.status}`)
      }
    }
    previousJobStates.current = new Map(jobs.map((job) => [job.id, job.status]))
    if (finished.length) setJobAnnouncement(finished.join('. '))
  }, [booted, jobs])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [routeKey])

  if (!data) {
    return <BootScreen error={bootError} onRetry={retryBoot} />
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main" id="main-content" ref={mainRef} tabIndex={-1} aria-label="Aqua Launcher">
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

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {pageAnnouncement}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {jobAnnouncement}
      </div>

      <InstallationDialog />
      <SetupWizard />
      <AuthModal />
      <LaunchErrorDialog />
      <JoinWarningDialog />
      <CrashDialog />
      <LinkIntentDialog />
      <DropImportOverlay />
      <CommandPalette />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
