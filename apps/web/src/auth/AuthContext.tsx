import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, UserDto } from '@pulsewatch/shared';
import { getMe, getToken, setToken } from '../api/client';

interface AuthState {
  user: UserDto | null;
  /** True until the stored token has been checked against the API. */
  loading: boolean;
  signIn: (res: AuthResponse) => void;
  signOut: () => void;
  /** Convenience for hiding admin-only controls. */
  can: (...roles: UserDto['role'][]) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  // A token in localStorage may be expired or from a deleted account, so it is
  // only trusted once /auth/me confirms it.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback((res: AuthResponse) => {
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const can = useCallback(
    (...roles: UserDto['role'][]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, can }),
    [user, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
