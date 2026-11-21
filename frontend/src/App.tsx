import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getHealth, getHistory, sendChat } from './api'
import Composer from './components/Composer'
import Header from './components/Header'
import InspectorDrawer from './components/InspectorDrawer'
import InstructionsBar from './components/InstructionsBar'
import MessageItem from './components/MessageItem'
import SessionsRail from './components/SessionsRail'
import { useToast } from './components/Toasts'
import { Skeleton } from './components/ui'
import WakingServerBanner from './components/WakingServerBanner'
import { deleteSession, loadSessions, upsertSession } from './sessionStorage'
import type { ChatItem, ChatMetadata, HealthInfo, HealthStatus, StoredSession } from './types'
import { copyText, newSessionId, uid } from './utils'

const SUGGESTIONS = [
  'Explain failover in one sentence',
  'Explain caching in two sentences',
  'Compare Gemini and Claude tokens',
]

function getInitialDesktopCollapsed(): boolean {
  try {
    const saved = localStorage.getItem('relay.sidebar.v1')
    return saved === 'collapsed'
  } catch {
    return false
  }
}

export default function App() {
  const toast = useToast()

  // A brand-new session on every page load.
  const [sessionId, setSessionId] = useState<string>(() => newSessionId())
  const [items, setItems] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [simulateFailure, setSimulateFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Sidebar state
  const [desktopCollapsed, setDesktopCollapsed] = useState<boolean>(getInitialDesktopCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(max-width: 899px)').matches
    }
    return false
  })

  const [inspectedItem, setInspectedItem] = useState<ChatItem | null>(null)
  const [inspectTriggerEl, setInspectTriggerEl] = useState<HTMLElement | null>(null)

  // Past sessions persisted in localStorage
  const [sessions, setSessions] = useState<StoredSession[]>(() => loadSessions())

  // Health and cold start status
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('connecting')
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null)
  const [showWakingBanner, setShowWakingBanner] = useState(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const sendingRef = useRef(false)
  const lastSentMessageRef = useRef('')
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const firstCheckDoneRef = useRef(false)
  const wakingBannerShownRef = useRef(false)
  const isNearBottomRef = useRef(true)

  const sidebarRef = useRef<HTMLElement>(null)
  const chatsBtnRef = useRef<HTMLButtonElement>(null)
  const prevMobileOpenRef = useRef(mobileOpen)

  // Track window resize for mobile vs desktop sidebar behavior
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(max-width: 899px)')
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches)
      if (!e.matches) {
        setMobileOpen(false)
      }
    }
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange as (e: MediaQueryListEvent) => void)
      return () => mql.removeEventListener('change', onChange as (e: MediaQueryListEvent) => void)
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
  }, [])

  // Manage focus when mobile sidebar opens or closes
  useEffect(() => {
    if (mobileOpen && !prevMobileOpenRef.current) {
      const firstFocusable = sidebarRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      firstFocusable?.focus()
    } else if (!mobileOpen && prevMobileOpenRef.current) {
      chatsBtnRef.current?.focus()
    }
    prevMobileOpenRef.current = mobileOpen
  }, [mobileOpen])

  // Escape key closes mobile sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobile && mobileOpen) {
        e.preventDefault()
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile, mobileOpen])

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen((prev) => !prev)
    } else {
      setDesktopCollapsed((prev) => {
        const next = !prev
        try {
          localStorage.setItem('relay.sidebar.v1', next ? 'collapsed' : 'open')
        } catch {}
        return next
      })
    }
  }, [isMobile])

  const handleCloseMobileSidebar = useCallback(() => {
    setMobileOpen(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || items.length === 0) {
      setShowJumpToBottom(false)
      isNearBottomRef.current = true
      return
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNear = distance <= 160
    isNearBottomRef.current = isNear
    setShowJumpToBottom(!isNear)
  }, [items.length])

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) {
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
      setShowJumpToBottom(false)
      isNearBottomRef.current = true
    }
  }, [])

  // Auto-stick to bottom only when already near the bottom (within 160px)
  useEffect(() => {
    const el = listRef.current
    if (!el || items.length === 0) return
    if (isNearBottomRef.current) {
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [items, sending])

  // Health checking
  const checkHealth = useCallback(
    async (isFirst = false) => {
      let wakingTimer: ReturnType<typeof setTimeout> | null = null
      if (isFirst) {
        wakingTimer = setTimeout(() => {
          if (!firstCheckDoneRef.current) {
            wakingBannerShownRef.current = true
            setShowWakingBanner(true)
          }
        }, 4000)
      }

      try {
        const info = await getHealth()
        firstCheckDoneRef.current = true
        if (wakingTimer) clearTimeout(wakingTimer)
        if (wakingBannerShownRef.current) {
          setShowWakingBanner(false)
        }
        setHealthInfo(info)
        setHealthStatus('online')
      } catch {
        firstCheckDoneRef.current = true
        if (wakingTimer) clearTimeout(wakingTimer)
        setHealthStatus('offline')
        setHealthInfo(null)
      }
    },
    [],
  )

  useEffect(() => {
    void checkHealth(true)
    const interval = setInterval(() => {
      void checkHealth(false)
    }, 15000)
    return () => clearInterval(interval)
  }, [checkHealth])

  const sendRequest = useCallback(
    async (text: string, isRetry: boolean) => {
      if (!text || sendingRef.current) return

      sendingRef.current = true
      setSending(true)
      lastSentMessageRef.current = text
      if (!isRetry) {
        setDraft('')
        const userItem: ChatItem = {
          id: uid(),
          role: 'user',
          content: text,
        }
        setItems((prev) => [...prev, userItem])
      }

      const currentPrompt = systemPrompt.trim() || undefined
      const simulateHeader = simulateFailure || undefined

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await sendChat({
          sessionId,
          message: text,
          systemPrompt: currentPrompt,
          simulate: simulateHeader,
          signal: controller.signal,
        })

        const assistantItem: ChatItem = {
          id: uid(),
          role: 'assistant',
          content: res.reply,
          metadata: res.metadata,
          request: {
            sessionId,
            message: text,
            systemPromptUsed: currentPrompt,
            simulateHeader,
            timestamp: new Date().toISOString(),
          },
        }

        setItems((prev) => [...prev, assistantItem])

        // Persist to client sessions list on first successful reply
        const existing = sessions.find((s) => s.id === sessionId)
        const title = existing?.title || text.slice(0, 48)
        const updated = upsertSession({
          id: sessionId,
          title,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemPrompt: currentPrompt,
        })
        setSessions(updated)

        if (res.metadata?.resolution_source === 'LLM_CACHE') {
          const saved = res.metadata.original_latency_ms
            ? ` (saved ~${Math.max(0, res.metadata.original_latency_ms - (res.metadata.latency_ms ?? 0))} ms)`
            : ''
          toast.success('Served from cache', `Zero-latency cached reply${saved}`)
        }
      } catch (e) {
        if (
          controller.signal.aborted ||
          (e instanceof ApiError && e.name === 'AbortError') ||
          (e instanceof DOMException && e.name === 'AbortError')
        ) {
          setItems((prev) => [
            ...prev,
            { id: uid(), role: 'info', content: 'Request was stopped before the server responded.' },
          ])
          return
        }

        const err = e instanceof ApiError ? e : new ApiError('Network error. Check your connection.', 0)
        const errorItem: ChatItem = {
          id: uid(),
          role: 'error',
          content: err.message,
          retryText: text,
          status: err.status,
        }
        setItems((prev) => [...prev, errorItem])

        if (err.status === 422) {
          toast.error('Validation error', err.message)
        } else if (err.status === 503) {
          toast.error('Providers unavailable', 'All configured model providers failed or rate limited.')
        } else {
          toast.error('Request failed', err.message)
        }
      } finally {
        setSimulateFailure(null)
        sendingRef.current = false
        setSending(false)
        abortRef.current = null
      }
    },
    [sessionId, systemPrompt, simulateFailure, toast],
  )

  const handleSend = useCallback(() => {
    const text = draft.trim()
    void sendRequest(text, false)
  }, [draft, sendRequest])

  const handleStopWaiting = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      sendingRef.current = false
      setSending(false)
    }
  }, [])

  const handleRetry = useCallback(
    (failedItemId: string, retryText: string) => {
      setItems((prev) => prev.filter((it) => it.id !== failedItemId))
      void sendRequest(retryText, true)
    },
    [sendRequest],
  )

  const handleSystemPromptChange = useCallback(
    (val: string) => {
      setSystemPrompt(val)
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            systemPrompt: val.trim() || undefined,
            updatedAt: new Date().toISOString(),
          }
          try {
            localStorage.setItem('relay.sessions.v1', JSON.stringify(next))
          } catch {}
          return next
        }
        return prev
      })
    },
    [sessionId],
  )

  const handleCopy = useCallback(
    async (text: string) => {
      if (await copyText(text)) {
        toast.success('Copied', 'Reply copied to clipboard.')
      } else {
        toast.error('Copy failed', 'Clipboard access denied.')
      }
    },
    [toast],
  )

  const handleInspect = useCallback((item: ChatItem, triggerEl: HTMLElement) => {
    setInspectedItem(item)
    setInspectTriggerEl(triggerEl)
  }, [])

  const handleCloseInspector = useCallback(() => {
    setInspectedItem(null)
  }, [])

  const handleNewSession = useCallback(() => {
    if (sendingRef.current) return
    setSessionId(newSessionId())
    setItems([])
    setDraft('')
    setSystemPrompt('')
    setSimulateFailure(null)
    setInspectedItem(null)
    toast.success('New session started', 'The assistant has no memory of the previous chat.')
  }, [toast])

  // Esc closes drawer / rail
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handleNewSession()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        chatInputRef.current?.focus()
        return
      }

      if (e.key === 'Escape') {
        if (inspectedItem) {
          e.preventDefault()
          setInspectedItem(null)
          return
        }
        if (mobileOpen) {
          e.preventDefault()
          setMobileOpen(false)
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNewSession, inspectedItem, mobileOpen])

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (sendingRef.current || id === sessionId) return
      setLoadingHistory(true)
      try {
        const res = await getHistory(id)
        setSessionId(id)
        const transformed: ChatItem[] = res.messages.map((m) => {
          if (m.role === 'assistant') {
            return {
              id: uid(),
              role: 'assistant',
              content: m.content,
              metadata: (m.metadata as ChatMetadata) ?? {},
            }
          }
          return {
            id: uid(),
            role: 'user',
            content: m.content,
          }
        })
        setItems(transformed)
        const saved = sessions.find((s) => s.id === id)
        setSystemPrompt(saved?.systemPrompt ?? '')
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('Failed to load session history.', 0)
        if (err.status === 404) {
          toast.error('Session not found', 'This session is no longer on the server.')
          setSessions(deleteSession(id))
          handleNewSession()
        } else {
          toast.error('Failed to load history', err.message)
        }
      } finally {
        setLoadingHistory(false)
      }
    },
    [sessionId, sessions, toast, handleNewSession],
  )

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions(deleteSession(id))
      toast.success('Chat removed', 'Chat removed from this browser.')
      if (id === sessionId) {
        handleNewSession()
      }
    },
    [sessionId, toast, handleNewSession],
  )

  const isSidebarOpen = isMobile ? mobileOpen : !desktopCollapsed

  const shellClassName = [
    'shell',
    desktopCollapsed ? 'is-collapsed' : '',
    mobileOpen ? 'is-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClassName}>
      <SessionsRail
        currentSessionId={sessionId}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSession={handleNewSession}
        onClose={handleCloseMobileSidebar}
        busy={sending}
        sidebarRef={sidebarRef}
        isSidebarOpen={isSidebarOpen}
      />

      <div className="backdrop" onClick={handleCloseMobileSidebar} aria-hidden="true" />

      <div className="main">
        <Header
          sessionId={sessionId}
          healthStatus={healthStatus}
          healthInfo={healthInfo}
          onRetryHealth={() => void checkHealth(false)}
          onNewSession={handleNewSession}
          onToggleRail={handleToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          busy={sending}
          chatsButtonRef={chatsBtnRef}
        />

        {showWakingBanner && <WakingServerBanner onDismiss={() => setShowWakingBanner(false)} />}

        <div className="sysprompt">
          <InstructionsBar
            value={systemPrompt}
            onChange={handleSystemPromptChange}
            disabled={sending}
            hasMessages={items.some((i) => i.role === 'user' || i.role === 'assistant')}
          />
        </div>

        <div className="thread-wrap">
          <div
            className="thread messages"
            ref={listRef}
            onScroll={handleScroll}
            data-testid="message-list"
            aria-live="polite"
          >
            <div className="messages-inner">
              {loadingHistory ? (
                <div className="skeleton-history" data-testid="skeleton-history">
                  <div className="skeleton-item user">
                    <Skeleton width="60%" height={36} radius={12} />
                  </div>
                  <div className="skeleton-item assistant">
                    <div className="skeleton-head">
                      <Skeleton width={120} height={14} radius={4} />
                    </div>
                    <Skeleton width="90%" height={52} radius={12} />
                  </div>
                </div>
              ) : items.length === 0 && !sending ? (
                <div className="empty" data-testid="empty-state">
                  <h2 className="empty-headline">Ask. Route. Recover.</h2>
                  <p className="empty-subtitle">
                    Replies show their source, model, latency and token usage.
                  </p>

                  <div className="chips">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="chip"
                        onClick={() => {
                          setDraft(s)
                          chatInputRef.current?.focus()
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!loadingHistory &&
                items.map((item) => (
                  <MessageItem
                    key={item.id}
                    item={item}
                    onCopy={handleCopy}
                    onRetry={handleRetry}
                    onInspect={handleInspect}
                    disabled={sending}
                  />
                ))}

              {sending && (
                <div
                  className="row row-assistant row-typing"
                  data-testid="typing-indicator"
                  aria-live="polite"
                  aria-label="Assistant is typing"
                >
                  <div className="typing-skeleton-line" aria-label="Assistant is typing">
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {showJumpToBottom && (
            <button
              type="button"
              className="jump jump-to-bottom-btn"
              onClick={scrollToBottom}
              aria-label="Jump to latest message"
            >
              Jump to latest
            </button>
          )}
        </div>

        <div className="composer">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            sending={sending}
            onStopWaiting={handleStopWaiting}
            hasCustomInstructions={systemPrompt.trim().length > 0}
            lastSentMessage={lastSentMessageRef.current}
            inputRef={chatInputRef}
            canSimulateFailure={Boolean(healthInfo?.failure_simulation)}
            simulate={simulateFailure}
            onSelectSimulate={setSimulateFailure}
          />
        </div>
      </div>

      <InspectorDrawer
        item={inspectedItem}
        isOpen={Boolean(inspectedItem)}
        onClose={handleCloseInspector}
        triggerEl={inspectTriggerEl}
      />
    </div>
  )
}
