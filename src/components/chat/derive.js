// Pure calculations on the message list. No React, no network: give them the
// same input and they always give the same output.

const toMs = (iso) => new Date(iso).getTime()

// The lines to draw: reactions and edits are not lines of their own, and
// messages older than the chat's "disappear after" setting are hidden.
//   now: the current time in ms   expireAfter: seconds, or null for never
export function visibleMessages(messages, now, expireAfter) {
  return messages.filter(
    (m) =>
      !m.react &&
      !m.edit &&
      (!expireAfter || toMs(m.time) > now - expireAfter * 1000)
  )
}

// Apply edits to the messages they change. The newest edit wins, and an edit
// only counts if the SAME person sent it and the original (nobody can edit
// someone else's message). Edited messages get the new text and edited: true;
// every other message is returned untouched (same object).
//   messages must be oldest first (the chat list always is)
export function applyEdits(messages) {
  // Who sent each original message: msg_id -> true if it is mine
  const owner = new Map()
  for (const m of messages) {
    if (!m.react && !m.edit) owner.set(m.msgId, m.mine)
  }

  // Newest valid edit of each message: msg_id -> new text
  const latest = new Map()
  for (const m of messages) {
    if (m.edit && owner.get(m.edit.target) === m.mine) {
      latest.set(m.edit.target, m.edit.newText)
    }
  }
  if (latest.size === 0) return messages

  return messages.map((m) => {
    const newText = latest.get(m.msgId)
    if (newText === undefined || m.react || m.edit || m.buzz || m.text === null) return m
    return { ...m, text: newText, edited: true }
  })
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