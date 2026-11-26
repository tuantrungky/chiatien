import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClientError, IS_MOCK_MODE, linkMemberEmail, verifyEditor } from '../services/api';
import type { EditorSessionState, VerifyEditorResponse } from '../types';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'cln_editor_session_v2';
const PROFILE_KEY = 'cln_editor_profile_v2';
const MY_MEMBER_KEY = 'cln_my_member_id_v1';

interface AuthContextValue {
  editor: VerifyEditorResponse | null;
  idToken: string | null;
  exp: number | null;
  isLoggedIn: boolean;
  isEditor: boolean;
  isAdmin: boolean;
  myMemberId: string | null;
  setMyMemberId: (memberId: string | null) => void;
  needsMemberLink: boolean;
  dismissMemberLinkPrompt: () => void;
  linkMyMember: (memberId: string) => Promise<boolean>;
  loginModalOpen: boolean;
  reauthRequired: boolean;
  authLoading: boolean;
  authError: string | null;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  loginWithIdToken: (credential: string, silent?: boolean) => Promise<boolean>;
  loginMockEditor: () => Promise<boolean>;
  loginMockMember: () => Promise<boolean>;
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

function readStoredMemberId(): string | null {
  try {
    return localStorage.getItem(MY_MEMBER_KEY) || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [session, setSession] = useState<EditorSessionState | null>(() => readStoredSession());
  const [myMemberId, setMyMemberIdState] = useState<string | null>(
    () => readStoredSession()?.editor?.linkedMemberId || readStoredMemberId()
  );
  const [dismissedMemberLink, setDismissedMemberLink] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const silentPromptAttempted = useRef(false);

  const setMyMemberId = useCallback((memberId: string | null) => {
    setMyMemberIdState(memberId);
    try {
      if (memberId) localStorage.setItem(MY_MEMBER_KEY, memberId);
      else localStorage.removeItem(MY_MEMBER_KEY);
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const loginWithIdToken = useCallback(
    async (credential: string, silent = false): Promise<boolean> => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const verified = await verifyEditor(credential);
        if (!verified.authorized) {
          setAuthError('Xác thực tài khoản Google thất bại.');
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
        setDismissedMemberLink(false);
        if (verified.linkedMemberId) {
          setMyMemberId(verified.linkedMemberId);
        }
        setLoginModalOpen(false);
        setReauthRequired(false);
        const verifiedIsEditor = Boolean(
          verified.isEditor ?? (verified.role === 'ADMIN' || verified.role === 'EDITOR')
        );
        if (!silent) {
          toast.success(
            verifiedIsEditor
              ? `Đã đăng nhập Editor (${verified.name})`
              : `Đã đăng nhập Thành viên (${verified.name})`
          );
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Xác thực tài khoản thất bại.';
        setAuthError(msg);
        if (!silent) toast.error(msg);
        return false;
      } finally {
        setAuthLoading(false);
      }
    },
    [toast, setMyMemberId]
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

  const loginMockMember = useCallback(async (): Promise<boolean> => {
    if (!IS_MOCK_MODE) return false;
    return loginWithIdToken('MOCK_MEMBER_ID_TOKEN');
  }, [loginWithIdToken]);

  const linkMyMember = useCallback(
    async (memberId: string): Promise<boolean> => {
      if (!session?.idToken) return false;
      try {
        const res = await linkMemberEmail(session.idToken, memberId);
        const updatedEditor: VerifyEditorResponse = {
          ...session.editor,
          linkedMemberId: res.linkedMemberId,
        };
        const updatedSession: EditorSessionState = {
          ...session,
          editor: updatedEditor,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSession));
        localStorage.setItem(PROFILE_KEY, JSON.stringify(updatedEditor));
        setSession(updatedSession);
        setMyMemberId(res.linkedMemberId);
        setDismissedMemberLink(false);
        toast.success('Đã liên kết tên thành viên với tài khoản Google.');
        return true;
      } catch (err) {
        if (err instanceof ApiClientError) {
          toast.error(err.message);
        } else {
          toast.error('Không thể liên kết thành viên.');
        }
        return false;
      }
    },
    [session, setMyMemberId, toast]
  );

  const dismissMemberLinkPrompt = useCallback(() => {
    setDismissedMemberLink(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILE_KEY);
    setSession(null);
    setDismissedMemberLink(false);
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
  const isLoggedIn = Boolean(session?.editor && session?.idToken);
  const isEditor = Boolean(
    session?.editor &&
      session?.idToken &&
      (session.editor.isEditor ?? (session.editor.role === 'ADMIN' || session.editor.role === 'EDITOR'))
  );
  const needsMemberLink = Boolean(
    isLoggedIn && !isEditor && !session?.editor?.linkedMemberId && !dismissedMemberLink
  );

  return (
    <AuthContext.Provider
      value={{
        editor: session?.editor ?? null,
        idToken: session?.idToken ?? null,
        exp: session?.exp ?? null,
        isLoggedIn,
        isEditor,
        isAdmin: session?.editor?.role === 'ADMIN',
        myMemberId,
        setMyMemberId,
        needsMemberLink,
        dismissMemberLinkPrompt,
        linkMyMember,
        loginModalOpen,
        reauthRequired,
        authLoading,
        authError,
        openLoginModal,
        closeLoginModal,
        loginWithIdToken,
        loginMockEditor,
        loginMockMember,
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
