import React, { useState } from 'react'
import type { StoredSession } from '../types'
import { formatRelativeTime } from '../utils'
import Logo from './Logo'
import { Button } from './ui'

interface Props {
  currentSessionId: string
  sessions: StoredSession[]
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession?: (id: string, newTitle: string) => void
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
  onRenameSession,
  onNewSession,
  onClose,
  busy,
  sidebarRef,
  isSidebarOpen,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const isCurrentSaved = sessions.some((s) => s.id === currentSessionId)

  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime()
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime()
    return timeB - timeA
  })

  return (
    <aside
      className="sidebar"
      id="sidebar"
      ref={sidebarRef}
      aria-label="Past sessions"
      {...(!isSidebarOpen ? { inert: '' } : {})}
    >
      <div className="sidebar-inner">
        <div className="side-head">
          <div className="side-brand">
            <Logo size={28} />
            <span className="side-title">Relay</span>
          </div>

          {isSidebarOpen !== false && (
            <Button
              variant="primary"
              size="md"
              className="side-new-btn"
              onClick={() => {
                onNewSession()
                onClose?.()
              }}
              disabled={busy}
              aria-label="New session"
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
                <path d="M12 5v14M5 12h14" />
              </svg>
              New chat
            </Button>
          )}
        </div>

        <div className="side-section-label">Recent</div>

        <nav className="side-list" aria-label="Past chats navigation">
          {!isCurrentSaved && (
            <div
              role="listitem"
              className="side-item is-active"
              tabIndex={0}
              aria-current="page"
            >
              <div className="side-item-info">
                <span className="side-item-title">New chat</span>
                <span className="side-item-time">just now</span>
              </div>
            </div>
          )}

          {sortedSessions.length === 0 && isCurrentSaved && (
            <div className="side-empty">No saved chats yet.</div>
          )}

          {sortedSessions.map((s) => {
            const isActive = s.id === currentSessionId
            return (
              <div
                key={s.id}
                role="listitem"
                className={`side-item rail-item ${isActive ? 'is-active' : ''} ${busy ? 'is-disabled' : ''}`}
                onClick={() => {
                  if (!busy && editingId !== s.id) {
                    onSelectSession(s.id)
                    onClose?.()
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !busy && editingId !== s.id) {
                    e.preventDefault()
                    onSelectSession(s.id)
                    onClose?.()
                  }
                }}
                tabIndex={busy || editingId === s.id ? -1 : 0}
                aria-current={isActive ? 'page' : undefined}
              >
                {editingId === s.id ? (
                  <div className="side-item-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      className="side-item-edit-input"
                      value={editTitle}
                      maxLength={60}
                      autoFocus
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (editTitle.trim() && onRenameSession) {
                            onRenameSession(s.id, editTitle.trim())
                          }
                          setEditingId(null)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditingId(null)
                        }
                      }}
                      aria-label="Rename session"
                    />
                    <div className="side-item-edit-actions">
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary ui-btn-2xs side-item-edit-btn side-item-save-btn"
                        onClick={() => {
                          if (editTitle.trim() && onRenameSession) {
                            onRenameSession(s.id, editTitle.trim())
                          }
                          setEditingId(null)
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-2xs side-item-edit-btn side-item-cancel-btn"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="side-item-info">
                      <span className="side-item-title" title={s.title}>
                        {s.title}
                      </span>
                      <span className="side-item-time">
                        {formatRelativeTime(s.updatedAt || s.createdAt)}
                      </span>
                    </div>

                    <div className="side-item-actions">
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-2xs side-item-btn side-item-rename"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(s.id)
                          setEditTitle(s.title)
                        }}
                        title="Rename chat"
                        aria-label={`Rename session ${s.title}`}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span className="sr-only">Rename session {s.title}</span>
                      </button>

                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-2xs side-item-btn side-item-del"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteSession(s.id)
                        }}
                        title="Delete chat"
                        aria-label="Delete chat"
                      >
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
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        <span className="sr-only">Delete</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </nav>

        <div className="side-foot">
          <p className="side-foot-note">
            Chats are stored on the server. This list lives in this browser.
          </p>
        </div>
      </div>
    </aside>
  )
}
