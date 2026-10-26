import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const SEND_EVERY_MS = 2500 // while typing, tell the friend at most this often
const SHOW_FOR_MS = 4500 // hide the indicator if no update arrives

// enabled = my "show when I'm typing" switch. Off means I neither send nor see it.
export function useTyping(myId, contactId, enabled) {
  const [peerTyping, setPeerTyping] = useState(false)
  const channelRef = useRef(null)
  const readyRef = useRef(false)
  const lastSent = useRef(0)
  const hideTimer = useRef(null)
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  })

  useEffect(() => {
    let cancelled = false
    let channel = null
    // Same name for both friends: the two IDs in sorted order
    const topic = `typing:${[myId, contactId].sort().join(':')}`

    ;(async () => {
      try {
        await supabase.realtime.setAuth() // needed for private channels
      } catch {
        /* the channel simply won't connect */
      }
      if (cancelled) return

      channel = supabase.channel(topic, {
        config: { private: true, broadcast: { self: false } },
      })
      channel
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (!enabledRef.current || payload?.from !== contactId) return
          clearTimeout(hideTimer.current)
          if (payload.typing) {
            setPeerTyping(true)
            hideTimer.current = setTimeout(() => setPeerTyping(false), SHOW_FOR_MS)
          } else {
            setPeerTyping(false)
          }
        })
        .subscribe((state) => {
          readyRef.current = state === 'SUBSCRIBED'
        })
      channelRef.current = channel
    })()

    return () => {
      cancelled = true
      readyRef.current = false
      clearTimeout(hideTimer.current)
      if (channel) supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [myId, contactId])

  const send = useCallback(
    (typing) => {
      const ch = channelRef.current
      if (!ch || !readyRef.current || !enabledRef.current) return
      ch.send({ type: 'broadcast', event: 'typing', payload: { from: myId, typing } })
    },
    [myId]
  )

  // Call on every keystroke: only actually sends every 2.5 seconds
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < SEND_EVERY_MS) return
    lastSent.current = now
    send(true)
  }, [send])

  // Call after sending a message
  const stopTyping = useCallback(() => {
    lastSent.current = 0
    send(false)
  }, [send])

  // Call when a message from the friend arrives
  const clearTyping = useCallback(() => {
    clearTimeout(hideTimer.current)
    setPeerTyping(false)
  }, [])

  return { peerTyping: enabled && peerTyping, notifyTyping, stopTyping, clearTyping }
}