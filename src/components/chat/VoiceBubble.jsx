import { memo, useEffect, useRef, useState } from 'react'
import { downloadVoice } from '../../crypto/voice'

// Only one voice note plays at a time: this holds the "pause" function of the one playing
let playingNow = null

const fmt = (s) => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

// The player for one voice note.
//
// Props:
//   voice  { path, key, iv, seconds, mime } from the message (see protocol.js)
function VoiceBubble({ voice }) {
  const [status, setStatus] = useState('idle') // idle | loading | ready | playing
  const [pos, setPos] = useState(0) // seconds played so far
  const [error, setError] = useState('')

  const audioRef = useRef(null)
  const urlRef = useRef(null)
  const alive = useRef(true)
  const pauseSelf = useRef(() => audioRef.current?.pause())

  // Stop the sound, free the downloaded audio and forget it
  function reset() {
    const a = audioRef.current
    if (a) {
      a.onplay = a.onpause = a.ontimeupdate = a.onended = a.onerror = null
      a.pause()
    }
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    if (playingNow === pauseSelf.current) playingNow = null
    setStatus('idle')
    setPos(0)
  }

  function wire(el) {
    el.onplay = () => {
      playingNow = pauseSelf.current
      setStatus('playing')
    }
    el.onpause = () => {
      if (playingNow === pauseSelf.current) playingNow = null
      setStatus('ready')
    }
    el.ontimeupdate = () => setPos(el.currentTime)
    el.onended = () => {
      el.currentTime = 0
      setPos(0)
    }
    el.onerror = () => {
      reset()
      setError("Can't play this voice note")
    }
  }

  // Leaving the chat: stop the sound and free the memory
  useEffect(() => {
    alive.current = true
    const stop = pauseSelf.current
    return () => {
      alive.current = false
      const a = audioRef.current
      if (a) {
        a.onplay = a.onpause = a.ontimeupdate = a.onended = a.onerror = null
        a.pause()
      }
      if (playingNow === stop) playingNow = null
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  async function toggle() {
    if (status === 'loading') return
    setError('')

    // Playing now: pause
    const current = audioRef.current
    if (current && !current.paused) {
      current.pause()
      return
    }

    try {
      let el = audioRef.current
      if (!el) {
        // First time: download and decrypt, then keep it for the next plays
        setStatus('loading')
        const blob = await downloadVoice(voice)
        if (!alive.current) return
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        el = new Audio(url)
        wire(el)
        audioRef.current = el
      }
      // Another voice note is playing: pause it first
      if (playingNow && playingNow !== pauseSelf.current) playingNow()
      await el.play()
    } catch (err) {
      if (!alive.current) return
      if (err && err.name === 'NotAllowedError') {
        setStatus('ready') // the browser blocked the sound: the next tap plays it
        return
      }
      reset()
      setError(err?.message || "Can't play this voice note")
    }
  }

  const total = Math.max(voice.seconds, 1)
  const pct = Math.min(100, (pos / total) * 100)
  const icon = status === 'loading' ? '⏳' : status === 'playing' ? '⏸' : '▶'
  const label = pos > 0 ? fmt(pos) : fmt(voice.seconds)

  return (
    <>
      {/* dir="ltr": the player keeps the same layout whatever language the chat is in.
          Tapping it must not open the Reply / React bar of the message. */}
      <div className="voice" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="voicebtn"
          onClick={toggle}
          aria-label={status === 'playing' ? 'Pause voice note' : 'Play voice note'}
        >
          {icon}
        </button>
        <div
          className="voicebar"
          role="progressbar"
          aria-label="Voice note progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(Math.min(pos, total))}
        >
          <div className="voicefill" style={{ width: `${pct}%` }} />
        </div>
        <span className="voicetime">{label}</span>
      </div>
      {error && <div className="voiceerr">{error}</div>}
    </>
  )
}

export default memo(VoiceBubble)