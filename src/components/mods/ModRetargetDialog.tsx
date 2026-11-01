import { useEffect, useState, type CSSProperties } from 'react'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Wand2 } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { InstalledMod, ModRetargetAnalysis } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Button, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const LOADER_LABELS: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  vanilla: 'Vanilla',
}

const factLabel: CSSProperties = {
  color: 'var(--dim)',
  fontSize: 11,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const factValue: CSSProperties = {
  margin: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
}

function loaderLabel(loader: string | null) {
  return LOADER_LABELS[loader || ''] || loader || 'Unknown'
}

/**
 * A mod built for one Minecraft patch often only blocks itself through the
 * version range in its metadata. This dialog changes that declaration for the
 * selected profile and keeps the original jar so the change can be undone.
 */
export function ModRetargetDialog({
  installationId,
  mod,
  onClose,
  onChanged,
}: {
  installationId: string | null
  mod: InstalledMod | null
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const { pushToast } = useLauncher()
  const [analysis, setAnalysis] = useState<ModRetargetAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'convert' | 'undo' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(mod && installationId)
  const filename = mod?.filename ?? null

  useEffect(() => {
    if (!open || !installationId || !filename) {
      setAnalysis(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setAnalysis(null)
    void api.mods
      .retargetInfo(installationId, filename)
      .then((result) => {
        if (!cancelled) setAnalysis(result)
      })
      .catch((cause) => {
        if (!cancelled) setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filename, installationId, open])

  const convert = async () => {
    if (!installationId || !filename || analysis?.status !== 'ready') return
    setBusy('convert')
    setError(null)
    try {
      const result = await api.mods.retarget(installationId, filename)
      setAnalysis(result)
      await onChanged()
      pushToast({
        level: 'success',
        title: 'Mod converted',
        message: `${result.filename} now declares Minecraft ${result.targetVersion}. Launch the game to test it.`,
      })
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    if (!installationId || !filename) return
    setBusy('undo')
    setError(null)
    try {
      const result = await api.mods.retargetUndo(installationId, filename)
      setAnalysis(result)
      await onChanged()
      pushToast({
        level: 'success',
        title: 'Original mod restored',
        message: `${result.filename} is back to its original version declaration.`,
      })
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const close = busy ? () => {} : onClose
  const convertedForAnotherProfile = Boolean(
    analysis?.converted &&
      analysis.convertedVersion &&
      analysis.convertedVersion !== analysis.targetVersion,
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Convert mod version"
      subtitle={filename ?? undefined}
      size="sm"
      footer={
        <>
          {analysis?.canUndo ? (
            <div className="modal__footer-left">
              <Button
                variant="ghost"
                icon={<RotateCcw />}
                loading={busy === 'undo'}
                disabled={busy !== null}
                onClick={() => void restore()}
              >
                Restore original
              </Button>
            </div>
          ) : null}
          <Button variant="ghost" onClick={close} disabled={busy !== null}>
            Close
          </Button>
          <Button
            variant="primary"
            icon={<Wand2 />}
            loading={busy === 'convert'}
            disabled={
              busy !== null ||
              loading ||
              !analysis ||
              analysis.status !== 'ready' ||
              analysis.converted
            }
            onClick={() => void convert()}
          >
            {analysis?.converted
              ? 'Converted'
              : analysis?.status === 'ready'
                ? `Convert to ${analysis.targetVersion}`
                : 'Convert'}
          </Button>
        </>
      }
    >
      <div className="stack gap-3">
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.65 }}>
          Change the Minecraft version this mod asks for. Aqua edits the version declaration only;
          the mod&apos;s code is untouched, so test it before using it in a world you care about.
        </p>

        {loading ? (
          <div className="row gap-2" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
            <Spinner /> Reading the mod metadata…
          </div>
        ) : error ? (
          <div className="callout callout--danger">
            <AlertTriangle />
            <span>{error}</span>
          </div>
        ) : analysis ? (
          <>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '8px 16px',
                margin: 0,
                padding: '12px 14px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--panel)',
              }}
            >
              <dt style={factLabel}>Built for</dt>
              <dd style={factValue}>{analysis.declaredRange ?? 'Any Minecraft version'}</dd>
              <dt style={factLabel}>This profile</dt>
              <dd style={factValue}>
                Minecraft {analysis.targetVersion} · {loaderLabel(analysis.targetLoader)}
              </dd>
              <dt style={factLabel}>Mod loader</dt>
              <dd style={factValue}>{loaderLabel(analysis.modLoader)}</dd>
              {analysis.metadataPath ? (
                <>
                  <dt style={factLabel}>Metadata</dt>
                  <dd style={factValue}>{analysis.metadataPath}</dd>
                </>
              ) : null}
            </dl>

            {analysis.status === 'blocked' ? (
              <div className="callout callout--danger">
                <AlertTriangle />
                <span>{analysis.reason ?? 'This mod cannot be converted for this profile.'}</span>
              </div>
            ) : analysis.converted ? (
              <div className="callout callout--success">
                <CheckCircle2 />
                <span>
                  Converted for Minecraft {analysis.convertedVersion ?? analysis.targetVersion}.
                  {convertedForAnotherProfile
                    ? ` This profile now runs ${analysis.targetVersion}; restore the original before converting again.`
                    : ' The original jar is backed up, so you can restore it at any time.'}
                </span>
              </div>
            ) : analysis.status === 'compatible' ? (
              <div className="callout callout--info">
                <Info />
                <span>
                  This mod already allows Minecraft {analysis.targetVersion}. No conversion is
                  needed.
                </span>
              </div>
            ) : (
              <>
                <div className="callout callout--warning">
                  <AlertTriangle />
                  <span>
                    Aqua can change the declaration from <strong>{analysis.declaredRange}</strong> to{' '}
                    <strong>{analysis.suggestedRange}</strong>. A backup of the original file is kept.
                  </span>
                </div>
                {analysis.warnings.length ? (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      color: 'var(--muted)',
                      fontSize: 12,
                      lineHeight: 1.65,
                    }}
                  >
                    {analysis.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}

            {mod && !mod.enabled ? (
              <p style={{ margin: 0, color: 'var(--dim)', fontSize: 11.5, lineHeight: 1.6 }}>
                This mod is currently disabled. Enable it from the installed list before launching.
              </p>
            ) : null}

            {analysis.converted ? (
              <p style={{ margin: 0, color: 'var(--dim)', fontSize: 11.5, lineHeight: 1.6 }}>
                Modrinth update checks stop recognising a converted file because its hash changes.
                Restore the original or install the newer file from Modrinth instead.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
