import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_NAME } from '../lib/appInfo'

export default function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setMessage('')

    if (password.length < 8) return setMessage('Password must be at least 8 characters.')
    if (password !== confirm) return setMessage('The two passwords do not match.')

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      return setMessage(error.message)
    }

    // Safety: sign out every other session of this account
    await supabase.auth.signOut({ scope: 'others' })

    setBusy(false)
    window.history.replaceState(null, '', window.location.pathname)
    onDone()
  }

  async function cancel(e) {
    e.preventDefault()
    await supabase.auth.signOut()
  }

  return (
    <div className="card">
      <h1>{APP_NAME}</h1>
      <h2>Choose a new password</h2>
      <p className="hint">
        After saving, your other signed-in devices will be signed out and will need the
        new password.
      </p>

      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          placeholder="Repeat new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save new password'}
        </button>
      </form>

      {message && <p className="msg">{message}</p>}

      <p className="switch">
        <a href="#" onClick={cancel}>Cancel</a>
      </p>
    </div>
  )
}