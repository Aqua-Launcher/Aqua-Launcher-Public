import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  ImageOff,
  Monitor,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatDateTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { ScreenshotImage, ScreenshotList, ScreenshotThumbnail } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Button, EmptyState, Spinner, cx } from '../components/ui/primitives'
import { ConfirmDialog, Modal } from '../components/ui/overlays'

function ScreenshotCard({
  image,
  thumbnail,
  onLoad,
  onOpen,
}: {
  image: ScreenshotImage
  thumbnail: string | undefined
  onLoad: () => void
  onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (thumbnail || !ref.current) return
    if (!('IntersectionObserver' in window)) {
      onLoad()
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          onLoad()
        }
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [onLoad, thumbnail])

  return (
    <button
      ref={ref}
      type="button"
      className={cx('screenshot-card', !thumbnail && 'is-loading')}
      onClick={onOpen}
      aria-label={`Open ${image.filename}`}
    >
      {thumbnail ? (
        <img src={thumbnail} alt={image.filename} loading="lazy" draggable={false} />
      ) : (
        <span className="screenshot-card__placeholder" aria-hidden="true">
          <ImageIcon />
        </span>
      )}
      <span className="screenshot-card__meta">
        <span className="screenshot-card__name">{image.filename}</span>
        <span className="screenshot-card__details">
          {image.width && image.height ? `${image.width} × ${image.height} · ` : ''}
          {formatBytes(image.size)}
        </span>
      </span>
    </button>
  )
}

function ScreenshotLightbox({
  installationId,
  image,
  index,
  total,
  hasBackground,
  onClose,
  onPrevious,
  onNext,
  onDelete,
  onSetBackground,
  onOpenFolder,
  onReveal,
  onCopy,
}: {
  installationId: string
  image: ScreenshotImage
  index: number
  total: number
  hasBackground: boolean
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onDelete: () => void
  onSetBackground: () => void
  onOpenFolder: () => void
  onReveal: () => void
  onCopy: () => void
}) {
  const [preview, setPreview] = useState<ScreenshotThumbnail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    void api.screenshots
      .thumbnail(installationId, image.filename, 1800)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [image.filename, installationId])

  return (
    <Modal
      open
      onClose={onClose}
      title={image.filename}
      subtitle={`${formatDateTime(image.modified)}${image.width && image.height ? ` · ${image.width} × ${image.height}` : ''}`}
      size="xl"
      footer={
        <div className="screenshot-lightbox__footer">
          <div className="row gap-2">
            <Button size="sm" variant="ghost" icon={<Copy />} onClick={onCopy}>
              Copy image
            </Button>
            <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={onReveal}>
              Show in folder
            </Button>
            <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={onOpenFolder}>
              Open folder
            </Button>
          </div>
          <div className="row gap-2">
            <Button size="sm" icon={<Monitor />} onClick={onSetBackground}>
              {hasBackground ? 'Replace background' : 'Use as background'}
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 />} onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      }
    >
      <div className="screenshot-lightbox">
        {preview ? (
          <img src={preview.dataUrl} alt={image.filename} />
        ) : error ? (
          <div className="screenshot-lightbox__message">
            <ImageOff />
            <span>{error}</span>
          </div>
        ) : (
          <div className="screenshot-lightbox__message">
            <Spinner size="lg" />
            <span>Loading screenshot…</span>
          </div>
        )}
        {total > 1 ? (
          <>
            <button type="button" className="screenshot-lightbox__nav screenshot-lightbox__nav--prev" onClick={onPrevious} aria-label="Previous screenshot">
              <ChevronLeft />
            </button>
            <button type="button" className="screenshot-lightbox__nav screenshot-lightbox__nav--next" onClick={onNext} aria-label="Next screenshot">
              <ChevronRight />
            </button>
            <span className="screenshot-lightbox__count">
              {index + 1} / {total}
            </span>
          </>
        ) : null}
      </div>
    </Modal>
  )
}

export function ScreenshotsPage() {
  const { selectedInstallation, settings, game, navigate, pushToast } = useLauncher()
  const installationId = selectedInstallation?.id ?? null
  const [result, setResult] = useState<ScreenshotList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [viewingIndex, setViewingIndex] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [settingBackground, setSettingBackground] = useState(false)
  const [clearingBackground, setClearingBackground] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScreenshotImage | null>(null)
  const thumbCache = useRef(new Map<string, string>())
  const requested = useRef(new Set<string>())
  const loadSeq = useRef(0)
  const thumbnailGeneration = useRef(0)

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
      const payload = await api.screenshots.list(installationId)
      if (seq === loadSeq.current) setResult(payload)
    } catch (loadError) {
      if (seq === loadSeq.current) setError(getErrorMessage(loadError))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [installationId])

  useEffect(() => {
    thumbnailGeneration.current += 1
    thumbCache.current.clear()
    requested.current.clear()
    setResult(null)
    setThumbs({})
    setViewingIndex(null)
    setDeleteTarget(null)
    void load()
  }, [installationId, load])

  useEffect(() => {
    if (installationId && (game.status === 'exited' || game.status === 'crashed')) void load()
  }, [game.status, installationId, load])

  useEffect(() => {
    if (viewingIndex == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setViewingIndex((current) => (current == null ? null : (current - 1 + images.length) % images.length))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setViewingIndex((current) => (current == null ? null : (current + 1) % images.length))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewingIndex, result?.images.length])

  const images = result?.images ?? []
  const activeImage = viewingIndex == null ? null : images[viewingIndex] ?? null

  const requestThumbnail = useCallback(
    (filename: string) => {
      if (!installationId || thumbCache.current.has(filename) || requested.current.has(filename)) return
      const generation = thumbnailGeneration.current
      requested.current.add(filename)
      void api.screenshots
        .thumbnail(installationId, filename, 480)
        .then((thumbnail) => {
          if (generation !== thumbnailGeneration.current) return
          thumbCache.current.set(filename, thumbnail.dataUrl)
          setThumbs((current) => ({ ...current, [filename]: thumbnail.dataUrl }))
        })
        .catch(() => {
          requested.current.delete(filename)
        })
    },
    [installationId],
  )

  const openFolder = async () => {
    if (!installationId) return
    try {
      await api.screenshots.openFolder(installationId)
    } catch (openError) {
      pushToast({ level: 'error', title: 'Could not open screenshots', message: getErrorMessage(openError) })
    }
  }

  const setAsBackground = async (image: ScreenshotImage) => {
    if (!installationId) return
    setSettingBackground(true)
    try {
      await api.screenshots.setBackground(installationId, image.filename)
      pushToast({ level: 'success', title: 'Dashboard background updated', message: 'The new art is applied to Home.' })
    } catch (backgroundError) {
      pushToast({ level: 'error', title: 'Could not set the background', message: getErrorMessage(backgroundError) })
    } finally {
      setSettingBackground(false)
    }
  }

  const clearBackground = async () => {
    setClearingBackground(true)
    try {
      await api.screenshots.clearBackground()
      pushToast({ level: 'success', title: 'Dashboard background cleared' })
    } catch (backgroundError) {
      pushToast({ level: 'error', title: 'Could not clear the background', message: getErrorMessage(backgroundError) })
    } finally {
      setClearingBackground(false)
    }
  }

  const confirmDelete = async () => {
    if (!installationId || !deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.screenshots.delete(installationId, deleteTarget.filename)
      const next = images.filter((image) => image.filename !== deleteTarget.filename)
      setResult((current) => (current ? { ...current, images: next } : current))
      thumbCache.current.delete(deleteTarget.filename)
      // Keep the lightbox on the next picture when the open one was deleted.
      setViewingIndex((current) => (current == null ? null : next.length ? Math.min(current, next.length - 1) : null))
      setDeleteTarget(null)
      pushToast({ level: 'success', title: 'Screenshot moved to the recycle bin' })
    } catch (deleteFailure) {
      setDeleteError(getErrorMessage(deleteFailure))
    } finally {
      setDeleting(false)
    }
  }

  const copyImage = async (filename: string) => {
    if (!installationId) return
    try {
      await api.screenshots.copy(installationId, filename)
      pushToast({ level: 'success', title: 'Screenshot copied' })
    } catch (copyError) {
      pushToast({ level: 'error', title: 'Could not copy the screenshot', message: getErrorMessage(copyError) })
    }
  }

  if (!selectedInstallation) {
    return (
      <div className="page">
        <PageHeader kicker="Gallery" title="Screenshots" subtitle="Screenshots are stored inside each installation's game folder." />
        <EmptyState
          title="No installation selected"
          description="Choose an installation to browse its screenshots. Bedrock screenshots are not included yet."
          icon={<ImageIcon />}
        >
          <Button variant="primary" icon={<ImageIcon />} onClick={() => navigate('installations')}>
            Go to installations
          </Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="page page--screenshots">
      <PageHeader
        kicker="Gallery"
        title="Screenshots"
        subtitle={`Java Edition screenshots for ${selectedInstallation.name}. Press F4 in game to capture one; Bedrock folders are not included yet.`}
        actions={
          <>
            {settings?.dashboardBackground ? (
              <Button variant="ghost" icon={<X />} onClick={() => void clearBackground()} loading={clearingBackground}>
                Clear background
              </Button>
            ) : null}
            <Button variant="ghost" icon={<RefreshCw />} onClick={() => void load()} loading={loading}>
              Refresh
            </Button>
            <Button icon={<FolderOpen />} onClick={() => void openFolder()}>
              Open folder
            </Button>
          </>
        }
      />

      <div className="screenshot-toolbar">
        <span>
          {images.length.toLocaleString()} screenshot{images.length === 1 ? '' : 's'}
          {result?.exists === false ? ' · folder not created yet' : ''}
        </span>
        {settings?.dashboardBackground ? (
          <span className="screenshot-toolbar__background">
            <Monitor /> Dashboard background active
          </span>
        ) : null}
      </div>

      {loading && !result ? (
        <div className="screenshot-loading">
          <Spinner size="lg" label="Loading screenshots" />
        </div>
      ) : error ? (
        <EmptyState title="Screenshots could not be loaded" description={error} icon={<ImageOff />}>
          <Button onClick={() => void load()} icon={<RefreshCw />}>
            Try again
          </Button>
        </EmptyState>
      ) : !result || result.images.length === 0 ? (
        <EmptyState
          title={result?.exists ? 'No screenshots yet' : 'No screenshots folder yet'}
          description={
            result?.exists
              ? 'Screenshots appear here after you press F4 in Minecraft. Non-image files in the folder are ignored.'
              : `Start Minecraft once or open the folder to create it at ${result?.directory ?? 'the game folder'}.`
          }
          icon={<ImageIcon />}
        >
          <Button icon={<FolderOpen />} onClick={() => void openFolder()}>
            Open screenshots folder
          </Button>
        </EmptyState>
      ) : (
        <div className="screenshot-grid">
          {images.map((image, index) => (
            <ScreenshotCard
              key={image.filename}
              image={image}
              thumbnail={thumbs[image.filename]}
              onLoad={() => requestThumbnail(image.filename)}
              onOpen={() => setViewingIndex(index)}
            />
          ))}
        </div>
      )}

      {activeImage ? (
        <ScreenshotLightbox
          installationId={selectedInstallation.id}
          image={activeImage}
          index={viewingIndex ?? 0}
          total={images.length}
          hasBackground={Boolean(settings?.dashboardBackground)}
          onClose={() => setViewingIndex(null)}
          onPrevious={() => setViewingIndex((viewingIndex ?? 0) - 1 < 0 ? images.length - 1 : (viewingIndex ?? 0) - 1)}
          onNext={() => setViewingIndex(((viewingIndex ?? 0) + 1) % images.length)}
          onDelete={() => setDeleteTarget(activeImage)}
          onSetBackground={() => void setAsBackground(activeImage)}
          onOpenFolder={() => void openFolder()}
          onReveal={() => void api.screenshots.reveal(selectedInstallation.id, activeImage.filename).catch((revealError) => pushToast({ level: 'error', title: 'Could not show that file', message: getErrorMessage(revealError) }))}
          onCopy={() => void copyImage(activeImage.filename)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Move screenshot to the recycle bin?"
        description={
          deleteTarget ? `${deleteTarget.filename} will be removed from this installation and its cached thumbnail will be deleted.` : ''
        }
        confirmLabel="Move to recycle bin"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
      >
        {deleteError ? <p className="field__error">{deleteError}</p> : null}
      </ConfirmDialog>

      {settingBackground ? <span className="screenshot-busy" role="status">Updating dashboard background…</span> : null}
    </div>
  )
}