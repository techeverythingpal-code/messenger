import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { encryptMessage, decryptMessage, MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { fingerprint } from '../crypto/keys'

// Turn a database row into something we can display.
// The key is always derived from MY private key + the CONTACT's public key,
// for both sent and received messages.
async function toView(row, myId, myPrivateKey, contact) {
  const text = await decryptMessage(
    myPrivateKey,
    contact.public_key,
    row.sender_id,
    row.receiver_id,
    row
  )
  return { id: row.id, mine: row.sender_id === myId, text, time: row.created_at }
}

function mergeInto(prev, views) {
  const map = new Map(prev.map((m) => [m.id, m]))
  views.forEach((v) => map.set(v.id, v))
  return [...map.values()].sort((a, b) => a.id - b.id)
}

export default function Chat({ myId, myPrivateKey, contact, online, onSeen, onClose }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [fp, setFp] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef(null)
    const onSeenRef = useRef(onSeen)
  useEffect(() => {
    onSeenRef.current = onSeen
  })

  useEffect(() => {
    let cancelled = false

    fingerprint(contact.public_key).then((f) => !cancelled && setFp(f))

    async function loadHistory() {
      const pair = `and(sender_id.eq.${myId},receiver_id.eq.${contact.id}),` +
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

    // Live incoming messages (the database rules still apply to realtime)
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
          if (!cancelled) setMessages((prev) => mergeInto(prev, [view]))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [myId, myPrivateKey, contact])

  // Keep the newest message in view
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Tell the parent how far we've read (used for unread badges)
  useEffect(() => {
    if (messages.length) onSeenRef.current(messages[messages.length - 1].id)
  }, [messages])


  async function handleSend(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t || sending) return

    setSending(true)
    setError('')
    try {
      const { ciphertext, iv } = await encryptMessage(
        myPrivateKey, contact.public_key, myId, contact.id, t
      )
      const { data, error } = await supabase
        .from('messages')
        .insert({ sender_id: myId, receiver_id: contact.id, ciphertext, iv })
        .select()
        .single()
      if (error) throw error

      const view = await toView(data, myId, myPrivateKey, contact)
      setMessages((prev) => mergeInto(prev, [view]))
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <div className="chat-head">
        <strong>
  <span className={`dot ${online ? 'on' : ''}`} /> @{contact.username}
</strong>
        <button className="small" onClick={onClose}>Close</button>
      </div>

      <p className="hint">
        🔒 End-to-end encrypted. <strong>@{contact.username}'s fingerprint:</strong>
        <br />
        <code className="fp">{fp}</code>
        Compare this with them in person or by phone to be sure no one is intercepting.
      </p>

      <div className="msgs" ref={listRef}>
        {messages.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.mine ? 'mine' : 'theirs'} ${m.text === null ? 'bad' : ''}`}
          >
            {m.text === null ? "🔒 Can't decrypt this message" : m.text}
            <small>
              {new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </small>
          </div>
        ))}
      </div>

      <form className="row" onSubmit={handleSend}>
        <input
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