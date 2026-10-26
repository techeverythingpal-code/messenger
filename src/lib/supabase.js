import { createClient } from '@supabase/supabase-js'

// Captured at startup, because Supabase removes these details from the address afterwards
export const openedFromRecoveryLink = /[#&]type=recovery(&|$)/.test(window.location.hash)
export const emailLinkFailed = /[#&]error(_code|_description)?=/.test(window.location.hash)

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)