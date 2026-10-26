import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Settings({
  userId, email, shareSeen, shareTyping, onPrivacyChange, onBack,
}) {
  const [prefMsg, setPrefMsg] = useState('')
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwOk, setPwOk] = useState('')

  async function savePref(column, value) {
    setPrefMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({ [column]: value })
      .eq('id', userId)
    if (error) return setPrefMsg(error.message)
    onPrivacyChange({ [column]: value })
  }

  async function changePassword(e) {
    e.preventDefault()
    if (busy) return
    setPwMsg('')
    setPwOk('')

    if (!current) return setPwMsg('Enter your current password.')
    if (pw.length < 8) return setPwMsg('The new password must be at least 8 characters.')
    if (pw !== pw2) return setPwMsg('The two new passwords do not match.')
    if (pw === current) return setPwMsg('The new password must be different from the current one.')

    setBusy(true)
    try {
      // 1. Prove it's really you: check the current password
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: current })
      if (e1) {
        throw new Error(
          e1.status === 429
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : 'Your current password is wrong.'
        )
      }

      // 2. Save the new password
      const { error: e2 } = await supabase.auth.updateUser({ password: pw })
      if (e2) throw e2

      // 3. Sign out every other device
      await supabase.auth.signOut({ scope: 'others' })

      setCurrent('')
      setPw('')
      setPw2('')
      setPwOk('Password changed. Your other devices were signed out.')
    } catch (err) {
      setPwMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="chat-head">
        <strong>⚙️ Settings</strong>
        <button className="small secondary" onClick={onBack}>← Back</button>
      </div>

      <div className="section">
        <h3>Privacy</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={shareTyping}
            onChange={(e) => savePref('share_typing', e.target.checked)}
          />
          <span>
            Show when I'm typing
            <small>If off, you also won't see when others are typing.</small>
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={shareSeen}
            onChange={(e) => savePref('share_seen', e.target.checked)}
          />
          <span>
            Send read receipts (Seen)
            <small>If off, you also won't see Seen ticks on your own messages.</small>
          </span>
        </label>
        {prefMsg && <p className="msg">{prefMsg}</p>}
      </div>

      <div className="section">
        <h3>Change password</h3>
        <p className="hint">Signed in as {email}</p>
        <form onSubmit={changePassword}>
          <input
            type="password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
          <input
            type="password"
            placeholder="New password (8+ characters)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Repeat new password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Change password'}
          </button>
        </form>
        {pwMsg && <p className="msg">{pwMsg}</p>}
        {pwOk && <p className="hint">✅ {pwOk}</p>}
      </div>
    </div>
  )
}