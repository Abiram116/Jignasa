import { useState } from 'react'

export function EditMessageModal({
  message, onSave, onClose,
}: {
  message: string
  onSave: (newText: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(message)

  const handleSave = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit message</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="cost-summary">
            Saving replaces this message and removes everything after it in
            this conversation, then sends the edited version.
          </p>
          <textarea
            className="edit-message-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={5}
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave() }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
          />
          <button
            className="btn-cta-primary"
            style={{ marginTop: '1rem', width: '100%' }}
            onClick={handleSave}
            disabled={!text.trim()}
          >
            Save & resend
          </button>
        </div>
      </div>
    </div>
  )
}
