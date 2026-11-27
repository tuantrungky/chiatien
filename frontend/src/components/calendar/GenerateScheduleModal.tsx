import { useState } from 'react';
import { Clock, Loader2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { generateSchedule } from '../../services/api';
import type { Member } from '../../types';
import { formatDateVN } from '../../utils/dateFilters';

const WEEKDAY_OPTIONS = [
  { val: 1, label: 'T2' },
  { val: 2, label: 'T3' },
  { val: 3, label: 'T4' },
  { val: 4, label: 'T5' },
  { val: 5, label: 'T6' },
  { val: 6, label: 'T7' },
  { val: 0, label: 'CN' },
];

export interface GenerateScheduleModalProps {
  activeMonth: string;
  todayStr: string;
  mainMembers: Member[];
  defaultCourts: number;
  onClose: () => void;
  onSuccess: () => Promise<boolean | void>;
}

/** Modal tạo lịch đánh cầu cố định hàng tháng theo thứ trong tuần. */
export function GenerateScheduleModal({
  activeMonth,
  todayStr,
  mainMembers,
  defaultCourts,
  onClose,
  onSuccess,
}: GenerateScheduleModalProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();

  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [startTime, setStartTime] = useState('20:00');
  const [endTime, setEndTime] = useState('21:30');
  const [courts, setCourts] = useState(String(defaultCourts || 2));
  const [plannedIds, setPlannedIds] = useState<string[]>(() =>
    mainMembers.map((m) => m.member_id)
  );
  const [onlyFromToday, setOnlyFromToday] = useState(() => activeMonth === todayStr.slice(0, 7));
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    if (weekdays.length === 0) {
      toast.error('Hãy chọn ít nhất 1 thứ trong tuần.');
      return;
    }

    setBusy(true);
    try {
      await generateSchedule(idToken, {
        month: activeMonth,
        weekdays,
        startTime,
        endTime,
        courts: Math.max(1, Number(courts) || 2),
        plannedMemberIds: plannedIds,
        fromDate: onlyFromToday ? todayStr : undefined,
      });
      onClose();
      await onSuccess();
      toast.success(
        `Đã tạo lịch cố định cho tháng ${activeMonth.slice(5, 7)}/${activeMonth.slice(0, 4)}.`
      );
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Tạo lịch cố định Tháng {activeMonth.slice(5, 7)}/{activeMonth.slice(0, 4)}
            </h3>
            <p className="text-xs text-slate-500">Sinh tự động các buổi theo thứ trong tuần</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Chọn ngày đánh trong tuần
          </label>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_OPTIONS.map((opt) => {
              const active = weekdays.includes(opt.val);
              return (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() =>
                    setWeekdays((prev) =>
                      prev.includes(opt.val)
                        ? prev.filter((x) => x !== opt.val)
                        : [...prev, opt.val]
                    )
                  }
                  className={`py-2 rounded-xl text-xs font-bold cursor-pointer ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              <Clock className="w-3 h-3 inline mr-1" />
              Bắt đầu
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Kết thúc</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Số sân</label>
            <input
              type="number"
              min={1}
              value={courts}
              onChange={(e) => setCourts(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFromToday}
            onChange={(e) => setOnlyFromToday(e.target.checked)}
            className="accent-emerald-600"
          />
          <span>Chỉ tạo từ hôm nay ({formatDateVN(todayStr)}) trở đi</span>
        </label>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Thành viên chính dự kiến ({plannedIds.length}/{mainMembers.length})
          </label>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
            {mainMembers.map((m) => {
              const checked = plannedIds.includes(m.member_id);
              return (
                <label
                  key={m.member_id}
                  className="flex items-center gap-2 text-xs font-semibold bg-slate-50 px-2.5 py-1.5 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setPlannedIds((prev) =>
                        prev.includes(m.member_id)
                          ? prev.filter((id) => id !== m.member_id)
                          : [...prev, m.member_id]
                      )
                    }
                    className="accent-emerald-600"
                  />
                  <span className="truncate">{m.name}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{busy ? 'Đang sinh lịch...' : 'Sinh lịch tháng này'}</span>
        </button>
      </form>
    </div>
  );
}
