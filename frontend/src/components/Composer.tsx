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
    const maxHeight = 160 // 6 lines
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
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
      {hasCustomInstructions && (
        <div className="composer-badges-bar">
          <div className="composer-badge-wrap" data-testid="custom-instructions-badge">
            <span className="composer-custom-badge">
              <span className="badge-dot" aria-hidden="true" />
              Custom instructions
            </span>
          </div>
        </div>
      )}

      {simulate && (
        <div className="composer-simulate-bar">
          <span className="composer-simulate-tag">Next message: {simulate}</span>
          <button
            type="button"
            className="composer-simulate-cancel"
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
          placeholder="Message Relay… (Enter to send, Shift+Enter for a new line)"
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
                size="md"
                className="simulate-trigger-btn"
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="dialog"
                aria-expanded={open}
                type="button"
              >
                Simulate failure
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
            className="send"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
            type="button"
          >
            {sending ? 'Sending' : 'Send'}
          </Button>
        </div>
      </div>
      {len >= 3200 && (
        <div className={`counter ${over ? 'counter-over' : ''}`}>
          {len}/{LIMIT}
          {over ? ' – character limit exceeded (server will return 422)' : ''}
        </div>
      )}
    </div>
  )
}
