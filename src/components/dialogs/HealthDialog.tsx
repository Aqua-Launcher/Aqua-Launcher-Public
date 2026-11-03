import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FolderOpen,
  RefreshCw,
  Settings,
  Stethoscope,
  Wrench,
  XCircle,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { HealthCheck, HealthResult, Installation } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const STATUS_ORDER = { error: 0, warn: 1, unknown: 2, ok: 3 }

function statusIcon(status: HealthCheck['status']) {
  if (status === 'error') return <XCircle />
  if (status === 'warn') return <AlertTriangle />
  if (status === 'ok') return <CheckCircle2 />
  return <CircleHelp />
}

function statusTone(status: HealthStatus) {
  if (status === 'error') return 'danger' as const
  if (status === 'warn') return 'warning' as const
  if (status === 'ok') return 'success' as const
  return 'default' as const
}

type HealthStatus = HealthCheck['status']

export function HealthDialog({ installation, onClose }: { installation: Installation; onClose: () => void }) {
  const { installGame, navigate, pushToast } = useLauncher()
  const [result, setResult] = useState<HealthResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await api.health.check(installation.id))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [installation.id])

  useEffect(() => {
    void load()
  }, [load])

  const applyFix = async (check: HealthCheck) => {
    if (!check.fix) return
    const kind = check.fix.kind
    if (kind === 'reinstall') {
      await installGame(installation.id)
      onClose()
      return
    }
    if (kind === 'open-settings') {
      navigate('settings')
      onClose()
      return
    }
    setFixing(check.id)
    try {
      await api.health.fix(installation.id, kind)
      if (kind === 'create-directory') await load()
      else pushToast({ level: 'info', title: 'Opened folder' })
    } catch (fixError) {
      pushToast({ level: 'error', title: 'Could not apply that fix', message: getErrorMessage(fixError) })
    } finally {
      setFixing(null)
    }
  }

  const checks = result ? [...result.checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) : []

  return (
    <Modal
      open
      onClose={onClose}
      title={`Health · ${installation.name}`}
      subtitle={`Minecraft ${installation.versionId} · checks never modify or delete game files`}
      size="wide"
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RefreshCw />}
            className="modal__footer-left"
            onClick={() => void load()}
            disabled={loading}
          >
            Recheck
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {loading && !result ? (
        <div className="health-loading">
          <Spinner /> Checking game files, Java, memory and mods…
        </div>
      ) : null}

      {error ? (
        <div className="callout callout--danger" role="alert">
          <AlertTriangle />
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="health-dialog">
          <div className="health-summary">
            <span className={`health-summary__icon is-${result.status}`}>{statusIcon(result.status)}</span>
            <div>
              <strong>
                {result.status === 'ok'
                  ? 'Everything looks healthy'
                  : result.status === 'error'
                    ? 'This installation needs attention'
                    : result.status === 'warn'
                      ? 'A few things are worth checking'
                      : 'Some checks could not run'}
              </strong>
              <span>
                {result.checks.filter((entry) => entry.status === 'ok').length} of {result.checks.length} checks passed
              </span>
            </div>
            <Badge tone={statusTone(result.status)}>{result.status}</Badge>
          </div>

          <div className="health-list">
            {checks.map((check) => (
              <div key={`${check.id}-${check.title}`} className={`health-row is-${check.status}`}>
                <span className="health-row__icon">{statusIcon(check.status)}</span>
                <div className="health-row__copy">
                  <strong>{check.title}</strong>
                  <span>{check.detail}</span>
                </div>
                {check.fix ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={
                      check.fix.kind === 'reinstall' ? (
                        <Wrench />
                      ) : check.fix.kind === 'open-settings' ? (
                        <Settings />
                      ) : check.fix.kind === 'open-content' ? (
                        <Stethoscope />
                      ) : (
                        <FolderOpen />
                      )
                    }
                    loading={fixing === check.id}
                    onClick={() => void applyFix(check)}
                  >
                    {check.fix.label}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
