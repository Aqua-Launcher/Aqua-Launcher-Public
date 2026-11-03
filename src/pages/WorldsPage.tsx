import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Boxes,
  Database,
  FolderOpen,
  Globe2,
  HardDrive,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatDateTime, relativeTime, shortPath } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type {
  BedrockWorldBackup,
  BedrockWorldSummary,
  BedrockWorldsResult,
  WorldBackup,
  WorldSummary,
  WorldsResult,
} from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge, Button, EmptyState, IconButton, Spinner, cx } from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/overlays'
import { WorldDatapacksDialog } from '../components/worlds/WorldDatapacksDialog'

function titleCase(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function worldModeTone(mode: WorldSummary['gameMode']) {
  if (mode === 'creative') return 'info'
  if (mode === 'adventure') return 'warning'
  if (mode === 'spectator') return 'snapshot'
  return 'success'
}

export function WorldsPage() {
  const { selectedInstallation, game, pushToast, navigate, bedrock } = useLauncher()
  const installationId = selectedInstallation?.id ?? null
  const bedrockEdition = bedrock?.editions[0] ?? null
  const [edition, setEdition] = useState<'java' | 'bedrock'>('java')
  const [bedrockResult, setBedrockResult] = useState<BedrockWorldsResult | null>(null)
  const [bedrockLoading, setBedrockLoading] = useState(false)
  const [bedrockError, setBedrockError] = useState<string | null>(null)
  const [bedrockBackingUp, setBedrockBackingUp] = useState<string | null>(null)
  const [bedrockRestoring, setBedrockRestoring] = useState<string | null>(null)
  const [deleteBedrockBackupTarget, setDeleteBedrockBackupTarget] = useState<BedrockWorldBackup | null>(null)
  const [result, setResult] = useState<WorldsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleteWorldTarget, setDeleteWorldTarget] = useState<WorldSummary | null>(null)
  const [deleteBackupTarget, setDeleteBackupTarget] = useState<WorldBackup | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [datapackWorld, setDatapackWorld] = useState<WorldSummary | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    if (!installationId) {
      setResult(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const payload = await api.worlds.list(installationId)
      if (seq === loadSeq.current) setResult(payload)
    } catch (loadError) {
      if (seq === loadSeq.current) setError(getErrorMessage(loadError))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [installationId])

  useEffect(() => {
    setResult(null)
    setDeleteWorldTarget(null)
    setDeleteBackupTarget(null)
    setDeleteBedrockBackupTarget(null)
    setDatapackWorld(null)
    void load()
  }, [installationId, load])

  useEffect(() => {
    if (installationId && (game.status === 'exited' || game.status === 'crashed')) void load()
  }, [game.status, installationId, load])

  // Bedrock is the only option without a Java installation, and it steps aside
  // as soon as one exists.
  useEffect(() => {
    if (!bedrockEdition) setEdition('java')
    else if (!selectedInstallation) setEdition('bedrock')
  }, [bedrockEdition, selectedInstallation])

  const loadBedrock = useCallback(async () => {
    if (!bedrockEdition) return
    setBedrockLoading(true)
    setBedrockError(null)
    try {
      setBedrockResult(await api.bedrock.worlds(bedrockEdition.id))
    } catch (loadError) {
      setBedrockError(getErrorMessage(loadError))
    } finally {
      setBedrockLoading(false)
    }
  }, [bedrockEdition])

  useEffect(() => {
    if (edition === 'bedrock') void loadBedrock()
  }, [edition, loadBedrock])

  const openBedrockFolder = async (folder?: string) => {
    if (!bedrockEdition) return
    try {
      await api.bedrock.openFolder(bedrockEdition.id, folder ?? null)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(openError) })
    }
  }

  const createBedrockBackup = async (world: BedrockWorldSummary) => {
    if (!bedrockEdition) return
    setBedrockBackingUp(world.folder)
    try {
      const backup = await api.bedrock.backupWorld(bedrockEdition.id, world.folder)
      setBedrockResult((current) =>
        current ? { ...current, backups: [backup, ...current.backups.filter((item) => item.id !== backup.id)] } : current,
      )
      pushToast({
        level: 'success',
        title: `Backed up ${world.name}`,
        message: `${formatBytes(backup.sizeBytes)} saved to the launcher's backups folder.`,
      })
    } catch (backupError) {
      pushToast({ level: 'error', title: 'Backup failed', message: getErrorMessage(backupError) })
    } finally {
      setBedrockBackingUp(null)
    }
  }

  const restoreBedrockBackup = async (backup: BedrockWorldBackup) => {
    if (!bedrockEdition) return
    setBedrockRestoring(backup.id)
    try {
      const restored = await api.bedrock.restoreBackup(bedrockEdition.id, backup.id)
      await loadBedrock()
      pushToast({
        level: 'success',
        title: `Restored ${backup.name}`,
        message: `Added as “${restored.folder}”. The world it came from was not changed.`,
      })
    } catch (restoreError) {
      pushToast({ level: 'error', title: 'Restore failed', message: getErrorMessage(restoreError) })
    } finally {
      setBedrockRestoring(null)
    }
  }

  const confirmDeleteBedrockBackup = async () => {
    if (!bedrockEdition || !deleteBedrockBackupTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.bedrock.deleteBackup(bedrockEdition.id, deleteBedrockBackupTarget.id)
      setBedrockResult((current) =>
        current
          ? { ...current, backups: current.backups.filter((item) => item.id !== deleteBedrockBackupTarget.id) }
          : current,
      )
      pushToast({ level: 'info', title: 'Backup deleted' })
      setDeleteBedrockBackupTarget(null)
    } catch (deleteFailure) {
      setDeleteError(getErrorMessage(deleteFailure))
    } finally {
      setDeleting(false)
    }
  }

  const worlds = result?.worlds ?? []
  const backups = result?.backups ?? []
  const bedrockBackups = bedrockResult?.backups ?? []
  const lastBackupByWorld = useMemo(() => {
    const map = new Map<string, WorldBackup>()
    for (const backup of backups) {
      const current = map.get(backup.worldFolder)
      if (!current || new Date(backup.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        map.set(backup.worldFolder, backup)
      }
    }
    return map
  }, [backups])
  const totalWorldSize = useMemo(() => worlds.reduce((sum, world) => sum + world.sizeBytes, 0), [worlds])
  const totalBackupSize = useMemo(() => backups.reduce((sum, backup) => sum + backup.sizeBytes, 0), [backups])
  const totalBedrockBackupSize = useMemo(
    () => bedrockBackups.reduce((sum, backup) => sum + backup.sizeBytes, 0),
    [bedrockBackups],
  )
  const gameActiveHere =
    (game.status === 'running' || game.status === 'preparing') && game.installationId === installationId

  const openFolder = async (folder?: string) => {
    if (!installationId) return
    try {
      await api.worlds.openFolder(installationId, folder ?? null)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open that folder', message: getErrorMessage(openError) })
    }
  }

  const createBackup = async (world: WorldSummary) => {
    if (!installationId) return
    setBackingUp(world.folder)
    try {
      const backup = await api.worlds.backup(installationId, world.folder)
      setResult((current) =>
        current ? { ...current, backups: [backup, ...current.backups.filter((item) => item.id !== backup.id)] } : current,
      )
      pushToast({
        level: 'success',
        title: `Backed up ${world.name}`,
        message: `${formatBytes(backup.sizeBytes)} saved to the launcher's backups folder.`,
      })
    } catch (backupError) {
      pushToast({ level: 'error', title: 'Backup failed', message: getErrorMessage(backupError) })
    } finally {
      setBackingUp(null)
    }
  }

  const restoreBackup = async (backup: WorldBackup) => {
    if (!installationId) return
    setRestoring(backup.id)
    try {
      const restored = await api.worlds.restore(installationId, backup.id)
      await load()
      pushToast({
        level: 'success',
        title: `Restored ${backup.name}`,
        message: `Added as “${restored.folder}”. Your existing world was not changed.`,
      })
    } catch (restoreError) {
      pushToast({ level: 'error', title: 'Restore failed', message: getErrorMessage(restoreError) })
    } finally {
      setRestoring(null)
    }
  }

  const confirmDeleteWorld = async () => {
    if (!installationId || !deleteWorldTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.worlds.delete(installationId, deleteWorldTarget.folder)
      setResult((current) =>
        current ? { ...current, worlds: current.worlds.filter((world) => world.folder !== deleteWorldTarget.folder) } : current,
      )
      pushToast({ level: 'info', title: `Deleted ${deleteWorldTarget.name}` })
      setDeleteWorldTarget(null)
    } catch (deleteFailure) {
      setDeleteError(getErrorMessage(deleteFailure))
    } finally {
      setDeleting(false)
    }
  }

  const confirmDeleteBackup = async () => {
    if (!installationId || !deleteBackupTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.worlds.deleteBackup(installationId, deleteBackupTarget.id)
      setResult((current) =>
        current ? { ...current, backups: current.backups.filter((backup) => backup.id !== deleteBackupTarget.id) } : current,
      )
      pushToast({ level: 'info', title: 'Backup deleted' })
      setDeleteBackupTarget(null)
    } catch (deleteFailure) {
      setDeleteError(getErrorMessage(deleteFailure))
    } finally {
      setDeleting(false)
    }
  }

  if (!selectedInstallation && !bedrockEdition) {
    return (
      <div className="page">
        <PageHeader
          title="Worlds & backups"
          subtitle="Save and restore Minecraft worlds without leaving the launcher."
        />
        <div className="panel">
          <EmptyState
            icon={<Globe2 />}
            title="No installation selected"
            description="Worlds belong to an installation. Create or select a profile, then come back here."
          >
            <Button variant="primary" icon={<Layers />} onClick={() => navigate('installations')}>
              Go to installations
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Worlds & backups"
        subtitle={
          edition === 'bedrock' && bedrockEdition
            ? `${bedrockEdition.name} · Bedrock ${bedrockEdition.version || 'version unknown'} · worlds live in the Store app's own data folder.`
            : `${selectedInstallation?.name} · Minecraft ${selectedInstallation?.versionId} · backups are kept in the launcher data folder.`
        }
        actions={
          <div className="row gap-2">
            {bedrockEdition && selectedInstallation ? (
              <div className="segmented" role="radiogroup" aria-label="Game edition">
                {(
                  [
                    ['java', 'Java'],
                    ['bedrock', 'Bedrock'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={edition === value}
                    className={cx(edition === value && 'is-active')}
                    onClick={() => setEdition(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              icon={<FolderOpen />}
              onClick={() => void (edition === 'bedrock' ? openBedrockFolder() : openFolder())}
            >
              {edition === 'bedrock' ? 'Worlds folder' : 'Saves folder'}
            </Button>
            <Button
              icon={<RefreshCw />}
              onClick={() => void (edition === 'bedrock' ? loadBedrock() : load())}
              loading={edition === 'bedrock' ? bedrockLoading : loading}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="callout callout--danger">
          <AlertTriangle />
          <span>{error}</span>
        </div>
      ) : null}

      {edition === 'bedrock' && bedrockEdition ? (
        <>
          {bedrockError ? (
            <div className="callout callout--danger" role="alert">
              <AlertTriangle />
              <span>{bedrockError}</span>
            </div>
          ) : null}

          {bedrockLoading && !bedrockResult ? (
            <div className="panel">
              <div className="mods-loading">
                <Spinner /> Reading Bedrock worlds…
              </div>
            </div>
          ) : (
            <section className="panel worlds-panel">
              <div className="panel-head">
                <div>
                  <h2 className="panel-head__title">
                    Worlds <span className="worlds-panel__count">{(bedrockResult?.worlds ?? []).length}</span>
                  </h2>
                  <p className="panel-head__subtitle">
                    {bedrockResult?.worlds.length
                      ? `${formatBytes(bedrockResult.worlds.reduce((sum, world) => sum + world.sizeBytes, 0))} across ${
                          bedrockResult.worlds.length
                        } save${bedrockResult.worlds.length === 1 ? '' : 's'} · ${shortPath(bedrockResult.directory, 54)}`
                      : `No worlds in ${shortPath(bedrockResult?.directory || bedrockEdition.worldsDirectory, 54)} yet.`}
                  </p>
                </div>
              </div>
              <div className="panel-body">
                {bedrockResult?.worlds.length ? (
                  <div className="world-grid">
                    {bedrockResult.worlds.map((world) => (
                      <article key={world.folder} className="world-card">
                        <div className="world-card__top">
                          <span className="world-card__icon">
                            {world.iconDataUrl ? (
                              <img src={world.iconDataUrl} alt="" />
                            ) : (
                              <Globe2 strokeWidth={1.6} />
                            )}
                          </span>
                          <div className="world-card__identity">
                            <h2 className="world-card__name">{world.name}</h2>
                            <span className="world-card__folder mono" title={world.folder}>
                              {world.folder}
                            </span>
                          </div>
                        </div>

                        <div className="world-card__tags">
                          <Badge tone="info">
                            <Boxes size={11} /> Bedrock
                          </Badge>
                        </div>

                        <div className="world-card__meta">
                          <span>
                            <span>Last saved</span>
                            <strong>{world.lastPlayed ? relativeTime(world.lastPlayed) : 'Unknown'}</strong>
                          </span>
                          <span>
                            <span>Size</span>
                            <strong>{formatBytes(world.sizeBytes)}</strong>
                          </span>
                          <span>
                            <span>Files</span>
                            <strong>{world.files.toLocaleString()}</strong>
                          </span>
                        </div>

                        <div className="world-card__actions">
                          <Button
                            size="sm"
                            variant="subtle"
                            icon={bedrockBackingUp === world.folder ? <Loader2 className="spin" /> : <Archive />}
                            disabled={Boolean(bedrockBackingUp) || Boolean(bedrockRestoring)}
                            onClick={() => void createBedrockBackup(world)}
                          >
                            {bedrockBackingUp === world.folder ? 'Backing up…' : 'Back up'}
                          </Button>
                          <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void openBedrockFolder(world.folder)}>
                            Open
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Globe2 />}
                    title="No Bedrock worlds yet"
                    description="Worlds you create in Minecraft for Windows appear here. Bedrock keeps them in its own data folder, separate from Java saves."
                  >
                    <Button icon={<FolderOpen />} onClick={() => void openBedrockFolder()}>
                      Open worlds folder
                    </Button>
                  </EmptyState>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">
                  Backups <span className="worlds-panel__count">{bedrockBackups.length}</span>
                </h2>
                <p className="panel-head__subtitle">
                  {bedrockBackups.length
                    ? `${formatBytes(totalBedrockBackupSize)} stored · restores add a new world, so the original is never replaced.`
                    : 'Back up any Bedrock world above. Archives live in the launcher data folder, not in the Store app.'}
                </p>
              </div>
            </div>
            <div className="panel-body">
              {bedrockBackups.length ? (
                <ul className="backup-list">
                  {bedrockBackups.map((backup) => (
                    <li key={backup.id} className="backup-row">
                      <span className="backup-row__icon">
                        <Archive />
                      </span>
                      <span className="backup-row__copy">
                        <span className="backup-row__title">
                          {backup.name}
                          {backup.note ? <span className="backup-row__note">{backup.note}</span> : null}
                        </span>
                        <span className="backup-row__meta">
                          {backup.worldFolder} · {formatDateTime(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                        </span>
                      </span>
                      <span className="backup-row__actions">
                        <Button
                          size="sm"
                          icon={bedrockRestoring === backup.id ? <Loader2 className="spin" /> : <RotateCcw />}
                          disabled={bedrockRestoring === backup.id}
                          onClick={() => void restoreBedrockBackup(backup)}
                        >
                          {bedrockRestoring === backup.id ? 'Restoring…' : 'Restore'}
                        </Button>
                        <IconButton
                          label={`Delete ${backup.name} backup`}
                          size="sm"
                          tone="danger"
                          onClick={() => {
                            setDeleteError(null)
                            setDeleteBedrockBackupTarget(backup)
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Archive />}
                  title="No Bedrock backups yet"
                  description="A backup is a zipped copy of one world folder. Keep one before a game update or a risky build."
                />
              )}
            </div>
          </section>

          <div className="callout callout--info">
            <Info />
            <span>
              Aqua copies Bedrock worlds into its own backups folder and never moves or edits the live world. Close Minecraft
              before backing up a world you are playing.
            </span>
          </div>
        </>
      ) : loading && !result ? (
        <div className="panel">
          <div className="mods-loading">
            <Spinner /> Reading worlds…
          </div>
        </div>
      ) : (
        <>
          <section className="panel worlds-panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">
                  Worlds <span className="worlds-panel__count">{worlds.length}</span>
                </h2>
                <p className="panel-head__subtitle">
                  {worlds.length
                    ? `${formatBytes(totalWorldSize)} across ${worlds.length} save${worlds.length === 1 ? '' : 's'} · ${shortPath(result?.directory || '', 54)}`
                    : `No worlds in ${shortPath(result?.directory || selectedInstallation?.gameDir || '', 54)} yet.`}
                </p>
              </div>
            </div>
            {gameActiveHere ? (
              <div className="callout callout--warning worlds-panel__notice">
                <AlertTriangle />
                <span>Minecraft is running or starting. Close the game for a consistent backup; deleting worlds is disabled until the game exits.</span>
              </div>
            ) : null}
            <div className="panel-body">
              {worlds.length ? (
                <div className="world-grid">
                  {worlds.map((world) => (
                    <article key={world.folder} className="world-card">
                      <div className="world-card__top">
                        <span className="world-card__icon">
                          {world.iconDataUrl ? (
                            <img src={world.iconDataUrl} alt="" />
                          ) : (
                            <Globe2 strokeWidth={1.6} />
                          )}
                        </span>
                        <div className="world-card__identity">
                          <h2 className="world-card__name">{world.name}</h2>
                          <span className="world-card__folder mono" title={world.folder}>
                            {world.folder}
                          </span>
                        </div>
                        <IconButton
                          label={gameActiveHere ? 'Close Minecraft to delete this world' : `Delete ${world.name}`}
                          size="sm"
                          tone="danger"
                          disabled={gameActiveHere}
                          onClick={() => {
                            setDeleteError(null)
                            setDeleteWorldTarget(world)
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                      </div>

                      <div className="world-card__tags">
                        <Badge tone={worldModeTone(world.gameMode)}>{titleCase(world.gameMode)}</Badge>
                        {world.hardcore ? (
                          <Badge tone="danger">
                            <HardDrive size={11} /> Hardcore
                          </Badge>
                        ) : null}
                        {world.versionName ? <Badge>{world.versionName}</Badge> : null}
                        <Badge>{titleCase(world.difficulty)} difficulty</Badge>
                        {world.cheats ? <Badge tone="warning">Cheats</Badge> : null}
                      </div>

                      <div className="world-card__meta">
                        <span>
                          <span>Last played</span>
                          <strong>{world.lastPlayed ? relativeTime(world.lastPlayed) : 'Unknown'}</strong>
                        </span>
                        <span>
                          <span>Last backup</span>
                          <strong>
                            {lastBackupByWorld.has(world.folder)
                              ? relativeTime(lastBackupByWorld.get(world.folder)!.createdAt)
                              : 'Never'}
                          </strong>
                        </span>
                        <span>
                          <span>Size</span>
                          <strong>{formatBytes(world.sizeBytes)}</strong>
                        </span>
                        <span>
                          <span>Files</span>
                          <strong>{world.files.toLocaleString()}</strong>
                        </span>
                      </div>

                      <div className="world-card__actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Database />}
                          onClick={() => setDatapackWorld(world)}
                        >
                          Datapacks
                        </Button>
                        <Button
                          size="sm"
                          variant="subtle"
                          icon={backingUp === world.folder ? <Loader2 className="spin" /> : <Archive />}
                          disabled={Boolean(backingUp) || Boolean(restoring)}
                          onClick={() => void createBackup(world)}
                        >
                          {backingUp === world.folder ? 'Backing up…' : 'Back up'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<FolderOpen />}
                          onClick={() => void openFolder(world.folder)}
                        >
                          Open
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Globe2 />}
                  title="No worlds yet"
                  description="Create a world in Minecraft and it will appear here, ready to back up or restore."
                >
                  <Button icon={<FolderOpen />} onClick={() => void openFolder()}>
                    Open saves folder
                  </Button>
                </EmptyState>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">
                  Backups <span className="worlds-panel__count">{backups.length}</span>
                </h2>
                <p className="panel-head__subtitle">
                  {backups.length
                    ? `${formatBytes(totalBackupSize)} stored · restoring adds a copy, so a live world is never replaced.`
                    : 'Create a backup from any world above. Restores never overwrite an existing save.'}
                </p>
              </div>
            </div>
            <div className="panel-body">
              {backups.length ? (
                <ul className="backup-list">
                  {backups.map((backup) => (
                    <li key={backup.id} className="backup-row">
                      <span className="backup-row__icon">
                        <Archive />
                      </span>
                      <span className="backup-row__copy">
                        <span className="backup-row__title">
                          {backup.name}
                          {backup.automatic ? <Badge tone="info">Auto</Badge> : null}
                          {backup.note ? <span className="backup-row__note">{backup.note}</span> : null}
                        </span>
                        <span className="backup-row__meta">
                          {backup.worldFolder} · {formatDateTime(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                        </span>
                      </span>
                      <span className="backup-row__actions">
                        <Button
                          size="sm"
                          icon={restoring === backup.id ? <Loader2 className="spin" /> : <RotateCcw />}
                          disabled={restoring === backup.id}
                          onClick={() => void restoreBackup(backup)}
                        >
                          {restoring === backup.id ? 'Restoring…' : 'Restore'}
                        </Button>
                        <IconButton
                          label={`Delete ${backup.name} backup`}
                          size="sm"
                          tone="danger"
                          onClick={() => {
                            setDeleteError(null)
                            setDeleteBackupTarget(backup)
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Archive />}
                  title="No backups yet"
                  description="Backups are zipped copies of a world folder. Keep one before big updates or risky builds."
                />
              )}
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteWorldTarget)}
        title="Delete this world?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteWorldTarget?.name}</strong> will be permanently deleted from{' '}
            <span className="mono">{deleteWorldTarget?.folder}</span>, including its regions, player data and screenshots
            inside the world folder. This cannot be undone.
          </>
        }
        confirmLabel="Delete world"
        loading={deleting}
        onCancel={() => {
          if (deleting) return
          setDeleteWorldTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => void confirmDeleteWorld()}
      >
        <div className={cx('callout', deleteError ? 'callout--danger' : 'callout--warning')}>
          <ShieldAlert />
          <span>{deleteError || 'Create a backup first if you may want this world later.'}</span>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteBackupTarget)}
        title="Delete this backup?"
        description={
          <>
            The snapshot of <strong style={{ color: 'var(--text)' }}>{deleteBackupTarget?.name}</strong> will be removed from
            the launcher backups folder. The world itself is not affected.
          </>
        }
        confirmLabel="Delete backup"
        loading={deleting}
        onCancel={() => {
          if (deleting) return
          setDeleteBackupTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => void confirmDeleteBackup()}
      >
        {deleteError ? <div className="callout callout--danger">{deleteError}</div> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteBedrockBackupTarget)}
        title="Delete this Bedrock backup?"
        description={
          <>
            The snapshot of <strong style={{ color: 'var(--text)' }}>{deleteBedrockBackupTarget?.name}</strong> will be
            removed from the launcher backups folder. The world inside Minecraft is not affected.
          </>
        }
        confirmLabel="Delete backup"
        loading={deleting}
        onCancel={() => {
          if (deleting) return
          setDeleteBedrockBackupTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => void confirmDeleteBedrockBackup()}
      >
        {deleteError ? <div className="callout callout--danger">{deleteError}</div> : null}
      </ConfirmDialog>

      <WorldDatapacksDialog
        installationId={installationId}
        world={datapackWorld}
        onClose={() => setDatapackWorld(null)}
        onChanged={() => void load()}
      />
    </div>
  )
}
