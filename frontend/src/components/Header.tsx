import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthInfo, HealthStatus } from '../types'
import { copyText } from '../utils'
import { Button } from './ui'

interface Props {
  sessionId: string
  healthStatus: HealthStatus
  healthInfo: HealthInfo | null
  onRetryHealth: () => void
  onNewSession: () => void
  onToggleRail: () => void
  isSidebarOpen: boolean
  busy: boolean
  chatsButtonRef?: React.Ref<HTMLButtonElement>
}

export default function Header({
  sessionId,
  healthStatus,
  healthInfo,
  onRetryHealth,
  onNewSession,
  onToggleRail,
  isSidebarOpen,
  busy,
  chatsButtonRef,
}: Props) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopySession = useCallback(async () => {
    if (await copyText(sessionId)) {
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1500)
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  let statusText = 'Connecting'
  let statusTooltip = 'Connecting to backend…'

  if (healthStatus === 'online') {
    statusText = 'Online'
    if (healthInfo) {
      const k = healthInfo.keys_configured
      const c = healthInfo.cache_enabled ? 'cache on' : 'cache off'
      statusTooltip = `${k} ${k === 1 ? 'key' : 'keys'}, ${c}`
    } else {
      statusTooltip = 'Online'
    }
  } else if (healthStatus === 'offline') {
    statusText = 'Offline'
    statusTooltip = 'Click to retry connection'
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Button
          ref={chatsButtonRef}
          variant="secondary"
          size="sm"
          className="ui-icon-btn chats-toggle-btn"
          onClick={onToggleRail}
          aria-label="Toggle chats (toggle sessions navigation)"
          title="Toggle chats"
          aria-expanded={isSidebarOpen}
          aria-controls="sidebar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </Button>

        {!isSidebarOpen && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="topbar-new-chat-btn"
              onClick={onNewSession}
              disabled={busy}
              aria-label="New session"
            >
              New chat
            </Button>
            <span className="topbar-wordmark">Relay</span>
          </>
        )}
      </div>

      <div className="topbar-center" />

      <div className="topbar-right">
        {healthStatus === 'offline' ? (
          <button
            type="button"
            className="status-pill status-offline"
            onClick={onRetryHealth}
            title={statusTooltip}
          >
            <span className="status-dot dot-offline" aria-hidden="true" />
            <span className="status-label">{statusText}</span>
          </button>
        ) : (
          <div className={`status-pill status-${healthStatus}`} title={statusTooltip}>
            <span className={`status-dot dot-${healthStatus}`} aria-hidden="true" />
            <span className="status-label">{statusText}</span>
          </div>
        )}

        <div className="session-chip session-block">
          <span className="session-label">SESSION</span>
          <span data-testid="session-id" className="session-full-id">
            {sessionId}
          </span>
          <button
            type="button"
            className="session-copy-btn ui-icon-btn"
            onClick={handleCopySession}
            title={copied ? 'Copied' : 'Copy session id'}
            aria-label={copied ? 'Copied session id' : 'Copy session id'}
          >
            {copied ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--ok)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
