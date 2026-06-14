import type { ChatMode, Conversation, EvalProgress, EvalSummary, Message, SavedEval, Source, Status, WebSource } from './types'

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
  | { type: 'token'; content: string }
  | { type: 'done'; content: string; prompt_tokens?: number; completion_tokens?: number; cached?: boolean }
  | { type: 'error'; message: string }

export async function streamChat(
  sessionId: string,
  message: string,
  mode: ChatMode,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const res = await fetch(`${API}/conversations/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mode }),
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

export async function streamEvaluation(
  k: number,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch(`${API}/evaluation/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ k }),
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
        onEvent(JSON.parse(line.slice(6)))
      }
    }
  }
}

export async function fetchSavedEvaluations(): Promise<SavedEval[]> {
  const res = await fetch(`${API}/evaluation/saved`)
  return res.json()
}

export async function saveEvaluation(name: string, k: number): Promise<SavedEval> {
  const res = await fetch(`${API}/evaluation/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, k }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export type { EvalSummary, EvalProgress }
