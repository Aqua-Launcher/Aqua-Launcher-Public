import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { loaderLabel } from '../../lib/loaders'
import { useLauncher } from '../../state/LauncherProvider'
import type {
  LauncherImportResult,
  LauncherProfileCandidate,
  LauncherScanResult,
  LoaderType,
} from '../../lib/types'
import { Badge, Button, Field, ProgressBar, Spinner, cx } from '../ui/primitives'
import { Modal } from '../ui/overlays'

function loaderText(candidate: LauncherProfileCandidate) {
  if (candidate.loader.type === 'vanilla') return 'Vanilla'
  return `${loaderLabel(candidate.loader.type as LoaderType)} ${candidate.loader.version || ''}`.trim()
}

function modeLabel(mode: 'adopt' | 'copy') {
  return mode === 'adopt' ? 'adopted in place' : 'copied into Aqua'
}

/**
 * Finds profiles installed by other launchers and turns the selected ones into
 * Aqua installations. Adopt only points at the existing game folder; copy reads
 * it and skips shared libraries, assets, versions and caches.
 */
export function LauncherImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { jobs, pushToast } = useLauncher()
  const [scan, setScan] = useState<LauncherScanResult | null>(null)
  const [extraPath, setExtraPath] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'adopt' | 'copy'>('adopt')
  const [importWorlds, setImportWorlds] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const job = jobId ? jobs.find((entry) => entry.id === jobId) || null : null
  const active = Boolean(job && (job.status === 'queued' || job.status === 'running'))
  const result = (job?.result as LauncherImportResult | null | undefined) || null

  const scanProfiles = useCallback(
    async (target: string | null) => {
      setScanning(true)
      setError(null)
      try {
        const next = await api.launcherImport.scan(target)
        setScan(next)
        setExtraPath(target)
        setSelected(new Set(next.candidates.map((candidate) => candidate.id)))
      } catch (scanError) {
        setScan(null)
        setError(getErrorMessage(scanError))
      } finally {
        setScanning(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    setMode('adopt')
    setImportWorlds(true)
    setJobId(null)
    setScan(null)
    setError(null)
    void scanProfiles(null)
  }, [open, scanProfiles])

  const candidates = scan?.candidates || []
  const groups = useMemo(() => {
    const grouped = new Map<string, { label: string; candidates: LauncherProfileCandidate[] }>()
    for (const candidate of candidates) {
      const group = grouped.get(candidate.launcher) || { label: candidate.launcherName, candidates: [] }
      group.candidates.push(candidate)
      grouped.set(candidate.launcher, group)
    }
    return [...grouped.values()]
  }, [candidates])

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((current) =>
      current.size === candidates.length ? new Set() : new Set(candidates.map((candidate) => candidate.id)),
    )
  }

  const chooseFolder = async () => {
    try {
      const target = await api.dialogs.chooseDirectory({ title: 'Choose a launcher or instance folder' })
      if (target) await scanProfiles(target)
    } catch (chooseError) {
      setError(getErrorMessage(chooseError))
    }
  }

  const start = async () => {
    if (!selected.size) return
    setSubmitting(true)
    setError(null)
    try {
      const submission = await api.launcherImport.start([...selected], {
        mode,
        importWorlds: mode === 'adopt' ? true : importWorlds,
        path: extraPath,
      })
      setJobId(submission.job.id)
      pushToast({
        level: 'info',
        title: `Importing ${submission.candidates.length} profile${submission.candidates.length === 1 ? '' : 's'}`,
        message: 'Progress and per-profile results are shown here and in Tasks.',
      })
    } catch (startError) {
      setError(getErrorMessage(startError))
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    try {
      await api.downloads.cancel(job.id)
    } catch (cancelError) {
      pushToast({ level: 'error', title: 'Could not cancel the import', message: getErrorMessage(cancelError) })
    }
  }

  const close = () => {
    if (submitting) return
    onClose()
  }

  const footer = jobId ? (
    <>
      <span className="text-dim">
        {active ? 'The import continues in Tasks if you close this window.' : 'Finished profiles are ready in Installations.'}
      </span>
      {active ? (
        <Button variant="ghost" onClick={() => void cancel()}>
          Cancel import
        </Button>
      ) : null}
      <Button variant="primary" onClick={close}>
        Close
      </Button>
    </>
  ) : (
    <>
      <span className="text-dim">
        {selected.size
          ? `${selected.size} profile${selected.size === 1 ? '' : 's'} selected · ${modeLabel(mode)}`
          : 'Select at least one profile to import.'}
      </span>
      <Button variant="ghost" onClick={close} disabled={submitting || scanning}>
        Cancel
      </Button>
      <Button
        variant="primary"
        icon={<ShieldCheck />}
        loading={submitting}
        disabled={!selected.size || scanning}
        onClick={() => void start()}
      >
        {selected.size ? `Import ${selected.size} profile${selected.size === 1 ? '' : 's'}` : 'Import profiles'}
      </Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import from another launcher"
      subtitle="Detect vanilla, Prism/MultiMC, CurseForge and ATLauncher profiles. Source folders are never modified during import."
      size="wide"
      footer={footer}
    >
      <div className="launcher-import">
        {error ? (
          <div className="callout callout--danger" role="alert">
            <AlertTriangle />
            <span>{error}</span>
          </div>
        ) : null}

        {jobId && job ? (
          <div className="launcher-import__job">
            <div className="launcher-import__job-head">
              <div>
                <strong>{job.title}</strong>
                <p>{job.stage}</p>
              </div>
              <Badge
                tone={
                  job.status === 'completed'
                    ? 'success'
                    : job.status === 'failed'
                      ? 'danger'
                      : job.status === 'cancelled'
                        ? 'default'
                        : 'info'
                }
              >
                {job.status === 'running' ? 'Importing' : job.status}
              </Badge>
            </div>
            <ProgressBar value={job.progress} label="Launcher import progress" />
            {job.filesTotal ? (
              <div className="launcher-import__progress">
                <span>
                  {job.filesDone.toLocaleString()} / {job.filesTotal.toLocaleString()} files
                </span>
                {job.currentFile ? <span className="mono">{job.currentFile}</span> : null}
              </div>
            ) : null}

            {job.status === 'failed' ? (
              <div className="callout callout--danger" role="alert">
                <AlertTriangle />
                <span>{job.error || 'The import did not finish.'}</span>
              </div>
            ) : null}

            {result ? (
              <div className="launcher-import__results">
                <div className="launcher-import__result-head">
                  <CheckCircle2 />
                  <span>
                    {result.imported.length} profile{result.imported.length === 1 ? '' : 's'} imported
                    {result.failed.length ? ` · ${result.failed.length} failed` : ''}
                  </span>
                </div>
                {result.imported.map((entry) => (
                  <div className="launcher-import__result" key={entry.installationId}>
                    <CheckCircle2 />
                    <div>
                      <strong>{entry.name}</strong>
                      <span>
                        Minecraft {entry.minecraftVersion} · {entry.loader.type === 'vanilla' ? 'Vanilla' : entry.loader.type}
                        {entry.mode === 'adopt' ? ' · adopted in place' : ` · ${entry.files.toLocaleString()} files copied`}
                      </span>
                    </div>
                  </div>
                ))}
                {result.failed.map((entry) => (
                  <div className="launcher-import__result is-failed" key={entry.candidateId}>
                    <AlertTriangle />
                    <div>
                      <strong>{entry.name}</strong>
                      <span>{entry.error}</span>
                    </div>
                  </div>
                ))}
                <p className="launcher-import__note">
                  Aqua downloads the Minecraft and loader files for these profiles in Tasks. Worlds and configs
                  {result.imported.some((entry) => entry.mode === 'adopt')
                    ? ' stay in the adopted folders.'
                    : ' were copied with the selected content.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="launcher-import__toolbar">
              <div>
                <strong>{scan ? `${candidates.length} profiles found` : 'Looking for launchers'}</strong>
                <p>
                  Standard launcher folders are checked automatically. Add a folder if a launcher lives somewhere
                  else.
                </p>
              </div>
              <div className="launcher-import__actions">
                <Button icon={<FolderOpen />} onClick={() => void chooseFolder()} disabled={scanning || submitting}>
                  Choose folder
                </Button>
                <Button
                  icon={<RefreshCw className={scanning ? 'spin' : undefined} />}
                  onClick={() => void scanProfiles(null)}
                  loading={scanning}
                  disabled={submitting}
                >
                  Rescan
                </Button>
              </div>
            </div>

            {scanning && !scan ? (
              <div className="health-loading">
                <Spinner /> Looking for vanilla, Prism/MultiMC, CurseForge and ATLauncher profiles…
              </div>
            ) : null}

            {scan && candidates.length === 0 && !scanning ? (
              <div className="launcher-import__empty">
                <AlertTriangle />
                <div>
                  <strong>No profiles found</strong>
                  <p>Choose the folder that contains your launcher instances, or scan again after installing one.</p>
                </div>
              </div>
            ) : null}

            {scan?.errors.length ? (
              <div className="callout callout--warning">
                <AlertTriangle />
                <span>
                  {scan.errors.slice(0, 3).join(' ')}
                  {scan.errors.length > 3 ? ` ${scan.errors.length - 3} more could not be read.` : ''}
                </span>
              </div>
            ) : null}

            {candidates.length ? (
              <>
                <div className="launcher-import__selectbar">
                  <label className="launcher-import__check">
                    <input
                      type="checkbox"
                      checked={selected.size === candidates.length}
                      onChange={toggleAll}
                      disabled={submitting}
                    />
                    <span>Select all</span>
                  </label>
                  <span className="text-dim">
                    {selected.size} of {candidates.length} selected
                  </span>
                </div>

                <div className="launcher-import__groups">
                  {groups.map((group) => (
                    <section className="launcher-import__group" key={group.label}>
                      <div className="launcher-import__group-head">
                        <h3>{group.label}</h3>
                        <Badge>{group.candidates.length}</Badge>
                      </div>
                      <div className="launcher-import__rows">
                        {group.candidates.map((candidate) => (
                          <label
                            className={cx(
                              'launcher-import__row',
                              selected.has(candidate.id) && 'is-selected',
                            )}
                            key={candidate.id}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(candidate.id)}
                              onChange={() => toggle(candidate.id)}
                              disabled={submitting}
                            />
                            <div className="launcher-import__copy">
                              <div className="launcher-import__name">
                                <strong>{candidate.name}</strong>
                                <span className="text-dim">{candidate.minecraftVersion}</span>
                              </div>
                              <div className="launcher-import__meta">
                                <span>{loaderText(candidate)}</span>
                                <span>{candidate.mods.toLocaleString()} mods</span>
                                <span>{candidate.worlds.toLocaleString()} worlds</span>
                                <span>
                                  {formatBytes(candidate.bytes)}
                                  {candidate.sizeCapped ? '+' : ''}
                                </span>
                              </div>
                              <div className="launcher-import__path" title={candidate.sourceDir}>
                                {candidate.path}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="install-dialog__section">
                  <div className="install-dialog__section-title">
                    <div>
                      <h3>How should Aqua use these folders?</h3>
                      <p>Adopt is recommended and copies nothing. Copy leaves the originals alone and brings the game content into Aqua.</p>
                    </div>
                  </div>
                  <div className="loader-choices" role="radiogroup" aria-label="Launcher import mode">
                    {[
                      {
                        id: 'adopt' as const,
                        label: 'Adopt in place',
                        hint: 'Point Aqua at the existing folders. Nothing is copied or moved.',
                      },
                      {
                        id: 'copy' as const,
                        label: 'Copy into Aqua',
                        hint: 'Copy mods, configs and worlds; skip libraries, versions and caches.',
                      },
                    ].map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        role="radio"
                        aria-checked={mode === choice.id}
                        className={`loader-choice${mode === choice.id ? ' is-selected' : ''}`}
                        title={choice.hint}
                        onClick={() => setMode(choice.id)}
                        disabled={submitting}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                  {mode === 'adopt' ? (
                    <div className="callout callout--warning" style={{ marginTop: 12 }}>
                      <ShieldCheck />
                      <span>
                        Adopt never moves or deletes the source. The game may write saves and configs there when you
                        launch, just as the original launcher did.
                      </span>
                    </div>
                  ) : (
                    <Field
                      label="Worlds"
                      hint="Copying worlds can be large. Mods and configs are always included."
                    >
                      <label className="launcher-import__check">
                        <input
                          type="checkbox"
                          checked={importWorlds}
                          onChange={(event) => setImportWorlds(event.target.checked)}
                          disabled={submitting}
                        />
                        <span>Copy saves and worlds</span>
                      </label>
                    </Field>
                  )}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}
