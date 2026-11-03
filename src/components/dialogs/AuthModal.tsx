import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import { Button, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

/**
 * Account sign-in. The Azure application credential lives in the main process
 * (private/microsoft.json), so opening this dialog is the only step: it starts
 * Microsoft's OAuth window immediately and there is nothing to configure here.
 */
export function AuthModal() {
  const { authOpen, closeAuth, auth, authPhase, beginAuth, cancelAuth, accounts } = useLauncher()
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const started = useRef(false)

  const waiting = authPhase === 'waiting'
  const finalizing = authPhase === 'finalizing'
  const success = authPhase === 'success'

  useEffect(() => {
    if (!authOpen) {
      started.current = false
      return
    }
    if (started.current) return
    started.current = true
    setError(null)
    setStarting(true)
    void beginAuth()
      .catch((startError) => setError(getErrorMessage(startError)))
      .finally(() => setStarting(false))
  }, [authOpen, beginAuth])

  const handleRetry = async () => {
    setError(null)
    setStarting(true)
    try {
      await beginAuth()
    } catch (startError) {
      setError(getErrorMessage(startError))
    } finally {
      setStarting(false)
    }
  }

  const handleClose = () => {
    if (waiting || finalizing) {
      void cancelAuth()
    } else {
      closeAuth()
    }
  }

  const title = success ? 'You’re signed in' : 'Connect your Microsoft account'
  const subtitle = success
    ? 'Your Minecraft profile is ready.'
    : 'Aqua opens Microsoft’s official sign-in window. Your password is never seen by the launcher.'

  const footer = success ? (
    <Button variant="primary" onClick={closeAuth}>
      Continue
    </Button>
  ) : waiting || finalizing ? (
    <>
      <Button variant="ghost" onClick={() => void cancelAuth()}>
        Cancel sign-in
      </Button>
      {auth.url ? (
        <Button
          icon={<ExternalLink />}
          onClick={() =>
            void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))
          }
        >
          Open browser
        </Button>
      ) : null}
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={handleClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => void handleRetry()} loading={starting} icon={<KeyRound />}>
        {error || authPhase === 'error' ? 'Try again' : 'Open sign-in window'}
      </Button>
    </>
  )

  return (
    <Modal
      open={authOpen}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      size="sm"
      footer={footer}
    >
      {success ? (
        <div className="auth-success">
          <span className="auth-success__icon">
            <CheckCircle2 />
          </span>
          <div>
            <h3>{auth.message || 'Microsoft account connected'}</h3>
            <p>You can now launch Minecraft and keep your session securely on this device.</p>
          </div>
        </div>
      ) : waiting || finalizing ? (
        <div className="auth-waiting">
          <div className="auth-waiting__visual">
            <span className="auth-waiting__ring" />
            <span className="auth-waiting__ring auth-waiting__ring--delay" />
            <Spinner size="lg" />
          </div>
          <h3>{finalizing ? 'Finishing your session' : 'Waiting for Microsoft'}</h3>
          <p>
            {finalizing
              ? 'We’re linking your Xbox and Minecraft profiles. This only takes a moment.'
              : 'Finish signing in in the browser window. It may be behind other windows.'}
          </p>
          {auth.url ? (
            <Button
              size="sm"
              icon={<ExternalLink />}
              onClick={() =>
                void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))
              }
            >
              Reopen sign-in page
            </Button>
          ) : null}
          <span className="auth-note">
            <LockKeyhole /> Never enter your password into this launcher.
          </span>
          {error ? (
            <div className="callout callout--danger">
              <TriangleAlert /> {error}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="auth-intro">
          <div className="auth-intro__mark">
            <ShieldCheck />
          </div>
          <h3>Sign in with the account that owns Minecraft</h3>
          <p>
            Aqua uses Microsoft’s official OAuth flow in your system browser, loads your player name and skin, and
            stores only an encrypted refresh token
            {accounts?.secureStorageAvailable ? ` using ${accounts.storageLabel}` : ''}. You can add more accounts and
            switch between them.
          </p>
          {error || authPhase === 'error' ? (
            <div className="callout callout--danger" role="alert">
              <TriangleAlert />
              <span>{error || auth.message || 'Microsoft sign-in did not complete.'}</span>
            </div>
          ) : null}
          {!accounts?.secureStorageAvailable ? (
            <div className="callout callout--warning">
              <TriangleAlert />
              <span>
                Secure credential storage is unavailable on this system. You can sign in, but the session will only
                last until the launcher closes.
              </span>
            </div>
          ) : null}
          {starting ? (
            <span className="auth-note">
              <Spinner /> Opening Microsoft sign-in…
            </span>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
