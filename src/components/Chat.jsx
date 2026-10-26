import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createDirectory } from '../lib/deviceDirectory'
import { decryptMessage, buildCopies, MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { fingerprint } from '../crypto/keys'
import { withEmoticons, PICKER } from '../lib/emoticons'
import { playMessage, playBuzz } from '../lib/sounds'
import { vibrateBuzz, vibrateMessage } from '../lib/haptics'
import { onRefresh } from '../lib/refresh'
import { useTyping } from '../lib/useTyping'

// A buzz is an ordinary encrypted message with this reserved text,
// so the server can't tell a buzz from any other message.
const BUZZ_TOKEN = '\u0000BUZZ'
const BUZZ_COOLDOWN_MS = 10000
const SHAKE_THROTTLE_MS = 5000

// Replies and reactions are also ordinary encrypted text with a reserved start:
//   reply:    \u0000REPLY<msg_id>\u0000<text>
//   reaction: \u0000REACT<msg_id>\u0000<emoji>   (empty emoji = remove my reaction)
// People can't type control characters (see stripControls), so these can't be faked.
const REPLY_PREFIX = '\u0000REPLY'
const REACT_PREFIX = '\u0000REACT'
const REPLY_OVERHEAD = REPLY_PREFIX.length + 36 + 1
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

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

// Turn decrypted text into what it really is: text, buzz, reply or reaction
function parsePlain(text) {
  if (text === null) return { type: 'bad', text: null }
  if (text === BUZZ_TOKEN) return { type: 'buzz', text }
  const isReply = text.startsWith(REPLY_PREFIX)
  const isReact = text.startsWith(REACT_PREFIX)
  if (!isReply && !isReact) return { type: 'text', text }

  const rest = text.slice(isReply ? REPLY_PREFIX.length : REACT_PREFIX.length)
  const id = rest.slice(0, 36)
  if (UUID_RE.test(id) && rest[36] === '\u0000') {
    const body = rest.slice(37)
    if (isReply) return { type: 'reply', text: body, replyTo: id }
    if (body === '' || REACTIONS.includes(body)) {
      return { type: 'react', text: null, target: id, emoji: body }
    }
  }
  return { type: 'bad', text: null } // a format this version doesn't understand
}

// A short one-line preview of a message, for reply quotes
function snippetOf(m) {
  if (m.buzz) return '📳 Buzz'
  if (m.text === null) return "🔒 Can't decrypt"
  const t = stripControls(m.text).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

// Group my reaction and my friend's reaction into chips: [{ emoji, who: [...] }]
function reactChips(r, friendName) {
  if (!r) return []
  const by = new Map()
  if (r.me) by.set(r.me, ['You'])
  if (r.them) by.set(r.them, [...(by.get(r.them) || []), `@${friendName}`])
  return [...by].map(([emoji, who]) => ({ emoji, who }))
}

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
  const plain = senderKey
    ? await decryptMessage(myPrivateKey, senderKey, metaOf(row), row)
    : null
  const p = parsePlain(plain)
  return {
    id: row.id,
    msgId: row.msg_id,
    mine: row.sender_id === myId,
    text: p.text,
    buzz: p.type === 'buzz',
    replyTo: p.replyTo ?? null,
    react: p.type === 'react' ? { target: p.target, emoji: p.emoji } : null,
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
  shareSeen, shareTyping, onExpiryChanged, onSeen, onBuzz, onClose,
}) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [contactDevices, setContactDevices] = useState([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [notice, setNotice] = useState('')
  const [readUntil, setReadUntil] = useState(null) // when my friend last read my messages
  const [myReadUntil, setMyReadUntil] = useState(null) // when I last read my friend's messages
  const [selected, setSelected] = useState(null) // the message whose Reply / React bar is open
  const [replyToId, setReplyToId] = useState(null) // msg_id of the message I'm replying to

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const lastBuzzSent = useRef(0)
  const lastBuzzShown = useRef(0)
  const lastMarkRef = useRef(0)
  const refreshRef = useRef(() => {})
  const onSeenRef = useRef(onSeen)
  const onBuzzRef = useRef(onBuzz)
  useEffect(() => {
    onSeenRef.current = onSeen
    onBuzzRef.current = onBuzz
  })

  const dir = useMemo(() => createDirectory(myId, contact.id), [myId, contact.id])
  const { peerTyping, notifyTyping, stopTyping, clearTyping } = useTyping(
    myId,
    contact.id,
    shareTyping
  )

  // Re-check every 30 seconds so expired messages disappear from the screen
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  // Reactions are not lines of their own, so they are left out of the list
  const visible = messages.filter(
    (m) => !m.react && (!expireAfter || new Date(m.time).getTime() > now - expireAfter * 1000)
  )
  const byMsgId = new Map(visible.map((m) => [m.msgId, m]))
  const replyTarget = replyToId ? byMsgId.get(replyToId) : null

  // Latest reaction of each person on each message: msg_id -> { me, them }
  const reactionsOf = useMemo(() => {
    const latest = new Map()
    for (const m of messages) {
      if (m.react) latest.set(`${m.react.target}|${m.mine}`, m.react.emoji)
    }
    const out = new Map()
    for (const [key, emoji] of latest) {
      if (!emoji) continue
      const [target, mine] = key.split('|')
      const cur = out.get(target) || { me: '', them: '' }
      if (mine === 'true') cur.me = emoji
      else cur.them = emoji
      out.set(target, cur)
    }
    return out
  }, [messages])

  // Seen ticks only show if I share my own receipts too
  const seenCutoff = shareSeen ? readUntil : null

  // Teams-style eyes: one 👁 under the last message each of us has read
  function lastReadId(cutoff, mine) {
    if (cutoff === null) return null
    let id = null
    for (const m of visible) {
      if (m.mine === mine && new Date(m.time).getTime() <= cutoff) id = m.id
    }
    return id
  }
  const friendEyeId = lastReadId(seenCutoff, true) // my last message my friend read
  const myEyeId = lastReadId(shareSeen ? myReadUntil : null, false) // their last message I read
  const eyeLabel = (m) =>
    m.id === friendEyeId ? `@${contact.username}` : m.id === myEyeId ? 'You' : null

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

        // When did my friend last read my messages?
        const { data: mark } = await supabase
          .from('read_marks')
          .select('read_until')
          .eq('reader_id', contact.id)
          .eq('peer_id', myId)
          .maybeSingle()
        if (!cancelled) setReadUntil(mark ? new Date(mark.read_until).getTime() : null)

        // When did I last read my friend's messages?
        const { data: myMark } = await supabase
          .from('read_marks')
          .select('read_until')
          .eq('reader_id', myId)
          .eq('peer_id', contact.id)
          .maybeSingle()
        if (!cancelled) setMyReadUntil(myMark ? new Date(myMark.read_until).getTime() : null)
      } catch (err) {
        if (!cancelled && !quiet) setError(err.message)
      }
    }
    loadHistory()
    refreshRef.current = () => loadHistory(true)

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
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'read_marks',
          filter: `reader_id=eq.${contact.id}`,
        },
        (payload) => {
          const row = payload.new
          if (row?.peer_id === myId && !cancelled) {
            setReadUntil(new Date(row.read_until).getTime())
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'read_marks',
          filter: `reader_id=eq.${myId}`,
        },
        (payload) => {
          const row = payload.new
          if (row?.peer_id === contact.id && !cancelled) {
            setMyReadUntil(new Date(row.read_until).getTime())
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
  }, [myId, deviceId, myPrivateKey, contact, dir, clearTyping])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Mark messages as read, but only while this tab is visible (and, for read
  // receipts, while the window is actually focused)
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
          .rpc('mark_read', { p_peer: contact.id, p_until: new Date(latest).toISOString() })
          .then(({ error }) => {
            if (error) lastMarkRef.current = 0 // try again next time
            else setMyReadUntil((prev) => Math.max(prev ?? 0, latest))
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
  }, [messages, shareSeen, contact.id])

  async function sendText(plain, kind = 'msg') {
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
      kind,
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
    let plain = t
    if (replyTarget) {
      if (t.length > MAX_MESSAGE_CHARS - REPLY_OVERHEAD) {
        setError(`A reply can be at most ${MAX_MESSAGE_CHARS - REPLY_OVERHEAD} characters.`)
        return
      }
      plain = `${REPLY_PREFIX}${replyTarget.msgId}\u0000${t}`
    }
    setSending(true)
    setError('')
    try {
      await sendText(plain)
      setText('')
      setReplyToId(null)
      stopTyping()
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
              {eyeLabel(m) && (
                <div className="eyes" title={`Seen by ${eyeLabel(m)}`}>
                  👁 <span>{eyeLabel(m)}</span>
                </div>
              )}
            </div>
          ) : (
            <div
              key={m.id}
              className={`line ${selected === m.id ? 'selected' : ''}`}
              onClick={() => setSelected((s) => (s === m.id ? null : m.id))}
            >
              {m.replyTo && (
                <div className="quote">
                  {byMsgId.get(m.replyTo) ? (
                    <>
                      ↩ <strong>{byMsgId.get(m.replyTo).mine ? 'You' : `@${contact.username}`}</strong>{' '}
                      {snippetOf(byMsgId.get(m.replyTo))}
                    </>
                  ) : (
                    <em>↩ Original message unavailable</em>
                  )}
                </div>
              )}
              <span className={`nick ${m.mine ? 'me' : 'them'}`}>
                {m.mine ? myName : contact.username}:
              </span>{' '}
              {m.text === null ? (
                <em className="bad">🔒 Can't decrypt this message</em>
              ) : (
                withEmoticons(stripControls(m.text))
              )}
              <time>{fmt(m.time)}</time>
              {m.mine && (
                <span className="tick" title="Sent">✓</span>
              )}
              {reactChips(reactionsOf.get(m.msgId), contact.username).length > 0 && (
                <div className="reacts">
                  {reactChips(reactionsOf.get(m.msgId), contact.username).map((c) => (
                    <span
                      key={c.emoji}
                      className={`react ${c.who.includes('You') ? 'mine' : ''}`}
                      title={c.who.join(', ')}
                    >
                      {c.emoji}
                      {c.who.length > 1 ? ` ${c.who.length}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {selected === m.id && m.text !== null && (
                <div className="msgbar" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="rbtn" onClick={() => startReply(m)}>
                    ↩ Reply
                  </button>
                  {REACTIONS.map((emo) => (
                    <button
                      key={emo}
                      type="button"
                      className={`rbtn ${reactionsOf.get(m.msgId)?.me === emo ? 'on' : ''}`}
                      onClick={() => handleReact(m, emo)}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              )}
              {eyeLabel(m) && (
                <div className="eyes" title={`Seen by ${eyeLabel(m)}`}>
                  👁 <span>{eyeLabel(m)}</span>
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="typing">{peerTyping ? `@${contact.username} is typing…` : ''}</div>

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

      {replyTarget && (
        <div className="replybar">
          <span>
            ↩ Replying to{' '}
            <strong>{replyTarget.mine ? 'yourself' : `@${contact.username}`}</strong>:{' '}
            {snippetOf(replyTarget)}
          </span>
          <button type="button" className="rbtn" onClick={() => setReplyToId(null)}>
            ✕
          </button>
        </div>
      )}

      <form className="row" onSubmit={handleSend}>
        <input
          ref={inputRef}
          placeholder="Type a message"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) notifyTyping()
          }}
          maxLength={replyTarget ? MAX_MESSAGE_CHARS - REPLY_OVERHEAD : MAX_MESSAGE_CHARS}
          autoComplete="off"
        />
        <button type="submit" disabled={sending}>Send</button>
      </form>
      {error && <p className="msg">{error}</p>}
    </div>
  )
}