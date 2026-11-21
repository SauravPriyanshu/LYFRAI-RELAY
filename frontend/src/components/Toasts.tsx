import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastVariant = 'success' | 'error'

export interface ToastItemData {
  id: number
  variant: ToastVariant
  title: string
  text?: string
  durationMs: number
  createdAt: number
}

interface ToastApi {
  success: (title: string, text?: string) => void
  error: (title: string, text?: string) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const MAX_TOASTS = 3
const DEDUP_WINDOW_MS = 2000

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItemData
  onDismiss: (id: number) => void
}) {
  const [isPaused, setIsPaused] = useState(false)
  const remainingRef = useRef(toast.durationMs)
  const lastStartRef = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePause = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const elapsed = Date.now() - lastStartRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
    setIsPaused(true)
  }

  const handleResume = () => {
    setIsPaused(false)
    lastStartRef.current = Date.now()
    if (remainingRef.current > 0) {
      timerRef.current = setTimeout(() => {
        onDismiss(toast.id)
      }, remainingRef.current)
    } else {
      onDismiss(toast.id)
    }
  }

  useEffect(() => {
    lastStartRef.current = Date.now()
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id)
    }, remainingRef.current)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, onDismiss])

  return (
    <div
      className={`toast-card toast-${toast.variant} ${isPaused ? 'is-paused' : ''}`}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${toast.variant}`}
      onMouseEnter={handlePause}
      onMouseLeave={handleResume}
      onFocus={handlePause}
      onBlur={handleResume}
      tabIndex={0}
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-content">
        <div className="toast-text-wrap">
          <strong className="toast-title">{toast.title}</strong>
          {toast.text && <span className="toast-desc">{toast.text}</span>}
        </div>
        <button
          type="button"
          className="toast-close-btn ui-btn ui-btn-ghost ui-icon-btn"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          title="Dismiss"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div
        className="toast-progress-bar"
        style={{
          animationDuration: `${toast.durationMs}ms`,
          animationPlayState: isPaused ? 'paused' : 'running',
        }}
        aria-hidden="true"
      />
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItemData[]>([])
  const recentMapRef = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const add = useCallback((variant: ToastVariant, title: string, text?: string) => {
    const key = `${variant}:${title}:${text || ''}`
    const now = Date.now()
    const lastTime = recentMapRef.current.get(key)
    if (lastTime && now - lastTime < DEDUP_WINDOW_MS) {
      return
    }
    recentMapRef.current.set(key, now)

    const durationMs = variant === 'success' ? 4000 : 7000
    const item: ToastItemData = {
      id: now + Math.random(),
      variant,
      title,
      text,
      durationMs,
      createdAt: now,
    }

    setToasts((prev) => {
      const next = [...prev, item]
      if (next.length > MAX_TOASTS) {
        return next.slice(next.length - MAX_TOASTS)
      }
      return next
    })
  }, [])

  const success = useCallback(
    (title: string, text?: string) => {
      add('success', title, text)
    },
    [add],
  )

  const error = useCallback(
    (title: string, text?: string) => {
      add('error', title, text)
    },
    [add],
  )

  const api = useMemo(
    () => ({
      success,
      error,
      dismiss,
    }),
    [success, error, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts-container" aria-label="Notifications" role="region">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
