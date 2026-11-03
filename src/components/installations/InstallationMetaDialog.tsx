import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { getErrorMessage } from '../../lib/api'
import { INSTALLATION_COLORS } from '../../lib/installationMeta'
import { useLauncher } from '../../state/LauncherProvider'
import type { Installation, InstallationColor } from '../../lib/types'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const MAX_TAGS = 8
const MAX_TAG_LENGTH = 24

export function InstallationMetaDialog({
  installation,
  onClose,
}: {
  installation: Installation | null
  onClose: () => void
}) {
  const { updateInstallationMeta, pushToast } = useLauncher()
  const [tags, setTags] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [color, setColor] = useState<InstallationColor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTags(installation?.tags ?? [])
    setColor(installation?.color ?? null)
    setDraft('')
    setError(null)
  }, [installation?.id])

  const addTag = () => {
    const tag = draft.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
    if (!tag) return
    if (tags.some((entry) => entry.toLowerCase() === tag.toLowerCase())) {
      setDraft('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setError(`Use up to ${MAX_TAGS} tags.`)
      return
    }
    setTags((current) => [...current, tag])
    setDraft('')
    setError(null)
  }

  const save = async () => {
    if (!installation) return
    setSaving(true)
    setError(null)
    try {
      await updateInstallationMeta(installation.id, { tags, color })
      pushToast({ level: 'success', title: 'Profile details updated', message: installation.name })
      onClose()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(installation)}
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Tags & colour"
      subtitle={installation?.name}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="installation-meta">
        <div className="installation-meta__field">
          <span className="installation-meta__label">Tags</span>
          <div className="installation-meta__tags">
            {tags.length ? (
              tags.map((tag) => (
                <span className="installation-meta__tag" key={tag}>
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    onClick={() => setTags((current) => current.filter((entry) => entry !== tag))}
                  >
                    <X />
                  </button>
                </span>
              ))
            ) : (
              <span className="installation-meta__empty">No tags yet. Tags stay local and only filter this list.</span>
            )}
          </div>
          <div className="installation-meta__add">
            <input
              className="input"
              value={draft}
              maxLength={MAX_TAG_LENGTH}
              placeholder="e.g. Modded, 1.21, Friends"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  addTag()
                }
              }}
              aria-label="New tag"
            />
            <Button size="sm" icon={<Plus />} onClick={addTag} disabled={!draft.trim() || tags.length >= MAX_TAGS}>
              Add
            </Button>
          </div>
          <span className="installation-meta__hint">
            Up to {MAX_TAGS} tags, {MAX_TAG_LENGTH} characters each. Click a tag on a card to filter.
          </span>
        </div>

        <div className="installation-meta__field">
          <span className="installation-meta__label">Colour</span>
          <div className="installation-meta__colors" role="group" aria-label="Profile colour">
            {INSTALLATION_COLORS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`installation-meta__swatch${color === option.id ? ' is-active' : ''}`}
                style={{ background: option.hex }}
                aria-label={option.label}
                aria-pressed={color === option.id}
                title={option.label}
                onClick={() => setColor(color === option.id ? null : option.id)}
              />
            ))}
            <button
              type="button"
              className={`installation-meta__swatch is-none${color === null ? ' is-active' : ''}`}
              aria-label="No colour"
              aria-pressed={color === null}
              title="No colour"
              onClick={() => setColor(null)}
            />
          </div>
        </div>

        {error ? (
          <div className="callout callout--danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
