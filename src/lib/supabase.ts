import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Browser Supabase client. Uses the anon key, so every query is subject to the
 * RLS policies in supabase/migrations — the key is not a secret, the policies are
 * the security boundary.
 *
 * TODO(P0b): once a Supabase project exists, run `npm run db:types` and change
 * this to `createClient<Database>(…)` so table types flow through queries. Left
 * untyped rather than stubbed, so nothing depends on a hand-written guess at the
 * schema shape.
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
