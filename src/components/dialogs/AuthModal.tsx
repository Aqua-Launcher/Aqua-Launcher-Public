import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { MICROSOFT_AUTH_ENABLED, OFFLINE_ACCOUNTS_ENABLED } from '../../lib/features'
import { useLauncher } from '../../state/LauncherProvider'
import { Button, Field, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const MICROSOFT_APPS_URL =
  'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
const MICROSOFT_DOCS_URL =
  'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'

type AuthMode = 'offline' | 'microsoft'

export function AuthModal() {
  const {
    authOpen,
    authInitialMode,
    closeAuth,
    auth,
    settings,
    saveSettings,
    beginAuth,
    signInOffline,
    cancelAuth,
    accounts,
    authPhase,
  } = useLauncher()
  const [mode, setMode] = useState<AuthMode>('microsoft')
  const [editingClientId, setEditingClientId] = useState(false)
  const [clientId, setClientId] = useState('')
  const [offlineName, setOfflineName] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offlineError, setOfflineError] = useState<string | null>(null)

  const configuredClientId = settings?.microsoftClientId || ''
  const hasClientId = Boolean(configuredClientId)
  const waiting = authPhase === 'waiting'
  const finalizing = authPhase === 'finalizing'
  const success = authPhase === 'success'

  useEffect(() => {
    if (!authOpen) return
    setMode(authInitialMode === 'offline' ? 'microsoft' : authInitialMode || 'microsoft')
    setError(null)
    setOfflineError(null)
    setClientId(configuredClientId)
    setEditingClientId(!configuredClientId)
    setStarting(false)
    setOfflineBusy(false)
    setOfflineName(accounts?.accounts.find((account) => account.type === 'offline')?.name || '')
  }, [authOpen, authInitialMode, configuredClientId, accounts])

  const handleSaveClientId = async () => {
    const value = clientId.trim()
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
      setError('Paste the Application (client) ID exactly as shown in Azure. It is a GUID.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSettings({ microsoftClientId: value })
      setEditingClientId(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async () => {
    if (!hasClientId) {
      setEditingClientId(true)
      return
    }
    setStarting(true)
    setError(null)
    try {
      await beginAuth()
    } catch (startError) {
      setError(getErrorMessage(startError))
    } finally {
      setStarting(false)
    }
  }

  const handleOffline = async () => {
    const name = offlineName.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setOfflineError('Use 3–16 letters, numbers, or underscores for your username.')
      return
    }
    setOfflineBusy(true)
    setOfflineError(null)
    try {
      await signInOffline(name)
      closeAuth()
    } catch (offlineSignInError) {
      setOfflineError(getErrorMessage(offlineSignInError))
    } finally {
      setOfflineBusy(false)
    }
  }

  const handleClose = () => {
    if (waiting || finalizing) {
      void cancelAuth()
    } else {
      closeAuth()
    }
  }

  const handleRetry = () => {
    setError(null)
    if (authPhase === 'error') {
      setEditingClientId(false)
    }
    void handleStart()
  }

  const title = success
    ? 'You’re signed in'
    : mode === 'offline'
      ? 'Add an offline profile'
      : 'Connect your Microsoft account'
  const subtitle = success
    ? 'Your Minecraft profile is ready.'
    : mode === 'offline'
      ? 'For singleplayer, LAN, and mod testing. The username and UUID stay on this device.'
      : 'Aqua uses Microsoft’s official OAuth flow. Your password is never seen by the launcher.'

  const microsoftFooter = success ? (
    <Button variant="primary" onClick={closeAuth}>
      Continue
    </Button>
  ) : editingClientId ? (
    <>
      <Button variant="ghost" onClick={handleClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => void handleSaveClientId()} loading={saving}>
        Save app ID
      </Button>
    </>
  ) : waiting || finalizing ? (
    <>
      <Button variant="ghost" onClick={() => void cancelAuth()}>
        Cancel sign-in
      </Button>
      {auth.url ? (
        <Button
          icon={<ExternalLink />}
          onClick={() => void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))}
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
      <Button variant="primary" onClick={() => void handleStart()} loading={starting} icon={<KeyRound />}>
        {authPhase === 'error' ? 'Try again' : 'Continue with Microsoft'}
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
      footer={
        success || waiting || finalizing || (MICROSOFT_AUTH_ENABLED && mode === 'microsoft') ? (
          microsoftFooter
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleOffline()}
              loading={offlineBusy}
              icon={<UserRound />}
            >
              Create offline profile
            </Button>
          </>
        )
      }
    >
      {OFFLINE_ACCOUNTS_ENABLED && !success && !waiting && !finalizing ? (
        <div className="auth-methods" role="tablist" aria-label="Account type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'offline'}
            className={mode === 'offline' ? 'is-active' : undefined}
            onClick={() => setMode('offline')}
          >
            <UserRound />
            <span>
              <strong>Offline profile</strong>
              <small>No Microsoft account</small>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'microsoft'}
            className={mode === 'microsoft' ? 'is-active' : undefined}
            onClick={() => setMode('microsoft')}
          >
            <KeyRound />
            <span>
              <strong>Microsoft</strong>
              <small>Online play & ownership</small>
            </span>
          </button>
        </div>
      ) : null}

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
      ) : mode === 'offline' ? (
        <div className="auth-intro auth-intro--offline">
          <div className="auth-intro__mark">
            <WifiOff />
          </div>
          <h3>Play with a local username</h3>
          <p>
            Offline profiles launch Minecraft with a local username. Use one for singleplayer, LAN worlds, or mod
            testing. The username and a generated player UUID stay on this device.
          </p>
          <div className="callout callout--warning auth-offline-note">
            <TriangleAlert />
            <span>
              Offline mode does not prove account ownership. Online-mode servers will reject this profile. Use a
              username you own, never someone else’s.
            </span>
          </div>
          <Field
            label="Username"
            htmlFor="offline-username"
            hint="3–16 characters. Letters, numbers, and underscores only."
            error={offlineError}
          >
            <input
              id="offline-username"
              className="input input--mono"
              value={offlineName}
              maxLength={16}
              onChange={(event) => {
                setOfflineName(event.target.value)
                setOfflineError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleOffline()
              }}
              placeholder="Steve"
              spellCheck={false}
              autoComplete="off"
              data-autofocus
            />
          </Field>
          <div className="auth-offline-meta">
            <span>
              <LockKeyhole /> No credentials stored
            </span>
            <span>UUID generated offline</span>
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
              onClick={() => void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))}
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
          {editingClientId ? (
            <div className="stack gap-4">
              <div className="callout callout--info">
                <ShieldCheck />
                <div>
                  Sign-in requires your own Azure application ID. New app registrations also need to be approved by
                  Mojang before Minecraft services accept them. If yours is not approved, Minecraft services will reject the sign-in.
                </div>
              </div>

              <ol className="auth-steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Create or open an app registration</strong>
                    <p>
                      In the Azure portal, add an app and copy its <em>Application (client) ID</em>.
                    </p>
                    <div className="inline-links">
                      <button type="button" className="link-button" onClick={() => void api.openExternal(MICROSOFT_APPS_URL)}>
                        Open Azure portal <ExternalLink />
                      </button>
                      <button type="button" className="link-button" onClick={() => void api.openExternal(MICROSOFT_DOCS_URL)}>
                        Registration guide <ExternalLink />
                      </button>
                    </div>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Add a desktop redirect</strong>
                    <p>
                      Under <em>Authentication</em>, add a <em>Mobile and desktop applications</em> platform with{' '}
                      <code>http://localhost</code>, and enable <em>Allow public client flows</em>.
                    </p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Paste the application ID</strong>
                    <p>Your app must also be approved for Minecraft: Java Edition services by Mojang.</p>
                  </div>
                </li>
              </ol>

              <Field
                label="Application (client) ID"
                htmlFor="microsoft-client-id"
                hint="Stored locally in your launcher settings. It is public metadata, not a secret."
                error={error}
              >
                <input
                  id="microsoft-client-id"
                  className="input input--mono"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  spellCheck={false}
                  autoComplete="off"
                  data-autofocus
                />
              </Field>
              {hasClientId ? (
                <button type="button" className="text-button" onClick={() => setEditingClientId(false)}>
                  Keep current app ID
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="auth-intro__mark">
                <ShieldCheck />
              </div>
              <h3>What happens after sign-in</h3>
              <p>
                Use the account that owns Minecraft: Java Edition. Aqua loads your player name and skin, refreshes the
                session before each launch, and stores only an encrypted refresh
                token{accounts?.secureStorageAvailable ? ` using ${accounts.storageLabel}` : ''}. You can add more
                accounts later and switch between them.
              </p>
              <div className="callout callout--warning">
                <TriangleAlert />
                <span>
                  Microsoft now requires Minecraft API approval for third-party Azure apps. Without an approved app,
                  sign-in will not work until that approval is granted.
                </span>
              </div>
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
              <div className="auth-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setClientId(configuredClientId)
                    setEditingClientId(true)
                  }}
                >
                  Use a different Microsoft app ID
                </button>
              </div>
              {error ? (
                <button type="button" className="text-button" onClick={handleRetry}>
                  Try again
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
