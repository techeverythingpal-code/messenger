import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureIdentity, resetIdentity } from '../crypto/identity'

export default function Home({ session }) {
  const userId = session.user.id
  const [identity, setIdentity] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ensureIdentity(userId)
      .then((r) => !cancelled && setIdentity(r))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [userId])

  async function handleReset() {
    const ok = window.confirm(
      'Create new encryption keys on this device?\n\n' +
        'Messages encrypted with your old keys will become unreadable.'
    )
    if (!ok) return
    try {
      setIdentity(await resetIdentity(userId))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <h1>Welcome</h1>
      <p>Logged in as {session.user.email}</p>

      {error && <p className="msg">Error: {error}</p>}
      {!identity && !error && <p>Setting up encryption keys...</p>}

      {identity?.status === 'ok' && (
        <div className="ok">
          <strong>Encryption keys ready</strong>
          <p>Your key fingerprint:</p>
          <code className="fp">{identity.fingerprint}</code>
        </div>
      )}

      {identity?.status === 'conflict' && (
        <div className="warn">
          <strong>This device doesn't have your encryption key</strong>
          <p>
            Your account already has a key from another device (or this
            browser's data was cleared). You can create new keys here, but old
            messages will become unreadable.
          </p>
          <button onClick={handleReset}>Create new keys on this device</button>
        </div>
      )}

      <button style={{ marginTop: 12 }} onClick={() => supabase.auth.signOut()}>
        Log out
      </button>
    </div>
  )
}