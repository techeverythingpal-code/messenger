const DB_NAME = 'messenger-keys'
const STORE = 'keys'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Keys are stored per user, so two accounts in one browser don't collide
const keyName = (userId) => `identity:${userId}`

export function loadKeyPair(userId) {
  return idbGet(keyName(userId))
}

export async function createKeyPair(userId) {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key can NOT be exported
    ['deriveKey', 'deriveBits']
  )
  await idbSet(keyName(userId), pair)
  return pair
}

export function exportPublicJwk(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey)
}

export function sameKey(a, b) {
  return !!a && !!b && a.crv === b.crv && a.x === b.x && a.y === b.y
}

// Short human-readable fingerprint, used later to verify a contact
export async function fingerprint(jwk) {
  const canon = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon))
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 32).match(/.{4}/g).join(' ')
}