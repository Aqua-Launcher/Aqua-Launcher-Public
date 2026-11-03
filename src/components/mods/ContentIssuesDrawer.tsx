import { useState } from 'react'
import { AlertTriangle, Copy, FolderOpen } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { ContentConflictsResult, ModrinthContentType } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const LOADER_LABELS: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  vanilla: 'Vanilla',
}

function label(value: string) {
  return LOADER_LABELS[value] || value
}

function issueSummary(conflicts: ContentConflictsResult) {
  return [
    conflicts.missingDependencies.length
      ? `${conflicts.missingDependencies.length} missing dependenc${conflicts.missingDependencies.length === 1 ? 'y' : 'ies'}`
      : null,
    conflicts.duplicateIds.length
      ? `${conflicts.duplicateIds.length} duplicate mod ID${conflicts.duplicateIds.length === 1 ? '' : 's'}`
      : null,
    conflicts.loaderMismatch.length
      ? `${conflicts.loaderMismatch.length} wrong loader${conflicts.loaderMismatch.length === 1 ? '' : 's'}`
      : null,
    conflicts.versionMismatch.length
      ? `${conflicts.versionMismatch.length} Minecraft version mismatch${conflicts.versionMismatch.length === 1 ? '' : 'es'}`
      : null,
    conflicts.knownIncompatible.length
      ? `${conflicts.knownIncompatible.length} known conflict${conflicts.knownIncompatible.length === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function diagnosticText(conflicts: ContentConflictsResult) {
  const lines = ['Aqua content issues', issueSummary(conflicts), '']
  if (conflicts.missingDependencies.length) {
    lines.push('Missing dependencies:')
    for (const issue of conflicts.missingDependencies) {
      lines.push(`- ${issue.modName} (${issue.filename}) requires ${issue.dependencyId}`)
    }
    lines.push('')
  }
  if (conflicts.duplicateIds.length) {
    lines.push('Duplicate mod IDs:')
    for (const issue of conflicts.duplicateIds) {
      lines.push(`- ${issue.modId}: ${issue.files.map((file) => file.filename).join(', ')}`)
    }
    lines.push('')
  }
  if (conflicts.loaderMismatch.length) {
    lines.push('Wrong loader:')
    for (const issue of conflicts.loaderMismatch) {
      lines.push(`- ${issue.filename} targets ${label(issue.loader)}, profile runs ${label(issue.expectedLoader)}`)
    }
    lines.push('')
  }
  if (conflicts.versionMismatch.length) {
    lines.push('Minecraft version mismatch:')
    for (const issue of conflicts.versionMismatch) {
      lines.push(`- ${issue.filename} supports ${issue.range}, profile is ${issue.gameVersion}`)
    }
    lines.push('')
  }
  if (conflicts.knownIncompatible.length) {
    lines.push('Known incompatible pairs:')
    for (const issue of conflicts.knownIncompatible) {
      lines.push(`- ${issue.left.name} + ${issue.right.name}: ${issue.reason} (${issue.source})`)
    }
  }
  return lines.join('\n').trim()
}

export function ContentIssuesDrawer({
  conflicts,
  installationId,
  contentType,
  onClose,
  onChanged,
}: {
  conflicts: ContentConflictsResult
  installationId: string
  contentType: ModrinthContentType
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const { pushToast } = useLauncher()
  const [busyFilename, setBusyFilename] = useState<string | null>(null)

  const disable = async (filename: string) => {
    setBusyFilename(filename)
    try {
      await api.mods.toggle(installationId, filename, contentType)
      await onChanged()
      pushToast({ level: 'success', title: `Disabled ${filename}`, message: 'Re-run the issue check to see the updated result.' })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not disable that file', message: getErrorMessage(error) })
    } finally {
      setBusyFilename(null)
    }
  }

  const copySummary = () => {
    if (api.copyText(diagnosticText(conflicts))) {
      pushToast({ level: 'success', title: 'Issue summary copied' })
    } else {
      pushToast({ level: 'error', title: 'Could not copy the summary' })
    }
  }

  const openFolder = async () => {
    try {
      await api.mods.openFolder(installationId, contentType)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open the folder', message: getErrorMessage(error) })
    }
  }

  const disableButton = (filename: string) => (
    <Button
      size="sm"
      variant="ghost"
      loading={busyFilename === filename}
      disabled={Boolean(busyFilename)}
      onClick={() => void disable(filename)}
    >
      Disable
    </Button>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title="Content issues"
      subtitle={`${conflicts.total} issue${conflicts.total === 1 ? '' : 's'} found in the enabled content`}
      size="wide"
      className="mod-inspector-drawer"
      footer={
        <>
          <Button variant="ghost" icon={<Copy />} onClick={copySummary}>
            Copy summary
          </Button>
          <Button variant="ghost" icon={<FolderOpen />} onClick={() => void openFolder()}>
            Open folder
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="content-issues">
        <div className="callout callout--warning">
          <AlertTriangle />
          <span>Disabled files are ignored. Disable a file here, then reopen the issue report to check the result.</span>
        </div>

        {conflicts.missingDependencies.length ? (
          <section className="content-issues__section">
            <h3>Missing dependencies · {conflicts.missingDependencies.length}</h3>
            <ul className="content-issues__list">
              {conflicts.missingDependencies.map((issue, index) => (
                <li key={`${issue.filename}-${issue.dependencyId}-${index}`} className="content-issue">
                  <div className="content-issue__main">
                    <strong>{issue.modName}</strong>
                    <span>{issue.filename}</span>
                  </div>
                  <p>
                    Requires <code>{issue.dependencyId}</code>. The game may reject this mod until the dependency is
                    installed.
                  </p>
                  <div className="content-issue__actions">{disableButton(issue.filename)}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conflicts.duplicateIds.length ? (
          <section className="content-issues__section">
            <h3>Duplicate mod IDs · {conflicts.duplicateIds.length}</h3>
            <ul className="content-issues__list">
              {conflicts.duplicateIds.map((issue) => (
                <li key={issue.modId} className="content-issue">
                  <div className="content-issue__main">
                    <strong>{issue.modId}</strong>
                    <span>More than one enabled jar declares this ID.</span>
                  </div>
                  <p>Only one copy can load; Minecraft may pick either file unpredictably.</p>
                  <div className="content-issue__actions">
                    {issue.files.map((file) => (
                      <span key={file.filename} className="content-issue__file-action">
                        <code>{file.filename}</code>
                        {disableButton(file.filename)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conflicts.loaderMismatch.length ? (
          <section className="content-issues__section">
            <h3>Wrong loader · {conflicts.loaderMismatch.length}</h3>
            <ul className="content-issues__list">
              {conflicts.loaderMismatch.map((issue, index) => (
                <li key={`${issue.filename}-${index}`} className="content-issue">
                  <div className="content-issue__main">
                    <strong>{issue.name}</strong>
                    <span>{issue.filename}</span>
                  </div>
                  <p>
                    Targets {label(issue.loader)}, but this profile runs {label(issue.expectedLoader)}. The loader will
                    ignore or reject it.
                  </p>
                  <div className="content-issue__actions">{disableButton(issue.filename)}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conflicts.versionMismatch.length ? (
          <section className="content-issues__section">
            <h3>Minecraft version mismatch · {conflicts.versionMismatch.length}</h3>
            <ul className="content-issues__list">
              {conflicts.versionMismatch.map((issue, index) => (
                <li key={`${issue.filename}-${index}`} className="content-issue">
                  <div className="content-issue__main">
                    <strong>{issue.name}</strong>
                    <span>{issue.filename}</span>
                  </div>
                  <p>
                    Declares Minecraft <code>{issue.range}</code>, but this profile is <code>{issue.gameVersion}</code>.
                  </p>
                  <div className="content-issue__actions">{disableButton(issue.filename)}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conflicts.knownIncompatible.length ? (
          <section className="content-issues__section">
            <h3>Known conflicts · {conflicts.knownIncompatible.length}</h3>
            <ul className="content-issues__list">
              {conflicts.knownIncompatible.map((issue, index) => (
                <li key={`${issue.left.filename}-${issue.right.filename}-${index}`} className="content-issue">
                  <div className="content-issue__main">
                    <strong>
                      {issue.left.name} + {issue.right.name}
                    </strong>
                    <span>{issue.reason}</span>
                  </div>
                  <p className="content-issue__source">Source: {issue.source}</p>
                  <div className="content-issue__actions">
                    {[issue.left, issue.right].map((file) => (
                      <span key={file.filename} className="content-issue__file-action">
                        <code>{file.filename}</code>
                        {disableButton(file.filename)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  )
}
