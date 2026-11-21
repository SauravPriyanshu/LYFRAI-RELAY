import type { ChatMetadata } from './types'

export interface TraceStep {
  key_id: string
  outcome: 'ok' | 'failed' | 'cache'
  reason: string
  model?: string
}

export function mapReason(rawReason?: string, outcome?: string): string {
  if (outcome === 'cache') return 'no provider called'
  if (outcome === 'ok') return 'Success'
  if (!rawReason) return 'Call failed'

  if (rawReason === 'simulated_429') return 'Simulated rate limit (429)'
  if (rawReason === 'RateLimitError 429' || rawReason.includes('429') || /ratelimit/i.test(rawReason)) {
    return 'Provider rate limit'
  }
  if (rawReason === 'Timeout' || /timeout/i.test(rawReason)) return 'Timed out'
  if (rawReason === 'empty_reply' || /empty/i.test(rawReason)) return 'Empty answer, skipped'
  if (rawReason.includes('500') || /internalserver/i.test(rawReason)) return 'Provider server error (500)'
  if (rawReason.includes('503')) return 'Provider unavailable (503)'

  return rawReason.replace(/_/g, ' ')
}

export function getTraceSteps(metadata?: Partial<ChatMetadata>): TraceStep[] {
  if (!metadata) return []

  const isCache = metadata.resolution_source === 'LLM_CACHE'
  if (isCache) {
    return [
      {
        key_id: 'Cache',
        outcome: 'cache',
        reason: 'no provider called',
      },
    ]
  }

  if (Array.isArray(metadata.attempts) && metadata.attempts.length > 0) {
    return metadata.attempts.map((a) => ({
      key_id: a.key_id,
      outcome: a.outcome === 'ok' ? 'ok' : 'failed',
      reason: mapReason(a.reason, a.outcome),
      model: a.model,
    }))
  }

  // Derive trace when attempts is missing (e.g. older sessions loaded from history)
  const fallbacks = metadata.fallback_attempts ?? 0
  const keyId = metadata.key_id ?? 'key_1'

  if (fallbacks > 0) {
    const steps: TraceStep[] = []
    for (let i = 1; i <= fallbacks; i++) {
      steps.push({
        key_id: `key_${i}`,
        outcome: 'failed',
        reason: 'Provider rate limit',
      })
    }
    steps.push({
      key_id: keyId,
      outcome: 'ok',
      reason: 'Success',
    })
    return steps
  }

  return [
    {
      key_id: keyId,
      outcome: 'ok',
      reason: 'Success',
    },
  ]
}
