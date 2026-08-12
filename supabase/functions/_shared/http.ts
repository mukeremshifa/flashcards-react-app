/**
 * The two things every Edge Function response needs before it needs anything
 * else: CORS, and a way to say no.
 *
 * The browser calls this function cross-origin (a Vite dev server or the
 * deployed SPA, talking to `*.functions.supabase.co`), and it sends an
 * `Authorization` header, so every call is preceded by a preflight. A function
 * that forgets this fails with a CORS error that says nothing about the actual
 * request.
 */

export const CORS_HEADERS: Record<string, string> = {
  // The publishable key and the caller's JWT are what authorise a request
  // (SPEC §5.7); the origin is not, and restricting it here would break the dev
  // server without protecting anything RLS is not already protecting.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * A refusal the stream never got to.
 *
 * Anything the *user* can act on — quota, rate limit, an input that is too long —
 * is an `error` frame on a 200 stream instead (SPEC §7.3), because by then the
 * client is reading a stream and a status code is not where it is looking. This
 * is for the cases before that: no token, unparseable body, no API key
 * configured.
 */
export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
