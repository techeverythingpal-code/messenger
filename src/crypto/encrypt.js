const enc = new TextEncoder()
const dec = new TextDecoder()

export const MAX_MESSAGE_CHARS = 2000 // fits the 20,000-char ciphertext rule in the database

// ---------- base64 helpers ----------
export function toB64(bytes) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

export function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---------- shared key ----------
function importPublicKey(jwk) {
  // Keep only the fields we need; never trust extra fields from the server
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
}

// Cache: my private key -> (other device's public key -> AES key)
const cache = new WeakMap()

export async function getSharedKey(myPrivateKey, theirPublicJwk) {
  let perPeer = cache.get(myPrivateKey)
  if (!perPeer) {
    perPeer = new Map()
    cache.set(myPrivateKey, perPeer)
  }
  const id = `${theirPublicJwk.x}.${theirPublicJwk.y}`
  if (perPeer.has(id)) return perPeer.get(id)

  const theirKey = await importPublicKey(theirPublicJwk)
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirKey },
    myPrivateKey,
    256
  )
  const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: enc.encode('messenger-v1-aes-gcm'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  perPeer.set(id, aesKey)
  return aesKey
}

// Binds every copy to its message, both people and both devices, so a copy
// can't be moved to another message, conversation or device.
const aad = (m) =>
  enc.encode(
    ['v2', m.msgId, m.senderId, m.receiverId, m.senderDevice, m.targetDevice].join('|')
  )

// ---------- encrypt / decrypt ----------
// theirPublicJwk: the public key of the OTHER device
//  - when encrypting: the target device's key
//  - when decrypting: the sender device's key
export async function encryptMessage(myPrivateKey, theirPublicJwk, meta, text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Message is empty')
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Message is too long (max ${MAX_MESSAGE_CHARS} characters)`)
  }

  const key = await getSharedKey(myPrivateKey, theirPublicJwk)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(meta) },
    key,
    enc.encode(text)
  )
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv) }
}

// Returns the text, or null if it can't be decrypted or was tampered with
export async function decryptMessage(myPrivateKey, theirPublicJwk, meta, { ciphertext, iv }) {
  try {
    const key = await getSharedKey(myPrivateKey, theirPublicJwk)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv), additionalData: aad(meta) },
      key,
      fromB64(ciphertext)
    )
    return dec.decode(plain)
  } catch {
    return null
  }
}

// One message -> one encrypted copy per device (friend's devices + my own devices)
export async function buildCopies({ myPrivateKey, myId, myDeviceId, friendId, devices, text }) {
  if (!devices.length) throw new Error('No devices to encrypt for')

  const msgId = crypto.randomUUID()
  const rows = []
  for (const d of devices) {
    const meta = {
      msgId,
      senderId: myId,
      receiverId: friendId,
      senderDevice: myDeviceId,
      targetDevice: d.id,
    }
    const { ciphertext, iv } = await encryptMessage(myPrivateKey, d.public_key, meta, text)
    rows.push({
      msg_id: msgId,
      sender_id: myId,
      receiver_id: friendId,
      sender_device: myDeviceId,
      target_device: d.id,
      target_user: d.user_id,
      ciphertext,
      iv,
    })
  }
  return { msgId, rows }
}