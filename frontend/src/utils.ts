export function newSessionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  const rand =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14).padEnd(12, '0')
  return `s-${rand}`
}

let counter = 0
export const uid = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}`

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function formatRelativeTime(dateIso?: string): string {
  if (!dateIso) return 'just now'
  const time = new Date(dateIso).getTime()
  if (isNaN(time)) return 'just now'
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
