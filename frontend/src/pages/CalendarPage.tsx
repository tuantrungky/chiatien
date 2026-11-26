import { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Trash2,
  Trophy,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { generateSchedule, updateScheduleDay } from '../services/api';
import type { Member, ScheduleData, ScheduleDay, Session, SettingsMap } from '../types';
import { formatDateVN, getTodayDateStr } from '../utils/dateFilters';
import { formatVND } from '../utils/vietqr';

interface CalendarPageProps {
  activeMonth: string;
  onChangeMonth: (month: string) => void;
  schedule: ScheduleData | null;
  sessions: Session[];
  members: Member[];
  settings: SettingsMap;
  onRefreshAll: () => Promise<boolean>;
  onCheckInPlan: (plan: ScheduleDay) => void;
  onCreateDrinkingOnDate: (date: string) => void;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const WEEKDAY_OPTIONS = [
  { val: 1, label: 'T2' },
  { val: 2, label: 'T3' },
  { val: 3, label: 'T4' },
  { val: 4, label: 'T5' },
  { val: 5, label: 'T6' },
  { val: 6, label: 'T7' },
  { val: 0, label: 'CN' },
];

function shiftMonthStr(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const mm = d.getMonth() + 1;
  return `${d.getFullYear()}-${mm < 10 ? '0' + mm : mm}`;
}

export function CalendarPage({
  activeMonth,
  onChangeMonth,
  schedule,
  sessions,
  members,
  settings,
  onRefreshAll,
  onCheckInPlan,
  onCreateDrinkingOnDate,
}: CalendarPageProps) {
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();

  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateStr());
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [addDayModalOpen, setAddDayModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Form Tạo lịch tháng tự động
  const mainMembers = useMemo(
    () => members.filter((m) => m.is_active && m.type === 'MAIN'),
    [members]
  );
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]); // T2, T4, T6
  const [startTime, setStartTime] = useState('20:00');
  const [endTime, setEndTime] = useState('21:30');
  const [courts, setCourts] = useState(String(settings.default_court_count || 2));
  const [plannedIds, setPlannedIds] = useState<string[]>(() =>
    mainMembers.map((m) => m.member_id)
  );

  // Form thêm 1 ngày lẻ
  const [singleStart, setSingleStart] = useState('20:00');
  const [singleEnd, setSingleEnd] = useState('21:30');
  const [singleCourts, setSingleCourts] = useState(String(settings.default_court_count || 2));
  const [singleNote, setSingleNote] = useState('');

  const membersMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.member_id, m);
    return map;
  }, [members]);

  const scheduleByDate = useMemo(() => {
    const map = new Map<string, ScheduleDay>();
    for (const d of schedule?.days || []) {
      map.set(d.date, d);
    }
    return map;
  }, [schedule]);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [sessions]);

  // Xây lưới ngày trong tháng (bắt đầu từ Thứ 2)
  const calendarCells = useMemo(() => {
    const [year, month] = activeMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const jsDay = firstDay.getDay(); // 0=CN..6=T7
    const leadingBlanks = jsDay === 0 ? 6 : jsDay - 1;

    const cells: Array<{ dateStr: string | null; dayNum: number | null }> = [];
    for (let i = 0; i < leadingBlanks; i++) {
      cells.push({ dateStr: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = month < 10 ? `0${month}` : String(month);
      const dd = d < 10 ? `0${d}` : String(d);
      cells.push({ dateStr: `${year}-${mm}-${dd}`, dayNum: d });
    }
    return cells;
  }, [activeMonth]);

  const selectedPlan = scheduleByDate.get(selectedDate) || null;
  const selectedDaySessions = sessionsByDate.get(selectedDate) || [];
  const todayStr = getTodayDateStr();

  const handleOpenGenModal = () => {
    setPlannedIds(mainMembers.map((m) => m.member_id));
    setCourts(String(settings.default_court_count || 2));
    setGenModalOpen(true);
  };

  const handleGenerateSchedule = async (e: React.FormEvent) => {
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
      });
      setGenModalOpen(false);
      await onRefreshAll();
      toast.success(`Đã tạo lịch cố định cho tháng ${activeMonth.slice(5, 7)}/${activeMonth.slice(0, 4)}.`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddSingleDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    setBusy(true);
    try {
      await updateScheduleDay(idToken, {
        operation: 'UPSERT',
        date: selectedDate,
        startTime: singleStart,
        endTime: singleEnd,
        courts: Math.max(1, Number(singleCourts) || 2),
        plannedMemberIds: mainMembers.map((m) => m.member_id),
        status: 'PLANNED',
        note: singleNote,
      });
      setAddDayModalOpen(false);
      setSingleNote('');
      await onRefreshAll();
      toast.success(`Đã thêm lịch ngày ${formatDateVN(selectedDate)}.`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePlan = async (plan: ScheduleDay) => {
    if (!idToken || busy) return;
    if (!window.confirm(`Xóa lịch ngày ${formatDateVN(plan.date)}?`)) return;
    setBusy(true);
    try {
      await updateScheduleDay(idToken, {
        operation: 'DELETE',
        planId: plan.plan_id,
        date: plan.date,
      });
      await onRefreshAll();
      toast.success('Đã xóa ngày khỏi lịch.');
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header chọn tháng & nút Tạo lịch */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-2 shadow-xs flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangeMonth(shiftMonthStr(activeMonth, -1))}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 px-1">
            <CalendarIcon className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">
              Tháng {activeMonth.slice(5, 7)}/{activeMonth.slice(0, 4)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChangeMonth(shiftMonthStr(activeMonth, 1))}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {isEditor && (
          <button
            type="button"
            onClick={handleOpenGenModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo lịch tháng</span>
          </button>
        )}
      </div>

      {/* Lưới Calendar */}
      <section className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs">
        <div className="grid grid-cols-7 gap-1 mb-1.5 text-center">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-[11px] font-bold text-slate-400 py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((cell, idx) => {
            if (!cell.dateStr || !cell.dayNum) {
              return <div key={`blank-${idx}`} className="h-14 sm:h-16" />;
            }
            const plan = scheduleByDate.get(cell.dateStr);
            const daySessions = sessionsByDate.get(cell.dateStr) || [];
            const hasDrinking = daySessions.some((s) => s.type === 'DRINKING');
            const hasBadmintonSession = daySessions.some((s) => s.type === 'BADMINTON');
            const isSelected = selectedDate === cell.dateStr;
            const isToday = todayStr === cell.dateStr;

            return (
              <button
                key={cell.dateStr}
                type="button"
                onClick={() => setSelectedDate(cell.dateStr!)}
                className={`h-14 sm:h-16 rounded-xl border flex flex-col items-center justify-between p-1.5 transition cursor-pointer ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500'
                    : isToday
                    ? 'border-blue-300 bg-blue-50/40'
                    : 'border-slate-100 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`text-xs font-bold ${
                    isSelected ? 'text-emerald-800' : isToday ? 'text-blue-700' : 'text-slate-700'
                  }`}
                >
                  {cell.dayNum}
                </span>

                <div className="flex items-center gap-1">
                  {plan && plan.status !== 'CANCELLED' && (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        plan.status === 'DONE' || hasBadmintonSession
                          ? 'bg-emerald-600'
                          : 'bg-sky-500'
                      }`}
                      title={plan.status === 'DONE' ? 'Đã đánh xong' : 'Lịch đánh cầu'}
                    />
                  )}
                  {!plan && hasBadmintonSession && (
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  )}
                  {hasDrinking && <span className="w-2 h-2 rounded-full bg-orange-500" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Chú thích */}
        <div className="flex items-center justify-center gap-4 pt-3 mt-2 border-t border-slate-100 text-[11px] text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Lịch dự kiến
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Đã điểm danh cầu
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Có buổi ăn nhậu
          </span>
        </div>
      </section>

      {/* Chi tiết ngày đang chọn */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Ngày {formatDateVN(selectedDate)}
            </h3>
            <p className="text-xs text-slate-500">
              {selectedPlan
                ? `Lịch đánh: ${selectedPlan.start_time} – ${selectedPlan.end_time} (${selectedPlan.courts} sân)`
                : 'Chưa có lịch cầu lông cố định ngày này'}
            </p>
          </div>

          {isEditor && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {!selectedPlan && (
                <button
                  type="button"
                  onClick={() => setAddDayModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm lịch cầu</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onCreateDrinkingOnDate(selectedDate)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-bold cursor-pointer"
              >
                <Utensils className="w-3.5 h-3.5" />
                <span>+ Buổi nhậu</span>
              </button>
            </div>
          )}
        </div>

        {/* Thẻ Lịch cầu lông của ngày */}
        {selectedPlan && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-900">
                  {selectedPlan.start_time} – {selectedPlan.end_time} • {selectedPlan.courts} sân
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedPlan.status === 'DONE'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-sky-100 text-sky-700'
                }`}
              >
                {selectedPlan.status === 'DONE' ? 'Đã điểm danh' : 'Sắp diễn ra'}
              </span>
            </div>

            {selectedPlan.planned_member_ids && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {selectedPlan.planned_member_ids
                  .split(',')
                  .map((id) => id.trim())
                  .filter(Boolean)
                  .map((id) => (
                    <span
                      key={id}
                      className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-medium"
                    >
                      {membersMap.get(id)?.name || id}
                    </span>
                  ))}
              </div>
            )}

            {isEditor && (
              <div className="flex items-center justify-between gap-2 pt-1">
                {selectedPlan.status !== 'DONE' ? (
                  <button
                    type="button"
                    onClick={() => onCheckInPlan(selectedPlan)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Điểm danh &amp; Ghi buổi hôm nay</span>
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-emerald-700">
                    Đã ghi nhận buổi chơi cho ngày này
                  </span>
                )}

                {selectedPlan.status !== 'DONE' && (
                  <button
                    type="button"
                    onClick={() => void handleDeletePlan(selectedPlan)}
                    disabled={busy}
                    className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                    title="Xóa lịch ngày này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Các buổi thực tế đã diễn ra trong ngày */}
        {selectedDaySessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">Hoạt động thực tế</p>
            {selectedDaySessions.map((s) => (
              <div
                key={s.session_id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {s.type === 'BADMINTON' ? (
                    <Trophy className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Utensils className="w-4 h-4 text-orange-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{s.title}</p>
                    <p className="text-[11px] text-slate-500">{s.attendee_count} người tham gia</p>
                  </div>
                </div>
                <span className="font-bold text-slate-900 shrink-0">
                  {formatVND(s.total_amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal Tạo lịch tháng cố định (Editor) */}
      {genModalOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setGenModalOpen(false)}
        >
          <form
            onSubmit={handleGenerateSchedule}
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
                onClick={() => setGenModalOpen(false)}
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
      )}

      {/* Modal thêm 1 ngày lẻ */}
      {addDayModalOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setAddDayModalOpen(false)}
        >
          <form
            onSubmit={handleAddSingleDay}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Thêm lịch ngày {formatDateVN(selectedDate)}
              </h3>
              <button
                type="button"
                onClick={() => setAddDayModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                value={singleStart}
                onChange={(e) => setSingleStart(e.target.value)}
                className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
              />
              <input
                type="time"
                value={singleEnd}
                onChange={(e) => setSingleEnd(e.target.value)}
                className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
              />
              <input
                type="number"
                min={1}
                value={singleCourts}
                onChange={(e) => setSingleCourts(e.target.value)}
                className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
              />
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
              className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {busy ? 'Đang lưu...' : 'Lưu vào lịch'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
