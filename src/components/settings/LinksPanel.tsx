import { useEffect, useState } from 'react'
import { Link2, RefreshCw, Terminal } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { LinkStatus } from '../../lib/types'
import { Badge, Button, CopyButton, Spinner } from '../ui/primitives'

export function LinksPanel() {
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.links
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const register = async () => {
    setRegistering(true)
    setError(null)
    try {
      setStatus(await api.links.register())
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="links-panel">
      <div className="links-panel__status">
        <span className="links-panel__scheme mono">
          <Link2 /> {status?.scheme || 'aqua://'}
        </span>
        {loading ? (
          <Spinner />
        ) : (
          <Badge tone={status?.portable ? 'default' : status?.registered ? 'success' : 'warning'}>
            {status?.portable ? 'Disabled in portable mode' : status?.registered ? 'Registered with Windows' : 'Not registered'}
          </Badge>
        )}
        {!loading && !status?.portable && !status?.registered ? (
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={registering} onClick={() => void register()}>
            Register links
          </Button>
        ) : null}
      </div>

      <p className="settings-hint">
        {status?.portable
          ? 'Portable mode leaves Windows associations alone: Aqua does not register an aqua:// handler, so links from other apps are unavailable. The CLI still works from the Aqua folder; register the protocol from a non-portable copy if you need browser or Discord links.'
          : 'Deep links open Aqua and ask before launching or installing anything. The CLI accepts the same actions; pass --yes only in scripts you trust. A command sent to an already running launcher is forwarded to that window instead of starting a second copy.'}
      </p>

      {error ? (
        <div className="callout callout--danger" role="alert">
          {error}
        </div>
      ) : null}

      <ul className="links-list">
        {(status?.examples || []).map((example) => (
          <li key={example.label} className="links-list__item">
            <div className="links-list__copy">
              <strong>{example.label}</strong>
              <span>{example.description}</span>
              <code>{example.value}</code>
            </div>
            <CopyButton value={example.value} label={`Copy ${example.label}`} />
          </li>
        ))}
      </ul>

      <p className="settings-hint links-panel__note">
        <Terminal />
        <span>
          <code>aqua status --json</code> prints local profile names, versions and loader types only — never tokens,
          account secrets or file paths. Uninstalling Aqua removes the app but Windows can keep a stale <code>aqua://</code>{' '}
          entry under Default apps; reinstall or remove it there to clear it.
        </span>
      </p>
    </div>
  )
}
