// src/components/CallOverlay.jsx
// Full-screen voice call UI. Render it once, inside the logged-in app.
// It shows nothing while there is no call and no notice.

import { useEffect, useState } from 'react'
import useCall from '../hooks/useCall'
import {
  canChooseOutput,
  getOutputDeviceId,
  setOutputDevice,
} from '../lib/callManager'

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// The sound outputs (speakers, headsets...) this browser knows about
async function listOutputs() {
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications')
    .map((d, i) => ({
      id: d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'Default' : `Speaker ${i + 1}`),
    }))
}

export default function CallOverlay() {
  const { call, acceptCall, rejectCall, hangUp, toggleMute, clearNotice } = useCall()
  const [now, setNow] = useState(() => Date.now())

  const [outputs, setOutputs] = useState([])
  const [currentOutput, setCurrentOutput] = useState('default')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [outputError, setOutputError] = useState('')

  const inCall = call.status === 'connecting' || call.status === 'connected'

  // Tick every second while the call is connected (for the timer)
  useEffect(() => {
    if (call.status !== 'connected') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [call.status])

  // Hide the short message ("No answer", "Call ended"...) after a moment
  useEffect(() => {
    if (!call.notice) return
    const timer = setTimeout(clearNotice, 3500)
    return () => clearTimeout(timer)
  }, [call.notice, clearNotice])

  // During a call: find the available sound outputs, and refresh the list
  // when a headset is plugged in or removed
  useEffect(() => {
    if (!inCall || !canChooseOutput()) {
      setOutputs([])
      setPickerOpen(false)
      setOutputError('')
      return
    }

    let cancelled = false

    async function refresh() {
      try {
        const list = await listOutputs()
        if (cancelled) return
        setOutputs(list)
        setCurrentOutput(getOutputDeviceId())
      } catch {
        if (!cancelled) setOutputs([])
      }
    }

    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [inCall])

  async function chooseOutput(id) {
    setOutputError('')
    try {
      await setOutputDevice(id)
      setCurrentOutput(getOutputDeviceId())
      setPickerOpen(false)
    } catch {
      setOutputError('Could not switch to that output')
    }
  }

  // No call: only show the short message, if there is one
  if (call.status === 'idle') {
    return call.notice ? (
      <div className="call-toast" role="status">
        {call.notice}
      </div>
    ) : null
  }

  const seconds =
    call.status === 'connected' && call.connectedAt
      ? Math.max(0, Math.floor((now - call.connectedAt) / 1000))
      : 0

  let label = ''
  if (call.status === 'calling') label = 'Calling...'
  else if (call.status === 'incoming') label = 'Incoming voice call'
  else if (call.status === 'connecting') label = 'Connecting...'
  else label = formatTime(seconds)

  const canMute = inCall
  const canPickOutput = inCall && outputs.length > 1

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Voice call">
      <div className="call-box">
        <div className="call-avatar" aria-hidden="true">📞</div>
        <h2 className="call-name">{call.peerName}</h2>
        <p className="call-status" aria-live="polite">{label}</p>

        <div className="call-actions">
          {call.status === 'incoming' ? (
            <>
              <button className="callbtn decline" onClick={rejectCall}>
                <span aria-hidden="true">✖</span>
                <small>Decline</small>
              </button>
              <button className="callbtn accept" onClick={acceptCall}>
                <span aria-hidden="true">📞</span>
                <small>Answer</small>
              </button>
            </>
          ) : (
            <>
              {canMute && (
                <button
                  className={`callbtn mute ${call.muted ? 'on' : ''}`}
                  onClick={toggleMute}
                  aria-pressed={call.muted}
                >
                  <span aria-hidden="true">{call.muted ? '🔇' : '🎤'}</span>
                  <small>{call.muted ? 'Unmute' : 'Mute'}</small>
                </button>
              )}
              {canPickOutput && (
                <button
                  className={`callbtn sound ${pickerOpen ? 'on' : ''}`}
                  onClick={() => setPickerOpen((open) => !open)}
                  aria-expanded={pickerOpen}
                >
                  <span aria-hidden="true">🔊</span>
                  <small>Sound</small>
                </button>
              )}
              <button className="callbtn decline" onClick={hangUp}>
                <span aria-hidden="true">✖</span>
                <small>Hang up</small>
              </button>
            </>
          )}
        </div>

        {pickerOpen && canPickOutput && (
          <div className="call-outputs" role="menu" aria-label="Sound output">
            {outputs.map((o) => (
              <button
                key={o.id}
                role="menuitemradio"
                aria-checked={o.id === currentOutput}
                className={`outputbtn ${o.id === currentOutput ? 'on' : ''}`}
                onClick={() => chooseOutput(o.id)}
              >
                <span>{o.label}</span>
                {o.id === currentOutput && <span aria-hidden="true">✓</span>}
              </button>
            ))}
            {outputError && <p className="call-error">{outputError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}