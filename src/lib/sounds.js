let ctx = null
const MUTE_KEY = 'messenger-muted'

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// notes: [frequencyHz, startSeconds, durationSeconds]
function play(notes, type = 'sine', volume = 0.08) {
  if (isMuted()) return
  try {
    const c = audio()
    if (!c) return
    for (const [freq, at, dur] of notes) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      const t0 = c.currentTime + at
      osc.type = type
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(gain)
      gain.connect(c.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    }
  } catch {
    /* sound is optional */
  }
}

export const playMessage = () => play([[880, 0, 0.12], [1175, 0.1, 0.16]])

let buzzAudio = null

export function playBuzz() {
  if (isMuted()) return
  try {
    if (!buzzAudio) buzzAudio = new Audio('/sounds/buzz.mp3')
    buzzAudio.currentTime = 0
    buzzAudio.volume = 0.7
    buzzAudio.play().catch(() => {})
  } catch {
    /* sound is optional */
  }
}