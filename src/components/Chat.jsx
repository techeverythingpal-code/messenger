import { useEffect, useMemo, useRef, useState } from 'react'
import { createDirectory } from '../lib/deviceDirectory'
import { MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { PICKER } from '../lib/emoticons'
import { useTyping } from '../lib/useTyping'
import { REPLY_OVERHEAD, stripControls, snippetOf, buildReply } from './chat/protocol'
import { useChatSync } from './chat/useChatSync'
import { useMarkSeen } from './chat/useMarkSeen'
import { useSendMessage } from './chat/useSendMessage'
import { visibleMessages, reactionsByMessage, lastReadId } from './chat/derive'
import MessageLine from './chat/MessageLine'
import ChatHeader from './chat/ChatHeader'

export default function Chat({
  myId, myName, deviceId, myPrivateKey, contact, status, expireAfter,
  shareSeen, shareTyping, onExpiryChanged, onSeen, onBuzz, onClose,
}) {
  const [text, setText] = useState('')

  const [error, setError] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const [selected, setSelected] = useState(null) // the message whose Reply / React bar is open
  const [replyToId, setReplyToId] = useState(null) // msg_id of the message I'm replying to

  const listRef = useRef(null)
  const inputRef = useRef(null)

  const onBuzzRef = useRef(onBuzz)
  useEffect(() => {
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
  const visible = visibleMessages(messages, now, expireAfter)
  const byMsgId = new Map(visible.map((m) => [m.msgId, m]))
  const replyTarget = replyToId ? byMsgId.get(replyToId) : null

  // Latest reaction of each person on each message: msg_id -> { me, them }
  const reactionsOf = useMemo(() => reactionsByMessage(messages), [messages])

  // Seen ticks only show if I share my own receipts too
  const seenCutoff = shareSeen ? readUntil : null

  // Teams-style eyes: one 👁 under the last message each of us has read
  const friendEyeId = lastReadId(visible, seenCutoff, true) // my last message my friend read
  const myEyeId = lastReadId(visible, shareSeen ? myReadUntil : null, false) // their last message I read
  const eyeLabel = (m) =>
    m.id === friendEyeId ? `@${contact.username}` : m.id === myEyeId ? 'You' : null

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Mark messages as read, but only while this tab is visible (and, for read
  // receipts, while the window is actually focused)
  useMarkSeen({ messages, shareSeen, contactId: contact.id, onSeen, bumpMyReadUntil })

  const { sending, sendMessage, sendBuzz, sendReaction } = useSendMessage({
    myId, deviceId, myPrivateKey, contact, dir, addMessages, setError, onBuzzRef,
  })

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
    await sendMessage(plain, () => {
      setText('')
      setReplyToId(null)
      stopTyping()
    })
  }

  function startReply(m) {
    setReplyToId(m.msgId)
    setSelected(null)
    inputRef.current?.focus()
  }

  // Tapping my current reaction again removes it; another emoji replaces it
  function handleReact(m, emoji) {
    if (sending) return
    const next = reactionsOf.get(m.msgId)?.me === emoji ? '' : emoji
    setSelected(null)
    return sendReaction(m.msgId, next)
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
        <button type="button" onClick={sendBuzz} disabled={sending}>📳 Buzz!</button>
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