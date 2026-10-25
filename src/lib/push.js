import { supabase } from './supabase'

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
const flagKey = (userId) => `push:${userId}`

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function setFlag(userId, on) {
  try {
    if (on) localStorage.setItem(flagKey(userId), '1')
    else localStorage.removeItem(flagKey(userId))
  } catch {
    /* ignore */
  }
}

function getFlag(userId) {
  try {
    return localStorage.getItem(flagKey(userId)) === '1'
  } catch {
    return false
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

function swReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Notifications are not ready yet. Reload the page and try again.')),
        8000
      )
    ),
  ])
}

function keyToBytes(b64) {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function saveRow(userId, deviceId, sub) {
  const j = sub.toJSON()
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (data?.endpoint === j.endpoint) return

  await supabase.from('push_subscriptions').delete().eq('device_id', deviceId)
  const { error } = await supabase.from('push_subscriptions').insert({
    device_id: deviceId,
    user_id: userId,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
  })
  if (error) throw error
}

// On startup: are notifications on for this account on this device?
export async function pushStatus(userId, deviceId) {
  if (!pushSupported() || Notification.permission !== 'granted' || !getFlag(userId)) {
    return false
  }
  const reg = await swReady()
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return false
  await saveRow(userId, deviceId, sub)
  return true
}

export async function enablePush(userId, deviceId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')
  if (!PUBLIC_KEY) throw new Error('Notifications are not configured yet.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      'Notifications are blocked. Allow them for this site in your browser settings, then try again.'
    )
  }

  const reg = await swReady()
  const old = await reg.pushManager.getSubscription()
  if (old) await old.unsubscribe() // always start fresh with the current key

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyToBytes(PUBLIC_KEY),
  })
  await saveRow(userId, deviceId, sub)
  setFlag(userId, true)
}

export async function disablePush(userId, deviceId) {
  setFlag(userId, false)
  await supabase.from('push_subscriptions').delete().eq('device_id', deviceId)
  try {
    const reg = await swReady()
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  } catch {
    /* ignore */
  }
}

// When logging out: stop notifications for this account (the choice is remembered)
export async function pausePush(deviceId) {
  try {
    await supabase.from('push_subscriptions').delete().eq('device_id', deviceId)
  } catch {
    /* ignore */
  }
}