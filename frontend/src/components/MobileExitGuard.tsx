import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, LogOut, ShieldAlert } from 'lucide-react';

interface ExitGuardHistoryState {
  __clnExitBase?: boolean;
  __clnExitGuard?: boolean;
  idx?: number;
  [key: string]: unknown;
}

/**
 * Chặn thao tác vuốt/bấm Back thoát khỏi webapp ngoài ý muốn trên mobile.
 * Đặt 1 history sentinel tại đáy stack của SPA; khi user bấm Back chạm đáy,
 * hiển thị hộp thoại xác nhận "Ở lại ứng dụng" hoặc "Thoát".
 */
export function MobileExitGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const exitingRef = useRef(false);

  // Gắn sentinel entry ở đáy lịch sử khi mở app lần đầu (idx === 0)
  useEffect(() => {
    const st = ((window.history.state as ExitGuardHistoryState | null) || {});
    if (st.__clnExitGuard === true) {
      return;
    }
    if (st.__clnExitBase === true) {
      window.history.pushState(
        { ...st, __clnExitBase: false, __clnExitGuard: true },
        '',
        window.location.href
      );
      return;
    }
    if (Number(st.idx ?? 0) === 0) {
      window.history.replaceState(
        { ...st, __clnExitBase: true, __clnExitGuard: false },
        '',
        window.location.href
      );
      window.history.pushState(
        { ...st, __clnExitBase: false, __clnExitGuard: true },
        '',
        window.location.href
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (exitingRef.current) return;
      const st = ((event.state || window.history.state || {}) as ExitGuardHistoryState);
      if (st.__clnExitBase === true) {
        setShowModal(true);
      } else {
        setShowModal(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleStay = useCallback(() => {
    setShowModal(false);
    const st = ((window.history.state as ExitGuardHistoryState | null) || {});
    if (st.__clnExitBase === true) {
      window.history.pushState(
        { ...st, __clnExitBase: false, __clnExitGuard: true },
        '',
        window.location.href
      );
    }
  }, []);

  const handleGoHome = useCallback(() => {
    setShowModal(false);
    navigate('/');
  }, [navigate]);

  const handleConfirmExit = useCallback(() => {
    exitingRef.current = true;
    setShowModal(false);
    window.history.back();
  }, []);

  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleStay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, handleStay]);

  if (!showModal) return null;

  const isNotHome = location.pathname !== '/';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-exit-guard-title"
      aria-describedby="mobile-exit-guard-desc"
      onClick={handleStay}
      className="fixed inset-0 z-[9998] bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs sm:max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 space-y-4 text-center"
      >
        <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h2 id="mobile-exit-guard-title" className="text-base font-extrabold text-slate-900">
            Bạn có muốn thoát ứng dụng?
          </h2>
          <p id="mobile-exit-guard-desc" className="text-xs text-slate-600 leading-relaxed">
            Vuốt hoặc bấm Quay lại một lần nữa sẽ rời khỏi Lông Ca Club.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handleStay}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-sm font-bold shadow-xs transition cursor-pointer"
          >
            Ở lại ứng dụng
          </button>

          {isNotHome && (
            <button
              type="button"
              onClick={handleGoHome}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-800 text-sm font-semibold transition cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>Về Trang chủ</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirmExit}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 active:scale-[0.99] text-rose-700 text-sm font-semibold transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Thoát</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
