import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { encryptMessage, decryptMessage, MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { fingerprint } from '../crypto/keys'
import { withEmoticons, PICKER } from '../lib/emoticons'
import { playMessage, playBuzz } from '../lib/sounds'

// A buzz is an ordinary encrypted message with this reserved text,
// so the server can't tell a buzz from any other message.
const BUZZ_TOKEN = '\u0000BUZZ'
const BUZZ_COOLDOWN_MS = 10000 // you can buzz once per 10 seconds
const SHAKE_THROTTLE_MS = 5000 // incoming buzzes shake the window at most once per 5 seconds

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

async function toView(row, myId, myPrivateKey, contact) {
  const text = await decryptMessage(
    myPrivateKey,
    contact.public_key,
    row.sender_id,
    row.receiver_id,
    row
  )
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
  myId, myName, myPrivateKey, contact, status, onSeen, onBuzz, onClose,
}) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [fp, setFp] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const lastBuzzSent = useRef(0)
  const lastBuzzShown = useRef(0)
  const onSeenRef = useRef(onSeen)
  const onBuzzRef = useRef(onBuzz)
  useEffect(() => {
    onSeenRef.current = onSeen
    onBuzzRef.current = onBuzz
  })

  useEffect(() => {
    let cancelled = false

    fingerprint(contact.public_key).then((f) => !cancelled && setFp(f))

    async function loadHistory() {
      const pair =
        `and(sender_id.eq.${myId},receiver_id.eq.${contact.id}),` +
        `and(sender_id.eq.${contact.id},receiver_id.eq.${myId})`
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(pair)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) {
        if (!cancelled) setError(error.message)
        return
      }
      const views = await Promise.all(
        data.map((row) => toView(row, myId, myPrivateKey, contact))
      )
      if (!cancelled) setMessages((prev) => mergeInto(prev, views))
    }
    loadHistory()

    const channel = supabase
      .channel(`chat:${myId}:${contact.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${myId}`,
        },
        async (payload) => {
          if (payload.new.sender_id !== contact.id) return
          const view = await toView(payload.new, myId, myPrivateKey, contact)
          if (cancelled) return
          setMessages((prev) => mergeInto(prev, [view]))

          if (view.buzz) {
            const now = Date.now()
            if (now - lastBuzzShown.current > SHAKE_THROTTLE_MS) {
              lastBuzzShown.current = now
              playBuzz()
              onBuzzRef.current()
            }
          } else if (view.text !== null) {
            playMessage()
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [myId, myPrivateKey, contact])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (messages.length) onSeenRef.current(messages[messages.length - 1].id)
  }, [messages])

  async function sendText(plain) {
    const { ciphertext, iv } = await encryptMessage(
      myPrivateKey, contact.public_key, myId, contact.id, plain
    )
    const { data, error } = await supabase
      .from('messages')
      .insert({ sender_id: myId, receiver_id: contact.id, ciphertext, iv })
      .select()
      .single()
    if (error) throw error
    const view = await toView(data, myId, myPrivateKey, contact)
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
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
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
        <p>
          @{contact.username}'s fingerprint:
          <code className="fp">{fp}</code>
          Compare it with them in person or by phone to be sure no one is intercepting.
        </p>
      </details>

      <div className="log" ref={listRef}>
        {messages.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
        {messages.map((m) =>
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