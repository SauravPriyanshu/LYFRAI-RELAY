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
    <header className="topbar chat-header">
      <div className="topbar-left">
        <Button
          ref={chatsButtonRef}
          variant="secondary"
          size="sm"
          className="menu-button chats-toggle-btn"
          onClick={onToggleRail}
          aria-label="Toggle sessions navigation"
          aria-expanded={isSidebarOpen}
          aria-controls="sidebar"
        >
          Chats
        </Button>

        {!isSidebarOpen && (
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
        )}

        <span className="brand-title">Relay</span>
      </div>

      <div className="topbar-right">
        <div className="topbar-status">
          <button
            type="button"
            className={`status-pill status-${healthStatus}`}
            onClick={healthStatus === 'offline' ? onRetryHealth : undefined}
            title={statusTooltip}
          >
            <span className={`status-dot dot-${healthStatus}`} aria-hidden="true" />
            <span className="status-label">{statusText}</span>
          </button>
        </div>

        <div className="session-block">
          <span className="session-label">Session</span>
          <span data-testid="session-id" className="session-full-id">
            {sessionId}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="session-copy-btn"
            onClick={handleCopySession}
            title="Copy session id"
            aria-label="Copy session id"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </header>
  )
}
