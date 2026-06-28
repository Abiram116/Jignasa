import { useState } from 'react'
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

  const keyMissing = provider !== 'ollama' && apiKey.trim().length === 0

  const handleSave = () => {
    if (keyMissing) return
    onSave({ provider, apiKey: provider === 'ollama' ? '' : apiKey.trim(), model: model.trim() || undefined })
    onClose()
  }

  const active = PROVIDERS.find((p) => p.value === provider)!

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
            <select value={provider} onChange={(e) => setProvider(e.target.value as LLMProvider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider !== 'ollama' && (
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
        </div>
      </div>
    </div>
  )
}
