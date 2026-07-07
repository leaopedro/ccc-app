import type { PublicUser } from '@jdm/shared/auth';
import type { LoginInput, SignupInput } from '@jdm/shared/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './storage';

import { loginRequest, logoutRequest, meAuthed, refreshRequest, signupRequest } from '~/api/auth';
import { registerTokenProvider } from '~/api/client';
import { authCopy } from '~/copy/auth';
import { captureException } from '~/lib/sentry';
import { usePushRegistration } from '~/notifications/use-push-registration';

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

type AuthState = {
  status: AuthStatus;
  user: PublicUser | null;
  tokens: StoredTokens | null;
  flashMessage: string | null;
};

type AuthContextValue = AuthState & {
  signup: (input: SignupInput) => Promise<PublicUser>;
  login: (input: LoginInput) => Promise<PublicUser>;
  setSession: (tokens: StoredTokens, user: PublicUser) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setFlashMessage: (message: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    tokens: null,
    flashMessage: null,
  });
  const tokensRef = useRef<StoredTokens | null>(null);

  const setFlashMessage = useCallback((message: string | null) => {
    setState((prev) => ({ ...prev, flashMessage: message }));
  }, []);

  const resetToSignedOut = useCallback((flashMessage: string | null = null) => {
    setState({
      status: 'unauthenticated',
      user: null,
      tokens: null,
      flashMessage,
    });
  }, []);

  const applySession = useCallback(async (tokens: StoredTokens, user: PublicUser) => {
    tokensRef.current = tokens;
    await saveTokens(tokens);
    setState((prev) => ({ ...prev, status: 'authenticated', tokens, user, flashMessage: null }));
  }, []);

  const signOut = useCallback(async () => {
    tokensRef.current = null;
    try {
      await clearTokens();
    } catch (error) {
      captureException(error, 'auth.clearTokens');
    } finally {
      resetToSignedOut();
    }
  }, [resetToSignedOut]);

  const handleAccountDisabled = useCallback(async () => {
    tokensRef.current = null;
    try {
      await clearTokens();
    } catch (error) {
      captureException(error, 'auth.clearTokens.accountDisabled');
    } finally {
      resetToSignedOut(authCopy.errors.accountDisabled);
    }
  }, [resetToSignedOut]);

  // Register provider once. Reads/writes go through tokensRef so the
  // closure never sees stale token state.
  useEffect(() => {
    registerTokenProvider({
      getAccessToken: () => tokensRef.current?.accessToken ?? null,
      refresh: async () => {
        const current = tokensRef.current;
        if (!current) throw new Error('no refresh token');
        const refreshed = await refreshRequest(current.refreshToken);
        await applySession(
          { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
          refreshed.user,
        );
        return refreshed.accessToken;
      },
      onSignOut: signOut,
      onAccountDisabled: handleAccountDisabled,
    });
  }, [applySession, signOut, handleAccountDisabled]);

  useEffect(() => {
    const boot = async () => {
      try {
        const stored = await loadTokens();
        if (!stored) {
          resetToSignedOut();
          return;
        }
        tokensRef.current = stored;
        const user = await meAuthed();
        setState((prev) => ({
          ...prev,
          status: 'authenticated',
          user,
          tokens: tokensRef.current ?? stored,
        }));
      } catch (error) {
        captureException(error, 'auth.boot');
        await signOut();
      }
    };
    void boot();
  }, [resetToSignedOut, signOut]);

  const signup: AuthContextValue['signup'] = useCallback(
    async (input) => {
      const res = await signupRequest(input);
      await applySession(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        res.user,
      );
      return res.user;
    },
    [applySession],
  );

  const login: AuthContextValue['login'] = useCallback(
    async (input) => {
      const res = await loginRequest(input);
      if ('mfaRequired' in res) {
        throw new Error(authCopy.errors.mfaNotSupported);
      }
      await applySession(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        res.user,
      );
      return res.user;
    },
    [applySession],
  );

  const logout: AuthContextValue['logout'] = useCallback(async () => {
    const current = tokensRef.current;
    if (current) {
      try {
        await logoutRequest(current.refreshToken);
      } catch {
        // local clear proceeds regardless
      }
    }
    await signOut();
  }, [signOut]);

  const refreshUser: AuthContextValue['refreshUser'] = useCallback(async () => {
    if (!tokensRef.current) return;
    try {
      const user = await meAuthed();
      setState((prev) => ({ ...prev, user }));
    } catch {
      // authedRequest handles refresh + sign-out on failure
    }
  }, []);

  usePushRegistration({ isAuthenticated: state.status === 'authenticated' });

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signup,
      login,
      setSession: applySession,
      logout,
      refreshUser,
      setFlashMessage,
    }),
    [state, signup, login, applySession, logout, refreshUser, setFlashMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
};
