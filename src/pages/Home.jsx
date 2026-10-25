import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureDevice } from '../crypto/identity'
import { deleteKeyPair } from '../crypto/keys'
import { useContacts } from '../lib/useContacts'
import { usePresence } from '../lib/usePresence'
import { isMuted, setMuted, playMessage } from '../lib/sounds'
import UsernameForm from '../components/UsernameForm'
import ContactList from '../components/ContactList'
import Chat from '../components/Chat'
import Devices from '../components/Devices'
import DeleteAccount from '../components/DeleteAccount'
import { setTabBadge } from '../lib/tabBadge'
import { pushSupported, pushStatus, enablePush, disablePush, pausePush } from '../lib/push'

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

// Which of my devices I have already seen, kept on this device only
const seenKey = (userId) => `devices-seen:${userId}`
function readSeen(userId) {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(userId)))
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
function writeSeen(userId, ids) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

async function loadEverything(userId) {
  const device = await ensureDevice(userId)
  if (device.status !== 'ok') return { device, username: undefined }

  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single()
  if (error) throw error
  return { device, username: data.username }
}

export default function Home({ session }) {
  const userId = session.user.id
  const [device, setDevice] = useState(null) // null = loading
  const [username, setUsername] = useState(undefined) // undefined = loading, null = not chosen
  const [error, setError] = useState('')
  const [contact, setContact] = useState(null)
  const [showDevices, setShowDevices] = useState(false)
  const [alertDevices, setAlertDevices] = useState([]) // devices added that I haven't seen
  const [unread, setUnread] = useState({})
  const [status, setStatus] = useState(() => loadStatus(userId))
  const [muted, setMutedState] = useState(isMuted)
  const [shaking, setShaking] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [pushMsg, setPushMsg] = useState('')
  const openRef = useRef(null)
  const shakeTimer = useRef(null)

  const deviceId = device?.status === 'ok' ? device.deviceId : null
  const ready = !!deviceId && !!username
  const { friends, incoming, outgoing, error: contactsError, reload } = useContacts(userId, ready)
  const online = usePresence(userId, ready, status)

  function apply(r) {
    setDevice(r.device)
    setUsername(r.username)
  }

  useEffect(() => {
    let cancelled = false
    loadEverything(userId)
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

    // ----- Notifications -----
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    pushStatus(userId, deviceId)
      .then((on) => !cancelled && setPushOn(on))
      .catch(() => !cancelled && setPushOn(false))
    return () => {
      cancelled = true
    }
  }, [ready, userId, deviceId])

  async function togglePush() {
    setPushMsg('')
    if (!pushSupported()) {
      setPushMsg(
        "Notifications aren't available in this browser. On iPhone or iPad, tap Share → " +
          'Add to Home Screen first, then open the app from the Home Screen.'
      )
      return
    }
    try {
      if (pushOn) {
        await disablePush(userId, deviceId)
        setPushOn(false)
        setPushMsg('Notifications are off for this device.')
      } else {
        await enablePush(userId, deviceId)
        setPushOn(true)
        setPushMsg('Notifications are on for this device.')
      }
    } catch (e) {
      setPushMsg(e.message)
    }
  }

  // Open the right chat when a notification is clicked
  const pendingChat = useRef(new URLSearchParams(window.location.search).get('chat'))
  useEffect(() => {
    if (!ready) return
    function openChat(senderId) {
      const f = friends.find((x) => x.id === senderId)
      if (!f) return false
      setShowDevices(false)
      setContact(f)
      return true
    }
    if (pendingChat.current && openChat(pendingChat.current)) {
      pendingChat.current = null
      window.history.replaceState(null, '', window.location.pathname)
    }
    function onMessage(e) {
      if (e.data?.type === 'open-chat') openChat(e.data.senderId)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [ready, friends])

  async function handleLogout() {
    if (deviceId) await pausePush(deviceId)
    await supabase.auth.signOut()
  }

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

  // ----- New-device alerts (own account) -----
  useEffect(() => {
    if (!ready) return
    let cancelled = false

    // Devices added while this device was closed
    supabase
      .from('devices')
      .select('id, name')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled || !data) return
        const seen = readSeen(userId)
        if (seen === null) {
          writeSeen(userId, data.map((d) => d.id)) // first run on this device: nothing to compare yet
          return
        }
        const fresh = data.filter((d) => d.id !== deviceId && !seen.includes(d.id))
        if (fresh.length) setAlertDevices(fresh)
      })

    // Devices added while this device is open
    const channel = supabase
      .channel(`mydevices:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'devices',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const d = payload.new
          if (d.id === deviceId) return
          setAlertDevices((prev) =>
            prev.some((x) => x.id === d.id) ? prev : [...prev, { id: d.id, name: d.name }]
          )
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [ready, userId, deviceId])

  const handleReviewed = useCallback(
    (ids) => {
      writeSeen(userId, ids)
      setAlertDevices([])
    },
    [userId]
  )

  function dismissAlert() {
    const seen = readSeen(userId) || []
    writeSeen(userId, [...new Set([...seen, ...alertDevices.map((d) => d.id)])])
    setAlertDevices([])
  }

  function openDevices() {
    setContact(null)
    setShowDevices(true)
  }

  // ----- Unread counts -----
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    supabase
      .from('messages')
      .select('id, sender_id')
      .eq('target_device', deviceId)
      .neq('sender_id', userId)
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
  }, [ready, userId, deviceId])

  useEffect(() => {
    if (!ready) return
    const channel = supabase
      .channel(`inbox:${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `target_device=eq.${deviceId}`,
        },
        (payload) => {
          const sender = payload.new.sender_id
          if (sender === userId) return // sent from another device of mine

          const chatOpen = openRef.current === sender
          // An open chat only counts as read while you can actually see this tab
          if (chatOpen && !document.hidden) return

          setUnread((prev) => ({ ...prev, [sender]: (prev[sender] || 0) + 1 }))
          if (!chatOpen) playMessage() // an open chat plays its own sound
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [ready, userId, deviceId])

    const totalUnread = friends.reduce((n, f) => n + (unread[f.id] || 0), 0)
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) MeMe Messenger` : 'MeMe Messenger'
    setTabBadge(totalUnread)
  }, [totalUnread])

  // A removed device can only sign out. Its old key is erased, so the next
  // login (with the password) registers it fresh.
  async function handleLeave() {
    try {
      await deleteKeyPair(userId)
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut()
  }

  const myDot = status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''

  return (
    <div className={`window ${shaking ? 'shake' : ''}`}>
      <div className="titlebar">
        <span>💬 MeMe Messenger 😜</span>
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
                {ready && (
          <>
            <button
              className="icon"
              onClick={togglePush}
              title={pushOn ? 'Notifications on (click to turn off)' : 'Turn on notifications'}
            >
              {pushOn ? '🔔' : '🔕'}
            </button>
            <button className="icon" onClick={openDevices} title="My devices">
              💻
            </button>
          </>
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
        {pushMsg && <p className="hint">{pushMsg}</p>}
        {!device && !error && <p>Setting up this device...</p>}

        {device?.status === 'removed' && (
          <div className="warn">
            <strong>This device was removed from your account</strong>
            <p>
              Its encryption key is no longer registered. Sign out, then log in again
              with your password to use this device again. Messages from before can't
              be read here.
            </p>
            <button onClick={handleLeave}>Sign out of this device</button>
          </div>
        )}

        {ready && alertDevices.length > 0 && (
          <div className="warn">
            <strong>⚠️ New device on your account</strong>
            <p>
              {alertDevices.map((d) => d.name).join(', ')}{' '}
              {alertDevices.length > 1 ? 'were' : 'was'} added. If this wasn't you,
              remove it and sign out your other devices.
            </p>
            <div className="row">
              <button onClick={openDevices}>Review devices</button>
              <button className="secondary" onClick={dismissAlert}>It was me</button>
            </div>
          </div>
        )}

        {deviceId && username === null && (
          <UsernameForm userId={userId} onSaved={setUsername} />
        )}

        {ready && showDevices && (
          <Devices
            userId={userId}
            deviceId={deviceId}
            onReviewed={handleReviewed}
            onBack={() => setShowDevices(false)}
          />
        )}

        {ready && !contact && !showDevices && (
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
              <strong>This device: {device.name}</strong>
              <code className="fp">{device.fingerprint}</code>
            </div>
          </div>
        )}

        {ready && contact && !showDevices && (
          <Chat
            key={contact.id}
            myId={userId}
            myName={username}
            deviceId={deviceId}
            myPrivateKey={device.privateKey}
            contact={contact}
            status={online.get(contact.id)}
            expireAfter={friends.find((f) => f.id === contact.id)?.expireAfter ?? null}
            onExpiryChanged={reload}
            onSeen={(id) => markRead(contact.id, id)}
            onBuzz={shake}
            onClose={() => setContact(null)}
          />
        )}
      </div>

      <div className="footer">
        <button className="secondary" onClick={handleLogout}>
          Log out
        </button>
        <DeleteAccount userId={userId} email={session.user.email} />
      </div>
    </div>
  )
}