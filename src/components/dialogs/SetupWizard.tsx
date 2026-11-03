import { useEffect, useState } from 'react'
import { Check, KeyRound, Sparkles } from 'lucide-react'
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
  const { setupOpen, data, settings, activeAccount, openAuth, saveSettings, completeSetup, dismissSetup } =
    useLauncher()
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [uiScale, setUiScale] = useState(settings?.uiScale ?? 1)
  const [reduceMotion, setReduceMotion] = useState(settings?.reduceMotion ?? false)

  useEffect(() => {
    if (!setupOpen) return
    setError(null)
    setFinishing(false)
  }, [setupOpen])

  const applyPreference = async (patch: { uiScale?: number; reduceMotion?: boolean }) => {
    try {
      await saveSettings(patch)
    } catch (settingsError) {
      setError(getErrorMessage(settingsError))
    }
  }

  const handleFinish = async () => {
    setFinishing(true)
    setError(null)
    try {
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
      subtitle="Sign in with Microsoft to play Minecraft: Java Edition."
      className="modal--setup"
      closeOnOverlay={false}
      footer={
        <>
          <button type="button" className="text-button modal__footer-left" onClick={() => void handleSkip()}>
            Set up later
          </button>
          <Button
            variant="primary"
            onClick={() => (activeAccount ? void handleFinish() : openAuth('microsoft'))}
            loading={finishing}
            icon={activeAccount ? <Check /> : <KeyRound />}
          >
            {activeAccount ? 'Finish setup' : 'Connect Microsoft'}
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
            <h2>{activeAccount ? `Signed in as ${activeAccount.name}` : 'Connect your Microsoft account'}</h2>
            <p>
              Aqua plays Minecraft: Java Edition with the Microsoft account that owns it. Sign-in uses Microsoft’s
              official OAuth flow in your browser, and Aqua never sees your password.
            </p>

            {activeAccount ? (
              <div className="callout callout--info">
                <Check />
                <span>
                  Your Minecraft profile is connected. The encrypted session is stored by your operating system and
                  refreshed before each launch.
                </span>
              </div>
            ) : (
              <div className="setup__provider">
                <Button variant="primary" icon={<KeyRound />} onClick={() => openAuth('microsoft')}>
                  Connect Microsoft
                </Button>
              </div>
            )}

            <p className="setup__name-hint">
              <Sparkles />
              This build supports Minecraft: Java Edition only. Bedrock and offline profiles are not available.
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
