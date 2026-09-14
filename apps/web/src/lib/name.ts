/**
 * Human names for greetings.
 *
 * ORDER OF TRUST
 * 1. The identity provider's `name` claim. If Cognito has a real name, use it —
 *    never "improve" it, because people's names are not ours to normalise.
 * 2. Only if that is absent, derive a name from the email local part.
 * 3. If that cannot be done honestly, return null and let the caller greet
 *    without a name. Showing the raw address ("Good evening,
 *    tolulope.orina@rinegansolutions.com") is worse than showing none.
 *
 * WHAT IS DELIBERATELY NOT GUESSED
 * - Role mailboxes (info@, support@, no-reply@) are not people.
 * - A run-together local part ("tolulopeorina") has no reliable split point, so
 *   it is returned as one capitalised word rather than invented as two.
 * - Digits are stripped from tokens ("john2024" → "John") but a token that is
 *   only digits is dropped entirely.
 */

/** Shared mailboxes that belong to a function, not a person. */
const ROLE_MAILBOXES = new Set([
  'info', 'admin', 'administrator', 'support', 'hello', 'help', 'helpdesk',
  'team', 'sales', 'contact', 'billing', 'accounts', 'accounting', 'finance',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'office', 'mail',
  'marketing', 'hi', 'hey', 'careers', 'jobs', 'recruiting', 'press', 'media',
  'legal', 'privacy', 'security', 'postmaster', 'webmaster', 'abuse', 'root',
  'enquiries', 'inquiries', 'general', 'service', 'services', 'notifications',
]);

/**
 * Capitalise a name token, including after an internal apostrophe or hyphen:
 * o'brien → O'Brien, anne-marie → Anne-Marie. Locale-aware so non-ASCII
 * alphabets uppercase correctly.
 */
function capitalise(token: string): string {
  return token.replace(
    /(^|['’-])(\p{L})/gu,
    (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase(),
  );
}

/**
 * A person's name derived from an email address, or null when no honest guess
 * exists. Hyphens stay inside a token (double-barrelled names); only dots,
 * underscores and whitespace separate name parts.
 */
export function personNameFromEmail(email: string | null | undefined): string | null {
  const raw = (email ?? '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  const local = at > 0 ? raw.slice(0, at) : '';
  if (!local) return null;

  // Plus-addressing is a tag, not part of the name: jo+news@ → jo
  const base = local.split('+')[0];
  if (!base || ROLE_MAILBOXES.has(base)) return null;

  const tokens = base
    .split(/[._\s]+/)
    .map((t) => t.replace(/\d+/g, ''))
    .filter((t) => /\p{L}/u.test(t));

  if (tokens.length === 0) return null;
  return tokens.map(capitalise).join(' ');
}

/** Full display name: the IdP name, else a derived one, else the address itself. */
export function displayName(name: string | null | undefined, email: string): string {
  const claimed = (name ?? '').trim();
  if (claimed) return claimed;
  return personNameFromEmail(email) ?? email;
}

/**
 * The single word to greet someone by, or null to greet without a name.
 * A leading initial ("t.orina") is skipped in favour of the first real word.
 */
export function greetingName(name: string | null | undefined, email: string): string | null {
  const full = (name ?? '').trim() || personNameFromEmail(email);
  if (!full) return null;
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.find((p) => p.replace(/[^\p{L}]/gu, '').length > 1) ?? parts[0] ?? null;
}
