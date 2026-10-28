import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getJSON, setJSON } from './storage'
import { playMessage } from './sounds'
import { vibrateMessage } from './haptics'
import { setTabBadge } from './tabBadge'

// "Last message I've read" per contact, kept on this device only
const readMap = (userId) => getJSON(`lastread:${userId}`, {})
const writeMap = (userId, map) => setJSON(`lastread:${userId}`, map)

// Tracks how many unread messages each contact has sent me.
//   unread  → { [contactId]: count }
//   markRead(contactId, msgId) → call when a message has been seen
//   refreshUnread() → re-count from the database
//   totalUnread → sum over all friends
export function useUnread({ userId, deviceId, ready, openContactId, friends }) {
  const [unread, setUnread] = useState({})

  // The realtime handler below lives longer than one render, so it reads the
  // currently open chat through a ref instead of a (stale) variable.
  const openRef = useRef(null)
  useEffect(() => {
    openRef.current = openContactId
  }, [openContactId])

  const markRead = useCallback(
    (contactId, msgId) => {
      const map = readMap(userId)
      if ((map[contactId] ?? 0) < msgId) {
        map[contactId] = msgId
        writeMap(userId, map)
      }
      setUnread((prev) => (prev[contactId] ? { ...prev, [contactId]: 0 } : prev))
    },
    [userId]
  )

  const refreshUnread = useCallback(() => {
    if (!deviceId) return Promise.resolve()
    return supabase
      .from('messages')
      .select('id, sender_id')
      .eq('target_device', deviceId)
      .neq('sender_id', userId)
      .eq('kind', 'msg') // reactions are not unread messages
      .order('id', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!data) return
        const map = readMap(userId)
        const counts = {}
        for (const m of data) {
          if (m.sender_id === openRef.current) continue // the open chat marks its own messages read
          if (m.id > (map[m.sender_id] ?? 0)) {
            counts[m.sender_id] = (counts[m.sender_id] || 0) + 1
          }
        }
        setUnread(counts)
      })
  }, [userId, deviceId])

  // Count once as soon as the app is ready
  useEffect(() => {
    if (ready) refreshUnread()
  }, [ready, refreshUnread])

  // New messages while this device is open
  useEffect(() => {
    if (!ready) return
    const channel = supabase
      .channel(`inbox:${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `target_device=eq.${deviceId}`,
        },
        (payload) => {
          const sender = payload.new.sender_id
          if (sender === userId) return // sent from another device of mine
          if (payload.new.kind === 'react') return // reactions are not new messages

          const chatOpen = openRef.current === sender
          // An open chat only counts as read while you can actually see this tab
          if (chatOpen && !document.hidden) return

          setUnread((prev) => ({ ...prev, [sender]: (prev[sender] || 0) + 1 }))
          if (!chatOpen) {
            playMessage() // an open chat plays its own sound and vibration
            vibrateMessage()
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [ready, userId, deviceId])

  // Unread total: browser tab title and tab icon badge
  const totalUnread = friends.reduce((n, f) => n + (unread[f.id] || 0), 0)
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Millennials Messenger` : 'Millennials Messenger'
    setTabBadge(totalUnread)
  }, [totalUnread])

  return { unread, totalUnread, markRead, refreshUnread }
}
