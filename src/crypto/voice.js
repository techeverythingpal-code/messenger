import { supabase } from '../lib/supabase'
import { toB64, fromB64 } from './encrypt'

const enc = new TextEncoder()

export const MAX_VOICE_SECONDS = 120 // 2 minutes
export const MAX_VOICE_BYTES = 3 * 1024 * 1024 - 1024 // the bucket allows 3 MB per file
const BUCKET = 'voice'

// Binds the encrypted file to its own path, so it can't be moved to another message
const aad = (path) => enc.encode(`voice-v1|${path}`)

// Encrypt a recording with a brand-new random key and upload it.
// Returns what the friend needs to open it: the file path, the key and the iv.
// (These go INSIDE the normal end-to-end encrypted message, never to the server.)
export async function uploadVoice({ blob, myId, friendId }) {
  if (!blob || blob.size === 0) throw new Error('The recording is empty')
  if (blob.size > MAX_VOICE_BYTES) throw new Error('The voice note is too large')

  const path = `${myId}/${friendId}/${crypto.randomUUID()}`
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(path) },
    key,
    await blob.arrayBuffer()
  )
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([sealed], { type: 'application/octet-stream' }), {
      contentType: 'application/octet-stream',
      upsert: false,
    })
  if (error) throw new Error(error.message || 'Could not upload the voice note')

  return { path, key: toB64(rawKey), iv: toB64(iv) }
}

// Download and decrypt a voice note. Returns an audio Blob of the given type.
export async function downloadVoice({ path, key, iv, mime }) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('Could not download the voice note')

  try {
    const aesKey = await crypto.subtle.importKey('raw', fromB64(key), 'AES-GCM', false, [
      'decrypt',
    ])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv), additionalData: aad(path) },
      aesKey,
      await data.arrayBuffer()
    )
    return new Blob([plain], { type: mime })
  } catch {
    throw new Error("Can't decrypt this voice note")
  }
}

// Remove an uploaded file (used when sending the message failed afterwards)
export async function removeVoice(path) {
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch {
    /* an orphan file is harmless: it is encrypted */
  }
}