import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileArchive, Gem, Image, Package, Sparkles, Upload } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import type {
  ContentImportPolicy,
  ContentImportResult,
  ContentImportTarget,
  ModpackInspection,
  ModrinthContentType,
} from '../../lib/types'
import { Badge, Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const TARGETS: Record<ContentImportTarget, { label: string; Icon: typeof Package }> = {
  mod: { label: 'Mods', Icon: Package },
  resourcepack: { label: 'Resource packs', Icon: Image },
  shader: { label: 'Shader packs', Icon: Sparkles },
  bedrock: { label: 'Bedrock add-ons', Icon: Gem },
  unsupported: { label: 'Not importable', Icon: FileArchive },
}

const POLICIES: { id: ContentImportPolicy; label: string; description: string }[] = [
  {
    id: 'keep-both',
    label: 'Keep both',
    description: 'Rename the incoming file so the existing file is untouched.',
  },
  {
    id: 'replace',
    label: 'Replace',
    description: 'Overwrite the existing file with the dropped copy.',
  },
  {
    id: 'skip',
    label: 'Skip',
    description: 'Leave existing files alone and import the rest.',
  },
]

function hasFiles(event: DragEvent) {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'))
}

export function DropImportOverlay() {
  const { selectedInstallation, bedrock, route, pushToast } = useLauncher()
  const [dragging, setDragging] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [plan, setPlan] = useState<ContentImportResult | null>(null)
  const [packInfo, setPackInfo] = useState<ModpackInspection | null>(null)
  const [packStarting, setPackStarting] = useState(false)
  const [policy, setPolicy] = useState<ContentImportPolicy>('keep-both')
  const dragDepth = useRef(0)

  const contentType = (route.params?.contentType ?? 'mod') as ModrinthContentType
  const installationId = selectedInstallation?.id ?? null
  const bedrockEditionId = bedrock?.editions[0]?.id ?? null

  const inspect = useCallback(
    async (files: File[]) => {
      if (document.querySelector('.modal-overlay')) return
      const paths = files.map((file) => api.files.getPath(file)).filter(Boolean)
      if (!paths.length) {
        pushToast({ level: 'error', title: 'Could not read the dropped files', message: 'Try choosing the files from a folder instead.' })
        return
      }
      setInspecting(true)
      try {
        const first = files[0]
        if (files.length === 1 && /\.mrpack$/i.test(first.name)) {
          setPlan(null)
          setPackInfo(await api.mods.inspectPack(paths[0]))
          return
        }
        const result = await api.content.importFiles({
          installationId,
          contentType,
          paths,
          dryRun: true,
          bedrockEditionId,
        })
        setPlan(result)
        setPolicy(result.conflicts.length ? 'keep-both' : 'replace')
      } catch (error) {
        pushToast({ level: 'error', title: 'Could not inspect the dropped files', message: getErrorMessage(error) })
      } finally {
        setInspecting(false)
      }
    },
    [bedrockEditionId, contentType, installationId, pushToast],
  )

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (document.querySelector('.modal-overlay')) return
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (document.querySelector('.modal-overlay')) return
      void inspect(Array.from(event.dataTransfer?.files ?? []))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [inspect])

  const importableCount = plan?.items.filter((item) => !item.reason).length ?? 0

  const confirm = async () => {
    if (!plan) return
    setImporting(true)
    try {
      const result = await api.content.importFiles({
        installationId,
        contentType,
        paths: plan.items.filter((item) => !item.reason).map((item) => item.sourcePath),
        dryRun: false,
        conflictPolicy: plan.conflicts.length ? policy : 'replace',
        bedrockEditionId,
      })
      const failed = result.errors.length
      const skipped = result.skipped.length
      if (result.imported.length) {
        pushToast({
          level: failed || skipped ? 'warning' : 'success',
          title: `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}`,
          message:
            failed || skipped
              ? `${failed + skipped} file${failed + skipped === 1 ? '' : 's'} could not be imported or was skipped.`
              : 'The installed content list will refresh.',
        })
      } else {
        pushToast({
          level: 'error',
          title: 'Nothing was imported',
          message: result.errors[0]?.reason || result.skipped[0]?.reason || 'The dropped files were not usable.',
        })
      }
      window.dispatchEvent(new CustomEvent('aqua:content-imported', { detail: result }))
      setPlan(null)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not import the dropped files', message: getErrorMessage(error) })
    } finally {
      setImporting(false)
    }
  }

  const confirmPack = async () => {
    if (!packInfo) return
    setPackStarting(true)
    try {
      const result = await api.mods.importPack(packInfo.path, 'copy')
      pushToast({
        level: 'info',
        title: `Importing ${result.info.name}`,
        message: 'Track progress and cancel from Tasks. The source .mrpack is left untouched.',
      })
      setPackInfo(null)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not import the modpack', message: getErrorMessage(error) })
    } finally {
      setPackStarting(false)
    }
  }

  return (
    <>
      {dragging || inspecting ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__card">
            <span className="drop-overlay__icon">
              {inspecting ? <Loader /> : <Upload />}
            </span>
            <strong>{inspecting ? 'Reading dropped files…' : 'Drop to import'}</strong>
            <span>{inspecting ? 'Checking destinations and conflicts' : 'Jar · mods · zip · packs · mrpack · Bedrock add-ons'}</span>
          </div>
        </div>
      ) : null}

      {plan ? (
        <Modal
          open
          onClose={() => (importing ? undefined : setPlan(null))}
          title="Import dropped files"
          subtitle={`${importableCount} file${importableCount === 1 ? '' : 's'} ready · review before writing`}
          size="wide"
          className="mod-inspector-drawer"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPlan(null)} disabled={importing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={importing ? <Loader /> : <Upload />}
                loading={importing}
                disabled={!importableCount}
                onClick={() => void confirm()}
              >
                {importing ? 'Importing…' : `Import ${importableCount}`}
              </Button>
            </>
          }
        >
          <div className="import-plan">
            {plan.gameRunning ? (
              <div className="callout callout--warning">
                <AlertTriangle />
                <span>Minecraft is running. The files will be added, but restart the game to load them.</span>
              </div>
            ) : null}

            <ul className="import-plan__list">
              {plan.items.map((item, index) => {
                const target = TARGETS[item.target]
                return (
                  <li key={`${item.sourcePath}-${index}`} className={item.reason ? 'import-plan__item is-error' : 'import-plan__item'}>
                    <span className="import-plan__icon">
                      <target.Icon />
                    </span>
                    <span className="import-plan__copy">
                      <strong>{item.filename}</strong>
                      <small>
                        {item.reason || `${target.label}${item.conflict ? ' · a file with this name already exists' : ''}`}
                      </small>
                    </span>
                    {item.reason ? (
                      <Badge tone="danger">Not imported</Badge>
                    ) : item.conflict ? (
                      <Badge tone="warning">Conflict</Badge>
                    ) : (
                      <Badge tone="success">Ready</Badge>
                    )}
                  </li>
                )
              })}
            </ul>

            {plan.conflicts.length ? (
              <fieldset className="import-plan__policy">
                <legend>Name conflicts</legend>
                {POLICIES.map((option) => (
                  <label key={option.id} className="import-plan__radio">
                    <input
                      type="radio"
                      name="import-policy"
                      value={option.id}
                      checked={policy === option.id}
                      onChange={() => setPolicy(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
        </Modal>
      ) : null}

      <Modal
        open={Boolean(packInfo)}
        onClose={() => (packStarting ? undefined : setPackInfo(null))}
        title="Import modpack"
        subtitle="The pack becomes a new installation after its manifest validates."
        size="wide"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackInfo(null)} disabled={packStarting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<FileArchive />}
              loading={packStarting}
              onClick={() => void confirmPack()}
            >
              {packStarting ? 'Starting…' : 'Import pack'}
            </Button>
          </>
        }
      >
        {packInfo ? (
          <div className="import-plan">
            <div className="callout callout--info">
              <FileArchive />
              <div>
                <strong>{packInfo.name}</strong>
                <div className="text-dim">
                  Minecraft {packInfo.minecraftVersion}
                  {packInfo.loader.type !== 'vanilla' ? ` · ${packInfo.loader.type} ${packInfo.loader.version || ''}` : ' · vanilla'}
                  {' · '}
                  {packInfo.files.toLocaleString()} files
                  {packInfo.overrides ? ` · ${packInfo.overrides.toLocaleString()} overrides` : ''}
                </div>
              </div>
            </div>
            <p className="text-dim">
              Aqua verifies the loader version before creating a profile. If the import fails or is cancelled, the
              half-created profile is removed and the source pack is left untouched.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

/** Local spinner avoids pulling a loading state into the drop overlay. */
function Loader() {
  return <span className="drop-spinner" />
}
