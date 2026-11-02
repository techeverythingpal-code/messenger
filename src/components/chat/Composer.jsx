import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_MESSAGE_CHARS } from '../../crypto/encrypt'
import { MAX_VOICE_SECONDS } from '../../crypto/voice'
import { PICKER } from '../../lib/emoticons'
import { EDIT_OVERHEAD, REPLY_OVERHEAD, stripControls, snippetOf } from './protocol'
import { useVoiceRecorder } from './useVoiceRecorder'

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function Composer({
  replyTarget,
  editTarget,    // the message I'm editing (null when not editing)
  contactUsername,
  sending,
  onSend,        // (text, onSent) => Promise
  onVoice,       // ({ blob, seconds, mime }) => Promise
  onCancelReply,
  onCancelEdit,
  onTyping,      // notifyTyping from useTyping
  onBuzz,
}) {
  const [text, setText] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const inputRef = useRef(null)

  const voice = useVoiceRecorder({ onError: setVoiceError })
  const { recording, cancel: cancelRecording } = voice

  // Focus the box whenever a reply is started
  const replyId = replyTarget?.msgId
  useEffect(() => {
    if (replyId) inputRef.current?.focus()
  }, [replyId])

  // Keep the newest text of the message being edited (declared before the
  // effect below, so it is already up to date when that effect runs)
  const editTextRef = useRef('')
  useEffect(() => {
    editTextRef.current = editTarget?.text ?? ''
  })

  // When an edit starts: throw away any recording, put the message's text in
  // the box, cursor at the end
  const editId = editTarget?.msgId
  useEffect(() => {
    if (!editId) return
    cancelRecording()
    setText(editTextRef.current)
    const el = inputRef.current
    el?.focus()
    requestAnimationFrame(() => {
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [editId, cancelRecording])

  // Grow (or shrink) the box to fit the text. CSS max-height stops the growth
  // and the box scrolls after that.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }, [text, recording])

  const limit = editTarget
    ? MAX_MESSAGE_CHARS - EDIT_OVERHEAD
    : replyTarget
      ? MAX_MESSAGE_CHARS - REPLY_OVERHEAD
      : MAX_MESSAGE_CHARS

  // The send button becomes a 🎤 when the box is empty (not while editing)
  const showMic = voice.supported && !editTarget && stripControls(text).trim() === ''

  function handleSubmit(e) {
    e.preventDefault()
    const t = stripControls(text).trim()
    if (!t || sending) return
    onSend(t, () => setText('')) // parent calls this only after a successful send
  }

  function cancelEdit() {
    setText('')
    onCancelEdit()
  }

  // Desktop: Enter sends, Shift+Enter = new line.
  // Touch screens: Enter = new line (use the send button).
  // Esc cancels an edit.
  function handleKeyDown(e) {
    if (e.key === 'Escape' && editTarget) {
      e.preventDefault()
      cancelEdit()
      return
    }
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
    if (next.length > limit) return
    setText(next)
    setShowPicker(false)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + emoji.length
      el?.setSelectionRange(pos, pos)
    })
  }

  function startRecording() {
    if (sending) return
    setVoiceError('')
    setShowPicker(false)
    voice.start()
  }

  // Stop the recording and send it (errors while sending show under the chat)
  async function sendRecording() {
    if (sending) return
    const rec = await voice.stop()
    if (rec) await onVoice(rec)
  }

  const atLimit = voice.seconds >= MAX_VOICE_SECONDS

  return (
    <div className="composer">
      {showPicker && !recording && (
        <div className="picker">
          {PICKER.map((emo) => (
            <button key={emo} type="button" className="emo" onClick={() => insertEmoji(emo)}>
              {emo}
            </button>
          ))}
        </div>
      )}

      {editTarget ? (
        <div className="replybar">
          <span>✏️ Editing message: <bdi>{snippetOf(editTarget)}</bdi></span>
          <button type="button" className="rbtn" title="Cancel (Esc)" onClick={cancelEdit}>
            ✕
          </button>
        </div>
      ) : (
        replyTarget && (
          <div className="replybar">
            <span>
              ↩ Replying to{' '}
              <strong>{replyTarget.mine ? 'yourself' : `@${contactUsername}`}</strong>:{' '}
              <bdi>{snippetOf(replyTarget)}</bdi>
            </span>
            <button type="button" className="rbtn" onClick={onCancelReply}>✕</button>
          </div>
        )
      )}

      {voiceError && <div className="voiceerr">{voiceError}</div>}

      {recording ? (
        // While recording: 🗑 throws it away, the timer runs, ➤ sends it
        <div className="row recbar" dir="ltr">
          <button
            type="button"
            className="iconbtn"
            title="Delete recording"
            aria-label="Delete recording"
            onClick={cancelRecording}
          >
            🗑
          </button>
          <span className={`recdot ${atLimit ? 'done' : ''}`} aria-hidden="true" />
          <span className="rectime" aria-live="polite">
            {clock(voice.seconds)} / {clock(MAX_VOICE_SECONDS)}
          </span>
          <span className="rechint">{atLimit ? 'Max length reached' : 'Recording…'}</span>
          <button
            type="button"
            className="sendbtn"
            onClick={sendRecording}
            disabled={sending}
            aria-label="Send voice note"
          >
            ➤
          </button>
        </div>
      ) : (
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
          {/* dir="auto": the box follows the first letter you type. Arabic flips it to
              right to left, English keeps it left to right. */}
          <textarea
            ref={inputRef}
            dir="auto"
            rows={1}
            placeholder={editTarget ? 'Edit your message' : 'Type a message'}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value && !editTarget) onTyping()
            }}
            onKeyDown={handleKeyDown}
            maxLength={limit}
            autoComplete="off"
          />
          {showMic ? (
            <button
              type="button"
              className="sendbtn"
              title="Record a voice note"
              aria-label="Record a voice note"
              onClick={startRecording}
              disabled={sending}
            >
              🎤
            </button>
          ) : (
            <button
              type="submit"
              className="sendbtn"
              disabled={sending}
              aria-label={editTarget ? 'Save edit' : 'Send'}
            >
              {editTarget ? '✓' : '➤'}
            </button>
          )}
        </form>
      )}
    </div>
  )
}