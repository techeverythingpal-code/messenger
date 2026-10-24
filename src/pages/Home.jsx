import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureIdentity, resetIdentity } from '../crypto/identity'
import { loadKeyPair } from '../crypto/keys'
import { useContacts } from '../lib/useContacts'
import { usePresence } from '../lib/usePresence'
import { isMuted, setMuted, playMessage } from '../lib/sounds'
import UsernameForm from '../components/UsernameForm'
import ContactList from '../components/ContactList'
import Chat from '../components/Chat'

const STATUSES = [
  { value: 'available', label: '🟢 Available' },
  { value: 'busy', label: '🔴 Busy' },
  { value: 'invisible', label: '⚪ Invisible' },
]

function loadStatus(userId) {
  try {
    const s = localStorage.getItem(`status:${userId}`)
    return STATUSES.some((x) => x.value === s) ? s : 'available'
  } catch {
    return 'available'
  }
}

// "Last message I've read" per contact, kept on this device only
const readKey = (userId) => `lastread:${userId}`
function readMap(userId) {
  try {
    return JSON.parse(localStorage.getItem(readKey(userId))) || {}
  } catch {
    return {}
  }
}
function writeMap(userId, map) {
  try {
    localStorage.setItem(readKey(userId), JSON.stringify(map))
  } catch {
    /* storage unavailable: unread counts just won't persist */
  }
}

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
  const [username, setUsername] = useState(undefined) // undefined = loading, null = not chosen
  const [error, setError] = useState('')
  const [contact, setContact] = useState(null)
  const [unread, setUnread] = useState({})
  const [status, setStatus] = useState(() => loadStatus(userId))
  const [muted, setMutedState] = useState(isMuted)
  const [shaking, setShaking] = useState(false)
  const openRef = useRef(null)
  const shakeTimer = useRef(null)

  const ready = identity?.status === 'ok' && !!username
  const { friends, incoming, outgoing, error: contactsError, reload } = useContacts(userId, ready)
  const online = usePresence(userId, ready, status)

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

  useEffect(() => {
    openRef.current = contact?.id ?? null
  }, [contact])

  useEffect(() => () => clearTimeout(shakeTimer.current), [])

  const shake = useCallback(() => {
    setShaking(true)
    clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShaking(false), 700)
  }, [])

  function changeStatus(value) {
    setStatus(value)
    try {
      localStorage.setItem(`status:${userId}`, value)
    } catch {
      /* ignore */
    }
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  const markRead = useCallback(
    (contactId, msgId) => {
      const map = readMap(userId)
      if ((map[contactId] ?? 0) < msgId) {
        map[contactId] = msgId
        writeMap(userId, map)
      }
      setUnread((prev) => (prev[contactId] ? { ...prev, [contactId]: 0 } : prev))
    },
    [userId]
  )

  // Count unread messages on startup
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    supabase
      .from('messages')
      .select('id, sender_id')
      .eq('receiver_id', userId)
      .order('id', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled || !data) return
        const map = readMap(userId)
        const counts = {}
        for (const m of data) {
          if (m.id > (map[m.sender_id] ?? 0)) {
            counts[m.sender_id] = (counts[m.sender_id] || 0) + 1
          }
        }
        setUnread(counts)
      })
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  // New messages from people whose chat isn't open
  useEffect(() => {
    if (!ready) return
    const channel = supabase
      .channel(`inbox:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          const sender = payload.new.sender_id
          if (openRef.current === sender) return
          setUnread((prev) => ({ ...prev, [sender]: (prev[sender] || 0) + 1 }))
          playMessage()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [ready, userId])

  const totalUnread = friends.reduce((n, f) => n + (unread[f.id] || 0), 0)
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Messenger` : 'Messenger'
  }, [totalUnread])

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

  const myDot = status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''

  return (
    <div className={`window ${shaking ? 'shake' : ''}`}>
      <div className="titlebar">
        <span>💬 Messenger</span>
        <span className="muted-light">end-to-end encrypted</span>
      </div>

      <div className="profilebar">
        <span className={`dot ${myDot}`} />
        <span className="name">{username ? `@${username}` : session.user.email}</span>
        {ready && (
          <select value={status} onChange={(e) => changeStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
        <button
          className="icon"
          onClick={toggleMute}
          title={muted ? 'Sounds off' : 'Sounds on'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="wbody">
        {error && <p className="msg">Error: {error}</p>}
        {contactsError && <p className="msg">Contacts error: {contactsError}</p>}
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

        {ready && !contact && (
          <div>
            <ContactList
              myId={userId}
              friends={friends}
              incoming={incoming}
              outgoing={outgoing}
              online={online}
              unread={unread}
              onOpen={setContact}
              reload={reload}
            />
            <div className="ok">
              <strong>Your key fingerprint</strong>
              <code className="fp">{identity.fingerprint}</code>
            </div>
          </div>
        )}

        {ready && contact && privateKey && (
          <Chat
            key={contact.id}
            myId={userId}
            myName={username}
            myPrivateKey={privateKey}
            contact={contact}
            status={online.get(contact.id)}
            onSeen={(id) => markRead(contact.id, id)}
            onBuzz={shake}
            onClose={() => setContact(null)}
          />
        )}
      </div>

      <div className="footer">
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          Log out
        </button>
      </div>
    </div>
  )
}