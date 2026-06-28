import { useState } from 'react'
import { uploadAndIndex } from './api'
import type { UploadEvent } from './api'

type Stage = 'idle' | 'uploading' | 'done' | 'error'

const STEP_LABELS: Record<string, string> = {
  start: 'Saved file',
  parsed: 'Parsing PDF...',
  reindexing: 'Adding to index...',
  done: 'Done',
  error: 'Failed',
}

export function UploadModal({
  onClose, onIndexed,
}: {
  onClose: () => void
  onIndexed: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [steps, setSteps] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [chunkCount, setChunkCount] = useState<number | null>(null)

  const handleUpload = async () => {
    if (!file) return
    setStage('uploading')
    setSteps([])
    setErrorMessage('')

    const onEvent = (event: UploadEvent) => {
      if (event.type === 'error') {
        setStage('error')
        setErrorMessage(event.message)
        return
      }
      setSteps((prev) => [...prev, STEP_LABELS[event.type] ?? event.type])
      if (event.type === 'done') {
        setStage('done')
        setChunkCount(event.chunk_count)
        onIndexed()
      }
    }

    try {
      await uploadAndIndex(file, onEvent)
    } catch (err) {
      setStage('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = stage === 'uploading'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add a document</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="cost-summary">
            Uploaded files are saved to the <code>knowledge-base/</code> folder
            on this machine/server only. Nothing is sent anywhere else.
          </p>

          <div className="settings-field">
            <label>PDF file</label>
            <input
              type="file"
              accept=".pdf"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {steps.length > 0 && (
            <ul className="cost-note" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}

          {stage === 'done' && (
            <p className="cost-summary">
              Done — {chunkCount} chunks now indexed.
            </p>
          )}

          {stage === 'error' && (
            <p className="cost-note" style={{ color: 'var(--rose-400)' }}>
              {errorMessage}
            </p>
          )}

          <button
            className="btn-cta-primary"
            style={{ marginTop: '1rem', width: '100%' }}
            onClick={handleUpload}
            disabled={!file || busy}
          >
            {busy ? 'Uploading & indexing…' : 'Upload & index'}
          </button>
        </div>
      </div>
    </div>
  )
}
