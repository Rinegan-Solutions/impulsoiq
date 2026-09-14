/**
 * Where to send someone after sign-in.
 *
 * `next` arrives in the query string, so anyone can craft it. Only same-origin
 * absolute paths are honoured: "//evil.example" and "/\evil.example" are both
 * treated by browsers as protocol-relative URLs to another host, and following
 * them would bounce a freshly signed-in user off-site.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/home'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  // Returning to an auth page after signing in would just redirect again.
  if (/^\/(sign-in|sign-up)(?:[/?#]|$)/.test(raw)) return fallback;
  return raw;
}
