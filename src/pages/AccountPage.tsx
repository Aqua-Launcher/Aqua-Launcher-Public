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
} from 'lucide-react'
import { getErrorMessage } from '../lib/api'
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
    openAuth,
    switchAccount,
    refreshAccount,
    signOut,
  } = useLauncher()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [signOutTarget, setSignOutTarget] = useState<Account | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const allAccounts = accounts?.accounts || []
  const otherAccounts = allAccounts.filter((account) => account.id !== activeAccount?.id)

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
          <Button variant="primary" icon={<UserPlus />} onClick={openAuth}>
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
                Sign in with the Microsoft account that owns Minecraft: Java Edition. Aqua opens Microsoft’s official
                sign-in window and encrypts your session with your operating system. You can add more accounts and
                switch between them.
              </p>
              <div className="account-empty__actions">
                <Button variant="primary" size="lg" icon={<KeyRound />} onClick={openAuth}>
                  Connect Microsoft
                </Button>
              </div>
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
                    {activeAccount.sessionExpired ? (
                      <Badge tone="danger">Session expired</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </div>
                  <span className="account-profile__type">Minecraft: Java Edition · Microsoft</span>
                  <div className="account-profile__uuid">
                    <span className="mono">{activeAccount.uuid}</span>
                    <CopyButton value={activeAccount.uuid} label="Copy player UUID" />
                  </div>
                </div>
              </div>

              {activeAccount.sessionExpired ? (
                <div className="callout callout--danger">
                  <TriangleAlert />
                  <div>
                    Your saved session can no longer be refreshed. Reconnect your account to continue playing.
                    <div style={{ marginTop: 10 }}>
                      <Button size="sm" variant="primary" icon={<KeyRound />} onClick={openAuth}>
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
                    {activeAccount.expiresAt ? formatDateTime(activeAccount.expiresAt) : 'Automatic refresh'}
                  </strong>
                </div>
                <div>
                  <span>Added</span>
                  <strong>{relativeTime(activeAccount.addedAt)}</strong>
                </div>
              </div>

              <div className="account-profile__actions">
                <Button icon={<RefreshCw />} onClick={() => void handleRefresh()} loading={refreshing}>
                  Refresh session
                </Button>
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
                  <h3>Credential security</h3>
                  <p>Signed in through Microsoft, stored by your operating system.</p>
                </div>
              </div>
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
            </section>
          </aside>

          <section className="panel account-others">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">Other accounts</h2>
                <p className="panel-head__subtitle">Switch without typing your password again.</p>
              </div>
              <Button variant="ghost" size="sm" icon={<UserPlus />} onClick={openAuth}>
                Add account
              </Button>
            </div>
            <div className="panel-body">
              {otherAccounts.length === 0 ? (
                <EmptyState
                  icon={<Users />}
                  title="Only one account connected"
                  description="Add another Microsoft account to switch between Minecraft profiles."
                >
                  <Button size="sm" icon={<UserPlus />} onClick={openAuth}>
                    Add account
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
                      {account.sessionExpired ? <Badge tone="danger">Expired</Badge> : null}
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
