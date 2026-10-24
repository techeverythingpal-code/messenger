import { useState } from 'react'
import { supabase } from '../lib/supabase'

function FriendRow({ f, status, unread, onOpen, onRemove }) {
  const dot = status === 'available' ? 'on' : status === 'busy' ? 'busy' : ''
  return (
    <div className={`contact ${status ? '' : 'offline'}`}>
      <button
        className="linklike"
        onClick={() => onOpen(f)}
        disabled={!f.public_key}
        title={f.public_key ? '' : "This user hasn't set up encryption yet"}
      >
        <span className={`dot ${dot}`} />
        @{f.username}
        {status === 'busy' && <span className="tag">busy</span>}
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      <button className="small secondary" title="Remove friend" onClick={() => onRemove(f)}>
        ✕
      </button>
    </div>
  )
}

export default function ContactList({
  myId, friends, incoming, outgoing, online, unread, onOpen, reload,
}) {
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState('')
  const [collapsed, setCollapsed] = useState({ online: false, offline: false })

  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  const byName = (a, b) => a.username.localeCompare(b.username)
  const onlineFriends = friends.filter((f) => online.has(f.id)).sort(byName)
  const offlineFriends = friends.filter((f) => !online.has(f.id)).sort(byName)

  async function addFriend(e) {
    e.preventDefault()
    setMsg('')
    setInfo('')
    const u = name.trim().toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_]{3,20}$/.test(u)) {
      return setMsg('Usernames are 3-20 letters, numbers or underscores.')
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', u)
      .maybeSingle()
    if (error) return setMsg(error.message)
    if (!data) return setMsg('No user with that username.')
    if (data.id === myId) return setMsg("That's you!")

    const { error: err2 } = await supabase
      .from('contacts')
      .insert({ requester_id: myId, addressee_id: data.id })
    if (err2) {
      return setMsg(
        err2.code === '23505'
          ? 'A request already exists, or you are already friends.'
          : err2.message
      )
    }
    setName('')
    setInfo(`Request sent to @${u}.`)
    reload()
  }

  async function accept(item) {
    const { error } = await supabase
      .from('contacts')
      .update({ status: 'accepted' })
      .eq('id', item.rowId)
    if (error) setMsg(error.message)
    reload()
  }

  async function remove(item, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    const { error } = await supabase.from('contacts').delete().eq('id', item.rowId)
    if (error) setMsg(error.message)
    reload()
  }

  const removeFriend = (f) => remove(f, `Remove @${f.username} from your friends?`)

  return (
    <div>
      <form className="row" onSubmit={addFriend}>
        <input
          placeholder="Add a friend by username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={21}
          autoComplete="off"
        />
        <button type="submit">Add</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="hint">{info}</p>}

      {incoming.length > 0 && (
        <div className="section">
          <h3>Requests ({incoming.length})</h3>
          {incoming.map((it) => (
            <div className="contact" key={it.rowId}>
              <span>@{it.username}</span>
              <span className="actions">
                <button className="small" onClick={() => accept(it)}>Accept</button>
                <button className="small secondary" onClick={() => remove(it)}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <button className="group" onClick={() => toggle('online')}>
          {collapsed.online ? '▸' : '▾'} Online ({onlineFriends.length})
        </button>
        {!collapsed.online &&
          onlineFriends.map((f) => (
            <FriendRow
              key={f.rowId}
              f={f}
              status={online.get(f.id)}
              unread={unread[f.id]}
              onOpen={onOpen}
              onRemove={removeFriend}
            />
          ))}

        <button className="group" onClick={() => toggle('offline')}>
          {collapsed.offline ? '▸' : '▾'} Offline ({offlineFriends.length})
        </button>
        {!collapsed.offline &&
          offlineFriends.map((f) => (
            <FriendRow
              key={f.rowId}
              f={f}
              status={null}
              unread={unread[f.id]}
              onOpen={onOpen}
              onRemove={removeFriend}
            />
          ))}

        {friends.length === 0 && <p className="empty">No friends yet. Add someone above.</p>}
      </div>

      {outgoing.length > 0 && (
        <div className="section">
          <h3>Sent requests</h3>
          {outgoing.map((it) => (
            <div className="contact" key={it.rowId}>
              <span>@{it.username} (waiting)</span>
              <button className="small secondary" onClick={() => remove(it)}>Cancel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}