import { useEffect, useState } from 'react'
import { AlertTriangle, Archive } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import type { Installation, ModpackExportPreview } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, Checkbox, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

/**
 * Previews what can be re-downloaded and what must be bundled before opening
 * the save dialog, so a pack export is never a surprise.
 */
export function ExportPackDialog({
  installation,
  onClose,
}: {
  installation: Installation | null
  onClose: () => void
}) {
  const { pushToast } = useLauncher()
  const [preview, setPreview] = useState<ModpackExportPreview | null>(null)
  const [includeWorlds, setIncludeWorlds] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!installation) {
      setPreview(null)
      setIncludeWorlds(false)
      setError(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setPreview(null)
    setIncludeWorlds(false)
    void api.mods
      .exportPreview(installation.id, false)
      .then((result) => {
        if (active) setPreview(result)
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [installation])

  const load = async (withWorlds: boolean) => {
    if (!installation) return
    setIncludeWorlds(withWorlds)
    setLoading(true)
    setError(null)
    try {
      setPreview(await api.mods.exportPreview(installation.id, withWorlds))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  const start = async () => {
    if (!installation || !preview) return
    setExporting(true)
    setError(null)
    try {
      const result = await api.mods.exportPack(installation.id, includeWorlds)
      if (!result) return
      pushToast({
        level: 'success',
        title: `Exported ${result.filename}`,
        message: `${result.downloadable} downloadable · ${result.bundled} bundled · ${formatBytes(result.totalBytes)}`,
      })
      onClose()
    } catch (exportError) {
      setError(getErrorMessage(exportError))
    } finally {
      setExporting(false)
    }
  }

  const close = () => {
    if (!exporting) onClose()
  }

  return (
    <Modal
      open={Boolean(installation)}
      onClose={close}
      title="Export modpack"
      subtitle={
        installation
          ? `${installation.name} · Minecraft ${installation.versionId} · everything can be shared as a .mrpack`
          : undefined
      }
      size="wide"
      footer={
        <>
          <span className="text-dim">
            {preview ? `${preview.downloadable + preview.bundled + (includeWorlds ? preview.worldFiles : 0)} files selected` : ''}
          </span>
          <Button variant="ghost" onClick={close} disabled={exporting || loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Archive />}
            loading={exporting}
            disabled={!preview || loading}
            onClick={() => void start()}
          >
            {exporting ? 'Exporting…' : 'Choose destination & export'}
          </Button>
        </>
      }
    >
      <div className="install-dialog">
        {error ? (
          <div className="callout callout--danger" role="alert">
            <AlertTriangle />
            <span>{error}</span>
          </div>
        ) : null}

        {loading && !preview ? (
          <div className="health-loading">
            <Spinner /> Matching installed files and reading sizes…
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 16 }}>{preview.name}</strong>
                <Badge tone="info">{preview.loader.type === 'vanilla' ? 'Vanilla' : `${preview.loader.type} ${preview.loader.version || ''}`}</Badge>
              </div>
              <div className="text-dim" style={{ marginTop: 8 }}>
                Minecraft {preview.minecraftVersion} · pack version {preview.versionId}
              </div>
            </div>

            <div className="install-dialog__top">
              <div className="panel" style={{ padding: 14 }}>
                <div className="text-dim">Re-downloadable</div>
                <strong style={{ fontSize: 20 }}>{preview.downloadable.toLocaleString()} files</strong>
                <div className="text-dim">{formatBytes(preview.downloadableBytes)}</div>
              </div>
              <div className="panel" style={{ padding: 14 }}>
                <div className="text-dim">Bundled overrides</div>
                <strong style={{ fontSize: 20 }}>{preview.bundled.toLocaleString()} files</strong>
                <div className="text-dim">{formatBytes(preview.bundledBytes)}</div>
              </div>
            </div>

            <div className="panel" style={{ padding: 14 }}>
              <Checkbox checked={includeWorlds} onChange={(checked) => void load(checked)} disabled={exporting || loading}>
                Include worlds ({preview.worldFiles.toLocaleString()} files · {formatBytes(preview.worldBytes)})
              </Checkbox>
              <p className="text-dim" style={{ marginTop: 8 }}>
                Worlds are excluded by default. Including them can make the pack much larger; source files stay
                untouched.
              </p>
            </div>

            {includeWorlds && preview.worldFiles > 0 ? (
              <div className="callout callout--warning">
                <AlertTriangle />
                <span>{formatBytes(preview.worldBytes)} of worlds will be bundled under overrides/saves/.</span>
              </div>
            ) : null}

            {preview.warnings.map((warning) => (
              <div key={warning} className="callout callout--warning">
                <AlertTriangle />
                <span>{warning}</span>
              </div>
            ))}

            <div className="text-dim">
              Matched Modrinth files are listed as verified downloads. Everything else is bundled under{' '}
              <span className="mono">overrides/</span>.
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
