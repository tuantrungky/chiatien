import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  QrCode,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { addFundEntry, confirmPayment } from '../services/api';
import type {
  BootstrapData,
  FundLedgerCategory,
  FundLedgerData,
  FundLedgerType,
  GuestStatItem,
  GuestStatsData,
  Member,
} from '../types';
import { formatDateVN, formatShortDateVN, getTodayDateStr } from '../utils/dateFilters';
import { buildTransferContent, buildVietQrUrl, formatVND } from '../utils/vietqr';

interface FundAndGuestsPageProps {
  bootstrap: BootstrapData | null;
  fundLedger: FundLedgerData | null;
  guestStats: GuestStatsData | null;
  guestMonth: string;
  onChangeGuestMonth: (month: string) => void;
  onOpenQr: (data: VietQRModalData) => void;
  onRefreshAll: () => Promise<void>;
}

function shiftMonthStr(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const mm = d.getMonth() + 1;
  return `${d.getFullYear()}-${mm < 10 ? '0' + mm : mm}`;
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  return `Tháng ${m}/${y}`;
}

export function FundAndGuestsPage({
  bootstrap,
  fundLedger,
  guestStats,
  guestMonth,
  onChangeGuestMonth,
  onOpenQr,
  onRefreshAll,
}: FundAndGuestsPageProps) {
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();
  const [subTab, setSubTab] = useState<'MAIN_FUND' | 'GUEST_STATS'>('MAIN_FUND');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal Thu / Chi Quỹ lẻ
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [entryType, setEntryType] = useState<FundLedgerType>('EXPENSE');
  const [entryCategory, setEntryCategory] = useState<FundLedgerCategory>('SHUTTLECOCK');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState(() => getTodayDateStr());
  const [entryMemberId, setEntryMemberId] = useState('');
  const [entryDesc, setEntryDesc] = useState('');

  const settings = bootstrap?.settings;
  const members = bootstrap?.members || [];
  const treasurer: Member | undefined = useMemo(
    () => members.find((m) => m.member_id === settings?.treasurer_member_id),
    [members, settings]
  );

  const mainMembers = useMemo(
    () => members.filter((m) => m.is_active && m.type === 'MAIN'),
    [members]
  );

  const mainMemberFundRows = useMemo(() => {
    const entries = fundLedger?.entries || [];
    const paidByMember = new Map<string, number>();

    for (const e of entries) {
      if (e.type === 'INCOME' && (e.category === 'MONTHLY_FUND' || e.category === ('MONTHLY_FEE' as FundLedgerCategory))) {
        const entryMonth = e.period || e.date.slice(0, 7);
        if (entryMonth === guestMonth) {
          paidByMember.set(e.member_id, (paidByMember.get(e.member_id) || 0) + e.amount);
        }
      }
    }

    const monthlyFee = settings?.monthly_fee ?? settings?.default_monthly_fund ?? 300000;

    return mainMembers.map((m) => {
      const paidAmount = paidByMember.get(m.member_id) || 0;
      const isPaid = paidAmount >= monthlyFee || paidAmount > 0;
      return { member: m, paidAmount, expectedFee: monthlyFee, isPaid };
    });
  }, [mainMembers, fundLedger, guestMonth, settings]);

  const paidMainCount = mainMemberFundRows.filter((r) => r.isPaid).length;

  const filteredLedgerEntries = useMemo(() => {
    const list = fundLedger?.entries || [];
    if (ledgerFilter === 'ALL') return list;
    return list.filter((e) => e.type === ledgerFilter);
  }, [fundLedger, ledgerFilter]);

  const openTreasurerQr = (fromName: string, amount: number, purpose: string) => {
    if (!treasurer) return;
    const prefix = settings?.transfer_prefix || 'CLN';
    const content = buildTransferContent(prefix, fromName, `${treasurer.name} ${purpose}`);
    const url = buildVietQrUrl({
      bankBin: treasurer.bank_bin,
      accountNo: treasurer.account_no,
      accountName: treasurer.account_name || treasurer.name,
      amount,
      addInfo: content,
      template: settings?.vietqr_template || 'compact2',
    });

    onOpenQr({
      title: `${fromName} → Thủ quỹ (${treasurer.name})`,
      subtitle: purpose,
      amount,
      transferContent: content,
      bankName: treasurer.bank_name,
      bankBin: treasurer.bank_bin,
      accountNo: treasurer.account_no,
      accountName: treasurer.account_name || treasurer.name,
      vietQrUrl: url,
    });
  };

  const handleConfirmMonthlyFund = async (member: Member, amount: number) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(member.member_id);
    setActionError(null);
    try {
      await addFundEntry(idToken, {
        date: getTodayDateStr(),
        type: 'INCOME',
        category: 'MONTHLY_FUND',
        amount,
        memberId: member.member_id,
        period: guestMonth,
        description: `Đóng quỹ tháng ${guestMonth.slice(5, 7)}/${guestMonth.slice(0, 4)} - ${member.name}`,
      });
      await onRefreshAll();
      toast.success(`Đã xác nhận ${member.name} đóng quỹ tháng.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmGuestAllPaid = async (g: GuestStatItem) => {
    if (!isEditor || !idToken || busyKey) return;
    const unpaidIds = g.sessions.filter((s) => !s.isPaid).map((s) => s.attendanceId);
    if (unpaidIds.length === 0) return;

    setBusyKey(g.memberId);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        mode: 'ITEMS',
        fromMemberId: g.memberId,
        toMemberId: settings?.treasurer_member_id || '',
        attendanceIds: unpaidIds,
        amount: g.totalUnpaid,
        method: 'CASH',
        note: `Thu đủ vãng lai tháng ${guestMonth}`,
      });
      await onRefreshAll();
      toast.success(`Đã thu đủ ${formatVND(g.totalUnpaid)} của ${g.name}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const openQuickEntryModal = () => {
    setEntryType('EXPENSE');
    setEntryCategory('SHUTTLECOCK');
    setEntryAmount('');
    setEntryDate(getTodayDateStr());
    setEntryMemberId(settings?.treasurer_member_id || members[0]?.member_id || '');
    setEntryDesc('');
    setActionError(null);
    setEntryModalOpen(true);
  };

  const handleCreateQuickFundEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditor || !idToken || busyKey) return;
    const amt = Math.round(Number(entryAmount) || 0);
    if (amt <= 0) {
      setActionError('Số tiền phải lớn hơn 0.');
      return;
    }

    setBusyKey('quick_entry');
    setActionError(null);
    try {
      await addFundEntry(idToken, {
        date: entryDate,
        type: entryType,
        category: entryCategory,
        amount: amt,
        memberId: entryMemberId || settings?.treasurer_member_id || '',
        period: entryDate.slice(0, 7),
        description: entryDesc.trim(),
      });
      setEntryModalOpen(false);
      await onRefreshAll();
      toast.success('Đã ghi nhận giao dịch vào Sổ Quỹ.');
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented Switcher */}
      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('MAIN_FUND')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'MAIN_FUND'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Quỹ Thành viên chính</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('GUEST_STATS')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'GUEST_STATS'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Thống kê Vãng lai</span>
        </button>
      </div>

      {actionError && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Bộ chọn tháng dùng chung */}
      <div className="bg-white rounded-2xl border border-slate-200 px-3 py-2.5 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={() => onChangeGuestMonth(shiftMonthStr(guestMonth, -1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
          aria-label="Tháng trước"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-[11px] text-slate-400 font-medium">Kỳ theo dõi</p>
          <p className="text-sm font-bold text-slate-900">{formatMonthLabel(guestMonth)}</p>
        </div>
        <button
          type="button"
          onClick={() => onChangeGuestMonth(shiftMonthStr(guestMonth, 1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
          aria-label="Tháng sau"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* TAB 1: QUỸ THÀNH VIÊN CHÍNH & SỔ QUỸ */}
      {subTab === 'MAIN_FUND' && (
        <div className="space-y-4">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Đóng quỹ {formatMonthLabel(guestMonth)}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Mức quỹ cố định: {formatVND(settings?.monthly_fee ?? 300000)}/tháng
                  </p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                  {paidMainCount}/{mainMemberFundRows.length} đã đóng
                </span>
              </div>

              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{
                    width:
                      mainMemberFundRows.length > 0
                        ? `${Math.round((paidMainCount / mainMemberFundRows.length) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {mainMemberFundRows.map((row) => (
                <div
                  key={row.member.member_id}
                  className="px-4 py-3 flex items-center justify-between gap-2.5 flex-wrap"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {row.isPaid ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-rose-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {row.member.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.isPaid
                          ? `Đã đóng ${formatVND(row.paidAmount)}`
                          : `Chưa đóng (${formatVND(row.expectedFee)})`}
                      </p>
                    </div>
                  </div>

                  {row.isPaid ? (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg shrink-0">
                      Hoàn tất
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          openTreasurerQr(
                            row.member.name,
                            row.expectedFee,
                            `quy T${guestMonth.slice(5, 7)}`
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>VietQR</span>
                      </button>

                      {isEditor && (
                        <button
                          type="button"
                          onClick={() => void handleConfirmMonthlyFund(row.member, row.expectedFee)}
                          disabled={Boolean(busyKey)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60"
                        >
                          {busyKey === row.member.member_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Xác nhận đóng quỹ</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Sổ Thu / Chi Fund_Ledger */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Sổ Thu / Chi Quỹ</h2>
                {fundLedger && (
                  <p className="text-xs text-slate-500">
                    Số dư cuối kỳ:{' '}
                    <span className="font-bold text-slate-800">
                      {formatVND(fundLedger.summary.closingBalance)}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {isEditor && (
                  <button
                    type="button"
                    onClick={openQuickEntryModal}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thu / Chi Quỹ lẻ</span>
                  </button>
                )}

                <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                  {[
                    { id: 'ALL' as const, label: 'Tất cả' },
                    { id: 'INCOME' as const, label: 'Thu' },
                    { id: 'EXPENSE' as const, label: 'Chi' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setLedgerFilter(f.id)}
                      className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                        ledgerFilter === f.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredLedgerEntries.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Chưa có giao dịch sổ quỹ trong kỳ này.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredLedgerEntries.map((entry) => {
                  const isIncome = entry.type === 'INCOME';
                  return (
                    <div
                      key={entry.ledger_id}
                      className="px-4 py-3 flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isIncome
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {isIncome ? (
                            <ArrowDownLeft className="w-4 h-4" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 leading-snug">
                            {entry.description}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-slate-500">
                            <span>{formatDateVN(entry.date)}</span>
                            <span>•</span>
                            <span>{entry.member_name || entry.member_id}</span>
                            {!isIncome && !entry.is_paid && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                                Chờ hoàn ứng
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-sm font-bold shrink-0 ${
                          isIncome ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {isIncome ? '+' : '-'}
                        {formatVND(entry.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: THỐNG KÊ VÃNG LAI THEO THÁNG */}
      {subTab === 'GUEST_STATS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center shadow-xs">
              <p className="text-[11px] text-slate-500">Số vãng lai</p>
              <p className="text-lg font-extrabold text-slate-900 mt-0.5">
                {guestStats?.summary.totalGuests ?? 0}
              </p>
              <p className="text-[11px] text-slate-400">
                {guestStats?.summary.totalVisits ?? 0} lượt đi
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center shadow-xs">
              <p className="text-[11px] text-slate-500">Đã đóng</p>
              <p className="text-sm sm:text-base font-extrabold text-emerald-700 mt-1">
                {formatVND(guestStats?.summary.totalPaid ?? 0)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center shadow-xs">
              <p className="text-[11px] text-slate-500">Còn nợ</p>
              <p className="text-sm sm:text-base font-extrabold text-rose-600 mt-1">
                {formatVND(guestStats?.summary.totalUnpaid ?? 0)}
              </p>
            </div>
          </div>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Chi tiết Vãng lai {formatMonthLabel(guestMonth)}
                </h2>
              </div>
            </div>

            {!guestStats || guestStats.guests.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Không có khách vãng lai nào tham gia trong {formatMonthLabel(guestMonth)}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {guestStats.guests.map((g) => {
                  const hasDebt = g.totalUnpaid > 0;
                  return (
                    <div key={g.memberId} className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900">{g.name}</h3>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                              {g.sessionCount} buổi
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Tổng phí:{' '}
                            <span className="font-semibold text-slate-800">
                              {formatVND(g.totalFee)}
                            </span>
                            {g.totalPaid > 0 && ` • Đã đóng: ${formatVND(g.totalPaid)}`}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          {hasDebt ? (
                            <span className="inline-block text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg">
                              Nợ {formatVND(g.totalUnpaid)}
                            </span>
                          ) : (
                            <span className="inline-block text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                              Đã đóng đủ
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-slate-400">Ngày đi:</span>
                          {g.dates.map((d) => (
                            <span
                              key={d}
                              className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700"
                            >
                              {formatShortDateVN(d)}
                            </span>
                          ))}
                        </div>

                        {hasDebt && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                openTreasurerQr(
                                  g.name,
                                  g.totalUnpaid,
                                  `vang lai T${guestMonth.slice(5, 7)}`
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              <span>VietQR</span>
                            </button>
                            {isEditor && (
                              <button
                                type="button"
                                onClick={() => void handleConfirmGuestAllPaid(g)}
                                disabled={Boolean(busyKey)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60"
                              >
                                {busyKey === g.memberId ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                                <span>Đã thu</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modal Thu / Chi Quỹ lẻ (Chỉ Editor) */}
      {entryModalOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEntryModalOpen(false)}
        >
          <form
            onSubmit={handleCreateQuickFundEntry}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Ghi nhận Thu / Chi Quỹ lẻ</h3>
              <button
                type="button"
                onClick={() => setEntryModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setEntryType('EXPENSE');
                  setEntryCategory('SHUTTLECOCK');
                }}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  entryType === 'EXPENSE' ? 'bg-rose-600 text-white' : 'text-slate-600'
                }`}
              >
                Khoản Chi (-)
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryType('INCOME');
                  setEntryCategory('MONTHLY_FUND');
                }}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  entryType === 'INCOME' ? 'bg-emerald-600 text-white' : 'text-slate-600'
                }`}
              >
                Khoản Thu (+)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Danh mục</label>
                <select
                  value={entryCategory}
                  onChange={(e) => setEntryCategory(e.target.value as FundLedgerCategory)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold bg-white"
                >
                  {entryType === 'EXPENSE' ? (
                    <>
                      <option value="SHUTTLECOCK">Mua ống cầu</option>
                      <option value="COURT">Đặt cọc / Tiền sân</option>
                      <option value="WATER">Tiền nước</option>
                      <option value="OTHER_EXPENSE">Chi khác</option>
                    </>
                  ) : (
                    <>
                      <option value="MONTHLY_FUND">Đóng quỹ tháng</option>
                      <option value="GUEST_FEE">Phí vãng lai</option>
                      <option value="OTHER_INCOME">Thu khác</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày</label>
                <input
                  type="date"
                  required
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Số tiền (VND) *</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  required
                  value={entryAmount}
                  onChange={(e) => setEntryAmount(e.target.value)}
                  placeholder="210000"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {entryType === 'EXPENSE' ? 'Người chi tiền' : 'Người đóng tiền'}
                </label>
                <select
                  value={entryMemberId}
                  onChange={(e) => setEntryMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold bg-white"
                >
                  {members
                    .filter((m) => m.is_active)
                    .map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Diễn giải *</label>
              <input
                type="text"
                required
                value={entryDesc}
                onChange={(e) => setEntryDesc(e.target.value)}
                placeholder="VD: Mua 1 ống cầu Hải Yến, đặt cọc sân tháng 12"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={busyKey === 'quick_entry'}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {busyKey === 'quick_entry' ? 'Đang lưu...' : 'Lưu vào Sổ Quỹ'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
