import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Archive,
  ArrowUpRight,
  Bell,
  Check,
  Coffee,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Info,
  Layers,
  Link2,
  MemoryStick,
  MessageCircle,
  Monitor,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatDateTime, relativeTime } from '../lib/format'
import { javaPurpose } from '../lib/java-info'
import { useLauncher } from '../state/LauncherProvider'
import type {
  BackupStatus,
  JavaRuntimeOption,
  MinecraftSettingsStatus,
  Settings,
  SystemInfo,
} from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { StoragePanel } from '../components/settings/StoragePanel'
import { LinksPanel } from '../components/settings/LinksPanel'
import {
  Badge,
  Button,
  CopyButton,
  Field,
  FieldRow,
  Spinner,
  Switch,
  cx,
} from '../components/ui/primitives'

const SECTIONS = [
  { id: 'settings-appearance', label: 'Display', icon: Palette },
  { id: 'settings-java', label: 'Java', icon: Coffee },
  { id: 'settings-memory', label: 'Memory', icon: MemoryStick },
  { id: 'settings-minecraft', label: 'Minecraft settings', icon: Gamepad2 },
  { id: 'settings-backups', label: 'Backups', icon: Archive },
  { id: 'settings-notifications', label: 'Notifications', icon: Bell },
  { id: 'settings-discord', label: 'Discord presence', icon: MessageCircle },
  { id: 'settings-game', label: 'Game & downloads', icon: HardDrive },
  { id: 'settings-storage', label: 'Storage', icon: Database },
  { id: 'settings-window', label: 'Window', icon: Monitor },
  { id: 'settings-advanced', label: 'Advanced', icon: SlidersHorizontal },
  { id: 'settings-startup', label: 'Startup', icon: Power },
  { id: 'settings-links', label: 'Links & CLI', icon: Link2 },
  { id: 'settings-troubleshooting', label: 'Troubleshooting', icon: Wrench },
  { id: 'settings-about', label: 'About', icon: Info },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export function SettingsPage() {
  const launcher = useLauncher()
  if (!launcher.settings || !launcher.data) return null
  return <SettingsWorkspace launcher={launcher} settings={launcher.settings} system={launcher.data.system} />
}

type Launcher = ReturnType<typeof useLauncher>

/** Hoverable info dot explaining what a Java major version is used for. */
function JavaPurpose({ major }: { major: number }) {
  const purpose = javaPurpose(major)
  if (!purpose) return null
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={`Java ${major}: ${purpose}`}>
      <Info />
      <span className="info-tip__bubble" role="tooltip">
        {purpose}
      </span>
    </span>
  )
}

function SettingsWorkspace({
  launcher,
  settings,
  system,
}: {
  launcher: Launcher
  settings: Settings
  system: SystemInfo
}) {
  const {
    data,
    javas,
    javaLoading,
    javaError,
    refreshJava,
    saveSettings,
    pushToast,
    navigate,
    selectedInstallation,
    route,
  } = launcher
  const [form, setForm] = useState<Settings>(settings)
  const [activeSection, setActiveSection] = useState<SectionId>('settings-appearance')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [runtimeOptions, setRuntimeOptions] = useState<JavaRuntimeOption[]>([])
  const [runtimeOptionsLoading, setRuntimeOptionsLoading] = useState(false)
  const [runtimeOptionsError, setRuntimeOptionsError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null)
  const [javaValidateResult, setJavaValidateResult] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [checkingJava, setCheckingJava] = useState(false)
  const [minecraftStatus, setMinecraftStatus] = useState<MinecraftSettingsStatus | null>(null)
  const [minecraftBusy, setMinecraftBusy] = useState<'capture' | 'apply' | 'all' | null>(null)
  const savedTimer = useRef<number | null>(null)
  const javaJobsSeen = useRef(new Set<string>())
  const savedScale = useRef(settings.uiScale)

  // The newest runtimes come first, but Java 8 must stay visible: it is the only
  // runtime that can run Minecraft 1.12.2 and older.
  const visibleRuntimeOptions = useMemo(() => {
    const modern = runtimeOptions.filter((option) => !option.legacy)
    const legacy = runtimeOptions.find((option) => option.legacy)
    return legacy ? [...modern.slice(0, 3), legacy] : modern.slice(0, 4)
  }, [runtimeOptions])

  const dirty = JSON.stringify(form) !== JSON.stringify(settings)
  const totalMemory = system.totalMemMb
  const maxMemoryCeiling = Math.max(2048, Math.floor(totalMemory / 512) * 512)
  const portable = data?.app.portable ?? false
  const canLaunchAtLogin = (data?.app.canLaunchAtLogin ?? false) && !portable

  useEffect(() => {
    if (!dirty) setForm(settings)
  }, [settings, dirty])

  useEffect(() => {
    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
    }
  }, [])

  const loadRuntimeOptions = async () => {
    setRuntimeOptionsLoading(true)
    setRuntimeOptionsError(null)
    try {
      setRuntimeOptions(await api.java.runtimeOptions())
    } catch (error) {
      setRuntimeOptionsError(getErrorMessage(error))
    } finally {
      setRuntimeOptionsLoading(false)
    }
  }

  useEffect(() => {
    void loadRuntimeOptions()
  }, [])

  useEffect(() => {
    void api.backups
      .status()
      .then(setBackupStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    for (const job of launcher.jobs) {
      if (job.type === 'java' && job.status === 'completed' && !javaJobsSeen.current.has(job.id)) {
        javaJobsSeen.current.add(job.id)
        void loadRuntimeOptions()
      }
    }
  }, [launcher.jobs])

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setSaveError(null)
  }

  const previewScale = (value: number) => {
    update('uiScale', value)
    void api.windowControls.setZoom(value)
  }

  useEffect(() => {
    savedScale.current = settings.uiScale
  }, [settings.uiScale])

  useEffect(() => {
    return () => {
      // Leave the window at the saved scale if the page is closed mid-edit.
      void api.windowControls.setZoom(savedScale.current)
    }
  }, [])

  const updateJava = (patch: Partial<Settings['java']>) => {
    setForm((current) => ({ ...current, java: { ...current.java, ...patch } }))
    setSaved(false)
  }

  const loadMinecraftStatus = async () => {
    try {
      setMinecraftStatus(await api.minecraftSettings.status())
    } catch {
      setMinecraftStatus(null)
    }
  }

  useEffect(() => {
    void loadMinecraftStatus()
  }, [])

  const captureMinecraftSettings = async () => {
    const installation = selectedInstallation
    if (!installation) {
      pushToast({ level: 'info', title: 'No installation selected', message: 'Choose an installation first.' })
      return
    }
    setMinecraftBusy('capture')
    try {
      const result = await api.minecraftSettings.capture(installation.id)
      await loadMinecraftStatus()
      if (result.files.length) {
        pushToast({
          level: 'success',
          title: 'Minecraft settings saved',
          message: `${result.files.join(', ')} copied from ${installation.name}.`,
        })
      } else {
        pushToast({
          level: 'info',
          title: 'Nothing to save yet',
          message: `Launch ${installation.name} once so Minecraft can write its settings.`,
        })
      }
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not save Minecraft settings', message: getErrorMessage(error) })
    } finally {
      setMinecraftBusy(null)
    }
  }

  const applyMinecraftSettings = async (all: boolean) => {
    const installation = selectedInstallation
    if (!all && !installation) {
      pushToast({ level: 'info', title: 'No installation selected', message: 'Choose an installation first.' })
      return
    }
    setMinecraftBusy(all ? 'all' : 'apply')
    try {
      if (all) {
        const result = await api.minecraftSettings.applyAll()
        const applied = result.installations.filter((entry) => entry.files.length).length
        pushToast({
          level: 'success',
          title: 'Minecraft settings applied',
          message: `${applied} installation${applied === 1 ? '' : 's'} updated.`,
        })
      } else if (installation) {
        const result = await api.minecraftSettings.apply(installation.id)
        pushToast({
          level: 'success',
          title: 'Minecraft settings applied',
          message: result.files.length
            ? `${result.files.join(', ')} written to ${installation.name}.`
            : 'No shared settings saved yet — save them from an installation first.',
        })
      }
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not apply Minecraft settings', message: getErrorMessage(error) })
    } finally {
      setMinecraftBusy(null)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await saveSettings(form)
      setForm(updated)
      setSaved(true)
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaved(false), 2600)
      pushToast({ level: 'success', title: 'Settings saved' })
    } catch (error) {
      setSaveError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setForm(settings)
    setSaveError(null)
    setSaved(false)
    void api.windowControls.setZoom(settings.uiScale)
  }

  const runBackups = async () => {
    setBackupBusy(true)
    try {
      await api.backups.runNow()
      pushToast({ level: 'success', title: 'Backups queued', message: 'Progress appears in Tasks.' })
      setBackupStatus(await api.backups.status())
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not start backups', message: getErrorMessage(error) })
    } finally {
      setBackupBusy(false)
    }
  }

  const scrollTo = (id: SectionId) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const requested = route.params?.section
    if (!requested) return
    const section = SECTIONS.find((entry) => entry.id === requested)
    if (!section) return
    setActiveSection(section.id)
    const timer = window.setTimeout(() => {
      document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [route.params?.section])

  const browseGameDir = async () => {
    try {
      const chosen = await api.dialogs.chooseDirectory({
        title: 'Choose the default game directory',
        defaultPath: form.defaultGameDir,
      })
      if (chosen) update('defaultGameDir', chosen)
    } catch (error) {
      setSaveError(getErrorMessage(error))
    }
  }

  const browseJava = async () => {
    try {
      const chosen = await api.dialogs.chooseJava()
      if (!chosen) return
      const info = await api.java.validate(chosen)
      updateJava({ mode: 'path', path: info.path })
      setJavaValidateResult(`Java ${info.major} · ${info.vendor} · ${info.arch}`)
    } catch (error) {
      setSaveError(getErrorMessage(error))
    }
  }

  const validateCurrentJava = async () => {
    if (!form.java.path) {
      setSaveError('Choose a Java executable first.')
      return
    }
    setCheckingJava(true)
    setJavaValidateResult(null)
    try {
      const info = await api.java.validate(form.java.path)
      setJavaValidateResult(`Java ${info.major} · ${info.vendor} · ${info.arch}`)
    } catch (error) {
      setJavaValidateResult(null)
      setSaveError(getErrorMessage(error))
    } finally {
      setCheckingJava(false)
    }
  }

  const installRuntime = async (option: JavaRuntimeOption) => {
    try {
      await api.java.installRuntime(option.component)
      pushToast({
        level: 'info',
        title: `Installing Java ${option.major}`,
        message: 'Progress is available on the Tasks page.',
      })
      navigate('tasks')
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not start Java install', message: getErrorMessage(error) })
    }
  }

  const exportDiagnostics = async () => {
    setExporting(true)
    try {
      const result = await api.logs.exportDiagnostics()
      setDiagnosticsPath(result.path)
      pushToast({ level: 'success', title: 'Diagnostics exported', message: result.filename })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not export diagnostics', message: getErrorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const setMaxMemory = (value: number) => {
    const next = Math.min(maxMemoryCeiling, Math.max(1024, value))
    setForm((current) => ({
      ...current,
      memory: {
        maxMb: next,
        minMb: Math.min(current.memory.minMb, next),
      },
    }))
    setSaved(false)
  }

  const setMinMemory = (value: number) => {
    const next = Math.min(form.memory.maxMb, Math.max(512, value))
    setForm((current) => ({ ...current, memory: { ...current.memory, minMb: next } }))
    setSaved(false)
  }

  return (
    <div className="page page--settings">
      <PageHeader
        title="Settings"
        subtitle="Java, memory, downloads, and window behavior. Changes are saved on this device."
        actions={
          <Button
            icon={<FolderOpen />}
            onClick={() => void api.system.openFolder('data').catch((error) => setSaveError(getErrorMessage(error)))}
          >
            Open data folder
          </Button>
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                type="button"
                className={cx('settings-nav__item', activeSection === section.id && 'is-active')}
                onClick={() => scrollTo(section.id)}
                aria-current={activeSection === section.id ? 'location' : undefined}
              >
                <Icon />
                <span>{section.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="settings-content">
          {saveError ? (
            <div className="callout callout--danger" role="alert">
              <TriangleAlert />
              <span>{saveError}</span>
            </div>
          ) : null}

          <section className="settings-section" id="settings-appearance">
            <div className="settings-section__head">
              <h2>Display</h2>
              <p>Text size, motion, and the dashboard illustration.</p>
            </div>
            <div className="settings-card">
              <div className="settings-field-block">
                <div className="field__label">
                  <span>Interface scale</span>
                  <span className="field__label-note">{Math.round(form.uiScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={130}
                  step={5}
                  value={Math.round(form.uiScale * 100)}
                  onChange={(event) => previewScale(Number(event.target.value) / 100)}
                  style={
                    {
                      '--range-fill': `${((Math.round(form.uiScale * 100) - 80) / 50) * 100}%`,
                    } as CSSProperties
                  }
                  aria-label="Interface scale percentage"
                />
                <div className="range-scale">
                  <span>80%</span>
                  <span>100%</span>
                  <span>130%</span>
                </div>
              </div>

              <FieldRow
                title="Reduce motion"
                description="Minimize transitions and animations across the launcher."
              >
                <Switch
                  checked={form.reduceMotion}
                  onChange={(value) => update('reduceMotion', value)}
                  label="Reduce motion"
                />
              </FieldRow>
              <FieldRow
                title="High contrast"
                description="Use stronger text, borders and surfaces for low-vision use."
              >
                <Switch
                  checked={form.highContrast}
                  onChange={(value) => update('highContrast', value)}
                  label="High contrast"
                />
              </FieldRow>
              <FieldRow
                title="Reduce transparency"
                description="Replace frosted overlays and translucent chrome with opaque surfaces."
              >
                <Switch
                  checked={form.reduceTransparency}
                  onChange={(value) => update('reduceTransparency', value)}
                  label="Reduce transparency"
                />
              </FieldRow>
              <FieldRow
                title="Ambient scene"
                description="Show the animated voxel landscape on the dashboard."
              >
                <Switch checked={form.ambient} onChange={(value) => update('ambient', value)} label="Ambient scene" />
              </FieldRow>
            </div>
          </section>

          <section className="settings-section" id="settings-java">
            <div className="settings-section__head">
              <h2>Java runtime</h2>
              <p>Minecraft runs on Java. Automatic selection finds the best installed runtime for each version.</p>
            </div>
            <div className="settings-card">
              <div className="settings-card__toolbar">
                <div>
                  <span className="section-kicker">Detected runtimes</span>
                  <p className="settings-muted">
                    {javaLoading
                      ? 'Scanning common Java locations…'
                      : `${javas.length} runtime${javas.length === 1 ? '' : 's'} detected on this system`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw />}
                  onClick={() => void refreshJava(true)}
                  loading={javaLoading}
                >
                  Rescan
                </Button>
              </div>

              {javaError ? (
                <div className="callout callout--warning">
                  <TriangleAlert /> {javaError}
                </div>
              ) : null}

              <div className="java-list" role="radiogroup" aria-label="Java selection">
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.java.mode === 'auto'}
                  className={cx('java-option', form.java.mode === 'auto' && 'is-selected')}
                  onClick={() => updateJava({ mode: 'auto' })}
                >
                  <span className="java-option__radio">{form.java.mode === 'auto' ? <Check /> : null}</span>
                  <span className="java-option__copy">
                    <span className="java-option__name">Automatic selection</span>
                    <span className="java-option__meta">
                      Prefer the exact Java major required by the selected Minecraft version.
                    </span>
                  </span>
                  <Badge tone="success">Recommended</Badge>
                </button>
                {javas.slice(0, 10).map((java) => (
                  <button
                    key={java.path}
                    type="button"
                    role="radio"
                    aria-checked={form.java.mode === 'path' && form.java.path === java.path}
                    className={cx(
                      'java-option',
                      form.java.mode === 'path' && form.java.path === java.path && 'is-selected',
                    )}
                    onClick={() => {
                      updateJava({ mode: 'path', path: java.path })
                      setJavaValidateResult(null)
                    }}
                  >
                    <span className="java-option__radio">
                      {form.java.mode === 'path' && form.java.path === java.path ? <Check /> : null}
                    </span>
                    <span className="java-option__copy">
                      <span className="java-option__name">
                        Java {java.major} <span>· {java.vendor}</span>
                        <JavaPurpose major={java.major} />
                      </span>
                      <span className="java-option__meta mono" title={java.path}>
                        {java.path}
                      </span>
                    </span>
                    <span className="java-option__source">{java.source}</span>
                  </button>
                ))}
              </div>

              <div className="java-custom">
                <Field
                  label="Custom Java executable"
                  hint="Use this if your runtime isn’t in the list. Aqua validates it before saving."
                >
                  <div className="input-row">
                    <input
                      className="input input--mono"
                      value={form.java.mode === 'path' ? form.java.path || '' : ''}
                      placeholder="Automatic"
                      onChange={(event) => updateJava({ mode: 'path', path: event.target.value })}
                      spellCheck={false}
                    />
                    <Button icon={<FolderOpen />} onClick={() => void browseJava()}>
                      Browse
                    </Button>
                    <Button
                      icon={<ShieldCheck />}
                      onClick={() => void validateCurrentJava()}
                      loading={checkingJava}
                      disabled={!form.java.path}
                    >
                      Validate
                    </Button>
                  </div>
                </Field>
                {javaValidateResult ? (
                  <span className="settings-success">
                    <Check /> {javaValidateResult}
                  </span>
                ) : null}
              </div>

              <div className="settings-divider" />

              <div className="settings-card__toolbar">
                <div>
                  <span className="section-kicker">Official runtimes</span>
                  <p className="settings-muted">Downloaded from Mojang and managed inside Aqua.</p>
                </div>
                {runtimeOptionsLoading ? <Spinner /> : null}
              </div>
              {runtimeOptionsError ? (
                <div className="callout callout--warning">
                  <TriangleAlert /> {runtimeOptionsError}
                </div>
              ) : runtimeOptions.length ? (
                <div className="runtime-grid">
                  {visibleRuntimeOptions.map((option) => (
                    <div key={option.component} className="runtime-card">
                      <div className="runtime-card__head">
                        <span className="runtime-card__version">
                          Java {option.major}
                          <JavaPurpose major={option.major} />
                        </span>
                        {option.installed ? <Badge tone="success">Installed</Badge> : null}
                      </div>
                      <span className="runtime-card__meta">
                        {option.versionName} · {option.released ? formatDateTime(option.released) : 'Available'}
                      </span>
                      <Button
                        size="sm"
                        variant={option.installed ? 'ghost' : 'default'}
                        icon={<Download />}
                        disabled={option.installed}
                        onClick={() => void installRuntime(option)}
                      >
                        {option.installed ? 'Ready' : option.legacy ? 'Install Java 8' : 'Install'}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-muted">
                  {runtimeOptionsLoading ? 'Loading official runtimes…' : 'No official runtime list available.'}
                </div>
              )}
              <p className="settings-hint">
                Java 8 is required by some older versions; modern versions may require Java 21 or newer. Aqua never
                substitutes an incompatible runtime without telling you.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-memory">
            <div className="settings-section__head">
              <h2>Memory</h2>
              <p>Allocate RAM to Minecraft. Leave a few gigabytes free for Windows and other apps.</p>
            </div>
            <div className="settings-card">
              <div className="memory-hero">
                <div>
                  <span className="memory-hero__value">{(form.memory.maxMb / 1024).toFixed(1)} GB</span>
                  <span className="memory-hero__label">maximum allocation</span>
                </div>
                <div className="memory-hero__system">
                  <span>System memory</span>
                  <strong>{Math.round(totalMemory / 1024)} GB</strong>
                </div>
              </div>
              <div className="field">
                <div className="field__label">
                  <span>Maximum memory</span>
                  <span className="field__label-note">Recommended {Math.min(Math.round(totalMemory / 2048), 8)} GB</span>
                </div>
                <input
                  type="range"
                  min={1024}
                  max={maxMemoryCeiling}
                  step={512}
                  value={form.memory.maxMb}
                  onChange={(event) => setMaxMemory(Number(event.target.value))}
                  style={
                    {
                      '--range-fill': `${Math.round(((form.memory.maxMb - 1024) / Math.max(maxMemoryCeiling - 1024, 1)) * 100)}%`,
                    } as CSSProperties
                  }
                  aria-label="Maximum memory in megabytes"
                />
                <div className="range-scale">
                  <span>1 GB</span>
                  <span>{Math.round(maxMemoryCeiling / 1024)} GB</span>
                </div>
              </div>
              <div className="memory-inputs">
                <Field label="Minimum memory (MB)" htmlFor="memory-min">
                  <input
                    id="memory-min"
                    type="number"
                    className="input"
                    min={512}
                    max={form.memory.maxMb}
                    step={512}
                    value={form.memory.minMb}
                    onChange={(event) => setMinMemory(Number(event.target.value))}
                  />
                </Field>
                <Field label="Maximum memory (MB)" htmlFor="memory-max">
                  <input
                    id="memory-max"
                    type="number"
                    className="input"
                    min={1024}
                    max={maxMemoryCeiling}
                    step={512}
                    value={form.memory.maxMb}
                    onChange={(event) => setMaxMemory(Number(event.target.value))}
                  />
                </Field>
                <div className="memory-presets">
                  {[2048, 4096, 8192].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={cx('chip', form.memory.maxMb === value && 'is-active')}
                      onClick={() => setMaxMemory(value)}
                      disabled={value > maxMemoryCeiling}
                    >
                      {value / 1024} GB
                    </button>
                  ))}
                </div>
              </div>
              <p className="settings-hint">
                More memory is not always faster: huge allocations can increase garbage collection pauses. Individual
                installations can override this value.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-minecraft">
            <div className="settings-section__head">
              <h2>Minecraft settings</h2>
              <p>
                Keep video, audio, control and server-list settings identical across installations. Mod config files,
                worlds and saves are never touched.
              </p>
            </div>
            <div className="settings-card">
              <FieldRow
                title="Share settings between installations"
                description="Save the settings you change in game and apply them to every installation before it launches."
              >
                <Switch
                  checked={form.minecraftSettings.sync}
                  onChange={(value) => update('minecraftSettings', { sync: value })}
                  label="Share settings between installations"
                />
              </FieldRow>
              <FieldRow
                title="Shared settings"
                description={
                  minecraftStatus?.files.length
                    ? `${minecraftStatus.files.map((file) => file.name).join(', ')} · saved ${relativeTime(
                        minecraftStatus.updatedAt,
                      )}${minecraftStatus.installations ? ` · applied before ${minecraftStatus.installations} launch` : ''}`
                    : 'Nothing saved yet. Launch an installation, set Minecraft up the way you like it, then save those settings here.'
                }
              >
                <div className="row gap-2 settings-minecraft__actions">
                  <Button
                    size="sm"
                    icon={<Save />}
                    loading={minecraftBusy === 'capture'}
                    disabled={!selectedInstallation || minecraftBusy !== null}
                    onClick={() => void captureMinecraftSettings()}
                  >
                    Save from {selectedInstallation ? selectedInstallation.name : 'installation'}
                  </Button>
                  <Button
                    size="sm"
                    icon={<Download />}
                    loading={minecraftBusy === 'apply'}
                    disabled={!selectedInstallation || !minecraftStatus?.files.length || minecraftBusy !== null}
                    onClick={() => void applyMinecraftSettings(false)}
                  >
                    Apply here
                  </Button>
                  <Button
                    size="sm"
                    icon={<Layers />}
                    loading={minecraftBusy === 'all'}
                    disabled={!minecraftStatus?.files.length || minecraftBusy !== null}
                    onClick={() => void applyMinecraftSettings(true)}
                  >
                    Apply to all
                  </Button>
                </div>
              </FieldRow>
              {minecraftStatus?.directory ? (
                <p className="settings-hint">
                  Shared settings are stored in {minecraftStatus.directory} and copied into each installation's game
                  folder.
                </p>
              ) : null}
            </div>
          </section>

          <section className="settings-section" id="settings-backups">
            <div className="settings-section__head">
              <h2>World backups</h2>
              <p>
                Automatic ZIP copies of changed worlds. Restoring always adds a copy, so a live save is never replaced.
              </p>
            </div>
            <div className="settings-card">
              <FieldRow
                title="Automatic backups"
                description="Enables scheduled and after-play backups. Nothing is backed up automatically while this is off."
              >
                <Switch
                  checked={form.backups.enabled}
                  onChange={(value) => update('backups', { ...form.backups, enabled: value })}
                  label="Automatic backups"
                />
              </FieldRow>
              <FieldRow
                title="After playing"
                description="Back up worlds that changed during a session as soon as the game exits."
              >
                <Switch
                  checked={form.backups.onExit}
                  onChange={(value) => update('backups', { ...form.backups, onExit: value })}
                  label="Back up after playing"
                />
              </FieldRow>
              <FieldRow
                title="Daily backup"
                description="Runs once a day at this hour. A missed run happens once after the launcher reopens."
              >
                <div className="row gap-2">
                  <Switch
                    checked={form.backups.daily}
                    onChange={(value) => update('backups', { ...form.backups, daily: value })}
                    label="Daily backup"
                  />
                  <div className="select-wrap" style={{ width: 110 }}>
                    <select
                      className="select"
                      value={form.backups.dailyHour}
                      disabled={!form.backups.enabled || !form.backups.daily}
                      onChange={(event) =>
                        update('backups', { ...form.backups, dailyHour: Number(event.target.value) })
                      }
                      aria-label="Daily backup hour"
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </FieldRow>
              <div className="settings-inline-grid">
                <Field label="Copies to keep" hint="Per installation. Pinned backups are never removed.">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={50}
                    value={form.backups.retentionCount}
                    onChange={(event) =>
                      update('backups', { ...form.backups, retentionCount: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Storage limit (MB)" hint="0 means no size limit. The count limit still applies.">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={102400}
                    step={256}
                    value={form.backups.maxTotalMb}
                    onChange={(event) =>
                      update('backups', { ...form.backups, maxTotalMb: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              <FieldRow
                title="Last run"
                description={
                  backupStatus?.lastRunAt
                    ? `${relativeTime(backupStatus.lastRunAt)}${
                        backupStatus.lastResult ? ` · ${backupStatus.lastResult.backedUp} backed up` : ''
                      }${backupStatus.nextRunAt ? ` · next ${formatDateTime(backupStatus.nextRunAt)}` : ''}`
                    : 'No backup run yet.'
                }
              >
                <Button size="sm" icon={<Archive />} loading={backupBusy} onClick={() => void runBackups()}>
                  Run now
                </Button>
              </FieldRow>
              <p className="settings-hint">
                Save changes before running. Backups run as a cancellable task, and retention is applied after every run.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-notifications">
            <div className="settings-section__head">
              <h2>Notifications</h2>
              <p>Keep launcher events in the titlebar bell and choose when Windows should interrupt you.</p>
            </div>
            <div className="settings-card">
              <FieldRow
                title="Notification center"
                description="Save download, crash, update and backup events in the bell so they remain readable after a toast disappears."
              >
                <Switch
                  checked={form.notifications.enabled}
                  onChange={(value) =>
                    update('notifications', { ...form.notifications, enabled: value })
                  }
                  label="Notification center"
                />
              </FieldRow>
              <FieldRow
                title="Native Windows notifications"
                description="Show a Windows notification only when Aqua is hidden or another window has focus. The bell always records enabled levels."
              >
                <Switch
                  checked={form.notifications.native}
                  onChange={(value) => update('notifications', { ...form.notifications, native: value })}
                  label="Native Windows notifications"
                  disabled={!form.notifications.enabled}
                />
              </FieldRow>
              {([
                {
                  key: 'success',
                  title: 'Successful downloads and installs',
                  description: 'Completed installations, modpack imports and Java runtime installs.',
                },
                {
                  key: 'info',
                  title: 'General updates',
                  description: 'Game sessions and other informational events.',
                },
                {
                  key: 'warning',
                  title: 'Warnings',
                  description: 'Safe Mode conflicts and recoverable problems.',
                },
                {
                  key: 'error',
                  title: 'Errors',
                  description: 'Crashes and failed background tasks.',
                },
              ] as const).map((option) => (
                <FieldRow key={option.key} title={option.title} description={option.description}>
                  <Switch
                    checked={form.notifications.levels[option.key]}
                    onChange={(value) =>
                      update('notifications', {
                        ...form.notifications,
                        levels: { ...form.notifications.levels, [option.key]: value },
                      })
                    }
                    label={option.title}
                    disabled={!form.notifications.enabled}
                  />
                </FieldRow>
              ))}
              <p className="settings-hint">
                Clearing the bell only removes its entries. Crash reports and logs stay in Logs &amp; diagnostics.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-discord">
            <div className="settings-section__head">
              <h2>Discord presence</h2>
              <p>Show the active Java profile on your Discord profile while you play. Off by default.</p>
            </div>
            <div className="settings-card">
              <FieldRow
                title="Rich Presence"
                description="Share the instance name, Minecraft version and loader with Discord while a Java game is running."
              >
                <Switch
                  checked={form.discord.enabled}
                  onChange={(value) => update('discord', { ...form.discord, enabled: value })}
                  label="Discord Rich Presence"
                />
              </FieldRow>
              <FieldRow
                title="Show server address"
                description="Include the server you joined and let friends request to join it. Leave this off to keep the address private."
              >
                <Switch
                  checked={form.discord.showServer}
                  onChange={(value) => update('discord', { ...form.discord, showServer: value })}
                  label="Show server address"
                  disabled={!form.discord.enabled}
                />
              </FieldRow>
              <p className="settings-hint">
                Aqua never sends account names, UUIDs, file paths or chat. Presence clears when the game exits, and
                Discord does not need to be running when Aqua starts. A build needs its own registered Discord
                application ID before Discord can display presence.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-game">
            <div className="settings-section__head">
              <h2>Game & downloads</h2>
              <p>Choose where new profiles store data and how much bandwidth Aqua may use.</p>
            </div>
            <div className="settings-card">
              <Field
                label="Default game directory"
                hint="New installations use this location unless you pick their own folder."
              >
                <div className="input-row">
                  <input
                    className="input input--mono"
                    value={form.defaultGameDir}
                    onChange={(event) => update('defaultGameDir', event.target.value)}
                    spellCheck={false}
                  />
                  <Button icon={<FolderOpen />} onClick={() => void browseGameDir()}>
                    Browse
                  </Button>
                  <Button
                    icon={<ExternalLink />}
                    onClick={() => void api.system.openFolder('instances').catch((error) => setSaveError(getErrorMessage(error)))}
                  >
                    Open
                  </Button>
                </div>
              </Field>

              <div className="settings-divider" />

              <FieldRow
                title="Parallel downloads"
                description="More connections can increase speed, but use more bandwidth. Applies to new downloads."
              >
                <div className="select-wrap" style={{ width: 140 }}>
                  <select
                    className="select"
                    value={form.downloads.concurrency}
                    onChange={(event) =>
                      update('downloads', { ...form.downloads, concurrency: Number(event.target.value) })
                    }
                    aria-label="Parallel download count"
                  >
                    {[2, 4, 6, 8, 12, 16].map((value) => (
                      <option key={value} value={value}>
                        {value} files
                      </option>
                    ))}
                  </select>
                </div>
              </FieldRow>

              <FieldRow
                title="Bandwidth limit"
                description="Limit total download speed for game files. Set 0 for unlimited."
              >
                <div className="input-with-suffix" style={{ width: 180 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1000000}
                    step={64}
                    value={form.downloads.bandwidthKbps}
                    onChange={(event) =>
                      update('downloads', { ...form.downloads, bandwidthKbps: Number(event.target.value) })
                    }
                    aria-label="Bandwidth limit in kilobytes per second"
                  />
                  <span>KB/s</span>
                </div>
              </FieldRow>

              <FieldRow
                title="Download diagnostics"
                description="See active downloads, speeds, remaining time, and retry failed installs."
              >
                <Button size="sm" icon={<Download />} onClick={() => navigate('tasks')}>
                  Open downloads
                </Button>
              </FieldRow>
            </div>
          </section>

          <section className="settings-section" id="settings-storage">
            <div className="settings-section__head">
              <h2>Storage</h2>
              <p>Where the space went, and what can be safely reclaimed without touching a world or a mod.</p>
            </div>
            <div className="settings-card">
              <StoragePanel />
            </div>
          </section>

          <section className="settings-section" id="settings-window">
            <div className="settings-section__head">
              <h2>Game window</h2>
              <p>Default resolution for installations that don’t override it.</p>
            </div>
            <div className="settings-card">
              <div className="window-preset-row">
                {[
                  [854, 480, '854 × 480'],
                  [1280, 720, '1280 × 720'],
                  [1600, 900, '1600 × 900'],
                  [1920, 1080, '1920 × 1080'],
                ].map(([width, height, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={cx(
                      'window-preset',
                      form.window.width === width && form.window.height === height && 'is-selected',
                    )}
                    onClick={() => update('window', { ...form.window, width: width as number, height: height as number })}
                  >
                    <Monitor />
                    {label}
                  </button>
                ))}
              </div>
              <div className="settings-inline-grid">
                <Field label="Width" htmlFor="window-width">
                  <input
                    id="window-width"
                    className="input"
                    type="number"
                    min={320}
                    max={7680}
                    value={form.window.width}
                    onChange={(event) => update('window', { ...form.window, width: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Height" htmlFor="window-height">
                  <input
                    id="window-height"
                    className="input"
                    type="number"
                    min={240}
                    max={4320}
                    value={form.window.height}
                    onChange={(event) => update('window', { ...form.window, height: Number(event.target.value) })}
                  />
                </Field>
                <FieldRow title="Start fullscreen" description="Applies on the next launch. Minecraft can still leave fullscreen with F11.">
                  <Switch
                    checked={form.window.fullscreen}
                    onChange={(value) => update('window', { ...form.window, fullscreen: value })}
                    label="Start fullscreen"
                  />
                </FieldRow>
              </div>
              <p className="settings-hint">
                Per-installation overrides take precedence over these defaults. Window size is passed directly to
                Minecraft; fullscreen is applied to the profile’s options file before launch.
              </p>
            </div>
          </section>

          <section className="settings-section" id="settings-advanced">
            <div className="settings-section__head">
              <h2>Advanced</h2>
              <p>
                JVM and game arguments. Change these only if you know the impact.
              </p>
            </div>
            <div className="settings-card">
              <div className="settings-inline-grid settings-inline-grid--equal">
                <Field
                  label="JVM arguments"
                  hint="Passed to Java after Aqua’s memory and version arguments."
                >
                  <textarea
                    className="textarea textarea--mono"
                    value={form.jvmArgs}
                    onChange={(event) => update('jvmArgs', event.target.value)}
                    placeholder="-XX:+UseG1GC"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Game arguments" hint="Appended to Minecraft’s own launch arguments.">
                  <textarea
                    className="textarea textarea--mono"
                    value={form.gameArgs}
                    onChange={(event) => update('gameArgs', event.target.value)}
                    placeholder="Additional game arguments"
                    spellCheck={false}
                  />
                </Field>
              </div>

            </div>
          </section>

          <section className="settings-section" id="settings-startup">
            <div className="settings-section__head">
              <h2>Startup</h2>
              <p>How Aqua behaves when Windows starts and when a game session ends.</p>
            </div>
            <div className="settings-card">
              <FieldRow
                title="Launch at login"
                description={
                  portable
                    ? 'Disabled in portable mode so Aqua never writes a Windows startup entry outside its folder.'
                    : canLaunchAtLogin
                      ? 'Start Aqua automatically when you sign in to Windows.'
                      : 'Available in packaged builds. Development builds can still save this preference.'
                }
              >
                <Switch
                  checked={form.startup.launchAtLogin}
                  onChange={(value) => update('startup', { ...form.startup, launchAtLogin: value })}
                  label="Launch at login"
                  disabled={!canLaunchAtLogin}
                />
              </FieldRow>
              <FieldRow
                title="Start minimized at login"
                description="Open Aqua in the system tray instead of showing the window when started automatically."
              >
                <Switch
                  checked={form.startup.startMinimized}
                  onChange={(value) => update('startup', { ...form.startup, startMinimized: value })}
                  label="Start minimized at login"
                  disabled={!form.startup.launchAtLogin || !canLaunchAtLogin}
                />
              </FieldRow>
              <FieldRow
                title="Reopen after game exit"
                description="Bring the launcher to the front when Minecraft closes or crashes."
              >
                <Switch
                  checked={form.startup.reopenOnGameExit}
                  onChange={(value) => update('startup', { ...form.startup, reopenOnGameExit: value })}
                  label="Reopen after game exit"
                />
              </FieldRow>
              <FieldRow
                title="Scan Java on startup"
                description="Look for new Java installations in the background when the launcher opens."
              >
                <Switch
                  checked={form.startup.refreshJavaOnStart}
                  onChange={(value) => update('startup', { ...form.startup, refreshJavaOnStart: value })}
                  label="Scan Java on startup"
                />
              </FieldRow>
            </div>
          </section>

          <section className="settings-section" id="settings-troubleshooting">
            <div className="settings-section__head">
              <h2>Logging & troubleshooting</h2>
              <p>Control log detail and get a diagnostic bundle when something goes wrong.</p>
            </div>
            <div className="settings-card">
              <div className="settings-inline-grid">
                <Field label="Launcher log level" htmlFor="log-level" hint="Debug is verbose; use it when reporting an issue.">
                  <div className="select-wrap">
                    <select
                      id="log-level"
                      className="select"
                      value={form.logging.level}
                      onChange={(event) =>
                        update('logging', {
                          ...form.logging,
                          level: event.target.value as Settings['logging']['level'],
                        })
                      }
                    >
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                      <option value="warn">Warning</option>
                      <option value="error">Error</option>
                    </select>
                  </div>
                </Field>
                <Field
                  label="Game logs to keep"
                  htmlFor="log-retention"
                  hint="Older session logs are removed automatically."
                >
                  <input
                    id="log-retention"
                    className="input"
                    type="number"
                    min={1}
                    max={200}
                    value={form.logging.keepGameLogs}
                    onChange={(event) =>
                      update('logging', { ...form.logging, keepGameLogs: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>

              <div className="settings-divider" />

              <div className="troubleshooting-grid">
                <button type="button" className="troubleshooting-card" onClick={() => navigate('logs')}>
                  <FileText />
                  <span>
                    <strong>Open log viewer</strong>
                    <small>Launcher, game and crash logs</small>
                  </span>
                  <ArrowUpRight />
                </button>
                <button
                  type="button"
                  className="troubleshooting-card"
                  onClick={() => void api.system.openFolder('logs').catch((error) => setSaveError(getErrorMessage(error)))}
                >
                  <FolderOpen />
                  <span>
                    <strong>Open logs folder</strong>
                    <small>Browse raw files on disk</small>
                  </span>
                  <ArrowUpRight />
                </button>
                <button type="button" className="troubleshooting-card" onClick={() => void exportDiagnostics()}>
                  {exporting ? <Spinner /> : <Download />}
                  <span>
                    <strong>Export diagnostics</strong>
                    <small>System, settings, Java and logs</small>
                  </span>
                  <ArrowUpRight />
                </button>
                <button type="button" className="troubleshooting-card" onClick={() => void refreshJava(true)}>
                  <Cpu />
                  <span>
                    <strong>Rescan Java</strong>
                    <small>Refresh detected runtimes</small>
                  </span>
                  <ArrowUpRight />
                </button>
              </div>
              {diagnosticsPath ? (
                <div className="callout callout--success">
                  <FileText />
                  <div className="grow">
                    <div>Latest diagnostic bundle</div>
                    <div className="mono settings-diagnostic-path">{diagnosticsPath}</div>
                  </div>
                  <CopyButton value={diagnosticsPath} label="Copy diagnostics path" />
                </div>
              ) : null}

              <div className="settings-data-grid">
                <div>
                  <span>Launcher data</span>
                  <div className="copy-field">
                    <span className="copy-field__value">{system.dataRoot}</span>
                    <CopyButton value={system.dataRoot} label="Copy data folder path" />
                  </div>
                </div>
                <div>
                  <span>Minecraft files</span>
                  <div className="copy-field">
                    <span className="copy-field__value">{system.minecraftRoot}</span>
                    <CopyButton value={system.minecraftRoot} label="Copy Minecraft folder path" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section" id="settings-links">
            <div className="settings-section__head">
              <h2>Links & CLI</h2>
              <p>Open Aqua from a browser, Discord, a shortcut or a script without hunting for the window.</p>
            </div>
            <div className="settings-card">
              <LinksPanel />
            </div>
          </section>

          <section className="settings-section" id="settings-about">
            <div className="settings-section__head">
              <h2>About</h2>
              <p>Version information for this installation.</p>
            </div>
            <div className="settings-card about-card">
              <div className="about-card__mark">
                <Cpu />
              </div>
              <div className="about-card__copy">
                <div className="about-card__title">
                  <strong>Aqua Launcher</strong>
                  {portable ? <Badge tone="info">Portable</Badge> : null}
                </div>
                <span>
                  Version {data?.app.version} · {system.platform} {system.arch}
                </span>
                <span>
                  Electron {system.electron} · Chromium {system.chrome} · Node {system.node}
                </span>
                <span>
                  {formatBytes(system.totalMemMb * 1024 * 1024)} RAM · {system.cpuModel}
                </span>
                <span className="about-card__data-root">
                  Data folder <code>{system.dataRoot}</code>
                </span>
              </div>
              <div className="about-card__links">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<FolderOpen />}
                  onClick={() => void api.system.openFolder('data')}
                >
                  Data folder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ExternalLink />}
                  onClick={() => void api.openExternal('https://www.minecraft.net/en-us/eula')}
                >
                  Minecraft EULA
                </Button>
              </div>
            </div>
            {data?.app.portableWarning ? (
              <div className="callout callout--warning" role="alert">
                <TriangleAlert />
                <div>{data.app.portableWarning}</div>
              </div>
            ) : null}
          </section>

          <div className="settings-savebar">
            <div className="settings-savebar__status">
              {saved ? (
                <>
                  <Check /> Settings saved locally
                </>
              ) : !dirty ? (
                <>
                  <ShieldCheck /> Stored on this device
                </>
              ) : null}
            </div>
            <div className="settings-savebar__actions">
              {dirty ? (
                <Button variant="ghost" icon={<RotateCcw />} onClick={handleDiscard} disabled={saving}>
                  Discard
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </div>

      {javaJobsSeen.current.size > 0 && runtimeOptions.length > 0 ? (
        <div className="visually-hidden" aria-live="polite">
          Java runtime list refreshed.
        </div>
      ) : null}
    </div>
  )
}
