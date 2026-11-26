import { useMemo, useState } from 'react';
import {
  Ban,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { generateSchedule, updateScheduleDay } from '../services/api';
import type {
  Member,
  ScheduleData,
  ScheduleDay,
  ScheduleStatus,
  Session,
  SettingsMap,
} from '../types';
import { formatDateVN, getNowVN, getWeekdayIndex } from '../utils/dateFilters';
import { getEffectiveScheduleStatus } from '../utils/schedule';
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
  onEditSession?: (session: Session) => void;
  onCreateAdhocBadmintonOnDate: (date: string) => void;
  onCreateDrinkingOnDate: (date: string) => void;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const WEEKDAY_VN_NAMES = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
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
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const mm = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${mm < 10 ? '0' + mm : mm}`;
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
  onEditSession,
  onCreateAdhocBadmintonOnDate,
  onCreateDrinkingOnDate,
}: CalendarPageProps) {
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();

  const nowVN = getNowVN();
  const todayStr = nowVN.date;

  const [selectedDate, setSelectedDate] = useState<string>(() => todayStr);
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ScheduleDay | null>(null);
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
  const [onlyFromToday, setOnlyFromToday] = useState(false);

  // Form Thêm / Sửa 1 ngày lẻ
  const [singleStart, setSingleStart] = useState('20:00');
  const [singleEnd, setSingleEnd] = useState('21:30');
  const [singleCourts, setSingleCourts] = useState(String(settings.default_court_count || 2));
  const [singlePlannedIds, setSinglePlannedIds] = useState<string[]>(() =>
    mainMembers.map((m) => m.member_id)
  );
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

  // Xây lưới ngày trong tháng (bắt đầu từ Thứ 2, dùng Date.UTC độc lập múi giờ)
  const calendarCells = useMemo(() => {
    const [year, month] = activeMonth.split('-').map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const jsDay = firstDay.getUTCDay(); // 0=CN..6=T7
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

  // Thống kê tóm tắt tháng đang xem
  const monthSummary = useMemo(() => {
    let done = 0;
    let unlogged = 0;
    let upcoming = 0;
    let cancelled = 0;

    for (const plan of schedule?.days || []) {
      if (plan.date.slice(0, 7) !== activeMonth) continue;
      const eff = getEffectiveScheduleStatus(plan, sessionsByDate.get(plan.date) || [], nowVN).status;
      if (eff === 'DONE') done++;
      else if (eff === 'PAST_UNLOGGED') unlogged++;
      else if (eff === 'CANCELLED') cancelled++;
      else upcoming++;
    }

    const monthSessions = sessions.filter((s) => s.date.slice(0, 7) === activeMonth);
    const adhocCount = monthSessions.filter(
      (s) => s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC'
    ).length;
    const drinkingCount = monthSessions.filter((s) => s.type === 'DRINKING').length;

    return { done, unlogged, upcoming, cancelled, adhocCount, drinkingCount };
  }, [schedule, sessions, sessionsByDate, activeMonth, nowVN]);

  const selectedPlan = scheduleByDate.get(selectedDate) || null;
  const selectedDaySessions = sessionsByDate.get(selectedDate) || [];
  const selectedPlanStatus = selectedPlan
    ? getEffectiveScheduleStatus(selectedPlan, selectedDaySessions, nowVN)
    : null;
  const hasSelectedFixedSession = selectedDaySessions.some(
    (s) => s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC'
  );

  const handleMonthStep = (delta: number) => {
    const nextMonth = shiftMonthStr(activeMonth, delta);
    onChangeMonth(nextMonth);
    setSelectedDate(nextMonth === todayStr.slice(0, 7) ? todayStr : `${nextMonth}-01`);
  };

  const handleGoToday = () => {
    const curMonth = todayStr.slice(0, 7);
    if (activeMonth !== curMonth) onChangeMonth(curMonth);
    setSelectedDate(todayStr);
  };

  const handleOpenGenModal = () => {
    setPlannedIds(mainMembers.map((m) => m.member_id));
    setCourts(String(settings.default_court_count || 2));
    setOnlyFromToday(activeMonth === todayStr.slice(0, 7));
    setGenModalOpen(true);
  };

  const handleOpenAddSingleModal = () => {
    setEditingPlan(null);
    setSingleStart('20:00');
    setSingleEnd('21:30');
    setSingleCourts(String(settings.default_court_count || 2));
    setSinglePlannedIds(mainMembers.map((m) => m.member_id));
    setSingleNote('');
    setDayModalOpen(true);
  };

  const handleOpenEditSingleModal = (plan: ScheduleDay) => {
    setEditingPlan(plan);
    setSingleStart(plan.start_time || '20:00');
    setSingleEnd(plan.end_time || '21:30');
    setSingleCourts(String(plan.courts || settings.default_court_count || 2));
    const parsedIds = plan.planned_member_ids
      ? plan.planned_member_ids
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : mainMembers.map((m) => m.member_id);
    setSinglePlannedIds(parsedIds);
    setSingleNote(plan.note || '');
    setDayModalOpen(true);
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
        fromDate: onlyFromToday ? todayStr : undefined,
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

  const handleSaveSingleDay = async (e: React.FormEvent) => {
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
      setDayModalOpen(false);
      setEditingPlan(null);
      setSingleNote('');
      await onRefreshAll();
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

  const handleUpdatePlanStatus = async (plan: ScheduleDay, nextStatus: ScheduleStatus) => {
    if (!idToken || busy) return;
    setBusy(true);
    try {
      await updateScheduleDay(idToken, {
        operation: 'UPSERT',
        planId: plan.plan_id,
        date: plan.date,
        status: nextStatus,
      });
      await onRefreshAll();
      const label =
        nextStatus === 'DONE'
          ? 'Đã đánh dấu đã diễn ra'
          : nextStatus === 'CANCELLED'
          ? 'Đã báo nghỉ / hủy buổi'
          : 'Đã khôi phục lịch';
      toast.success(`${label} (${formatDateVN(plan.date)}).`);
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
      {/* Header chọn tháng & nút Hôm nay / Tạo lịch */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-2 shadow-xs flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => handleMonthStep(-1)}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
            aria-label="Tháng trước"
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
            onClick={() => handleMonthStep(1)}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
            aria-label="Tháng sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleGoToday}
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
            title={`Hôm nay (${formatDateVN(todayStr)}, giờ VN)`}
          >
            Hôm nay
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

      {/* Thanh tóm tắt trạng thái tháng (theo giờ VN) */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
          Đã diễn ra: {monthSummary.done}
        </span>
        {monthSummary.unlogged > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-semibold">
            Chưa ghi buổi: {monthSummary.unlogged}
          </span>
        )}
        <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-semibold">
          Sắp tới: {monthSummary.upcoming}
        </span>
        {monthSummary.cancelled > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
            Nghỉ/Hủy: {monthSummary.cancelled}
          </span>
        )}
        {monthSummary.adhocCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 font-semibold">
            Phát sinh: {monthSummary.adhocCount}
          </span>
        )}
        {monthSummary.drinkingCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold">
            Ăn nhậu: {monthSummary.drinkingCount}
          </span>
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
            const planEff = plan ? getEffectiveScheduleStatus(plan, daySessions, nowVN) : null;
            const hasFixedBadminton = daySessions.some(
              (s) => s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC'
            );
            const hasAdhocBadminton = daySessions.some(
              (s) => s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC'
            );
            const hasDrinking = daySessions.some((s) => s.type === 'DRINKING');
            const isSelected = selectedDate === cell.dateStr;
            const isToday = todayStr === cell.dateStr;
            const isCancelled = planEff?.status === 'CANCELLED';

            return (
              <button
                key={cell.dateStr}
                type="button"
                onClick={() => setSelectedDate(cell.dateStr!)}
                className={`h-14 sm:h-16 rounded-xl border flex flex-col items-center justify-between p-1.5 transition cursor-pointer ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500'
                    : isToday
                    ? 'border-blue-400 bg-blue-50/50'
                    : planEff?.status === 'PAST_UNLOGGED'
                    ? 'border-amber-200 bg-amber-50/35 hover:bg-amber-50/60'
                    : 'border-slate-100 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`text-xs font-bold ${
                    isCancelled
                      ? 'line-through text-slate-400'
                      : isSelected
                      ? 'text-emerald-800'
                      : isToday
                      ? 'text-blue-700'
                      : 'text-slate-700'
                  }`}
                >
                  {cell.dayNum}
                </span>

                <div className="flex items-center gap-1">
                  {planEff && (
                    <span
                      className={`w-2 h-2 rounded-full ${planEff.dotClass}`}
                      title={planEff.label}
                    />
                  )}
                  {!planEff && hasFixedBadminton && (
                    <span className="w-2 h-2 rounded-full bg-emerald-600" title="Đã đánh cố định" />
                  )}
                  {hasAdhocBadminton && (
                    <span className="w-2 h-2 rounded-full bg-cyan-500" title="Buổi cầu phát sinh" />
                  )}
                  {hasDrinking && (
                    <span className="w-2 h-2 rounded-full bg-orange-500" title="Có buổi ăn nhậu" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Chú thích */}
        <div className="flex items-center justify-center gap-3 pt-3 mt-2 border-t border-slate-100 text-[11px] text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Sắp diễn ra
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600" /> Đang diễn ra
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Đã diễn ra
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Qua ngày chưa ghi
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Nghỉ/Hủy
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> Phát sinh
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Ăn nhậu
          </span>
        </div>
      </section>

      {/* Chi tiết ngày đang chọn */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {WEEKDAY_VN_NAMES[getWeekdayIndex(selectedDate)]}, ngày {formatDateVN(selectedDate)}
              {selectedDate === todayStr && (
                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  Hôm nay
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              {selectedPlan
                ? `Lịch cố định: ${selectedPlan.start_time} – ${selectedPlan.end_time} (${selectedPlan.courts} sân)`
                : 'Chưa có lịch cầu lông cố định ngày này'}
            </p>
          </div>

          {isEditor && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => onCreateAdhocBadmintonOnDate(selectedDate)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buổi cầu phát sinh</span>
              </button>
              {!selectedPlan && (
                <button
                  type="button"
                  onClick={handleOpenAddSingleModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Lịch cố định</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onCreateDrinkingOnDate(selectedDate)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold cursor-pointer"
              >
                <Utensils className="w-3.5 h-3.5" />
                <span>+ Buổi nhậu</span>
              </button>
            </div>
          )}
        </div>

        {/* Thẻ Lịch cầu lông của ngày */}
        {selectedPlan && selectedPlanStatus && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-emerald-600" />
                <span
                  className={`text-xs font-bold ${
                    selectedPlanStatus.status === 'CANCELLED'
                      ? 'line-through text-slate-400'
                      : 'text-slate-900'
                  }`}
                >
                  {selectedPlan.start_time} – {selectedPlan.end_time} • {selectedPlan.courts} sân
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selectedPlanStatus.badgeClass}`}
              >
                {selectedPlanStatus.label}
              </span>
            </div>

            {selectedPlan.note && (
              <p className="text-[11px] text-slate-600 italic">Ghi chú: {selectedPlan.note}</p>
            )}

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
              <div className="space-y-2 pt-1">
                {(selectedPlanStatus.status === 'UPCOMING' ||
                  selectedPlanStatus.status === 'ONGOING' ||
                  selectedPlanStatus.status === 'PAST_UNLOGGED') && (
                  <>
                    <button
                      type="button"
                      onClick={() => onCheckInPlan(selectedPlan)}
                      className={`w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-white text-xs font-bold shadow-xs cursor-pointer ${
                        selectedPlanStatus.status === 'PAST_UNLOGGED'
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {selectedPlanStatus.status === 'PAST_UNLOGGED'
                          ? 'Ghi bù buổi này (Điểm danh & Vãng lai)'
                          : 'Điểm danh & Ghi buổi'}
                      </span>
                    </button>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSingleModal(selectedPlan)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Sửa lịch</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdatePlanStatus(selectedPlan, 'DONE')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Đánh dấu đã đánh</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdatePlanStatus(selectedPlan, 'CANCELLED')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Nghỉ / Hủy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePlan(selectedPlan)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-semibold cursor-pointer ml-auto"
                        title="Xóa lịch ngày này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </>
                )}

                {selectedPlanStatus.status === 'CANCELLED' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleUpdatePlanStatus(selectedPlan, 'PLANNED')}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Khôi phục lịch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePlan(selectedPlan)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa</span>
                    </button>
                  </div>
                )}

                {selectedPlanStatus.status === 'DONE' && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-emerald-700">
                      {hasSelectedFixedSession
                        ? 'Đã ghi nhận điểm danh buổi cố định.'
                        : 'Đã đánh dấu hoàn thành buổi theo lịch.'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSingleModal(selectedPlan)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      {!hasSelectedFixedSession && (
                        <>
                          <button
                            type="button"
                            onClick={() => onCheckInPlan(selectedPlan)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Điểm danh bù</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdatePlanStatus(selectedPlan, 'PLANNED')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Mở lại</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Các buổi thực tế đã diễn ra trong ngày */}
        {selectedDaySessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">Hoạt động thực tế</p>
            {selectedDaySessions.map((s) => {
              const isFixedBadminton = s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC';
              return (
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-slate-900 truncate">{s.title}</p>
                        {s.type === 'BADMINTON' && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                              s.billing_mode === 'AD_HOC'
                                ? 'bg-cyan-100 text-cyan-800'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {s.billing_mode === 'AD_HOC' ? 'Phát sinh' : 'Theo lịch'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">{s.attendee_count} người tham gia</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-slate-900">
                      {isFixedBadminton
                        ? s.total_amount > 0
                          ? `Thêm giờ: ${formatVND(s.total_amount)}`
                          : 'Theo lịch (0đ)'
                        : formatVND(s.total_amount)}
                    </span>
                    {isEditor && onEditSession && (
                      <button
                        type="button"
                        onClick={() => onEditSession(s)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                        title="Chỉnh sửa buổi này"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
      )}

      {/* Modal Thêm / Sửa 1 ngày lịch lẻ */}
      {dayModalOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => {
            setDayModalOpen(false);
            setEditingPlan(null);
          }}
        >
          <form
            onSubmit={handleSaveSingleDay}
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
                onClick={() => {
                  setDayModalOpen(false);
                  setEditingPlan(null);
                }}
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
      )}
    </div>
  );
}
