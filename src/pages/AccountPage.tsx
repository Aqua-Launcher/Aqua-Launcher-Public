import { useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react'
import { getErrorMessage } from '../lib/api'
import { MICROSOFT_AUTH_ENABLED } from '../lib/features'
import { formatDateTime, relativeTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { Account } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import {
  Avatar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Spinner,
  cx,
} from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/overlays'

export function AccountPage() {
  const {
    accounts,
    activeAccount,
    settings,
    openAuth,
    switchAccount,
    refreshAccount,
    signOut,
    navigate,
  } = useLauncher()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [signOutTarget, setSignOutTarget] = useState<Account | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const allAccounts = accounts?.accounts || []
  const otherAccounts = allAccounts.filter((account) => account.id !== activeAccount?.id)
  const configured = Boolean(settings?.microsoftClientId)

  const handleSwitch = async (account: Account) => {
    setBusyId(account.id)
    try {
      await switchAccount(account.id)
    } catch {
      // The provider shows a toast with the error.
    } finally {
      setBusyId(null)
    }
  }

  const handleRefresh = async () => {
    if (!activeAccount) return
    setRefreshing(true)
    try {
      await refreshAccount(activeAccount.id)
    } catch {
      // The provider shows a toast with the error.
    } finally {
      setRefreshing(false)
    }
  }

  const handleSignOut = async () => {
    if (!signOutTarget) return
    setSigningOut(true)
    setSignOutError(null)
    try {
      await signOut(signOutTarget.id)
      setSignOutTarget(null)
    } catch (error) {
      setSignOutError(getErrorMessage(error))
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Account"
        subtitle="Sign in with Microsoft to play Minecraft: Java Edition. Sessions are encrypted by your operating system."
        actions={
          <Button variant="primary" icon={<UserPlus />} onClick={() => openAuth('microsoft')}>
            Add account
          </Button>
        }
      />

      {!activeAccount ? (
        <div className="panel account-empty-panel">
          <div className="account-empty">
            <div className="account-empty__art">
              <div className="account-empty__cube">
                <ShieldCheck />
              </div>
            </div>
            <div className="account-empty__copy">
              <h2>Connect a Microsoft account</h2>
              <p>
                Sign in with the Microsoft account that owns Minecraft: Java Edition. Aqua uses Microsoft’s official OAuth flow, and your session is encrypted by your operating system. You can add more accounts and switch between them.
              </p>
              <div className="account-empty__actions">
                <Button variant="primary" size="lg" icon={<KeyRound />} onClick={() => openAuth('microsoft')}>
                  Connect Microsoft
                </Button>
              </div>
              {MICROSOFT_AUTH_ENABLED && !configured ? (
                <div className="callout callout--warning" style={{ marginTop: 20 }}>
                  <TriangleAlert />
                  <div>
                    Microsoft sign-in needs an Azure client ID and Mojang approval.{' '}
                    <button type="button" className="link-button" onClick={() => openAuth('microsoft')}>
                      Microsoft setup <ChevronRight />
                    </button>
                  </div>
                </div>
              ) : null}
              {accounts && !accounts.secureStorageAvailable ? (
                <div className="callout callout--warning" style={{ marginTop: 12 }}>
                  <ShieldX />
                  <span>
                    This system does not expose OS credential encryption. Sessions will only be kept in memory and
                    will not survive a launcher restart.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="account-layout">
          <section className="panel account-profile">
            <div className="account-profile__backdrop" />
            <div className="account-profile__content">
              <div className="account-profile__identity">
                <div className={cx('account-profile__avatar', activeAccount.sessionExpired && 'is-expired')}>
                  <Avatar name={activeAccount.name} src={activeAccount.avatarDataUrl} size="xl" />
                  <span className="account-profile__badge">
                    <CheckCircle2 />
                  </span>
                </div>
                <div className="account-profile__copy">
                  <div className="account-profile__name-row">
                    <h2>{activeAccount.name}</h2>
                    {activeAccount.type === 'offline' ? (
                      <Badge tone="info">Offline</Badge>
                    ) : activeAccount.sessionExpired ? (
                      <Badge tone="danger">Session expired</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </div>
                  <span className="account-profile__type">
                    {activeAccount.type === 'offline'
                      ? 'Minecraft: Java Edition · Offline profile'
                      : 'Minecraft: Java Edition · Microsoft'}
                  </span>
                  <div className="account-profile__uuid">
                    <span className="mono">{activeAccount.uuid}</span>
                    <CopyButton value={activeAccount.uuid} label="Copy player UUID" />
                  </div>
                </div>
              </div>

              {activeAccount.sessionExpired && activeAccount.type !== 'offline' ? (
                <div className="callout callout--danger">
                  <TriangleAlert />
                  <div>
                    Your saved session can no longer be refreshed. Reconnect your account to continue playing.
                    <div style={{ marginTop: 10 }}>
                      <Button size="sm" variant="primary" icon={<KeyRound />} onClick={() => openAuth('microsoft')}>
                        Reconnect account
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="account-stats">
                <div>
                  <span>Session</span>
                  <strong>
                    {activeAccount.type === 'offline'
                      ? 'Local profile'
                      : activeAccount.expiresAt
                        ? formatDateTime(activeAccount.expiresAt)
                        : 'Automatic refresh'}
                  </strong>
                </div>
                <div>
                  <span>Added</span>
                  <strong>{relativeTime(activeAccount.addedAt)}</strong>
                </div>
              </div>

              <div className="account-profile__actions">
                {activeAccount.type !== 'offline' ? (
                  <Button icon={<RefreshCw />} onClick={() => void handleRefresh()} loading={refreshing}>
                    Refresh session
                  </Button>
                ) : MICROSOFT_AUTH_ENABLED ? (
                  <Button icon={<UserPlus />} onClick={() => openAuth('microsoft')}>
                    Connect Microsoft
                  </Button>
                ) : (
                  <Button icon={<UserPlus />} onClick={() => openAuth('offline')}>
                    Add profile
                  </Button>
                )}
                <Button variant="ghost" icon={<LogOut />} onClick={() => setSignOutTarget(activeAccount)}>
                  Sign out
                </Button>
              </div>
            </div>
          </section>

          <aside className="account-side">
            <section className="panel panel--pad">
              <div className="account-side__head">
                <ShieldCheck />
                <div>
                  <h3>{activeAccount.type === 'offline' ? 'Offline profile' : 'Credential security'}</h3>
                  <p>
                    {activeAccount.type === 'offline'
                      ? 'A local username and UUID stored on this device.'
                      : 'Signed in through Microsoft, stored by your operating system.'}
                  </p>
                </div>
              </div>
              {activeAccount.type === 'offline' ? (
                <>
                  <div className="security-list">
                    <div>
                      <span>Authentication</span>
                      <strong>None (offline)</strong>
                    </div>
                    <div>
                      <span>Online servers</span>
                      <strong>Rejected by online-mode</strong>
                    </div>
                    <div>
                      <span>Stored data</span>
                      <strong>Username + UUID</strong>
                    </div>
                  </div>
                  <div className="account-side__note">
                    <WifiOff />
                    <span>
                      Offline mode cannot prove ownership. Use it for singleplayer, LAN, and testing with a username you
                      own.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="security-list">
                    <div>
                      <span>Storage</span>
                      <strong>{accounts?.storageLabel || 'Not available'}</strong>
                    </div>
                    <div>
                      <span>OAuth flow</span>
                      <strong>PKCE + loopback callback</strong>
                    </div>
                    <div>
                      <span>Token type</span>
                      <strong>Encrypted refresh token</strong>
                    </div>
                  </div>
                  <div className="account-side__note">
                    <LockKeyhole />
                    <span>
                      Aqua never asks for your Microsoft password. Sign-in happens in your system browser on
                      microsoft.com.
                    </span>
                  </div>
                </>
              )}
            </section>

            {MICROSOFT_AUTH_ENABLED ? (
            <section className="panel panel--pad">
              <div className="account-side__head">
                <KeyRound />
                <div>
                  <h3>Microsoft app ID</h3>
                  <p>The Azure application used for this launcher’s sign-in.</p>
                </div>
              </div>
              {configured && settings ? (
                <>
                  <div className="copy-field account-app-id">
                    <span className="copy-field__value">{settings.microsoftClientId}</span>
                    <CopyButton value={settings.microsoftClientId} label="Copy client ID" />
                  </div>
                  <div className="account-side__actions">
                    <button type="button" className="link-button" onClick={() => navigate('settings')}>
                      Manage in settings <ChevronRight />
                    </button>
                    <button type="button" className="link-button" onClick={() => navigate('settings')}>
                      Change <ChevronRight />
                    </button>
                  </div>
                </>
              ) : (
                <div className="callout callout--warning">
                  <TriangleAlert />
                  <div>
                    No app ID configured. Adding one is required for new sign-ins.
                    <div style={{ marginTop: 8 }}>
                      <Button size="sm" variant="primary" onClick={() => openAuth('microsoft')}>
                        Configure sign-in
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </section>
            ) : null}
          </aside>

          <section className="panel account-others">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">{MICROSOFT_AUTH_ENABLED ? 'Other accounts' : 'Other profiles'}</h2>
                <p className="panel-head__subtitle">
                  {MICROSOFT_AUTH_ENABLED ? 'Switch without typing your password again.' : 'Switch players without restarting the launcher.'}
                </p>
              </div>
              <Button variant="ghost" size="sm" icon={<UserPlus />} onClick={() => openAuth()}>
                {MICROSOFT_AUTH_ENABLED ? 'Add account' : 'Add profile'}
              </Button>
            </div>
            <div className="panel-body">
              {otherAccounts.length === 0 ? (
                <EmptyState
                  icon={<Users />}
                  title="Only one profile connected"
                  description={
                    MICROSOFT_AUTH_ENABLED
                      ? 'Add another Microsoft account to switch between Minecraft profiles.'
                      : 'Add another offline profile to switch between Minecraft players.'
                  }
                >
                  <Button size="sm" icon={<UserPlus />} onClick={() => openAuth()}>
                    {MICROSOFT_AUTH_ENABLED ? 'Add account' : 'Add profile'}
                  </Button>
                </EmptyState>
              ) : (
                <ul className="account-list">
                  {otherAccounts.map((account) => (
                    <li key={account.id} className="account-list__item">
                      <Avatar name={account.name} src={account.avatarDataUrl} />
                      <div className="account-list__copy">
                        <span className="account-list__name">{account.name}</span>
                        <span className="account-list__uuid mono">{account.uuid}</span>
                      </div>
                      {account.type === 'offline' ? (
                        <Badge tone="info">Offline</Badge>
                      ) : account.sessionExpired ? (
                        <Badge tone="danger">Expired</Badge>
                      ) : null}
                      <Button
                        size="sm"
                        onClick={() => void handleSwitch(account)}
                        loading={busyId === account.id}
                        icon={<ChevronRight />}
                      >
                        Switch
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<LogOut />}
                        onClick={() => {
                          setSignOutError(null)
                          setSignOutTarget(account)
                        }}
                      >
                        Sign out
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(signOutTarget)}
        title="Sign out of this account?"
        description={
          <>
            The encrypted Microsoft session for{' '}
            <strong style={{ color: 'var(--text)' }}>{signOutTarget?.name}</strong> will be removed from this device.
            Your Minecraft account, worlds and installations are not affected.
          </>
        }
        confirmLabel="Sign out"
        tone="danger"
        loading={signingOut}
        onCancel={() => (signingOut ? undefined : setSignOutTarget(null))}
        onConfirm={() => void handleSignOut()}
      >
        {signOutError ? <div className="callout callout--danger">{signOutError}</div> : null}
        {accounts && !accounts.secureStorageAvailable ? (
          <div className="callout callout--warning">
            <TriangleAlert /> This system could not securely store credentials; the session may not persist anyway.
          </div>
        ) : null}
      </ConfirmDialog>

      {refreshing ? (
        <div className="account-refresh-indicator" role="status">
          <Spinner /> Refreshing Microsoft session…
        </div>
      ) : null}
    </div>
  )
}
