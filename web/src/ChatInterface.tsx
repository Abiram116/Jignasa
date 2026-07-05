import { useEffect, useRef, useState } from 'react'
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
  friendlyError,
  getLLMSettings,
  setLLMSettings,
  savePartialAssistant,
  streamChat,
  truncateConversation,
} from './api'
import type { AgentStep, ChatMode, LLMSettings, Message, Source, WebSource } from './types'
import { useAppState } from './AppContext'
import { EditMessageModal } from './EditMessageModal'
import { MemoryModal } from './MemoryModal'
import { SettingsModal } from './SettingsModal'
import { SidebarUploadView, useUploadQueue } from './SidebarUploadView'
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
  PanelToggle: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5"/>
      <line x1="9.5" y1="4" x2="9.5" y2="20"/>
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
  ArrowLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
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
        {sources.map((s, i) => (
          // Not just s.rank: hybrid mode or multiple tool iterations with
          // different queries can retrieve overlapping chunks that end up
          // with the same rank in this list -- a duplicate key means React
          // silently drops or mis-renders one of the cards.
          <div key={`${s.source}-${s.page_number}-${i}`} className="source-card">
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

/* ── Agent trace panel (Stage 1 ReAct loop) ─────────────────────────
   `live`: expanded, no toggle, rendered while the loop is still running.
   Historical: same step markup, collapsed by default behind a toggle --
   reuses the RagSources/WebSources accordion classes. ── */
function AgentTrace({ steps, live = false }: { steps: AgentStep[]; live?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null

  const toolLabel = (tool?: string) =>
    tool === 'rag_search' ? 'Searching documents' : tool === 'web_search' ? 'Searching the web' : ''

  const body = (
    <div className={live ? 'agent-trace-live' : `sources-body ${open ? 'expanded' : 'collapsed'}`}>
      {steps.map((s, i) => (
        <div key={i} className={`agent-trace-step ${s.stage}`}>
          <span className="agent-trace-icon">
            {s.stage === 'observation' ? <Ic.Doc /> : <Ic.Sparkle />}
          </span>
          <div>
            {s.stage === 'tool_call' && (
              <>
                <div className="agent-trace-title">{toolLabel(s.tool)}: <em>{s.detail}</em></div>
                {s.reasoning && <div className="agent-trace-reasoning">{s.reasoning}</div>}
              </>
            )}
            {s.stage === 'observation' && <div className="agent-trace-title">{s.detail}</div>}
            {s.stage === 'answering' && <div className="agent-trace-title">Composing answer…</div>}
          </div>
        </div>
      ))}
    </div>
  )

  if (live) {
    return <div className="sources-container agent-trace-container">{body}</div>
  }

  return (
    <div className="sources-container agent-trace-container">
      <button className={`sources-toggle agent ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="sources-toggle-left">
          <Ic.Sparkle />
          <span>Thought for {steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        </span>
        <span className={`chevron ${open ? 'up' : ''}`}><Ic.ChevDown /></span>
      </button>
      {body}
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
    </div>
  )
}


/* ── Message bubble ────────────────────────────────────────────────── */
function MessageBubble({
  msg, isLast, isStreaming, onEdit,
}: {
  msg: Message
  isLast: boolean
  isStreaming: boolean
  onEdit?: (msg: Message) => void
}) {
  const hasLiveTrace = isLast && isStreaming && msg.role === 'assistant' && !!msg.agentTrace?.length
  const isTyping = isLast && isStreaming && !msg.message && msg.role === 'assistant' && !hasLiveTrace
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
          {hasLiveTrace && !msg.message ? (
            // Decision/tool-call phase happens before any token streams --
            // shows live in place of the blank "Thinking…" spinner.
            <AgentTrace steps={msg.agentTrace!} live />
          ) : isTyping ? (
            <div className="agent-thinking">
              <div className="thinking-dots"><span /><span /><span /></div>
              <span>Thinking…</span>
            </div>
          ) : isStreamingContent ? (
            <>
              {/* Once tokens start arriving, the live trace collapses into
                  an accordion above the streaming answer. */}
              {hasLiveTrace && <AgentTrace steps={msg.agentTrace!} />}
              <MarkdownContent content={msg.message} isStreaming={true} />
            </>
          ) : msg.role === 'assistant' ? (
            <>
              {msg.agentTrace && msg.agentTrace.length > 0 && !isStreaming && (
                <AgentTrace steps={msg.agentTrace} />
              )}
              {msg.sources && msg.sources.length > 0 && !isStreaming && (
                <RagSources sources={msg.sources} defaultOpen={false} />
              )}
              {msg.webSources && msg.webSources.length > 0 && !isStreaming && (
                <WebSources sources={msg.webSources} defaultOpen={false} />
              )}
              {msg.webSearchDegraded && !isStreaming && (
                <div className="web-degraded-note">
                  ⚠ Web search failed for this response — answer used document context only.
                </div>
              )}
              <MarkdownContent content={msg.message} />
            </>
          ) : (
            <div className="bubble-text">{msg.message}</div>
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
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
  const {
    connectLoaded,
    connectError,
    status,
    conversations,
    setConversations,
    sessionId,
    setSessionId,
    refreshConversations,
    refreshStatus,
  } = useAppState()

  // App initialization states
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  const [selectedMode, setSelectedMode] = useState<ChatMode>('auto')
  const [showCostModal, setShowCostModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showMemoryModal, setShowMemoryModal] = useState(false)
  const [sidebarView, setSidebarView] = useState<'chats' | 'upload'>('chats')

  // Inline conversation-title editing (sidebar + top bar) -- replaces the
  // old window.prompt() dialog. `editingConvId` is the session_id currently
  // showing an <input>, in either surface.
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  
  const { queue, activeStages, addFiles } = useUploadQueue(() => {
    refreshStatus()
  })

  const [llmSettings, setLlmSettingsState] = useState<LLMSettings>(() => getLLMSettings())

  const [title, setTitle] = useState('New Chat')
  const [messages, setMessages] = useState<Message[]>([])
  // Distinguishes "genuinely empty/new conversation" from "messages array
  // is momentarily [] because we're mid-fetch after switching chats" --
  // without this, messages.length === 0 is true in both cases and the
  // empty-state prompts flash briefly for old conversations too.
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)

  const MAX_CHARS = 2000

  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container
      // If we are within 150px of the bottom, or if we just stopped streaming/loaded new messages
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150
      if (isNearBottom || !streaming) {
        messagesEndRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' })
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' })
    }
  }, [messages, streaming])

  useEffect(() => {
    if (!sessionId) return
    fetchMessages(sessionId)
      .then((data) => {
        setTitle(data.title || 'New Chat')
        setMessages(data.messages)
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setMessagesLoading(false))
  }, [sessionId])

  const handleNewChat = async () => {
    setSessionId('')
    setMessages([])
    setTitle('New Chat')
  }

  // Click-to-arm confirm, same pattern used for Quit/Clear-all memories --
  // one accidental click used to permanently delete a conversation with no
  // way back.
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null)
  const deleteArmTimeoutRef = useRef<number | null>(null)
  useEffect(() => () => { if (deleteArmTimeoutRef.current) window.clearTimeout(deleteArmTimeoutRef.current) }, [])

  const handleDelete = async (id: string) => {
    if (deleteArmedId !== id) {
      setDeleteArmedId(id)
      if (deleteArmTimeoutRef.current) window.clearTimeout(deleteArmTimeoutRef.current)
      deleteArmTimeoutRef.current = window.setTimeout(() => setDeleteArmedId(null), 4000)
      return
    }
    if (deleteArmTimeoutRef.current) window.clearTimeout(deleteArmTimeoutRef.current)
    setDeleteArmedId(null)
    await deleteConversation(id)
    const list = await fetchConversations()
    setConversations(list)
    if (id === sessionId) {
      if (list.length) setSessionId(list[0].session_id)
      else await handleNewChat()
    }
  }

  // Inline rename: click the title (sidebar or top bar) to edit it in
  // place -- Enter or clicking away saves, Escape cancels. No dialog.
  //
  // The setEditingConvId call is deferred to its own macrotask rather than
  // running directly in the click handler: React 19 flushes a click's state
  // update synchronously (it's a discrete event), so the <span>-to-<input>
  // swap happens inside the same call stack as the click's own dispatch.
  // That triggers React's commitMount for the new host node while the
  // original click event is still being processed, which synchronously
  // fires a blur back through this same input -- closing the editor before
  // it's ever visible. Deferring the state change with setTimeout(0) lets
  // the original click event finish completely first, so the input mounts
  // in a clean, later turn with no spurious blur.
  const startEditingTitle = (id: string, currentTitle: string) => {
    setTimeout(() => {
      setEditingConvId(id)
      setEditingTitleValue(currentTitle)
    }, 0)
  }

  const cancelEditingTitle = () => setEditingConvId(null)

  const commitEditingTitle = async () => {
    const id = editingConvId
    if (!id) return
    setEditingConvId(null)
    const newTitle = editingTitleValue.trim()
    if (!newTitle) return
    try {
      await renameConversation(id, newTitle)
      await refreshConversations()
      if (id === sessionId) setTitle(newTitle)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const titleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEditingTitle() }
  }

  // Edit is a popup modal, not the old inline prefill-the-input flow: click
  // Edit -> this just opens the modal with the message text; the modal's
  // own Save/Cancel buttons are the confirmation, so there's no separate
  // click-to-arm step needed on the button itself anymore.
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)

  const handleEditMessage = (msg: Message) => {
    if (streaming) return
    if (!msg.id) {
      setError("Can't edit this message yet — it hasn't finished saving. Try again in a moment.")
      return
    }
    setEditingMessage(msg)
  }

  const handleConfirmEditMessage = async (newText: string) => {
    const msg = editingMessage
    if (!msg || !sessionId || !msg.id) return
    setEditingMessage(null)
    try {
      await truncateConversation(sessionId, msg.id)
      setMessages(messages.slice(0, messages.findIndex((m) => m.id === msg.id)))
      await runStream(sessionId, newText)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const runStream = async (targetSessionId: string, userQuestion: string) => {
    setError('')
    setStreaming(true)
    startTimeRef.current = Date.now()

    setMessages((m) => [...m, { role: 'user', message: userQuestion }])
    setMessages((m) => [...m, { role: 'assistant', message: '' }])

    let pendingMode: ChatMode = 'rag'
    let pendingSources: Source[] = []
    let pendingWebSources: WebSource[] = []
    let pendingWebDegraded = false
    let pendingCached = false
    let pendingPromptTokens = 0
    let pendingCompletionTokens = 0
    let pendingLatencyMs = 0
    let pendingAgentTrace: AgentStep[] = []
    let assistant = ''

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(targetSessionId, userQuestion, selectedMode, (event) => {
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
        if (event.type === 'web_sources') {
          pendingWebSources = event.sources
          pendingWebDegraded = !!event.degraded
        }
        if (event.type === 'agent_step') {
          pendingAgentTrace = [...pendingAgentTrace, {
            stage: event.stage,
            tool: event.tool,
            reasoning: event.reasoning,
            detail: event.detail,
            elapsed_ms: event.elapsed_ms,
          }]
          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = { ...copy[copy.length - 1], agentTrace: pendingAgentTrace }
            return copy
          })
        }

        if (event.type === 'token' && event.content) {
          assistant += event.content
          setMessages((m) => {
            const copy = [...m]
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
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

          // The backend now applies [N] -> [[N]](url) citation linking
          // server-side before caching/persisting (so it survives reloads,
          // not just the live stream). event.content is that authoritative
          // final text -- swap it in for the raw token-accumulated string.
          if (event.content) assistant = event.content
        }
        if (event.type === 'error') setError(event.message ?? 'Chat error')
      }, controller.signal)


        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = {
            role: 'assistant',
            message: assistant,
            mode: pendingMode,
            sources: pendingSources.length ? pendingSources : undefined,
            webSources: pendingWebSources.length ? pendingWebSources : undefined,
            webSearchDegraded: pendingWebDegraded,
            prompt_tokens: pendingPromptTokens,
            completion_tokens: pendingCompletionTokens,
            cached: pendingCached,
            latency_ms: pendingLatencyMs,
            agentTrace: pendingAgentTrace.length ? pendingAgentTrace : undefined,
          }
          return copy
        })

        const data = await fetchMessages(targetSessionId)
        setTitle(data.title)
        setMessages((current) => {
          const serverMsgs = data.messages
          if (!serverMsgs.length) return current
          return [...serverMsgs]
        })
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
              agentTrace: pendingAgentTrace.length ? pendingAgentTrace : undefined,
            }
            return copy
          })

          try {
            await savePartialAssistant(
              targetSessionId, stoppedMsg, pendingMode,
              pendingPromptTokens, pendingCompletionTokens, elapsedMs,
            )
          } catch {/* non-fatal */}
        } else {
          setMessages((m) => m.slice(0, -1))
        }
      } else {
        setError(friendlyError(e))
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
    setInput('')

    let targetSessionId = sessionId
    if (!targetSessionId) {
      const c = await createConversation()
      targetSessionId = c.session_id
      setSessionId(targetSessionId)
      await refreshConversations()
    }

    await runStream(targetSessionId, userQuestion)
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
    // status.llm_model is the backend's calibrated reasoning-loop model,
    // which is NOT necessarily what's answering -- it stays fixed
    // regardless of what the user picks here (see api/llm.py). Showing it
    // as if it were "the active model" was actively misleading whenever
    // someone picked a different Ollama model or a BYOK provider. Derive
    // the label from the user's own actual selection instead, and show
    // nothing rather than guess when they're on the unconfigured default.
    const modelLabel = llmSettings.provider === 'ollama' ? llmSettings.model : (llmSettings.model || llmSettings.provider)
    return (
      <>
        <div className={`status-pill ${status.ready ? 'ok' : 'warn'}`}>
          <div className="status-dot" />
          <span>{status.ready ? 'Ready' : 'Index missing'}</span>
          {modelLabel && <span className="status-detail">{modelLabel}</span>}
        </div>
        {status.ollama && !status.ollama.reachable && (
          <p className="cost-note" style={{ color: 'var(--coral-400)', margin: '0.4rem 0 0' }}>
            Can't reach Ollama at {status.ollama.host} — is it running?{' '}
            WSL users: see README.md.
          </p>
        )}
      </>
    )
  }


  /* ── Render ── */
  return (
    <>
      <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}`}>
        {/* ════ Sidebar ════ */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              className="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{ overflow: 'hidden' }}
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

                <div className="sidebar-toolbar">
                  <button
                    id="btn-cost-calculator"
                    className="toolbar-icon-btn"
                    onClick={() => setShowCostModal(true)}
                    disabled={messages.length === 0}
                    title="Token cost calculator"
                  >
                    🪙
                  </button>
                  <button
                    id="btn-llm-settings"
                    className="toolbar-icon-btn"
                    onClick={() => setShowSettingsModal(true)}
                    title={llmSettings.provider === 'ollama' ? 'Model: Local (Ollama)' : `Model: ${llmSettings.provider} (BYOK)`}
                  >
                    ⚙️
                  </button>
                  <button
                    id="btn-memory"
                    className="toolbar-icon-btn"
                    onClick={() => setShowMemoryModal(true)}
                    title="What Jignasa remembers about you"
                  >
                    🧠
                  </button>
                </div>

                <button
                  id="btn-upload-kb"
                  className="btn-cost-calc"
                  onClick={() => setSidebarView('upload')}
                  title="Add a PDF to your knowledge base"
                >
                  📄 Add document
                </button>
              </div>

              <AnimatePresence mode="wait">
                {sidebarView === 'chats' ? (
                  <motion.div
                    key="chats"
                    className="conv-section"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    {conversations.length > 0 && (
                      <div className="conv-section-label">History</div>
                    )}
                    {conversations.map((c) => (
                      <div key={c.session_id} className={`conv-item ${c.session_id === sessionId ? 'active' : ''}`}>
                        {editingConvId === c.session_id ? (
                          <input
                            ref={(el) => {
                              // Not `autoFocus`: React 19 flushes the click
                              // that opens this input synchronously, so
                              // autoFocus's own commit-phase .focus() call
                              // fires (and immediately blurs) within that
                              // same tick -- the input would close itself
                              // before ever becoming visible. Deferring to
                              // a macrotask focuses it after that flush.
                              if (el) setTimeout(() => { el.focus(); el.select() }, 0)
                            }}
                            className="title-edit-input conv-title-edit-input"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={titleEditKeyDown}
                            onBlur={commitEditingTitle}
                          />
                        ) : (
                          <button
                            id={`conv-${c.session_id}`}
                            className="conv-item-btn"
                            onClick={() => {
                              // Re-clicking the already-open conversation must
                              // be a no-op: setSessionId(same value) doesn't
                              // change state, so the effect that reloads
                              // messages and clears messagesLoading below
                              // never re-fires -- without this guard, the
                              // chat gets stuck showing a blank loading
                              // placeholder with messages permanently [].
                              if (c.session_id === sessionId) return
                              setMessagesLoading(true)
                              setMessages([])
                              setSessionId(c.session_id)
                            }}
                            onDoubleClick={() => startEditingTitle(c.session_id, c.title || 'New Chat')}
                          >
                            {c.title || 'New Chat'}
                          </button>
                        )}
                        <div className="conv-actions">
                          {editingConvId === c.session_id ? (
                            <button
                              className="conv-action-btn"
                              onMouseDown={(e) => { e.preventDefault(); commitEditingTitle(); }}
                              title="Save"
                            >
                              <Ic.Check />
                            </button>
                          ) : (
                            <button
                              className="conv-action-btn"
                              onClick={() => startEditingTitle(c.session_id, c.title || 'New Chat')}
                              title="Rename"
                            >
                              <Ic.Rename />
                            </button>
                          )}
                          <button
                            className={`conv-action-btn danger${deleteArmedId === c.session_id ? ' confirm-armed' : ''}`}
                            onClick={() => handleDelete(c.session_id)}
                            title={deleteArmedId === c.session_id ? 'Click again to confirm delete' : 'Delete'}
                          >
                            <Ic.Trash />
                          </button>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="upload"
                    className="conv-section upload-section"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <SidebarUploadView
                      onBack={() => setSidebarView('chats')}
                      queue={queue}
                      activeStages={activeStages}
                      addFiles={addFiles}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {sidebarView === 'chats' && (
                  <motion.div 
                    className="sidebar-footer"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <div className="mode-legend">
                      <div className="legend-title">Answer modes</div>
                      <div className="legend-row">
                        <span className="mode-badge badge-casual"><Ic.Sparkle />Chat</span>
                        <span>Casual conversation</span>
                      </div>
                      <div className="legend-row">
                        <span className="mode-badge badge-rag"><Ic.Doc />PDF RAG</span>
                        <span>Document retrieval</span>
                      </div>
                      <div className="legend-row">
                        <span className="mode-badge badge-web"><Ic.Globe />Web</span>
                        <span>Live web search</span>
                      </div>
                      <div className="legend-row">
                        <span className="mode-badge badge-hybrid"><Ic.Globe />Hybrid</span>
                        <span>Combined PDF + Web</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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
                      className="home-icon-btn"
                      onClick={onBack}
                      title="Back to home"
                    >
                      <Ic.ArrowLeft />
                    </button>
                    <button
                      className="sidebar-toggle-btn"
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                      title="Toggle Sidebar"
                    >
                      <Ic.PanelToggle />
                    </button>
                    {editingConvId === sessionId ? (
                      <>
                        <input
                          ref={(el) => {
                            if (el) setTimeout(() => { el.focus(); el.select() }, 0)
                          }}
                          className="title-edit-input"
                          value={editingTitleValue}
                          onChange={(e) => setEditingTitleValue(e.target.value)}
                          onKeyDown={titleEditKeyDown}
                          onBlur={commitEditingTitle}
                        />
                        <button
                          className="chat-rename-btn"
                          onMouseDown={(e) => { e.preventDefault(); commitEditingTitle(); }}
                          title="Save"
                        >
                          <Ic.Check />
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="chat-title"
                          onClick={() => sessionId && startEditingTitle(sessionId, title)}
                          title="Click to rename"
                        >
                          {title}
                        </span>
                        <button
                          className="chat-rename-btn"
                          onClick={() => sessionId && startEditingTitle(sessionId, title)}
                          title="Rename Conversation"
                        >
                          <Ic.Rename />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {messagesLoading ? (
                  <div className="messages-loading-placeholder" />
                ) : messages.length === 0 && !streaming ? (
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
                    key={sessionId}
                    ref={messagesContainerRef}
                    className="messages"
                  >
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={`${sessionId}-${i}`}
                        msg={m}
                        isLast={i === messages.length - 1}
                        isStreaming={streaming}
                        onEdit={handleEditMessage}
                      />
                    ))}
                    <div ref={messagesEndRef} />
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
                      <div className="ai-disclaimer">
                        Jignasa is an AI and can make mistakes. Always check the sources.
                      </div>
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
      {showSettingsModal && (
        <SettingsModal
          settings={llmSettings}
          onSave={(s) => { setLLMSettings(s); setLlmSettingsState(s) }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
      {showMemoryModal && (
        <MemoryModal onClose={() => setShowMemoryModal(false)} />
      )}
      {editingMessage && (
        <EditMessageModal
          message={editingMessage.message}
          onSave={handleConfirmEditMessage}
          onClose={() => setEditingMessage(null)}
        />
      )}
    </>
  )
}

