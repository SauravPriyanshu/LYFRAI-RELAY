export type ResolutionSource = 'LIVE_INFERENCE' | 'LLM_CACHE'

export interface ChatMetadata {
  resolution_source?: ResolutionSource | string
  model?: string
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  key_id?: string | null
  fallback_attempts?: number
  attempts?: Array<{ key_id: string; outcome: string; reason?: string; model?: string }>
  original_latency_ms?: number | null
  request_id?: string
}

export interface RequestTraceInfo {
  message: string
  systemPromptUsed?: string
  simulateHeader?: string
  sessionId: string
  timestamp?: string
}

export interface ChatResponse {
  session_id: string
  reply: string
  metadata: ChatMetadata
}

export type ChatItem =
  | { id: string; role: 'user'; content: string }
  | {
    id: string
    role: 'assistant'
    content: string
    metadata?: Partial<ChatMetadata>
    request?: RequestTraceInfo
  }
  | { id: string; role: 'error'; content: string; retryText: string; status: number }
  | { id: string; role: 'info'; content: string }

export interface StoredSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  systemPrompt?: string
}

export type HealthStatus = 'connecting' | 'online' | 'offline'

export interface HealthInfo {
  keys_configured: number
  cache_enabled: boolean
  model?: string
  failure_simulation?: boolean
}
