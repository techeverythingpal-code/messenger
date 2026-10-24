import { encryptMessage, decryptMessage, fromB64, toB64 } from './encrypt'

async function newUser() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { priv: pair.privateKey, jwk }
}

export async function runSelfTest() {
  const results = []
  const check = (name, ok) => results.push({ name, ok: !!ok })

  const A = await newUser() // Alice
  const B = await newUser() // Bob
  const C = await newUser() // an outsider
  const text = 'Hello 👋 שלום مرحبا'

  // Alice encrypts for Bob
  const msg = await encryptMessage(A.priv, B.jwk, 'alice', 'bob', text)

  // 1. Bob can read it (uses Alice's public key)
  const bobReads = await decryptMessage(B.priv, A.jwk, 'alice', 'bob', msg)
  check('Receiver can decrypt (incl. emoji and Hebrew/Arabic)', bobReads === text)

  // 2. Alice can read her own sent message (uses Bob's public key)
  const aliceReads = await decryptMessage(A.priv, B.jwk, 'alice', 'bob', msg)
  check('Sender can decrypt own message', aliceReads === text)

  // 3. Server only sees ciphertext
  check('Ciphertext does not contain the plain text', !msg.ciphertext.includes('Hello'))

  // 4. Fresh IV every time
  const msg2 = await encryptMessage(A.priv, B.jwk, 'alice', 'bob', text)
  check('Same text gives different ciphertext and IV', msg.ciphertext !== msg2.ciphertext && msg.iv !== msg2.iv)

  // 5. IV length matches the database rule (16 base64 chars)
  check('IV is 16 characters (database rule)', msg.iv.length === 16)

  // 6. Tampering is detected
  const bytes = fromB64(msg.ciphertext)
  bytes[0] ^= 1
  const tampered = { ...msg, ciphertext: toB64(bytes) }
  check('Tampered message is rejected', (await decryptMessage(B.priv, A.jwk, 'alice', 'bob', tampered)) === null)

  // 7. Reflection / re-routing is detected
  check('Message re-routed to another conversation is rejected',
    (await decryptMessage(B.priv, A.jwk, 'bob', 'alice', msg)) === null)

  // 8. Outsider cannot read it
  check('Outsider cannot decrypt', (await decryptMessage(C.priv, A.jwk, 'alice', 'bob', msg)) === null)

  // 9. Empty and oversized messages are refused
  const refuses = async (t) => {
    try { await encryptMessage(A.priv, B.jwk, 'alice', 'bob', t); return false } catch { return true }
  }
  check('Empty message refused', await refuses('   '))
  check('Oversized message refused', await refuses('x'.repeat(2001)))

  return results
}