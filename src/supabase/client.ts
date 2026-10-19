import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (Boolean(url) !== Boolean(publishableKey)) {
  throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable guest accounts.');
}

export const supabase = url && publishableKey
  ? createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  : null;

/** Creates a persistent anonymous Supabase identity, or a local identity when credentials are not configured. */
export async function initializeGuestIdentity(): Promise<Readonly<{ guestId: string; onlineReady: boolean }>> {
  if (!supabase) return { guestId: globalThis.crypto.randomUUID(), onlineReady: false };

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) {
    return { guestId: sessionData.session.user.id, onlineReady: true };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Supabase did not return an anonymous user.');
  return { guestId: data.user.id, onlineReady: true };
}
