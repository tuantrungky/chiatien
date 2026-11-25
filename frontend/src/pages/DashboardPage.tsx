import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  PieChart as PieChartIcon,
  QrCode,
  TrendingDown,
  TrendingUp,
  Utensils,
  Wallet,
  AlertCircle,
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
  DashboardData,
  FundLedgerData,
  PeriodType,
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
  dashboard: DashboardData | null;
  sessions: Session[];
  fundLedger: FundLedgerData | null;
  simplifiedDebts: SimplifiedDebtResult;
  onOpenQr: (data: VietQRModalData) => void;
  onGoToDebts: () => void;
}

export function DashboardPage({
  periodType,
  refDate,
  onChangePeriodType,
  onChangeRefDate,
  dashboard,
  sessions,
  fundLedger,
  simplifiedDebts,
  onOpenQr,
  onGoToDebts,
}: DashboardPageProps) {
  const [chartMode, setChartMode] = useState<'BAR' | 'PIE'>('BAR');

  const periodSessions = useMemo(
    () => filterByPeriod(sessions, (s) => s.date, periodType, refDate),
    [sessions, periodType, refDate]
  );

  // Tổng chi Ăn nhậu trong kỳ (từ Sessions DRINKING)
  const drinkingExpenseInPeriod = useMemo(
    () =>
      periodSessions
        .filter((s) => s.type === 'DRINKING')
        .reduce((sum, s) => sum + s.total_amount, 0),
    [periodSessions]
  );

  // Tổng thu / chi Cầu lông trong kỳ (từ Fund_Ledger trong kỳ)
  const badmintonIncomeInPeriod = dashboard?.fund.periodIncome ?? fundLedger?.summary.totalIncome ?? 0;
  const badmintonExpenseInPeriod = dashboard?.fund.periodExpense ?? fundLedger?.summary.totalExpense ?? 0;
  const currentFundBalance = dashboard?.fund.currentBalance ?? 0;
  const totalOutstanding = simplifiedDebts.totalOutstanding;

  // Dữ liệu biểu đồ cột theo ngày/tháng
  const barChartData = useMemo(() => {
    const groupByMonth = periodType === 'QUARTER' || periodType === 'YEAR';
    const buckets = new Map<string, { label: string; sortKey: string; badminton: number; drinking: number }>();

    const ensureBucket = (sortKey: string, label: string) => {
      if (!buckets.has(sortKey)) {
        buckets.set(sortKey, { label, sortKey, badminton: 0, drinking: 0 });
      }
      return buckets.get(sortKey)!;
    };

    for (const entry of fundLedger?.entries || []) {
      if (entry.type !== 'EXPENSE') continue;
      const sortKey = groupByMonth ? entry.date.slice(0, 7) : entry.date;
      const label = groupByMonth
        ? `T${entry.date.slice(5, 7)}/${entry.date.slice(2, 4)}`
        : formatShortDateVN(entry.date);
      ensureBucket(sortKey, label).badminton += entry.amount;
    }

    for (const s of periodSessions) {
      if (s.type !== 'DRINKING') continue;
      const sortKey = groupByMonth ? s.date.slice(0, 7) : s.date;
      const label = groupByMonth
        ? `T${s.date.slice(5, 7)}/${s.date.slice(2, 4)}`
        : formatShortDateVN(s.date);
      ensureBucket(sortKey, label).drinking += s.total_amount;
    }

    return Array.from(buckets.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [fundLedger, periodSessions, periodType]);

  const pieChartData = useMemo(() => {
    const items = [
      { name: 'Chi Cầu lông', value: badmintonExpenseInPeriod, color: '#059669' },
      { name: 'Chi Ăn nhậu', value: drinkingExpenseInPeriod, color: '#f97316' },
    ];
    return items.filter((item) => item.value > 0);
  }, [badmintonExpenseInPeriod, drinkingExpenseInPeriod]);

  const formatCompactAxis = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}tr`;
    if (v >= 1000) return `${Math.round(v / 1000)}k`;
    return String(v);
  };

  return (
    <div className="space-y-4">
      {/* Bộ lọc thời gian */}
      <PeriodFilterBar
        periodType={periodType}
        refDate={refDate}
        onChangePeriodType={onChangePeriodType}
        onChangeRefDate={onChangeRefDate}
      />

      {/* 4 Thẻ chỉ số nhanh (2x2 mobile, 4 cột desktop) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-emerald-100 text-xs font-medium mb-1.5">
            <span>Số dư Quỹ CLB</span>
            <Wallet className="w-4 h-4" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold tracking-tight">
            {formatVND(currentFundBalance)}
          </p>
          <p className="text-[11px] text-emerald-100/90 mt-1">
            {dashboard?.fund.pendingReimbursement
              ? `Chờ hoàn ứng: ${formatVND(dashboard.fund.pendingReimbursement)}`
              : 'Quỹ Cầu lông hiện tại'}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Thu / Chi Cầu lông</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-sm sm:text-base font-bold text-emerald-700">
            +{formatVND(badmintonIncomeInPeriod)}
          </p>
          <p className="text-xs font-semibold text-rose-600 flex items-center gap-1 mt-0.5">
            <TrendingDown className="w-3.5 h-3.5" />
            -{formatVND(badmintonExpenseInPeriod)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Chi Ăn nhậu (kỳ)</span>
            <Utensils className="w-4 h-4 text-orange-500" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-slate-900">
            {formatVND(drinkingExpenseInPeriod)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {periodSessions.filter((s) => s.type === 'DRINKING').length} buổi ăn nhậu
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1.5">
            <span>Công nợ chưa thu</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-lg sm:text-xl font-extrabold text-rose-600">
            {formatVND(totalOutstanding)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {simplifiedDebts.transfers.length} lệnh chuyển tối ưu
          </p>
        </div>
      </section>

      {/* Khối Cần chuyển khoản ngay */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Cần chuyển khoản ngay</h2>
            <p className="text-xs text-slate-500">Đã tối ưu cấn trừ nợ vòng tròn</p>
          </div>
          <button
            type="button"
            onClick={onGoToDebts}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
          >
            Xem chi tiết →
          </button>
        </div>

        {simplifiedDebts.transfers.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Không có khoản nợ nào cần chuyển khoản! Mọi người đã thanh toán đủ.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {simplifiedDebts.transfers.map((tr) => (
              <div
                key={`${tr.fromMember.member_id}-${tr.toMember.member_id}`}
                className="p-3.5 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-sm">
                    <span className="font-bold text-slate-900">{tr.fromMember.name}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-emerald-700">{tr.toMember.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                    <span className="font-extrabold text-rose-600 text-sm">
                      {formatVND(tr.amount)}
                    </span>
                    <span>•</span>
                    <span>Gồm {tr.breakdownSessions.length} khoản</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onOpenQr({
                      title: `${tr.fromMember.name} → ${tr.toMember.name}`,
                      subtitle: `Gồm ${tr.breakdownSessions.length} buổi/khoản chưa thanh toán`,
                      amount: tr.amount,
                      transferContent: tr.transferContent,
                      bankName: tr.toMember.bank_name,
                      bankBin: tr.toMember.bank_bin,
                      accountNo: tr.toMember.account_no,
                      accountName: tr.toMember.account_name || tr.toMember.name,
                      vietQrUrl: tr.vietQrUrl,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs active:scale-95 transition cursor-pointer shrink-0"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Hiện mã VietQR</span>
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
          <div className="inline-flex bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setChartMode('BAR')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                chartMode === 'BAR' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Cột</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode('PIE')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                chartMode === 'PIE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              <PieChartIcon className="w-3.5 h-3.5" />
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

      {/* Hoạt động gần đây */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Buổi gần nhất</h2>
          <span className="text-xs text-slate-400">{periodSessions.length} buổi trong kỳ</span>
        </div>
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
      </section>
    </div>
  );
}
