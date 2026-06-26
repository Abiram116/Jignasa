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
  id?: number
  role: 'user' | 'assistant'
  message: string
  created_at?: string
  prompt_tokens?: number
  completion_tokens?: number
  mode?: ChatMode
  sources?: Source[]
  webSources?: WebSource[]
  /** True when hybrid mode's web search failed and degraded to docs-only */
  webSearchDegraded?: boolean
  cached?: boolean
  latency_ms?: number
  /** Set when backend asks user whether to do a web search */
  askWebSearch?: string
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

export interface RagasSummary {
  question_count: number
  faithfulness: number
  answer_relevancy: number
  context_precision: number
  context_recall: number
  judge_llm: string
  embedding_model: string
  evaluated_at: string
}

export interface EvaluationSummaryResponse {
  retrieval: SavedEval | null
  ragas: RagasSummary | null
}
