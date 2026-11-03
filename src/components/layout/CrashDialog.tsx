import { useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, Package, Play, Settings, ShieldOff, Wrench } from 'lucide-react'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

/**
 * A crash is not a toast. This dialog explains what happened, shows the lines
 * that prove it, and offers only the safe actions the analyzer declared.
 */
export function CrashDialog() {
  const { data, navigate, installGame, launchGame, openInstallDialog } = useLauncher()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const game = data?.game
  const analysis = game?.status === 'crashed' ? game.analysis ?? null : null
  const key = game?.endedAt || null

  useEffect(() => {
    if (game?.status !== 'crashed') setDismissed(null)
  }, [game?.status])

  if (!analysis || !key || dismissed === key) return null

  const installationId = game?.installationId
  const reportName = game?.crashReportPath ? game.crashReportPath.split(/[\\/]/).pop() || null : null
  const close = () => setDismissed(key)
  const installation = installationId ? data?.installations.find((entry) => entry.id === installationId) : undefined

  const run = (id: string) => {
    close()
    if (id === 'raise-ram') {
      if (installation) openInstallDialog({ mode: 'edit', installation })
      else navigate('settings')
      return
    }
    if (id === 'open-logs') {
      if (reportName && installationId) navigate('logs', { category: 'crash', installationId, file: reportName })
      else if (installationId) navigate('logs', { category: 'game', installationId })
      else navigate('logs')
      return
    }
    if (id === 'open-content') {
      navigate('mods')
      return
    }
    if (id === 'open-settings') {
      navigate('settings')
      return
    }
    if (id === 'verify-install' && installationId) {
      void installGame(installationId)
      return
    }
    if (id === 'launch-safe') {
      if (installationId) void launchGame(installationId, { safeMode: true })
    }
  }

  const actionIcon = (id: string) => {
    if (id === 'raise-ram') return <Wrench />
    if (id === 'open-content') return <Package />
    if (id === 'launch-safe') return <ShieldOff />
    if (id === 'open-settings') return <Settings />
    if (id === 'verify-install') return <Wrench />
    if (id === 'open-logs') return <FolderOpen />
    return <Play />
  }

  const visible = analysis.actions

  return (
    <Modal
      open
      onClose={close}
      title={analysis.title}
      subtitle={`${installation?.name || game?.installationName || 'Minecraft'} · ${analysis.category.replace(/-/g, ' ')}`}
      size="md"
      footer={
        <>
          {reportName ? (
            <Button
              variant="ghost"
              icon={<FolderOpen />}
              className="modal__footer-left"
              onClick={() => run('open-logs')}
            >
              Crash report
            </Button>
          ) : null}
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      <div className="crash-guard">
        <div className="crash-guard__head">
          <span className="crash-guard__icon">
            <AlertTriangle />
          </span>
          <div>
            <p className="crash-guard__summary">{analysis.summary}</p>
            <div className="crash-guard__meta">
              <Badge tone={analysis.confidence === 'high' ? 'danger' : analysis.confidence === 'medium' ? 'warning' : 'default'}>
                {analysis.confidence} confidence
              </Badge>
              {game?.exitCode != null ? <span>Exit code {game.exitCode}</span> : null}
              {game?.signal ? <span>{game.signal}</span> : null}
            </div>
          </div>
        </div>

        {analysis.evidence.length ? (
          <div className="crash-guard__evidence">
            <span className="section-kicker">Evidence</span>
            <pre className="crash-guard__lines">
              {analysis.evidence.map((line, index) => (
                <span key={index} className="crash-guard__line">
                  {line}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        ) : null}

        {visible.length ? (
          <div className="crash-guard__actions">
            {visible.map((action) => (
              <Button key={action.id} size="sm" icon={actionIcon(action.id)} onClick={() => run(action.id)}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
