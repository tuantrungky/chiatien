import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { updateScheduleDay } from '../../services/api';
import type { Member, ScheduleDay } from '../../types';
import { formatDateVN } from '../../utils/dateFilters';

export interface ScheduleDayModalProps {
  selectedDate: string;
  editingPlan: ScheduleDay | null;
  mainMembers: Member[];
  defaultCourts: number;
  onClose: () => void;
  onSuccess: () => Promise<boolean | void>;
}

/** Modal thêm hoặc chỉnh sửa 1 ngày lịch cầu lông lẻ. */
export function ScheduleDayModal({
  selectedDate,
  editingPlan,
  mainMembers,
  defaultCourts,
  onClose,
  onSuccess,
}: ScheduleDayModalProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();

  const [singleStart, setSingleStart] = useState(() => editingPlan?.start_time || '20:00');
  const [singleEnd, setSingleEnd] = useState(() => editingPlan?.end_time || '21:30');
  const [singleCourts, setSingleCourts] = useState(() =>
    String(editingPlan?.courts || defaultCourts || 2)
  );
  const [singlePlannedIds, setSinglePlannedIds] = useState<string[]>(() => {
    if (editingPlan?.planned_member_ids) {
      return editingPlan.planned_member_ids
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return mainMembers.map((m) => m.member_id);
  });
  const [singleNote, setSingleNote] = useState(() => editingPlan?.note || '');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    setBusy(true);
    try {
      await updateScheduleDay(idToken, {
        operation: 'UPSERT',
        planId: editingPlan?.plan_id,
        date: editingPlan?.date || selectedDate,
        startTime: singleStart,
        endTime: singleEnd,
        courts: Math.max(1, Number(singleCourts) || 2),
        plannedMemberIds: singlePlannedIds,
        status: editingPlan?.status || 'PLANNED',
        note: singleNote,
      });
      onClose();
      await onSuccess();
      toast.success(
        editingPlan
          ? `Đã cập nhật lịch ngày ${formatDateVN(editingPlan.date)}.`
          : `Đã thêm lịch ngày ${formatDateVN(selectedDate)}.`
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
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            {editingPlan
              ? `Sửa lịch ngày ${formatDateVN(editingPlan.date)}`
              : `Thêm lịch ngày ${formatDateVN(selectedDate)}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Bắt đầu
            </label>
            <input
              type="time"
              value={singleStart}
              onChange={(e) => setSingleStart(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Kết thúc
            </label>
            <input
              type="time"
              value={singleEnd}
              onChange={(e) => setSingleEnd(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Số sân
            </label>
            <input
              type="number"
              min={1}
              value={singleCourts}
              onChange={(e) => setSingleCourts(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Thành viên chính dự kiến ({singlePlannedIds.length}/{mainMembers.length})
          </label>
          <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
            {mainMembers.map((m) => {
              const checked = singlePlannedIds.includes(m.member_id);
              return (
                <label
                  key={m.member_id}
                  className="flex items-center gap-2 text-xs font-semibold bg-slate-50 px-2.5 py-1.5 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSinglePlannedIds((prev) =>
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

        <input
          type="text"
          value={singleNote}
          onChange={(e) => setSingleNote(e.target.value)}
          placeholder="Ghi chú (tùy chọn)"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{busy ? 'Đang lưu...' : 'Lưu vào lịch'}</span>
        </button>
      </form>
    </div>
  );
}
