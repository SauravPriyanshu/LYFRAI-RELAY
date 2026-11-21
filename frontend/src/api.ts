import type { ChatResponse, HealthInfo } from './types'

const RAW = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'
export const API_BASE = RAW.replace(/\/+$/, '')

const REQUEST_TIMEOUT_MS = 90_000
const HEALTH_TIMEOUT_MS = 8_000

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Turns FastAPI's `detail` (string | list of {loc,msg}) into one readable sentence. */
export function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (d && typeof d === 'object') {
        const item = d as { loc?: unknown[]; msg?: unknown }
        const field = Array.isArray(item.loc) && item.loc.length ? String(item.loc[item.loc.length - 1]) : ''
        const msg = String(item.msg ?? 'invalid value').replace(/^Value error,\s*/i, '')
        return field && field !== 'body' ? `${field}: ${msg}` : msg
      }
      return String(d)
    })
    return parts.join('; ')
  }
  return ''
}

function friendly(status: number, detail: string): string {
  if (status === 422) return `Invalid request: ${detail || 'please check your message.'}`
  if (status === 503) return 'All AI providers are unavailable right now. Please try again in a moment.'
  if (status === 404) return detail || 'Not found.'
  if (status >= 500) return detail && detail !== 'internal server error' ? detail : 'The server hit an error. Please try again.'
  return detail || `Request failed (${status}).`
}

export interface SendArgs {
  sessionId: string
  message: string
  systemPrompt?: string
  simulate?: string
  signal?: AbortSignal
}

export async function sendChat({ sessionId, message, systemPrompt, simulate, signal }: SendArgs): Promise<ChatResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  const onUserAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      const err = new ApiError('Request canceled by user.', 0)
      err.name = 'AbortError'
      throw err
    }
    signal.addEventListener('abort', onUserAbort)
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (simulate) headers['X-Simulate-Failure'] = simulate
  const body: Record<string, string> = { session_id: sessionId, message }
  if (systemPrompt) body.system_prompt = systemPrompt

  let res: Response
  try {
    res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    if (signal?.aborted) {
      const err = new ApiError('Request canceled by user.', 0)
      err.name = 'AbortError'
      throw err
    }
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 0)
    }
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onUserAbort)
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body (e.g. proxy error page) */
  }

  if (!res.ok) {
    const detail = formatDetail((data as { detail?: unknown } | null)?.detail)
    throw new ApiError(friendly(res.status, detail), res.status)
  }

  const parsed = data as ChatResponse | null
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.metadata) {
    throw new ApiError('The server returned an unexpected response.', res.status)
  }
  const reqId = res.headers.get('x-request-id')
  if (reqId) {
    parsed.metadata.request_id = reqId
  }
  return parsed
}

export async function getHealth(): Promise<HealthInfo> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: controller.signal })
    if (!res.ok) {
      throw new ApiError(`Health check failed (${res.status})`, res.status)
    }
    return (await res.json()) as HealthInfo
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError('Backend unreachable', 0)
  } finally {
    clearTimeout(timer)
  }
}

export interface HistoryItem {
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, unknown>
}

export interface HistoryResponse {
  session_id: string
  messages: HistoryItem[]
}

export async function getHistory(sessionId: string): Promise<HistoryResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      signal: controller.signal,
    })
    if (res.status === 404) {
      throw new ApiError('session not found', 404)
    }
    if (!res.ok) {
      throw new ApiError(`Failed to load history (${res.status})`, res.status)
    }
    return (await res.json()) as HistoryResponse
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError('Cannot reach the server.', 0)
  } finally {
    clearTimeout(timer)
  }
}
