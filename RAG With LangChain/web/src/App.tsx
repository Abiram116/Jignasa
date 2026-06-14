import { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  createConversation,
  deleteConversation,
  renameConversation,
  fetchConversations,
  fetchMessages,
  fetchSavedEvaluations,
  fetchStatus,
  saveEvaluation,
  streamChat,
  streamEvaluation,
  truncateConversation,
} from './api'
import type { ChatMode, Conversation, EvalProgress, EvalSummary, Message, SavedEval, Source, Status, WebSource } from './types'
import HomePage from './HomePage'
import './index.css'

type Tab = 'chat' | 'evaluation'

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

/* ── Markdown renderer ─────────────────────────────────────────────── */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        // Code blocks with syntax highlighting
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
        // Paragraphs
        p({ children }) { return <p className="md-p">{children}</p> },
        // Lists
        ul({ children }) { return <ul className="md-ul">{children}</ul> },
        ol({ children }) { return <ol className="md-ol">{children}</ol> },
        li({ children }) { return <li className="md-li">{children}</li> },
        // Headings
        h1({ children }) { return <h1 className="md-h1">{children}</h1> },
        h2({ children }) { return <h2 className="md-h2">{children}</h2> },
        h3({ children }) { return <h3 className="md-h3">{children}</h3> },
        // Bold & italic
        strong({ children }) { return <strong className="md-strong">{children}</strong> },
        em({ children }) { return <em className="md-em">{children}</em> },
        // Blockquotes
        blockquote({ children }) { return <blockquote className="md-blockquote">{children}</blockquote> },
        // Horizontal rule
        hr() { return <hr className="md-hr" /> },
        // Links
        a({ href, children }) {
          return <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

/* ── Message bubble ────────────────────────────────────────────────── */
function MessageBubble({
  msg, isLast, isStreaming, onEdit
}: {
  msg: Message
  isLast: boolean
  isStreaming: boolean
  onEdit?: (msg: Message) => void
}) {
  const isTyping = isLast && isStreaming && !msg.message && msg.role === 'assistant'

  return (
    <div className={`bubble-row ${msg.role}`}>
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
          ) : msg.role === 'assistant' ? (
            <MarkdownContent content={msg.message} />
          ) : (
            <div className="bubble-text">{msg.message}</div>
          )}
          {/* Sources — collapsed by default */}
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
              {msg.cached && (
                <>
                  <span className="token-sep">·</span>
                  <span className="cached-badge">Cached</span>
                </>
              )}
            </div>
            <div className="token-cost-row">
              <span>Cost (Est. GPT-4o): </span>
              <strong className="cost-val">
                ${((msg.prompt_tokens || 0) * 0.0000025 + (msg.completion_tokens || 0) * 0.00001).toFixed(5)}
              </strong>
            </div>
          </div>
        )}
        {msg.role === 'assistant' && msg.message && !isStreaming && (
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
    </div>
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
  const totalTokens = totalPrompt + totalCompletion

  const models = [
    { name: 'GPT-4o (Standard)',     inRate: 2.50,  outRate: 10.00 },
    { name: 'Claude 3.5 Sonnet',     inRate: 3.00,  outRate: 15.00 },
    { name: 'GPT-4o mini',           inRate: 0.15,  outRate: 0.60  },
    { name: 'Gemini 1.5 Flash',      inRate: 0.075, outRate: 0.30  },
    { name: 'Llama 3.1 70B (Groq)',  inRate: 0.59,  outRate: 0.79  },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Conversation Cost Calculator</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="cost-stats-grid">
            <div className="stat-card">
              <span className="stat-card-label">Input Tokens</span>
              <span className="stat-card-value">{totalPrompt.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">Output Tokens</span>
              <span className="stat-card-value">{totalCompletion.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">Total Tokens</span>
              <span className="stat-card-value">{totalTokens.toLocaleString()}</span>
            </div>
          </div>
          
          <div className="cost-table-wrap">
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Model Name</th>
                  <th style={{ textAlign: 'right' }}>Input Rate (per 1M)</th>
                  <th style={{ textAlign: 'right' }}>Output Rate (per 1M)</th>
                  <th style={{ textAlign: 'right' }}>Calculated Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const cost = (totalPrompt * m.inRate + totalCompletion * m.outRate) / 1_000_000
                  return (
                    <tr key={m.name}>
                      <td style={{ fontWeight: 'bold' }}>{m.name}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>${m.inRate.toFixed(3)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>${m.outRate.toFixed(3)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--ember-400)' }}>
                        ${cost < 0.00001 && cost > 0 ? cost.toFixed(7) : cost.toFixed(5)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="cost-note">
            * Rates are based on official pricing APIs as of 2024/2025. Compare this local model's token volume against typical production workloads to estimate cost before deploying to staging/prod.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   Main App
═══════════════════════════════════════════════════════════════════════ */
function App() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('chat')
  const [status, setStatus] = useState<Status | null>(null)
  const [loadingApp, setLoadingApp] = useState(true)
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
  const [quoteSelection, setQuoteSelection] = useState<{text: string, top: number, left: number} | null>(null)
  const [quotedText, setQuotedText] = useState<string | null>(null)

  const [evalK, setEvalK] = useState(5)
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalSummary, setEvalSummary] = useState<EvalSummary | null>(null)
  const [evalLog, setEvalLog] = useState<string[]>([])
  const [evalProgress, setEvalProgress] = useState<EvalProgress | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saved, setSaved] = useState<SavedEval[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const MAX_CHARS = 2000

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const refreshConversations = useCallback(async () => {
    setConversations(await fetchConversations())
  }, [])

  /* ── Bootstrap with retry ── */
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
        setSaved(await fetchSavedEvaluations())
        setLoadingApp(false)
        setConnectError('')
      } catch {
        if (cancelled) return
        if (attempt < MAX) {
          setConnectError(`Connecting… (${attempt + 1}/${MAX})`)
          setTimeout(() => tryConnect(attempt + 1), DELAY)
        } else {
          setConnectError('Cannot reach backend on port 8000. Is the API server running?')
          setLoadingApp(false)
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
      if (id === sessionId) {
        setTitle(newTitle.trim())
      }
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
    if ((e.target as Element).closest('.floating-quote-btn')) {
      return // Ignore mouseups on the quote button itself
    }
    
    const container = e.currentTarget as HTMLElement
    
    // Slight delay to ensure browser selection has settled
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setQuoteSelection(null)
        return
      }
      const text = selection.toString().trim()
      if (!text) {
        setQuoteSelection(null)
        return
      }
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      
      // Calculate position absolute relative to the .messages container
      setQuoteSelection({
        text,
        top: rect.top - containerRect.top + container.scrollTop - 40,
        left: rect.left - containerRect.left + container.scrollLeft + rect.width / 2
      })
    }, 10)
  }

  const applyQuote = () => {
    if (!quoteSelection) return
    setQuotedText(quoteSelection.text)
    setQuoteSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    
    // Construct final text with quote if present
    let finalPayload = input.trim()
    if (quotedText) {
      const formattedQuote = quotedText.split('\n').map(line => `> ${line}`).join('\n')
      finalPayload = `${formattedQuote}\n\n${finalPayload}`
    }
    
    setInput('')
    setQuotedText(null)
    setError('')
    setStreaming(true)

    // Optimistically add user message
    setMessages((m) => [...m, { role: 'user', message: finalPayload }])
    // Placeholder assistant bubble
    setMessages((m) => [...m, { role: 'assistant', message: '' }])

    let pendingMode: ChatMode = 'rag'
    let pendingSources: Source[] = []
    let pendingWebSources: WebSource[] = []
    let pendingCached = false
    let pendingPromptTokens = 0
    let pendingCompletionTokens = 0
    let assistant = ''

    try {
      await streamChat(sessionId!, finalPayload, selectedMode, (event) => {
        if (event.type === 'intent') {
          pendingMode = event.mode
          // Update placeholder bubble mode immediately
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
        }
        if (event.type === 'error') setError(event.message ?? 'Chat error')
      })

      // Finalise bubble with sources and tokens attached
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
        }
        return copy
      })

      const data = await fetchMessages(sessionId!)
      setTitle(data.title)
      // Re-sync messages from server but preserve source annotations and token stats on latest
      setMessages((current) => {
        const serverMsgs = data.messages
        if (!serverMsgs.length) return current
        const last = current[current.length - 1]
        const merged = [...serverMsgs]
        if (last?.role === 'assistant' && merged.length) {
          merged[merged.length - 1] = {
            ...merged[merged.length - 1],
            mode: last.mode,
            sources: last.sources,
            webSources: last.webSources,
            prompt_tokens: last.prompt_tokens,
            completion_tokens: last.completion_tokens,
            cached: last.cached,
          }
        }
        return merged
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setStreaming(false)
      await refreshConversations()
    }
  }

  const handleRunEval = async () => {
    setEvalRunning(true)
    setEvalLog([])
    setEvalSummary(null)
    setError('')
    try {
      await streamEvaluation(evalK, (event) => {
        if (event.type === 'start') setEvalLog((l) => [...l, `▶ ${event.message as string}`])
        if (event.type === 'progress') {
          const p = event as unknown as EvalProgress & { type: string }
          setEvalProgress(p)
          const line = `[${p.current}/${p.total}] ${p.hit ? '✓' : '✗'} expected=${p.expected_document} got=${p.top_source ?? 'none'} — ${p.question}`
          setEvalLog((l) => [...l, line])
        }
        if (event.type === 'complete') setEvalSummary(event.summary as EvalSummary)
        if (event.type === 'error') setError(event.message as string)
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setEvalRunning(false)
    }
  }

  const handleSaveEval = async () => {
    if (!saveName.trim()) return
    try {
      await saveEvaluation(saveName.trim(), evalK)
      setSaved(await fetchSavedEvaluations())
      setSaveName('')
    } catch (e) {
      setError(String(e))
    }
  }

  /* ── Status badge ── */
  const renderStatus = () => {
    if (loadingApp) return (
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
        <span>{status.ready ? `${status.chunk_count.toLocaleString()} chunks` : 'Index missing'}</span>
        <span className="status-detail">{status.llm_model}</span>
      </div>
    )
  }

  const isFirstLoad = useRef(true)

  /* ── Render ── */
  return (
    <Routes>
      <Route path="/" element={
        <HomePage 
          isFirstLoad={isFirstLoad.current}
          onEnter={() => {
            isFirstLoad.current = false
            navigate('/chat')
          }} 
        />
      } />
      <Route path="/chat" element={
        <div className="app">
          {/* ════ Sidebar ════ */}
          <aside className="sidebar">
            <div className="sidebar-header">
              {/* Brand */}
              <div className="brand" onClick={() => navigate('/')} title="Back to home">
            <div className="brand-mark">
              <span className="brand-mark-glyph">✦</span>
            </div>
            <div className="brand-text">
              <h1>Jignasa</h1>
              <p>PDF RAG Assistant</p>
            </div>
          </div>

          {/* Status pill */}
          {renderStatus()}

          <button id="btn-new-chat" className="btn-new-chat" onClick={handleNewChat}>
            <Ic.Plus /> New conversation
          </button>
          <button
            className="btn-home"
            onClick={() => navigate('/')}
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

        {/* Sidebar legend */}
        <div className="sidebar-footer">
          <div className="mode-legend">
            <div className="legend-title">Answer modes</div>
            <div className="legend-row"><span className="mode-badge badge-casual"><Ic.Sparkle />Chat</span><span>Casual conversation</span></div>
            <div className="legend-row"><span className="mode-badge badge-rag"><Ic.Doc />PDF RAG</span><span>Document retrieval</span></div>
            <div className="legend-row"><span className="mode-badge badge-web"><Ic.Globe />Web</span><span>Live web search</span></div>
            <div className="legend-row"><span className="mode-badge badge-hybrid"><Ic.Globe />Hybrid</span><span>Combined PDF + Web</span></div>
          </div>
        </div>
      </aside>

      {/* ════ Main ════ */}
      <div className="main">
        {/* Tab bar */}
        <div className="tabs">
          <button id="tab-chat" className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
            <Ic.Chat /> Chat
          </button>
          <button id="tab-evaluation" className={`tab ${tab === 'evaluation' ? 'active' : ''}`} onClick={() => setTab('evaluation')}>
            <Ic.Bar /> Evaluation
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner" role="alert">
            <span>⚠</span>
            <span>{error}</span>
            <button className="error-banner-dismiss" onClick={() => setError('')}>✕</button>
          </div>
        )}

        {/* ════ Chat tab ════ */}
        {tab === 'chat' && (
          <div className="chat-panel">
            {/* Loading overlay */}
            {loadingApp && (
              <div className="loading-overlay">
                <div className="spinner" />
                <p>{connectError || 'Starting up…'}</p>
              </div>
            )}
            {!loadingApp && !status && connectError && (
              <div className="loading-overlay">
                <span style={{ fontSize: '2.5rem' }}>⚡</span>
                <p style={{ color: 'var(--red)', textAlign: 'center', maxWidth: 320 }}>{connectError}</p>
              </div>
            )}

            {/* Chat header */}
            <div className="chat-header">
              <div className="chat-title-group">
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
                <span className="chat-meta">
                  {status.chunk_count.toLocaleString()} chunks · {status.llm_model}
                </span>
              )}
            </div>

            {/* Messages */}
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
              <div className="messages" onMouseUp={handleTextSelection}>
                {messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    msg={m}
                    isLast={i === messages.length - 1}
                    isStreaming={streaming}
                    onEdit={handleEditMessage}
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
                {/* Mode Selector */}
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
                      disabled={streaming}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                
                {/* Quoted Text Preview Box */}
                {quotedText && (
                  <div className="quoted-text-preview">
                    <div className="quoted-text-header">
                      <Ic.Chat /> Replying to quote
                      <button className="quote-clear-btn" onClick={() => setQuotedText(null)} title="Remove quote">✕</button>
                    </div>
                    <div className="quoted-text-content">{quotedText}</div>
                  </div>
                )}
                
                <div className={`input-box ${streaming ? 'disabled' : ''}`}>
                  <AutoTextarea
                    value={input}
                    onChange={setInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                    }}
                    placeholder="Ask anything — documents, web, or just chat…"
                    disabled={streaming || (!status?.ready && !loadingApp)}
                    maxLength={MAX_CHARS}
                  />
                  <button
                    id="btn-send"
                    className="send-btn"
                    onClick={handleSend}
                    disabled={streaming || !input.trim()}
                    title="Send (Enter)"
                  >
                    {streaming
                      ? <div className="send-spinner" />
                      : <Ic.Send />
                    }
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
        )}

        {/* ════ Evaluation tab ════ */}
        {tab === 'evaluation' && (
          <div className="eval-panel">
            <h2>Retrieval Evaluation</h2>

            <div className="info-box">
              <strong>Fast, LLM-free evaluation.</strong> Embeds each test question, searches FAISS top-k,
              and checks if the expected PDF appears in results. No Ollama call is made — this benchmarks
              retrieval quality only.
            </div>

            <div className="eval-controls">
              <label htmlFor="eval-k">
                Top-k
                <input
                  id="eval-k"
                  type="number"
                  min={1}
                  max={10}
                  value={evalK}
                  onChange={(e) => setEvalK(Number(e.target.value))}
                />
              </label>
              <button
                id="btn-run-eval"
                className="btn btn-primary"
                onClick={handleRunEval}
                disabled={evalRunning || !status?.ready}
              >
                {evalRunning ? '⏳ Running…' : '▶ Run evaluation'}
              </button>
              {evalRunning && evalProgress && (
                <div className="eval-progress-info">
                  {evalProgress.current}/{evalProgress.total} · {evalProgress.elapsed_seconds}s
                </div>
              )}
            </div>

            {evalLog.length > 0 && (
              <div className="progress-log">
                {evalLog.map((line, i) => (
                  <div
                    key={i}
                    className={`progress-line ${line.includes('✓') ? 'hit' : line.includes('✗') ? 'miss' : ''}`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}

            {evalSummary && (
              <>
                <div className="metrics-grid">
                  {([
                    ['Hit @ k',       `${(evalSummary.hit_at_k * 100).toFixed(1)}%`],
                    ['MRR @ k',       evalSummary.mrr_at_k.toFixed(3)],
                    ['Recall @ k',    `${(evalSummary.recall_at_k * 100).toFixed(1)}%`],
                    ['Precision @ k', evalSummary.precision_at_k.toFixed(3)],
                    ['nDCG @ k',      evalSummary.ndcg_at_k.toFixed(3)],
                    ['Time',          `${evalSummary.elapsed_seconds}s`],
                  ] as [string, string][]).map(([label, value]) => (
                    <div className="metric-card" key={label}>
                      <div className="label">{label}</div>
                      <div className="value">{value}</div>
                    </div>
                  ))}
                </div>

                <p className="eval-meta">
                  {evalSummary.question_count} questions · k={evalSummary.k} · {evalSummary.evaluated_at} ·{' '}
                  <em>{evalSummary.eval_type} (LLM: {evalSummary.uses_llm ? 'yes' : 'no'})</em>
                </p>

                <div className="save-row">
                  <input
                    id="save-name-input"
                    placeholder="Name this snapshot (e.g. v1, baseline)…"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button
                    id="btn-save-eval"
                    className="btn btn-primary"
                    onClick={handleSaveEval}
                    disabled={!saveName.trim()}
                  >
                    Save snapshot
                  </button>
                </div>
              </>
            )}

            {saved.length > 0 && (
              <div className="saved-section">
                <h3>Saved runs</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th>Hit @ k</th><th>MRR @ k</th>
                      <th>Recall @ k</th><th>Time</th><th>Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...saved].reverse().map((r) => (
                      <tr key={r.name}>
                        <td>{r.label || r.name}</td>
                        <td>{(r.hit_at_k * 100).toFixed(1)}%</td>
                        <td>{r.mrr_at_k.toFixed(3)}</td>
                        <td>{(r.recall_at_k * 100).toFixed(1)}%</td>
                        <td>{r.elapsed_seconds != null ? `${r.elapsed_seconds}s` : '—'}</td>
                        <td>{r.saved_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {showCostModal && (
        <CostCalculatorModal
          messages={messages}
          onClose={() => setShowCostModal(false)}
        />
      )}
    </div>
      } />
    </Routes>
  )
}

export default App
