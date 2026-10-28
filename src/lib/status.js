import { getText, setText } from './storage'

// The "available / busy / invisible" choices in the top bar
export const STATUSES = [
  { value: 'available', label: '🟢 Available' },
  { value: 'busy', label: '🔴 Busy' },
  { value: 'invisible', label: '⚪ Invisible' },
]

// The status I picked last time on this device (default: available)
export function loadStatus(userId) {
  const s = getText(`status:${userId}`)
  return STATUSES.some((x) => x.value === s) ? s : 'available'
}

export function saveStatus(userId, value) {
  setText(`status:${userId}`, value)
}

// CSS class for the colored dot next to a status
export function statusDot(status) {
  return status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''
}
