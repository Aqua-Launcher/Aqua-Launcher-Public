import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import type { Installation } from '../../lib/types'
import { Spinner, cx } from '../ui/primitives'

/**
 * Modrinth project "In-Game Account Switcher" (client-side, LGPL-3.0).
 * It adds Microsoft sign-in inside Minecraft, so a player can launch with any
 * profile and still join online-mode servers with a verified account.
 */
const PROJECT_ID = 'cudtvDnd'
const SUPPORTED_LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge'])

type Status = 'checking' | 'missing' | 'disabled' | 'installed'

export function AccountSwitcherToggle({
  installation,
  disabled = false,
}: {
  installation: Installation
  disabled?: boolean
}) {
  const { pushToast } = useLauncher()
  const [status, setStatus] = useState<Status>('checking')
  const [disabledFile, setDisabledFile] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const mounted = useRef(true)

  const supported = SUPPORTED_LOADERS.has(installation.loader?.type ?? 'vanilla')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!supported) {
      setStatus('missing')
      return
    }
    setStatus('checking')
    void api.mods
      .list(installation.id, 'mod')
      .then((result) => {
        if (cancelled) return
        // The hash lookup can fail offline, so also recognise the usual file names.
        const match = result.items.find(
          (item) =>
            item.projectId === PROJECT_ID ||
            /(^|[-_.\s])ias([-_.\s]|$)/i.test(item.filename) ||
            item.filename.toLowerCase().includes('in-game-account-switcher'),
        )
        setDisabledFile(match && !match.enabled ? match.filename : null)
        setStatus(match ? (match.enabled ? 'installed' : 'disabled') : 'missing')
      })
      .catch(() => {
        // A profile that has never downloaded mods has no mods folder yet.
        if (!cancelled) setStatus('missing')
      })
    return () => {
      cancelled = true
    }
  }, [installation.id, supported])

  const install = useCallback(async () => {
    if (!supported || installing || (status !== 'missing' && status !== 'disabled')) return
    setInstalling(true)
    try {
      if (status === 'disabled' && disabledFile) {
        await api.mods.toggle(installation.id, disabledFile, 'mod')
        if (!mounted.current) return
        setStatus('installed')
        setDisabledFile(null)
        pushToast({
          level: 'success',
          title: 'Account switcher enabled',
          message: 'Add your Microsoft account from Minecraft’s account menu.',
        })
        return
      }
      const result = await api.mods.install(installation.id, PROJECT_ID, null, 'mod')
      if (!mounted.current) return
      setStatus('installed')
      const extras = result.installed.filter((entry) => entry.projectId !== PROJECT_ID)
      if (result.skipped.length) {
        pushToast({
          level: 'warning',
          title: 'Account switcher installed with missing files',
          message: 'A required dependency could not be resolved. Check Extra content before playing.',
        })
      } else {
        pushToast({
          level: 'success',
          title: 'Account switcher installed',
          message: extras.length
            ? `${extras.map((entry) => entry.name).join(', ')} was added too. Add your Microsoft account from Minecraft's account menu.`
            : 'Launch this profile, then add your Microsoft account from Minecraft’s account menu.',
        })
      }
    } catch (error) {
      if (mounted.current) {
        pushToast({
          level: 'error',
          title: 'Could not install the account switcher',
          message: getErrorMessage(error),
        })
      }
    } finally {
      if (mounted.current) setInstalling(false)
    }
  }, [disabledFile, installation.id, installing, pushToast, status, supported])

  const title = !supported
    ? 'This profile has no mod loader. Use Fabric, Quilt, Forge, or NeoForge to install the account switcher.'
    : status === 'installed'
      ? 'Installed. Open Minecraft’s account menu to add a Microsoft account. Remove it from Extra content if you no longer want it.'
      : status === 'disabled'
        ? 'In-Game Account Switcher is installed but disabled. Click to enable it, or manage it from Extra content.'
        : 'Installs In-Game Account Switcher from Modrinth. Launch with any profile, then add your Microsoft account inside Minecraft to join online servers as a verified player.'

  const hint = !supported
    ? 'Needs a mod loader'
    : status === 'checking'
      ? 'Checking this profile'
      : installing
        ? 'Installing from Modrinth'
        : status === 'installed'
          ? 'Microsoft sign-in in-game'
          : status === 'disabled'
            ? 'Click to enable it'
            : 'Install in-game sign-in'

  return (
    <label
      className={cx(
        'account-switcher',
        status === 'installed' && 'is-installed',
        !supported && 'is-unavailable',
      )}
      title={title}
    >
      <input
        type="checkbox"
        checked={status === 'installed'}
        disabled={!supported || status === 'checking' || installing || disabled || status === 'installed'}
        onChange={(event) => {
          if (event.target.checked) void install()
        }}
        aria-label={
          status === 'installed'
            ? 'In-Game Account Switcher installed'
            : status === 'disabled'
              ? 'Enable In-Game Account Switcher'
              : 'Install In-Game Account Switcher'
        }
      />
      <span className="account-switcher__box" aria-hidden="true">
        {status === 'checking' || installing ? <Spinner /> : status === 'installed' ? <Check /> : <ShieldCheck />}
      </span>
      <span className="account-switcher__copy">
        <span className="account-switcher__title">
          {installing
            ? 'Installing account switcher'
            : status === 'installed'
              ? 'Account switcher ready'
              : status === 'disabled'
                ? 'Account switcher disabled'
                : 'Account switcher'}
        </span>
        <span className="account-switcher__hint">{hint}</span>
      </span>
    </label>
  )
}
