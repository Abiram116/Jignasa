import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  createConversation,
  deleteConversation,
  renameConversation,
  fetchConversations,
  fetchMessages,
  fetchStatus,
  savePartialAssistant,
  streamChat,
  truncateConversation,
} from './api'
import type { ChatMode, Conversation, Message, Source, Status, WebSource } from './types'
import './index.css'

/* ── Inline SVG icons ──────────────────────────────────────────────── */
const Ic = {
  Plus: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Trash: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  Chat: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Bar: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="4" height="18" rx="1" fill="currentColor"/>
      <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor"/>
      <rect x="17" y="13" width="4" height="8" rx="1" fill="currentColor"/>
    </svg>
  ),
  Copy: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Check: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  ChevDown: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Globe: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Doc: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2"/>
      <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  Sparkle: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  ),
  Rename: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Pencil: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
    </svg>
  ),
  Code: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"></polyline>
      <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
  ),
  Stop: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
}

/* ── Auto-resize textarea ──────────────────────────────────────────── */
function AutoTextarea({
  value, onChange, onKeyDown, placeholder, disabled, maxLength,
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
  disabled: boolean
  maxLength: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
    />
  )
}

function ModeBadge({ mode }: { mode: ChatMode }) {
  const map: Record<ChatMode, { label: string; cls: string; icon: React.ReactNode }> = {
    casual: { label: 'Chat',    cls: 'badge-casual', icon: <Ic.Sparkle /> },
    rag:    { label: 'PDF RAG', cls: 'badge-rag',    icon: <Ic.Doc />     },
    web:    { label: 'Web',     cls: 'badge-web',    icon: <Ic.Globe />   },
    hybrid: { label: 'Hybrid',  cls: 'badge-hybrid', icon: <Ic.Globe />   },
    auto:   { label: 'Auto',    cls: 'badge-auto',   icon: <Ic.Sparkle /> },
  }
  const item = map[mode] || map['casual']
  return <span className={`mode-badge ${item.cls}`}>{item.icon}{item.label}</span>
}

/* ── Copy button ───────────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button className="bubble-action-btn" onClick={handleCopy} title="Copy">
      {copied ? <Ic.Check /> : <Ic.Copy />}
    </button>
  )
}

/* ── Collapsible sources panel ─────────────────────────────────────── */
function RagSources({ sources, defaultOpen = false }: { sources: Source[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!sources.length) return null
  return (
    <div className="sources-container">
      <button
        className={`sources-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sources-toggle-left">
          <Ic.Doc />
          <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        </span>
        <span className={`chevron ${open ? 'up' : ''}`}><Ic.ChevDown /></span>
      </button>
      <div className={`sources-body ${open ? 'expanded' : 'collapsed'}`}>
        {sources.map((s) => (
          <div key={s.rank} className="source-card">
            <div className="source-card-header">
              <span className="source-rank">#{s.rank}</span>
              <span className="source-file">{s.source ?? 'unknown'}</span>
              <span className="source-meta">
                {s.page_number != null ? `p.${s.page_number}` : ''} · {s.score.toFixed(4)}
              </span>
            </div>
            <div className="source-snippet">{s.text.slice(0, 280)}…</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Web sources panel ─────────────────────────────────────────────── */
function WebSources({ sources, defaultOpen = false }: { sources: WebSource[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!sources.length) return null
  return (
    <div className="sources-container">
      <button
        className={`sources-toggle web ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sources-toggle-left">
          <Ic.Globe />
          <span>{sources.length} web result{sources.length !== 1 ? 's' : ''}</span>
        </span>
        <span className={`chevron ${open ? 'up' : ''}`}><Ic.ChevDown /></span>
      </button>
      <div className={`sources-body ${open ? 'expanded' : 'collapsed'}`}>
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="web-source-card"
          >
            <div className="web-source-header">
              <span className="source-rank">#{i + 1}</span>
              <span className="source-file">{s.title}</span>
            </div>
            <div className="web-source-url">{s.url}</div>
            <div className="source-snippet">{s.snippet.slice(0, 240)}…</div>
          </a>
        ))}
      </div>
    </div>
  )
}

/* ── Markdown renderer — used during streaming AND after ───────────── */
function MarkdownContent({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  return (
    <div className={isStreaming ? 'md-streaming' : ''}>
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')
            const isBlock = codeStr.includes('\n') || match
            if (isBlock) {
              const lang = match?.[1] || 'text'
              return (
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-lang"><Ic.Code /> {lang}</span>
                    <CopyButton text={codeStr} />
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={lang}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0 0 12px 12px',
                      fontSize: '0.85rem',
                      background: '#0d1117',
                      border: 'none',
                      padding: '1rem',
                    }}
                  >
                    {codeStr}
                  </SyntaxHighlighter>
                </div>
              )
            }
            return <code className="md-inline-code" {...props}>{children}</code>
          },
          p({ children }) { return <p className="md-p">{children}</p> },
          ul({ children }) { return <ul className="md-ul">{children}</ul> },
          ol({ children }) { return <ol className="md-ol">{children}</ol> },
          li({ children }) { return <li className="md-li">{children}</li> },
          h1({ children }) { return <h1 className="md-h1">{children}</h1> },
          h2({ children }) { return <h2 className="md-h2">{children}</h2> },
          h3({ children }) { return <h3 className="md-h3">{children}</h3> },
          strong({ children }) { return <strong className="md-strong">{children}</strong> },
          em({ children }) { return <em className="md-em">{children}</em> },
          blockquote({ children }) { return <blockquote className="md-blockquote">{children}</blockquote> },
          hr() { return <hr className="md-hr" /> },
          // ── Clickable links from web citations ──
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="stream-cursor" />}
    </div>
  )
}

/* ── Web Search Confirmation bubble ─────────────────────────────────── */
function WebSearchConfirm({
  message,
  onYes,
  onNo,
}: {
  message: string
  onYes: () => void
  onNo: () => void
}) {
  return (
    <div className="web-search-confirm">
      <div className="web-search-confirm-icon"><Ic.Search /></div>
      <p className="web-search-confirm-msg">{message}</p>
      <div className="web-search-confirm-actions">
        <button className="web-confirm-btn yes" onClick={onYes}>
          <Ic.Globe /> Search the web
        </button>
        <button className="web-confirm-btn no" onClick={onNo}>
          No thanks
        </button>
      </div>
    </div>
  )
}

/* ── Message bubble ────────────────────────────────────────────────── */
function MessageBubble({
  msg, isLast, isStreaming, onEdit, onConfirmWeb, onDeclineWeb,
}: {
  msg: Message
  isLast: boolean
  isStreaming: boolean
  onEdit?: (msg: Message) => void
  onConfirmWeb?: () => void
  onDeclineWeb?: () => void
}) {
  const isTyping = isLast && isStreaming && !msg.message && msg.role === 'assistant'
  const isStreamingContent = isLast && isStreaming && !!msg.message && msg.role === 'assistant'

  const formatLatency = (ms: number) => {
    if (ms >= 60000) {
      const m = Math.floor(ms / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      return `${m}m ${s}s`
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
  }

  return (
    <motion.div 
      className={`bubble-row ${msg.role}`}
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
    >
      <div className={`avatar ${msg.role}`}>
        {msg.role === 'assistant' ? '✦' : '↑'}
      </div>
      <div className="bubble-col">
        {msg.role === 'assistant' && msg.mode && !isStreaming && (
          <ModeBadge mode={msg.mode} />
        )}
        <div className={`bubble ${msg.role}`}>
          {isTyping ? (
            <div className="agent-thinking">
              <div className="thinking-dots"><span /><span /><span /></div>
              <span>Thinking…</span>
            </div>
          ) : msg.askWebSearch && !isStreaming ? (
            <WebSearchConfirm
              message={msg.askWebSearch}
              onYes={onConfirmWeb!}
              onNo={onDeclineWeb!}
            />
          ) : isStreamingContent ? (
            // Stream with live markdown rendering — no flicker since we render as it comes
            <MarkdownContent content={msg.message} isStreaming={true} />
          ) : msg.role === 'assistant' ? (
            <MarkdownContent content={msg.message} />
          ) : (
            <div className="bubble-text">{msg.message}</div>
          )}
          {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && !isStreaming && (
            <RagSources sources={msg.sources} defaultOpen={false} />
          )}
          {msg.role === 'assistant' && msg.webSources && msg.webSources.length > 0 && !isStreaming && (
            <WebSources sources={msg.webSources} defaultOpen={false} />
          )}
        </div>
        {msg.role === 'assistant' && msg.message && msg.prompt_tokens !== undefined && msg.prompt_tokens > 0 && !isStreaming && (
          <div className="token-stats-box">
            <div className="token-stats-row">
              <strong>Input:</strong> {msg.prompt_tokens} t
              <span className="token-sep">·</span>
              <strong>Output:</strong> {msg.completion_tokens} t
              <span className="token-sep">·</span>
              <strong>Total:</strong> {(msg.prompt_tokens || 0) + (msg.completion_tokens || 0)} t
              {msg.latency_ms != null && msg.latency_ms > 0 && (
                <>
                  <span className="token-sep">·</span>
                  <span className="latency-badge">⏱ {formatLatency(msg.latency_ms)}</span>
                </>
              )}
              {msg.cached && (
                <>
                  <span className="token-sep">·</span>
                  <span className="cached-badge">Cached</span>
                </>
              )}
            </div>
          </div>
        )}
        {msg.role === 'assistant' && msg.message && !isStreaming && !msg.askWebSearch && (
          <div className="bubble-actions">
            <CopyButton text={msg.message} />
          </div>
        )}
        {msg.role === 'user' && !isStreaming && onEdit && (
          <div className="bubble-actions">
            <button className="bubble-action-btn edit-btn" onClick={() => onEdit(msg)} title="Edit prompt">
              <Ic.Pencil /> Edit
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ── Cost Calculator Modal ─────────────────────────────────────────── */
function CostCalculatorModal({
  messages, onClose,
}: {
  messages: Message[]
  onClose: () => void
}) {
  const totalPrompt = messages.reduce((sum, m) => sum + (m.prompt_tokens || 0), 0)
  const totalCompletion = messages.reduce((sum, m) => sum + (m.completion_tokens || 0), 0)
  const rows = [
    ['GPT-4o',           0.0000025,  0.00001  ],
    ['GPT-4o mini',      0.00000015, 0.0000006],
    ['Claude Sonnet',    0.000003,   0.000015 ],
    ['Claude Haiku',     0.00000025, 0.00000125],
    ['Gemini 1.5 Pro',   0.00000125, 0.000005 ],
    ['Gemini Flash',     0.000000075,0.0000003 ],
  ] as [string, number, number][]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Token cost estimate</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="cost-summary">
            This conversation used <strong>{totalPrompt.toLocaleString()}</strong> input tokens
            and <strong>{totalCompletion.toLocaleString()}</strong> output tokens
            ({(totalPrompt + totalCompletion).toLocaleString()} total).
          </p>
          <table>
            <thead>
              <tr><th>Model</th><th>Input</th><th>Output</th><th>Total</th></tr>
            </thead>
            <tbody>
              {rows.map(([name, iRate, oRate]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>${(totalPrompt * iRate).toFixed(4)}</td>
                  <td>${(totalCompletion * oRate).toFixed(4)}</td>
                  <td><strong>${(totalPrompt * iRate + totalCompletion * oRate).toFixed(4)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cost-note">
            * Rates based on official pricing as of 2024/2025.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   Main App
═══════════════════════════════════════════════════════════════════════ */
export default function ChatInterface({ onBack }: { onBack: () => void }) {
  // App initialization states
  const [connectLoaded, setConnectLoaded] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  const [status, setStatus] = useState<Status | null>(null)
  const [connectError, setConnectError] = useState('')
  const [selectedMode, setSelectedMode] = useState<ChatMode>('auto')
  const [showCostModal, setShowCostModal] = useState(false)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [title, setTitle] = useState('New Chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')

  // Selection highlight state — keeps the selection highlighted until quote is clicked
  const [activeSelection, setActiveSelection] = useState<string | null>(null)
  const [quoteSelection, setQuoteSelection] = useState<{text: string, top: number, left: number} | null>(null)
  const [quotedText, setQuotedText] = useState<string | null>(null)

  // Pending web search confirmation state
  const [pendingWebConfirm, setPendingWebConfirm] = useState<{
    userMessage: string
    userDisplay: string
    quote: string | null
  } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)

  const MAX_CHARS = 2000

  // Dismiss quote button on click outside
  useEffect(() => {
    const dismiss = (e: MouseEvent) => {
      if ((e.target as Element).closest('.floating-quote-btn')) return
      // Only dismiss if user isn't clicking inside a bubble (to let selection be read)
      if (!(e.target as Element).closest('.bubble.assistant')) {
        setQuoteSelection(null)
        setActiveSelection(null)
      }
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const refreshConversations = useCallback(async () => {
    setConversations(await fetchConversations())
  }, [])

  /* ── Bootstrap ── */
  useEffect(() => {
    let cancelled = false
    const MAX = 20
    const DELAY = 1500

    const tryConnect = async (attempt: number): Promise<void> => {
      try {
        const s = await fetchStatus()
        if (cancelled) return
        setStatus(s)
        const list = await fetchConversations()
        setConversations(list)
        let sid: string
        if (list.length) {
          sid = list[0].session_id
        } else {
          const c = await createConversation()
          sid = c.session_id
          setConversations(await fetchConversations())
        }
        setSessionId(sid)
        setConnectLoaded(true)
        setConnectError('')
      } catch {
        if (cancelled) return
        if (attempt < MAX) {
          setConnectError(`Connecting… (${attempt + 1}/${MAX})`)
          setTimeout(() => tryConnect(attempt + 1), DELAY)
        } else {
          setConnectError('Cannot reach backend on port 8000. Is the API server running?')
          setConnectLoaded(true) // Still unblock loader so we can show error
        }
      }
    }
    tryConnect(0)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    fetchMessages(sessionId)
      .then((data) => {
        setTitle(data.title || 'New Chat')
        setMessages(data.messages)
      })
      .catch((e) => setError(String(e)))
  }, [sessionId])

  const handleNewChat = async () => {
    const c = await createConversation()
    setSessionId(c.session_id)
    setMessages([])
    setTitle('New Chat')
    setPendingWebConfirm(null)
    await refreshConversations()
  }

  const handleDelete = async (id: string) => {
    await deleteConversation(id)
    const list = await fetchConversations()
    setConversations(list)
    if (id === sessionId) {
      if (list.length) setSessionId(list[0].session_id)
      else await handleNewChat()
    }
  }

  const handleRename = async (id: string, currentTitle: string) => {
    const newTitle = prompt('Rename conversation:', currentTitle)
    if (!newTitle || !newTitle.trim()) return
    try {
      await renameConversation(id, newTitle.trim())
      await refreshConversations()
      if (id === sessionId) setTitle(newTitle.trim())
    } catch (e) {
      setError(String(e))
    }
  }

  const handleEditMessage = async (msg: Message) => {
    if (!sessionId || !msg.id || streaming) return
    if (!confirm('This will delete this message and all subsequent messages. Continue?')) return
    setInput(msg.message)
    try {
      await truncateConversation(sessionId, msg.id)
      setMessages(messages.slice(0, messages.findIndex(m => m.id === msg.id)))
    } catch (e) {
      setError(String(e))
    }
  }

  const handleTextSelection = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.floating-quote-btn')) return

    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        if (!quoteSelection) {
          setActiveSelection(null)
        }
        return
      }
      const text = selection.toString().trim()
      if (!text || text.length < 3) {
        setQuoteSelection(null)
        setActiveSelection(null)
        return
      }

      const anchorNode = selection.anchorNode
      if (!anchorNode) { setQuoteSelection(null); setActiveSelection(null); return }
      const bubbleEl = (anchorNode.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode as Element
      )?.closest('.bubble.assistant')
      if (!bubbleEl) { setQuoteSelection(null); setActiveSelection(null); return }

      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) { setQuoteSelection(null); return }

      // Keep highlight alive by saving the selected text
      setActiveSelection(text)
      setQuoteSelection({
        text,
        top: rect.top - 44,
        left: rect.left + rect.width / 2,
      })
    }, 10)
  }

  const applyQuote = () => {
    if (!quoteSelection) return
    setQuotedText(quoteSelection.text)
    setQuoteSelection(null)
    setActiveSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const runStream = async (
    userQuestion: string,
    displayMessage: string,
    activeQuote: string | null,
    confirmWebSearch = false,
  ) => {
    setError('')
    setStreaming(true)
    startTimeRef.current = Date.now()

    setMessages((m) => [...m, { role: 'user', message: displayMessage }])
    setMessages((m) => [...m, { role: 'assistant', message: '' }])

    let pendingMode: ChatMode = 'rag'
    let pendingSources: Source[] = []
    let pendingWebSources: WebSource[] = []
    let pendingCached = false
    let pendingPromptTokens = 0
    let pendingCompletionTokens = 0
    let pendingLatencyMs = 0
    let assistant = ''
    let askedWebSearch = false

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(sessionId!, userQuestion, selectedMode, (event) => {
        if (event.type === 'intent') {
          pendingMode = event.mode
          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = { ...copy[copy.length - 1], mode: pendingMode }
            return copy
          })
        }
        if (event.type === 'cached') {
          pendingCached = event.is_cached
        }
        if (event.type === 'sources') pendingSources = event.sources
        if (event.type === 'web_sources') pendingWebSources = event.sources

        // ── Backend asks if user wants web search ──
        if (event.type === 'ask_web_search') {
          askedWebSearch = true
          const askMsg = event.message as string
          // Replace the assistant placeholder with the confirm prompt
          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = {
              role: 'assistant',
              message: '',
              askWebSearch: askMsg,
            }
            return copy
          })
          // Save context for when user answers
          setPendingWebConfirm({
            userMessage: userQuestion,
            userDisplay: displayMessage,
            quote: activeQuote,
          })
        }

        if (event.type === 'token' && event.content) {
          assistant += event.content
          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = {
              role: 'assistant',
              message: assistant,
              mode: pendingMode,
            }
            return copy
          })
        }
        if (event.type === 'done') {
          pendingPromptTokens = event.prompt_tokens ?? 0
          pendingCompletionTokens = event.completion_tokens ?? 0
          pendingCached = event.cached ?? false
          pendingLatencyMs = event.latency_ms ?? 0

          // Post-process web citations: replace [N] with clickable markdown links
          if (pendingWebSources.length > 0) {
            assistant = assistant.replace(/\[(\d+)\]/g, (_match, n: string) => {
              const idx = parseInt(n, 10) - 1
              if (idx >= 0 && idx < pendingWebSources.length) {
                return `[[${n}]](${pendingWebSources[idx].url})`
              }
              return `[${n}]`
            })
          }
        }
        if (event.type === 'error') setError(event.message ?? 'Chat error')
      }, activeQuote, controller.signal, confirmWebSearch)

      if (!askedWebSearch) {
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = {
            role: 'assistant',
            message: assistant,
            mode: pendingMode,
            sources: pendingSources.length ? pendingSources : undefined,
            webSources: pendingWebSources.length ? pendingWebSources : undefined,
            prompt_tokens: pendingPromptTokens,
            completion_tokens: pendingCompletionTokens,
            cached: pendingCached,
            latency_ms: pendingLatencyMs,
          }
          return copy
        })

        const data = await fetchMessages(sessionId!)
        setTitle(data.title)
        setMessages((current) => {
          const serverMsgs = data.messages
          if (!serverMsgs.length) return current
          const last = current[current.length - 1]
          const merged = [...serverMsgs]
          if (last?.role === 'assistant' && merged.length) {
            merged[merged.length - 1] = {
              ...merged[merged.length - 1],
              message: last.message,
              mode: last.mode,
              sources: last.sources,
              webSources: last.webSources,
              prompt_tokens: last.prompt_tokens,
              completion_tokens: last.completion_tokens,
              cached: last.cached,
              latency_ms: last.latency_ms,
            }
          }
          return merged
        })
      }
    } catch (e) {
      if (e instanceof DOMException && (e as DOMException).name === 'AbortError') {
        const newlineCount = (assistant.match(/\n/g) || []).length
        const charCount = assistant.trim().length

        if (newlineCount >= 4 || charCount >= 300) {
          const stoppedMsg = assistant.trimEnd() + '\n\n*[Response stopped by user]*'
          const elapsedMs = Date.now() - startTimeRef.current

          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = {
              role: 'assistant',
              message: stoppedMsg,
              mode: pendingMode,
              sources: pendingSources.length ? pendingSources : undefined,
              webSources: pendingWebSources.length ? pendingWebSources : undefined,
              prompt_tokens: pendingPromptTokens,
              completion_tokens: pendingCompletionTokens,
              latency_ms: elapsedMs,
            }
            return copy
          })

          try {
            await savePartialAssistant(
              sessionId!, stoppedMsg, pendingMode,
              pendingPromptTokens, pendingCompletionTokens, elapsedMs,
            )
          } catch {/* non-fatal */}
        } else {
          setMessages((m) => m.slice(0, -1))
        }
      } else {
        setError(String(e))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
      await refreshConversations()
    }
  }

  const handleSend = async () => {
    if (!input.trim() || streaming) return

    const userQuestion = input.trim()
    const activeQuote = quotedText

    setInput('')
    setQuotedText(null)
    setPendingWebConfirm(null)

    const displayMessage = activeQuote
      ? `> ${activeQuote}\n\n${userQuestion}`
      : userQuestion

    await runStream(userQuestion, displayMessage, activeQuote, false)
  }

  // User clicks "Yes, search the web"
  const handleConfirmWebSearch = async () => {
    if (!pendingWebConfirm) return
    const { userMessage, userDisplay, quote } = pendingWebConfirm
    setPendingWebConfirm(null)

    // Remove the confirm bubble (assistant placeholder)
    setMessages((m) => {
      const copy = [...m]
      // Remove last assistant bubble with askWebSearch
      if (copy[copy.length - 1]?.askWebSearch) copy.pop()
      // Remove the user message that triggered it too — will be re-added by runStream
      if (copy[copy.length - 1]?.role === 'user') copy.pop()
      return copy
    })

    // Re-run in web mode with confirm flag
    const prevMode = selectedMode
    setSelectedMode('web')
    await runStream(userMessage, userDisplay, quote, true)
    setSelectedMode(prevMode)
  }

  // User clicks "No thanks"
  const handleDeclineWebSearch = async () => {
    if (!pendingWebConfirm) return
    const { userMessage } = pendingWebConfirm
    setPendingWebConfirm(null)

    // Replace the confirm bubble with a "not in KB" message
    setMessages((m) => {
      const copy = [...m]
      if (copy[copy.length - 1]?.askWebSearch) {
        copy[copy.length - 1] = {
          role: 'assistant',
          message: `This topic doesn't appear to be covered in your knowledge base, and I won't search the web.\n\nIf you need current or external information, try switching to **Web** or **Hybrid** mode.`,
          mode: 'casual',
        }
      }
      return copy
    })

    // Save the decline message to DB so conversation history is correct
    try {
      await savePartialAssistant(
        sessionId!,
        `[User declined web search for: "${userMessage}"] This topic doesn't appear to be covered in your knowledge base, and I won't search the web.\n\nIf you need current or external information, try switching to **Web** or **Hybrid** mode.`,
        'casual', 0, 0, 0,
      )
    } catch {/* non-fatal */}

    await refreshConversations()
  }

  /* ── Status badge ── */
  const renderStatus = () => {
    if (!connectLoaded) return (
      <div className="status-pill warn">
        <div className="status-dot" />
        <span>Connecting…</span>
      </div>
    )
    if (!status && connectError) return (
      <div className="status-pill err">
        <div className="status-dot" />
        <span>Offline</span>
      </div>
    )
    if (!status) return null
    return (
      <div className={`status-pill ${status.ready ? 'ok' : 'warn'}`}>
        <div className="status-dot" />
        <span>{status.ready ? 'Ready' : 'Index missing'}</span>
        <span className="status-detail">{status.llm_model}</span>
      </div>
    )
  }


  /* ── Render ── */
  return (
    <>
      <div className="app">
        {/* ════ Sidebar ════ */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              className="sidebar"
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="sidebar-header">
                <div className="brand" onClick={onBack} title="Back to home">
                  <div className="brand-mark">
                    <span className="brand-mark-glyph">✦</span>
                  </div>
                  <div className="brand-text">
                    <h1>Jignasa</h1>
                    <p>PDF RAG Assistant</p>
                  </div>
                </div>

                {renderStatus()}

                <button id="btn-new-chat" className="btn-new-chat" onClick={handleNewChat}>
                  <Ic.Plus /> New conversation
                </button>
                <button
                  className="btn-home"
                  onClick={onBack}
                  title="Return to home page"
                >
                  ← Home
                </button>
                <button
                  id="btn-cost-calculator"
                  className="btn-cost-calc"
                  onClick={() => setShowCostModal(true)}
                  disabled={messages.length === 0}
                  title="Check total tokens and cost for this conversation"
                >
                  🪙 Token cost
                </button>
              </div>

              <div className="conv-section">
                {conversations.length > 0 && (
                  <div className="conv-section-label">History</div>
                )}
                {conversations.map((c) => (
                  <div key={c.session_id} className={`conv-item ${c.session_id === sessionId ? 'active' : ''}`}>
                    <button
                      id={`conv-${c.session_id}`}
                      className="conv-item-btn"
                      onClick={() => setSessionId(c.session_id)}
                    >
                      {c.title || 'New Chat'}
                    </button>
                    <div className="conv-actions">
                      <button
                        className="conv-action-btn"
                        onClick={() => handleRename(c.session_id, c.title || 'New Chat')}
                        title="Rename"
                      >
                        <Ic.Rename />
                      </button>
                      <button
                        className="conv-action-btn danger"
                        onClick={() => handleDelete(c.session_id)}
                        title="Delete"
                      >
                        <Ic.Trash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sidebar-footer">
                <div className="mode-legend">
                  <div className="legend-title">Answer modes</div>
                  <div className="legend-row"><span className="mode-badge badge-casual"><Ic.Sparkle />Chat</span><span>Casual conversation</span></div>
                  <div className="legend-row"><span className="mode-badge badge-rag"><Ic.Doc />PDF RAG</span><span>Document retrieval</span></div>
                  <div className="legend-row"><span className="mode-badge badge-web"><Ic.Globe />Web</span><span>Live web search</span></div>
                  <div className="legend-row"><span className="mode-badge badge-hybrid"><Ic.Globe />Hybrid</span><span>Combined PDF + Web</span></div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

          {/* ════ Main ════ */}
          <div className="main">
            {error && (
              <div className="error-banner" role="alert">
                <span>⚠</span>
                <span>{error}</span>
                <button className="error-banner-dismiss" onClick={() => setError('')}>✕</button>
              </div>
            )}

            <div className="chat-panel">
                {!connectLoaded && (
                  <div className="loading-overlay">
                    <div className="spinner" />
                    <p>{connectError || 'Starting up…'}</p>
                  </div>
                )}
                {connectLoaded && !status && connectError && (
                  <div className="loading-overlay">
                    <span style={{ fontSize: '2.5rem' }}>⚡</span>
                    <p style={{ color: 'var(--red)', textAlign: 'center', maxWidth: 320 }}>{connectError}</p>
                  </div>
                )}

                <div className="chat-header">
                  <div className="chat-title-group">
                    <button 
                      className="sidebar-toggle-btn" 
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                      title="Toggle Sidebar"
                    >
                      <Ic.Bar />
                    </button>
                    <span className="chat-title">{title}</span>
                    <button
                      className="chat-rename-btn"
                      onClick={() => handleRename(sessionId!, title)}
                      title="Rename Conversation"
                    >
                      <Ic.Rename />
                    </button>
                  </div>
                  {status && (
                    <span className="chat-meta">{status.llm_model}</span>
                  )}
                </div>

                {messages.length === 0 && !streaming ? (
                  <div className="empty-state">
                    <div className="empty-agent-ring">
                      <div className="empty-agent-icon">✦</div>
                    </div>
                    <h2>Ask about your documents</h2>
                    <p>
                      Automatically routes to <strong>PDF RAG</strong>, <strong>web search</strong>, or casual chat.
                      Query transformation improves retrieval quality.
                    </p>
                    <div className="prompt-chips">
                      {[
                        { icon: '👋', text: 'Hello!' },
                        { icon: '📄', text: 'Summarise the key findings' },
                        { icon: '🌐', text: 'What happened in AI today?' },
                        { icon: '🔍', text: 'What does the document say about…' },
                      ].map((chip) => (
                        <button
                          key={chip.text}
                          className="prompt-chip"
                          onClick={() => setInput(chip.text)}
                        >
                          <span className="chip-icon">{chip.icon}</span>
                          {chip.text}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`messages${activeSelection ? ' has-selection' : ''}`}
                    onMouseUp={handleTextSelection}
                  >
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={i}
                        msg={m}
                        isLast={i === messages.length - 1}
                        isStreaming={streaming}
                        onEdit={handleEditMessage}
                        onConfirmWeb={handleConfirmWebSearch}
                        onDeclineWeb={handleDeclineWebSearch}
                      />
                    ))}
                    <div ref={messagesEndRef} />

                    {/* Floating Quote Button */}
                    {quoteSelection && (
                      <button
                        className="floating-quote-btn"
                        style={{ top: quoteSelection.top, left: quoteSelection.left }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={applyQuote}
                        title="Quote selected text"
                      >
                        <Ic.Chat /> Quote
                      </button>
                    )}
                  </div>
                )}

                {/* Input */}
                <div className="chat-input-area">
                  <div className="chat-input-wrap">
                    <div className="mode-selector">
                      {([
                        ['auto',   'Auto'],
                        ['docs',   'Knowledge'],
                        ['web',    'Web'],
                        ['hybrid', 'Hybrid'],
                      ] as [ChatMode, string][]).map(([m, label]) => (
                        <button
                          key={m}
                          className={`mode-btn mode-btn-${m} ${selectedMode === m ? 'active' : ''}`}
                          onClick={() => setSelectedMode(m)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {quotedText && (
                      <div className="quoted-text-preview">
                        <div className="quoted-text-header">
                          <Ic.Chat /> Replying to quote
                          <button className="quote-clear-btn" onClick={() => setQuotedText(null)} title="Remove quote">✕</button>
                        </div>
                        <div className="quoted-text-content">{quotedText}</div>
                      </div>
                    )}

                    <div className="input-box">
                      <AutoTextarea
                        value={input}
                        onChange={setInput}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                        }}
                        placeholder="Ask anything — documents, web, or just chat…"
                        disabled={!status?.ready && connectLoaded}
                        maxLength={MAX_CHARS}
                      />
                      <button
                        id="btn-send"
                        className={`send-btn${streaming ? ' stop-btn' : ''}`}
                        onClick={streaming ? handleStop : handleSend}
                        disabled={!streaming && !input.trim()}
                        title={streaming ? 'Stop generation' : 'Send (Enter)'}
                      >
                        {streaming ? <Ic.Stop /> : <Ic.Send />}
                      </button>
                    </div>
                    <div className="input-footer">
                      <span className="input-hint">Enter to send · Shift+Enter for newline</span>
                      <span className={`char-count ${input.length > MAX_CHARS * 0.85 ? 'warn' : ''}`}>
                        {input.length}/{MAX_CHARS}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      {showCostModal && (
        <CostCalculatorModal
          messages={messages}
          onClose={() => setShowCostModal(false)}
        />
      )}
    </>
  )
}

