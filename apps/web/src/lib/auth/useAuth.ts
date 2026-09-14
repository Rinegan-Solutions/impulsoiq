import { createContext, useContext } from 'react';
import type { SessionUser } from './cognito';
import { displayName, greetingName, personNameFromEmail } from '@/lib/name';

/**
 * Shared authentication state.
 *
 * This used to be a hook with its own useState, so every component that called
 * it held a private copy: signing in updated nothing else on screen, which is
 * why SignIn had to force a full page reload, and signing out in the app shell
 * left the router still believing the user was signed in. One provider now
 * owns the session (AuthProvider.tsx) and everything reads it from context.
 */

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** Re-read the Cognito session. Call after anything that issues or changes tokens. */
  refresh: () => Promise<SessionUser | null>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

// ─── Presentation helpers ────────────────────────────────────────────────────

export type Role = 'admin' | 'manager' | 'member';

// Same precedence as the Cognito groups: a user in several gets the strongest.
const ROLE_PRECEDENCE: Role[] = ['admin', 'manager', 'member'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
};

export function roleOf(user: SessionUser): Role | null {
  return ROLE_PRECEDENCE.find((r) => user.groups.includes(r)) ?? null;
}

/** Full name for chrome and menus. Falls back to the address only as a last resort. */
export function displayNameOf(user: SessionUser): string {
  return displayName(user.name, user.email);
}

/**
 * The single word to greet someone by, or null when no honest name exists.
 * Never the raw email address — see lib/name.ts.
 */
export function greetingNameOf(user: SessionUser): string | null {
  return greetingName(user.name, user.email);
}

export function initialsOf(user: SessionUser): string {
  const source = user.name.trim() || personNameFromEmail(user.email) || user.email;
  const parts = source.split(/[\s._-]+/).filter((t) => /\p{L}/u.test(t));
  const initials = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toLocaleUpperCase();
  return initials || '?';
}
