import React from 'react'
import type { StoredSession } from '../types'
import { formatRelativeTime } from '../utils'
import Logo from './Logo'
import { Button } from './ui'

interface Props {
  currentSessionId: string
  sessions: StoredSession[]
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNewSession: () => void
  onClose?: () => void
  busy: boolean
  sidebarRef?: React.Ref<HTMLElement>
  isSidebarOpen?: boolean
}

export default function SessionsRail({
  currentSessionId,
  sessions,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  onClose,
  busy,
  sidebarRef,
  isSidebarOpen,
}: Props) {
  const isCurrentSaved = sessions.some((s) => s.id === currentSessionId)

  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime()
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime()
    return timeB - timeA
  })

  return (
    <aside
      className="sidebar sessions-rail"
      id="sidebar"
      ref={sidebarRef}
      aria-label="Past sessions"
    >
      <div className="sidebar-inner">
        <div className="side-head rail-head">
          <div className="rail-brand">
            <Logo size={28} />
            <span className="rail-title">Relay</span>
          </div>

          {isSidebarOpen !== false && (
            <Button
              variant="primary"
              size="md"
              className="rail-new-btn side-new-btn"
              onClick={() => {
                onNewSession()
                onClose?.()
              }}
              disabled={busy}
              aria-label="New session"
            >
              New chat
            </Button>
          )}
        </div>

        <nav className="side-list rail-nav" aria-label="Past chats navigation">
          <div className="rail-list" role="list">
            {!isCurrentSaved && (
              <div
                role="listitem"
                className="side-item rail-item is-active"
                tabIndex={0}
                aria-current="page"
              >
                <div className="side-item-info rail-item-info">
                  <span className="side-item-title rail-item-title">New chat</span>
                  <span className="side-item-time rail-item-time">just now</span>
                </div>
              </div>
            )}

            {sortedSessions.length === 0 && isCurrentSaved && (
              <div className="side-empty rail-empty">No saved chats yet.</div>
            )}

            {sortedSessions.map((s) => {
              const isActive = s.id === currentSessionId
              return (
                <div
                  key={s.id}
                  role="listitem"
                  className={`side-item rail-item ${isActive ? 'is-active' : ''} ${busy ? 'is-disabled' : ''}`}
                  onClick={() => {
                    if (!busy) {
                      onSelectSession(s.id)
                      onClose?.()
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                      e.preventDefault()
                      onSelectSession(s.id)
                      onClose?.()
                    }
                  }}
                  tabIndex={busy ? -1 : 0}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="side-item-info rail-item-info">
                    <span className="side-item-title rail-item-title" title={s.title}>
                      {s.title}
                    </span>
                    <span className="side-item-time rail-item-time">
                      {formatRelativeTime(s.updatedAt || s.createdAt)}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="side-item-del rail-item-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteSession(s.id)
                    }}
                    title="Remove session from browser"
                    aria-label={`Remove session ${s.title} from this browser`}
                  >
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        </nav>

        <div className="side-foot rail-footer">
          <p className="side-foot-note rail-footer-note">
            Chats are stored on the server. This list lives in this browser.
          </p>
        </div>
      </div>
    </aside>
  )
}
