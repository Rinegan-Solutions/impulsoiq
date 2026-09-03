import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
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

export function signIn(email: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    const auth = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(auth, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: reject,
    });
  });
}

export function signUp(email: string, password: string, tenantId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attrs = [new CognitoUserAttribute({ Name: 'custom:tenant_id', Value: tenantId })];
    getPool().signUp(email, password, attrs, [], (err) => (err ? reject(err) : resolve()));
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    new CognitoUser({ Username: email, Pool: getPool() }).confirmRegistration(code, true, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    new CognitoUser({ Username: email, Pool: getPool() }).forgotPassword({
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}

export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    new CognitoUser({ Username: email, Pool: getPool() }).confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}

export function signOut(): void {
  try { getPool().getCurrentUser()?.signOut(); } catch { /* pool not configured */ }
}

export function getCurrentToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let pool: CognitoUserPool;
    try { pool = getPool(); } catch { return resolve(null); }
    const user = pool.getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((
      err: Error | null,
      session: { isValid: () => boolean; getIdToken: () => { getJwtToken: () => string } } | null,
    ) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}
