import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_VOICE_SECONDS } from '../../crypto/voice'

// The best format this browser can record, in order of preference
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const MIN_SECONDS = 1 // shorter recordings are almost always an accidental tap

function pickType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

// Records one voice note at a time.
//
//   supported   → false if this browser (or an insecure page) can't record
//   recording   → true from start() until stop() or cancel()
//   seconds     → how long the recording has run (whole seconds)
//   start()     → ask for the microphone and begin
//   stop()      → finish and return { blob, seconds, mime } (or null if too short)
//   cancel()    → throw the recording away
//
// onError(message) is called with a short message for the person (permission denied, etc.).
export function useVoiceRecorder({ onError }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const session = useRef(null) // the recording in progress, if any

  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  const supported =
    typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const cancel = useCallback(() => {
    const s = session.current
    if (!s) return
    session.current = null
    clearInterval(s.timer)
    s.rec.onstop = null
    s.rec.ondataavailable = null
    try {
      if (s.rec.state !== 'inactive') s.rec.stop()
    } catch {
      /* already stopped */
    }
    s.stream.getTracks().forEach((t) => t.stop())
    setRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async () => {
    if (session.current) return
    if (!supported) {
      onErrorRef.current('Voice notes need a secure (HTTPS) connection and a newer browser.')
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const name = err && err.name
      onErrorRef.current(
        name === 'NotAllowedError'
          ? 'Microphone permission was denied'
          : name === 'NotFoundError'
            ? 'No microphone found'
            : 'Could not access the microphone'
      )
      return
    }

    const type = pickType()
    let rec
    try {
      rec = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 32000, // clear speech, small file
      })
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      onErrorRef.current('Could not start recording')
      return
    }

    const s = {
      rec,
      stream,
      chunks: [],
      startedAt: Date.now(),
      timer: null,
      ended: false, // the recorder has stopped (by itself at the limit, or by stop())
      result: null, // what was recorded, once it has ended
      waiting: null, // stop() waits here until the recorder has really ended
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) s.chunks.push(e.data)
    }
    rec.onstop = () => {
      s.ended = true
      clearInterval(s.timer)
      s.stream.getTracks().forEach((t) => t.stop()) // the microphone light goes off
      const elapsed = Math.min((Date.now() - s.startedAt) / 1000, MAX_VOICE_SECONDS)
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0]
      s.result = s.chunks.length
        ? { blob: new Blob(s.chunks, { type: mime }), seconds: elapsed, mime }
        : null
      if (s.waiting) s.waiting(s.result)
    }
    rec.onerror = () => {
      onErrorRef.current('Recording failed')
      cancel()
    }

    session.current = s
    setSeconds(0)
    setRecording(true)
    rec.start()

    s.timer = setInterval(() => {
      const elapsed = (Date.now() - s.startedAt) / 1000
      setSeconds(Math.min(Math.floor(elapsed), MAX_VOICE_SECONDS))
      // At the limit: stop recording but keep the result, so it can still be sent
      if (elapsed >= MAX_VOICE_SECONDS && rec.state === 'recording') rec.stop()
    }, 250)
  }, [supported, cancel])

  const stop = useCallback(
    () =>
      new Promise((resolve) => {
        const s = session.current
        if (!s) {
          resolve(null)
          return
        }
        const done = (result) => {
          session.current = null
          setRecording(false)
          setSeconds(0)
          if (result && result.seconds < MIN_SECONDS) {
            onErrorRef.current('The voice note is too short.')
            resolve(null)
            return
          }
          resolve(result)
        }
        if (s.ended) {
          done(s.result)
          return
        }
        s.waiting = done
        if (s.rec.state !== 'inactive') s.rec.stop() // onstop then calls done()
      }),
    []
  )

  // Leaving the chat while recording throws the recording away and frees the microphone
  useEffect(() => cancel, [cancel])

  return { supported, recording, seconds, start, stop, cancel }
}