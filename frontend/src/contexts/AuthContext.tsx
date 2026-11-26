import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClientError, IS_MOCK_MODE, verifyEditor } from '../services/api';
import type { EditorSessionState, VerifyEditorResponse } from '../types';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'cln_editor_session_v2';
const PROFILE_KEY = 'cln_editor_profile_v2';

interface AuthContextValue {
  editor: VerifyEditorResponse | null;
  idToken: string | null;
  exp: number | null;
  isEditor: boolean;
  isAdmin: boolean;
  loginModalOpen: boolean;
  reauthRequired: boolean;
  authLoading: boolean;
  authError: string | null;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  loginWithIdToken: (credential: string, silent?: boolean) => Promise<boolean>;
  loginMockEditor: () => Promise<boolean>;
  logout: () => void;
  handleApiError: (err: unknown) => string;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwtExp(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return Date.now() + 3600 * 1000;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(json) as { exp?: number };
    if (parsed.exp) return parsed.exp * 1000;
  } catch {
    // Fallback 1 giờ
  }
  return Date.now() + 3600 * 1000;
}

function readStoredSession(): EditorSessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorSessionState;
    if (!parsed?.idToken || !parsed?.editor || !parsed?.exp) return null;
    if (parsed.exp <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasSavedProfile(): boolean {
  try {
    return Boolean(localStorage.getItem(PROFILE_KEY));
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [session, setSession] = useState<EditorSessionState | null>(() => readStoredSession());
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const silentPromptAttempted = useRef(false);

  const loginWithIdToken = useCallback(
    async (credential: string, silent = false): Promise<boolean> => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const verified = await verifyEditor(credential);
        if (!verified.authorized) {
          setAuthError('Tài khoản Google này không có quyền Editor.');
          return false;
        }
        const exp = decodeJwtExp(credential);
        const next: EditorSessionState = {
          idToken: credential,
          editor: verified,
          exp,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(PROFILE_KEY, JSON.stringify(verified));
        setSession(next);
        setLoginModalOpen(false);
        setReauthRequired(false);
        if (!silent) {
          toast.success(`Đã đăng nhập Editor (${verified.name})`);
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Xác thực Editor thất bại.';
        setAuthError(msg);
        if (!silent) toast.error(msg);
        return false;
      } finally {
        setAuthLoading(false);
      }
    },
    [toast]
  );

  // Thử làm mới token im lặng qua Google One Tap auto_select khi hồ sơ Editor còn lưu trong localStorage
  const attemptSilentGoogleRefresh = useCallback(
    (showReauthOnSkip: boolean) => {
      const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
      const gsi = window.google?.accounts?.id;
      if (!clientId || clientId.includes('YOUR_GOOGLE_CLIENT_ID') || !gsi) {
        if (showReauthOnSkip) setReauthRequired(true);
        return;
      }

      try {
        gsi.initialize({
          client_id: clientId,
          auto_select: true,
          callback: async (res) => {
            if (res.credential) {
              await loginWithIdToken(res.credential, true);
            } else if (showReauthOnSkip) {
              setReauthRequired(true);
            }
          },
        });
        gsi.prompt((notification) => {
          if (
            (notification.isNotDisplayed() || notification.isSkippedMoment()) &&
            showReauthOnSkip
          ) {
            setReauthRequired(true);
          }
        });
      } catch {
        if (showReauthOnSkip) setReauthRequired(true);
      }
    },
    [loginWithIdToken]
  );

  // Khi mở lại app sau > 1h mà đã từng đăng nhập Editor -> thử One Tap tự động
  useEffect(() => {
    if (session || silentPromptAttempted.current || !hasSavedProfile()) return;
    silentPromptAttempted.current = true;
    if (IS_MOCK_MODE) return;

    const timer = setTimeout(() => {
      attemptSilentGoogleRefresh(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [session, attemptSilentGoogleRefresh]);

  // Hết hạn token trong lúc đang mở app -> tự làm mới im lặng hoặc hiện ReauthModal
  useEffect(() => {
    if (!session) return;
    const msLeft = session.exp - Date.now();
    if (msLeft <= 0) {
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      attemptSilentGoogleRefresh(true);
      return;
    }
    const timer = setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      attemptSilentGoogleRefresh(true);
    }, msLeft);
    return () => clearTimeout(timer);
  }, [session, attemptSilentGoogleRefresh]);

  const loginMockEditor = useCallback(async (): Promise<boolean> => {
    if (!IS_MOCK_MODE) return false;
    return loginWithIdToken('MOCK_ADMIN_ID_TOKEN');
  }, [loginWithIdToken]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILE_KEY);
    setSession(null);
    setReauthRequired(false);
    setAuthError(null);
    toast.info('Đã chuyển về chế độ Viewer.');
    try {
      window.google?.accounts?.id?.disableAutoSelect();
    } catch {
      // Ignore if GIS script not loaded
    }
  }, [toast]);

  const handleApiError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiClientError) {
        if (err.status === 401 || err.code === 'UNAUTHORIZED') {
          localStorage.removeItem(STORAGE_KEY);
          attemptSilentGoogleRefresh(true);
          const msg =
            'Phiên đăng nhập Editor đã hết hạn (1 giờ). Vui lòng xác nhận lại để tiếp tục lưu.';
          toast.error(msg);
          return msg;
        }
        toast.error(err.message);
        return err.message;
      }
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi gửi yêu cầu.';
      toast.error(msg);
      return msg;
    },
    [toast, attemptSilentGoogleRefresh]
  );

  const openLoginModal = useCallback(() => {
    setAuthError(null);
    setLoginModalOpen(true);
  }, []);

  const closeLoginModal = useCallback(() => {
    setLoginModalOpen(false);
    setAuthError(null);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{
        editor: session?.editor ?? null,
        idToken: session?.idToken ?? null,
        exp: session?.exp ?? null,
        isEditor: Boolean(session?.editor && session?.idToken),
        isAdmin: session?.editor?.role === 'ADMIN',
        loginModalOpen,
        reauthRequired,
        authLoading,
        authError,
        openLoginModal,
        closeLoginModal,
        loginWithIdToken,
        loginMockEditor,
        logout,
        handleApiError,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth phải được sử dụng bên trong AuthProvider.');
  }
  return ctx;
}
