import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  hasMessages?: boolean
}

export default function InstructionsBar({
  value,
  onChange,
  disabled = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const isActive = value.trim().length > 0

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (isExpanded) {
      el.style.height = 'auto'
      const maxHeight = 120
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), maxHeight)}px`
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
    } else {
      el.style.height = '24px'
      el.style.overflowY = 'hidden'
    }
  }, [value, isExpanded])

  const handleClear = () => {
    onChange('')
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const handleDone = () => {
    setIsExpanded(false)
    if (textareaRef.current) {
      textareaRef.current.blur()
    }
  }

  return (
    <div className={`sysprompt-row ${isExpanded ? 'is-expanded' : ''}`}>
      <div className="sysprompt-main">
        <div className="sysprompt-label-group">
          <label htmlFor="system-prompt-input" className="sysprompt-label">
            System prompt
          </label>
          {isActive && (
            <span className="sysprompt-active-badge" title="Custom system prompt is active">
              <span className="sysprompt-active-dot" aria-hidden="true" />
              Active
            </span>
          )}
        </div>

        <div
          className={`sysprompt-input-wrap ${isExpanded ? 'wrap-expanded' : ''} ${isActive ? 'has-value' : ''}`}
        >
          <textarea
            ref={textareaRef}
            id="system-prompt-input"
            data-testid="system-prompt-input"
            className="sysprompt-textarea"
            rows={1}
            maxLength={8000}
            value={value}
            placeholder={
              isExpanded
                ? 'Write instructions for the assistant (e.g. tone, persona, constraints)...'
                : 'Set system prompt (e.g. You are a concise assistant)...'
            }
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setIsExpanded(true)}
            disabled={disabled}
            aria-label="System prompt"
          />

          <div className="sysprompt-actions">
            {!isExpanded && (
              <Button
                variant="ghost"
                size="sm"
                className="sysprompt-toggle-btn"
                onClick={() => {
                  setIsExpanded(true)
                  setTimeout(() => textareaRef.current?.focus(), 50)
                }}
                disabled={disabled}
                type="button"
              >
                {isActive ? 'Edit' : 'Instructions'}
              </Button>
            )}

            {value.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="sysprompt-clear-btn"
                onClick={handleClear}
                disabled={disabled}
                type="button"
              >
                Clear
              </Button>
            )}

            {isExpanded && (
              <Button
                variant="secondary"
                size="sm"
                className="sysprompt-done-btn"
                onClick={handleDone}
                disabled={disabled}
                type="button"
              >
                Done
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
