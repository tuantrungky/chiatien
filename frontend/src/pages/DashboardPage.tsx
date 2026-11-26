import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  PieChart as PieChartIcon,
  QrCode,
  Sparkles,
  Trophy,
  Utensils,
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
import type {
  BootstrapData,
  DashboardData,
  PeriodType,
  SeparatedDebtsData,
  Session,
  SimplifiedDebtResult,
} from '../types';
import { filterByPeriod, formatDateVN, formatShortDateVN } from '../utils/dateFilters';
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
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  onOpenQr: (data: VietQRModalData) => void;
  onGoToDebts: () => void;
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
  simplifiedDrinkingDebts,
  onOpenQr,
  onGoToDebts,
}: DashboardPageProps) {
  const [chartMode, setChartMode] = useState<'BAR' | 'PIE'>('BAR');

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

  const badmintonCostInPeriod = useMemo(
    () =>
      periodSessions
        .filter((s) => s.type === 'BADMINTON')
        .reduce((sum, s) => sum + s.total_amount, 0),
    [periodSessions]
  );

  const drinkingCostInPeriod = useMemo(
    () =>
      periodSessions
        .filter((s) => s.type === 'DRINKING')
        .reduce((sum, s) => sum + s.total_amount, 0),
    [periodSessions]
  );

  const badmintonUnpaid = debts?.badminton.totalOutstanding ?? 0;
  const drinkingUnpaid = simplifiedDrinkingDebts.totalOutstanding;
  const projectedCarryOut = dashboard?.badminton.projectedCarryOut ?? 0;

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

  const formatCompactAxis = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}tr`;
    if (v >= 1000) return `${Math.round(v / 1000)}k`;
    return String(v);
  };

  return (
    <div className="space-y-4">
      <PeriodFilterBar
        periodType={periodType}
        refDate={refDate}
        onChangePeriodType={onChangePeriodType}
        onChangeRefDate={onChangeRefDate}
      />

      {/* 4 Thẻ chỉ số nhanh (không còn Số dư Quỹ) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-emerald-100 text-xs font-medium mb-1.5">
            <span>Chi Cầu lông (kỳ)</span>
            <Trophy className="w-4 h-4" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold tracking-tight">
            {formatVND(badmintonCostInPeriod)}
          </p>
          <p className="text-[11px] text-emerald-100/90 mt-1">
            {periodSessions.filter((s) => s.type === 'BADMINTON').length} buổi • VL thu:{' '}
            {formatVND(dashboard?.badminton.guestIncomeInMonth ?? 0)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Chi Ăn nhậu (kỳ)</span>
            <Utensils className="w-4 h-4 text-orange-500" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-slate-900">
            {formatVND(drinkingCostInPeriod)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {periodSessions.filter((s) => s.type === 'DRINKING').length} buổi ăn nhậu
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Dư cầu sang T.sau</span>
            <Sparkles className="w-4 h-4 text-blue-600" />
          </div>
          <p
            className={`text-lg sm:text-xl font-extrabold ${
              projectedCarryOut >= 0 ? 'text-blue-700' : 'text-rose-600'
            }`}
          >
            {projectedCarryOut >= 0 ? '+' : ''}
            {formatVND(projectedCarryOut)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Tháng {dashboard?.currentMonth.slice(5, 7)}/{dashboard?.currentMonth.slice(0, 4)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Nợ chưa thu</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-rose-600">
            {formatVND(badmintonUnpaid + drinkingUnpaid)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Cầu: {formatVND(badmintonUnpaid)} • Nhậu: {formatVND(drinkingUnpaid)}
          </p>
        </div>
      </section>

      {/* Khối 1: Nợ Cầu lông (Thẳng Thủ quỹ) */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Cầu lông cần chuyển Thủ quỹ ({treasurer?.name || 'Thủ quỹ'})
            </h2>
            <p className="text-xs text-slate-500">Hóa đơn tháng MAIN &amp; phí vãng lai</p>
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
        (debts?.badminton.guestDues.length ?? 0) === 0 ? (
          <div className="p-5 text-center text-xs sm:text-sm text-slate-500">
            Mọi thành viên &amp; vãng lai đã đóng đủ tiền Cầu lông!
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {debts?.badminton.monthlyDues.map((d) => (
              <div key={d.due_id} className="p-3.5 flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-slate-900">{d.member_name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                      Cầu T{d.month.slice(5, 7)}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {formatVND(d.amount)}
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
                    {formatVND(g.amount)}
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
          <h2 className="text-sm font-bold text-slate-900">Buổi gần nhất</h2>
          <span className="text-xs text-slate-400">{periodSessions.length} buổi trong kỳ</span>
        </div>
        {(dashboard?.recentSessions || []).length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">Chưa có buổi chơi nào.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {(dashboard?.recentSessions || []).slice(0, 5).map((s) => (
              <div key={s.session_id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        s.type === 'BADMINTON'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}
                    >
                      {s.type === 'BADMINTON' ? 'Cầu lông' : 'Ăn nhậu'}
                    </span>
                    <span className="text-xs text-slate-400">{formatDateVN(s.date)}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 truncate mt-1">{s.title}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900">{formatVND(s.total_amount)}</p>
                  <p className="text-[11px] text-slate-500">{s.attendee_count} người</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
