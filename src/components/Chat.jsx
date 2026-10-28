import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDirectory } from '../lib/deviceDirectory'
import { MAX_MESSAGE_CHARS } from '../crypto/encrypt'
import { useTyping } from '../lib/useTyping'
import { REPLY_OVERHEAD, buildReply } from './chat/protocol'
import { useChatSync } from './chat/useChatSync'
import { useMarkSeen } from './chat/useMarkSeen'
import { useSendMessage } from './chat/useSendMessage'
import { visibleMessages, reactionsByMessage, lastReadId } from './chat/derive'
import MessageLine from './chat/MessageLine'
import ChatHeader from './chat/ChatHeader'
import Composer from './chat/Composer'

export default function Chat({
  myId, myName, deviceId, myPrivateKey, contact, status, expireAfter,
  shareSeen, shareTyping, onExpiryChanged, onSeen, onBuzz, onClose,
}) {
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const [selected, setSelected] = useState(null) // the message whose Reply / React bar is open
  const [replyToId, setReplyToId] = useState(null) // msg_id of the message I'm replying to

  const listRef = useRef(null)

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

  // Reactions are not lines of their own, so they are left out of the list.
  // Memoised so the same message objects are reused until something really changes.
  const visible = useMemo(
    () => visibleMessages(messages, now, expireAfter),
    [messages, now, expireAfter]
  )
  const byMsgId = useMemo(() => new Map(visible.map((m) => [m.msgId, m])), [visible])
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

  // Composer hands me the cleaned text; I only clear its box after a successful send
  async function handleSend(t, onSent) {
    let plain = t
    if (replyTarget) {
      if (t.length > MAX_MESSAGE_CHARS - REPLY_OVERHEAD) {
        setError(`A reply can be at most ${MAX_MESSAGE_CHARS - REPLY_OVERHEAD} characters.`)
        return
      }
      plain = buildReply(replyTarget.msgId, t)
    }
    await sendMessage(plain, () => {
      onSent()
      setReplyToId(null)
      stopTyping()
    })
  }

  // Tapping my current reaction again removes it; another emoji replaces it
  function handleReact(m, emoji) {
    if (sending) return
    const next = reactionsOf.get(m.msgId)?.me === emoji ? '' : emoji
    setSelected(null)
    return sendReaction(m.msgId, next)
  }

  // Keep the newest handleReact in a ref so the function I give every
  // MessageLine never changes (otherwise React.memo could not skip them)
  const handleReactRef = useRef(handleReact)
  useEffect(() => {
    handleReactRef.current = handleReact
  })

  const onToggle = useCallback((id) => setSelected((s) => (s === id ? null : id)), [])
  const onReply = useCallback((m) => {
    setReplyToId(m.msgId)
    setSelected(null)
  }, [])
  const onReact = useCallback((m, emo) => handleReactRef.current(m, emo), [])

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
            onToggle={onToggle}
            onReply={onReply}
            onReact={onReact}
          />
        ))}
      </div>

      <div className="typing">{peerTyping ? `@${contact.username} is typing…` : ''}</div>

      <Composer
        replyTarget={replyTarget}
        contactUsername={contact.username}
        sending={sending}
        onSend={handleSend}
        onCancelReply={() => setReplyToId(null)}
        onTyping={notifyTyping}
        onBuzz={sendBuzz}
      />
      {error && <p className="msg">{error}</p>}
    </div>
  )
}