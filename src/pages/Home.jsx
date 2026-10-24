import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureIdentity, resetIdentity } from '../crypto/identity'
import { loadKeyPair } from '../crypto/keys'
import UsernameForm from '../components/UsernameForm'
import Chat from '../components/Chat'

async function loadAll(userId, identity) {
  if (identity.status !== 'ok') {
    return { identity, privateKey: null, username: undefined }
  }
  const pair = await loadKeyPair(userId)
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single()
  if (error) throw error
  return { identity, privateKey: pair.privateKey, username: data.username }
}

export default function Home({ session }) {
  const userId = session.user.id
  const [identity, setIdentity] = useState(null)
  const [privateKey, setPrivateKey] = useState(null)
  const [username, setUsername] = useState(undefined) // undefined = loading, null = not chosen yet
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [contact, setContact] = useState(null)

  function apply(r) {
    setIdentity(r.identity)
    setPrivateKey(r.privateKey)
    setUsername(r.username)
  }

  useEffect(() => {
    let cancelled = false
    ensureIdentity(userId)
      .then((id) => loadAll(userId, id))
      .then((r) => !cancelled && apply(r))
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
      const id = await resetIdentity(userId)
      apply(await loadAll(userId, id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function findContact(e) {
    e.preventDefault()
    setSearchMsg('')
    const name = search.trim().toLowerCase().replace(/^@/, '')

    if (!/^[a-z0-9_]{3,20}$/.test(name)) {
      setSearchMsg('Usernames are 3-20 letters, numbers or underscores.')
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, public_key')
      .eq('username', name)
      .maybeSingle()

    if (error) return setSearchMsg(error.message)
    if (!data) return setSearchMsg('No user with that username.')
    if (data.id === userId) return setSearchMsg("That's you!")
    if (!data.public_key) return setSearchMsg("This user hasn't set up encryption yet.")

    setContact(data)
  }

  return (
    <div className="card">
      <h1>Messenger</h1>
      <p className="who">
        Signed in as {username ? `@${username}` : session.user.email}
      </p>

      {error && <p className="msg">Error: {error}</p>}
      {!identity && !error && <p>Setting up encryption keys...</p>}

      {identity?.status === 'conflict' && (
        <div className="warn">
          <strong>This device doesn't have your encryption key</strong>
          <p>
            Your account already has a key from another device (or this browser's
            data was cleared). You can create new keys here, but old messages will
            become unreadable.
          </p>
          <button onClick={handleReset}>Create new keys on this device</button>
        </div>
      )}

      {identity?.status === 'ok' && username === null && (
        <UsernameForm userId={userId} onSaved={setUsername} />
      )}

      {identity?.status === 'ok' && username && !contact && (
        <div>
          <form className="row" onSubmit={findContact}>
            <input
              placeholder="Find a friend by username"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={21}
              autoComplete="off"
            />
            <button type="submit">Find</button>
          </form>
          {searchMsg && <p className="msg">{searchMsg}</p>}

          <div className="ok">
            <strong>Your key fingerprint</strong>
            <code className="fp">{identity.fingerprint}</code>
          </div>
        </div>
      )}

      {identity?.status === 'ok' && username && contact && privateKey && (
        <Chat
          key={contact.id}
          myId={userId}
          myPrivateKey={privateKey}
          contact={contact}
          onClose={() => setContact(null)}
        />
      )}

      <button className="secondary" onClick={() => supabase.auth.signOut()}>
        Log out
      </button>
    </div>
  )
}