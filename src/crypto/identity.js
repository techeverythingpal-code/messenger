import { supabase } from '../lib/supabase'
import {
  loadDevice,
  saveDevice,
  deleteOldIdentity,
  generateKeyPair,
  exportPublicJwk,
  sameKey,
  fingerprint,
} from './keys'

// A friendly name like "Chrome on Windows"
function deviceLabel() {
  const ua = navigator.userAgent || ''
  let os = 'Unknown OS'
  if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/CrOS/i.test(ua)) os = 'ChromeOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let browser = 'Browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return `${browser} on ${os}`.slice(0, 40)
}

async function ready(record, jwk, name) {
  return {
    status: 'ok',
    deviceId: record.deviceId,
    privateKey: record.privateKey,
    publicJwk: jwk,
    name,
    fingerprint: await fingerprint(jwk),
  }
}

async function register(userId) {
  const pair = await generateKeyPair()
  const jwk = await exportPublicJwk(pair.publicKey)
  const name = deviceLabel()

  const { data, error } = await supabase
    .from('devices')
    .insert({ user_id: userId, name, public_key: jwk })
    .select('id')
    .single()

  if (error) {
    if (error.code === '42501') {
      throw new Error('This account already has 10 devices. Remove an old one first.')
    }
    throw error
  }

  const record = { deviceId: data.id, privateKey: pair.privateKey, publicKey: pair.publicKey }
  try {
    await saveDevice(userId, record)
  } catch (e) {
    // Couldn't keep the key on this device, so don't leave a useless registration behind
    await supabase.from('devices').delete().eq('id', data.id)
    throw e
  }
  await deleteOldIdentity(userId)
  return ready(record, jwk, name)
}

async function run(userId) {
  const local = await loadDevice(userId)
  if (!local) return register(userId) // brand-new device: register it

  const { data, error } = await supabase
    .from('devices')
    .select('public_key, name')
    .eq('id', local.deviceId)
    .maybeSingle()
  if (error) throw error

  const localJwk = await exportPublicJwk(local.publicKey)
  if (!data || !sameKey(localJwk, data.public_key)) {
    return { status: 'removed' } // this device was removed from the account
  }

  // Best effort: remember when this device was last used
  supabase
    .from('devices')
    .update({ last_seen: new Date().toISOString() })
    .eq('id', local.deviceId)
    .then(() => {})

  return ready(local, localJwk, data.name)
}

// Prevents registering twice when React runs effects twice in dev mode
const inflight = new Map()
export function ensureDevice(userId) {
  if (!inflight.has(userId)) {
    inflight.set(userId, run(userId).finally(() => inflight.delete(userId)))
  }
  return inflight.get(userId)
}