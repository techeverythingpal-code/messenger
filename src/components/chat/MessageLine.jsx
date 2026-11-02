import { memo } from 'react'
import Linkified from '../../lib/linkify'
import VoiceBubble from './VoiceBubble'
import { REACTIONS, stripControls, snippetOf, reactChips } from './protocol'

// Built once, not on every render of every line
const timeFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const fmt = (t) => timeFmt.format(new Date(t))

// The 👁 shown under the last message each of us has read
function Eyes({ label }) {
  if (!label) return null
  return (
    <div className="eyes" title={`Seen by ${label}`}>
      👁 <span>{label}</span>
    </div>
  )
}

// One line in the chat log: a buzz notice or a message bubble.
//
// Props:
//   m          the message view (see messageView.js); m.edited is true after an edit,
//              m.voice is set for a voice note (then m.text is null)
//   myName, friendName
//   quoted     the message this one replies to (undefined if it isn't available)
//   reactions  { me, them } emoji for this message, or undefined
//   eye        who has "seen up to here": a name, 'You', or null
//   selected   whether the Reply / React bar is open on this message
//   onToggle(id), onReply(m), onReact(m, emoji), onEdit(m)  -- must be stable (useCallback)
function MessageLine({
  m, myName, friendName, quoted, reactions, eye, selected, onToggle, onReply, onReact, onEdit,
}) {
  // "mine" bubbles are drawn on the right, "theirs" on the left (see index.css)
  const side = m.mine ? 'mine' : 'theirs'

  if (m.buzz) {
    return (
      <div className={`line system ${side}`}>
        📳zzz {m.mine ? 'You buzzed' : `@${friendName} buzzed you`}!
        <time>{fmt(m.time)}</time>
        <Eyes label={eye} />
      </div>
    )
  }

  const chips = reactChips(reactions, friendName)

  return (
    <div
      className={`line ${side} ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(m.id)}
    >
      {m.replyTo && (
        <div className="quote">
          {quoted ? (
            <>
              ↩ <strong>{quoted.mine ? 'You' : `@${friendName}`}</strong>{' '}
              <bdi>{snippetOf(quoted)}</bdi>
            </>
          ) : (
            <em>↩ Original message unavailable</em>
          )}
        </div>
      )}
      {/* The name is hidden by the CSS: the side and color already show who wrote it.
          It stays OUTSIDE the dir="auto" block below, so it can't change the direction. */}
      <span className={`nick ${m.mine ? 'me' : 'them'}`}>
        {m.mine ? myName : friendName}:
      </span>
      {/* dir="auto": the first letter decides the direction. Arabic reads right to left
          and sits on the right, English left to right, and a line that mixes both
          follows the standard bidirectional rules. */}
      <div dir="auto">
        {m.voice ? (
          <VoiceBubble voice={m.voice} />
        ) : m.text === null ? (
          <em className="bad">🔒 Can't decrypt this message</em>
        ) : (
          <Linkified text={stripControls(m.text)} />
        )}
        {m.edited && <span className="muted"> (edited)</span>}{' '}
        <time>{fmt(m.time)}</time>
        {m.mine && (
          <>
            {' '}
            <span className="tick" title="Sent">✓</span>
          </>
        )}
      </div>
      {chips.length > 0 && (
        <div className="reacts">
          {chips.map((c) => (
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
      {/* Voice notes can be replied to and reacted to, but not edited */}
      {selected && (m.text !== null || m.voice) && (
        <div className="msgbar" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="rbtn" onClick={() => onReply(m)}>
            ↩ Reply
          </button>
          {m.mine && !m.voice && (
            <button type="button" className="rbtn" onClick={() => onEdit(m)}>
              ✏️ Edit
            </button>
          )}
          {REACTIONS.map((emo) => (
            <button
              key={emo}
              type="button"
              className={`rbtn ${reactions?.me === emo ? 'on' : ''}`}
              onClick={() => onReact(m, emo)}
            >
              {emo}
            </button>
          ))}
        </div>
      )}
      <Eyes label={eye} />
    </div>
  )
}

export default memo(MessageLine)