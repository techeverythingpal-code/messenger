// api/turn.js
// Vercel serverless function: returns the ICE servers for calls.
// The TURN username/password stay in Vercel env vars, not in the repo.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

   const username = (process.env.EXPRESSTURN_USERNAME || '').trim()
  const credential = (process.env.EXPRESSTURN_PASSWORD || '').trim()

  if (!username || !credential) {
    return res.status(500).json({ error: 'TURN is not configured' })
  }

  // Keep only the bare hostname, even if the value was pasted with
  // "turn:", "https://", a port like ":3478", or a path.
  const host =
    (process.env.EXPRESSTURN_HOST || 'relay1.expressturn.com')
      .trim()
      .replace(/^(turns?|stuns?):/i, '')
      .replace(/^\/\//, '')
      .replace(/^https?:\/\//i, '')
      .split(/[/?]/)[0]
      .replace(/:\d+$/, '') || 'relay1.expressturn.com'

  const iceServers = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun.expressturn.com:3478',
      ],
    },
    {
      urls: [
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
        // TLS on 443: the path that survives strict firewalls
        `turns:${host}:443?transport=tcp`,
      ],
      username,
      credential,
    },
  ]

  return res.status(200).json({ iceServers })
}