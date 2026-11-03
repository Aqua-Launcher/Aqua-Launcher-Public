import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type {
  ModrinthContentType,
  ModrinthHit,
  ModrinthProjectDetail,
  ModrinthVersion,
} from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

type Tab = 'overview' | 'versions' | 'dependencies'

function formatDownloads(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

function showDate(value: string | null) {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Unknown date'
}

function dependencyTone(type: string) {
  if (type === 'incompatible') return 'danger' as const
  return 'default' as const
}

export function ModDetailDrawer({
  projectId,
  hit,
  contentType,
  installationId,
  gameVersion,
  loader,
  worldFolder = null,
  onClose,
  onInstalled,
}: {
  projectId: string
  hit?: ModrinthHit | null
  contentType: ModrinthContentType
  installationId: string | null
  gameVersion: string | null
  loader: string | null
  worldFolder?: string | null
  onClose: () => void
  onInstalled: () => void | Promise<void>
}) {
  const { pushToast } = useLauncher()
  const [tab, setTab] = useState<Tab>('overview')
  const [project, setProject] = useState<ModrinthProjectDetail | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [allVersions, setAllVersions] = useState(false)
  const [loading, setLoading] = useState(true)
  const [versionsLoading, setVersionsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [installingVersion, setInstallingVersion] = useState<string | null>(null)

  const loadProject = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProject(await api.mods.project(projectId))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true)
    setVersionsError(null)
    try {
      const filteredLoader = contentType === 'mod' ? loader : null
      setVersions(
        await api.mods.versions(projectId, {
          gameVersion: allVersions ? null : gameVersion,
          loader: allVersions ? null : filteredLoader,
        }),
      )
    } catch (loadError) {
      setVersionsError(getErrorMessage(loadError))
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }, [allVersions, contentType, gameVersion, loader, projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  const install = async (version: ModrinthVersion) => {
    setInstallingVersion(version.id)
    try {
      if (contentType === 'modpack') {
        await api.mods.installModpack(projectId, version.id)
        pushToast({
          level: 'success',
          title: 'Modpack installation started',
          message: `${project?.title || hit?.title || 'The pack'} is being set up as a new installation.`,
        })
      } else {
        if (!installationId) throw new Error('Choose an installation before installing content.')
        if (contentType === 'datapack' && !worldFolder) throw new Error('Choose a world before installing a datapack.')
        const result = await api.mods.install(installationId, projectId, version.id, contentType, worldFolder)
        pushToast({
          level: result.warnings?.length ? 'warning' : 'success',
          title: `Installed ${project?.title || hit?.title || version.name}`,
          message: result.warnings?.[0] || `${version.versionNumber || version.name} · required dependencies are included.`,
        })
      }
      await onInstalled()
      onClose()
    } catch (installError) {
      pushToast({ level: 'error', title: 'Could not install that version', message: getErrorMessage(installError) })
    } finally {
      setInstallingVersion(null)
    }
  }

  const activeVersion = versions[0] || null
  const dependencies = activeVersion?.dependencies || []
  const title = project?.title || hit?.title || 'Project details'
  const links = [
    ['Source', project?.sourceUrl],
    ['Issues', project?.issuesUrl],
    ['Wiki', project?.wikiUrl],
    ['Discord', project?.discordUrl],
    ['License', project?.license?.url],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="mod-detail__title">
          <span className="mod-detail__icon">
            {project?.iconUrl || hit?.iconUrl ? (
              <img src={project?.iconUrl || hit?.iconUrl || ''} alt="" />
            ) : (
              <Package />
            )}
          </span>
          <span>
            {title}
            <small>
              by {hit?.author || 'Modrinth'} · {formatDownloads(project?.downloads ?? hit?.downloads ?? 0)} downloads
            </small>
          </span>
        </span>
      }
      subtitle={contentType === 'modpack' ? 'Installs as its own profile' : undefined}
      size="wide"
      className="mod-detail-drawer"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="mod-detail">
        <div className="mod-detail__tabs" role="tablist" aria-label="Project details">
          {(['overview', 'versions', 'dependencies'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'is-active' : undefined}
              onClick={() => setTab(value)}
            >
              {value === 'overview' ? 'Overview' : value === 'versions' ? `Versions${versions.length ? ` (${versions.length})` : ''}` : 'Dependencies'}
            </button>
          ))}
        </div>

        {error && !project ? (
          <div className="callout callout--danger" role="alert">
            <AlertTriangle />
            <span>{error}</span>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => void loadProject()}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading && !project ? (
          <div className="mods-loading">
            <Spinner /> Loading project details…
          </div>
        ) : null}

        {project && tab === 'overview' ? (
          <div className="mod-detail__section">
            <p className="mod-detail__summary">{project.description}</p>
            {project.gallery.length ? (
              <div className="mod-detail__gallery">
                {project.gallery.slice(0, 3).map((image) => (
                  <figure key={image.url}>
                    <img src={image.url} alt={image.title || ''} loading="lazy" />
                    {image.title ? <figcaption>{image.title}</figcaption> : null}
                  </figure>
                ))}
              </div>
            ) : null}
            <div className="mod-detail__badges">
              {project.categories.map((category) => (
                <Badge key={category}>{category}</Badge>
              ))}
              {project.clientSide ? <Badge>Client: {project.clientSide}</Badge> : null}
              {project.serverSide ? <Badge>Server: {project.serverSide}</Badge> : null}
              {project.license?.name ? <Badge>{project.license.name}</Badge> : null}
            </div>
            {project.body ? <div className="mod-detail__body">{project.body.slice(0, 20_000)}</div> : null}
            <div className="mod-detail__meta">
              <span>Published {showDate(project.published)}</span>
              <span>Updated {showDate(project.updated)}</span>
              <span>{project.followers.toLocaleString()} followers</span>
            </div>
            {links.length ? (
              <div className="mod-detail__actions">
                {links.map(([label, url]) => (
                  <Button
                    key={label}
                    size="sm"
                    variant="ghost"
                    icon={<ExternalLink />}
                    onClick={() => void api.openExternal(url).catch((error) => pushToast({ level: 'error', title: 'Could not open that link', message: getErrorMessage(error) }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'versions' ? (
          <div className="mod-detail__section">
            <div className="mod-detail__toolbar">
              <span className="mod-detail__hint">
                {allVersions
                  ? 'Showing every published version.'
                  : `Compatible with ${gameVersion || 'this profile'}${contentType === 'mod' && loader ? ` on ${loader}` : ''}.`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setAllVersions((value) => !value)}>
                {allVersions ? 'Only compatible' : 'All versions'}
              </Button>
            </div>
            {versionsLoading ? (
              <div className="mods-loading">
                <Spinner /> Loading versions…
              </div>
            ) : versionsError ? (
              <div className="callout callout--danger" role="alert">
                <AlertTriangle />
                <span>{versionsError}</span>
                <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => void loadVersions()}>
                  Retry
                </Button>
              </div>
            ) : versions.length ? (
              <ul className="mod-detail__versions">
                {versions.map((version) => (
                  <li key={version.id} className="mod-detail__version">
                    <div className="mod-detail__version-copy">
                      <strong>{version.name}</strong>
                      <span>
                        {version.versionNumber} · {version.versionType} · {showDate(version.datePublished)}
                      </span>
                      <span className="mod-detail__version-tags">
                        <Badge>{version.gameVersions.slice(0, 2).join(', ') || 'No game version'}</Badge>
                        {version.loaders.slice(0, 2).map((entry) => (
                          <Badge key={entry}>
                            {entry}
                          </Badge>
                        ))}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={installingVersion === version.id ? <Loader2 className="spin" /> : <Download />}
                      disabled={Boolean(installingVersion)}
                      onClick={() => void install(version)}
                    >
                      {installingVersion === version.id ? 'Installing…' : 'Install'}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mod-detail__empty">
                <ArrowUpCircle />
                <strong>No versions match this profile</strong>
                <span>Try “All versions” to see releases for other Minecraft versions or loaders.</span>
              </div>
            )}
          </div>
        ) : null}

        {tab === 'dependencies' ? (
          <div className="mod-detail__section">
            {dependencies.length ? (
              <ul className="mod-detail__dependencies">
                {dependencies.map((dependency, index) => (
                  <li key={`${dependency.projectId}-${index}`}>
                    <span>
                      <strong>{dependency.projectId}</strong>
                      {dependency.versionId ? <small>Version {dependency.versionId}</small> : null}
                    </span>
                    <Badge tone={dependencyTone(dependency.dependencyType)}>{dependency.dependencyType}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mod-detail__empty">
                <Package />
                <strong>No declared dependencies</strong>
                <span>The latest matching version does not list required projects.</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
