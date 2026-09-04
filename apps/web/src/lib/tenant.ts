/**
 * Tenant resolution from the browser address.
 *
 * The workspace slug is the FIRST label of the hostname when the host sits
 * under the environment's zone: acme.impulsoiq.rinegansolutions.com -> "acme".
 * The apex, www, and any reserved label resolve to null — those are the
 * marketing/app host, not a workspace.
 *
 * This mirrors infra-web/functions/tenant-router.js exactly. The two must agree:
 * the edge function rejects hosts this would not resolve, and the API compares
 * what this produces against the signed custom:tenant_id claim.
 */

// Must match RESERVED in tenant-router.js and the reserved list enforced at
// sign-up. A slug in this set can never be a workspace.
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'smtp', 'imap', 'ftp', 'cdn',
  'static', 'assets', 'status', 'docs', 'support', 'help', 'blog',
  'dev', 'test', 'stage', 'staging', 'prod', 'internal', 'root',
  'security', 'autodiscover', 'autoconfig', '_domainkey',
]);

// Same grammar as the tenant.id CHECK constraint in schema.sql.
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** Normalise a workspace name into a slug. Used by sign-up. */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED.has(slug);
}

/**
 * The environment's own host — the zone tenants sit under.
 *
 * Injected at build time from SSM (/impulsoiq/<env>/web/domain), the same
 * value Terraform gives the CloudFront function. Without it this cannot tell
 * the apex from a workspace: on impulsoiq.rinegansolutions.com the first label
 * is "impulsoiq", which is a perfectly valid slug, so a naive first-label read
 * resolves the marketing site as a tenant called "impulsoiq".
 */
const ZONE = (import.meta.env.VITE_WEB_ZONE ?? '').toLowerCase();

/**
 * The workspace this browser session is addressing, or '' when there is none
 * (the apex, www, localhost, or a reserved label).
 *
 * Derived from the hostname rather than from the token, so that the two can be
 * COMPARED. Reading it from the token would make the check tautological.
 */
export function currentTenantSlug(host: string = window.location.hostname): string {
  const h = host.split(':')[0].toLowerCase();

  // Local development and IP literals have no workspace label.
  if (h === 'localhost' || h.endsWith('.localhost') || /^[0-9.]+$/.test(h)) return '';

  // Without a configured zone, refuse to guess. Returning a wrong slug here
  // would send a header that makes every API call 403.
  if (!ZONE || h === ZONE) return '';

  if (!h.endsWith('.' + ZONE)) return '';

  const label = h.slice(0, h.length - ZONE.length - 1);
  // Exactly one label. "a.b.zone" is a malformed address, not a nested
  // workspace, and must not resolve to "a.b" or to "a".
  if (label.includes('.')) return '';

  return isValidSlug(label) ? label : '';
}
