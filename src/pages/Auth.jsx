import { useEffect, useState } from 'react'
import { supabase, emailLinkFailed } from '../lib/supabase'
import { APP_NAME } from '../lib/appInfo'
import PasswordInput from '../components/PasswordInput'
import SignUp from './SignUp'

const COOLDOWN_SECONDS = 60
const LINK_MESSAGE = 'That email link is invalid or has expired. Please request a new one.'

// Log in and "forgot password". Sign up has its own screen (SignUp.jsx).
export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'forgot' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(emailLinkFailed ? LINK_MESSAGE : '')
  const [info, setInfo] = useState('')
  const [wait, setWait] = useState(0)

  // Tidy the address bar after a failed email link
  useEffect(() => {
    if (/[#&]error/.test(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // Countdown for the "send again" button
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  function go(next) {
    setMode(next)
    setMessage('')
    setInfo('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage('')
    setInfo('')

    if (mode === 'forgot') {
      if (wait > 0 || busy) return
      setBusy(true)
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/`,
      })
      setBusy(false)

      if (error) {
        setMessage(
          error.status === 429
            ? 'Too many requests. Please wait a few minutes and try again.'
            : 'Could not send the email. Please try again later.'
        )
        return
      }
      // Same answer whether or not the email has an account
      setInfo(
        'If an account exists for that email, we sent a link to reset the password. ' +
          'Check your inbox and spam folder.'
      )
      setWait(COOLDOWN_SECONDS)
      return
    }

    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
    } catch (err) {
      setMessage(
        err.code === 'email_not_confirmed'
          ? 'Please confirm your email first: open the link we sent you.'
          : err.code === 'invalid_credentials'
            ? 'Wrong email or password.'
            : err.status === 429
              ? 'Too many attempts. Please wait a few minutes and try again.'
              : err.message
      )
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'signup') return <SignUp onBack={() => go('login')} />

  const title = mode === 'login' ? 'Log in' : 'Reset your password'

  const buttonLabel = busy
    ? 'Please wait...'
    : mode === 'login'
      ? 'Log in'
      : wait > 0
        ? `Send again in ${wait}s`
        : 'Send reset link'

  return (
    <div className="card">
      <h1>{APP_NAME}</h1>
      <h2>{title}</h2>

      {mode === 'forgot' && (
        <p className="hint">Enter your account email and we'll send you a link to choose a new password.</p>
      )}

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {mode === 'login' && (
          <>
            <PasswordInput
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <p className="forgot">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  go('forgot')
                }}
              >
                Forgot password?
              </a>
            </p>
          </>
        )}

        <button type="submit" disabled={busy || (mode === 'forgot' && wait > 0)}>
          {buttonLabel}
        </button>
      </form>

      {message && <p className="msg">{message}</p>}
      {info && <p className="hint">{info}</p>}

      <p className="switch">
        {mode === 'login' ? (
          <>
            No account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); go('signup') }}>Sign up</a>
          </>
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); go('login') }}>Back to log in</a>
        )}
      </p>
    </div>
  )
}