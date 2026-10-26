const KEY = 'messenger-vibrate'

// True on phones and tablets that can vibrate (hidden on computers)
export function canVibrate() {
  return (
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    navigator.maxTouchPoints > 0
  )
}

export function isVibrateOn() {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setVibrateOn(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function run(pattern) {
  if (!canVibrate() || !isVibrateOn()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* vibration is optional */
  }
}

export function testVibrate() {
  if (!('vibrate' in navigator)) return 'unsupported'
  try {
    return navigator.vibrate([250, 100, 250]) ? 'sent' : 'blocked'
  } catch {
    return 'blocked'
  }
}
// [vibrate, pause, vibrate, ...] in milliseconds
export const vibrateMessage = () => run([120])
export const vibrateBuzz = () => run([300, 100, 300, 100, 300])