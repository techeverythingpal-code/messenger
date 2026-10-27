import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fingerprint } from '../../crypto/keys'
import { playMessage, playBuzz } from '../../lib/sounds'
import { vibrateBuzz, vibrateMessage } from '../../lib/haptics'
import { onRefresh } from '../../lib/refresh'
import { toView, mergeInto } from './messageView'

// Show at most one buzz (sound, vibration, shake) per this many milliseconds
const SHAKE_THROTTLE_MS = 5000

const toMs = (iso) => new Date(iso).getTime()

// When did `readerId` last read `peerId`'s messages? (milliseconds, or null)
async function fetchReadMark(readerId, peerId) {
  const { data } = await supabase
    .from('read_marks')
    .select('read_until')
    .eq('reader_id', readerId)
    .eq('peer_id', peerId)
    .maybeSingle()
  return data ? toMs(data.read_until) : null
}

// Call onChange(ms) whenever `readerId` marks `peerId`'s messages as read
function watchReadMark(channel, readerId, peerId, onChange) {
  return channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'read_marks',
      filter: `reader_id=eq.${readerId}`,
    },
    (payload) => {
      const row = payload.new
      if (row?.peer_id === peerId) onChange(toMs(row.read_until))
    }
  )
}

// Keeps one chat in sync with the server:
//   - loads history and catches up after reconnects / when the app asks
//   - receives new messages live (and plays the sound / vibration / buzz)
//   - tracks when each of us last read the other's messages
//   - warns when the contact adds a new device
//
// onBuzzRef: a ref holding the function to call when a buzz arrives
// onError:   called with a message when loading history fails
export function useChatSync({
  myId, deviceId, myPrivateKey, contact, dir, clearTyping, onBuzzRef, onError,
}) {
  const [messages, setMessages] = useState([])
  const [contactDevices, setContactDevices] = useState([])
  const [notice, setNotice] = useState('')
  const [readUntil, setReadUntil] = useState(null) // when my friend last read my messages
  const [myReadUntil, setMyReadUntil] = useState(null) // when I last read my friend's messages

  const lastBuzzShown = useRef(0)
  const refreshRef = useRef(() => {})

  // Catch up whenever the app asks (tab shown, back online, notification tapped, timer)
  useEffect(() => onRefresh(() => refreshRef.current()), [])

  useEffect(() => {
    let cancelled = false
    let hadConnection = false

    // quiet = background catch-ups don't show errors (for example while offline)
    async function loadHistory(quiet = false) {
      try {
        const devs = await dir.refresh()
        const theirs = await Promise.all(
          devs
            .filter((d) => d.user_id === contact.id)
            .map(async (d) => ({ id: d.id, name: d.name, fp: await fingerprint(d.public_key) }))
        )
        if (!cancelled) setContactDevices(theirs)

        const pair =
          `and(sender_id.eq.${myId},receiver_id.eq.${contact.id}),` +
          `and(sender_id.eq.${contact.id},receiver_id.eq.${myId})`
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('target_device', deviceId)
          .or(pair)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error

        const views = await Promise.all(
          data.map((row) => toView(row, myId, myPrivateKey, dir))
        )
        if (!cancelled) setMessages((prev) => mergeInto(prev, views))

        const theirMark = await fetchReadMark(contact.id, myId) // they read mine
        if (!cancelled) setReadUntil(theirMark)
        const myMark = await fetchReadMark(myId, contact.id) // I read theirs
        if (!cancelled) setMyReadUntil(myMark)
      } catch (err) {
        if (!cancelled && !quiet) onError(err.message)
      }
    }
    loadHistory()
    refreshRef.current = () => loadHistory(true)

    // A new copy addressed to THIS device
    async function onNewRow(payload) {
      const r = payload.new
      const inThisChat =
        (r.sender_id === contact.id && r.receiver_id === myId) ||
        (r.sender_id === myId && r.receiver_id === contact.id)
      if (!inThisChat) return
      try {
        const view = await toView(r, myId, myPrivateKey, dir)
        if (cancelled) return
        setMessages((prev) => mergeInto(prev, [view]))
        if (view.mine) return // sent from another device of mine
        if (view.react) return // a reaction: no sound, it just appears on the message

        clearTyping() // a message arrived, so they're done typing

        if (view.buzz) {
          const t = Date.now()
          if (t - lastBuzzShown.current > SHAKE_THROTTLE_MS) {
            lastBuzzShown.current = t
            playBuzz()
            vibrateBuzz()
            onBuzzRef.current()
          }
        } else if (view.text !== null) {
          playMessage()
          vibrateMessage()
        }
      } catch {
        /* a message we can't process is skipped */
      }
    }

    // Live copies addressed to THIS device, and live "seen" updates
    const channel = supabase
      .channel(`chat:${deviceId}:${contact.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `target_device=eq.${deviceId}`,
        },
        onNewRow
      )
    watchReadMark(channel, contact.id, myId, (ms) => {
      if (!cancelled) setReadUntil(ms)
    })
    watchReadMark(channel, myId, contact.id, (ms) => {
      if (!cancelled) setMyReadUntil(ms)
    })
    channel.subscribe((state) => {
      // After a dropped connection comes back, fetch anything we missed
      if (state === 'SUBSCRIBED') {
        if (hadConnection) loadHistory(true)
        hadConnection = true
      }
    })

    // Warn when this contact adds a new device
    const devChannel = supabase
      .channel(`contact-devices:${contact.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'devices',
          filter: `user_id=eq.${contact.id}`,
        },
        async (payload) => {
          const d = payload.new
          try {
            const key =
              typeof d.public_key === 'string' ? JSON.parse(d.public_key) : d.public_key
            const fp = await fingerprint(key)
            if (cancelled) return
            setContactDevices((prev) =>
              prev.some((x) => x.id === d.id) ? prev : [...prev, { id: d.id, name: d.name, fp }]
            )
            setNotice(
              `@${contact.username} added a new device (${d.name}). ` +
                'Compare its fingerprint with them before trusting it.'
            )
          } catch {
            /* ignore a malformed device */
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      refreshRef.current = () => {}
      supabase.removeChannel(channel)
      supabase.removeChannel(devChannel)
    }
  }, [myId, deviceId, myPrivateKey, contact, dir, clearTyping, onBuzzRef, onError])

  // Small stable helpers, so Chat never touches the setters directly
  const addMessages = useCallback(
    (views) => setMessages((prev) => mergeInto(prev, views)),
    []
  )
  const bumpMyReadUntil = useCallback(
    (ms) => setMyReadUntil((prev) => Math.max(prev ?? 0, ms)),
    []
  )
  const clearNotice = useCallback(() => setNotice(''), [])

  return {
    messages, contactDevices, notice, readUntil, myReadUntil,
    addMessages, bumpMyReadUntil, clearNotice,
  }
}