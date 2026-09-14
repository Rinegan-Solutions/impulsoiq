/**
 * Cognito user-pool client for the web app.
 *
 * Each function wraps one amazon-cognito-identity-js callback API in a promise.
 * Rejected errors keep Cognito's `code` (UserNotConfirmedException,
 * PasswordResetRequiredException, ...) because screens ROUTE on it — an
 * unverified user belongs on /verify, not looking at an error banner.
 */
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type CognitoUserSession,
  type IAuthenticationCallback,
} from 'amazon-cognito-identity-js';

let _pool: CognitoUserPool | null = null;

function getPool(): CognitoUserPool {
  if (!_pool) {
    const UserPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
    const ClientId   = import.meta.env.VITE_COGNITO_CLIENT_ID   as string | undefined;
    if (!UserPoolId || !ClientId) {
      throw new Error('Missing VITE_COGNITO_USER_POOL_ID or VITE_COGNITO_CLIENT_ID env vars');
    }
    _pool = new CognitoUserPool({ UserPoolId, ClientId });
  }
  return _pool;
}

function cognitoUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: getPool() });
}

// ─── Identity ────────────────────────────────────────────────────────────────

export interface SessionUser {
  /** Raw ID token. API Gateway's COGNITO_USER_POOLS authorizer reads this. */
  token: string;
  sub: string;
  email: string;
  /** Standard `name` attribute. Empty for accounts created before sign-up sent it. */
  name: string;
  /** custom:tenant_id — the workspace slug. Immutable. */
  tenantId: string;
  /** cognito:groups — admin | manager | member, assigned by tenant-provisioner. */
  groups: string[];
}

function toSessionUser(session: CognitoUserSession): SessionUser {
  const id = session.getIdToken();
  const c = id.decodePayload() as Record<string, unknown>;
  const groups = c['cognito:groups'];
  return {
    token:    id.getJwtToken(),
    sub:      String(c.sub ?? ''),
    email:    String(c.email ?? ''),
    name:     String(c.name ?? ''),
    tenantId: String(c['custom:tenant_id'] ?? ''),
    groups:   Array.isArray(groups) ? groups.map(String) : [],
  };
}

/**
 * The signed-in user, or null. getSession() transparently exchanges the refresh
 * token when the ID token has expired, so a returning visitor stays signed in.
 */
export function getSessionUser(): Promise<SessionUser | null> {
  return new Promise((resolve) => {
    let user: CognitoUser | null;
    try { user = getPool().getCurrentUser(); } catch { return resolve(null); }
    if (!user) return resolve(null);
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(toSessionUser(session));
    });
  });
}

export async function getCurrentToken(): Promise<string | null> {
  return (await getSessionUser())?.token ?? null;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export function authErrorCode(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown } | null;
  if (e && typeof e.code === 'string') return e.code;
  if (e && typeof e.name === 'string') return e.name;
  return '';
}

/** A message fit to show a user. Cognito's own text is kept only where it names the rule that failed. */
export function authErrorMessage(err: unknown, fallback: string): string {
  const raw = (err as { message?: unknown } | null)?.message;
  const message = typeof raw === 'string' ? raw : '';
  switch (authErrorCode(err)) {
    case 'NotAuthorizedException':
      if (/attempts exceeded/i.test(message)) return 'Too many failed attempts. Wait a few minutes, then try again.';
      if (/disabled/i.test(message)) return 'This account has been disabled. Contact your workspace admin.';
      return 'Incorrect email or password.';
    // prevent_user_existence_errors masks most of these, but never reveal
    // whether an account exists if one slips through.
    case 'UserNotFoundException':
      return 'Incorrect email or password.';
    case 'CodeMismatchException':
      return 'That code is incorrect. Use the most recent code we emailed you.';
    case 'ExpiredCodeException':
      return 'That code has expired. Request a new one.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'Too many attempts. Wait a few minutes, then try again.';
    case 'UsernameExistsException':
      return 'An account with this email already exists. Sign in instead.';
    // A Cognito trigger refused the request (tenant-provisioner's PreSignUp
    // checks). Its message is written for the user; drop Cognito's prefix.
    case 'UserLambdaValidationException':
      return message.replace(/^\w+ failed with error\s*/i, '').replace(/\.{2,}$/, '.') || fallback;
    default:
      return message || fallback;
  }
}

/** Mirrors password_policy on the user pool (infra-backend/modules/auth/main.tf). */
export function passwordProblem(password: string): string | null {
  if (password.length < 12)     return 'Password must be at least 12 characters.';
  if (!/[A-Z]/.test(password))  return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(password))  return 'Password must include a number.';
  return null;
}

// ─── Sign in ─────────────────────────────────────────────────────────────────

export type SignInResult =
  | { kind: 'signedIn' }
  // An administrator-created account must choose its own password before the
  // pool issues tokens. The same CognitoUser has to answer the challenge, so
  // the continuation is handed back rather than rebuilt later.
  | { kind: 'newPasswordRequired'; complete: (newPassword: string) => Promise<void> };

const MFA_UNSUPPORTED =
  'This account requires multi-factor authentication, which this workspace does not support yet. Contact your administrator.';

function challengeCallbacks(
  onSuccess: () => void,
  onFailure: (err: unknown) => void,
): IAuthenticationCallback {
  // Without these handlers the library throws "callback.mfaRequired is not a
  // function" if the pool ever issues the challenge. Fail with a real message.
  const unsupported = () => onFailure(new Error(MFA_UNSUPPORTED));
  return {
    onSuccess,
    onFailure,
    mfaRequired:   unsupported,
    totpRequired:  unsupported,
    mfaSetup:      unsupported,
    selectMFAType: unsupported,
  };
}

export function signIn(email: string, password: string): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    const user = cognitoUser(email);
    const auth = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(auth, {
      ...challengeCallbacks(() => resolve({ kind: 'signedIn' }), reject),
      newPasswordRequired: () => resolve({
        kind: 'newPasswordRequired',
        complete: (newPassword) => new Promise<void>((done, fail) => {
          // Cognito passes the user's current attributes with this challenge.
          // They must not be echoed back: email and email_verified are not
          // writable, and sending them fails the whole call.
          user.completeNewPasswordChallenge(newPassword, {}, challengeCallbacks(() => done(), fail));
        }),
      }),
    });
  });
}

// ─── Sign up & verification ──────────────────────────────────────────────────

/**
 * `workspaceName` is sent only when CREATING a workspace. tenant-provisioner
 * uses it as the new workspace's display name, and ignores it when the
 * workspace already exists — a joiner can never rename someone else's.
 */
export function signUp(
  email: string, password: string, tenantId: string, name: string, workspaceName?: string,
  clientMetadata?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const attrs = [new CognitoUserAttribute({ Name: 'custom:tenant_id', Value: tenantId })];
    if (name) attrs.push(new CognitoUserAttribute({ Name: 'name', Value: name }));
    if (workspaceName) {
      attrs.push(new CognitoUserAttribute({ Name: 'custom:workspace_name', Value: workspaceName.slice(0, 80) }));
    }
    // clientMetadata reaches the PreSignUp trigger and is NOT stored on the
    // account — which is why the invitation token travels here rather than as a
    // custom attribute that would remain readable afterwards.
    getPool().signUp(email, password, attrs, [], (err) => (err ? reject(err) : resolve()), clientMetadata);
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).confirmRegistration(code, true, (err) => (err ? reject(err) : resolve()));
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

// ─── Password reset ──────────────────────────────────────────────────────────

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).forgotPassword({
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}

export function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}

// ─── Profile ─────────────────────────────────────────────────────────────────

/** Update the standard `name` attribute, then refresh so the ID token carries it. */
export function updateDisplayName(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let user: CognitoUser | null;
    try { user = getPool().getCurrentUser(); } catch (e) { return reject(e); }
    if (!user) return reject(new Error('You are signed out. Sign in again to update your profile.'));
    const u = user;
    u.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) return reject(err ?? new Error('Session expired. Sign in again.'));
      u.updateAttributes([new CognitoUserAttribute({ Name: 'name', Value: name })], (updateErr) => {
        if (updateErr) return reject(updateErr);
        // The stored ID token was minted before the change; without a refresh
        // the app would keep showing the old name until the token expired.
        u.refreshSession(session.getRefreshToken(), (refreshErr) => (refreshErr ? reject(refreshErr) : resolve()));
      });
    });
  });
}

// ─── Sign out ────────────────────────────────────────────────────────────────

/**
 * Mint fresh tokens now. getSession() only refreshes EXPIRED tokens, so a
 * change made after sign-in — such as a repaired workspace membership, which
 * lives in the ID token's cognito:groups — stays invisible until this runs.
 */
export function refreshSessionTokens(): Promise<void> {
  return new Promise((resolve, reject) => {
    let user: CognitoUser | null;
    try { user = getPool().getCurrentUser(); } catch (e) { return reject(e); }
    if (!user) return reject(new Error('Signed out'));
    const u = user;
    u.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) return reject(err ?? new Error('Session expired'));
      u.refreshSession(session.getRefreshToken(), (refreshErr) => (refreshErr ? reject(refreshErr) : resolve()));
    });
  });
}

/**
 * Revoke the refresh token server-side (the web client has
 * enable_token_revocation) and clear this device's session.
 *
 * Local state is ALWAYS cleared: a failed or slow revocation must never leave
 * someone signed in on a shared machine. signOut(callback) skips clearing when
 * it cannot load the session, so the no-argument form runs regardless.
 */
export function signOut(): Promise<void> {
  return new Promise((resolve) => {
    let user: CognitoUser | null = null;
    try { user = getPool().getCurrentUser(); } catch { /* pool not configured */ }
    if (!user) return resolve();
    const u = user;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      u.signOut();
      resolve();
    };
    setTimeout(finish, 4000);
    u.signOut(finish);
  });
}
