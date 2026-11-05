import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import useCall from '../../hooks/useCall'
import Avatar from '../Avatar'

const EXPIRY_OPTIONS = [
  { value: 'off', label: 'Off', seconds: null },
  { value: '3600', label: '1 hour', seconds: 3600 },
  { value: '86400', label: '1 day', seconds: 86400 },
  { value: '604800', label: '7 days', seconds: 604800 },
]

// The top of a chat: who it is, how to verify encryption, the new-device
// warning, and the disappearing-messages setting.
//
// Props:
//   contact         the friend (needs username and rowId; email and avatar_path if we have them)
//   status          'available' | 'busy' | anything else = offline
//   contactDevices  [{ id, name, fp }] their devices and fingerprints
//   notice          warning text, or '' for none
//   expireAfter     seconds, or null/0 when disappearing messages are off
//   onDismissNotice, onExpiryChanged, onError(message), onClose
export default function ChatHeader({
  contact, status, contactDevices, notice, expireAfter,
  onDismissNotice, onExpiryChanged, onError, onClose,
}) {
  const { call, startCall } = useCall()
  // Phones have no hover, so tapping the name shows / hides the email
  const [showEmail, setShowEmail] = useState(false)

  const dot = status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''
  const statusText =
    status === 'available' ? 'Online' : status === 'busy' ? 'Busy' : 'Offline'

  // Calls only work while both people have the app open, so the button
  // is enabled only while the contact is online and I'm not already in a call
  const canCall = status === 'available' && call.status === 'idle'
  const callHint =
    call.status !== 'idle'
      ? 'You are already in a call'
      : status === 'available'
        ? `Voice call @${contact.username}`
        : `@${contact.username} must be online to receive a call`

  async function handleExpiry(e) {
    const opt = EXPIRY_OPTIONS.find((o) => o.value === e.target.value)
    if (!opt) return
    if (opt.seconds) {
      const ok = window.confirm(
        `Messages older than ${opt.label} will be deleted for BOTH of you, ` +
          `and new messages will disappear after ${opt.label}.\n\n` +
          'This cannot be undone. Continue?'
      )
      if (!ok) return
    }
    onError('')
    const { error } = await supabase.rpc('set_disappearing', {
      p_contact_id: contact.rowId,
      p_seconds: opt.seconds,
    })
    if (error) onError(error.message)
    else onExpiryChanged()
  }

  return (
    <>
      <div className="chat-head">
        <strong
          title={contact.email || undefined}
          onClick={() => contact.email && setShowEmail((v) => !v)}
          style={contact.email ? { cursor: 'pointer' } : undefined}
        >
          <span className="avatar-wrap">
            <Avatar path={contact.avatar_path} size={36} name={`@${contact.username}`} />
            <span className={`dot ${dot}`} />
          </span>{' '}
          @{contact.username}
          {showEmail && contact.email && (
            <span
              className="muted"
              style={{ display: 'block', fontWeight: 'normal', fontSize: 12 }}
            >
              {contact.email}
            </span>
          )}
        </strong>
        <span className="muted">{statusText}</span>
        <button
          className="small"
          disabled={!canCall}
          title={callHint}
          aria-label={callHint}
          onClick={() => startCall(contact.id, `@${contact.username}`)}
        >
          📞 Call
        </button>
        <button className="small secondary backbtn" onClick={onClose}>← Back</button>
      </div>

      <details className="fpbox">
        <summary>🔒 End-to-end encrypted. Tap to verify.</summary>
        {contactDevices.length === 0 ? (
          <p>@{contact.username} hasn't set up encryption on any device yet.</p>
        ) : (
          <div>
            <p>
              @{contact.username}'s devices. Compare each fingerprint with them in
              person or by phone to be sure no one is intercepting:
            </p>
            {contactDevices.map((d) => (
              <p key={d.id}>
                <strong>{d.name}</strong>
                <code className="fp">{d.fp}</code>
              </p>
            ))}
          </div>
        )}
      </details>

      {notice && (
        <div className="warn">
          <p>⚠️ {notice}</p>
          <button className="small secondary" onClick={onDismissNotice}>OK</button>
        </div>
      )}

      <div className="expiry">
        <label>
          ⏳ Disappearing messages{' '}
          <select
            value={expireAfter ? String(expireAfter) : 'off'}
            onChange={handleExpiry}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {expireAfter && <span className="muted">applies to both of you</span>}
      </div>
    </>
  )
}