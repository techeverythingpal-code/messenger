// How chat messages are encoded inside the encrypted text.
//
// Everything below is ordinary encrypted text with a reserved first character
// (\u0000), so the server can't tell a buzz or a reaction from any other message:
//   buzz:     \u0000BUZZ
//   reply:    \u0000REPLY<msg_id>\u0000<text>
//   reaction: \u0000REACT<msg_id>\u0000<emoji>   (empty emoji = remove my reaction)
//   edit:     \u0000EDIT<msg_id>\u0000<new text>  (changes one of MY earlier messages)
//
// People can't type control characters (see stripControls), so these can't be faked.

export const BUZZ_TOKEN = '\u0000BUZZ'
export const REPLY_PREFIX = '\u0000REPLY'
export const REACT_PREFIX = '\u0000REACT'
export const EDIT_PREFIX = '\u0000EDIT'
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// A reply wraps the text with: prefix + 36-char msg_id + one separator
export const REPLY_OVERHEAD = REPLY_PREFIX.length + 36 + 1

// An edit wraps the new text the same way
export const EDIT_OVERHEAD = EDIT_PREFIX.length + 36 + 1

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

// Remove control characters so nobody can fake a buzz by typing or pasting it
export function stripControls(s) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if ((c >= 32 && c !== 127) || c === 10 || c === 9) out += ch
  }
  return out
}

// ---- Building (what we send) ----

export function buildReply(targetMsgId, text) {
  return `${REPLY_PREFIX}${targetMsgId}\u0000${text}`
}

export function buildReaction(targetMsgId, emoji) {
  return `${REACT_PREFIX}${targetMsgId}\u0000${emoji}`
}

export function buildEdit(targetMsgId, newText) {
  return `${EDIT_PREFIX}${targetMsgId}\u0000${newText}`
}

// ---- Parsing (what we received) ----

// Turn decrypted text into what it really is: text, buzz, reply, reaction or edit
export function parsePlain(text) {
  if (text === null) return { type: 'bad', text: null }
  if (text === BUZZ_TOKEN) return { type: 'buzz', text }
  const isReply = text.startsWith(REPLY_PREFIX)
  const isReact = text.startsWith(REACT_PREFIX)
  const isEdit = text.startsWith(EDIT_PREFIX)
  if (!isReply && !isReact && !isEdit) return { type: 'text', text }

  const prefix = isReply ? REPLY_PREFIX : isReact ? REACT_PREFIX : EDIT_PREFIX
  const rest = text.slice(prefix.length)
  const id = rest.slice(0, 36)
  if (UUID_RE.test(id) && rest[36] === '\u0000') {
    const body = rest.slice(37)
    if (isReply) return { type: 'reply', text: body, replyTo: id }
    if (isEdit) {
      if (body === '') return { type: 'bad', text: null } // an edit can't be empty
      return { type: 'edit', text: null, target: id, newText: body }
    }
    if (body === '' || REACTIONS.includes(body)) {
      return { type: 'react', text: null, target: id, emoji: body }
    }
  }
  return { type: 'bad', text: null } // a format this version doesn't understand
}

// ---- Display helpers ----

// A short one-line preview of a message, for reply quotes
export function snippetOf(m) {
  if (m.buzz) return '📳 Buzz'
  if (m.text === null) return "🔒 Can't decrypt"
  const t = stripControls(m.text).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

// Group my reaction and my friend's reaction into chips: [{ emoji, who: [...] }]
export function reactChips(r, friendName) {
  if (!r) return []
  const by = new Map()
  if (r.me) by.set(r.me, ['You'])
  if (r.them) by.set(r.them, [...(by.get(r.them) || []), `@${friendName}`])
  return [...by].map(([emoji, who]) => ({ emoji, who }))
}