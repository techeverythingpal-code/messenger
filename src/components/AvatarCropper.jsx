import { useEffect, useRef, useState } from 'react'

// Crop a photo to a square profile picture.
// Drag to move, and zoom with the slider, mouse wheel, or two-finger pinch.
// The circle shows what friends will see. The result is a 512x512 JPEG.
//
// Props:
//   file      the image File the user picked
//   onDone    (blob) => Promise  called with the cropped JPEG
//   onCancel  () => void
//   onError   (message) => void

const VIEW = 260 // crop box size on screen (px)
const OUT = 512 // saved picture size (px)
const MAX_ZOOM = 4

// Keep the photo covering the whole box (no empty edges)
function clamp(v, img) {
  const scale = img.base * v.zoom
  const w = img.w * scale
  const h = img.h * scale
  return {
    zoom: v.zoom,
    x: Math.min(0, Math.max(VIEW - w, v.x)),
    y: Math.min(0, Math.max(VIEW - h, v.y)),
  }
}

// New zoom, keeping the middle of the box on the same spot of the photo
function zoomAround(v, img, nextZoom) {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom))
  const ratio = zoom / v.zoom
  const c = VIEW / 2
  return clamp({ zoom, x: c - (c - v.x) * ratio, y: c - (c - v.y) * ratio }, img)
}

export default function AvatarCropper({ file, onDone, onCancel, onError }) {
  const [img, setImg] = useState(null) // { el, url, w, h, base }
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const boxRef = useRef(null)
  const imgRef = useRef(null)
  const pointers = useRef(new Map()) // pointerId -> { x, y }
  const pinch = useRef(null) // { dist, zoom } while two fingers are down

  // Latest onError, so a new function from the parent doesn't reload the photo
  const onErrorRef = useRef(onError)
  useEffect(() => {
    imgRef.current = img
    onErrorRef.current = onError
  }, [img, onError])

  // Load the picked file
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      const w = el.naturalWidth
      const h = el.naturalHeight
      const base = Math.max(VIEW / w, VIEW / h)
      setImg({ el, url, w, h, base })
      setView({ zoom: 1, x: (VIEW - w * base) / 2, y: (VIEW - h * base) / 2 })
    }
    el.onerror = () => onErrorRef.current('This file could not be opened as a picture.')
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Mouse wheel zoom (added by hand so the page doesn't scroll at the same time)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    function onWheel(e) {
      e.preventDefault()
      const cur = imgRef.current
      if (!cur) return
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setView((v) => zoomAround(v, cur, v.zoom * factor))
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  function fingerDistance() {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(e) {
    if (!img) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      pinch.current = { dist: fingerDistance(), zoom: view.zoom }
    }
  }

  function onPointerMove(e) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev || !img) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const start = pinch.current
      const next = start.zoom * (fingerDistance() / start.dist)
      setView((v) => zoomAround(v, img, next))
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      setView((v) => clamp({ zoom: v.zoom, x: v.x + dx, y: v.y + dy }, img))
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  async function save() {
    if (!img || busy) return
    setBusy(true)
    try {
      const scale = img.base * view.zoom
      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#fff' // transparent PNGs get a white background
      ctx.fillRect(0, 0, OUT, OUT)
      ctx.drawImage(
        img.el,
        -view.x / scale, -view.y / scale, // top-left of the box, in photo pixels
        VIEW / scale, VIEW / scale, // box size, in photo pixels
        0, 0, OUT, OUT
      )
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85)
      )
      if (!blob) throw new Error('Could not prepare the picture.')
      await onDone(blob)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const scale = img ? img.base * view.zoom : 1

  return (
    <div className="cropper">
      <div
        ref={boxRef}
        className="crop-box"
        style={{ width: VIEW, height: VIEW, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {img ? (
          <img
            src={img.url}
            alt=""
            draggable={false}
            style={{
              width: img.w * scale,
              height: img.h * scale,
              transform: `translate(${view.x}px, ${view.y}px)`,
            }}
          />
        ) : (
          <span className="muted">Loading…</span>
        )}
        <div className="crop-ring" />
      </div>

      <label className="crop-zoom">
        🔍
        <input
          type="range"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          value={view.zoom}
          disabled={!img}
          onChange={(e) => img && setView((v) => zoomAround(v, img, Number(e.target.value)))}
        />
      </label>
      <p className="hint">Drag to move. Pinch, scroll or use the slider to zoom.</p>

      <div className="crop-actions">
        <button type="button" onClick={save} disabled={!img || busy}>
          {busy ? 'Saving...' : 'Save picture'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}