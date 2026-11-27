import { useMemo, useState } from 'react';
import {
  Ban,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit3,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { GenerateScheduleModal } from '../components/calendar/GenerateScheduleModal';
import { ScheduleDayModal } from '../components/calendar/ScheduleDayModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { updateScheduleDay } from '../services/api';
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
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showAllPlannedMembers, setShowAllPlannedMembers] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ScheduleDay | null>(null);
  const [busy, setBusy] = useState(false);

  // Danh sách thành viên chính phục vụ modal Tạo lịch / Sửa ngày lẻ
  const mainMembers = useMemo(
    () => members.filter((m) => m.is_active && m.type === 'MAIN'),
    [members]
  );

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
    setShowAllPlannedMembers(false);
  };

  const handleGoToday = () => {
    const curMonth = todayStr.slice(0, 7);
    if (activeMonth !== curMonth) onChangeMonth(curMonth);
    setSelectedDate(todayStr);
    setShowAllPlannedMembers(false);
  };

  const handleSelectDateCell = (dateStr: string) => {
    setSelectedDate(dateStr);
    setShowAllPlannedMembers(false);
    setMobileSheetOpen(true);
  };

  const stepSelectedDate = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + delta));
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(next.getUTCDate()).padStart(2, '0');
    const nextDateStr = `${yy}-${mm}-${dd}`;
    const nextMonthStr = `${yy}-${mm}`;
    if (nextMonthStr !== activeMonth) {
      onChangeMonth(nextMonthStr);
    }
    setSelectedDate(nextDateStr);
    setShowAllPlannedMembers(false);
  };

  const handleOpenGenModal = () => {
    setGenModalOpen(true);
  };

  const handleOpenAddSingleModal = () => {
    setMobileSheetOpen(false);
    setEditingPlan(null);
    setDayModalOpen(true);
  };

  const handleOpenEditSingleModal = (plan: ScheduleDay) => {
    setMobileSheetOpen(false);
    setEditingPlan(plan);
    setDayModalOpen(true);
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

  const plannedMemberIdsList = useMemo(
    () =>
      selectedPlan?.planned_member_ids
        ? selectedPlan.planned_member_ids
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    [selectedPlan]
  );

  const renderDayDetailBody = () => {
    const visibleMemberIds =
      plannedMemberIdsList.length > 6 && !showAllPlannedMembers
        ? plannedMemberIdsList.slice(0, 6)
        : plannedMemberIdsList;
    const hiddenMemberCount = Math.max(0, plannedMemberIdsList.length - 6);

    return (
      <div className="space-y-3">
        {/* Thẻ Lịch cầu lông của ngày */}
        {selectedPlan && selectedPlanStatus ? (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-emerald-600 shrink-0" />
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

            {plannedMemberIdsList.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {visibleMemberIds.map((id) => (
                  <span
                    key={id}
                    className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-medium"
                  >
                    {membersMap.get(id)?.name || id}
                  </span>
                ))}
                {hiddenMemberCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPlannedMembers((v) => !v)}
                    className="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700 font-bold cursor-pointer"
                  >
                    {showAllPlannedMembers ? 'Thu gọn' : `+${hiddenMemberCount} người`}
                  </button>
                )}
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
                      onClick={() => {
                        setMobileSheetOpen(false);
                        onCheckInPlan(selectedPlan);
                      }}
                      className={`w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-white text-xs font-bold shadow-xs cursor-pointer ${
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

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSingleModal(selectedPlan)}
                        disabled={busy}
                        className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Sửa lịch</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdatePlanStatus(selectedPlan, 'DONE')}
                        disabled={busy}
                        className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Đã đánh</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdatePlanStatus(selectedPlan, 'CANCELLED')}
                        disabled={busy}
                        className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Nghỉ / Hủy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePlan(selectedPlan)}
                        disabled={busy}
                        className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold cursor-pointer"
                        title="Xóa lịch ngày này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa lịch</span>
                      </button>
                    </div>
                  </>
                )}

                {selectedPlanStatus.status === 'CANCELLED' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUpdatePlanStatus(selectedPlan, 'PLANNED')}
                      disabled={busy}
                      className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Khôi phục lịch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePlan(selectedPlan)}
                      disabled={busy}
                      className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa lịch</span>
                    </button>
                  </div>
                )}

                {selectedPlanStatus.status === 'DONE' && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-emerald-700">
                      {hasSelectedFixedSession
                        ? 'Đã ghi nhận điểm danh buổi cố định.'
                        : 'Đã đánh dấu hoàn thành buổi theo lịch.'}
                    </p>
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSingleModal(selectedPlan)}
                        disabled={busy}
                        className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Sửa lịch</span>
                      </button>
                      {!hasSelectedFixedSession && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setMobileSheetOpen(false);
                              onCheckInPlan(selectedPlan);
                            }}
                            className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Điểm danh bù</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdatePlanStatus(selectedPlan, 'PLANNED')}
                            disabled={busy}
                            className="col-span-2 sm:col-span-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Mở lại lịch</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
            Chưa có lịch cầu lông cố định trong ngày {formatDateVN(selectedDate)}.
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs bg-white"
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
                      <p className="text-[11px] text-slate-500">
                        {s.attendee_count} người tham gia
                        {(s.type === 'DRINKING' || (s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC')) &&
                        (s.payer_name || s.payer_id)
                          ? ` • Người ứng tiền: ${
                              s.payer_name || membersMap.get(s.payer_id)?.name || s.payer_id
                            }`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-slate-900">
                      {isFixedBadminton
                        ? s.total_amount > 0
                          ? `Thêm giờ: ${formatVND(s.total_amount)}`
                          : 'Theo lịch (0đ)'
                        : s.type === 'BADMINTON' &&
                          s.billing_mode === 'AD_HOC' &&
                          s.total_amount === 0 &&
                          s.attendee_count === 0
                        ? 'Dự kiến (0đ)'
                        : formatVND(s.total_amount)}
                    </span>
                    {isEditor && onEditSession && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileSheetOpen(false);
                          onEditSession(s);
                        }}
                        className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                        title="Chỉnh sửa buổi này"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Sửa</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Thêm nhanh cho ngày (tách khối rõ ràng, dễ bấm trên mobile) */}
        {isEditor && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">
              Thêm nhanh ngày {formatDateVN(selectedDate)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onCreateAdhocBadmintonOnDate(selectedDate);
                }}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Cầu phát sinh</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onCreateDrinkingOnDate(selectedDate);
                }}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold cursor-pointer"
              >
                <Utensils className="w-3.5 h-3.5 shrink-0" />
                <span>Buổi ăn nhậu</span>
              </button>
            </div>
            {!selectedPlan && (
              <button
                type="button"
                onClick={handleOpenAddSingleModal}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm lịch cầu cố định ngày này</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header chọn tháng & nút Hôm nay / Tạo lịch */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <button
            type="button"
            onClick={() => handleMonthStep(-1)}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition cursor-pointer"
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
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition cursor-pointer"
            aria-label="Tháng sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGoToday}
            className="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
            title={`Hôm nay (${formatDateVN(todayStr)}, giờ VN)`}
          >
            Hôm nay
          </button>

          {isEditor && (
            <button
              type="button"
              onClick={handleOpenGenModal}
              className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo lịch tháng</span>
            </button>
          )}
        </div>
      </div>

      {/* Thanh tóm tắt trạng thái tháng (cuộn ngang 1 dòng trên mobile) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 text-[11px]">
        <span className="shrink-0 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
          Đã diễn ra: {monthSummary.done}
        </span>
        {monthSummary.unlogged > 0 && (
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-semibold">
            Chưa ghi buổi: {monthSummary.unlogged}
          </span>
        )}
        <span className="shrink-0 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-semibold">
          Sắp tới: {monthSummary.upcoming}
        </span>
        {monthSummary.cancelled > 0 && (
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
            Nghỉ/Hủy: {monthSummary.cancelled}
          </span>
        )}
        {monthSummary.adhocCount > 0 && (
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 font-semibold">
            Phát sinh: {monthSummary.adhocCount}
          </span>
        )}
        {monthSummary.drinkingCount > 0 && (
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold">
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
                onClick={() => handleSelectDateCell(cell.dateStr!)}
                className={`h-14 sm:h-16 rounded-xl border flex flex-col items-center justify-between p-1.5 transition active:scale-95 cursor-pointer ${
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

        {/* Chú thích (thu gọn trên mobile, hiện đủ trên desktop) */}
        <div className="pt-3 mt-2 border-t border-slate-100">
          <div className="sm:hidden flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Chạm vào ngày để xem &amp; thao tác</span>
            <button
              type="button"
              onClick={() => setShowLegend((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer"
            >
              <span>Chú thích màu</span>
              {showLegend ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div
            className={`${
              showLegend ? 'flex' : 'hidden sm:flex'
            } items-center justify-center gap-3 pt-2 sm:pt-0 text-[11px] text-slate-500 flex-wrap`}
          >
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
        </div>
      </section>

      {/* Chi tiết ngày đang chọn (hiển thị inline cho cả desktop & mobile) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">
              {WEEKDAY_VN_NAMES[getWeekdayIndex(selectedDate)]}, ngày {formatDateVN(selectedDate)}
              {selectedDate === todayStr && (
                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  Hôm nay
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 truncate">
              {selectedPlan
                ? `Lịch cố định: ${selectedPlan.start_time} – ${selectedPlan.end_time} (${selectedPlan.courts} sân)`
                : 'Chưa có lịch cầu lông cố định ngày này'}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => stepSelectedDate(-1)}
              aria-label="Ngày trước"
              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => stepSelectedDate(1)}
              aria-label="Ngày sau"
              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {renderDayDetailBody()}
      </section>

      {/* Mobile Bottom Sheet chi tiết ngày khi chạm vào ô ngày */}
      {mobileSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết ngày ${formatDateVN(selectedDate)}`}
          className="md:hidden fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[1px] flex items-end justify-center"
          onClick={() => setMobileSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-3xl shadow-2xl max-h-[86vh] flex flex-col overflow-hidden"
          >
            <div className="pt-2.5 pb-3 px-4 border-b border-slate-100 bg-white sticky top-0 space-y-2">
              <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto" />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => stepSelectedDate(-1)}
                    aria-label="Ngày trước"
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 active:bg-slate-100 cursor-pointer shrink-0"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="min-w-0 px-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {WEEKDAY_VN_NAMES[getWeekdayIndex(selectedDate)]}, {formatDateVN(selectedDate)}
                      {selectedDate === todayStr && (
                        <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          Hôm nay
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">
                      {selectedPlan
                        ? `${selectedPlan.start_time} – ${selectedPlan.end_time} • ${selectedPlan.courts} sân`
                        : 'Chưa có lịch cố định'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => stepSelectedDate(1)}
                    aria-label="Ngày sau"
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 active:bg-slate-100 cursor-pointer shrink-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSheetOpen(false)}
                  aria-label="Đóng chi tiết ngày"
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              {renderDayDetailBody()}
            </div>
          </div>
        </div>
      )}

      {/* Modal Tạo lịch tháng cố định (Editor) */}
      {genModalOpen && isEditor && (
        <GenerateScheduleModal
          activeMonth={activeMonth}
          todayStr={todayStr}
          mainMembers={mainMembers}
          defaultCourts={settings.default_court_count || 2}
          onClose={() => setGenModalOpen(false)}
          onSuccess={onRefreshAll}
        />
      )}

      {/* Modal Thêm / Sửa 1 ngày lịch lẻ */}
      {dayModalOpen && isEditor && (
        <ScheduleDayModal
          selectedDate={selectedDate}
          editingPlan={editingPlan}
          mainMembers={mainMembers}
          defaultCourts={settings.default_court_count || 2}
          onClose={() => {
            setDayModalOpen(false);
            setEditingPlan(null);
          }}
          onSuccess={onRefreshAll}
        />
      )}
    </div>
  );
}
