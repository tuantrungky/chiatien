import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, KeyRound, Loader2, LogIn, LogOut, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isMockMode } from '../services/api';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            auto_select?: boolean;
            callback: (response: { credential?: string }) => void;
          }) => void;
          prompt: (
            listener?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
            }) => void
          ) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; width?: number; text?: string; locale?: string }
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export function GoogleSignInButtonBox({ onSuccess }: { onSuccess?: () => void }) {
  const btnRef = useRef<HTMLDivElement | null>(null);
  const {
    usesFirebaseAuth,
    loginWithIdToken,
    loginWithFirebase,
    loginMockEditor,
    loginMockMember,
    authLoading,
    authError,
  } = useAuth();
  const mockActive = isMockMode();
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const hasRealClientId = Boolean(clientId && !clientId.includes('YOUR_GOOGLE_CLIENT_ID'));

  useEffect(() => {
    if (usesFirebaseAuth || mockActive || !hasRealClientId || !btnRef.current) return;

    let cancelled = false;
    const tryInit = () => {
      if (cancelled || !btnRef.current) return false;
      const gsi = window.google?.accounts?.id;
      if (!gsi) return false;

      btnRef.current.innerHTML = '';
      gsi.initialize({
        client_id: clientId,
        callback: async (res) => {
          if (res.credential) {
            const ok = await loginWithIdToken(res.credential);
            if (ok && onSuccess) onSuccess();
          }
        },
      });
      gsi.renderButton(btnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
        text: 'signin_with',
        locale: 'vi',
      });
      return true;
    };

    if (!tryInit()) {
      const interval = setInterval(() => {
        if (tryInit()) clearInterval(interval);
      }, 250);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [clientId, hasRealClientId, loginWithIdToken, onSuccess, usesFirebaseAuth, mockActive]);

  return (
    <div className="space-y-3">
      {authError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{authError}</span>
        </div>
      )}

      {authLoading ? (
        <div className="py-3 flex items-center justify-center gap-2 text-xs font-medium text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Đang xác thực tài khoản...</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5">
          {usesFirebaseAuth && !mockActive ? (
            <button
              type="button"
              onClick={async () => {
                const ok = await loginWithFirebase();
                if (ok && onSuccess) onSuccess();
              }}
              className="w-full inline-flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.3 0 6.08-1.09 8.105-2.96l-3.88-3.05c-1.08.73-2.46 1.16-4.225 1.16-3.25 0-6-2.19-6.98-5.14H1.01v3.14C3.02 21.14 7.19 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.02 14.01c-.25-.73-.39-1.51-.39-2.31s.14-1.58.39-2.31V6.25H1.01C.37 7.53 0 8.97 0 11.7s.37 4.17 1.01 5.45l4.01-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.55c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.09 15.3 0 12 0 7.19 0 3.02 2.86 1.01 6.25l4.01 3.14C6 6.74 8.75 4.55 12 4.55Z"
                />
              </svg>
              <span>Đăng nhập bằng Google</span>
            </button>
          ) : !mockActive ? (
            hasRealClientId ? (
              <div ref={btnRef} className="min-h-[44px] flex items-center justify-center" />
            ) : (
              <p className="text-xs text-slate-500 text-center">
                Chưa cấu hình <code className="bg-slate-100 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code> hoặc Firebase Auth.
              </p>
            )
          ) : null}

          {mockActive && (
            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={async () => {
                  const ok = await loginMockEditor();
                  if (ok && onSuccess) onSuccess();
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>Đăng nhập Demo (Mock Admin)</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await loginMockMember();
                  if (ok && onSuccess) onSuccess();
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-semibold transition cursor-pointer"
              >
                <UserCheck className="w-4 h-4" />
                <span>Đăng nhập Demo (Thành viên)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EditorLoginButton() {
  const {
    editor,
    isLoggedIn,
    isEditor,
    loginModalOpen,
    openLoginModal,
    closeLoginModal,
    logout,
  } = useAuth();

  useEffect(() => {
    if (!loginModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLoginModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loginModalOpen, closeLoginModal]);

  return (
    <>
      {isLoggedIn && editor ? (
        <div className="flex items-center gap-1.5">
          {isEditor ? (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-semibold text-emerald-800 max-w-[110px] truncate">
                {editor.name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-600 text-white">
                {editor.role}
              </span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-sky-600" />
              <span className="font-semibold text-sky-900 max-w-[110px] truncate">
                {editor.name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-600 text-white">
                Thành viên
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            title="Đăng xuất"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Thoát</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openLoginModal}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 active:scale-[0.98] transition cursor-pointer shrink-0"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Đăng nhập</span>
        </button>
      )}

      {loginModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={closeLoginModal}
          >
            <div
              className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Đăng nhập Google</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Thành viên đăng nhập để tự lưu tên &amp; xem nợ nhanh; Thủ quỹ / Editor để ghi buổi &amp; gạch nợ.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeLoginModal}
                  aria-label="Đóng hộp thoại đăng nhập"
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <GoogleSignInButtonBox />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
