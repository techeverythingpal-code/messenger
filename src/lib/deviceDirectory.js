import { supabase } from './supabase'

export function createDirectory(myId, contactId) {
  let map = new Map()
  let inflight = null

  // Fetch the current devices of both people (one request at a time)
  function refresh() {
    if (!inflight) {
      inflight = supabase
        .from('devices')
        .select('id, user_id, name, public_key, created_at')
        .in('user_id', [myId, contactId])
        .then(({ data, error }) => {
          if (error) throw error
          map = new Map(data.map((d) => [d.id, d]))
          return data
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }

  // Public key of a device, refreshing once if we haven't seen it yet
  async function keyFor(deviceId) {
    let d = map.get(deviceId)
    if (!d) {
      await refresh()
      d = map.get(deviceId)
    }
    return d ? d.public_key : null
  }

  return { refresh, keyFor }
}