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

async function idbDelete(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const deviceKey = (userId) => `device:${userId}`
const oldKey = (userId) => `identity:${userId}` // the single-key format used before multi-device

// This device's record: { deviceId, privateKey, publicKey }
export const loadDevice = (userId) => idbGet(deviceKey(userId))
export const saveDevice = (userId, record) => idbSet(deviceKey(userId), record)
export const deleteOldIdentity = (userId) => idbDelete(oldKey(userId))

// Erases this device's keys (used by "delete account" and "register again")
export async function deleteKeyPair(userId) {
  await idbDelete(deviceKey(userId))
  await idbDelete(oldKey(userId))
}

export function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // the private key can NOT be exported
    ['deriveKey', 'deriveBits']
  )
}

export function exportPublicJwk(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey)
}

export function sameKey(a, b) {
  return !!a && !!b && a.crv === b.crv && a.x === b.x && a.y === b.y
}

// Short human-readable fingerprint, used to verify a contact's device
export async function fingerprint(jwk) {
  const canon = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon))
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 32).match(/.{4}/g).join(' ')
}