import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, FolderOpen, Loader2, Power, Trash2 } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes, relativeTime } from '../../lib/format'
import type { InstalledMod, WorldSummary } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, EmptyState, IconButton, Spinner } from '../ui/primitives'
import { ConfirmDialog, Modal } from '../ui/overlays'

/** Per-world datapack list: enable, disable, remove, or open the exact folder. */
export function WorldDatapacksDialog({
  installationId,
  world,
  onClose,
  onChanged,
}: {
  installationId: string | null
  world: WorldSummary | null
  onClose: () => void
  onChanged?: () => void
}) {
  const { pushToast } = useLauncher()
  const [items, setItems] = useState<InstalledMod[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InstalledMod | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!installationId || !world) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await api.mods.list(installationId, 'datapack', world.folder)
      setItems(result.items)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [installationId, world])

  useEffect(() => {
    if (world) void load()
  }, [load, world])

  const toggle = async (item: InstalledMod) => {
    if (!installationId || !world) return
    setBusy(item.filename)
    try {
      await api.mods.toggle(installationId, item.filename, 'datapack', world.folder)
      await load()
      onChanged?.()
    } catch (toggleError) {
      pushToast({ level: 'error', title: 'Could not change that datapack', message: getErrorMessage(toggleError) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!installationId || !world || !deleteTarget) return
    setBusy(deleteTarget.filename)
    try {
      await api.mods.remove(installationId, deleteTarget.filename, 'datapack', world.folder)
      setDeleteTarget(null)
      await load()
      onChanged?.()
      pushToast({ level: 'success', title: `Removed ${deleteTarget.title}` })
    } catch (removeError) {
      pushToast({ level: 'error', title: 'Could not remove that datapack', message: getErrorMessage(removeError) })
    } finally {
      setBusy(null)
    }
  }

  const openFolder = async () => {
    if (!installationId || !world) return
    try {
      await api.mods.openFolder(installationId, 'datapack', world.folder)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open the datapacks folder', message: getErrorMessage(openError) })
    }
  }

  return (
    <Modal
      open={Boolean(world)}
      onClose={() => (busy ? undefined : onClose())}
      title={world ? `Datapacks · ${world.name}` : 'Datapacks'}
      subtitle={world ? `${world.folder} · Minecraft ${world.versionName || 'unknown version'}` : undefined}
      size="wide"
      footer={
        <>
          <Button variant="ghost" icon={<FolderOpen />} onClick={() => void openFolder()} disabled={!world}>
            Open folder
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <div className="callout callout--danger" role="alert">
          <AlertTriangle />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !items.length ? (
        <div className="mods-loading">
          <Spinner /> Reading this world’s datapacks…
        </div>
      ) : items.length ? (
        <ul className="mod-list">
          {items.map((item) => (
            <li key={item.filename} className={item.enabled ? 'mod-row' : 'mod-row is-disabled'}>
              <span className="mod-row__icon">
                <Database />
              </span>
              <span className="mod-row__copy">
                <span className="mod-row__title">
                  {item.metadata?.name || item.title}
                  {item.metadata?.format ? <span className="mod-row__version">format {item.metadata.format}</span> : null}
                  {!item.enabled ? <span className="mod-row__flag">Disabled</span> : null}
                </span>
                <span className="mod-row__meta">
                  {item.filename} · {formatBytes(item.size)}
                  {item.modified ? ` · ${relativeTime(item.modified)}` : ''}
                </span>
              </span>
              <span className="mod-row__actions">
                <Badge tone={item.enabled ? 'success' : 'default'}>{item.enabled ? 'Enabled' : 'Disabled'}</Badge>
                <IconButton
                  label={item.enabled ? `Disable ${item.title}` : `Enable ${item.title}`}
                  size="sm"
                  disabled={busy === item.filename}
                  onClick={() => void toggle(item)}
                >
                  {busy === item.filename ? <Loader2 className="spin" /> : <Power />}
                </IconButton>
                <IconButton
                  label={`Remove ${item.title}`}
                  size="sm"
                  tone="danger"
                  disabled={busy === item.filename}
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Database />}
          title="No datapacks in this world"
          description="Browse Datapacks in Extra content, choose this world, and install one. Minecraft also reads datapacks dropped into the folder."
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this datapack?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.title}</strong> will be deleted from this world’s
            datapacks folder. The world itself is not changed.
          </>
        }
        confirmLabel="Remove datapack"
        loading={Boolean(busy)}
        onCancel={() => (busy ? undefined : setDeleteTarget(null))}
        onConfirm={() => void remove()}
      />
    </Modal>
  )
}
