import { withEmoticons } from './emoticons'

// Turns message text into: normal text + safe, clickable links.
//
// Safe by design:
//  - never uses dangerouslySetInnerHTML (React escapes everything)
//  - only http: and https: links are ever clickable
//  - the link text is the real address it opens (no hidden destinations)
//  - opens in a new tab with noopener noreferrer

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
const MAX_URL_LENGTH = 2000

const count = (s, ch) => s.split(ch).length - 1

// "see https://a.com/page." -> the final "." is not part of the link
function trimTrailing(url) {
  let u = url
  while (u.length > 0) {
    const last = u[u.length - 1]
    if ('.,!?;:'.includes(last)) {
      u = u.slice(0, -1)
    } else if (last === ')' && count(u, '(') < count(u, ')')) {
      u = u.slice(0, -1)
    } else {
      break
    }
  }
  return u
}

// Returns a safe address to open, or null if we should NOT make it a link
function safeHref(raw) {
  if (raw.length > MAX_URL_LENGTH) return null
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // https://google.com@evil.com tricks: refuse anything with a login part
    if (u.username || u.password) return null
    // must look like a real website name
    if (!u.hostname.includes('.')) return null
    // lookalike international domains: leave as plain text
    if (u.hostname.split('.').some((p) => p.startsWith('xn--'))) return null
    return u.href
  } catch {
    return null
  }
}

export default function Linkified({ text }) {
  const parts = []
  let last = 0

  for (const match of text.matchAll(URL_RE)) {
    const raw = trimTrailing(match[0])
    const href = safeHref(raw)
    if (!href) continue

    const start = match.index
    if (start > last) parts.push(withEmoticons(text.slice(last, start)))

    parts.push(
      <a
        key={parts.length}
        className="msg-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => e.stopPropagation()}
      >
        {raw}
      </a>,
    )
    last = start + raw.length
  }

  if (last < text.length) parts.push(withEmoticons(text.slice(last)))
  return <>{parts}</>
}