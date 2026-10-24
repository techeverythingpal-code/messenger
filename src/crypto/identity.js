import { supabase } from '../lib/supabase'
import {
  loadKeyPair,
  createKeyPair,
  exportPublicJwk,
  sameKey,
  fingerprint,
} from './keys'

async function savePublicKey(userId, jwk) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, public_key: jwk })
  if (error) throw error
}

async function createAndPublish(userId) {
  const pair = await createKeyPair(userId)
  const jwk = await exportPublicJwk(pair.publicKey)
  await savePublicKey(userId, jwk)
  return { status: 'ok', fingerprint: await fingerprint(jwk) }
}

async function run(userId) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error

  const serverKey = profile?.public_key ?? null
  const pair = await loadKeyPair(userId)

  // First time ever: make keys and publish
  if (!pair && !serverKey) return createAndPublish(userId)

  if (pair) {
    const localJwk = await exportPublicJwk(pair.publicKey)

    // Local key exists but the server has none yet: publish it
    if (!serverKey) {
      await savePublicKey(userId, localJwk)
      return { status: 'ok', fingerprint: await fingerprint(localJwk) }
    }

    // Everything matches
    if (sameKey(localJwk, serverKey)) {
      return { status: 'ok', fingerprint: await fingerprint(localJwk) }
    }
  }

  // Server has a key this device doesn't hold (new device, or browser data cleared)
  return {
    status: 'conflict',
    fingerprint: serverKey ? await fingerprint(serverKey) : null,
  }
}

// Prevents double key creation when React runs effects twice in dev mode
const inflight = new Map()
export function ensureIdentity(userId) {
  if (!inflight.has(userId)) {
    inflight.set(userId, run(userId).finally(() => inflight.delete(userId)))
  }
  return inflight.get(userId)
}

// Deliberate reset: new keys, old messages become unreadable
export function resetIdentity(userId) {
  return createAndPublish(userId)
}