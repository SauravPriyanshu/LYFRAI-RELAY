import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Button } from './ui'

const LIMIT = 4000

const SIMULATE_OPTIONS = [
  { id: 'none', label: 'None (normal request)', value: null },
  { id: 'key_1_429', label: 'key_1 fails with 429', value: 'key_1=429' },
  { id: 'key_1_500', label: 'key_1 fails with 500', value: 'key_1=500' },
  { id: 'all_429', label: 'All keys fail with 429', value: '*=429' },
]

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  sending: boolean
  onStopWaiting?: () => void
  hasCustomInstructions?: boolean
  lastSentMessage?: string
  inputRef?: RefObject<HTMLTextAreaElement>
  canSimulateFailure?: boolean
  simulate?: string | null
  onSelectSimulate?: (value: string | null) => void
}

export default function Composer({
  value,
  onChange,
  onSend,
  sending,
  onStopWaiting,
  hasCustomInstructions = false,
  lastSentMessage = '',
  inputRef,
  canSimulateFailure = false,
  simulate = null,
  onSelectSimulate,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef || localRef

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const handlePointerDown = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 192
    const nextHeight = Math.min(Math.max(el.scrollHeight, 40), maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, ref])

  const len = value.trim().length
  const over = len > LIMIT
  const canSend = len > 0 && !sending

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowUp' && value === '' && lastSentMessage) {
      e.preventDefault()
      onChange(lastSentMessage)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div className="composer">
      <div className="chat-col">
        {hasCustomInstructions && (
          <span data-testid="custom-instructions-badge" className="sr-only">
            Custom instructions
          </span>
        )}

        {simulate && (
          <div className="composer-simulate-bar">
            <span className="composer-simulate-tag">Next message: {simulate}</span>
            <button
              type="button"
              className="composer-simulate-cancel ui-btn ui-btn-ghost ui-btn-2xs"
              onClick={() => onSelectSimulate?.(null)}
            >
              Cancel
            </button>
          </div>
        )}

        <div className={`composer-box ${over ? 'is-over' : ''}`}>
          <textarea
            ref={ref}
            data-testid="chat-input"
            className="chat-input"
            rows={1}
            value={value}
            placeholder="Message Relay…"
            aria-label="Message"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
          />
          <div className="composer-actions">
            {canSimulateFailure && (
              <div className="simulate-anchor">
                <Button
                  ref={triggerRef}
                  variant="secondary"
                  size="sm"
                  className="simulate-trigger-btn composer-chaos-btn ui-icon-btn"
                  onClick={() => setOpen((prev) => !prev)}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  type="button"
                  title="Simulate failure"
                  aria-label="Simulate failure"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span className="sr-only">Simulate failure</span>
                </Button>

                {open && (
                  <div
                    ref={popoverRef}
                    className="simulate-popover"
                    role="dialog"
                    aria-label="Simulate failure options"
                  >
                    <div className="simulate-popover-options" role="radiogroup">
                      {SIMULATE_OPTIONS.map((opt) => {
                        const isSelected = simulate === opt.value
                        return (
                          <label
                            key={opt.id}
                            className={`simulate-option ${isSelected ? 'is-selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name="simulate-failure"
                              value={opt.value ?? ''}
                              checked={isSelected}
                              onChange={() => {
                                onSelectSimulate?.(opt.value)
                                setOpen(false)
                              }}
                            />
                            <span className="simulate-option-text">{opt.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {sending && onStopWaiting && (
              <Button
                variant="ghost"
                size="sm"
                className="stop-waiting"
                onClick={onStopWaiting}
                aria-label="Stop waiting"
                type="button"
              >
                Stop waiting
              </Button>
            )}
            <Button
              data-testid="send-button"
              variant="primary"
              size="md"
              className="send composer-send-btn"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="send-icon"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              <span className="send-text">{sending ? 'Sending' : 'Send'}</span>
            </Button>
          </div>
        </div>

        <div className="composer-hint-row">
          <div className="composer-hint-keys">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </div>
          <div className="composer-hint-counter">
            {len > 3200 && (
              <span className={`counter-text ${over ? 'is-over' : ''}`}>
                {len}/{LIMIT}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
