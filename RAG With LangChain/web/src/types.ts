export type ChatMode = 'casual' | 'rag' | 'web' | 'hybrid' | 'auto'

export interface Status {
  ready: boolean
  chunk_count: number
  embedding_model: string
  llm_model: string
  top_k: number
  eval_type: string
  eval_description: string
}

export interface Conversation {
  session_id: string
  title: string
  created_at?: string
}

export interface Message {
  role: 'user' | 'assistant'
  message: string
  created_at?: string
  mode?: ChatMode
  sources?: Source[]
  webSources?: WebSource[]
  prompt_tokens?: number
  completion_tokens?: number
  cached?: boolean
}

export interface Source {
  rank: number
  score: number
  source: string | null
  page_number: number | null
  text: string
}

export interface WebSource {
  title: string
  url: string
  snippet: string
}

export interface EvalSummary {
  question_count: number
  k: number
  hit_at_k: number
  recall_at_k: number
  precision_at_k: number
  mrr_at_k: number
  ndcg_at_k: number
  evaluated_at: string
  elapsed_seconds: number
  eval_type: string
  eval_description: string
  uses_llm: boolean
}

export interface SavedEval {
  name: string
  label: string
  hit_at_k: number
  mrr_at_k: number
  recall_at_k: number
  saved_at: string
  elapsed_seconds?: number
  uses_llm?: boolean
  eval_type?: string
}

export interface EvalProgress {
  current: number
  total: number
  question: string
  hit: boolean
  expected_document: string
  top_source: string | null
  elapsed_seconds: number
}
