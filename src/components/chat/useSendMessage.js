import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildCopies } from '../../crypto/encrypt'
import { uploadVoice, removeVoice } from '../../crypto/voice'
import { playBuzz } from '../../lib/sounds'
import { vibrateBuzz } from '../../lib/haptics'
import { BUZZ_TOKEN, buildReaction, buildEdit, buildVoice } from './protocol'
import { toView } from './messageView'

const BUZZ_COOLDOWN_MS = 10000

// Everything about SENDING in one chat: text, buzzes, reactions, edits and voice notes.
//
//   sending                      → true while something is on its way (disable buttons)
//   sendMessage(plain, onSent)   → send text; onSent() runs only if it worked
//   sendBuzz()                   → send a buzz (with a 10 second cooldown)
//   sendReaction(msgId, emoji)   → react to a message ('' removes my reaction)
//   sendEdit(msgId, newText, onSent) → change one of my earlier messages
//   sendVoice({ blob, seconds, mime, replyTo }, onSent) → send a voice note
//
// Failures are shown through setError, so Chat can display them.
export function useSendMessage({
  myId, deviceId, myPrivateKey, contact, dir, addMessages, setError, onBuzzRef,
}) {
  const [sending, setSending] = useState(false)
  const lastBuzzSent = useRef(0)

  // Encrypt one copy per device, store them, and show my own copy right away
  async function sendText(plain, kind = 'msg') {
    // Fresh device list, so brand-new devices get this message too
    const devs = await dir.refresh()
    if (!devs.some((d) => d.user_id === contact.id)) {
      throw new Error(`@${contact.username} hasn't set up encryption on any device yet.`)
    }
    if (!devs.some((d) => d.id === deviceId)) {
      throw new Error('This device is no longer registered. Log out and log in again.')
    }

    const { msgId, rows } = await buildCopies({
      myPrivateKey,
      myId,
      myDeviceId: deviceId,
      friendId: contact.id,
      devices: devs,
      text: plain,
      kind,
    })

    // All copies go in one request, so it either all works or none of it does
    const { error } = await supabase.from('messages').insert(rows)
    if (error) throw error

    // Read back MY copy, to show it with its real id and time
    const { data, error: e2 } = await supabase
      .from('messages')
      .select('*')
      .eq('msg_id', msgId)
      .eq('target_device', deviceId)
      .single()
    if (e2) {
      e2.afterInsert = true // the message WAS sent, only showing it failed
      throw e2
    }

    const view = await toView(data, myId, myPrivateKey, dir)
    addMessages([view])
  }

  // The same routine every send follows: busy on, clear the old error,
  // do the work, show any new error, busy off.
  async function run(task) {
    setSending(true)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function sendMessage(plain, onSent) {
    return run(async () => {
      await sendText(plain)
      onSent?.()
    })
  }

  async function sendBuzz() {
    if (sending) return
    const wait = BUZZ_COOLDOWN_MS - (Date.now() - lastBuzzSent.current)
    if (wait > 0) {
      setError(`Please wait ${Math.ceil(wait / 1000)}s before buzzing again.`)
      return
    }
    await run(async () => {
      await sendText(BUZZ_TOKEN)
      lastBuzzSent.current = Date.now()
      vibrateBuzz() // the sender feels it too
      onBuzzRef.current() // and sees their own window shake
      playBuzz() // and hears the buzz sound
    })
  }

  function sendReaction(targetMsgId, emoji) {
    return run(() => sendText(buildReaction(targetMsgId, emoji), 'react'))
  }

  // Edits are stored like reactions: a hidden message of kind 'edit'
  function sendEdit(targetMsgId, newText, onSent) {
    return run(async () => {
      await sendText(buildEdit(targetMsgId, newText), 'edit')
      onSent?.()
    })
  }

  // A voice note: encrypt + upload the audio, then send the small message with its key
  function sendVoice({ blob, seconds, mime, replyTo }, onSent) {
    return run(async () => {
      const up = await uploadVoice({ blob, myId, friendId: contact.id })
      try {
        await sendText(buildVoice({ ...up, seconds, mime, replyTo }))
      } catch (err) {
        // Not stored at all: the uploaded file is useless, so remove it
        if (!err.afterInsert) await removeVoice(up.path)
        throw err
      }
      onSent?.()
    })
  }

  return { sending, sendMessage, sendBuzz, sendReaction, sendEdit, sendVoice }
}