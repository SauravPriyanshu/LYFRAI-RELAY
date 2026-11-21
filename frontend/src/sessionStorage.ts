import type { StoredSession } from './types'

export const STORAGE_KEY = 'relay.sessions.v1'

export function loadSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (s) => s && typeof s === 'object' && typeof s.id === 'string' && typeof s.title === 'string',
      )
    }
    return []
  } catch {
    return []
  }
}

export function saveSessions(sessions: StoredSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // ignore quota or security exceptions in sandboxed iframes
  }
}

export function upsertSession(session: StoredSession): StoredSession[] {
  const list = loadSessions()
  const idx = list.findIndex((s) => s.id === session.id)
  let updated: StoredSession[]
  if (idx >= 0) {
    const next = [...list]
    next[idx] = {
      ...next[idx],
      ...session,
      title: next[idx].title || session.title,
      createdAt: next[idx].createdAt || session.createdAt,
      updatedAt: session.updatedAt || new Date().toISOString(),
    }
    // Move updated to top
    const [item] = next.splice(idx, 1)
    updated = [item, ...next]
  } else {
    updated = [session, ...list]
  }
  saveSessions(updated)
  return updated
}

export function deleteSession(id: string): StoredSession[] {
  const list = loadSessions()
  const filtered = list.filter((s) => s.id !== id)
  saveSessions(filtered)
  return filtered
}

export function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    if (diffMs < 0) return 'just now'
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return 'just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay === 1) return 'yesterday'
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export interface SessionGroup {
  title: 'Today' | 'Yesterday' | 'Earlier'
  sessions: StoredSession[]
}

export function groupSessions(sessions: StoredSession[]): SessionGroup[] {
  const today: StoredSession[] = []
  const yesterday: StoredSession[] = []
  const earlier: StoredSession[] = []

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000

  for (const s of sessions) {
    const t = new Date(s.updatedAt || s.createdAt).getTime()
    if (t >= startOfToday) {
      today.push(s)
    } else if (t >= startOfYesterday) {
      yesterday.push(s)
    } else {
      earlier.push(s)
    }
  }

  const groups: SessionGroup[] = []
  if (today.length > 0) groups.push({ title: 'Today', sessions: today })
  if (yesterday.length > 0) groups.push({ title: 'Yesterday', sessions: yesterday })
  if (earlier.length > 0) groups.push({ title: 'Earlier', sessions: earlier })
  return groups
}
