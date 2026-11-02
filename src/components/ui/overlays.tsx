import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { Toast } from '../../lib/types'
import { Button, IconButton, cx } from './primitives'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'wide' | 'xl'
  closeOnOverlay?: boolean
  hideClose?: boolean
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  hideClose = false,
  className,
}: ModalProps) {
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Focus the dialog once when it opens. This effect deliberately depends only on
    // `open`: re-running it on every parent render would drag focus out of the field
    // the user is typing in and onto the first focusable element (the close button).
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ||
        panel.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])',
        ) ||
        panel.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])') ||
        panel
      target.focus()
    }, 30)

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      previousFocus.current?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === overlayRef.current) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cx('modal', size === 'sm' && 'modal--sm', size === 'wide' && 'modal--wide', size === 'xl' && 'modal--xl', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {(title || !hideClose) && (
          <div className="modal__header">
            <div>
              {title ? (
                <h2 className="modal__title" id={titleId}>
                  {title}
                </h2>
              ) : null}
              {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
            </div>
            {!hideClose ? (
              <IconButton label="Close dialog" onClick={onClose}>
                <X />
              </IconButton>
            ) : null}
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.65 }}>{description}</p>
      {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}
    </Modal>
  )
}

function ToastIcon({ level }: { level: Toast['level'] }) {
  if (level === 'success') return <CheckCircle2 />
  if (level === 'error') return <XCircle />
  if (level === 'warning') return <AlertTriangle />
  return <Info />
}

export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null
  return createPortal(
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('toast', `toast--${toast.level}`)} role="status">
          <span className="toast__icon">
            <ToastIcon level={toast.level} />
          </span>
          <div className="toast__copy">
            <div className="toast__title">{toast.title}</div>
            {toast.message ? <div className="toast__message">{toast.message}</div> : null}
            {toast.action && toast.actionLabel ? (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action?.()
                  onDismiss(toast.id)
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <IconButton
            label="Dismiss notification"
            size="sm"
            className="toast__close"
            onClick={() => onDismiss(toast.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </div>,
    document.body,
  )
}

