// Pure calculations on the message list. No React, no network: give them the
// same input and they always give the same output.

const toMs = (iso) => new Date(iso).getTime()

// The lines to draw: reactions are not lines of their own, and messages older
// than the chat's "disappear after" setting are hidden.
//   now: the current time in ms   expireAfter: seconds, or null for never
export function visibleMessages(messages, now, expireAfter) {
  return messages.filter(
    (m) => !m.react && (!expireAfter || toMs(m.time) > now - expireAfter * 1000)
  )
}

// Latest reaction of each person on each message:
//   msg_id -> { me: '👍', them: '' }
// (a person's newest reaction wins; an empty emoji means they removed it)
export function reactionsByMessage(messages) {
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
}

// The id of the last message (sent by `mine` = true/false) that was read at or
// before `cutoff` (ms). Returns null when there is no cutoff or nothing matches.
export function lastReadId(visible, cutoff, mine) {
  if (cutoff === null) return null
  let id = null
  for (const m of visible) {
    if (m.mine === mine && toMs(m.time) <= cutoff) id = m.id
  }
  return id
}
