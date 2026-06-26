import type { ChatMode, Conversation, EvaluationSummaryResponse, Message, Source, Status, WebSource } from './types'

const API = '/api'

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

export async function fetchMessages(sessionId: string): Promise<{ title: string; messages: Message[] }> {
  const res = await fetch(`${API}/conversations/${sessionId}/messages`)
  return res.json()
}

export type ChatEvent =
  | { type: 'intent'; mode: ChatMode }
  | { type: 'cached'; is_cached: boolean }
  | { type: 'sources'; sources: Source[] }
  | { type: 'web_sources'; sources: WebSource[] }
  | { type: 'ask_web_search'; message: string }
  | { type: 'token'; content: string }
  | { type: 'done'; content: string; prompt_tokens?: number; completion_tokens?: number; cached?: boolean; latency_ms?: number }
  | { type: 'error'; message: string }

export async function streamChat(
  sessionId: string,
  message: string,
  mode: ChatMode,
  onEvent: (event: ChatEvent) => void,
  quotedText?: string | null,
  signal?: AbortSignal,
  confirmWebSearch?: boolean,
): Promise<void> {
  const res = await fetch(`${API}/conversations/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode,
      quoted_text: quotedText ?? null,
      confirm_web_search: confirmWebSearch ?? false,
    }),
    signal,
  })
  if (!res.ok) throw new Error(await res.text())
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
        onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      }
    }
  }
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

