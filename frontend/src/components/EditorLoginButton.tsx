import { useEffect, useRef } from 'react';
import { AlertCircle, KeyRound, Loader2, LogIn, LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { IS_MOCK_MODE } from '../services/api';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
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
  const { loginWithIdToken, loginMockEditor, authLoading, authError } = useAuth();
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const hasRealClientId = Boolean(clientId && !clientId.includes('YOUR_GOOGLE_CLIENT_ID'));

  useEffect(() => {
    if (!hasRealClientId || !btnRef.current) return;

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
  }, [clientId, hasRealClientId, loginWithIdToken, onSuccess]);

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
          <span>Đang xác thực quyền Editor...</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5">
          {hasRealClientId ? (
            <div ref={btnRef} className="min-h-[44px] flex items-center justify-center" />
          ) : (
            <p className="text-xs text-slate-500 text-center">
              Chưa cấu hình <code className="bg-slate-100 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>.
            </p>
          )}

          {IS_MOCK_MODE && (
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
          )}
        </div>
      )}
    </div>
  );
}

export function EditorLoginButton() {
  const {
    editor,
    isEditor,
    loginModalOpen,
    openLoginModal,
    closeLoginModal,
    logout,
  } = useAuth();

  return (
    <>
      {isEditor && editor ? (
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-emerald-800 max-w-[110px] truncate">
              {editor.name}
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-600 text-white">
              {editor.role}
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Đăng xuất Editor"
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
          <span>Đăng nhập Editor</span>
        </button>
      )}

      {loginModalOpen && (
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
                <h3 className="text-base font-bold text-slate-900">Đăng nhập Quản lý (Editor)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chỉ email có trong tab Editors mới được tạo buổi &amp; gạch nợ.
                </p>
              </div>
              <button
                type="button"
                onClick={closeLoginModal}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <GoogleSignInButtonBox />
          </div>
        </div>
      )}
    </>
  );
}
