import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  // Grow (or shrink) the box to fit the text. CSS max-height stops the growth
  // and the box scrolls after that.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }, [text])

  const limit = replyTarget ? MAX_MESSAGE_CHARS - REPLY_OVERHEAD : MAX_MESSAGE_CHARS

  function handleSubmit(e) {
    e.preventDefault()
    const t = stripControls(text).trim()
    if (!t || sending) return
    onSend(t, () => setText('')) // parent calls this only after a successful send
  }

  // Desktop: Enter sends, Shift+Enter = new line.
  // Touch screens: Enter = new line (use the send button).
  function handleKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
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
    <div className="composer">
      {showPicker && (
        <div className="picker">
          {PICKER.map((emo) => (
            <button key={emo} type="button" className="emo" onClick={() => insertEmoji(emo)}>
              {emo}
            </button>
          ))}
        </div>
      )}

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
        <button
          type="button"
          className="iconbtn"
          title="Emoticons"
          aria-label="Emoticons"
          onClick={() => setShowPicker((s) => !s)}
        >
          😊
        </button>
        <button
          type="button"
          className="iconbtn"
          title="Buzz!"
          aria-label="Buzz"
          onClick={onBuzz}
          disabled={sending}
        >
          📳
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Type a message"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) onTyping()
          }}
          onKeyDown={handleKeyDown}
          maxLength={limit}
          autoComplete="off"
        />
        <button type="submit" className="sendbtn" disabled={sending} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  )
}