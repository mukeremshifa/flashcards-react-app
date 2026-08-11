import { z } from 'zod';

/**
 * SPEC §10: only the Supabase URL and anon key may reach the browser. If you find
 * yourself adding a provider API key here, it belongs in an Edge Function secret
 * instead — anything imported by this module ships to every visitor.
 */
const ClientEnv = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'VITE_SUPABASE_ANON_KEY is required'),
});

const parsed = ClientEnv.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

if (!parsed.success) {
  // Fail loudly at startup rather than as a confusing 401 on the first query.
  const issues = parsed.error.issues.map(issue => `  - ${issue.message}`).join('\n');
  throw new Error(
    `Missing or invalid environment variables:\n${issues}\n\n` +
      'Copy .env.example to .env.local and fill in your Supabase project values.',
  );
}

export const env = parsed.data;
