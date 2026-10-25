import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendNotification } from 'npm:web-push-neo@0.1.2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const vapidDetails = {
  subject: Deno.env.get('VAPID_SUBJECT')!,
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
}
const SECRET = Deno.env.get('WEBHOOK_SECRET') ?? ''

// Compare secrets without leaking timing information
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Only our own database webhook knows this secret
  if (!SECRET || !safeEqual(req.headers.get('x-webhook-secret') ?? '', SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const row = body?.record
  if (body?.type !== 'INSERT' || !row) return new Response('ignored')

  // Every message is stored once per device. Skip the copies for my own devices.
  if (row.sender_id === row.target_user) return new Response('own copy')

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('device_id', row.target_device)
    .maybeSingle()
  if (!sub) return new Response('no subscription')

  const { data: sender } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', row.sender_id)
    .maybeSingle()

  // No message text: the server can't read it
  const payload = JSON.stringify({
    title: 'MeMe Messenger',
    body: `New message from @${sender?.username ?? 'a friend'}`,
    senderId: row.sender_id,
    tag: `chat-${row.sender_id}`,
  })

  try {
    await sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { vapidDetails, TTL: 3600, urgency: 'high' }
    )
  } catch (err) {
    const code = (err as { statusCode?: number })?.statusCode
    if (code === 404 || code === 410) {
      // The browser says this address no longer exists: clean it up
      await supabase.from('push_subscriptions').delete().eq('device_id', row.target_device)
    } else {
      console.error('push failed', code, err)
    }
  }

  return new Response('ok')
})