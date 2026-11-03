import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  Bug,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  FileText,
  FolderOpen,
  RefreshCw,
  ScrollText,
  Search,
  Terminal,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatDateTime, relativeTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { CrashRecord, LogFile, LogReadResult, LogsList } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import {
  Button,
  CopyButton,
  EmptyState,
  IconButton,
  Spinner,
  Switch,
  cx,
} from '../components/ui/primitives'

type LogCategory = 'launcher' | 'game' | 'crash'
type LogSelection = { category: LogCategory; file: string; installationId?: string }

const TABS: Array<{ category: LogCategory; label: string; icon: typeof FileText }> = [
  { category: 'launcher', label: 'Launcher', icon: Terminal },
  { category: 'game', label: 'Game logs', icon: ScrollText },
  { category: 'crash', label: 'Crash reports', icon: Bug },
]

function selectionForCategory(list: LogsList, category: LogCategory): LogSelection | null {
  if (category === 'launcher') {
    const file = list.launcher[0]
    return file ? { category, file: file.name } : null
  }
  if (category === 'game') {
    const group = list.games.find((item) => item.files.length > 0)
    return group?.files[0] ? { category, file: group.files[0].name, installationId: group.installationId } : null
  }
  const crash = list.crashes[0]
  return crash ? { category, file: crash.filename, installationId: crash.installationId } : null
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedLine({ line, query }: { line: string; query: string }) {
  if (!query) return <>{line}</>
  const parts = line.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'))
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
      )}
    </>
  )
}

export function LogsPage() {
  const { route, pushToast } = useLauncher()
  const [list, setList] = useState<LogsList | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [category, setCategory] = useState<LogCategory>((route.params?.category as LogCategory) || 'launcher')
  const [selection, setSelection] = useState<LogSelection | null>(null)
  const [content, setContent] = useState<LogReadResult | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [diagnosticFile, setDiagnosticFile] = useState<string | null>(null)
  const [lastCrash, setLastCrash] = useState<CrashRecord | null>(null)
  const initializedRoute = useRef(false)
  const contentRef = useRef<HTMLPreElement>(null)
  const readRequest = useRef(0)

  const loadContent = useCallback(
    async (nextSelection: LogSelection | null) => {
      if (!nextSelection) {
        setContent(null)
        return
      }
      const requestId = ++readRequest.current
      setContentLoading(true)
      setContentError(null)
      try {
        const result = await api.logs.read({
          category: nextSelection.category,
          file: nextSelection.file,
          installationId: nextSelection.installationId,
        })
        if (readRequest.current === requestId) setContent(result)
      } catch (error) {
        if (readRequest.current === requestId) {
          setContent(null)
          setContentError(getErrorMessage(error))
        }
      } finally {
        if (readRequest.current === requestId) setContentLoading(false)
      }
    },
    [],
  )

  const loadList = useCallback(
    async (options: { autoSelect?: boolean; fromRoute?: boolean } = {}) => {
      const { autoSelect = true, fromRoute = false } = options
      setListLoading(true)
      setListError(null)
      try {
        const nextList = await api.logs.list()
        setList(nextList)
        if (fromRoute) {
          const requestedCategory = (route.params?.category as LogCategory) || 'launcher'
          setCategory(requestedCategory)
          const requestedInstallation = route.params?.installationId
          const requestedFile = route.params?.file
          let nextSelection: LogSelection | null = null
          if (requestedFile) {
            if (requestedCategory === 'game' && requestedInstallation) {
              nextSelection = { category: 'game', file: requestedFile, installationId: requestedInstallation }
            } else if (requestedCategory === 'crash' && requestedInstallation) {
              nextSelection = { category: 'crash', file: requestedFile, installationId: requestedInstallation }
            } else if (requestedCategory === 'launcher') {
              nextSelection = { category: 'launcher', file: requestedFile }
            }
          }
          if (!nextSelection) {
            nextSelection =
              requestedCategory === 'game' && requestedInstallation
                ? (() => {
                    const group = nextList.games.find((item) => item.installationId === requestedInstallation)
                    return group?.files[0]
                      ? { category: 'game' as const, file: group.files[0].name, installationId: requestedInstallation }
                      : selectionForCategory(nextList, requestedCategory)
                  })()
                : selectionForCategory(nextList, requestedCategory)
          }
          setSelection(nextSelection)
          void loadContent(nextSelection)
        } else if (autoSelect) {
          setSelection((current) => {
            if (current && selectionExists(nextList, current)) return current
            const fallback = selectionForCategory(nextList, category)
            void loadContent(fallback)
            return fallback
          })
        }
      } catch (error) {
        setListError(getErrorMessage(error))
      } finally {
        setListLoading(false)
      }
    },
    [category, loadContent, route.params],
  )

  useEffect(() => {
    if (initializedRoute.current) return
    initializedRoute.current = true
    void loadList({ fromRoute: true })
  }, [loadList])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      void loadList({ autoSelect: false })
      if (selection) void loadContent(selection)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadList, loadContent, selection])

  useEffect(() => {
    void api.crash
      .last()
      .then(setLastCrash)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!autoScroll || search) return
    const element = contentRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [content, autoScroll, search])

  const selectCategory = (nextCategory: LogCategory) => {
    setCategory(nextCategory)
    setSearch('')
    const nextSelection = list ? selectionForCategory(list, nextCategory) : null
    setSelection(nextSelection)
    setContent(null)
    void loadContent(nextSelection)
  }

  const selectFile = (nextSelection: LogSelection) => {
    setSelection(nextSelection)
    setSearch('')
    setContent(null)
    void loadContent(nextSelection)
  }

  const openLastCrash = () => {
    if (!list) return
    const nextSelection = selectionForCategory(list, 'crash')
    if (!nextSelection) return
    setCategory('crash')
    selectFile(nextSelection)
  }

  const refresh = () => {
    void loadList({ autoSelect: false })
    if (selection) void loadContent(selection)
  }

  const openFolder = async () => {
    try {
      await api.logs.openFolder({ category, installationId: selection?.installationId })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open folder', message: getErrorMessage(error) })
    }
  }

  const openFile = async () => {
    if (!selection) return
    try {
      await api.logs.openFile(selection)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open log file', message: getErrorMessage(error) })
    }
  }

  const exportDiagnostics = async () => {
    setExporting(true)
    try {
      const result = await api.logs.exportDiagnostics()
      setDiagnosticFile(result.path)
      pushToast({
        level: 'success',
        title: 'Diagnostics exported',
        message: result.filename,
      })
    } catch (error) {
      pushToast({ level: 'error', title: 'Diagnostics export failed', message: getErrorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const displayed = useMemo(() => {
    if (!content) return { lines: [] as string[], matchCount: 0, truncated: false }
    const allLines = content.content.split(/\r?\n/)
    const query = search.trim()
    if (query) {
      const matches = allLines.filter((line) => line.toLowerCase().includes(query.toLowerCase()))
      return { lines: matches.slice(0, 1500), matchCount: matches.length, truncated: matches.length > 1500 }
    }
    const maxLines = 5000
    const slice = allLines.slice(-maxLines)
    return { lines: slice, matchCount: allLines.length, truncated: allLines.length > maxLines || content.truncated }
  }, [content, search])

  const categoriesCount: Record<LogCategory, number> = {
    launcher: list?.launcher.length || 0,
    game: list?.games.reduce((count, group) => count + group.files.length, 0) || 0,
    crash: list?.crashes.length || 0,
  }

  const currentName = selection?.file || ''

  return (
    <div className="page page--logs">
      <PageHeader
        title="Logs & diagnostics"
        subtitle="Launcher output, game sessions, and crash reports in one place."
        actions={
          <>
            <Button icon={<FolderOpen />} onClick={() => void openFolder()}>
              Open folder
            </Button>
            <Button
              variant="primary"
              icon={<ArrowDownToLine />}
              onClick={() => void exportDiagnostics()}
              loading={exporting}
            >
              Export diagnostics
            </Button>
          </>
        }
      />

      {diagnosticFile ? (
        <div className="callout callout--success">
          <FileText />
          <div className="grow">
            <div>Diagnostics bundle saved.</div>
            <div className="mono logs-diagnostic-path">{diagnosticFile}</div>
          </div>
          <CopyButton value={diagnosticFile} label="Copy diagnostics path" />
        </div>
      ) : null}

      {lastCrash ? (
        <div className="callout callout--warning">
          <AlertTriangle />
          <div className="grow">
            <div>{lastCrash.title}</div>
            <div className="text-dim">
              {relativeTime(lastCrash.at)} · {lastCrash.category.replace(/-/g, ' ')}
              {lastCrash.installationName ? ` · ${lastCrash.installationName}` : ''}
            </div>
          </div>
          <Button size="sm" onClick={openLastCrash} disabled={!list}>
            Open report
          </Button>
        </div>
      ) : null}

      <div className="logs-toolbar">
        <div className="segmented logs-tabs" role="tablist" aria-label="Log category">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.category}
                type="button"
                role="tab"
                aria-selected={category === tab.category}
                className={category === tab.category ? 'is-active' : undefined}
                onClick={() => selectCategory(tab.category)}
              >
                <Icon />
                {tab.label}
                <span>{categoriesCount[tab.category]}</span>
              </button>
            )
          })}
        </div>
        <div className="logs-toolbar__right">
          <label className="logs-live-toggle">
            <Switch checked={autoRefresh} onChange={setAutoRefresh} label="Auto refresh logs" />
            <span>Live</span>
          </label>
          <IconButton label="Refresh logs" onClick={refresh}>
            <RefreshCw className={listLoading || contentLoading ? 'spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <div className="logs-layout">
        <aside className="panel logs-sidebar">
          <div className="logs-sidebar__head">
            <span>{category === 'launcher' ? 'Launcher logs' : category === 'game' ? 'Game sessions' : 'Crash reports'}</span>
            {listLoading ? <Spinner /> : null}
          </div>
          <div className="logs-sidebar__list">
            {listError ? (
              <div className="logs-sidebar__error">
                <AlertTriangle />
                <span>{listError}</span>
                <Button size="sm" onClick={refresh}>
                  Retry
                </Button>
              </div>
            ) : !list ? (
              <div className="logs-sidebar__loading">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="skeleton" style={{ height: 46, marginBottom: 8 }} />
                ))}
              </div>
            ) : category === 'launcher' ? (
              list.launcher.length === 0 ? (
                <div className="logs-sidebar__empty">No launcher logs yet.</div>
              ) : (
                list.launcher.map((file) => (
                  <LogFileButton
                    key={file.name}
                    file={file}
                    active={selection?.category === 'launcher' && selection.file === file.name}
                    onClick={() => selectFile({ category: 'launcher', file: file.name })}
                  />
                ))
              )
            ) : category === 'game' ? (
              list.games.length === 0 ? (
                <div className="logs-sidebar__empty">Launch Minecraft once and its output will appear here.</div>
              ) : (
                list.games.map((group) => (
                  <div key={group.installationId} className="logs-group">
                    <div className="logs-group__head">
                      <span>{group.installationName}</span>
                      <span>{group.versionId ? `Minecraft ${group.versionId}` : ''}</span>
                    </div>
                    {group.files.map((file) => (
                      <LogFileButton
                        key={file.name}
                        file={file}
                        active={
                          selection?.category === 'game' &&
                          selection.installationId === group.installationId &&
                          selection.file === file.name
                        }
                        onClick={() =>
                          selectFile({
                            category: 'game',
                            file: file.name,
                            installationId: group.installationId,
                          })
                        }
                        subtle
                      />
                    ))}
                  </div>
                ))
              )
            ) : list.crashes.length === 0 ? (
              <div className="logs-sidebar__empty">No crash reports found.</div>
            ) : (
              list.crashes.map((crash) => (
                <button
                  key={`${crash.installationId}-${crash.filename}`}
                  type="button"
                  className={cx(
                    'log-file-button',
                    selection?.category === 'crash' &&
                      selection.installationId === crash.installationId &&
                      selection.file === crash.filename &&
                      'is-active',
                  )}
                  onClick={() =>
                    selectFile({ category: 'crash', file: crash.filename, installationId: crash.installationId })
                  }
                >
                  <span className="log-file-button__icon log-file-button__icon--crash">
                    <Bug />
                  </span>
                  <span className="log-file-button__copy">
                    <span className="log-file-button__name">{crash.filename}</span>
                    <span className="log-file-button__meta">
                      {crash.installationName} · {relativeTime(crash.modified)}
                    </span>
                  </span>
                  <ChevronRight />
                </button>
              ))
            )}
          </div>
          <div className="logs-sidebar__foot">
            <span>{list ? `${categoriesCount[category]} file${categoriesCount[category] === 1 ? '' : 's'}` : ''}</span>
          </div>
        </aside>

        <section className="panel logs-viewer">
          <div className="logs-viewer__head">
            <div className="logs-viewer__title">
              <FileText />
              <div>
                <span className="mono">{currentName || 'No log selected'}</span>
                {content ? (
                  <span>
                    {formatBytes(content.size)} · updated {relativeTime(content.modified)}
                  </span>
                ) : (
                  <span>Select a log file to inspect it.</span>
                )}
              </div>
            </div>
            <div className="logs-viewer__tools">
              <div className="search-input logs-search">
                <Search />
                <input
                  className="input"
                  placeholder="Find in log…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Find in log"
                  disabled={!content}
                />
              </div>
              {content ? (
                <>
                  <CopyButton value={content.content} label="Copy log contents" />
                  <IconButton label="Open log in default editor" onClick={() => void openFile()}>
                    <ExternalLink />
                  </IconButton>
                </>
              ) : null}
            </div>
          </div>
          <div className="logs-viewer__meta">
            <label className="logs-check">
              <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto scroll logs" />
              <span>Auto-scroll</span>
            </label>
            {content ? (
              <span>
                {search
                  ? `${displayed.matchCount.toLocaleString()} matching line${displayed.matchCount === 1 ? '' : 's'}`
                  : `${displayed.matchCount.toLocaleString()} lines`}
                {displayed.truncated ? ' · showing latest 5,000' : ''}
                {content.truncated ? ' · file truncated' : ''}
              </span>
            ) : null}
          </div>
          <div className="logs-viewer__body">
            {contentLoading && !content ? (
              <div className="logs-viewer__loading">
                <Spinner /> Reading log…
              </div>
            ) : contentError ? (
              <div className="logs-viewer__error">
                <AlertTriangle />
                <span>{contentError}</span>
                <Button size="sm" onClick={() => void loadContent(selection)}>
                  Try again
                </Button>
              </div>
            ) : !selection ? (
              <EmptyState
                icon={<ClipboardCopy />}
                title="Nothing selected"
                description="Choose a log from the list to view launcher output, game output, or a crash report."
              />
            ) : !content ? (
              <div className="logs-viewer__loading">
                <Spinner /> Reading log…
              </div>
            ) : displayed.lines.length === 0 ? (
              <EmptyState
                icon={<Search />}
                title={search ? 'No matching lines' : 'This log is empty'}
                description={search ? 'Try a different search term.' : 'Minecraft hasn’t written anything to this file yet.'}
              />
            ) : (
              <pre ref={contentRef} className="log-output" spellCheck={false}>
                {displayed.lines.map((line, index) => (
                  <span key={index} className={cx('log-line', logLineClass(line))}>
                    <HighlightedLine line={line || ' '} query={search.trim()} />
                    {'\n'}
                  </span>
                ))}
              </pre>
            )}
          </div>
          <div className="logs-viewer__foot">
            <span>
              <Terminal />
              {category === 'launcher'
                ? 'Launcher diagnostics, sanitized before writing.'
                : category === 'game'
                  ? 'Game output captured by Aqua. Access tokens are redacted.'
                  : 'Crash reports are written by Minecraft. Inspect the stack trace for the cause.'}
            </span>
            {content?.truncated ? <span>Showing the end of the file</span> : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function selectionExists(list: LogsList, selection: LogSelection) {
  if (selection.category === 'launcher') {
    return list.launcher.some((file) => file.name === selection.file)
  }
  if (selection.category === 'game') {
    return list.games.some(
      (group) =>
        group.installationId === selection.installationId &&
        group.files.some((file) => file.name === selection.file),
    )
  }
  return list.crashes.some(
    (crash) => crash.installationId === selection.installationId && crash.filename === selection.file,
  )
}

function LogFileButton({
  file,
  active,
  onClick,
  subtle = false,
}: {
  file: LogFile
  active: boolean
  onClick: () => void
  subtle?: boolean
}) {
  return (
    <button
      type="button"
      className={cx('log-file-button', active && 'is-active', subtle && 'is-subtle')}
      onClick={onClick}
    >
      <span className="log-file-button__icon">
        <FileText />
      </span>
      <span className="log-file-button__copy">
        <span className="log-file-button__name">{file.name}</span>
        <span className="log-file-button__meta">
          {formatBytes(file.size)} · {formatDateTime(file.modified)}
        </span>
      </span>
      <ChevronRight />
    </button>
  )
}

function logLineClass(line: string) {
  if (/\bERROR\b|\bSEVERE\b|Exception|Caused by:/i.test(line)) return 'is-error'
  if (/\bWARN\b|WARNING/i.test(line)) return 'is-warning'
  if (/\bDEBUG\b|TRACE/i.test(line)) return 'is-dim'
  return ''
}
