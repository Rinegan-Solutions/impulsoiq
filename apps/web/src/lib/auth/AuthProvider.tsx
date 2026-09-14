import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSessionUser, signOut as cognitoSignOut, type SessionUser } from './cognito';
import { AuthContext, type AuthContextValue, type AuthStatus } from './useAuth';

// amazon-cognito-identity-js keeps its tokens in localStorage under this prefix.
const COGNITO_STORAGE_PREFIX = 'CognitoIdentityServiceProvider.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: SessionUser | null }>({
    status: 'loading',
    user: null,
  });

  const refresh = useCallback(async () => {
    const user = await getSessionUser();
    setState({ status: user ? 'signedIn' : 'signedOut', user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await cognitoSignOut();
    setState({ status: 'signedOut', user: null });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSessionUser().then((user) => {
      if (!cancelled) setState({ status: user ? 'signedIn' : 'signedOut', user });
    });

    // Signing in or out in another tab rewrites the Cognito keys. Follow it,
    // so a tab never keeps acting on a session that no longer exists.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(COGNITO_STORAGE_PREFIX)) void refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, signOut }),
    [state, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
