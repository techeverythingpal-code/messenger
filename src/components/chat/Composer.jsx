import { useEffect, useRef, useState } from 'react'
import { MAX_MESSAGE_CHARS } from '../../crypto/encrypt'
import { PICKER } from '../../lib/emoticons'
import { REPLY_OVERHEAD, stripControls, snippetOf } from './protocol'

export default function Composer({
  replyTarget,
  contactUsername,
  sending,
  onSend,        // (text, onSent) => Promise
  onCancelReply,
  onTyping,      // notifyTyping from useTyping
  onBuzz,
}) {
  const [text, setText] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const inputRef = useRef(null)

  // Focus the box whenever a reply is started
  const replyId = replyTarget?.msgId
  useEffect(() => {
    if (replyId) inputRef.current?.focus()
  }, [replyId])

  const limit = replyTarget ? MAX_MESSAGE_CHARS - REPLY_OVERHEAD : MAX_MESSAGE_CHARS

  function handleSubmit(e) {
    e.preventDefault()
    const t = stripControls(text).trim()
    if (!t || sending) return
    onSend(t, () => setText('')) // parent calls this only after a successful send
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
    <>
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
        <button type="button" onClick={onBuzz} disabled={sending}>📳 Buzz!</button>
      </div>

      {replyTarget && (
        <div className="replybar">
          <span>
            ↩ Replying to{' '}
            <strong>{replyTarget.mine ? 'yourself' : `@${contactUsername}`}</strong>:{' '}
            {snippetOf(replyTarget)}
          </span>
          <button type="button" className="rbtn" onClick={onCancelReply}>✕</button>
        </div>
      )}

      <form className="row" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          placeholder="Type a message"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) onTyping()
          }}
          maxLength={limit}
          autoComplete="off"
        />
        <button type="submit" disabled={sending}>Send</button>
      </form>
    </>
  )
}