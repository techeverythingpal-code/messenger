let seq = 0
let base = null // the page's original icon
let baseImgPromise = null

function iconLink() {
  let link = document.querySelector("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Shows the count on the tab icon, in the tab title, and on the app icon when installed
export async function setTabBadge(count) {
  const mine = ++seq
  const link = iconLink()

  // Remember the original icon the first time we run
  if (!base) {
    base = {
      href: link.getAttribute('href'),
      type: link.getAttribute('type'),
      resolved: link.href,
    }
  }

  // Installed-app badge (only works when the site is installed as an app)
  try {
    if (count) navigator.setAppBadge?.(count)?.catch(() => {})
    else navigator.clearAppBadge?.()?.catch(() => {})
  } catch {
    /* optional */
  }

  // No unread: put the original icon back
  if (!count) {
    if (base.href) link.setAttribute('href', base.href)
    else link.removeAttribute('href')
    if (base.type) link.setAttribute('type', base.type)
    else link.removeAttribute('type')
    return
  }

  if (!baseImgPromise) baseImgPromise = base.href ? loadImage(base.resolved) : Promise.resolve(null)
  const img = await baseImgPromise
  if (mine !== seq) return // a newer update arrived while we were loading

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  let drewBase = false
  if (img) {
    try {
      ctx.drawImage(img, 0, 0, size, size)
      drewBase = true
    } catch {
      /* some SVGs can't be drawn: use the fallback below */
    }
  }
  if (!drewBase) {
    ctx.fillStyle = '#6b2fa0'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Red badge with the number
  const label = count > 9 ? '9+' : String(count)
  const r = 22
  const cx = size - r
  const cy = size - r
  ctx.fillStyle = '#e53935'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${label.length > 1 ? 26 : 32}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy + 2)

  link.setAttribute('type', 'image/png')
  link.setAttribute('href', canvas.toDataURL('image/png'))
}