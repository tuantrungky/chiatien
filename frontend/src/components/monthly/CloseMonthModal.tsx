import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { closeMonth } from '../../services/api';
import { formatVND } from '../../utils/vietqr';

export interface CloseMonthModalProps {
  activeMonth: string;
  defaultCarryOut: number;
  onClose: () => void;
  onSuccess: () => Promise<boolean | void>;
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  return `Tháng ${m}/${y}`;
}

/** Modal chốt số dư cuối tháng và chuyển dư/thiếu sang tháng kế tiếp. */
export function CloseMonthModal({
  activeMonth,
  defaultCarryOut,
  onClose,
  onSuccess,
}: CloseMonthModalProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();

  const [carryOutStr, setCarryOutStr] = useState(() => String(defaultCarryOut ?? 0));
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    const rawTrim = carryOutStr.trim();
    const parsedCarryOut =
      rawTrim === '' || rawTrim === '-' ? 0 : Math.round(Number(rawTrim) || 0);
    setBusy(true);
    try {
      await closeMonth(idToken, {
        month: activeMonth,
        carryOutOverride: parsedCarryOut,
      });
      onClose();
      await onSuccess();
      const summaryText =
        parsedCarryOut > 0
          ? `Dư +${formatVND(parsedCarryOut)}`
          : parsedCarryOut < 0
          ? `Thiếu -${formatVND(Math.abs(parsedCarryOut))}`
          : 'Hòa 0đ';
      toast.success(
        `Đã chốt ${formatMonthLabel(activeMonth)} (${summaryText} chuyển sang tháng sau)!`
      );
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const rawNum = Number(carryOutStr);
  const previewVal = Number.isFinite(rawNum) ? Math.round(rawNum) : 0;
  const absVal = Math.abs(previewVal);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Chốt ${formatMonthLabel(activeMonth)}`}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3.5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">
            Chốt {formatMonthLabel(activeMonth)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Ưu tiên nhập đúng số tiền thực tế còn dư hoặc thiếu chuyển sang tháng kế tiếp.{' '}
          <strong className="text-slate-800">Số dương (+) là dư</strong>,{' '}
          <strong className="text-rose-700">số âm (−) là thiếu</strong>.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-xs font-semibold text-slate-600">
              Tiền dư (+) / thiếu (−) (VND)
            </label>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setCarryOutStr(String(absVal))}
                className={`px-2 py-0.5 rounded-md cursor-pointer transition ${
                  previewVal >= 0
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Dư (+)
              </button>
              <button
                type="button"
                onClick={() => setCarryOutStr(absVal > 0 ? String(-absVal) : '-')}
                className={`px-2 py-0.5 rounded-md cursor-pointer transition ${
                  previewVal < 0 || carryOutStr.trim().startsWith('-')
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Thiếu (−)
              </button>
            </div>
          </div>
          <input
            type="number"
            step={1000}
            value={carryOutStr}
            onChange={(e) => setCarryOutStr(e.target.value)}
            placeholder="VD: 150000 hoặc -200000"
            className={`w-full rounded-xl border px-3 py-2.5 text-sm font-extrabold ${
              previewVal < 0
                ? 'border-rose-300 bg-rose-50/40 text-rose-700'
                : previewVal > 0
                ? 'border-blue-300 bg-blue-50/40 text-blue-700'
                : 'border-slate-200 text-slate-900'
            }`}
          />
        </div>

        <div
          className={`rounded-xl px-3 py-2 text-xs font-semibold border ${
            previewVal > 0
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : previewVal < 0
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {previewVal > 0
            ? `Dư +${formatVND(previewVal)} → Tháng kế tiếp mỗi người sẽ đóng ít đi`
            : previewVal < 0
            ? `Thiếu -${formatVND(absVal)} → Tháng kế tiếp sẽ cộng bù phần thiếu`
            : 'Hòa 0đ → Không có tiền dư/thiếu chuyển sang tháng sau'}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
        >
          {busy ? 'Đang chốt tháng...' : 'Chốt & Chuyển sang tháng sau'}
        </button>
      </form>
    </div>
  );
}
