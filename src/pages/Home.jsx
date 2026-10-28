import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureDevice } from '../crypto/identity'
import { deleteKeyPair } from '../crypto/keys'
import { useContacts } from '../lib/useContacts'
import { usePresence } from '../lib/usePresence'
import { useUnread } from '../lib/useUnread'
import { useDeviceAlerts } from '../lib/useDeviceAlerts'
import { isMuted, setMuted } from '../lib/sounds'
import { pausePush } from '../lib/push'
import { canVibrate } from '../lib/haptics'
import { usePushSettings } from '../lib/usePushSettings'
import { startAutoRefresh, onRefresh, requestRefresh } from '../lib/refresh'
import { getText, setText } from '../lib/storage'
import UsernameForm from '../components/UsernameForm'
import ContactList from '../components/ContactList'
import Chat from '../components/Chat'
import Devices from '../components/Devices'
import Settings from '../components/Settings'
import DeleteAccount from '../components/DeleteAccount'

const STATUSES = [
  { value: 'available', label: '🟢 Available' },
  { value: 'busy', label: '🔴 Busy' },
  { value: 'invisible', label: '⚪ Invisible' },
]

function loadStatus(userId) {
  const s = getText(`status:${userId}`)
  return STATUSES.some((x) => x.value === s) ? s : 'available'
}

async function loadEverything(userId) {
  const device = await ensureDevice(userId)
  if (device.status !== 'ok') {
    return { device, username: undefined, shareSeen: true, shareTyping: true }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('username, share_seen, share_typing')
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    device,
    username: data.username,
    shareSeen: data.share_seen !== false,
    shareTyping: data.share_typing !== false,
  }
}

export default function Home({ session }) {
  const userId = session.user.id
  const [device, setDevice] = useState(null) // null = loading
  const [username, setUsername] = useState(undefined) // undefined = loading, null = not chosen
  const [shareSeen, setShareSeen] = useState(true)
  const [shareTyping, setShareTyping] = useState(true)
  const [error, setError] = useState('')
  const [contact, setContact] = useState(null)
  const [showDevices, setShowDevices] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [status, setStatus] = useState(() => loadStatus(userId))
  const [muted, setMutedState] = useState(isMuted)
  const [shaking, setShaking] = useState(false)
  const shakeTimer = useRef(null)

  const deviceId = device?.status === 'ok' ? device.deviceId : null
  const ready = !!deviceId && !!username
  const { friends, incoming, outgoing, error: contactsError, reload } = useContacts(userId, ready)
  const online = usePresence(userId, ready, status)
  const { unread, markRead, refreshUnread } = useUnread({
    userId,
    deviceId,
    ready,
    openContactId: contact?.id ?? null,
    friends,
  })
  const { alertDevices, handleReviewed, dismissAlert } = useDeviceAlerts({
    userId,
    deviceId,
    ready,
  })
  const { pushOn, pushMsg, togglePush, vibrate, toggleVibrate } = usePushSettings({
    userId,
    deviceId,
    ready,
  })

  function apply(r) {
    setDevice(r.device)
    setUsername(r.username)
    setShareSeen(r.shareSeen)
    setShareTyping(r.shareTyping)
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

  useEffect(() => () => clearTimeout(shakeTimer.current), [])

  const shake = useCallback(() => {
    setShaking(true)
    clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShaking(false), 700)
  }, [])

  function changeStatus(value) {
    setStatus(value)
    setText(`status:${userId}`, value)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  function handlePrivacyChange(patch) {
    if ('share_seen' in patch) setShareSeen(patch.share_seen)
    if ('share_typing' in patch) setShareTyping(patch.share_typing)
  }

  // Open the right chat when a notification is clicked
  const pendingChat = useRef(new URLSearchParams(window.location.search).get('chat'))
  useEffect(() => {
    if (!ready) return
    function openChat(senderId) {
      const f = friends.find((x) => x.id === senderId)
      if (!f) return false
      setShowDevices(false)
      setShowSettings(false)
      setContact(f)
      return true
    }
    if (pendingChat.current && openChat(pendingChat.current)) {
      pendingChat.current = null
      window.history.replaceState(null, '', window.location.pathname)
    }
    function onMessage(e) {
      if (e.data?.type === 'open-chat') {
        openChat(e.data.senderId)
        requestRefresh(true) // fetch anything that arrived while we were away
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [ready, friends])

  async function handleLogout() {
    if (deviceId) await pausePush(deviceId)
    await supabase.auth.signOut()
  }

  function openDevices() {
    setContact(null)
    setShowSettings(false)
    setShowDevices(true)
  }

  function openSettings() {
    setContact(null)
    setShowDevices(false)
    setShowSettings(true)
  }

  // Clicking a contact: close Devices / Settings and show that chat
  function openContact(c) {
    setShowDevices(false)
    setShowSettings(false)
    setContact(c)
  }

  // ----- Keep everything fresh -----
  useEffect(() => {
    if (!ready) return
    const stop = startAutoRefresh()
    const off = onRefresh(() => {
      reload() // friends, requests, disappearing-message settings
      refreshUnread() // unread badges
    })
    return () => {
      stop()
      off()
    }
  }, [ready, reload, refreshUnread])

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
  // On a narrow screen the right-hand pane replaces the list while it is open
  const paneOpen = showDevices || showSettings || !!contact

  return (
    <div className={`window ${ready ? 'wide' : ''} ${shaking ? 'shake' : ''}`}>
      <div className="titlebar">
        <span>😎 Millennials Messenger</span>
        <span className="muted-light">end-to-end encrypted</span>
      </div>

      <div className="profilebar">
        <div className="who">
          <span className={`dot ${myDot}`} />
          <span className="name">{username ? `@${username}` : session.user.email}</span>
          {ready && (
            <select value={status} onChange={(e) => changeStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="tools">
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
              <button className="icon" onClick={openSettings} title="Settings">
                ⚙️
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
          {canVibrate() && (
            <button
              className="icon"
              onClick={toggleVibrate}
              title={vibrate ? 'Vibration on' : 'Vibration off'}
            >
              {vibrate ? '📳' : '📴'}
            </button>
          )}
        </div>
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

        {ready && (
          <div className={`split ${paneOpen ? 'open' : ''}`}>
            <div className="side">
              <ContactList
                myId={userId}
                friends={friends}
                incoming={incoming}
                outgoing={outgoing}
                online={online}
                unread={unread}
                onOpen={openContact}
                reload={reload}
              />
              <div className="ok">
                <strong>This device: {device.name}</strong>
                <code className="fp">{device.fingerprint}</code>
              </div>
              <button className="secondary logout" onClick={handleLogout}>
                Log out
              </button>
            </div>

            <div className="main">
              {showDevices ? (
                <Devices
                  userId={userId}
                  deviceId={deviceId}
                  onReviewed={handleReviewed}
                  onBack={() => setShowDevices(false)}
                />
              ) : showSettings ? (
                <Settings
                  userId={userId}
                  email={session.user.email}
                  shareSeen={shareSeen}
                  shareTyping={shareTyping}
                  onPrivacyChange={handlePrivacyChange}
                  onBack={() => setShowSettings(false)}
                />
              ) : contact ? (
                <Chat
                  key={contact.id}
                  myId={userId}
                  myName={username}
                  deviceId={deviceId}
                  myPrivateKey={device.privateKey}
                  contact={contact}
                  status={online.get(contact.id)}
                  expireAfter={friends.find((f) => f.id === contact.id)?.expireAfter ?? null}
                  shareSeen={shareSeen}
                  shareTyping={shareTyping}
                  onExpiryChanged={reload}
                  onSeen={(id) => markRead(contact.id, id)}
                  onBuzz={shake}
                  onClose={() => setContact(null)}
                />
              ) : (
                <p className="empty">Pick a contact on the left to open your messages.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="footer">
        {!ready && (
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        )}
        <DeleteAccount userId={userId} email={session.user.email} />
      </div>
    </div>
  )
}