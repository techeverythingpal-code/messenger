const EVENT = 'messenger:refresh'
const POLL_MS = 30000 // safety check while the app is visible
const MIN_GAP_MS = 1500 // never refresh more than once per 1.5 seconds

let last = 0

// Ask every part of the app to fetch anything it missed
export function requestRefresh(force = false) {
  const now = Date.now()
  if (!force && now - last < MIN_GAP_MS) return
  last = now
  window.dispatchEvent(new Event(EVENT))
}

export function onRefresh(fn) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

// Triggers a refresh when the app comes back to life. Returns a cleanup function.
export function startAutoRefresh() {
  const whenVisible = () => {
    if (!document.hidden) requestRefresh()
  }
  const whenBack = () => requestRefresh(true)

  document.addEventListener('visibilitychange', whenVisible)
  window.addEventListener('focus', whenVisible)
  window.addEventListener('online', whenBack)
  window.addEventListener('pageshow', whenBack) // page restored from the back/forward cache

  const timer = setInterval(() => {
    if (!document.hidden && navigator.onLine) requestRefresh()
  }, POLL_MS)

  return () => {
    document.removeEventListener('visibilitychange', whenVisible)
    window.removeEventListener('focus', whenVisible)
    window.removeEventListener('online', whenBack)
    window.removeEventListener('pageshow', whenBack)
    clearInterval(timer)
  }
}