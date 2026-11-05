// src/components/CallOverlay.jsx
// Full-screen voice call UI. Render it once, inside the logged-in app.
// It shows nothing while there is no call and no notice.

import { useEffect, useState } from 'react'
import useCall from '../hooks/useCall'
import Avatar from './Avatar'
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

// friends: my friends list, used to show the other person's profile picture.
// The picture is looked up here by their id, never taken from the call message.
export default function CallOverlay({ friends = [] }) {
  const { call, acceptCall, rejectCall, hangUp, toggleMute, clearNotice } = useCall()
  const [now, setNow] = useState(() => Date.now())

  const [outputs, setOutputs] = useState([])
  const [currentOutput, setCurrentOutput] = useState('default')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [outputError, setOutputError] = useState('')

  const inCall = call.status === 'connecting' || call.status === 'connected'

  // Tick every second while the call is connected (for the timer).
  // Until the first tick the timer simply shows 00:00.
  useEffect(() => {
    if (call.status !== 'connected') return
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
  // when a headset is plugged in or removed. When the call ends, the
  // cleanup clears the list so the next call starts fresh.
  useEffect(() => {
    if (!inCall || !canChooseOutput()) return

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
      setOutputs([])
      setPickerOpen(false)
      setOutputError('')
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

  const label =
    call.status === 'calling'
      ? 'Calling...'
      : call.status === 'incoming'
        ? 'Incoming voice call'
        : call.status === 'connecting'
          ? 'Connecting...'
          : formatTime(seconds)

  const peerAvatar = friends.find((f) => f.id === call.peerId)?.avatar_path ?? null

  const canMute = inCall
  const canPickOutput = inCall && outputs.length > 1

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Voice call">
      <div className="call-box">
        <div className={`call-avatar ${peerAvatar ? 'has-pic' : ''}`} aria-hidden="true">
          {peerAvatar ? <Avatar path={peerAvatar} size={96} name={call.peerName} /> : '📞'}
        </div>
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