import type { AgentStep, ChatMode, Conversation, EvaluationSummaryResponse, LLMSettings, MemoryItem, Message, Source, Status, WebSource } from './types'

const API = '/api'

// Deliberate, explicit action only -- never wired to a browser unload/close
// event, since a refresh fires the same event and would otherwise kill the
// whole app. Returns whether the backend actually went down, instead of
// just assuming the request succeeded -- a request that never reaches the
// server (already dead, wrong port) looks identical to a successful
// shutdown from inside a bare try/catch, which would tell the user
// "shut down" when nothing happened.
export async function shutdownApp(): Promise<boolean> {
  try {
    await fetch(`${API}/shutdown`, { method: 'POST' })
  } catch {
    // Expected on success: the server may drop the connection before
    // replying. Fall through to actually verifying it's gone.
  }
  // Poll the backend DIRECTLY, bypassing Vite's dev proxy: through the
  // proxy, a dead backend with a still-alive Vite process returns a real
  // HTTP 502 (fetch() does not throw on that -- same gotcha documented on
  // friendlyError() below), which the old version of this loop read as
  // "still running" and reported a false failure. A direct fetch to a dead
  // port always throws, so this is deterministic regardless of proxy
  // timing. CORS already allows any localhost port (see _CORS_ORIGIN_REGEX
  // in api/main.py), so this direct cross-port fetch isn't blocked.
  // 6 attempts at 750ms comfortably covers _terminate_self()'s 3s SIGKILL
  // escalation in api/main.py.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 750))
    try {
      const res = await fetch('http://127.0.0.1:8000/api/status', { signal: AbortSignal.timeout(1000) })
      if (!res.ok) return true // e.g. a stray 502/503 from something else on the port -- treat as down
      // Still answering -- not down yet, keep waiting.
    } catch {
      return true // confirmed unreachable
    }
  }
  return false // still responding after ~4.5s -- shutdown likely didn't work
}

// A dead/unreachable backend (terminal closed, process crashed, port
// conflict) surfaces two different ways depending on the path the request
// takes, and shows as an ugly raw string either way if left unclassified:
//   - A direct fetch() failure throws "TypeError: Failed to fetch" (Chrome),
//     "NetworkError when attempting to fetch resource." (Firefox), "Load
//     failed" (Safari).
//   - Through Vite's dev-server proxy specifically, fetch() does NOT throw
//     at all -- the proxy returns a real HTTP response with an empty body
//     and a 502/503/504 status, which consumeSSE() (this file) turns into
//     "Backend unreachable (502)". Verified this is the actual path hit in
//     local dev by killing the backend mid-session and inspecting the real
//     error, not guessed from browser docs alone.
export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  console.error(e)
  if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|Backend unreachable/i.test(raw)) {
    return "Can't reach the Jignasa backend. Make sure it's still running, then try again."
  }
  return 'Something went wrong. Please try again.'
}

// BYOK: stored client-side only, sent per-request to our own backend, never
// written to any database (api/main.py never passes it to db.append_message
// or set_cached -- see ChatRequest.llm_api_key in api/main.py).
const LLM_SETTINGS_KEY = 'jignasa_llm_settings'

export function getLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(LLM_SETTINGS_KEY)
    if (raw) return JSON.parse(raw) as LLMSettings
  } catch {
    // fall through to default
  }
  return { provider: 'ollama', apiKey: '' }
}

export function setLLMSettings(settings: LLMSettings): void {
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(settings))
}

export async function fetchStatus(): Promise<Status> {
  const res = await fetch(`${API}/status`)
  if (!res.ok) throw new Error('Failed to load status')
  return res.json()
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API}/conversations`)
  return res.json()
}

export async function createConversation(): Promise<Conversation> {
  const res = await fetch(`${API}/conversations`, { method: 'POST' })
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`${API}/conversations/${id}`, { method: 'DELETE' })
}

export async function truncateConversation(sessionId: string, messageId: number): Promise<void> {
  const res = await fetch(`${API}/conversations/${sessionId}/truncate/${messageId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await fetch(`${API}/conversations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export interface KBFile {
  name: string
  size_bytes: number
}

export async function getKnowledgeBaseFiles(): Promise<KBFile[]> {
  const res = await fetch(`${API}/knowledge-base/files`)
  if (!res.ok) throw new Error('Failed to fetch KB files')
  return res.json()
}

export interface OllamaModel {
  name: string
  size_bytes: number
}

export async function getOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${API}/ollama/models`)
  if (!res.ok) return []
  return res.json()
}

export async function deleteKnowledgeBaseFile(filename: string): Promise<void> {
  const res = await fetch(`${API}/knowledge-base/files/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete file')
}

export async function fetchMessages(sessionId: string): Promise<{ title: string; messages: Message[] }> {
  const res = await fetch(`${API}/conversations/${sessionId}/messages`)
  return res.json()
}

export async function fetchMemories(): Promise<MemoryItem[]> {
  const res = await fetch(`${API}/memory`)
  if (!res.ok) throw new Error('Failed to load memories')
  return res.json()
}

export async function deleteMemory(id: number): Promise<void> {
  const res = await fetch(`${API}/memory/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete memory')
}

export async function clearMemories(): Promise<void> {
  const res = await fetch(`${API}/memory`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to clear memories')
}

export type ChatEvent =
  | { type: 'intent'; mode: ChatMode }
  | { type: 'cached'; is_cached: boolean }
  | { type: 'sources'; sources: Source[] }
  | { type: 'web_sources'; sources: WebSource[]; degraded?: boolean }
  | ({ type: 'agent_step' } & AgentStep)
  | { type: 'token'; content: string }
  | { type: 'done'; content: string; prompt_tokens?: number; completion_tokens?: number; cached?: boolean; latency_ms?: number }
  | { type: 'error'; message: string }

/** Shared line-buffering reader for any `text/event-stream` response body. */
async function consumeSSE<E>(res: Response, onEvent: (event: E) => void): Promise<void> {
  if (!res.ok) {
    const text = await res.text()
    let detail: string | null = null
    try {
      const json = JSON.parse(text)
      if (json.detail) detail = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)
    } catch {
      // Not JSON, fall through -- detail stays null
    }
    if (detail) throw new Error(detail)
    // A dead backend doesn't always make fetch() itself throw -- Vite's dev
    // proxy (and some reverse proxies) instead return a real HTTP response
    // with an empty body and a gateway status (502/503/504) when it can't
    // reach the upstream server. An empty string here would otherwise
    // produce a blank/unhelpful error message.
    if ([502, 503, 504].includes(res.status)) {
      throw new Error(`Backend unreachable (${res.status})`)
    }
    throw new Error(text || `Request failed (${res.status})`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        onEvent(JSON.parse(line.slice(6)) as E)
      }
    }
  }
}

export async function streamChat(
  sessionId: string,
  message: string,
  mode: ChatMode,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const llm = getLLMSettings()
  const res = await fetch(`${API}/conversations/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode,
      llm_provider: llm.provider,
      llm_api_key: llm.apiKey || null,
      llm_model: llm.model || null,
    }),
    signal,
  })
  await consumeSSE(res, onEvent)
}

export type UploadEvent =
  | { type: 'start'; filename: string }
  | { type: 'parsing' }
  | { type: 'chunking' }
  | { type: 'parsed'; ok: boolean; message?: string }
  | { type: 'reindexing' }
  | { type: 'embedding' }
  | { type: 'storing' }
  | { type: 'done'; chunk_count: number }
  | { type: 'error'; message: string }

export async function uploadAndIndex(file: File, onEvent: (event: UploadEvent) => void): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API}/knowledge-base/upload`, { method: 'POST', body: formData })
  await consumeSSE(res, onEvent)
}

export async function fetchEvaluationSummary(): Promise<EvaluationSummaryResponse> {
  const res = await fetch(`${API}/evaluation/summary`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function savePartialAssistant(
  sessionId: string,
  message: string,
  mode: string,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
): Promise<void> {
  await fetch(`${API}/conversations/${sessionId}/partial-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      latency_ms: latencyMs,
    }),
  })
}

