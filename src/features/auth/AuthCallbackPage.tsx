import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { supabase } from '@/lib/supabase';

/**
 * `/auth/callback` (SPEC §8.2) — where Supabase sends a confirmed email address
 * or a password-recovery link.
 *
 * Two shapes arrive here, because Supabase's `/auth/v1/verify` redirects
 * differently per flow:
 *
 * - **implicit** (this client's default, `flowType` is unset in `supabase.ts`) —
 *   tokens in the URL *fragment*. `detectSessionInUrl: true` means supabase-js
 *   has already consumed and stripped it before React mounts, so there is
 *   nothing to parse: `getSession()` awaits that same initialisation and
 *   answers with the result.
 * - **PKCE** — a `?code=` query parameter, which must be exchanged explicitly.
 *   Handled so that turning on PKCE later is a one-line client change and not a
 *   silent breakage here.
 *
 * Failures (an expired or already-used link) come back as `error` /
 * `error_description`, in the query string or the fragment depending on flow.
 *
 * Not wrapped in `PublicOnlyRoute`: its redirect fires the moment the exchange
 * produces a session, which would race this component's own navigation. The
 * effect is the same — an unauthenticated visitor is exactly who arrives here,
 * and nobody stays.
 */

/** Errors arrive in `?query` or `#fragment`; the parameter names are identical. */
function readCallbackParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const query = parsed.searchParams;
  for (const [key, value] of fragment) if (!query.has(key)) query.append(key, value);
  return query;
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Finishing sign-in…');
  // StrictMode mounts effects twice in development, and an auth code is
  // single-use: the second exchange would fail and bounce a valid link.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = readCallbackParams(window.location.href);

    const toLogin = (message: string) => {
      navigate('/login', { replace: true, state: { authMessage: message } });
    };

    void (async () => {
      const error = params.get('error') ?? params.get('error_code');
      if (error) {
        const description = params.get('error_description') ?? error;
        console.error('Auth callback rejected:', description);
        setStatus('That link could not be used.');
        toLogin(
          `${description.replace(/\+/g, ' ')}. Links expire, and each one works only once — request a new email and try again.`,
        );
        return;
      }

      const code = params.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error('Auth code exchange failed:', exchangeError);
          setStatus('That link could not be used.');
          toLogin(exchangeError.message);
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate('/dashboard', { replace: true });
        return;
      }

      // No error, no code, no session: someone opened the URL directly, or the
      // fragment was stripped by something in front of the app.
      setStatus('That link could not be used.');
      toLogin('That sign-in link was not valid. Sign in with your email and password.');
    })();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
      {/* A bare line of grey text on a white page is what a broken redirect
          looks like. The mark says the link landed somewhere real. */}
      <LogoLockup />
      <p className="text-muted-foreground text-center text-sm" role="status">
        {status}
      </p>
    </main>
  );
}
