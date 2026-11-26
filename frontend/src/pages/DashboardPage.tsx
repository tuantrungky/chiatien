import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  HelpCircle,
  PieChart as PieChartIcon,
  Plus,
  QrCode,
  Sparkles,
  Trophy,
  Utensils,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PeriodFilterBar } from '../components/PeriodFilterBar';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import type {
  BootstrapData,
  DashboardData,
  MonthlyBillData,
  PeriodType,
  ScheduleData,
  ScheduleDay,
  SeparatedDebtsData,
  Session,
  SessionType,
  SimplifiedDebtResult,
} from '../types';
import {
  filterByPeriod,
  formatDateVN,
  formatShortDateVN,
  getTodayDateStr,
} from '../utils/dateFilters';
import { formatVND } from '../utils/vietqr';

interface DashboardPageProps {
  periodType: PeriodType;
  refDate: string;
  onChangePeriodType: (type: PeriodType) => void;
  onChangeRefDate: (date: string) => void;
  bootstrap: BootstrapData | null;
  dashboard: DashboardData | null;
  sessions: Session[];
  debts: SeparatedDebtsData | null;
  schedule: ScheduleData | null;
  monthlyBill: MonthlyBillData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  onOpenQr: (data: VietQRModalData) => void;
  onGoToDebts: () => void;
  onGoToCalendar: () => void;
  onGoToMonthly: () => void;
  onCheckInPlan: (plan: ScheduleDay) => void;
  onCreateSession: (type: SessionType, options?: { date?: string; isAdhoc?: boolean }) => void;
}

const WEEKDAY_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function getWeekdayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY_VN[new Date(y, m - 1, d).getDay()] || '';
}

export function DashboardPage({
  periodType,
  refDate,
  onChangePeriodType,
  onChangeRefDate,
  bootstrap,
  dashboard,
  sessions,
  debts,
  schedule,
  monthlyBill,
  simplifiedDrinkingDebts,
  onOpenQr,
  onGoToDebts,
  onGoToCalendar,
  onGoToMonthly,
  onCheckInPlan,
  onCreateSession,
}: DashboardPageProps) {
  const { isEditor } = useAuth();
  const [chartMode, setChartMode] = useState<'BAR' | 'PIE'>('BAR');
  const [showFormula, setShowFormula] = useState<boolean>(false);

  const treasurer = useMemo(
    () =>
      bootstrap?.members.find(
        (m) => m.member_id === bootstrap.settings.treasurer_member_id
      ),
    [bootstrap]
  );

  const periodSessions = useMemo(
    () => filterByPeriod(sessions, (s) => s.date, periodType, refDate),
    [sessions, periodType, refDate]
  );

  const badmintonPeriodSessions = useMemo(
    () => periodSessions.filter((s) => s.type === 'BADMINTON'),
    [periodSessions]
  );
  const fixedCountInPeriod = useMemo(
    () => badmintonPeriodSessions.filter((s) => s.billing_mode !== 'AD_HOC').length,
    [badmintonPeriodSessions]
  );
  const adhocCountInPeriod = useMemo(
    () => badmintonPeriodSessions.filter((s) => s.billing_mode === 'AD_HOC').length,
    [badmintonPeriodSessions]
  );
  const badmintonCostInPeriod = useMemo(
    () => badmintonPeriodSessions.reduce((sum, s) => sum + s.total_amount, 0),
    [badmintonPeriodSessions]
  );

  const drinkingPeriodSessions = useMemo(
    () => periodSessions.filter((s) => s.type === 'DRINKING'),
    [periodSessions]
  );
  const drinkingCostInPeriod = useMemo(
    () => drinkingPeriodSessions.reduce((sum, s) => sum + s.total_amount, 0),
    [drinkingPeriodSessions]
  );

  const adhocDues = debts?.badminton.adhocDues ?? [];
  const badmintonUnpaid = debts?.badminton.totalOutstanding ?? 0;
  const drinkingUnpaid = simplifiedDrinkingDebts.totalOutstanding;

  // Thông tin Bù trừ Cầu lông tháng hiện hành
  const bill = monthlyBill?.bill;
  const dues = monthlyBill?.dues || [];
  const currentMonth = monthlyBill?.month || dashboard?.currentMonth || refDate.slice(0, 7);
  const monthLabel = `${currentMonth.slice(5, 7)}/${currentMonth.slice(0, 4)}`;
  const monthlyBillIssued =
    dashboard?.badminton.monthlyBillIssued ?? (dues.length > 0 || (bill?.billed_total ?? 0) > 0);
  const carryIn = bill?.carry_in ?? dashboard?.badminton.carryIn ?? 0;
  const billedTotal = bill?.billed_total ?? dashboard?.badminton.billedTotal ?? 0;
  const guestIncome = bill?.guest_income ?? dashboard?.badminton.guestIncomeInMonth ?? 0;
  const actualCost = bill?.actual_cost ?? dashboard?.badminton.actualCost ?? 0;
  const projectedCarryOut = bill?.carry_out ?? dashboard?.badminton.projectedCarryOut ?? 0;
  const perMember = bill?.per_member ?? dashboard?.badminton.perMember ?? 0;
  const paidMembersCount =
    dues.length > 0
      ? dues.filter((d) => d.is_paid).length
      : dashboard?.badminton.paidMembersCount ?? 0;
  const totalMembersCount =
    dues.length > 0 ? dues.length : dashboard?.badminton.totalMembersCount ?? 0;
  const paidProgressPct =
    totalMembersCount > 0 ? Math.round((paidMembersCount / totalMembersCount) * 100) : 0;

  // 3 ngày đánh cầu sắp tới từ hôm nay
  const todayStr = getTodayDateStr();
  const upcomingPlans = useMemo(
    () =>
      (schedule?.days || [])
        .filter((d) => d.status === 'PLANNED' && d.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 3),
    [schedule, todayStr]
  );

  const barChartData = useMemo(() => {
    const groupByMonth = periodType === 'QUARTER' || periodType === 'YEAR';
    const buckets = new Map<
      string,
      { label: string; sortKey: string; badminton: number; drinking: number }
    >();

    for (const s of periodSessions) {
      const sortKey = groupByMonth ? s.date.slice(0, 7) : s.date;
      const label = groupByMonth
        ? `T${s.date.slice(5, 7)}/${s.date.slice(2, 4)}`
        : formatShortDateVN(s.date);
      if (!buckets.has(sortKey)) {
        buckets.set(sortKey, { label, sortKey, badminton: 0, drinking: 0 });
      }
      const b = buckets.get(sortKey)!;
      if (s.type === 'BADMINTON') b.badminton += s.total_amount;
      else b.drinking += s.total_amount;
    }

    return Array.from(buckets.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [periodSessions, periodType]);

  const pieChartData = useMemo(
    () =>
      [
        { name: 'Chi Cầu lông', value: badmintonCostInPeriod, color: '#059669' },
        { name: 'Chi Ăn nhậu', value: drinkingCostInPeriod, color: '#f97316' },
      ].filter((item) => item.value > 0),
    [badmintonCostInPeriod, drinkingCostInPeriod]
  );

  const recentSessions = useMemo(
    () =>
      (dashboard?.recentSessions && dashboard.recentSessions.length > 0
        ? dashboard.recentSessions
        : [...sessions].sort((a, b) => b.date.localeCompare(a.date))
      ).slice(0, 5),
    [dashboard, sessions]
  );

  const formatCompactAxis = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}tr`;
    if (v >= 1000) return `${Math.round(v / 1000)}k`;
    return String(v);
  };

  return (
    <div className="space-y-4">
      {/* Thanh Thao tác nhanh cho Editor */}
      {isEditor && (
        <section className="bg-white rounded-2xl border border-emerald-200/80 p-3 shadow-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700">Thao tác nhanh của Editor</span>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <button
                type="button"
                onClick={onGoToCalendar}
                className="text-sky-700 hover:underline cursor-pointer"
              >
                Lịch tháng
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={onGoToMonthly}
                className="text-emerald-700 hover:underline cursor-pointer"
              >
                Chia tiền tháng
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onCreateSession('BADMINTON')}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs active:scale-[0.99] transition cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Thêm buổi Cầu lông</span>
            </button>
            <button
              type="button"
              onClick={() => onCreateSession('DRINKING')}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs sm:text-sm font-bold shadow-xs active:scale-[0.99] transition cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Thêm buổi Ăn nhậu</span>
            </button>
          </div>
        </section>
      )}

      <PeriodFilterBar
        periodType={periodType}
        refDate={refDate}
        onChangePeriodType={onChangePeriodType}
        onChangeRefDate={onChangeRefDate}
      />

      {/* 4 Thẻ chỉ số nhanh (KPI) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-[#113b66] via-[#1b568f] to-[#0d7c66] text-white rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-sky-100 text-xs font-medium mb-1.5">
            <span>Chi Cầu lông (kỳ)</span>
            <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold tracking-tight">
            {formatVND(badmintonCostInPeriod)}
          </p>
          <p className="text-[11px] text-sky-100/90 mt-1">
            {fixedCountInPeriod} cố định • {adhocCountInPeriod} phát sinh
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Chi Ăn nhậu (kỳ)</span>
            <Utensils className="w-4 h-4 text-orange-500 shrink-0" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-slate-900">
            {formatVND(drinkingCostInPeriod)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {drinkingPeriodSessions.length} buổi ăn nhậu
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5 gap-1">
              <span className="truncate">Bù trừ Cầu T.{monthLabel}</span>
              <button
                type="button"
                onClick={() => setShowFormula((v) => !v)}
                aria-label="Xem công thức bù trừ cầu sang tháng sau"
                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-700 shrink-0 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Công thức</span>
              </button>
            </div>

            {!monthlyBillIssued ? (
              <>
                <p className="text-base sm:text-lg font-extrabold text-amber-700">
                  Chưa chia tháng
                </p>
                <button
                  type="button"
                  onClick={onGoToMonthly}
                  className="text-[11px] text-emerald-700 font-semibold hover:underline mt-1 text-left cursor-pointer"
                >
                  Vào Tháng cầu để chia →
                </button>
              </>
            ) : (
              <>
                <p
                  className={`text-lg sm:text-xl font-extrabold ${
                    projectedCarryOut >= 0 ? 'text-blue-700' : 'text-rose-600'
                  }`}
                >
                  {projectedCarryOut >= 0 ? 'Dư +' : 'Thiếu '}
                  {formatVND(projectedCarryOut)}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {projectedCarryOut >= 0
                    ? 'Tháng sau mỗi người đóng ít đi'
                    : 'Tháng sau chia bù phần thiếu'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Nợ chưa thu</span>
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-rose-600">
            {formatVND(badmintonUnpaid + drinkingUnpaid)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Cầu: {formatVND(badmintonUnpaid)} • Nhậu: {formatVND(drinkingUnpaid)}
          </p>
        </div>
      </section>

      {/* Hộp giải thích công thức Bù trừ Cầu sang tháng sau */}
      {showFormula && (
        <section className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 text-xs text-slate-700 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-blue-950">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Cách tính tiền Cầu lông chuyển sang tháng sau (Tháng {monthLabel})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFormula(false)}
              className="text-blue-700 font-semibold hover:underline cursor-pointer"
            >
              Ẩn
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            <div className="bg-white rounded-xl p-2 border border-blue-100">
              <p className="text-[10px] text-slate-500">Kỳ trước chuyển sang</p>
              <p className="font-bold text-slate-900 mt-0.5">{formatVND(carryIn)}</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-blue-100">
              <p className="text-[10px] text-slate-500">+ Đã chia MAIN</p>
              <p className="font-bold text-emerald-700 mt-0.5">+{formatVND(billedTotal)}</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-blue-100">
              <p className="text-[10px] text-slate-500">+ Vãng lai đã thu</p>
              <p className="font-bold text-emerald-700 mt-0.5">+{formatVND(guestIncome)}</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-blue-100">
              <p className="text-[10px] text-slate-500">− Chi buổi cố định</p>
              <p className="font-bold text-rose-600 mt-0.5">−{formatVND(actualCost)}</p>
            </div>
            <div className="bg-blue-600 text-white rounded-xl p-2 col-span-2 sm:col-span-1">
              <p className="text-[10px] text-blue-100">= Chuyển tháng sau</p>
              <p className="font-extrabold mt-0.5">
                {projectedCarryOut >= 0 ? '+' : ''}
                {formatVND(projectedCarryOut)}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 leading-relaxed">
            <strong>Ý nghĩa:</strong> Nếu kết quả <strong>Dư (+)</strong> (nhờ thu thêm vãng lai hoặc
            đánh ít hơn dự toán), tháng sau mỗi thành viên chính sẽ đóng ít đi phần dư này. Nếu{' '}
            <strong>Thiếu (−)</strong>, tháng sau sẽ cộng bù vào dự toán để chia đều.{' '}
            <em>(Các buổi cầu phát sinh đã chia riêng từng buổi nên không tính vào đây.)</em>
          </p>
        </section>
      )}

      {/* Khối Tiến độ Tháng Cầu & Lịch đánh sắp tới */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Tiến độ đóng tiền Cầu tháng */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Tiến độ Cầu tháng {monthLabel}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {monthlyBillIssued
                    ? `${formatVND(perMember)}/người • VL đã thu ${formatVND(guestIncome)}`
                    : 'Chưa phát hành hóa đơn đầu tháng'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onGoToMonthly}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer shrink-0"
            >
              Tháng cầu →
            </button>
          </div>

          {!monthlyBillIssued ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 flex items-center justify-between gap-2">
              <span>Chưa chia tiền sân cố định cho thành viên MAIN trong tháng {monthLabel}.</span>
              {isEditor && (
                <button
                  type="button"
                  onClick={onGoToMonthly}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-bold shrink-0 cursor-pointer"
                >
                  Chia ngay
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">
                  Đã đóng: {paidMembersCount}/{totalMembersCount} thành viên MAIN
                </span>
                <span className="font-bold text-emerald-700">{paidProgressPct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${paidProgressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Đã chia thu: {formatVND(billedTotal)}</span>
                <span>Chi cố định T.{currentMonth.slice(5, 7)}: {formatVND(actualCost)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Lịch đánh cầu sắp tới */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
                <CalendarDays className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Lịch đánh cầu sắp tới</h2>
                <p className="text-[11px] text-slate-500">Các buổi cố định tiếp theo từ hôm nay</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onGoToCalendar}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 cursor-pointer shrink-0"
            >
              Mở Lịch →
            </button>
          </div>

          {upcomingPlans.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500 flex items-center justify-between gap-2">
              <span>Chưa có lịch đánh cầu cố định nào sắp tới trong tháng {monthLabel}.</span>
              {isEditor && (
                <button
                  type="button"
                  onClick={onGoToCalendar}
                  className="px-3 py-1.5 rounded-xl bg-sky-600 text-white font-bold shrink-0 cursor-pointer"
                >
                  Lập lịch
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingPlans.map((plan) => {
                const plannedCount = plan.planned_member_ids
                  ? plan.planned_member_ids.split(',').filter((x) => x.trim()).length
                  : 0;
                return (
                  <div
                    key={plan.plan_id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">
                        {getWeekdayLabel(plan.date)}, {formatShortDateVN(plan.date)} • {plan.start_time}–
                        {plan.end_time}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {plan.courts} sân • {plannedCount} người dự kiến
                      </p>
                    </div>
                    {isEditor && (
                      <button
                        type="button"
                        onClick={() => onCheckInPlan(plan)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Điểm danh</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Khối 1: Nợ Cầu lông (Tháng + Phát sinh + Vãng lai) */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Cầu lông cần chuyển khoản
            </h2>
            <p className="text-xs text-slate-500">
              Tiền tháng MAIN, cầu phát sinh &amp; phí vãng lai (tách riêng Ăn nhậu)
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToDebts}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer shrink-0"
          >
            Xem chi tiết →
          </button>
        </div>

        {(debts?.badminton.monthlyDues.length ?? 0) === 0 &&
        (debts?.badminton.guestDues.length ?? 0) === 0 &&
        adhocDues.length === 0 ? (
          <div className="p-5 text-center text-xs sm:text-sm text-slate-500">
            Mọi thành viên &amp; vãng lai đã đóng đủ tiền Cầu lông!
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {debts?.badminton.monthlyDues.map((d) => (
              <div key={d.due_id} className="p-3.5 flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-slate-900">{d.member_name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                      Cầu T{d.month.slice(5, 7)}
                    </span>
                    {(d.credit_amount ?? 0) > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        −góp cầu
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {formatVND(d.amount)} → {treasurer?.name || 'Thủ quỹ'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onOpenQr({
                      title: `${d.member_name} → Thủ quỹ (${treasurer?.name || ''})`,
                      subtitle: `Tiền cầu tháng ${d.month.slice(5, 7)}`,
                      amount: d.amount,
                      transferContent: d.transferContent,
                      bankName: debts.badminton.treasurerBank?.bankName || '',
                      bankBin: debts.badminton.treasurerBank?.bankBin || '',
                      accountNo: debts.badminton.treasurerBank?.accountNo || '',
                      accountName: debts.badminton.treasurerBank?.accountName || '',
                      vietQrUrl: d.vietQrUrl,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>VietQR</span>
                </button>
              </div>
            ))}

            {adhocDues.map((a) => (
              <div key={a.attendance_id} className="p-3.5 flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-slate-900">{a.member_name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                      Phát sinh {formatShortDateVN(a.session_date)}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {formatVND(a.amount)} → {a.creditor_name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onOpenQr({
                      title: `${a.member_name} → ${a.creditor_name}`,
                      subtitle: `${a.session_title} (${formatDateVN(a.session_date)})`,
                      amount: a.amount,
                      transferContent: a.transferContent,
                      bankName: a.creditorBank?.bankName || '',
                      bankBin: a.creditorBank?.bankBin || '',
                      accountNo: a.creditorBank?.accountNo || '',
                      accountName: a.creditorBank?.accountName || '',
                      vietQrUrl: a.vietQrUrl,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>VietQR</span>
                </button>
              </div>
            ))}

            {debts?.badminton.guestDues.map((g) => (
              <div key={g.attendance_id} className="p-3.5 flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-slate-900">{g.member_name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      VL {formatShortDateVN(g.session_date)}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {formatVND(g.amount)} → {treasurer?.name || 'Thủ quỹ'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onOpenQr({
                      title: `${g.member_name} → Thủ quỹ (${treasurer?.name || ''})`,
                      subtitle: `${g.session_title} (${formatDateVN(g.session_date)})`,
                      amount: g.amount,
                      transferContent: g.transferContent,
                      bankName: debts.badminton.treasurerBank?.bankName || '',
                      bankBin: debts.badminton.treasurerBank?.bankBin || '',
                      accountNo: debts.badminton.treasurerBank?.accountNo || '',
                      accountName: debts.badminton.treasurerBank?.accountName || '',
                      vietQrUrl: g.vietQrUrl,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>VietQR</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Khối 2: Chuyển khoản Ăn nhậu (tối ưu riêng) */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Chuyển khoản Ăn nhậu</h2>
            <p className="text-xs text-slate-500">Đã cấn trừ món góp &amp; gộp các buổi nhậu</p>
          </div>
          <button
            type="button"
            onClick={onGoToDebts}
            className="text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer shrink-0"
          >
            Xem chi tiết →
          </button>
        </div>

        {simplifiedDrinkingDebts.transfers.length === 0 ? (
          <div className="p-5 text-center text-xs sm:text-sm text-slate-500">
            Không có khoản nợ Ăn nhậu nào cần chuyển!
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {simplifiedDrinkingDebts.transfers.map((tr) => (
              <div
                key={`${tr.fromMember.member_id}-${tr.toMember.member_id}`}
                className="p-3.5 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-sm">
                    <span className="font-bold text-slate-900">{tr.fromMember.name}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-orange-700">{tr.toMember.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                    <span className="font-extrabold text-rose-600 text-sm">
                      {formatVND(tr.amount)}
                    </span>
                    <span>•</span>
                    <span>{tr.breakdownSessions.length} buổi nhậu</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onOpenQr({
                      title: `${tr.fromMember.name} → ${tr.toMember.name}`,
                      subtitle: `Tiền ăn nhậu (${tr.breakdownSessions.length} buổi)`,
                      amount: tr.amount,
                      transferContent: tr.transferContent,
                      bankName: tr.toMember.bank_name,
                      bankBin: tr.toMember.bank_bin,
                      accountNo: tr.toMember.account_no,
                      accountName: tr.toMember.account_name || tr.toMember.name,
                      vietQrUrl: tr.vietQrUrl,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>VietQR</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Biểu đồ chi tiêu Cầu lông vs Ăn nhậu */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">So sánh chi Cầu lông &amp; Ăn nhậu</h2>
            <p className="text-xs text-slate-500">Theo bộ lọc kỳ đang chọn</p>
          </div>
          <div className="inline-flex bg-slate-100 p-1 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setChartMode('BAR')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                chartMode === 'BAR' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 shrink-0" />
              <span>Cột</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode('PIE')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                chartMode === 'PIE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              <PieChartIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Tỷ trọng</span>
            </button>
          </div>
        </div>

        {chartMode === 'BAR' ? (
          barChartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-400">
              Chưa có phát sinh chi tiêu trong kỳ này.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tickFormatter={formatCompactAxis} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip
                    formatter={(value) => formatVND(Number(value) || 0)}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar
                    dataKey="badminton"
                    name="Chi Cầu lông"
                    fill="#059669"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={32}
                  />
                  <Bar
                    dataKey="drinking"
                    name="Chi Ăn nhậu"
                    fill="#f97316"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )
        ) : pieChartData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-xs text-slate-400">
            Chưa có phát sinh chi tiêu trong kỳ này.
          </div>
        ) : (
          <div className="h-64 w-full flex flex-col sm:flex-row items-center">
            <div className="w-full h-52 sm:flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={4}
                  >
                    {pieChartData.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatVND(Number(value) || 0)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex sm:flex-col gap-4 sm:gap-2 text-xs pr-2">
              {pieChartData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <div>
                    <p className="text-slate-500">{item.name}</p>
                    <p className="font-bold text-slate-900">{formatVND(item.value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Buổi gần nhất */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Buổi gần nhất</h2>
            <p className="text-xs text-slate-400">{periodSessions.length} buổi trong kỳ đang chọn</p>
          </div>
          <button
            type="button"
            onClick={onGoToDebts}
            className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
          >
            Xem tất cả →
          </button>
        </div>
        {recentSessions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">Chưa có buổi chơi nào.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentSessions.map((s) => (
              <div key={s.session_id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        s.type === 'BADMINTON'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}
                    >
                      {s.type === 'BADMINTON' ? 'Cầu lông' : 'Ăn nhậu'}
                    </span>
                    {s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                        Phát sinh
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{formatDateVN(s.date)}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 truncate mt-1">{s.title}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900">{formatVND(s.total_amount)}</p>
                  <p className="text-[11px] text-slate-500">
                    {s.attendee_count} người
                    {s.per_person_amount > 0 ? ` • ${formatVND(s.per_person_amount)}/ng` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
