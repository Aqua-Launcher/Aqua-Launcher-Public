import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, Loader2, Package, RefreshCw } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import type { ContentFileDetail, ModrinthContentType } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const LOADER_LABELS: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

export function ModFileInspector({
  installationId,
  contentType,
  filename,
  onClose,
}: {
  installationId: string | null
  contentType: ModrinthContentType
  filename: string
  onClose: () => void
}) {
  const { pushToast } = useLauncher()
  const [detail, setDetail] = useState<ContentFileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!installationId) {
      setError('Choose an installation before inspecting files.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setDetail(await api.content.file(installationId, contentType, filename))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [contentType, filename, installationId])

  useEffect(() => {
    void load()
  }, [load])

  const openFolder = async () => {
    if (!installationId) return
    try {
      await api.mods.openFolder(installationId, contentType)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open the folder', message: getErrorMessage(openError) })
    }
  }

  const metadata = detail?.metadata
  const title = metadata?.name || detail?.filename || filename

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={detail?.enabled === false ? 'Disabled file' : 'Local file inspector'}
      size="wide"
      className="mod-inspector-drawer"
      footer={
        <>
          <Button variant="ghost" icon={<FolderOpen />} onClick={() => void openFolder()}>
            Open folder
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="mod-inspector">
        <div className="mod-inspector__file">
          <span className="mod-inspector__icon">
            <Package />
          </span>
          <span>
            <strong>{detail?.filename || filename}</strong>
            <small>
              {detail ? formatBytes(detail.sizeBytes) : 'Reading file…'}
              {detail ? ` · Installed ${new Date(detail.mtimeMs).toLocaleString()}` : ''}
            </small>
          </span>
          {detail ? <Badge tone={detail.enabled ? 'success' : 'warning'}>{detail.enabled ? 'Enabled' : 'Disabled'}</Badge> : null}
        </div>

        {loading ? (
          <div className="mods-loading">
            <Loader2 className="spin" /> Reading local metadata…
          </div>
        ) : error ? (
          <div className="callout callout--danger" role="alert">
            <AlertTriangle />
            <span>{error}</span>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : detail ? (
          <>
            {!metadata ? (
              <div className="callout callout--warning">
                <AlertTriangle />
                <span>
                  {detail.reason || 'No readable metadata was found.'} The launcher will show the filename until this jar
                  contains a Fabric, Quilt, Forge, NeoForge, or legacy manifest.
                </span>
              </div>
            ) : null}

            <dl className="mod-inspector__grid">
              <div>
                <dt>File name</dt>
                <dd>{detail.filename}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(detail.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Installed</dt>
                <dd>{new Date(detail.mtimeMs).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd title={detail.directory}>{detail.directory}</dd>
              </div>
              <div>
                <dt>Mod ID</dt>
                <dd>{metadata?.modId || '—'}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{metadata?.version || '—'}</dd>
              </div>
              <div>
                <dt>Loader</dt>
                <dd>{metadata?.loader ? LOADER_LABELS[metadata.loader] || metadata.loader : '—'}</dd>
              </div>
              <div>
                <dt>Minecraft range</dt>
                <dd>{metadata?.mcRange || '—'}</dd>
              </div>
              <div>
                <dt>Authors</dt>
                <dd>{metadata?.authors?.length ? metadata.authors.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Required dependencies</dt>
                <dd>{metadata?.requiredDependencies?.length ? metadata.requiredDependencies.join(', ') : '—'}</dd>
              </div>
            </dl>

            {detail.raw ? (
              <section className="mod-inspector__raw">
                <div className="mod-inspector__raw-head">
                  <strong>Raw manifest</strong>
                  <span>{detail.raw.source}</span>
                </div>
                <pre>{detail.raw.content}</pre>
              </section>
            ) : (
              <p className="mod-inspector__hint">This file has no raw manifest to display.</p>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
