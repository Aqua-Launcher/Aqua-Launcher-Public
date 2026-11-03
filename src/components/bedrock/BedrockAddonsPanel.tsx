import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Compass, Download, FolderOpen, Package, Palette, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { EventPayloadMap } from '../../lib/api'
import { formatBytes, relativeTime } from '../../lib/format'
import { useLauncher } from '../../state/LauncherProvider'
import type { BedrockAddon, BedrockAddonsResult } from '../../lib/types'
import { Button, EmptyState, Spinner } from '../ui/primitives'
import { ConfirmDialog } from '../ui/overlays'
import { BedrockBrowser } from './BedrockBrowser'

const KIND_LABELS: Record<string, string> = {
  behavior_pack: 'Behavior packs',
  resource_pack: 'Resource packs',
  skin_pack: 'Skin packs',
}

function kindIcon(kind: string) {
  if (kind === 'behavior_pack') return <Boxes />
  if (kind === 'skin_pack') return <Palette />
  return <Package />
}

/**
 * Bedrock add-ons are files, not a service: .mcpack / .mcaddon downloads are
 * unpacked into the edition's com.mojang folders. Browsing sites such as MCPEDL
 * happens in the browser, and the downloaded file is imported here.
 */
export function BedrockAddonsPanel() {
  const { bedrock, bedrockLoading, refreshBedrock, pushToast, navigate } = useLauncher()
  const editions = bedrock?.editions ?? []
  const [editionId, setEditionId] = useState<string | null>(null)
  const [data, setData] = useState<BedrockAddonsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [deleteTarget, setDeleteTarget] = useState<BedrockAddon | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!editions.length) {
      setEditionId(null)
      return
    }
    setEditionId((current) => (current && editions.some((edition) => edition.id === current) ? current : editions[0].id))
  }, [editions])

  const load = useCallback(
    async (id: string | null) => {
      if (!id) {
        setData(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        setData(await api.bedrock.addons(id))
      } catch (loadError) {
        setError(getErrorMessage(loadError))
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void load(editionId)
  }, [editionId, load])

  // A download in the in-app browser installs itself in the main process; pick
  // the new pack up without asking the user to refresh.
  useEffect(() => {
    return api.events.subscribe((event) => {
      if (event.type !== 'bedrock-addons') return
      const payload = event.payload as EventPayloadMap['bedrock-addons']
      if (editionId && payload.editionId === editionId) void load(editionId)
    })
  }, [editionId, load])

  useEffect(() => {
    const refresh = () => {
      if (editionId) void load(editionId)
    }
    window.addEventListener('aqua:content-imported', refresh)
    return () => window.removeEventListener('aqua:content-imported', refresh)
  }, [editionId, load])

  const grouped = useMemo(() => {
    const groups = new Map<string, BedrockAddon[]>()
    for (const pack of data?.packs ?? []) {
      const list = groups.get(pack.kind) ?? []
      list.push(pack)
      groups.set(pack.kind, list)
    }
    return groups
  }, [data])

  const importAddon = async () => {
    if (!editionId) return
    try {
      const filePath = await api.dialogs.chooseAddon()
      if (!filePath) return
      setImporting(true)
      const result = await api.bedrock.importAddon(editionId, filePath)
      const names = result.installed.map((pack) => pack.name)
      pushToast({
        level: 'success',
        title: result.installed.length ? `Imported ${names.join(', ')}` : 'Imported a Bedrock world',
        message: result.installed.length
          ? 'Enable it per world under Settings → Add-Ons in Minecraft.'
          : `The world is in ${result.worlds.join(', ')}.`,
      })
      if (result.skipped.length) {
        pushToast({
          level: 'info',
          title: 'Some packs were skipped',
          message: result.skipped.join(', '),
        })
      }
      await load(editionId)
    } catch (importError) {
      pushToast({ level: 'error', title: 'Import failed', message: getErrorMessage(importError) })
    } finally {
      setImporting(false)
    }
  }

  const removePack = async () => {
    if (!deleteTarget || !editionId) return
    setDeleting(true)
    try {
      await api.bedrock.removeAddon(editionId, deleteTarget.kind, deleteTarget.folder)
      pushToast({ level: 'info', title: `${deleteTarget.name} removed`, message: 'Its files were deleted.' })
      setDeleteTarget(null)
      await load(editionId)
    } catch (removeError) {
      pushToast({ level: 'error', title: 'Could not remove that pack', message: getErrorMessage(removeError) })
    } finally {
      setDeleting(false)
    }
  }

  const openFolder = async (kind: string | null) => {
    if (!editionId) return
    try {
      await api.bedrock.openAddonFolder(editionId, kind)
    } catch (folderError) {
      pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(folderError) })
    }
  }

  const viewSwitch = (
    <div className="segmented edition-switch" role="tablist" aria-label="Add-on view">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'installed'}
        className={view === 'installed' ? 'is-active' : undefined}
        onClick={() => setView('installed')}
      >
        <Package /> Installed
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'browse'}
        className={view === 'browse' ? 'is-active' : undefined}
        onClick={() => setView('browse')}
      >
        <Compass /> Browse add-ons
      </button>
    </div>
  )

  if (view === 'browse') {
    return (
      <div className="bedrock-addons">
        {viewSwitch}
        <BedrockBrowser />
      </div>
    )
  }

  if (!editions.length) {
    return (
      <div className="bedrock-addons">
        {viewSwitch}
        <div className="panel">
          <EmptyState
            icon={<Package />}
            title="Bedrock Edition is not installed"
            description="Install Minecraft for Windows from the Microsoft Store to install add-ons here. You can still browse them."
          >
            <Button icon={<Download />} onClick={() => void refreshBedrock(true)} loading={bedrockLoading}>
              Check again
            </Button>
            <Button variant="ghost" onClick={() => navigate('installations')}>
              Open Installations
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  const total = data?.packs.length ?? 0

  return (
    <div className="bedrock-addons">
      {viewSwitch}
      <div className="callout bedrock-notice">
        <div className="grow">
          <strong>Add-ons install straight into Minecraft.</strong>
          <div className="text-dim">
            Use{' '}
            <button type="button" className="link-button" onClick={() => setView('browse')}>
              Browse add-ons
            </button>{' '}
            to browse MCPE Addons and ModBay without leaving the launcher: a downloaded <code>.mcpack</code>,{' '}
            <code>.mcaddon</code>, or <code>.mcworld</code> lands in this edition's <code>com.mojang</code> folders
            automatically. MCPEDL hands off to your browser because it blocks embedded ones. You can also import a
            file you already have. Bedrock applies packs per world, under Settings → Add-Ons in the game.
          </div>
        </div>
      </div>

      <div className="page-toolbar">
        {editions.length > 1 ? (
          <div className="segmented" role="tablist" aria-label="Bedrock edition">
            {editions.map((edition) => (
              <button
                key={edition.id}
                type="button"
                role="tab"
                aria-selected={editionId === edition.id}
                className={editionId === edition.id ? 'is-active' : undefined}
                onClick={() => setEditionId(edition.id)}
              >
                {edition.name}
              </button>
            ))}
          </div>
        ) : (
          <span
            className="bedrock-addons__path"
            title={data ? `${data.editionName} · ${data.dataRoot}` : undefined}
          >
            {data ? `${data.editionName} · ${data.dataRoot}` : 'Looking for Minecraft for Windows…'}
          </span>
        )}
        <span className="page-toolbar__count">
          {total} pack{total === 1 ? '' : 's'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className={loading ? 'spin' : undefined} />}
          onClick={() => void load(editionId)}
          disabled={loading}
        >
          Refresh
        </Button>
        <Button size="sm" icon={<FolderOpen />} onClick={() => void openFolder(null)}>
          Open folder
        </Button>
        <Button size="sm" variant="primary" icon={importing ? <Spinner /> : <Upload />} onClick={() => void importAddon()} loading={importing}>
          Import add-on
        </Button>
      </div>

      {error ? <div className="callout callout--danger">{error}</div> : null}

      {loading && !data ? (
        <div className="panel bedrock-addons__loading">
          <Spinner label="Reading installed add-ons" />
        </div>
      ) : !total ? (
        <div className="panel">
          <EmptyState
            icon={<Package />}
            title="No add-ons installed for this edition"
            description="Import a .mcpack, .mcaddon, or .mcworld file to install it into Minecraft's own folders."
          >
            <Button variant="primary" icon={<Upload />} onClick={() => void importAddon()} loading={importing}>
              Import add-on
            </Button>
            <Button icon={<Compass />} onClick={() => setView('browse')}>
              Browse add-ons
            </Button>
          </EmptyState>
        </div>
      ) : (
        (['behavior_pack', 'resource_pack', 'skin_pack'] as const).map((kind) => {
          const packs = grouped.get(kind) ?? []
          if (!packs.length) return null
          return (
            <section className="panel bedrock-addons__group" key={kind}>
              <div className="panel-head">
                <div>
                  <h2 className="panel-head__title">
                    {kindIcon(kind)} {KIND_LABELS[kind]}
                  </h2>
                  <p className="panel-head__subtitle">
                    {packs.length} pack{packs.length === 1 ? '' : 's'} in <code>com.mojang/{kind === 'behavior_pack' ? 'behavior_packs' : kind === 'resource_pack' ? 'resource_packs' : 'skin_packs'}</code>
                  </p>
                </div>
                <button type="button" className="link-button" onClick={() => void openFolder(kind)}>
                  <FolderOpen /> Open
                </button>
              </div>
              {packs.map((pack) => (
                <div className="bedrock-addon-row" key={`${pack.kind}-${pack.folder}`}>
                  <span className="bedrock-addon-row__icon">{kindIcon(pack.kind)}</span>
                  <div className="grow">
                    <span className="bedrock-addon-row__name">
                      {pack.name}
                      {pack.version ? <span className="bedrock-addon-row__version">v{pack.version}</span> : null}
                    </span>
                    {pack.description ? <span className="bedrock-addon-row__desc">{pack.description}</span> : null}
                    <span className="bedrock-addon-row__meta">
                      {formatBytes(pack.sizeBytes)} · {pack.files} files · {relativeTime(pack.modified)}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setDeleteTarget(pack)}>
                    Remove
                  </Button>
                </div>
              ))}
            </section>
          )
        })
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this pack?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong> will be deleted from Minecraft's
            add-ons folder. Worlds that already use it will lose the pack.
          </>
        }
        confirmLabel="Remove pack"
        loading={deleting}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
        onConfirm={() => void removePack()}
      />
    </div>
  )
}
