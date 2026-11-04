import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_NAME } from '../lib/appInfo'
import PasswordInput from '../components/PasswordInput'

// The sign-up screen, separate from log in.
// After signing up, the confirmation email's link opens the app already
// logged in (see emailRedirectTo below), so there is no second log in.
export default function SignUp({ onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sentTo, setSentTo] = useState('') // set once the account is created

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setMessage('')

    const address = email.trim()
    if (password.length < 8) return setMessage('Password must be at least 8 characters.')
    if (password !== password2) return setMessage('The two passwords do not match.')

    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: address,
        password,
        // The link in the email comes back to this app and logs the user in
        options: { emailRedirectTo: `${window.location.origin}/` },
      })
      if (error) throw error

      // Supabase hides whether an email is already registered: it "succeeds"
      // but returns a user with no identities. Tell the person plainly.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Please log in instead.')
      }

      setSentTo(address)
      setPassword('')
      setPassword2('')
    } catch (err) {
      setMessage(
        err.status === 429
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : err.message
      )
    } finally {
      setBusy(false)
    }
  }

  // Account created: tell them to check their email
  if (sentTo) {
    return (
      <div className="card">
        <h1>{APP_NAME}</h1>
        <h2>Check your email</h2>
        <p className="hint">
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it on this device
          and you'll be logged in straight away. Check your spam folder if you don't see it.
        </p>
        <p className="switch">
          <a href="#" onClick={(e) => { e.preventDefault(); onBack() }}>Back to log in</a>
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h1>{APP_NAME}</h1>
      <h2>Create account</h2>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <PasswordInput
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <PasswordInput
          placeholder="Repeat password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          autoComplete="new-password"
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait...' : 'Sign up'}
        </button>
      </form>

      {message && <p className="msg">{message}</p>}

      <p className="switch">
        Already have an account?{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); onBack() }}>Log in</a>
      </p>
    </div>
  )
}