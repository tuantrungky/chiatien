import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  getWriteActivitySnapshot,
  subscribeWriteActivity,
} from '../utils/writeTracker';

export function GlobalSavingOverlay() {
  const snapshot = useSyncExternalStore(
    subscribeWriteActivity,
    getWriteActivitySnapshot,
    getWriteActivitySnapshot
  );
  const isBusy = snapshot.activeCount > 0;
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isBusy) {
      setElapsedSec(0);
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isBusy]);

  if (!isBusy) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="global-saving-title"
      aria-describedby="global-saving-desc"
      className="fixed inset-0 z-[9999] bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4 select-none"
    >
      <div className="w-full max-w-xs sm:max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 text-center space-y-4">
        <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
          <img
            src="/logo.jpg"
            alt="Lông Ca Club"
            className="w-14 h-14 rounded-full object-cover ring-2 ring-emerald-200"
          />
          <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#113b66] text-white flex items-center justify-center shadow-md ring-2 ring-white">
            <Loader2 className="w-4 h-4 animate-spin" />
          </span>
        </div>

        <div className="space-y-1.5">
          <p id="global-saving-title" className="text-sm sm:text-base font-extrabold text-slate-900">
            {snapshot.message || 'Đang lưu dữ liệu lên Google Sheet...'}
          </p>
          <p id="global-saving-desc" className="text-xs text-slate-600 leading-relaxed">
            Vui lòng đợi giây lát, <strong>không bấm thêm</strong> hay thoát trang để tránh trùng dữ liệu Google Sheet.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>
            {elapsedSec >= 6
              ? `Google Sheet đang xử lý (${elapsedSec}s)...`
              : elapsedSec > 0
              ? `Đang đồng bộ (${elapsedSec}s)...`
              : 'Đang khóa thao tác tạm thời...'}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
