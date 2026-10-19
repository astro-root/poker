import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (Boolean(supabaseUrl) !== Boolean(supabasePublishableKey)) {
  throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable guest accounts.');
}

export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  : null;

let cachedAccessToken: string | null = null;
supabase?.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
});

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

/** Creates a persistent anonymous Supabase identity, or a local identity when credentials are not configured. */
export async function initializeGuestIdentity(): Promise<Readonly<{ guestId: string; onlineReady: boolean }>> {
  if (!supabase) return { guestId: globalThis.crypto.randomUUID(), onlineReady: false };

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) {
    cachedAccessToken = sessionData.session.access_token;
    return { guestId: sessionData.session.user.id, onlineReady: true };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Supabase did not return an anonymous user.');
  cachedAccessToken = data.session?.access_token ?? null;
  return { guestId: data.user.id, onlineReady: true };
}
