import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { getTraceSteps } from '../traceUtils'
import type { ChatItem } from '../types'
import { copyText } from '../utils'
import { useToast } from './Toasts'
import { Button } from './ui'

function CodeBlock({
  className,
  children,
  onToast,
}: {
  className?: string
  children: React.ReactNode
  onToast: () => void
}) {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : 'code'
  const codeStr = String(children).replace(/\n$/, '')

  const handleCopy = async () => {
    if (await copyText(codeStr)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      onToast()
    }
  }

  return (
    <div className="code-block-wrap">
      <div className="code-block-head">
        <span className="code-lang">{lang}</span>
        <button
          type="button"
          className="code-copy-btn ui-btn ui-btn-ghost ui-btn-2xs"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

interface Props {
  item: ChatItem
  isNew?: boolean
  isNewest?: boolean
  onCopy: (text: string) => void
  onRetry: (id: string, text: string) => void
  onInspect: (item: ChatItem, triggerEl: HTMLElement) => void
  disabled: boolean
}

export default function MessageItem({
  item,
  isNew = false,
  isNewest = false,
  onCopy,
  onRetry,
  onInspect,
  disabled,
}: Props) {
  const toast = useToast()
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  if (item.role === 'user') {
    return (
      <div className={`row row-user${isNew ? ' is-new' : ''}`}>
        <div className="bubble bubble-user" data-testid="user-message">
          {item.content}
        </div>
      </div>
    )
  }

  if (item.role === 'info') {
    return (
      <div className={`row row-info${isNew ? ' is-new' : ''}`}>
        <div className="bubble bubble-info" data-testid="chat-info">
          <span>{item.content}</span>
        </div>
      </div>
    )
  }

  if (item.role === 'error') {
    return (
      <div className={`row row-error${isNew ? ' is-new' : ''}`}>
        <div className="error-card" role="alert" data-testid="chat-error">
          <div className="error-head">
            <span className="error-title">Couldn’t get a reply</span>
            <Button
              variant="ghost"
              size="xs"
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
    <div className={`row row-assistant${isNew ? ' is-new' : ''}`}>
      <div className="assistant-card" data-testid="assistant-message">
        <div className="assistant-flat-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
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
                return (
                  <CodeBlock
                    className={className}
                    onToast={() => toast.success('Code copied', 'Copied to clipboard.')}
                  >
                    {children}
                  </CodeBlock>
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
              {!cached ? (
                <span className={`source-dot ${isNewest ? 'pulse-newest' : ''}`} aria-hidden="true" />
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="source-bolt"
                >
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              )}
              <span data-testid="meta-source">{m.resolution_source ?? '—'}</span>
            </span>

            <div className="receipt-actions">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleCopyMain}
                className="receipt-action-btn"
                aria-label="Copy reply"
              >
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => onInspect(item, e.currentTarget)}
                className="receipt-action-btn btn-inspect"
                aria-label="Inspect reply"
              >
                Inspect
              </Button>
            </div>
          </div>

          <div className="receipt-stats-grid">
            <div className="compact-metric metric-model">
              <span className="metric-label">Model</span>
              <span data-testid="meta-model" className="metric-val val-model" title={m.model}>
                {m.model ?? '—'}
              </span>
            </div>

            <div className="compact-metric">
              <span className="metric-label">Latency</span>
              <span data-testid="meta-latency" className="metric-val">
                {latencyDisplay}
              </span>
            </div>

            <div className="compact-metric">
              <span className="metric-label">Input tokens</span>
              <span data-testid="meta-input-tokens" className="metric-val">
                {inTokensDisplay}
              </span>
            </div>

            <div className="compact-metric">
              <span className="metric-label">Output tokens</span>
              <span data-testid="meta-output-tokens" className="metric-val">
                {outTokensDisplay}
              </span>
            </div>
          </div>

          {/* Token bar */}
          {m.input_tokens !== undefined &&
            m.output_tokens !== undefined &&
            (m.input_tokens > 0 || m.output_tokens > 0) && (
              <div
                className="receipt-token-bar"
                title={`Input ${m.input_tokens} / Output ${m.output_tokens}`}
                aria-label={`Input ${m.input_tokens} / Output ${m.output_tokens}`}
              >
                <div
                  className="token-bar-in"
                  style={{
                    flex: Math.max(m.input_tokens, 1),
                  }}
                />
                <div
                  className="token-bar-out"
                  style={{
                    flex: Math.max(m.output_tokens, 1),
                  }}
                />
              </div>
            )}

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
