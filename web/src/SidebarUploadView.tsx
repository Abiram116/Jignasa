import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { uploadAndIndex, getKnowledgeBaseFiles, deleteKnowledgeBaseFile } from './api'
import type { UploadEvent, KBFile } from './api'

export type FileStatus = 'pending' | 'processing' | 'done' | 'error'

export interface FileItem {
  id: string
  file: File
  status: FileStatus
  error?: string
}

export const STAGES = ['parsing', 'chunking', 'embedding', 'storing']
export const STAGE_COLORS: Record<string, string> = {
  'parsing': 'var(--cyan-400)',
  'chunking': 'var(--violet-400)',
  'embedding': 'var(--ember-400)',
  'storing': 'var(--sage-400)'
}

export function useUploadQueue(onIndexed: () => void) {
  const [queue, setQueue] = useState<FileItem[]>([])
  const [activeStages, setActiveStages] = useState<string[]>([])

  const addFiles = (files: File[]) => {
    const newItems: FileItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
    }))
    setQueue((prev) => [...prev, ...newItems])
  }

  useEffect(() => {
    const processQueue = async () => {
      const nextIndex = queue.findIndex((item) => item.status === 'pending')
      if (nextIndex === -1) return
      if (queue.some((item) => item.status === 'processing')) return

      const item = queue[nextIndex]

      setQueue((prev) =>
        prev.map((q, i) => (i === nextIndex ? { ...q, status: 'processing' } : q))
      )
      setActiveStages([])

      const onEvent = (event: UploadEvent) => {
        if (STAGES.includes(event.type)) {
          setActiveStages((prev) => {
            if (!prev.includes(event.type)) return [...prev, event.type]
            return prev
          })
        }
        
        if (event.type === 'error') {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: 'error', error: event.message } : q
            )
          )
        }
        if (event.type === 'done') {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: 'done' } : q))
          )
          onIndexed()
        }
      }

      try {
        await uploadAndIndex(item.file, onEvent)
      } catch (err) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'error', error: String(err) } : q
          )
        )
      }
    }

    processQueue()
  }, [queue, onIndexed])

  return { queue, activeStages, addFiles }
}

export function SidebarUploadView({
  onBack,
  queue,
  activeStages,
  addFiles,
}: {
  onBack: () => void
  queue: FileItem[]
  activeStages: string[]
  addFiles: (files: File[]) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [kbFiles, setKbFiles] = useState<KBFile[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchKB = async () => {
    try {
      setKbFiles(await getKnowledgeBaseFiles())
    } catch (e) {
      console.error(e)
    }
  }

  // Fetch when queue completes an item, or when mounted
  useEffect(() => {
    fetchKB()
  }, [queue])

  const handleDelete = async (e: React.MouseEvent, filename: string) => {
    e.stopPropagation()
    setDeleting(filename)
    try {
      await deleteKnowledgeBaseFile(filename)
      await fetchKB()
    } catch (e) {
      alert("Failed to delete file")
    } finally {
      setDeleting(null)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      addFiles(files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      addFiles(files)
    }
  }

  return (
    <div className="sidebar-upload-view">
      <div className="sidebar-upload-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <button 
          className="btn-back" 
          onClick={onBack}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            color: 'var(--text-2)',
            cursor: 'pointer',
            borderRadius: '4px',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px'
          }}
          title="Back to chats"
        >
          ←
        </button>
        <div className="conv-section-label" style={{ padding: 0 }}>Add Document</div>
      </div>

      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="drop-zone-icon">📄</div>
        <p style={{ margin: 0, fontSize: '0.85rem' }}>Click or drag PDFs here</p>
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>

      <div className="queue-list">
        <AnimatePresence>
          {queue.map((item) => (
            <motion.div
              key={item.id}
              className={`queue-item ${item.status}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="queue-item-header">
                <span className="queue-item-name" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="queue-item-status">
                  {item.status === 'pending' && <span className="status-dot pending" />}
                  {item.status === 'processing' && <div className="spinner small spinner-radiate" />}
                  {item.status === 'done' && <span className="status-icon done">✓</span>}
                  {item.status === 'error' && <span className="status-icon error">⚠</span>}
                </span>
              </div>
              
              {item.error && <div className="queue-item-error">{item.error}</div>}

              {/* Granular stages if this is the active item */}
              {item.status === 'processing' && (
                <div className="queue-item-stages">
                  {STAGES.map((stage, idx) => {
                    const isCompleted = activeStages.includes(stage)
                    // The "current" stage is the one right after the last completed one, or the last completed one if it's the last stage
                    const lastCompletedIdx = activeStages.length > 0 ? STAGES.indexOf(activeStages[activeStages.length - 1]) : -1
                    const isCurrent = idx === lastCompletedIdx + 1 || (idx === STAGES.length - 1 && activeStages.includes(stage))
                    
                    let stageStatus = 'pending'
                    if (isCompleted && !isCurrent) stageStatus = 'completed'
                    if (isCurrent) stageStatus = 'current'
                    
                    const themeColor = STAGE_COLORS[stage]

                    return (
                      <div key={stage} className={`stage-row ${stageStatus}`} style={{ color: isCurrent ? themeColor : undefined }}>
                        <div className="stage-indicator">
                          {stageStatus === 'completed' ? '✓' : stageStatus === 'current' ? <div className="spinner tiny" style={{ borderTopColor: themeColor }} /> : '·'}
                        </div>
                        <span className="stage-name">{stage}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      
      <div className="kb-section-header">Knowledge Base</div>
      <div className="kb-list" style={{ overflowY: 'auto', flex: 1, minHeight: 0, paddingBottom: '1rem' }}>
        {kbFiles.length === 0 && <div className="kb-empty">No documents yet</div>}
        {kbFiles.map((f) => (
          <div key={f.name} className="kb-item">
            <span className="kb-name" title={f.name}>{f.name}</span>
            <button 
              className="kb-delete-btn" 
              onClick={(e) => handleDelete(e, f.name)} 
              title="Delete document"
              disabled={deleting === f.name}
            >
              {deleting === f.name ? <div className="spinner tiny" /> : '🗑'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
