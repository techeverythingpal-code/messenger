import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createDirectory } from '../lib/deviceDirectory'
import { buildCopies, MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { PICKER } from '../lib/emoticons'
import { playBuzz } from '../lib/sounds'
import { vibrateBuzz } from '../lib/haptics'
import { useTyping } from '../lib/useTyping'
import {
  BUZZ_TOKEN, REPLY_OVERHEAD,
  stripControls, snippetOf, buildReply, buildReaction,
} from './chat/protocol'
import { toView } from './chat/messageView'
import { useChatSync } from './chat/useChatSync'
import MessageLine from './chat/MessageLine'
import ChatHeader from './chat/ChatHeader'
const BUZZ_COOLDOWN_MS = 10000







export default function Chat({
  myId, myName, deviceId, myPrivateKey, contact, status, expireAfter,
  shareSeen, shareTyping, onExpiryChanged, onSeen, onBuzz, onClose,
}) {
 
  const [text, setText] = useState('')
  
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  
  
  
  const [selected, setSelected] = useState(null) // the message whose Reply / React bar is open
  const [replyToId, setReplyToId] = useState(null) // msg_id of the message I'm replying to

  const listRef = useRef(null)
  const inputRef = useRef(null)
  const lastBuzzSent = useRef(0)
  
  const lastMarkRef = useRef(0)
  
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

  const {
    messages, contactDevices, notice, readUntil, myReadUntil,
    addMessages, bumpMyReadUntil, clearNotice,
  } = useChatSync({
    myId, deviceId, myPrivateKey, contact, dir, clearTyping, onBuzzRef, onError: setError,
  })

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
  },   [messages, shareSeen, contact.id, bumpMyReadUntil])

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
      addMessages([view])
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
      plain = buildReply(replyTarget.msgId, t)
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
      vibrateBuzz() // the sender feels it too
      onBuzzRef.current() // and sees their own window shake
      playBuzz() // and hears the buzz sound
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function startReply(m) {
    setReplyToId(m.msgId)
    setSelected(null)
    inputRef.current?.focus()
  }

  // Tapping my current reaction again removes it; another emoji replaces it
  async function handleReact(m, emoji) {
    if (sending) return
    const next = reactionsOf.get(m.msgId)?.me === emoji ? '' : emoji
    setSelected(null)
    setSending(true)
    setError('')
    try {
      await sendText(buildReaction(m.msgId, next), 'react')
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

  

  return (
    <div>
            <ChatHeader
        contact={contact}
        status={status}
        contactDevices={contactDevices}
        notice={notice}
        expireAfter={expireAfter}
        onDismissNotice={clearNotice}
        onExpiryChanged={onExpiryChanged}
        onError={setError}
        onClose={onClose}
      />

      <div className="log" ref={listRef}>
        {visible.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
               {visible.map((m) => (
          <MessageLine
            key={m.id}
            m={m}
            myName={myName}
            friendName={contact.username}
            quoted={m.replyTo ? byMsgId.get(m.replyTo) : undefined}
            reactions={reactionsOf.get(m.msgId)}
            eye={eyeLabel(m)}
            selected={selected === m.id}
            onToggle={() => setSelected((s) => (s === m.id ? null : m.id))}
            onReply={() => startReply(m)}
            onReact={(emo) => handleReact(m, emo)}
          />
        ))}
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