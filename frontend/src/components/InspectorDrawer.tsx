import { useEffect, useRef } from 'react'
import { API_BASE } from '../api'
import { getTraceSteps } from '../traceUtils'
import type { ChatItem, RequestTraceInfo } from '../types'
import { copyText } from '../utils'
import { useToast } from './Toasts'
import { Button } from './ui'

interface Props {
  item: ChatItem | null
  isOpen: boolean
  onClose: () => void
  triggerEl: HTMLElement | null
}

export function buildCurlCommand(apiBase: string, request?: Partial<RequestTraceInfo>): string {
  const url = `${apiBase.replace(/\/+$/, '')}/chat`
  const body: Record<string, string> = {
    session_id: request?.sessionId || 's-session',
    message: request?.message || '',
  }
  if (request?.systemPromptUsed) {
    body.system_prompt = request.systemPromptUsed
  }
  const headers = ['-H "Content-Type: application/json"']
  if (request?.simulateHeader) {
    headers.push(`-H "X-Simulate-Failure: ${request.simulateHeader}"`)
  }
  const headerStr = headers.join(' \\\n  ')
  const jsonBody = JSON.stringify(body).replace(/'/g, "'\\''")
  return `curl -X POST "${url}" \\\n  ${headerStr} \\\n  -d '${jsonBody}'`
}

export default function InspectorDrawer({ item, isOpen, onClose, triggerEl }: Props) {
  const toast = useToast()
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const timer = setTimeout(() => {
      closeBtnRef.current?.focus()
    }, 50)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      if (triggerEl) {
        triggerEl.focus()
      }
    }
  }, [isOpen, onClose, triggerEl])

  if (!isOpen || !item || item.role !== 'assistant') {
    return null
  }

  const m = item.metadata ?? {}
  const req = item.request
  const cached = m.resolution_source === 'LLM_CACHE'
  const traceSteps = getTraceSteps(m)

  const inTok = typeof m.input_tokens === 'number' ? m.input_tokens : 0
  const outTok = typeof m.output_tokens === 'number' ? m.output_tokens : 0
  const maxTok = Math.max(inTok, outTok, 1)
  const inBarPct = Math.round((inTok / maxTok) * 100)
  const outBarPct = Math.round((outTok / maxTok) * 100)

  const savedTimeMs =
    cached && m.original_latency_ms !== undefined && m.original_latency_ms !== null && m.latency_ms !== undefined
      ? Math.max(0, m.original_latency_ms - m.latency_ms)
      : null

  const handleCopyCurl = async () => {
    const curl = buildCurlCommand(API_BASE, req)
    if (await copyText(curl)) {
      toast.success('cURL copied', 'cURL command copied to clipboard.')
    } else {
      toast.error('Copy failed', 'Clipboard access denied.')
    }
  }

  const handleCopyJson = async () => {
    const jsonStr = JSON.stringify(m, null, 2)
    if (await copyText(jsonStr)) {
      toast.success('JSON copied', 'Metadata JSON copied to clipboard.')
    } else {
      toast.error('Copy failed', 'Clipboard access denied.')
    }
  }

  return (
    <>
      <div className="inspector-backdrop" onClick={onClose} aria-hidden="true" />

      <aside
        ref={drawerRef}
        className="inspector-drawer"
        role="dialog"
        aria-label="Request Inspector"
        aria-modal="true"
        data-testid="inspector-drawer"
      >
        <div className="inspector-header">
          <div className="inspector-title-wrap">
            <h2 className="inspector-title">Request Inspector</h2>
            <span className="inspector-subtitle">Data for this request only</span>
          </div>
          <Button
            ref={closeBtnRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close inspector"
            className="inspector-close-btn"
          >
            Close
          </Button>
        </div>

        <div className="inspector-content">
          {/* SECTION 1: Summary */}
          <section className="inspector-section" aria-labelledby="section-summary">
            <h3 id="section-summary" className="inspector-section-label">
              Summary
            </h3>
            <div className="summary-card">
              <div className="summary-row">
                <span className="summary-label">Source</span>
                <span className={`source-badge ${cached ? 'badge-cache' : 'badge-live'}`}>
                  {!cached && <span className="source-dot pulse-dot" aria-hidden="true" />}
                  <span>{m.resolution_source ?? '—'}</span>
                </span>
              </div>

              <div className="summary-row">
                <span className="summary-label">Model</span>
                <span className="summary-val mono" title={m.model}>
                  {m.model ?? '—'}
                </span>
              </div>

              <div className="summary-row">
                <span className="summary-label">Latency</span>
                <span className="summary-val mono">
                  {m.latency_ms !== undefined ? `${m.latency_ms} ms` : '—'}
                </span>
              </div>

              <div className="summary-row">
                <span className="summary-label">Timestamp</span>
                <span className="summary-val mono">
                  {req?.timestamp ? new Date(req.timestamp).toLocaleTimeString() : '—'}
                </span>
              </div>

              {m.request_id && (
                <div className="summary-row">
                  <span className="summary-label">Request ID</span>
                  <span className="summary-val mono" title={m.request_id}>
                    {m.request_id.slice(0, 12)}…
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2: Route Trace */}
          <section className="inspector-section" aria-labelledby="section-trace">
            <h3 id="section-trace" className="inspector-section-label">
              Route Trace
            </h3>
            <div className="trace-timeline" data-testid="inspector-route-trace">
              {traceSteps.map((step, idx) => {
                const isLast = idx === traceSteps.length - 1
                return (
                  <div key={idx} className="trace-step-item">
                    <div className="trace-step-marker-col">
                      <div className={`trace-marker marker-${step.outcome}`}>
                        {step.outcome}
                      </div>
                      {!isLast && <div className="trace-connector-line" />}
                    </div>

                    <div className="trace-step-body">
                      <div className="trace-step-head">
                        <span className="trace-step-key mono">{step.key_id}</span>
                        {step.model && <span className="trace-step-model mono">{step.model}</span>}
                        <span className={`trace-step-badge badge-${step.outcome}`}>
                          {step.outcome}
                        </span>
                      </div>
                      <span className="trace-step-reason">{step.reason}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* SECTION 3: Cache */}
          <section className="inspector-section" aria-labelledby="section-cache">
            <h3 id="section-cache" className="inspector-section-label">
              Cache
            </h3>
            <div className="cache-card">
              <div className="cache-status-row">
                <span className="cache-label">Status</span>
                <span className={`cache-status-pill ${cached ? 'hit' : 'miss'}`}>
                  {cached ? 'Hit' : 'Miss'}
                </span>
              </div>

              {savedTimeMs !== null && (
                <div className="cache-saved-row" data-testid="cache-saved-time">
                  About {savedTimeMs} ms faster than the live call
                </div>
              )}

              <p className="cache-explainer">
                The cache key is computed from the model name and the full conversation message list.
              </p>
            </div>
          </section>

          {/* SECTION 4: Tokens */}
          <section className="inspector-section" aria-labelledby="section-tokens">
            <h3 id="section-tokens" className="inspector-section-label">
              Tokens
            </h3>
            <div className="tokens-card">
              <div className="token-bar-row">
                <div className="token-label-wrap">
                  <span className="token-bar-label">Input</span>
                  <span className="token-bar-val mono">{inTok} tokens</span>
                </div>
                <div className="token-track">
                  <div className="token-fill token-fill-in" style={{ width: `${inBarPct}%` }} />
                </div>
              </div>

              <div className="token-bar-row">
                <div className="token-label-wrap">
                  <span className="token-bar-label">Output</span>
                  <span className="token-bar-val mono">{outTok} tokens</span>
                </div>
                <div className="token-track">
                  <div className="token-fill token-fill-out" style={{ width: `${outBarPct}%` }} />
                </div>
              </div>

              <span className="tokens-note">Per request, not a conversation total</span>
            </div>
          </section>

          {/* SECTION 5: Request */}
          <section className="inspector-section" aria-labelledby="section-request">
            <h3 id="section-request" className="inspector-section-label">
              Request
            </h3>
            <details open className="inspector-request-details">
              <summary className="request-details-summary">Payload parameters</summary>
              <div className="request-boxes">
                <div className="request-box">
                  <span className="request-box-label">User message</span>
                  <pre className="request-box-pre">{req?.message || '—'}</pre>
                </div>

                <div className="request-box">
                  <span className="request-box-label">System prompt</span>
                  <pre className="request-box-pre">{req?.systemPromptUsed || 'None'}</pre>
                </div>
              </div>
            </details>

            <div className="inspector-action-buttons">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyCurl}
                aria-label="Copy as cURL"
                className="inspector-curl-btn"
              >
                Copy as cURL
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyJson}
                aria-label="Copy JSON"
                className="inspector-json-btn"
              >
                Copy JSON
              </Button>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
