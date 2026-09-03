import { useState, useEffect } from 'react';
import { getCurrentToken, signOut as cognitoSignOut } from './cognito';

interface AuthState {
  user: { token: string } | null;
  loading: boolean;
  signOut: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<{ token: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentToken().then((token) => {
      setUser(token ? { token } : null);
      setLoading(false);
    });
  }, []);

  return {
    user,
    loading,
    signOut: () => {
      cognitoSignOut();
      setUser(null);
    },
  };
}
