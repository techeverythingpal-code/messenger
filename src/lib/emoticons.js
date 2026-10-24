// Classic text shortcuts -> emoji. Applied only when DISPLAYING a message;
// the stored (encrypted) text is never changed.
const MAP = {
  ':)': '🙂', ':-)': '🙂',
  ':D': '😀', ':-D': '😀', ':d': '😀',
  ':(': '🙁', ':-(': '🙁',
  ';)': '😉', ';-)': '😉',
  ':P': '😛', ':p': '😛', ':-P': '😛',
  ':O': '😮', ':o': '😮',
  ':|': '😐',
  ":'(": '😢',
  ':*': '😘',
  'B)': '😎', '8)': '😎',
  '<3': '❤️',
  ':/': '😕',
  'X(': '😠', 'x(': '😠',
  'O:)': '😇',
  '>:)': '😈',
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const KEYS = Object.keys(MAP)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)

// Only match shortcuts standing on their own, so "http://x.com" is left alone
const RE = new RegExp(`(^|\\s)(${KEYS.join('|')})(?=$|\\s|[.,!?])`, 'g')

export function withEmoticons(text) {
  return text.replace(RE, (_, before, code) => before + MAP[code])
}

export const PICKER = [
  '🙂', '😀', '😉', '😛', '😎', '😍', '😘',
  '😂', '🤣', '😢', '😭', '😮', '😐', '😕',
  '😠', '😇', '😈', '🤔', '👍', '👎', '👏',
  '🙏', '❤️', '🎉', '🔥', '☕', '🍕', '🎵',
]