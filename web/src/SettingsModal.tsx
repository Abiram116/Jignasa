import { useEffect, useRef, useState } from 'react'
import { getOllamaModels, shutdownApp } from './api'
import type { LLMProvider, LLMSettings } from './types'

const PROVIDERS: { value: LLMProvider; label: string; placeholder: string }[] = [
  { value: 'ollama', label: 'Local (Ollama) — default, no key needed', placeholder: '' },
  { value: 'openai', label: 'OpenAI (your key)', placeholder: 'sk-...' },
  { value: 'anthropic', label: 'Anthropic (your key)', placeholder: 'sk-ant-...' },
  { value: 'gemini', label: 'Google Gemini (your key)', placeholder: 'AIza...' },
]

const MODEL_PLACEHOLDERS: Record<LLMProvider, string> = {
  ollama: '',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
}

export function SettingsModal({
  settings, onSave, onClose,
}: {
  settings: LLMSettings
  onSave: (settings: LLMSettings) => void
  onClose: () => void
}) {
  const [provider, setProvider] = useState<LLMProvider>(settings.provider)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model ?? '')
  const [ollamaModels, setOllamaModels] = useState<{ name: string; size_bytes: number }[] | null>(null)

  useEffect(() => {
    getOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
  }, [])

  const keyMissing = provider !== 'ollama' && apiKey.trim().length === 0

  const handleSave = () => {
    if (keyMissing) return
    onSave({ provider, apiKey: provider === 'ollama' ? '' : apiKey.trim(), model: model.trim() || undefined })
    onClose()
  }

  const active = PROVIDERS.find((p) => p.value === provider)!

  // Click-to-arm confirm, same pattern as MemoryModal's "Clear all" -- no
  // native confirm() dialog. Deliberately a manual button click only, never
  // tied to closing the tab/window: that event also fires on a page
  // refresh, which would otherwise kill the whole app on an accidental F5.
  const [quitArmed, setQuitArmed] = useState(false)
  const [quitting, setQuitting] = useState(false)
  const quitTimeoutRef = useRef<number | null>(null)
  useEffect(() => () => { if (quitTimeoutRef.current) window.clearTimeout(quitTimeoutRef.current) }, [])

  const handleQuit = async () => {
    if (!quitArmed) {
      setQuitArmed(true)
      quitTimeoutRef.current = window.setTimeout(() => setQuitArmed(false), 4000)
      return
    }
    if (quitTimeoutRef.current) window.clearTimeout(quitTimeoutRef.current)
    setQuitting(true)
    await shutdownApp()
  }

  if (quitting) {
    return (
      <div className="modal-overlay">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p className="cost-summary">
              Jignasa has been shut down. It's safe to close this tab or window now.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Model settings</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="cost-summary">
            By default, Jignasa runs entirely on your machine via Ollama — free,
            private, no key required. If you'd rather use a cloud model, paste
            your own API key below. It's stored only in this browser's
            localStorage, sent with each request straight to your own
            self-hosted backend, then forwarded directly to the provider you
            choose — never logged or saved server-side.
          </p>

          <div className="settings-field">
            <label>Provider</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value as LLMProvider); setModel('') }}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider === 'ollama' ? (
            <div className="settings-field">
              <label>Model</label>
              {ollamaModels === null ? (
                <p className="cost-note" style={{ margin: 0 }}>Checking locally installed models…</p>
              ) : ollamaModels.length > 0 ? (
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">App default (qwen3:8b)</option>
                  {ollamaModels.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <p className="cost-note" style={{ margin: 0 }}>
                  Couldn't detect any local Ollama models — using the app default.
                </p>
              )}
              <p className="cost-note" style={{ margin: 0 }}>
                This only changes which model writes the final answer. Document/web
                search decisions always use the app's own calibrated model, regardless
                of what you pick here.
              </p>
            </div>
          ) : (
            <>
              <div className="settings-field">
                <label>API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={active.placeholder}
                  autoComplete="off"
                />
              </div>
              <div className="settings-field">
                <label>Model (optional override)</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={MODEL_PLACEHOLDERS[provider]}
                />
              </div>
              {keyMissing && (
                <p className="cost-note" style={{ margin: 0 }}>
                  Enter your API key, or switch back to Local (Ollama).
                </p>
              )}
            </>
          )}

          <button
            className="btn-cta-primary"
            style={{ marginTop: '1rem', width: '100%' }}
            onClick={handleSave}
            disabled={keyMissing}
          >
            Save
          </button>

          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-2)' }}>
            <p className="cost-note" style={{ marginBottom: '0.5rem' }}>
              Stops the local backend server running this app. You'll need to
              start it again from the terminal to use Jignasa afterward.
            </p>
            <button
              className={`memory-clear-all${quitArmed ? ' confirm-armed' : ''}`}
              onClick={handleQuit}
              title={quitArmed ? 'Click again to confirm' : undefined}
            >
              {quitArmed ? 'Click again to confirm' : 'Quit Jignasa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
