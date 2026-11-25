import { Clock3, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { GoogleSignInButtonBox } from './EditorLoginButton';

export function ReauthModal() {
  const { reauthRequired, logout } = useAuth();

  if (!reauthRequired) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Clock3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Phiên đăng nhập đã hết hạn</h3>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Token Google có hiệu lực 1 giờ. Dữ liệu bạn đang nhập vẫn được giữ nguyên — hãy đăng nhập lại 1 chạm rồi bấm Lưu tiếp.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
            title="Chuyển về chế độ Viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <GoogleSignInButtonBox />

        <button
          type="button"
          onClick={logout}
          className="w-full py-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
        >
          Hủy &amp; về chế độ Viewer
        </button>
      </div>
    </div>
  );
}
