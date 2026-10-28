import { memo } from 'react'
import Linkified from '../../lib/linkify'
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
//   m          the message view (see messageView.js)
//   myName, friendName
//   quoted     the message this one replies to (undefined if it isn't available)
//   reactions  { me, them } emoji for this message, or undefined
//   eye        who has "seen up to here": a name, 'You', or null
//   selected   whether the Reply / React bar is open on this message
//   onToggle(id), onReply(m), onReact(m, emoji)  -- must be stable (useCallback)
function MessageLine({
  m, myName, friendName, quoted, reactions, eye, selected, onToggle, onReply, onReact,
}) {
  if (m.buzz) {
    return (
      <div className="line system">
        📳zzz {m.mine ? 'You buzzed' : `@${friendName} buzzed you`}!
        <time>{fmt(m.time)}</time>
        <Eyes label={eye} />
      </div>
    )
  }

  const chips = reactChips(reactions, friendName)

  return (
    <div className={`line ${selected ? 'selected' : ''}`} onClick={() => onToggle(m.id)}>
      {m.replyTo && (
        <div className="quote">
          {quoted ? (
            <>
              ↩ <strong>{quoted.mine ? 'You' : `@${friendName}`}</strong>{' '}
              {snippetOf(quoted)}
            </>
          ) : (
            <em>↩ Original message unavailable</em>
          )}
        </div>
      )}
      <span className={`nick ${m.mine ? 'me' : 'them'}`}>
        {m.mine ? myName : friendName}:
      </span>{' '}
      {m.text === null ? (
        <em className="bad">🔒 Can't decrypt this message</em>
      ) : (
        <Linkified text={stripControls(m.text)} />
      )}
      <time>{fmt(m.time)}</time>
      {m.mine && <span className="tick" title="Sent">✓</span>}
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
      {selected && m.text !== null && (
        <div className="msgbar" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="rbtn" onClick={() => onReply(m)}>
            ↩ Reply
          </button>
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