import { useEffect, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import { TitleArtwork } from '../brand/Artwork'
import { Button, Switch, cx } from '../ui/primitives'
import { Modal } from '../ui/overlays'

const FONT_SIZES: Array<{ value: number; label: string }> = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
]

export function SetupWizard() {
  const { setupOpen, data, settings, activeAccount, signInOffline, saveSettings, completeSetup, dismissSetup } =
    useLauncher()
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [uiScale, setUiScale] = useState(settings?.uiScale ?? 1)
  const [reduceMotion, setReduceMotion] = useState(settings?.reduceMotion ?? false)

  useEffect(() => {
    if (!setupOpen) return
    setUsername(activeAccount?.name || '')
    setError(null)
    setFinishing(false)
  }, [setupOpen, activeAccount?.name])

  const applyPreference = async (patch: { uiScale?: number; reduceMotion?: boolean }) => {
    try {
      await saveSettings(patch)
    } catch (settingsError) {
      setError(getErrorMessage(settingsError))
    }
  }

  const handleFinish = async () => {
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setError('Use 3–16 letters, numbers, or underscores as your player name.')
      return
    }
    setFinishing(true)
    setError(null)
    try {
      if (!activeAccount || activeAccount.name.toLowerCase() !== name.toLowerCase()) {
        await signInOffline(name)
      }
      await completeSetup()
    } catch (setupError) {
      setError(getErrorMessage(setupError))
    } finally {
      setFinishing(false)
    }
  }

  const handleSkip = async () => {
    try {
      await dismissSetup()
    } catch {
      // dismissSetup surfaces its own error toast.
    }
  }

  if (!setupOpen) return null

  return (
    <Modal
      open={setupOpen}
      onClose={() => void handleSkip()}
      title="Welcome to Aqua"
      subtitle="One step: pick the name Minecraft will show."
      className="modal--setup"
      closeOnOverlay={false}
      footer={
        <>
          <button type="button" className="text-button modal__footer-left" onClick={() => void handleSkip()}>
            Set up later
          </button>
          <Button
            variant="primary"
            onClick={() => void handleFinish()}
            loading={finishing}
            icon={<Check />}
          >
            {activeAccount ? 'Finish setup' : 'Create profile'}
          </Button>
        </>
      }
    >
      <div className="setup">
        {error ? (
          <div className="callout callout--danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="setup__welcome">
          <div className="setup__welcome-copy">
            <TitleArtwork height="46px" />
            <h2>Choose your player name</h2>
            <p>
              This creates an offline profile stored on this device. Java, memory, and game folders use sensible
              defaults — change any of them later in Settings.
            </p>

            <label className="setup__name-field">
              <span className="field__label">Player name</span>
              <input
                className="input"
                value={username}
                maxLength={16}
                placeholder="Steve"
                autoFocus
                spellCheck={false}
                onChange={(event) => {
                  setUsername(event.target.value)
                  setError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleFinish()
                }}
              />
            </label>

            <p className="setup__name-hint">
              <Sparkles />
              Offline profiles work in singleplayer and LAN worlds. Online servers need a Microsoft account.
            </p>

            <div className="setup__a11y">
              <span className="field__label">Accessibility</span>
              <div className="setup__a11y-row">
                <span className="setup__a11y-label">Font size</span>
                <div className="segmented" role="radiogroup" aria-label="Font size">
                  {FONT_SIZES.map((option) => {
                    const selected = Math.abs(uiScale - option.value) < 0.001
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cx(selected && 'is-active')}
                        onClick={() => {
                          setUiScale(option.value)
                          void applyPreference({ uiScale: option.value })
                        }}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="setup__a11y-row">
                <span className="setup__a11y-label">Reduce motion</span>
                <Switch
                  checked={reduceMotion}
                  onChange={(value) => {
                    setReduceMotion(value)
                    void applyPreference({ reduceMotion: value })
                  }}
                  label="Reduce motion"
                />
              </div>
            </div>

            <div className="setup__system">
              <div>
                <span>System</span>
                <strong>
                  {data?.app.platform || 'Windows'} · {data?.system.arch || 'x64'}
                </strong>
              </div>
              <div>
                <span>Memory</span>
                <strong>{Math.round((data?.system.totalMemMb || 0) / 1024)} GB</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
