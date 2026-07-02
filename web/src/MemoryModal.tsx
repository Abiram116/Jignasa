import { useEffect, useRef, useState } from 'react'
import { clearMemories, deleteMemory, fetchMemories } from './api'
import type { MemoryItem } from './types'

export function MemoryModal({ onClose }: { onClose: () => void }) {
  const [memories, setMemories] = useState<MemoryItem[] | null>(null)
  const [error, setError] = useState('')
  // Click-to-arm confirm for "Clear all" -- no native confirm() dialog.
  const [clearArmed, setClearArmed] = useState(false)
  const clearTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    fetchMemories()
      .then(setMemories)
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => () => { if (clearTimeoutRef.current) window.clearTimeout(clearTimeoutRef.current) }, [])

  const handleDelete = async (id: number) => {
    setMemories((m) => m && m.filter((mem) => mem.id !== id))
    try {
      await deleteMemory(id)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleClearAll = async () => {
    if (!memories?.length) return
    if (!clearArmed) {
      setClearArmed(true)
      clearTimeoutRef.current = window.setTimeout(() => setClearArmed(false), 4000)
      return
    }
    if (clearTimeoutRef.current) window.clearTimeout(clearTimeoutRef.current)
    setClearArmed(false)
    const prev = memories
    setMemories([])
    try {
      await clearMemories()
    } catch (e) {
      setError(String(e))
      setMemories(prev)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>What Jignasa remembers</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="cost-summary">
            Jignasa quietly picks up lasting preferences and facts you share —
            your name, how you like answers formatted, things you've asked it
            to remember — and carries them into every future conversation.
            Nothing here leaves your machine. Remove anything that's wrong or
            you'd rather it forgot.
          </p>

          {error && <p className="cost-note" style={{ color: 'var(--coral-400)' }}>{error}</p>}

          {memories === null ? (
            <div className="memory-list-loading" />
          ) : memories.length === 0 ? (
            <p className="memory-empty">
              Nothing remembered yet — mention a preference or introduce
              yourself, and it'll show up here.
            </p>
          ) : (
            <div className="memory-list">
              {memories.map((m) => (
                <div key={m.id} className="memory-item">
                  <span className="memory-item-text">{m.content}</span>
                  <button
                    className="memory-item-delete"
                    onClick={() => handleDelete(m.id)}
                    title="Forget this"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {!!memories?.length && (
            <button
              className={`memory-clear-all${clearArmed ? ' confirm-armed' : ''}`}
              onClick={handleClearAll}
              title={clearArmed ? "Click again to confirm — this can't be undone" : undefined}
            >
              {clearArmed ? 'Click again to confirm' : 'Clear all memories'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
