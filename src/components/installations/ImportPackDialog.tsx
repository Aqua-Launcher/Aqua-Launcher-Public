import { useState } from 'react'
import { AlertTriangle, Archive, Check, FolderOpen } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { LoaderType, ModpackInspection } from '../../lib/types'
import { loaderLabel } from '../../lib/loaders'
import { useLauncher } from '../../state/LauncherProvider'
import { Badge, Button, Field, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

/**
 * Imports a local .mrpack or a Prism/MultiMC instance. Inspection happens before
 * anything is created, so a broken pack cannot leave an empty profile behind.
 */
export function ImportPackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pushToast } = useLauncher()
  const [info, setInfo] = useState<ModpackInspection | null>(null)
  const [mode, setMode] = useState<'copy' | 'adopt'>('copy')
  const [inspecting, setInspecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inspect = async (target: string | null) => {
    if (!target) return
    setInspecting(true)
    setError(null)
    setInfo(null)
    try {
      const result = await api.mods.inspectPack(target)
      setInfo(result)
      setMode('copy')
    } catch (inspectError) {
      setError(getErrorMessage(inspectError))
    } finally {
      setInspecting(false)
    }
  }

  const chooseFile = async () => {
    try {
      await inspect(await api.dialogs.choosePack())
    } catch (chooseError) {
      setError(getErrorMessage(chooseError))
    }
  }

  const chooseFolder = async () => {
    try {
      await inspect(await api.dialogs.chooseDirectory({ title: 'Choose a Prism or MultiMC instance' }))
    } catch (chooseError) {
      setError(getErrorMessage(chooseError))
    }
  }

  const submit = async () => {
    if (!info) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.mods.importPack(info.path, info.kind === 'prism' ? mode : 'copy')
      pushToast({
        level: 'info',
        title: `Importing ${result.info.name}`,
        message: 'Follow the progress in Tasks. You can cancel without touching the source pack.',
      })
      onClose()
    } catch (importError) {
      setError(getErrorMessage(importError))
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    if (submitting || inspecting) return
    setInfo(null)
    setError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import a modpack"
      subtitle="Bring in a Modrinth .mrpack or an existing Prism/MultiMC instance. Source files are never moved or changed."
      size="wide"
      footer={
        <>
          <span className="text-dim">
            {info ? `${info.path}` : 'Choose a pack to inspect its manifest first.'}
          </span>
          <Button variant="ghost" onClick={close} disabled={submitting || inspecting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={submitting ? undefined : <Check />}
            loading={submitting}
            disabled={!info || inspecting}
            onClick={() => void submit()}
          >
            {submitting ? 'Starting…' : 'Import pack'}
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

        <div className="install-dialog__top">
          <Field label="Modrinth modpack" hint="A .mrpack file downloaded from Modrinth.">
            <Button icon={<Archive />} onClick={() => void chooseFile()} loading={inspecting} disabled={submitting}>
              Choose .mrpack
            </Button>
          </Field>
          <Field label="Prism / MultiMC instance" hint="A folder containing instance.cfg and mmc-pack.json.">
            <Button icon={<FolderOpen />} onClick={() => void chooseFolder()} loading={inspecting} disabled={submitting}>
              Choose folder
            </Button>
          </Field>
        </div>

        {inspecting ? (
          <div className="health-loading">
            <Spinner /> Reading the pack manifest…
          </div>
        ) : null}

        {info ? (
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 16 }}>{info.name}</strong>
              <Badge tone="info">{info.kind === 'mrpack' ? 'Modrinth pack' : 'Prism instance'}</Badge>
            </div>
            <div className="text-dim" style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>Minecraft {info.minecraftVersion}</span>
              <span>
                {info.loader.type === 'vanilla'
                  ? 'Vanilla'
                  : `${loaderLabel(info.loader.type as LoaderType)} ${info.loader.version || ''}`}
              </span>
              <span>{info.files.toLocaleString()} files</span>
              {info.overrides ? <span>{info.overrides.toLocaleString()} overrides</span> : null}
            </div>
          </div>
        ) : null}

        {info?.kind === 'prism' ? (
          <div className="install-dialog__section">
            <div className="install-dialog__section-title">
              <div>
                <h3>How should Aqua use this folder?</h3>
                <p>Copy is safer. Adopt keeps the instance where it is and never moves it.</p>
              </div>
            </div>
            <div className="loader-choices" role="radiogroup" aria-label="Prism import mode">
              {[
                { id: 'copy' as const, label: 'Copy into Aqua', hint: 'The source instance stays untouched.' },
                { id: 'adopt' as const, label: 'Adopt in place', hint: 'Use the existing game folder directly.' },
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
                <AlertTriangle />
                <span>Adopt uses the original folder. Aqua will not move, copy, or delete it.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
