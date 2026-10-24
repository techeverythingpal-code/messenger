import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { deleteKeyPair } from '../crypto/keys'

export default function DeleteAccount({ userId, email }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setOpen(false)
    setPassword('')
    setWord('')
    setError('')
  }

  async function handleDelete(e) {
    e.preventDefault()
    if (busy) return
    setError('')

    if (word !== 'DELETE') return setError('Type DELETE (capital letters) to confirm.')
    if (!password) return setError('Enter your password.')

    setBusy(true)
    try {
      // 1. Re-check the password. This also gives the server a fresh login to verify.
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
      if (authErr) throw new Error('Wrong password.')

      // 2. Delete the account on the server
      const { error: rpcErr } = await supabase.rpc('delete_my_account')
      if (rpcErr) throw rpcErr

      // 3. Clean this device (only after the server succeeded)
      try {
        await deleteKeyPair(userId)
      } catch {
        /* ignore: the account is already gone */
      }
      try {
        localStorage.removeItem(`lastread:${userId}`)
        localStorage.removeItem(`status:${userId}`)
      } catch {
        /* ignore */
      }

      // 4. Clear the local session (the server session no longer exists)
      await supabase.auth.signOut({ scope: 'local' })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="dangerzone">
        <button className="linkdanger" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      </div>
    )
  }

  return (
    <div className="dangerzone">
      <form className="dangerbox" onSubmit={handleDelete}>
        <strong>Delete account permanently</strong>
        <ul>
          <li>Your profile, username and friend list are erased.</li>
          <li>
            <strong>All messages are erased for you and for your friends</strong>,
            both sent and received.
          </li>
          <li>Your encryption key is removed from this device.</li>
          <li>This cannot be undone.</li>
        </ul>

        <input
          type="password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <input
          placeholder="Type DELETE to confirm"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          autoComplete="off"
        />

        <div className="row">
          <button type="submit" className="danger" disabled={busy}>
            {busy ? 'Deleting...' : 'Delete forever'}
          </button>
          <button type="button" className="secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
        {error && <p className="msg">{error}</p>}
      </form>
    </div>
  )
}