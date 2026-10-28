import { useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// Marks the open chat as read while I can actually see it.
//   - "Seen" for unread badges: any time the tab is visible.
//   - Read receipts (the friend's 👁): only if I share receipts AND the window
//     is focused, and only once per newer message.
// Re-checks whenever the tab becomes visible or the window gets focus.
//
//   onSeen(lastMessageId) → tells Home to clear this chat's unread badge
//   bumpMyReadUntil(ms)   → remembers locally how far I have read
export function useMarkSeen({ messages, shareSeen, contactId, onSeen, bumpMyReadUntil }) {
  // Newest message time (ms) already reported to the server, so we don't repeat
  const lastMarkRef = useRef(0)

  // Keep the latest onSeen without restarting the effect when its identity changes
  const onSeenRef = useRef(onSeen)
  useEffect(() => {
    onSeenRef.current = onSeen
  })

  useEffect(() => {
    function markSeen() {
      if (document.hidden || !messages.length) return
      onSeenRef.current(messages[messages.length - 1].id)

      if (!shareSeen || !document.hasFocus()) return
      let latest = 0
      for (const m of messages) {
        if (!m.mine) latest = Math.max(latest, new Date(m.time).getTime())
      }
      if (latest > lastMarkRef.current) {
        lastMarkRef.current = latest
        supabase
          .rpc('mark_read', { p_peer: contactId, p_until: new Date(latest).toISOString() })
          .then(({ error }) => {
            if (error) lastMarkRef.current = 0 // try again next time
            else bumpMyReadUntil(latest)
          })
      }
    }
    markSeen()
    document.addEventListener('visibilitychange', markSeen)
    window.addEventListener('focus', markSeen)
    return () => {
      document.removeEventListener('visibilitychange', markSeen)
      window.removeEventListener('focus', markSeen)
    }
  }, [messages, shareSeen, contactId, bumpMyReadUntil])
}
