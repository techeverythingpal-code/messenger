import { useEffect, useState } from 'react'
import { getAvatarUrl } from '../lib/avatars'

// A round profile picture. Shows 👤 when there is no picture,
// while it loads, or if it can't be loaded.
//
// Props:
//   path   profiles.avatar_path (or null)
//   size   width and height in px (default 32)
//   name   used for the image's alt text, e.g. "@alice"
export default function Avatar({ path, size = 32, name = '' }) {
  // The link we got, remembered together with the path it belongs to,
  // so a changed path never shows the old picture
  const [loaded, setLoaded] = useState({ path: null, url: null })
  const [failedPath, setFailedPath] = useState(null)

  useEffect(() => {
    if (!path) return
    let alive = true
    getAvatarUrl(path).then((url) => {
      if (alive) setLoaded({ path, url })
    })
    return () => {
      alive = false
    }
  }, [path])

  const url = path && loaded.path === path && failedPath !== path ? loaded.url : null
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) }

  if (!url) {
    return (
      <span className="avatar empty" style={style} aria-hidden="true">
        👤
      </span>
    )
  }
  return (
    <img
      className="avatar"
      style={style}
      src={url}
      alt={name ? `${name}'s picture` : 'Profile picture'}
      loading="lazy"
      draggable={false}
      onError={() => setFailedPath(path)}
    />
  )
}