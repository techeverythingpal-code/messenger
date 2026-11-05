import { supabase } from './supabase'

// Profile pictures live in the private "avatars" bucket (see supabase/avatars.sql).
// Path: <user id>/<random id>.jpg  - a new name on every upload, so nobody
// ever sees an old cached picture.
//
// The bucket is private, so to show a picture we ask Supabase for a
// short-lived signed link. Links are cached here, so the same picture
// isn't requested again every time a list re-renders.

const BUCKET = 'avatars'
const LINK_SECONDS = 60 * 60 // a link works for 1 hour
const REFRESH_EARLY_MS = 5 * 60 * 1000 // get a new one 5 minutes before it expires

// path -> { url, expiresAt } or { promise } while loading
const cache = new Map()

// A signed link for a picture path, or null if there is none / not allowed
export async function getAvatarUrl(path) {
  if (!path) return null

  const hit = cache.get(path)
  if (hit?.promise) return hit.promise
  if (hit?.url && hit.expiresAt - REFRESH_EARLY_MS > Date.now()) return hit.url

  const promise = supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, LINK_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        cache.delete(path) // try again next time (e.g. just became friends)
        return null
      }
      cache.set(path, {
        url: data.signedUrl,
        expiresAt: Date.now() + LINK_SECONDS * 1000,
      })
      return data.signedUrl
    })
    .catch(() => {
      cache.delete(path)
      return null
    })

  cache.set(path, { promise })
  return promise
}

// Upload a cropped JPEG as my new picture. Returns the new path (throws on error).
export async function uploadAvatar(userId, blob, oldPath) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`

  // 1. Upload the file
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw upErr

  // 2. Point my profile at it (friends get this change live)
  const { error: dbErr } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId)
  if (dbErr) {
    // Don't leave an unused file behind
    await supabase.storage.from(BUCKET).remove([path])
    throw dbErr
  }

  // 3. Delete the old picture (not worth failing over)
  if (oldPath) {
    cache.delete(oldPath)
    await supabase.storage.from(BUCKET).remove([oldPath])
  }
  return path
}

// Remove my picture completely (throws on error)
export async function removeAvatar(userId, oldPath) {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', userId)
  if (error) throw error

  if (oldPath) {
    cache.delete(oldPath)
    await supabase.storage.from(BUCKET).remove([oldPath])
  }
}

// Delete every file in my folder (used before deleting my account,
// because the database can't delete storage files by itself)
export async function deleteAllMyAvatars(userId) {
  const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 })
  const paths = (data || []).map((f) => `${userId}/${f.name}`)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}