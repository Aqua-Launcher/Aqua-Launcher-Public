import { useMemo } from 'react'
import {
  Archive,
  Boxes,
  Coffee,
  Database,
  Download,
  FolderOpen,
  Gamepad2,
  Hammer,
  HardDrive,
  Layers,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useNow } from '../lib/hooks'
import { useLauncher } from '../state/LauncherProvider'
import type {
  BedrockDownloadProgress,
  DownloadJob,
  HorizonInstallJob,
  HorizonNativeJob,
} from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge, Button, EmptyState, IconButton, ProgressBar, cx } from '../components/ui/primitives'

/** Every kind of work the launcher runs in the background, plus launch preparation. */
type TaskKind =
  | 'install'
  | 'java'
  | 'backup'
  | 'modpack-import'
  | 'launcher-import'
  | 'horizon'
  | 'native'
  | 'bedrock'
  | 'storage'
  | 'launch'
type TaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

interface LauncherTask {
  id: string
  kind: TaskKind
  title: string
  subtitle: string
  state: TaskState
  stage: string
  progress: number | null
  bytesDone?: number
  bytesTotal?: number
  speedBps?: number
  etaSeconds?: number | null
  filesDone?: number
  filesTotal?: number
  currentFile?: string | null
  error?: string | null
  onCancel?: () => void
  onRetry?: () => void
  onOpenFolder?: () => void
}

const KIND_ICON: Record<TaskKind, typeof Download> = {
  install: Download,
  java: Coffee,
  backup: Archive,
  'modpack-import': Boxes,
  'launcher-import': Boxes,
  horizon: HardDrive,
  native: Hammer,
  bedrock: Layers,
  storage: Database,
  launch: Gamepad2,
}

const BEDROCK_PHASES: Record<BedrockDownloadProgress['phase'], string> = {
  resolving: 'Finding the package',
  downloading: 'Downloading',
  extracting: 'Unpacking the build',
  installing: 'Windows is installing the build',
  done: 'Downloaded',
  error: 'Failed',
  cancelled: 'Cancelled',
}

function badgeTone(state: TaskState) {
  if (state === 'completed') return 'success' as const
  if (state === 'failed') return 'danger' as const
  if (state === 'queued') return 'warning' as const
  if (state === 'cancelled') return 'default' as const
  return 'info' as const
}

function stateLabel(task: LauncherTask) {
  if (task.state === 'running') return task.progress != null ? `${Math.round(task.progress)}%` : 'Working'
  if (task.state === 'queued') return 'Queued'
  if (task.state === 'completed') return 'Complete'
  if (task.state === 'failed') return 'Failed'
  return 'Cancelled'
}

function bedrockState(progress: BedrockDownloadProgress): TaskState {
  if (progress.phase === 'error') return 'failed'
  if (progress.phase === 'cancelled') return 'cancelled'
  if (progress.phase === 'done') return 'completed'
  return 'running'
}

export function TasksPage() {
  const {
    jobs,
    game,
    bedrockDownloads,
    storageProgress,
    horizonInstallJob,
    horizonNativeJob,
    installGame,
    openInstallationFolder,
    cancelBedrockVersion,
    pushToast,
    navigate,
    data,
  } = useLauncher()

  const tasks = useMemo<LauncherTask[]>(() => {
    const list: LauncherTask[] = []

    const cancelJob = (job: DownloadJob) => {
      api.downloads
        .cancel(job.id)
        .catch((error) =>
          pushToast({ level: 'error', title: 'Could not cancel download', message: getErrorMessage(error) }),
        )
    }

    for (const job of jobs) {
      const active = job.status === 'running' || job.status === 'queued'
      list.push({
        id: `job-${job.id}`,
        kind:
          job.type === 'java'
            ? 'java'
            : job.type === 'backup'
              ? 'backup'
              : job.type === 'modpack-import'
                ? 'modpack-import'
                : job.type === 'launcher-import'
                  ? 'launcher-import'
                  : 'install',
        title: job.title,
        subtitle: job.subtitle,
        state: job.status,
        stage: job.stage,
        progress: job.progress,
        bytesDone: job.bytesDone,
        bytesTotal: job.bytesTotal,
        speedBps: job.speedBps,
        etaSeconds: job.etaSeconds,
        filesDone: job.filesDone,
        filesTotal: job.filesTotal,
        currentFile: job.currentFile,
        error: job.error,
        onCancel: active ? () => cancelJob(job) : undefined,
        onRetry:
          job.status === 'failed' && job.type === 'install' && job.installationId
            ? () => void installGame(job.installationId!)
            : undefined,
        onOpenFolder: job.installationId
          ? () => void openInstallationFolder(job.installationId!)
          : undefined,
      })
    }

    if (horizonInstallJob) {
      const job: HorizonInstallJob = horizonInstallJob
      const active = job.status === 'queued' || job.status === 'running' || job.status === 'cancelling'
      list.push({
        id: `horizon-${job.id}`,
        kind: 'horizon',
        title: `Horizon ${job.tag}`,
        subtitle: job.gameVersion ? `Minecraft ${job.gameVersion} · Rust client` : 'Horizon Rust client',
        state: job.status === 'cancelling' ? 'running' : job.status,
        stage: job.stage,
        progress: job.progress,
        bytesDone: job.bytesDone,
        bytesTotal: job.bytesTotal,
        speedBps: job.speedBps,
        etaSeconds: job.etaSeconds,
        filesDone: job.filesDone,
        filesTotal: job.filesTotal,
        currentFile: job.currentFile || job.message,
        error: job.error,
        onCancel: active
          ? () =>
              void api.horizon
                .cancelInstall()
                .catch((error) =>
                  pushToast({
                    level: 'error',
                    title: 'Could not cancel the Horizon install',
                    message: getErrorMessage(error),
                  }),
                )
          : undefined,
      })
    }

    if (horizonNativeJob) {
      const job: HorizonNativeJob = horizonNativeJob
      const active = job.status === 'running' || job.status === 'cancelling'
      list.push({
        id: `horizon-native-${job.id}`,
        kind: 'native',
        title: 'Compiling Horizon native mods',
        subtitle: [
          job.profile ? `${job.profile} build` : 'Rust build',
          job.revision ? job.revision.slice(0, 12) : null,
          job.mods ? `${job.mods} mod${job.mods === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        state: job.status === 'cancelling' ? 'running' : job.status,
        stage: job.stage,
        progress: job.progress ?? null,
        currentFile: job.message,
        error: job.error,
        onCancel: active
          ? () =>
              void api.horizon
                .cancelNativeBuild()
                .catch((error) =>
                  pushToast({
                    level: 'error',
                    title: 'Could not cancel the native build',
                    message: getErrorMessage(error),
                  }),
                )
          : undefined,
      })
    }

    for (const [version, progress] of Object.entries(bedrockDownloads)) {
      const state = bedrockState(progress)
      const active = state === 'running'
      list.push({
        id: `bedrock-${version}`,
        kind: 'bedrock',
        title: `Bedrock ${version}`,
        subtitle: 'Minecraft for Windows build',
        state,
        stage: BEDROCK_PHASES[progress.phase],
        progress: progress.totalBytes
          ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
          : null,
        bytesDone: progress.receivedBytes,
        bytesTotal: progress.totalBytes ?? 0,
        error: progress.error ?? null,
        onCancel: active ? () => void cancelBedrockVersion(version) : undefined,
      })
    }

    if (storageProgress) {
      const scanning = storageProgress.phase === 'scan'
      const done = typeof storageProgress.done === 'number' ? storageProgress.done : null
      list.push({
        id: 'storage',
        kind: 'storage',
        title: scanning ? 'Scanning launcher storage' : 'Cleaning launcher storage',
        subtitle: storageProgress.label || 'Measuring the folders Aqua keeps on disk',
        state: 'running',
        stage: scanning ? 'Reading folders' : 'Removing selected files',
        progress: done != null && storageProgress.total ? (done / storageProgress.total) * 100 : null,
        currentFile: storageProgress.label,
        onCancel: () =>
          void api.storage
            .cancel()
            .catch((error) =>
              pushToast({ level: 'error', title: 'Could not stop the scan', message: getErrorMessage(error) }),
            ),
      })
    }

    if (game.status === 'preparing') {
      list.push({
        id: 'launch-prepare',
        kind: 'launch',
        title: 'Preparing to launch',
        subtitle: game.installationName
          ? `${game.installationName}${game.versionId ? ` · Minecraft ${game.versionId}` : ''}`
          : 'Java, account, and game file checks',
        state: 'running',
        stage: game.phase || 'Starting Minecraft',
        progress: null,
      })
    }

    return list
  }, [
    bedrockDownloads,
    cancelBedrockVersion,
    game.installationName,
    game.phase,
    game.status,
    game.versionId,
    horizonInstallJob,
    horizonNativeJob,
    installGame,
    jobs,
    openInstallationFolder,
    pushToast,
    storageProgress,
  ])

  const active = tasks.filter((task) => task.state === 'running' || task.state === 'queued')
  const finished = tasks.filter((task) => task.state !== 'running' && task.state !== 'queued')
  useNow(active.length > 0)

  const clearFinished = async () => {
    try {
      await api.downloads.clearFinished()
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not clear downloads', message: getErrorMessage(error) })
    }
  }

  const hasFinishedJobs = jobs.some(
    (job) => job.status !== 'running' && job.status !== 'queued',
  )

  const subtitle = active.length
    ? `${active.length} task${active.length === 1 ? '' : 's'} running · downloads, builds, and file work all land here`
    : 'Every download, Horizon build, and other long launcher task appears here with live progress.'

  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        subtitle={subtitle}
        actions={
          <Button
            icon={<Trash2 />}
            size="sm"
            variant="ghost"
            onClick={() => void clearFinished()}
            disabled={!hasFinishedJobs}
          >
            Clear finished
          </Button>
        }
      />

      {active.length > 0 ? (
        <section className="tasks-section">
          <div className="tasks-section__head">
            <h2 className="download-section__title">In progress</h2>
            <span className="text-dim" role="status" aria-live="polite">
              {active.length} running
            </span>
          </div>
          <div className="tasks-board">
            {active.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      ) : null}

      {finished.length > 0 ? (
        <section className="tasks-section">
          <div className="tasks-section__head">
            <h2 className="download-section__title">Recent</h2>
            <span className="text-dim">
              {finished.length} this session
              {data?.app.version ? ` · Aqua ${data.app.version}` : ''}
            </span>
          </div>
          <div className="tasks-board">
            {finished.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      ) : null}

      {active.length === 0 && finished.length === 0 ? (
        <div className="panel tasks-empty">
          <EmptyState
            icon={<Download />}
            title="Nothing is running"
            description="Installing a version, Horizon's client, a native build, a Bedrock build, or an official Java runtime all show up here with speed, size, and time remaining."
          >
            <Button size="sm" icon={<Layers />} onClick={() => navigate('installations')}>
              Browse installations
            </Button>
          </EmptyState>
        </div>
      ) : null}
    </div>
  )
}

function TaskCard({ task }: { task: LauncherTask }) {
  const Icon = KIND_ICON[task.kind]
  const active = task.state === 'running' || task.state === 'queued'
  const value = task.state === 'completed' ? 100 : task.state === 'cancelled' ? 0 : task.progress
  const numbers = task.bytesTotal
    ? `${formatBytes(task.bytesDone)} / ${formatBytes(task.bytesTotal)}`
    : task.filesTotal
      ? `${task.filesDone?.toLocaleString() ?? 0} / ${task.filesTotal.toLocaleString()} files`
      : null

  return (
    <article className={cx('download-card', 'download-card--page', `download-card--${task.state}`)}>
      <div className="download-card__head">
        <span className={cx('download-card__icon', task.kind === 'java' && 'is-java')}>
          <Icon />
        </span>
        <div className="download-card__copy">
          <div className="download-card__title-row">
            <span className="download-card__title">{task.title}</span>
            <Badge tone={badgeTone(task.state)}>{stateLabel(task)}</Badge>
          </div>
          <span className="download-card__subtitle">{task.subtitle}</span>
        </div>
        <div className="download-card__actions">
          {active && task.onCancel ? (
            <IconButton label={`Cancel ${task.title}`} size="sm" onClick={task.onCancel}>
              <X />
            </IconButton>
          ) : null}
          {task.state === 'failed' && task.onRetry ? (
            <IconButton label={`Retry ${task.title}`} size="sm" onClick={task.onRetry}>
              <RefreshCw />
            </IconButton>
          ) : null}
          {!active && task.onOpenFolder ? (
            <IconButton label="Open game folder" size="sm" onClick={task.onOpenFolder}>
              <FolderOpen />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="download-card__progress">
        <ProgressBar value={value} danger={task.state === 'failed'} label={`${task.title} progress`} />
      </div>

      <div className="download-card__meta">
        <span className="download-card__stage">{task.error || task.stage}</span>
        {active ? (
          <span className="download-card__numbers">
            {numbers ? <span>{numbers}</span> : null}
            {task.speedBps && task.speedBps > 0 ? <span>{formatSpeed(task.speedBps)}</span> : null}
            {task.etaSeconds != null && task.etaSeconds > 0 ? (
              <span>{formatEta(task.etaSeconds)} left</span>
            ) : null}
          </span>
        ) : task.filesTotal && task.state === 'completed' ? (
          <span className="download-card__numbers">
            {task.filesTotal.toLocaleString()} files
          </span>
        ) : null}
      </div>

      {task.currentFile && active ? (
        <div className="download-card__file mono" title={task.currentFile}>
          {task.currentFile}
        </div>
      ) : null}
    </article>
  )
}
