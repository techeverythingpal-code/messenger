import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' or 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage('')

    if (password.length < 8) {
      setMessage('Password must be at least 8 characters.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('Account created. Check your email to confirm, then log in.')
        setMode('login')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h1>Messenger</h1>
      <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>

      {message && <p className="msg">{message}</p>}

      <p className="switch">
        {mode === 'login' ? 'No account?' : 'Already have an account?'}{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setMessage('')
            setMode(mode === 'login' ? 'signup' : 'login')
          }}
        >
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </a>
      </p>
    </div>
  )
}