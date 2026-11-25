import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiClientError, IS_MOCK_MODE, verifyEditor } from '../services/api';
import type { EditorSessionState, VerifyEditorResponse } from '../types';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'cln_editor_session';

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
  loginWithIdToken: (credential: string) => Promise<boolean>;
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
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorSessionState;
    if (!parsed?.idToken || !parsed?.editor || !parsed?.exp) return null;
    if (parsed.exp <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [session, setSession] = useState<EditorSessionState | null>(() => readStoredSession());
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const msLeft = session.exp - Date.now();
    if (msLeft <= 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      setSession(null);
      return;
    }
    const timer = setTimeout(() => {
      sessionStorage.removeItem(STORAGE_KEY);
      setSession(null);
      setReauthRequired(true);
    }, msLeft);
    return () => clearTimeout(timer);
  }, [session]);

  const loginWithIdToken = useCallback(async (credential: string): Promise<boolean> => {
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
      setLoginModalOpen(false);
      setReauthRequired(false);
      toast.success(`Đã đăng nhập Editor (${verified.name})`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Xác thực Editor thất bại.';
      setAuthError(msg);
      toast.error(msg);
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [toast]);

  const loginMockEditor = useCallback(async (): Promise<boolean> => {
    if (!IS_MOCK_MODE) return false;
    return loginWithIdToken('MOCK_ADMIN_ID_TOKEN');
  }, [loginWithIdToken]);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
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

  const handleApiError = useCallback((err: unknown): string => {
    if (err instanceof ApiClientError) {
      if (err.status === 401 || err.code === 'UNAUTHORIZED') {
        // Không xóa form đang nhập: chỉ bật modal đăng nhập lại 1 chạm
        setReauthRequired(true);
        const msg = 'Phiên đăng nhập Editor đã hết hạn (1 giờ). Vui lòng đăng nhập lại để tiếp tục lưu.';
        toast.error(msg);
        return msg;
      }
      toast.error(err.message);
      return err.message;
    }
    const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra khi gửi yêu cầu.';
    toast.error(msg);
    return msg;
  }, [toast]);

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
