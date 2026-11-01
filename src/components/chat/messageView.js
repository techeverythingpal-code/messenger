// Turning database rows into messages the screen can show.
//
// A "view" is what Chat renders:
//   { id, msgId, mine, text, buzz, voice, replyTo, react, edit, time }
//   - react is { target, emoji } for a reaction, otherwise null
//   - edit is { target, newText } for an edit of an earlier message, otherwise null
//   - voice is { path, key, iv, seconds, mime } for a voice note, otherwise null
//   - text is null when the message couldn't be decrypted (or is not text)

import { decryptMessage } from '../../crypto/encrypt'
import { parsePlain } from './protocol'

// The parts of a row that are bound into the encryption (so they can't be swapped)
const metaOf = (row) => ({
  msgId: row.msg_id,
  senderId: row.sender_id,
  receiverId: row.receiver_id,
  senderDevice: row.sender_device,
  targetDevice: row.target_device,
})

// Decrypt one copy using MY device key + the SENDER DEVICE's public key
export async function toView(row, myId, myPrivateKey, dir) {
  const senderKey = await dir.keyFor(row.sender_device)
  const plain = senderKey
    ? await decryptMessage(myPrivateKey, senderKey, metaOf(row), row)
    : null
  const p = parsePlain(plain)
  return {
    id: row.id,
    msgId: row.msg_id,
    mine: row.sender_id === myId,
    text: p.text,
    buzz: p.type === 'buzz',
    voice: p.type === 'voice' ? p.voice : null,
    replyTo: p.replyTo ?? null,
    react: p.type === 'react' ? { target: p.target, emoji: p.emoji } : null,
    edit: p.type === 'edit' ? { target: p.target, newText: p.newText } : null,
    time: row.created_at,
  }
}

// Add new views to the list (replacing any with the same id), oldest first
export function mergeInto(prev, views) {
  const map = new Map(prev.map((m) => [m.id, m]))
  views.forEach((v) => map.set(v.id, v))
  return [...map.values()].sort((a, b) => a.id - b.id)
}