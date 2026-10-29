// src/lib/ice.js
// Returns the ICE server list used for voice calls.
// It tries /api/turn first (TURN relay, if we set one up later).
// If that isn't available, it falls back to free Google STUN servers,
// so calls work without any account or keys.

const STUN_ONLY = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  },
]

export async function getIceServers() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch('/api/turn', { signal: controller.signal })
    if (!res.ok) return STUN_ONLY

    const data = await res.json()
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers
    }
  } catch {
    // No TURN available (or running locally): use STUN only
  } finally {
    clearTimeout(timer)
  }

  return STUN_ONLY
}