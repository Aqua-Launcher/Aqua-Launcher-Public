import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, Info, Trash2 } from 'lucide-react'
import { useLauncher } from '../../state/LauncherProvider'
import { relativeTime } from '../../lib/format'
import { cx } from '../ui/primitives'

const ICONS = {
  success: Check,
  info: Info,
  warning: AlertTriangle,
  error: AlertTriangle,
}

export function NotificationCenter() {
  const { notifications, markNotificationsRead, clearNotifications, navigate } = useLauncher()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((notification) => !notification.read).length

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      popRef.current
        ?.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
        ?.focus()
    }, 30)
    return () => {
      window.clearTimeout(timer)
      bellRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openNotification = async (notification: (typeof notifications)[number]) => {
    if (!notification.read) {
      try {
        await markNotificationsRead([notification.id])
      } catch {
        // The notification itself is still useful even if marking it read fails.
      }
    }
    setOpen(false)
    if (notification.action) navigate(notification.action.page, notification.action.params)
  }

  const markAllRead = async () => {
    if (busy || unread === 0) return
    setBusy(true)
    try {
      await markNotificationsRead()
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (busy || notifications.length === 0) return
    setBusy(true)
    try {
      await clearNotifications()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        ref={bellRef}
        type="button"
        className={cx('notification-bell', open && 'is-open')}
        onClick={() => setOpen((current) => !current)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-popover"
        aria-haspopup="dialog"
        title="Notifications"
      >
        <Bell size={14} strokeWidth={1.9} />
        {unread > 0 ? <span className="notification-bell__badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div ref={popRef} id="notification-popover" className="notification-pop" role="dialog" aria-label="Notifications">
          <div className="notification-pop__head">
            <div>
              <strong>Notifications</strong>
              <span>{unread ? `${unread} unread` : 'All caught up'}</span>
            </div>
            <div className="notification-pop__actions">
              <button type="button" onClick={() => void markAllRead()} disabled={busy || unread === 0}>
                <Check size={12} />
                Mark all read
              </button>
              <button
                type="button"
                className="notification-pop__clear"
                onClick={() => void clear()}
                disabled={busy || notifications.length === 0}
              >
                <Trash2 size={12} />
                Clear
              </button>
            </div>
          </div>

          {notifications.length ? (
            <div className="notification-pop__list">
              {notifications.map((notification) => {
                const Icon = ICONS[notification.level]
                return (
                  <button
                    key={notification.id}
                    type="button"
                    className={cx('notification-item', !notification.read && 'is-unread')}
                    onClick={() => void openNotification(notification)}
                  >
                    <span className={cx('notification-item__icon', `is-${notification.level}`)}>
                      <Icon size={13} />
                    </span>
                    <span className="notification-item__copy">
                      <span className="notification-item__title">{notification.title}</span>
                      {notification.message ? (
                        <span className="notification-item__message">{notification.message}</span>
                      ) : null}
                      <span className="notification-item__meta">
                        <time dateTime={notification.at}>{relativeTime(notification.at)}</time>
                        {notification.action ? (
                          <span className="notification-item__action">
                            {notification.action.label || 'Open'}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {!notification.read ? <span className="notification-item__dot" /> : null}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="notification-pop__empty">
              <Bell size={18} />
              <span>No notifications yet. Downloads, crashes and backups will appear here.</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
