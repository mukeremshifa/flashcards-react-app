import { describe, expect, it } from 'vitest';
import { ClientEnv } from './env-schema';

const url = 'https://cnlnsaamiujselyuowzx.supabase.co';

function parse(key: string) {
  return ClientEnv.safeParse({
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
  });
}

/**
 * These are security tests, not validation tests. The one that matters is
 * "rejects a secret key": shipping `sb_secret_…` in a client bundle hands every
 * visitor a `service_role` credential with BYPASSRLS, which defeats every policy
 * in supabase/migrations at once.
 */
describe('client env contract', () => {
  it('accepts a publishable key', () => {
    expect(parse('sb_publishable_jZCOx47AavMKIxjEHoqNvA_bnaEENyV').success).toBe(true);
  });

  it('rejects a secret key with an explicit warning', () => {
    const result = parse('sb_secret_epdtdSomethingSomething');
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/SECRET key/);
    expect(result.error!.issues[0]!.message).toMatch(/never reach the browser/);
  });

  it('rejects a legacy anon JWT and points at the modern key', () => {
    const result = parse('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig');
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/legacy JWT key/);
  });

  it('rejects an unrecognised key shape', () => {
    const result = parse('totally-made-up');
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/sb_publishable_/);
  });

  it('rejects an empty key', () => {
    expect(parse('').success).toBe(false);
  });

  it('rejects a non-URL project URL', () => {
    const result = ClientEnv.safeParse({
      VITE_SUPABASE_URL: 'cnlnsaamiujselyuowzx',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing key outright rather than defaulting', () => {
    const result = ClientEnv.safeParse({ VITE_SUPABASE_URL: url });
    expect(result.success).toBe(false);
  });
});
