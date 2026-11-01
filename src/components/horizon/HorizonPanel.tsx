import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Play,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes, formatEta, relativeTime, shortPath } from '../../lib/format'
import type {
  HorizonBuild,
  HorizonFolderKind,
  HorizonInstallJob,
  HorizonReleaseCatalog,
  HorizonStatus,
} from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, ProgressBar, Spinner } from '../ui/primitives'

interface HorizonPanelProps {
  status: HorizonStatus | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

const ACTIVE_STATUSES: HorizonInstallJob['status'][] = ['queued', 'running', 'cancelling']

function releaseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : null
}

export function HorizonPanel({ status, loading, error, onRefresh }: HorizonPanelProps) {
  const { pushToast, horizonTarget, launchHorizon, launchingHorizonTag, selectHorizonTarget } = useLauncher()
  const [catalog, setCatalog] = useState<HorizonReleaseCatalog | null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState('')
  const [job, setJob] = useState<HorizonInstallJob | null>(status?.install || null)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const loadReleases = useCallback(async (force = false) => {
    setReleasesLoading(true)
    setReleaseError(null)
    try {
      const result = await api.horizon.releases({ force })
      setCatalog(result)
      if (result.error) setReleaseError(result.error)
    } catch (releaseFailure) {
      setReleaseError(getErrorMessage(releaseFailure))
    } finally {
      setReleasesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReleases(false)
  }, [loadReleases])

  useEffect(() => {
    if (status?.install) setJob(status.install)
  }, [status?.install])

  useEffect(() => {
    const releases = catalog?.releases || []
    if (!releases.length) {
      if (selectedTag) setSelectedTag('')
      return
    }
    if (!releases.some((release) => release.tag === selectedTag)) {
      setSelectedTag(releases[0].tag)
    }
  }, [catalog, selectedTag])

  useEffect(() => {
    const unsubscribe = api.events.subscribe((event) => {
      if (event.type !== 'horizon-install') return
      const next = event.payload as HorizonInstallJob
      setJob(next)
      if (next.status === 'completed') {
        pushToast({
          level: 'success',
          title: `Horizon ${next.tag} installed`,
          message: next.gameVersion ? `Minecraft ${next.gameVersion} is ready to play.` : 'The build is ready to play.',
        })
        setJob(null)
        refreshRef.current()
      } else if (next.status === 'failed') {
        pushToast({
          level: 'error',
          title: 'Horizon installation failed',
          message: next.error || 'The installation did not finish.',
        })
        setJob(null)
        refreshRef.current()
      } else if (next.status === 'cancelled') {
        pushToast({ level: 'info', title: 'Horizon installation cancelled' })
        setJob(null)
        refreshRef.current()
      }
    })
    return unsubscribe
  }, [pushToast])

  const selectedBuild =
    (horizonTarget && status?.builds.find((build) => build.tag === horizonTarget.tag)) ||
    status?.builds.find((build) => build.tag === status.selectedTag) ||
    status?.builds[0] ||
    null
  const selectedRelease = catalog?.releases.find((release) => release.tag === selectedTag) || null
  const activeJob = Boolean(job && ACTIVE_STATUSES.includes(job.status))
  const canInstall = Boolean(status?.supported && selectedTag && !activeJob)

  // A build removed outside this panel must not stay as the dashboard target.
  useEffect(() => {
    if (!status || !horizonTarget) return
    if (!status.builds.some((build) => build.tag === horizonTarget.tag)) selectHorizonTarget(null)
  }, [horizonTarget, selectHorizonTarget, status])

  const refreshAll = () => {
    refreshRef.current()
    void loadReleases(true)
  }

  const targetBuild = (build: HorizonBuild) => {
    selectHorizonTarget(build)
    pushToast({
      level: 'info',
      title: 'Horizon is now the Play target',
      message: `${build.tag} will launch from the dashboard. Shift-click Play here to launch it now.`,
    })
  }

  const install = async () => {
    if (!selectedTag) return
    try {
      const started = await api.horizon.install(selectedTag)
      setJob(started)
    } catch (installError) {
      pushToast({ level: 'error', title: 'Horizon could not install', message: getErrorMessage(installError) })
    }
  }

  const cancelInstall = async () => {
    try {
      const cancelled = await api.horizon.cancelInstall()
      setJob(cancelled)
    } catch (cancelError) {
      pushToast({ level: 'error', title: 'Could not cancel the installation', message: getErrorMessage(cancelError) })
    }
  }

  const openFolder = async (kind: HorizonFolderKind, version: string | null = null) => {
    try {
      await api.horizon.openFolder(kind, version)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(openError) })
    }
  }

  const openExternal = async (url: string | null | undefined) => {
    if (!url) return
    try {
      await api.openExternal(url)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open that link', message: getErrorMessage(openError) })
    }
  }

  const installCard = (
    <section className="horizon-install">
      <div className="horizon-install__head">
        <div>
          <h3>
            <Download /> {status?.builds.length ? 'Install another build' : 'Install Horizon'}
          </h3>
          <p>
            Aqua downloads Horizon’s own release, provisions Minecraft {status?.gameVersion || '26.3'} and the Java
            runtime it pins, runs Horizon’s bundled preparer, then starts the Rust client. The Horizon launcher is
            never used. Minecraft and Java are reused when Aqua already has them, so reinstalling a build is much
            smaller than the first install.
          </p>
        </div>
      </div>

      <div className="horizon-install__controls">
        <label className="horizon-install__release">
          <span>Release</span>
          <div className="select-wrap">
            <select
              className="select"
              value={selectedTag}
              onChange={(event) => setSelectedTag(event.target.value)}
              disabled={!catalog?.releases.length || activeJob}
            >
              {(catalog?.releases || []).map((release) => {
                const date = releaseDate(release.publishedAt)
                return (
                  <option value={release.tag} key={release.tag}>
                    {release.tag}
                    {date ? ` · ${date}` : ''}
                  </option>
                )
              })}
            </select>
          </div>
        </label>
        <Button
          variant="primary"
          icon={<Download />}
          onClick={() => void install()}
          disabled={!canInstall}
          loading={releasesLoading && !catalog}
        >
          {status?.builds.length ? 'Install build' : 'Install Horizon'}
        </Button>
        {selectedRelease?.notesUrl ? (
          <Button variant="ghost" icon={<ExternalLink />} onClick={() => void openExternal(selectedRelease.notesUrl)}>
            Release notes
          </Button>
        ) : null}
      </div>

      {selectedRelease ? (
        <div className="horizon-install__meta">
          <span>
            {selectedRelease.assetName}
            {selectedRelease.assetSize ? ` · ${formatBytes(selectedRelease.assetSize)}` : ''}
          </span>
          <span>
            SHA-256 verified · downloads stay in{' '}
            <span className="mono">{shortPath(status?.downloadsDirectory || '', 52)}</span>
          </span>
        </div>
      ) : releasesLoading ? (
        <div className="horizon-loading">
          <Spinner />
          <span>Checking Horizon releases…</span>
        </div>
      ) : releaseError ? (
        <div className="callout callout--warning">
          <TriangleAlert />
          <div>
            <strong>Could not load Horizon releases</strong>
            <span>{releaseError}</span>
            <div className="horizon-actions">
              <Button size="sm" icon={<RefreshCw />} onClick={() => void loadReleases(true)}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="callout callout--warning">
          <TriangleAlert />
          <span>No installable Horizon game releases were found for {status?.supportedReason || 'this platform'}.</span>
        </div>
      )}

      {job ? (
        <div className="horizon-install-job">
          <div className="horizon-install-job__head">
            <span>
              {job.stage}
              {job.tag ? ` · ${job.tag}` : ''}
            </span>
            <span>{job.progress != null ? `${Math.round(job.progress)}%` : ''}</span>
          </div>
          <ProgressBar value={job.progress} label="Horizon installation progress" thin />
          <div className="horizon-install-job__meta">
            <span className="horizon-install-job__message">{job.message || job.currentFile || ''}</span>
            <span>
              {job.bytesTotal > 0 ? `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}` : ''}
              {job.speedBps > 0 ? ` · ${formatBytes(job.speedBps)}/s` : ''}
              {job.etaSeconds != null && job.etaSeconds > 0 ? ` · ${formatEta(job.etaSeconds)} left` : ''}
            </span>
          </div>
          {activeJob ? (
            <div className="horizon-actions">
              <Button
                size="sm"
                variant="ghost"
                icon={<X />}
                loading={job.status === 'cancelling'}
                onClick={() => void cancelInstall()}
              >
                Cancel installation
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )

  return (
    <section className="panel horizon-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-head__title horizon-title">
            Horizon <Badge tone="info">Rust Edition</Badge>
          </h2>
          <p className="panel-head__subtitle">
            Minecraft: Java Edition {status?.gameVersion || '26.3'}
            {status?.drop ? ` (${status.drop})` : ''} rebuilt in Rust. Aqua owns the whole install and starts
            the client directly.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className={loading || releasesLoading ? 'spin' : undefined} />}
          onClick={refreshAll}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      <div className="horizon-body">
        {error ? (
          <div className="callout callout--danger" role="alert">
            <TriangleAlert />
            <span>{error}</span>
          </div>
        ) : null}

        {!status && loading ? (
          <div className="horizon-loading">
            <Spinner />
            <span>Looking for Horizon…</span>
          </div>
        ) : null}

        {status && !status.supported ? (
          <div className="callout callout--warning">
            <TriangleAlert />
            <div>
              <strong>Horizon is not available for this platform</strong>
              <span>{status.supportedReason}</span>
            </div>
          </div>
        ) : null}

        {status?.supported && !status.builds.length ? (
          <>
            <div className="callout horizon-callout">
              <Cpu />
              <div>
                <strong>Horizon is installed by Aqua</strong>
                <span>
                  There is no launcher to fetch first. Pick a release below and Aqua downloads the open-source Rust
                  client, prepares its resources from your own Minecraft copy, and starts it directly.
                </span>
                <span className="text-dim">
                  Game folder: <span className="mono">{shortPath(status.gameHome, 64)}</span>
                </span>
              </div>
            </div>
            {installCard}
          </>
        ) : null}

        {status?.supported && selectedBuild ? (
          <>
            <div className="horizon-hero">
              <span className="horizon-hero__icon" aria-hidden="true">
                <Cpu />
              </span>
              <div className="horizon-hero__copy">
                <h3>
                  Horizon <Badge tone="info">Minecraft {selectedBuild.gameVersion}</Badge>
                </h3>
                <p>
                  Minecraft {selectedBuild.gameVersion}
                  {status.drop ? ` · ${status.drop}` : ''} · build{' '}
                  <span className="mono">{selectedBuild.tag}</span>
                </p>
              </div>
              {horizonTarget?.tag === selectedBuild.tag ? <Badge tone="info">Play target</Badge> : null}
              <Badge tone={selectedBuild.prepared ? 'success' : 'warning'}>
                {selectedBuild.prepared ? 'Ready to play' : 'Needs preparation'}
              </Badge>
            </div>

            <dl className="horizon-facts">
              <div>
                <dt>Game folder</dt>
                <dd title={status.gameHome}>{shortPath(status.gameHome, 44)}</dd>
              </div>
              <div>
                <dt>Installed builds</dt>
                <dd>{status.builds.length}</dd>
              </div>
              <div>
                <dt>Worlds</dt>
                <dd>{status.worlds}</dd>
              </div>
            </dl>

            <div className="horizon-actions">
              <Button
                variant="primary"
                icon={<Play />}
                loading={launchingHorizonTag === selectedBuild.tag}
                disabled={!selectedBuild.prepared}
                title={
                  selectedBuild.prepared
                    ? 'Set as the Play target · Shift-click to launch now'
                    : 'Install this build again to finish preparation.'
                }
                onClick={(event) => {
                  if (event.shiftKey) void launchHorizon(selectedBuild, { keepTarget: true })
                  else targetBuild(selectedBuild)
                }}
              >
                Play
              </Button>
              <Button icon={<FolderOpen />} onClick={() => void openFolder('game')}>
                Game folder
              </Button>
              <Button icon={<FolderOpen />} onClick={() => void openFolder('worlds')}>
                Worlds
              </Button>
              <Button icon={<FolderOpen />} onClick={() => void openFolder('builds')}>
                Builds
              </Button>
              <Button icon={<FolderOpen />} onClick={() => void openFolder('downloads')}>
                Downloads
              </Button>
            </div>

            {!selectedBuild.prepared ? (
              <div className="callout callout--warning">
                <TriangleAlert />
                <span>
                  This build’s resources are missing. Install {selectedBuild.tag} again so Aqua can run Horizon’s
                  preparer and write the files the Rust client needs.
                </span>
              </div>
            ) : null}

            {selectedBuild.warning ? (
              <div className="callout callout--warning">
                <TriangleAlert />
                <span>{selectedBuild.warning}</span>
              </div>
            ) : null}

            <div className="horizon-builds">
              <div className="horizon-builds__head">
                <h3>Installed builds</h3>
                <span className="text-dim">Installed and prepared by Aqua</span>
              </div>
              {status.builds.map((build) => (
                <div className="horizon-build-row" key={build.tag}>
                  <div className="horizon-build-row__copy">
                    <div className="horizon-build-row__title">
                      <span className="mono">{build.tag}</span>
                      {build.selected ? <Badge tone="info">Latest</Badge> : null}
                      {horizonTarget?.tag === build.tag ? <Badge tone="info">Play target</Badge> : null}
                      <Badge tone={build.prepared ? 'success' : 'warning'}>
                        {build.prepared ? 'Prepared' : 'Needs preparation'}
                      </Badge>
                    </div>
                    <span className="horizon-build-row__meta">
                      Minecraft {build.gameVersion}
                      {build.installedAt ? ` · installed ${relativeTime(build.installedAt)}` : ''}
                      {build.javaMajor ? ` · Java ${build.javaMajor}` : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={horizonTarget?.tag === build.tag ? 'primary' : 'default'}
                    icon={<Play />}
                    loading={launchingHorizonTag === build.tag}
                    disabled={!build.prepared}
                    title={
                      build.prepared
                        ? 'Set as the Play target · Shift-click to launch now'
                        : 'Install this build again to finish preparation.'
                    }
                    onClick={(event) => {
                      if (event.shiftKey) void launchHorizon(build, { keepTarget: true })
                      else targetBuild(build)
                    }}
                  >
                    Play
                  </Button>
                  <Button
                    size="sm"
                    icon={<FolderOpen />}
                    onClick={() => void openFolder('build', build.tag)}
                  >
                    Open folder
                  </Button>
                </div>
              ))}
            </div>

            {installCard}
          </>
        ) : null}

        {status?.supported && !status.builds.length && status.install === null ? (
          <div className="horizon-footnote">
            <CheckCircle2 />
            <span>
              Horizon is open source. Aqua keeps its build, downloads, and game home in its own data folder, so
              removing Horizon’s launcher does not affect this install. <button
                type="button"
                className="link-button"
                onClick={() => void openExternal(status.siteUrl)}
              >
                About Horizon
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
