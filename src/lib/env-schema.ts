import { z } from 'zod';

/**
 * Side-effect-free so it can be tested directly. `env.ts` applies it to
 * `import.meta.env` and throws; this module only describes the contract.
 *
 * SPEC §10: only the Supabase URL and the *publishable* key may reach the browser.
 * Supabase's modern key system (`sb_publishable_…` / `sb_secret_…`) replaces the
 * legacy `anon` / `service_role` JWTs, which are deprecated at the end of 2026.
 * The publishable key carries no privileges of its own — requests run as the
 * `anon` or `authenticated` Postgres role, so RLS remains the entire security
 * boundary.
 */
export const ClientEnv = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a URL'),

  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'VITE_SUPABASE_PUBLISHABLE_KEY is required')
    /*
     * The important check. A secret key in a client bundle is a total RLS bypass:
     * it maps to `service_role`, which holds BYPASSRLS. Supabase refuses secret
     * keys sent from a browser User-Agent, but the key would still sit in the
     * shipped JavaScript for anyone to lift and replay from curl. Refuse to boot
     * rather than ship it.
     */
    .refine(key => !key.startsWith('sb_secret_'), {
      message:
        'That is a SECRET key. It bypasses row level security and must never reach the ' +
        'browser — use the publishable key (sb_publishable_…) here.',
    })
    .refine(key => !key.startsWith('eyJ'), {
      message:
        'That looks like a legacy JWT key (anon/service_role). This project uses the ' +
        'modern key system — copy the publishable key (sb_publishable_…) from ' +
        'Supabase → Settings → API Keys.',
    })
    .refine(key => key.startsWith('sb_publishable_'), {
      message: 'Expected a publishable key beginning with "sb_publishable_".',
    }),
});

export type ClientEnv = z.infer<typeof ClientEnv>;
