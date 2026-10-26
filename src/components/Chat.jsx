import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createDirectory } from '../lib/deviceDirectory'
import { decryptMessage, buildCopies, MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { fingerprint } from '../crypto/keys'
import { withEmoticons, PICKER } from '../lib/emoticons'
import { playMessage, playBuzz } from '../lib/sounds'
import { vibrateBuzz, vibrateMessage } from '../lib/haptics'
import { onRefresh } from '../lib/refresh'

// A buzz is an ordinary encrypted message with this reserved text,
// so the server can't tell a buzz from any other message.
const BUZZ_TOKEN = '\u0000BUZZ'
const BUZZ_COOLDOWN_MS = 10000
const SHAKE_THROTTLE_MS = 5000

const EXPIRY_OPTIONS = [
  { value: 'off', label: 'Off', seconds: null },
  { value: '3600', label: '1 hour', seconds: 3600 },
  { value: '86400', label: '1 day', seconds: 86400 },
  { value: '604800', label: '7 days', seconds: 604800 },
]

// Remove control characters so nobody can fake a buzz by typing or pasting it
function stripControls(s) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if ((c >= 32 && c !== 127) || c === 10 || c === 9) out += ch
  }
  return out
}

const fmt = (t) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const metaOf = (row) => ({
  msgId: row.msg_id,
  senderId: row.sender_id,
  receiverId: row.receiver_id,
  senderDevice: row.sender_device,
  targetDevice: row.target_device,
})

// Decrypt one copy using MY device key + the SENDER DEVICE's public key
async function toView(row, myId, myPrivateKey, dir) {
  const senderKey = await dir.keyFor(row.sender_device)
  const text = senderKey
    ? await decryptMessage(myPrivateKey, senderKey, metaOf(row), row)
    : null
  return {
    id: row.id,
    mine: row.sender_id === myId,
    text,
    buzz: text === BUZZ_TOKEN,
    time: row.created_at,
  }
}

function mergeInto(prev, views) {
  const map = new Map(prev.map((m) => [m.id, m]))
  views.forEach((v) => map.set(v.id, v))
  return [...map.values()].sort((a, b) => a.id - b.id)
}

export default function Chat({
  myId, myName, deviceId, myPrivateKey, contact, status, expireAfter,
  onExpiryChanged, onSeen, onBuzz, onClose,
}) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [contactDevices, setContactDevices] = useState([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [notice, setNotice] = useState('')

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const lastBuzzSent = useRef(0)
  const lastBuzzShown = useRef(0)
  const refreshRef = useRef(() => {})
  const onSeenRef = useRef(onSeen)
  const onBuzzRef = useRef(onBuzz)
  useEffect(() => {
    onSeenRef.current = onSeen
    onBuzzRef.current = onBuzz
  })

  const dir = useMemo(() => createDirectory(myId, contact.id), [myId, contact.id])

  // Re-check every 30 seconds so expired messages disappear from the screen
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const visible = expireAfter
    ? messages.filter((m) => new Date(m.time).getTime() > now - expireAfter * 1000)
    : messages

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
      } catch (err) {
        if (!cancelled && !quiet) setError(err.message)
      }
    }
    loadHistory()
    refreshRef.current = () => loadHistory(true)

    // Live copies addressed to THIS device
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
        async (payload) => {
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
      )
      .subscribe((state) => {
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
  }, [myId, deviceId, myPrivateKey, contact, dir])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Only mark messages as read while this browser tab is actually visible
  useEffect(() => {
    function markSeen() {
      if (!document.hidden && messages.length) {
        onSeenRef.current(messages[messages.length - 1].id)
      }
    }
    markSeen()
    document.addEventListener('visibilitychange', markSeen)
    return () => document.removeEventListener('visibilitychange', markSeen)
  }, [messages])

  async function sendText(plain) {
    // Fresh device list, so brand-new devices get this message too
    const devs = await dir.refresh()
    if (!devs.some((d) => d.user_id === contact.id)) {
      throw new Error(`@${contact.username} hasn't set up encryption on any device yet.`)
    }
    if (!devs.some((d) => d.id === deviceId)) {
      throw new Error('This device is no longer registered. Log out and log in again.')
    }

    const { msgId, rows } = await buildCopies({
      myPrivateKey,
      myId,
      myDeviceId: deviceId,
      friendId: contact.id,
      devices: devs,
      text: plain,
    })

    // All copies go in one request, so it either all works or none of it does
    const { error } = await supabase.from('messages').insert(rows)
    if (error) throw error

    // Read back MY copy, to show it with its real id and time
    const { data, error: e2 } = await supabase
      .from('messages')
      .select('*')
      .eq('msg_id', msgId)
      .eq('target_device', deviceId)
      .single()
    if (e2) throw e2

    const view = await toView(data, myId, myPrivateKey, dir)
    setMessages((prev) => mergeInto(prev, [view]))
  }

  async function handleSend(e) {
    e.preventDefault()
    const t = stripControls(text).trim()
    if (!t || sending) return
    setSending(true)
    setError('')
    try {
      await sendText(t)
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleBuzz() {
    if (sending) return
    const wait = BUZZ_COOLDOWN_MS - (Date.now() - lastBuzzSent.current)
    if (wait > 0) {
      setError(`Please wait ${Math.ceil(wait / 1000)}s before buzzing again.`)
      return
    }
    setSending(true)
    setError('')
    try {
            await sendText(BUZZ_TOKEN)
      lastBuzzSent.current = Date.now()
      vibrateBuzz() // the sender feels it too
      onBuzzRef.current() // and sees their own window shake
      playBuzz()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleExpiry(e) {
    const opt = EXPIRY_OPTIONS.find((o) => o.value === e.target.value)
    if (!opt) return
    if (opt.seconds) {
      const ok = window.confirm(
        `Messages older than ${opt.label} will be deleted for BOTH of you, ` +
          `and new messages will disappear after ${opt.label}.\n\n` +
          'This cannot be undone. Continue?'
      )
      if (!ok) return
    }
    setError('')
    const { error } = await supabase.rpc('set_disappearing', {
      p_contact_id: contact.rowId,
      p_seconds: opt.seconds,
    })
    if (error) setError(error.message)
    else onExpiryChanged()
  }

  function insertEmoji(emoji) {
    const el = inputRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? start
    const next = text.slice(0, start) + emoji + text.slice(end)
    if (next.length > MAX_MESSAGE_CHARS) return
    setText(next)
    setShowPicker(false)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + emoji.length
      el?.setSelectionRange(pos, pos)
    })
  }

  const dot = status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''
  const statusText =
    status === 'available' ? 'Online' : status === 'busy' ? 'Busy' : 'Offline'

  return (
    <div>
      <div className="chat-head">
        <strong>
          <span className={`dot ${dot}`} /> @{contact.username}
        </strong>
        <span className="muted">{statusText}</span>
        <button className="small secondary" onClick={onClose}>← Back</button>
      </div>

      <details className="fpbox">
        <summary>🔒 End-to-end encrypted. Tap to verify.</summary>
        {contactDevices.length === 0 ? (
          <p>@{contact.username} hasn't set up encryption on any device yet.</p>
        ) : (
          <div>
            <p>
              @{contact.username}'s devices. Compare each fingerprint with them in
              person or by phone to be sure no one is intercepting:
            </p>
            {contactDevices.map((d) => (
              <p key={d.id}>
                <strong>{d.name}</strong>
                <code className="fp">{d.fp}</code>
              </p>
            ))}
          </div>
        )}
      </details>

      {notice && (
        <div className="warn">
          <p>⚠️ {notice}</p>
          <button className="small secondary" onClick={() => setNotice('')}>OK</button>
        </div>
      )}

      <div className="expiry">
        <label>
          ⏳ Disappearing messages{' '}
          <select
            value={expireAfter ? String(expireAfter) : 'off'}
            onChange={handleExpiry}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {expireAfter && <span className="muted">applies to both of you</span>}
      </div>

      <div className="log" ref={listRef}>
        {visible.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
        {visible.map((m) =>
          m.buzz ? (
            <div key={m.id} className="line system">
              📳 {m.mine ? 'You buzzed' : `@${contact.username} buzzed you`}!
              <time>{fmt(m.time)}</time>
            </div>
          ) : (
            <div key={m.id} className="line">
              <span className={`nick ${m.mine ? 'me' : 'them'}`}>
                {m.mine ? myName : contact.username}:
              </span>{' '}
              {m.text === null ? (
                <em className="bad">🔒 Can't decrypt this message</em>
              ) : (
                withEmoticons(stripControls(m.text))
              )}
              <time>{fmt(m.time)}</time>
            </div>
          )
        )}
      </div>

      {showPicker && (
        <div className="picker">
          {PICKER.map((emo) => (
            <button key={emo} type="button" className="emo" onClick={() => insertEmoji(emo)}>
              {emo}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar">
        <button type="button" onClick={() => setShowPicker((s) => !s)}>😊 Emoticons</button>
        <button type="button" onClick={handleBuzz} disabled={sending}>📳 Buzz!</button>
      </div>

      <form className="row" onSubmit={handleSend}>
        <input
          ref={inputRef}
          placeholder="Type a message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MESSAGE_CHARS}
          autoComplete="off"
        />
        <button type="submit" disabled={sending}>Send</button>
      </form>
      {error && <p className="msg">{error}</p>}
    </div>
  )
}