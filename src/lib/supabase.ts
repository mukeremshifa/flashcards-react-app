import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import type { Database } from '@/types/database';

/**
 * Browser Supabase client, typed against the generated schema.
 *
 * Authenticated with the publishable key, which grants no privileges by itself —
 * queries run as the `anon` role when signed out and `authenticated` when signed
 * in, so the RLS policies in supabase/migrations are the security boundary. The
 * key is designed to be public; do not treat leaking it as an incident, and do
 * not treat holding it as authorisation.
 *
 * Regenerate the types after any migration: `npm run db:types`.
 */
export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
