import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  Coffee,
  Cpu,
  Download,
  FolderOpen,
  Gamepad2,
  Globe2,
  History,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { bedrockDropVersion, HORIZON_DROP_VERSION } from '../lib/artwork'
import { useNow } from '../lib/hooks'
import {
  elapsedSince,
  formatEta,
  formatPlaytime,
  relativeTime,
  shortPath,
  versionTypeLabel,
} from '../lib/format'
import { MICROSOFT_AUTH_ENABLED } from '../lib/features'
import { loaderLabel } from '../lib/loaders'
import { useLauncher } from '../state/LauncherProvider'
import type { ActivityEntry, DownloadJob, Installation, LoaderType, ServerEntry } from '../lib/types'
import { LoaderMark, PackIcon, VoxelScene } from '../components/brand/Brand'
import { TitleArtwork, useHeroArtwork } from '../components/brand/Artwork'
import { AccountSwitcherToggle } from '../components/home/AccountSwitcherToggle'
import { PageHeader } from '../components/layout/PageHeader'
import { ActionMenu } from '../components/ui/Menu'
import { EmptyState, Spinner, cx } from '../components/ui/primitives'

function greetingForHour(hour: number) {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function activityIcon(entry: ActivityEntry) {
  switch (entry.type) {
    case 'game':
      return <Gamepad2 />
    case 'install':
      return <Download />
    case 'installation':
      return <Layers />
    case 'account':
      return <UserRound />
    case 'java':
      return <Coffee />
    case 'world':
      return <Globe2 />
    default:
      return <History />
  }
}

function findInstallJob(jobs: DownloadJob[], installationId: string | undefined) {
  if (!installationId) return null
  return (
    jobs.find(
      (job) => job.type === 'install' && job.installationId === installationId && (job.status === 'running' || job.status === 'queued'),
    ) || null
  )
}

export function HomePage() {
  const {
    data,
    settings,
    installations,
    activeAccount,
    selectedInstallation,
    activity,
    jobs,
    game,
    launchingId,
    versions,
    navigate,
    openInstallDialog,
    play,
    joinServer,
    installGame,
    launchGame,
    pushToast,
    openInstallationFolder,
    bedrock,
    launchBedrock,
    bedrockTarget,
    horizonTarget,
    launchHorizon,
    launchingHorizonTag,
  } = useLauncher()

  const gameRunning = game.status === 'running'
  const gamePreparing = game.status === 'preparing'
  // Bedrock and Horizon run outside the launcher's process tracking, so they
  // never report a running game; the hero simply points Play at the target.
  const targetIsBedrock = Boolean(bedrockTarget)
  const targetIsHorizon = !targetIsBedrock && Boolean(horizonTarget)
  const targetIsJava = !targetIsBedrock && !targetIsHorizon
  // Bedrock builds carry their own numbers, so the hero asks for the Java drop
  // they belong to. Horizon follows one drop for now; its build names it.
  const heroVersion = targetIsJava
    ? selectedInstallation?.versionId
    : targetIsBedrock
      ? bedrockDropVersion(bedrockTarget?.version)
      : horizonTarget
        ? horizonTarget.gameVersion || HORIZON_DROP_VERSION
        : null
  const heroArtwork = useHeroArtwork(heroVersion)
  useNow(gameRunning || gamePreparing)

  const [dashboardBackground, setDashboardBackground] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!settings?.dashboardBackground) {
      setDashboardBackground(null)
      return
    }
    setDashboardBackground(null)
    void api.screenshots
      .background()
      .then((result) => {
        if (!cancelled) setDashboardBackground(result.dataUrl)
      })
      .catch(() => {
        if (!cancelled) setDashboardBackground(null)
      })
    return () => {
      cancelled = true
    }
  }, [settings?.dashboardBackground])

  // A chosen screenshot owns the dashboard, so it replaces the release artwork
  // in the hero instead of sitting unseen behind it.
  const heroImage = dashboardBackground || heroArtwork

  const [recentServers, setRecentServers] = useState<ServerEntry[]>([])

  const loadRecentServers = useCallback(async () => {
    try {
      const list = await api.servers.list()
      setRecentServers([...list])
    } catch {
      // If the server list cannot be read, Recently played still shows installations.
      setRecentServers([])
    }
  }, [])

  useEffect(() => {
    void loadRecentServers()
  }, [loadRecentServers])

  const openBedrockFolder = useCallback(
    async (editionId: string) => {
      try {
        await api.bedrock.openFolder(editionId)
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not open the data folder', message: getErrorMessage(error) })
      }
    },
    [pushToast],
  )

  const openHorizonFolder = useCallback(
    async (kind: 'game' | 'worlds') => {
      try {
        await api.horizon.openFolder(kind)
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(error) })
      }
    },
    [pushToast],
  )

  const handleRecentServer = async (server: ServerEntry) => {
    const joined = await joinServer(
      server.id,
      server.connectAddress || server.address,
      server.edition === 'bedrock' ? 'bedrock' : 'java',
      { installationId: server.installationId, serverName: server.name },
    )
    if (joined) void loadRecentServers()
  }

  const loaderType: LoaderType = targetIsJava ? selectedInstallation?.loader?.type || 'vanilla' : 'vanilla'
  const installJob = targetIsJava ? findInstallJob(jobs, selectedInstallation?.id) : null
  const otherGameRunning = targetIsJava && gameRunning && game.installationId !== selectedInstallation?.id
  const isPlayingSelected = targetIsJava && gameRunning && game.installationId === selectedInstallation?.id
  const isPreparingSelected =
    targetIsJava &&
    ((gamePreparing && game.installationId === selectedInstallation?.id) || launchingId === selectedInstallation?.id)
  const recentItems = useMemo(() => {
    const playedInstallations = installations
      .filter((installation) => installation.lastPlayedAt)
      .map((installation) => ({
        kind: 'installation' as const,
        at: installation.lastPlayedAt as string,
        installation,
      }))
    const playedServers = recentServers
      .filter((server) => server.lastJoinedAt)
      .map((server) => ({ kind: 'server' as const, at: server.lastJoinedAt as string, server }))
    return [...playedInstallations, ...playedServers]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6)
  }, [installations, recentServers])

  const recentActivity = activity.slice(0, 5)
  const hour = new Date().getHours()
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  let playLabel = 'Play'
  let playIcon = <Play />
  let playBusy = false
  if (targetIsBedrock) {
    playLabel = 'Play'
    playIcon = <Boxes />
  } else if (targetIsHorizon) {
    if (launchingHorizonTag === horizonTarget?.tag) {
      playLabel = 'Launching'
      playIcon = <Spinner label="Launching Horizon" />
      playBusy = true
    } else {
      playLabel = 'Play'
      playIcon = <Cpu />
    }
  } else if (installJob) {
    playLabel = installJob.progress != null ? `Installing ${installJob.progress}%` : 'Installing'
    playIcon = <Download />
    playBusy = true
  } else if (isPreparingSelected) {
    playLabel = 'Launching'
    playIcon = <Spinner label="Launching Minecraft" />
    playBusy = true
  } else if (isPlayingSelected) {
    playLabel = 'In game'
    playIcon = <Gamepad2 />
  } else if (selectedInstallation && !selectedInstallation.installed) {
    playLabel = 'Install & play'
    playIcon = <Download />
  }

  // The panel narrates live activity only: the pill above it already says which
  // installation is selected and whether it is installed.
  const showPlayStatus =
    Boolean(installJob) ||
    isPreparingSelected ||
    isPlayingSelected ||
    otherGameRunning ||
    (!selectedInstallation && !bedrockTarget && !horizonTarget)

  const handlePlay = () => {
    if (bedrockTarget) {
      void launchBedrock(bedrockTarget.id)
      return
    }
    if (horizonTarget) {
      void launchHorizon(horizonTarget)
      return
    }
    if (!selectedInstallation) return
    if (isPlayingSelected) {
      navigate('logs', { category: 'game', installationId: selectedInstallation.id })
      return
    }
    if (installJob) {
      navigate('installations')
      return
    }
    void play(selectedInstallation.id)
  }

  const subtitle = activeAccount
    ? 'Launch your Play target or manage installations, versions, and logs.'
    : MICROSOFT_AUTH_ENABLED
      ? 'Add an offline or Microsoft profile to launch the game. You can create an installation first if you prefer.'
      : 'Add an offline profile to launch the game. You can create an installation first if you prefer.'

  return (
    <div
      className={cx('page page--home', dashboardBackground && 'has-background')}
      style={
        dashboardBackground
          ? {
              backgroundImage: `linear-gradient(180deg, rgba(6, 10, 14, 0.48), rgba(6, 10, 14, 0.9)), url("${dashboardBackground}")`,
            }
          : undefined
      }
    >
      <section className={cx('hero', isPlayingSelected && 'is-playing', heroImage && 'hero--art')}>
        {heroImage ? (
          <div className="hero__artwork" style={{ backgroundImage: `url("${heroImage}")` }} aria-hidden="true" />
        ) : (
          <div className="hero__scene">
            <VoxelScene />
          </div>
        )}
        <div className="hero__grid">
          <PageHeader
            kicker={today}
            title={activeAccount ? `${greetingForHour(hour)}, ${activeAccount.name}` : greetingForHour(hour)}
            subtitle={subtitle}
            actions={
              selectedInstallation || bedrockTarget || horizonTarget ? (
                <div className="hero__play-actions">
                  <button
                    type="button"
                    className={cx('btn', 'btn--play', playBusy && 'is-busy', isPlayingSelected && 'is-running')}
                    onClick={handlePlay}
                    aria-label={playLabel}
                  >
                    {playIcon}
                    <span>{playLabel}</span>
                  </button>
                  {targetIsJava && selectedInstallation && selectedInstallation.installed && !installJob && !isPreparingSelected && !isPlayingSelected && !otherGameRunning ? (
                    <button
                      type="button"
                      className="btn btn--safe"
                      onClick={() => void launchGame(selectedInstallation.id, { safeMode: true })}
                      title="Launch without mods, resource packs, or shaders"
                    >
                      <ShieldCheck />
                      <span>Safe Mode</span>
                    </button>
                  ) : null}
                  {targetIsJava && selectedInstallation ? (
                    <AccountSwitcherToggle
                      key={selectedInstallation.id}
                      installation={selectedInstallation}
                      disabled={Boolean(installJob) || isPreparingSelected || isPlayingSelected || otherGameRunning}
                    />
                  ) : null}
                </div>
              ) : null
            }
          />

          <div className="hero__topline">
            <div className="hero__brandline">
              <TitleArtwork height="clamp(42px, 5vw, 64px)" />
            </div>
            <div className="hero__badges">
              {targetIsBedrock ? <span className="hero__tag hero__tag--bedrock">Bedrock Edition</span> : null}
              {targetIsHorizon ? <span className="hero__tag hero__tag--horizon">Horizon · Rust Edition</span> : null}
              {targetIsJava && selectedInstallation && selectedInstallation.versionType !== 'release' ? (
                <span className={cx('hero__tag', `hero__tag--${selectedInstallation.versionType}`)}>
                  {versionTypeLabel(selectedInstallation.versionType)}
                </span>
              ) : null}
              {targetIsJava && loaderType !== 'vanilla' ? (
                <span
                  className="hero__loader"
                  role="img"
                  aria-label={`${loaderLabel(loaderType)} mod loader`}
                  title={`${loaderLabel(loaderType)} mod loader`}
                >
                  <LoaderMark type={loaderType} size={56} />
                </span>
              ) : null}
            </div>
          </div>

          <div className="hero__body">
            {bedrockTarget ? (
              <div className="hero__installation">
                <button type="button" className="hero__installation-main" onClick={() => navigate('installations')}>
                  <span className="hero__installation-icon">
                    <Boxes size={20} />
                  </span>
                  <span className="hero__installation-copy">
                    <span className="hero__installation-name">{bedrockTarget.name}</span>
                    <span className="hero__installation-version">
                      {bedrockTarget.version ? `Bedrock ${bedrockTarget.version}` : 'Store edition'} · From the Microsoft
                      Store
                    </span>
                  </span>
                </button>
                <ActionMenu
                  label="Bedrock edition actions"
                  className="hero__installation-menu"
                  trigger={<Plus />}
                  items={[
                    {
                      label: 'Data folder',
                      icon: <FolderOpen />,
                      onSelect: () => void openBedrockFolder(bedrockTarget.id),
                    },
                  ]}
                />
              </div>
            ) : horizonTarget ? (
              <div className="hero__installation">
                <button type="button" className="hero__installation-main" onClick={() => navigate('installations')}>
                  <span className="hero__installation-icon">
                    <Cpu size={20} />
                  </span>
                  <span className="hero__installation-copy">
                    <span className="hero__installation-name">Horizon</span>
                    <span className="hero__installation-version">
                      Minecraft {horizonTarget.gameVersion} · Rust Edition · {horizonTarget.tag}
                    </span>
                  </span>
                </button>
                <ActionMenu
                  label="Horizon build actions"
                  className="hero__installation-menu"
                  trigger={<Plus />}
                  items={[
                    {
                      label: 'Worlds',
                      icon: <FolderOpen />,
                      onSelect: () => void openHorizonFolder('worlds'),
                    },
                    {
                      label: 'Game folder',
                      icon: <FolderOpen />,
                      onSelect: () => void openHorizonFolder('game'),
                    },
                  ]}
                />
              </div>
            ) : selectedInstallation ? (
              <div className="hero__installation">
                <button type="button" className="hero__installation-main" onClick={() => navigate('installations')}>
                  <span className="hero__installation-icon">
                    <PackIcon modpack={selectedInstallation.modpack} loader={loaderType} size={20} />
                  </span>
                  <span className="hero__installation-name">{selectedInstallation.name}</span>
                </button>
                <ActionMenu
                  label="Installation actions"
                  className="hero__installation-menu"
                  trigger={<Plus />}
                  items={[
                    {
                      label: 'Game folder',
                      icon: <FolderOpen />,
                      onSelect: () => void openInstallationFolder(selectedInstallation.id),
                    },
                    {
                      label: 'Verify files',
                      icon: <RefreshCw />,
                      disabled: Boolean(installJob || isPlayingSelected || isPreparingSelected || otherGameRunning),
                      onSelect: () => void installGame(selectedInstallation.id),
                    },
                  ]}
                />
              </div>
            ) : (
              <div className="hero__installation hero__installation--empty">
                <span className="hero__installation-icon">
                  <Layers />
                </span>
                <span className="hero__installation-copy">
                  <span className="hero__installation-name">No installation yet</span>
                  <span className="hero__installation-version">Create a profile to start playing</span>
                </span>
              </div>
            )}

            {showPlayStatus ? (
              <div className="hero__play-row">
                <div className="hero__play-copy">
                  {installJob ? (
                    <>
                      <div className="hero__play-title">
                        Downloading{' '}
                        {installJob.filesTotal
                          ? `${installJob.filesDone.toLocaleString()} / ${installJob.filesTotal.toLocaleString()} files`
                          : 'game files'}
                      </div>
                      <div className="hero__play-meta">
                        {installJob.stage}
                        {installJob.etaSeconds != null ? ` · ${formatEta(installJob.etaSeconds)} left` : ''}
                      </div>
                    </>
                  ) : isPreparingSelected ? (
                    <>
                      <div className="hero__play-title">{game.phase || 'Starting Minecraft'}</div>
                      <div className="hero__play-meta">Java and session checks are running.</div>
                    </>
                  ) : isPlayingSelected ? (
                    <>
                      <div className="hero__play-title">
                        Playing now · {elapsedSince(game.startedAt)}
                      </div>
                      <div className="hero__play-meta">Click to open your latest game log.</div>
                    </>
                  ) : otherGameRunning ? (
                    <>
                      <div className="hero__play-title">Minecraft is already running</div>
                      <div className="hero__play-meta">Close the game to start another installation.</div>
                    </>
                  ) : (
                    <>
                      <div className="hero__play-title">Set up your first installation</div>
                      <div className="hero__play-meta">Pick a version and your game will download automatically.</div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {bedrock?.editions.length ? (
        <section className="home-section">
          <div className="home-section__head">
            <h2>Bedrock Edition</h2>
            <button type="button" className="link-button" onClick={() => navigate('installations')}>
              Manage <ArrowRight />
            </button>
          </div>
          <div className="recent-grid">
            {bedrock.editions.map((edition) => (
              <button
                key={edition.id}
                type="button"
                className={cx('recent-card', bedrockTarget?.id === edition.id && 'is-active')}
                title={`Play ${edition.name}`}
                onClick={() => void launchBedrock(edition.id)}
              >
                <span className="recent-card__icon">
                  <Boxes />
                </span>
                <span className="recent-card__copy">
                  <span className="recent-card__name">{edition.name}</span>
                  <span className="recent-card__meta">
                    {edition.version ? `Bedrock ${edition.version}` : 'Store edition'} · Click to launch with your Xbox
                    profile
                  </span>
                </span>
                <ArrowRight className="recent-card__arrow" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recentItems.length > 0 ? (
        <section className="home-section">
          <div className="home-section__head">
            <h2>Recently played</h2>
            <button type="button" className="link-button" onClick={() => navigate('installations')}>
              All installations <ArrowRight />
            </button>
          </div>
          <div className="recent-grid">
            {recentItems.map((item) => {
              if (item.kind === 'server') {
                const { server } = item
                return (
                  <button
                    key={`server-${server.id}`}
                    type="button"
                    className="recent-card recent-card--server"
                    title={`Join ${server.name}`}
                    onClick={() => void handleRecentServer(server)}
                  >
                    <span className="recent-card__icon">
                      <Server />
                    </span>
                    <span className="recent-card__copy">
                      <span className="recent-card__name">{server.name}</span>
                      <span className="recent-card__meta">
                        {server.connectAddress || server.address} · Joined {relativeTime(server.lastJoinedAt)}
                      </span>
                    </span>
                    <ArrowRight className="recent-card__arrow" />
                  </button>
                )
              }
              const { installation } = item
              const isCurrent = gameRunning && game.installationId === installation.id
              return (
                <button
                  key={installation.id}
                  type="button"
                  className={cx('recent-card', targetIsJava && installation.isActive && 'is-active')}
                  onClick={() => {
                    if (isCurrent) navigate('logs', { category: 'game', installationId: installation.id })
                    else void play(installation.id)
                  }}
                >
                  <span className="recent-card__icon">
                    {isCurrent ? <Gamepad2 /> : <Play />}
                  </span>
                  <span className="recent-card__copy">
                    <span className="recent-card__name">{installation.name}</span>
                    <span className="recent-card__meta">
                      {installation.versionId} · {isCurrent ? 'Playing now' : `Last played ${relativeTime(installation.lastPlayedAt)}`}
                    </span>
                  </span>
                  <ArrowRight className="recent-card__arrow" />
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="home-grid">
        <section className="panel home-activity">
          <div className="panel-head">
            <div>
              <h2 className="panel-head__title">Recent activity</h2>
              <p className="panel-head__subtitle">Installations, launches and account changes.</p>
            </div>
            <button type="button" className="link-button" onClick={() => navigate('logs')}>
              View logs <ArrowRight />
            </button>
          </div>
          <div className="panel-body home-activity__body">
            {recentActivity.length === 0 ? (
              <EmptyState
                icon={<History />}
                title="No activity yet"
                description="Installs, launches, and account changes are recorded here."
                {...(selectedInstallation
                  ? {}
                  : { children: <span className="text-dim" style={{ fontSize: 12 }}>Create an installation to get started.</span> })}
              />
            ) : (
              <ul className="activity-list">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="activity-item">
                    <span className={cx('activity-item__icon', `activity-item__icon--${entry.status}`)}>
                      {activityIcon(entry)}
                    </span>
                    <span className="activity-item__copy">
                      <span className="activity-item__title">{entry.title}</span>
                      {entry.detail ? <span className="activity-item__detail">{entry.detail}</span> : null}
                    </span>
                    <span className="activity-item__time">{relativeTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel home-overview">
          <div className="panel-head">
            <div>
              <h2 className="panel-head__title">Selected installation</h2>
              <p className="panel-head__subtitle">Worlds, playtime, and the game folder for this profile.</p>
            </div>
            <button type="button" className="icon-btn" onClick={() => navigate('installations')} aria-label="Manage installations">
              <ChevronRight />
            </button>
          </div>
          <div className="panel-body">
            {selectedInstallation ? (
              <InstallationOverview
                installation={selectedInstallation}
                onManage={() => navigate('installations')}
                onOpenFolder={() => void openInstallationFolder(selectedInstallation.id)}
              />
            ) : (
              <EmptyState
                icon={<Layers />}
                title="No installations"
                description="Create a Minecraft profile to choose a version, game directory and memory settings."
              >
                <button type="button" className="btn btn--primary btn--sm" onClick={() => openInstallDialog({ mode: 'create', versionId: versions?.latest.release })}>
                  <Plus /> New installation
                </button>
              </EmptyState>
            )}
          </div>
        </section>
      </div>

      <div className="quick-tiles">
        <button type="button" className="quick-tile" onClick={() => navigate('installations')}>
          <span className="quick-tile__icon"><Layers /></span>
          <span className="quick-tile__copy">
            <span className="quick-tile__title">Installations</span>
            <span className="quick-tile__meta">{installations.length} profile{installations.length === 1 ? '' : 's'} configured</span>
          </span>
          <ChevronRight />
        </button>
        <button type="button" className="quick-tile" onClick={() => openInstallDialog({ mode: 'create' })}>
          <span className="quick-tile__icon"><Plus /></span>
          <span className="quick-tile__copy">
            <span className="quick-tile__title">New installation</span>
            <span className="quick-tile__meta">
              {versions
                ? `${versions.versions.length.toLocaleString()} Java versions · Bedrock · Horizon`
                : 'Java, Bedrock or Horizon'}
            </span>
          </span>
          <ChevronRight />
        </button>
        <button type="button" className="quick-tile" onClick={() => navigate('settings')}>
          <span className="quick-tile__icon"><Settings /></span>
          <span className="quick-tile__copy">
            <span className="quick-tile__title">Settings</span>
            <span className="quick-tile__meta">Java, memory, and downloads</span>
          </span>
          <ChevronRight />
        </button>
        <button
          type="button"
          className="quick-tile"
          disabled={!selectedInstallation}
          onClick={() => selectedInstallation && void openInstallationFolder(selectedInstallation.id)}
        >
          <span className="quick-tile__icon"><FolderOpen /></span>
          <span className="quick-tile__copy">
            <span className="quick-tile__title">Game directory</span>
            <span className="quick-tile__meta">
              {selectedInstallation ? shortPath(selectedInstallation.gameDir, 32) : 'No installation selected'}
            </span>
          </span>
          <ChevronRight />
        </button>
      </div>

      <footer className="home-footer">
        <span className="home-footer__sep" />
        <span>{settings?.memory.maxMb ? `${settings.memory.maxMb} MB max memory` : 'Memory not configured'}</span>
        <span className="home-footer__sep" />
        <span>{data?.app.platform || 'Windows'} · {data?.system.arch || 'x64'}</span>
      </footer>
    </div>
  )
}

function InstallationOverview({
  installation,
  onManage,
  onOpenFolder,
}: {
  installation: Installation
  onManage: () => void
  onOpenFolder: () => void
}) {
  return (
    <div className="overview">
      <div className="overview__top">
        <div>
          <div className="overview__name">{installation.name}</div>
          <div className="overview__version">
            Version {installation.versionId}
            {installation.loader?.type && installation.loader.type !== 'vanilla'
              ? ` · ${loaderLabel(installation.loader.type)}${installation.loader.version ? ` ${installation.loader.version}` : ''}`
              : ''}
          </div>
        </div>
      </div>
      <div className="overview__stats">
        <div>
          <span className="overview__stat-label">Worlds</span>
          <span className="overview__stat-value">{installation.worlds}</span>
        </div>
        <div>
          <span className="overview__stat-label">Playtime</span>
          <span className="overview__stat-value">{formatPlaytime(installation.totalPlaytimeMs)}</span>
        </div>
        <div>
          <span className="overview__stat-label">Last played</span>
          <span className="overview__stat-value">{relativeTime(installation.lastPlayedAt)}</span>
        </div>
      </div>
      <div className="overview__path" title={installation.gameDir}>
        <FolderOpen />
        <span>{shortPath(installation.gameDir, 48)}</span>
      </div>
      <div className="overview__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenFolder}>
          <FolderOpen /> Open folder
        </button>
        <button type="button" className="btn btn--sm" onClick={onManage}>
          Manage <ArrowRight />
        </button>
      </div>
    </div>
  )
}
