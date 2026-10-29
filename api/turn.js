// api/turn.js
// Vercel serverless function: creates short-lived Cloudflare TURN
// credentials. The secret key stays on the server and never reaches
// the browser.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const keyId = process.env.TURN_KEY_ID
  const token = process.env.TURN_KEY_API_TOKEN

  if (!keyId || !token) {
    return res.status(500).json({ error: 'TURN is not configured' })
  }

  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    )

    if (!r.ok) {
      return res.status(502).json({ error: 'TURN provider error' })
    }

    const data = await r.json()
    const list = Array.isArray(data.iceServers)
      ? data.iceServers
      : [data.iceServers]

    // Browsers block port 53, so drop those URLs to avoid connection timeouts
    const iceServers = list.map((s) => ({
      ...s,
      urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
    }))

    return res.status(200).json({ iceServers })
  } catch {
    return res.status(502).json({ error: 'TURN request failed' })
  }
}