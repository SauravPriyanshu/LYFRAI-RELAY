import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getTraceSteps } from '../traceUtils'
import type { ChatItem } from '../types'
import { copyText } from '../utils'
import { useToast } from './Toasts'
import { Button } from './ui'

interface Props {
  item: ChatItem
  onCopy: (text: string) => void
  onRetry: (id: string, text: string) => void
  onInspect: (item: ChatItem, triggerEl: HTMLElement) => void
  disabled: boolean
}

export default function MessageItem({ item, onCopy, onRetry, onInspect, disabled }: Props) {
  const toast = useToast()
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  if (item.role === 'user') {
    return (
      <div className="row row-user">
        <div className="bubble bubble-user" data-testid="user-message">
          {item.content}
        </div>
      </div>
    )
  }

  if (item.role === 'info') {
    return (
      <div className="row row-info">
        <div className="bubble bubble-info" data-testid="chat-info">
          <span>{item.content}</span>
        </div>
      </div>
    )
  }

  if (item.role === 'error') {
    return (
      <div className="row row-error">
        <div className="error-card" role="alert" data-testid="chat-error">
          <div className="error-head">
            <span className="error-title">Couldn’t get a reply</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onRetry(item.id, item.retryText)}
              className="error-retry-btn"
            >
              Retry
            </Button>
          </div>
          <p className="error-message">{item.content}</p>
          {item.status > 0 && (
            <details className="error-details">
              <summary className="error-details-summary">Details</summary>
              <div className="error-details-body">
                Status code: <code>{item.status}</code>
              </div>
            </details>
          )}
        </div>
      </div>
    )
  }

  const m = item.metadata ?? {}
  const cached = m.resolution_source === 'LLM_CACHE'

  const latencyDisplay = m.latency_ms !== undefined && m.latency_ms !== null ? `${m.latency_ms} ms` : '—'
  const inTokensDisplay = m.input_tokens !== undefined && m.input_tokens !== null ? String(m.input_tokens) : '—'
  const outTokensDisplay = m.output_tokens !== undefined && m.output_tokens !== null ? String(m.output_tokens) : '—'
  const fallbackDisplay = m.fallback_attempts !== undefined && m.fallback_attempts !== null ? String(m.fallback_attempts) : '—'
  const fallbackCount = m.fallback_attempts ?? 0

  const keyDisplay = m.key_id ? `Key: ${m.key_id}` : 'Key: cache'

  const handleCopyMain = async () => {
    onCopy(item.content)
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  return (
    <div className="row row-assistant">
      <div className="assistant-card" data-testid="assistant-message">
        <div className="assistant-flat-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const isBlock = match || String(children).includes('\n')
                if (!isBlock) {
                  return (
                    <code className="inline-code" {...props}>
                      {children}
                    </code>
                  )
                }
                const lang = match ? match[1] : 'code'
                const codeStr = String(children).replace(/\n$/, '')
                return (
                  <div className="code-block-wrap">
                    <div className="code-block-head">
                      <span className="code-lang">{lang}</span>
                      <button
                        type="button"
                        className="code-copy-btn"
                        onClick={async () => {
                          if (await copyText(codeStr)) {
                            toast.success('Code copied', 'Copied to clipboard.')
                          }
                        }}
                        aria-label="Copy code to clipboard"
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="code-pre">
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  </div>
                )
              },
              a({ href, children, ...props }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
                    {children}
                  </a>
                )
              },
              table({ children, ...props }) {
                return (
                  <div className="table-wrap">
                    <table {...props}>{children}</table>
                  </div>
                )
              },
            }}
          >
            {item.content}
          </ReactMarkdown>
        </div>

        <div className="receipt-card receipt-card-compact" aria-label="Reply metadata receipt">
          <div className="receipt-compact-head">
            <span className={`source-badge ${cached ? 'badge-cache' : 'badge-live'}`}>
              {!cached && <span className="source-dot pulse-dot" aria-hidden="true" />}
              <span data-testid="meta-source">{m.resolution_source ?? '—'}</span>
            </span>

            <div className="receipt-inline-metrics">
              <span className="compact-metric">
                <span className="metric-label">Model</span>
                <span data-testid="meta-model" className="metric-val val-model" title={m.model}>
                  {m.model ?? '—'}
                </span>
              </span>

              <span className="compact-metric">
                <span className="metric-label">Latency</span>
                <span data-testid="meta-latency" className="metric-val">
                  {latencyDisplay}
                </span>
              </span>

              <span className="compact-metric">
                <span className="metric-label">Input tokens</span>
                <span data-testid="meta-input-tokens" className="metric-val">
                  {inTokensDisplay}
                </span>
              </span>

              <span className="compact-metric">
                <span className="metric-label">Output tokens</span>
                <span data-testid="meta-output-tokens" className="metric-val">
                  {outTokensDisplay}
                </span>
              </span>
            </div>

            <div className="receipt-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyMain}
                className="receipt-action-btn"
                aria-label="Copy reply"
              >
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => onInspect(item, e.currentTarget)}
                className="receipt-action-btn btn-inspect"
                aria-label="Inspect reply"
              >
                Inspect
              </Button>
            </div>
          </div>

          <div className="receipt-compact-sub">
            <span className="receipt-ghost-chip" data-testid="meta-key-chip">
              <span className="receipt-chip-label">{keyDisplay}</span>
            </span>

            <span
              className={`receipt-ghost-chip ${fallbackCount > 0 ? 'fallbacks-active' : ''}`}
              data-testid="meta-fallbacks-chip"
            >
              <span className="receipt-chip-label">Fallbacks:</span>{' '}
              <span data-testid="meta-fallback-attempts">{fallbackDisplay}</span>
            </span>

            {cached && (
              <span className="cache-savings-line" data-testid="cache-savings-line">
                {m.original_latency_ms !== undefined && m.original_latency_ms !== null
                  ? `Served from cache in ${m.latency_ms ?? 0} ms (live call took ${m.original_latency_ms} ms)`
                  : `Served from cache in ${m.latency_ms ?? 0} ms`}
              </span>
            )}

            {fallbackCount > 0 && (
              <div className="receipt-inline-trace" data-testid="inline-trace" aria-label="Failover route trace">
                {getTraceSteps(m).map((step, idx) => (
                  <span key={idx} className="inline-trace-step">
                    <span className="step-key mono">{step.key_id}</span>
                    <span className={`step-mark mark-${step.outcome}`}>
                      {step.outcome === 'ok' ? 'ok' : step.outcome === 'cache' ? 'cache' : 'failed'}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
