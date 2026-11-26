import { useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  QrCode,
  Receipt,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { closeMonth, confirmPayment, issueMonthlyBill, markDuePaid } from '../services/api';
import type {
  BootstrapData,
  GuestStatItem,
  GuestStatsData,
  Member,
  MonthlyBillData,
} from '../types';
import { formatShortDateVN } from '../utils/dateFilters';
import { calculateMonthlyBill } from '../utils/monthlyBill';
import { buildTransferContent, buildVietQrUrl, formatVND } from '../utils/vietqr';

interface MonthlyBadmintonPageProps {
  bootstrap: BootstrapData | null;
  monthlyBill: MonthlyBillData | null;
  guestStats: GuestStatsData | null;
  activeMonth: string;
  onChangeMonth: (month: string) => void;
  onOpenQr: (data: VietQRModalData) => void;
  onRefreshAll: () => Promise<boolean>;
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

export function MonthlyBadmintonPage({
  bootstrap,
  monthlyBill,
  guestStats,
  activeMonth,
  onChangeMonth,
  onOpenQr,
  onRefreshAll,
}: MonthlyBadmintonPageProps) {
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();

  const [subTab, setSubTab] = useState<'MONTHLY_BILL' | 'GUEST_STATS'>('MONTHLY_BILL');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Modal Phát hành / Sửa hóa đơn đầu tháng
  const [issueOpen, setIssueOpen] = useState(false);
  const [estimateStr, setEstimateStr] = useState('');
  const [selectedMainIds, setSelectedMainIds] = useState<string[]>([]);

  // Modal Chốt tháng
  const [closeOpen, setCloseOpen] = useState(false);
  const [overrideCostStr, setOverrideCostStr] = useState('');

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

  const openIssueModal = () => {
    const suggested =
      monthlyBill?.bill.estimate || monthlyBill?.suggestedEstimateFromSchedule || 0;
    setEstimateStr(String(suggested));
    const currentDueMemberIds = monthlyBill?.dues.map((d) => d.member_id) || [];
    setSelectedMainIds(
      currentDueMemberIds.length > 0
        ? currentDueMemberIds
        : mainMembers.map((m) => m.member_id)
    );
    setIssueOpen(true);
  };

  const issuePreview = useMemo(() => {
    return calculateMonthlyBill({
      estimate: Number(estimateStr) || 0,
      carryIn: monthlyBill?.bill.carry_in || 0,
      memberCount: selectedMainIds.length,
      roundingUnit: settings?.rounding_unit || 1000,
    });
  }, [estimateStr, monthlyBill, selectedMainIds.length, settings?.rounding_unit]);

  const handleIssueBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busyKey) return;
    if (selectedMainIds.length === 0) {
      toast.error('Cần chọn ít nhất 1 thành viên MAIN.');
      return;
    }

    setBusyKey('issue');
    try {
      await issueMonthlyBill(idToken, {
        month: activeMonth,
        estimate: Math.max(0, Math.round(Number(estimateStr) || 0)),
        memberIds: selectedMainIds,
      });
      setIssueOpen(false);
      await onRefreshAll();
      toast.success(`Đã phát hành hóa đơn ${formatMonthLabel(activeMonth)}.`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleDuePaid = async (dueId: string, nextPaid: boolean, memberName: string) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(dueId);
    try {
      await markDuePaid(idToken, { dueId, isPaid: nextPaid });
      await onRefreshAll();
      toast.success(
        nextPaid
          ? `Đã xác nhận ${memberName} đóng tiền cầu tháng.`
          : `Đã bỏ đánh dấu đóng tiền của ${memberName}.`
      );
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenCloseModal = () => {
    setOverrideCostStr(String(monthlyBill?.bill.actual_cost || 0));
    setCloseOpen(true);
  };

  const handleCloseMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busyKey) return;
    setBusyKey('close');
    try {
      const overrideVal =
        overrideCostStr.trim() === '' ? null : Math.max(0, Math.round(Number(overrideCostStr) || 0));
      await closeMonth(idToken, {
        month: activeMonth,
        actualCostOverride: overrideVal,
      });
      setCloseOpen(false);
      await onRefreshAll();
      toast.success(`Đã chốt ${formatMonthLabel(activeMonth)} và chuyển dư sang tháng sau!`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmGuestAllPaid = async (g: GuestStatItem) => {
    if (!isEditor || !idToken || busyKey) return;
    const unpaidIds = g.sessions.filter((s) => !s.isPaid).map((s) => s.attendanceId);
    if (unpaidIds.length === 0) return;

    setBusyKey(g.memberId);
    try {
      await confirmPayment(idToken, {
        category: 'BADMINTON',
        mode: 'ITEMS',
        fromMemberId: g.memberId,
        toMemberId: settings?.treasurer_member_id || '',
        attendanceIds: unpaidIds,
        amount: g.totalUnpaid,
        method: 'CASH',
        note: `Thu đủ vãng lai tháng ${activeMonth}`,
      });
      await onRefreshAll();
      toast.success(`Đã thu đủ ${formatVND(g.totalUnpaid)} của ${g.name}.`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusyKey(null);
    }
  };

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

  const bill = monthlyBill?.bill;
  const dues = monthlyBill?.dues || [];
  const paidCount = dues.filter((d) => d.is_paid).length;

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('MONTHLY_BILL')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'MONTHLY_BILL'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Hóa đơn tháng (MAIN)</span>
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

      {/* Bộ chọn tháng */}
      <div className="bg-white rounded-2xl border border-slate-200 px-3 py-2.5 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={() => onChangeMonth(shiftMonthStr(activeMonth, -1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-[11px] text-slate-400 font-medium">Tháng tính cầu lông</p>
          <p className="text-sm font-bold text-slate-900">{formatMonthLabel(activeMonth)}</p>
        </div>
        <button
          type="button"
          onClick={() => onChangeMonth(shiftMonthStr(activeMonth, 1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* TAB 1: HÓA ĐƠN THÁNG CẦU LÔNG */}
      {subTab === 'MONTHLY_BILL' && (
        <div className="space-y-4">
          {/* Bảng tính công thức tháng */}
          <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Quyết toán {formatMonthLabel(activeMonth)}
                </h2>
              </div>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  bill?.status === 'CLOSED'
                    ? 'bg-slate-900 text-white'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {bill?.status === 'CLOSED' ? 'Đã chốt tháng' : 'Đang mở'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <p className="text-slate-500">Dự toán đầu tháng</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {formatVND(bill?.estimate ?? 0)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <p className="text-slate-500">Dư / thiếu tháng trước</p>
                <p
                  className={`text-sm font-extrabold mt-0.5 ${
                    (bill?.carry_in ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {(bill?.carry_in ?? 0) >= 0 ? '+' : ''}
                  {formatVND(bill?.carry_in ?? 0)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-200">
                <p className="text-emerald-800">Mỗi MAIN đóng</p>
                <p className="text-base font-extrabold text-emerald-700 mt-0.5">
                  {formatVND(bill?.per_member ?? 0)}
                </p>
                <p className="text-[10px] text-emerald-700">
                  {bill?.member_count ?? 0} MAIN • Cần thu {formatVND(bill?.to_collect ?? 0)}
                </p>
              </div>
              <div className="rounded-xl bg-blue-50 p-2.5 border border-blue-200">
                <p className="text-blue-800">Dư chuyển tháng sau</p>
                <p
                  className={`text-base font-extrabold mt-0.5 ${
                    (bill?.carry_out ?? 0) >= 0 ? 'text-blue-700' : 'text-rose-600'
                  }`}
                >
                  {(bill?.carry_out ?? 0) >= 0 ? '+' : ''}
                  {formatVND(bill?.carry_out ?? 0)}
                </p>
                <p className="text-[10px] text-blue-700">
                  Chi: {formatVND(bill?.actual_cost ?? 0)} • VL thu: {formatVND(bill?.guest_income ?? 0)}
                </p>
              </div>
            </div>

            {isEditor && (
              <div className="flex gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={openIssueModal}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  <Calculator className="w-4 h-4" />
                  <span>{dues.length > 0 ? 'Sửa / Chia lại tháng' : 'Phát hành hóa đơn tháng'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenCloseModal}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Chốt tháng</span>
                </button>
              </div>
            )}
          </section>

          {/* Danh sách đóng tiền tháng của MAIN */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Thành viên chính ({dues.length})
                </h3>
                <p className="text-xs text-slate-500">Chuyển thẳng về Thủ quỹ {treasurer?.name || ''}</p>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                {paidCount}/{dues.length} đã đóng
              </span>
            </div>

            {dues.length === 0 ? (
              <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
                Chưa phát hành hóa đơn cho {formatMonthLabel(activeMonth)}.
                {isEditor && ' Bấm "Phát hành hóa đơn tháng" ở trên để tính & chia cho MAIN.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dues.map((d) => (
                  <div
                    key={d.due_id}
                    className="px-4 py-3 flex items-center justify-between gap-2.5 flex-wrap"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {d.is_paid ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="w-5 h-5 text-rose-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {d.member_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {d.is_paid
                            ? `Đã đóng ${formatVND(d.amount)}`
                            : `Cần đóng ${formatVND(d.amount)}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!d.is_paid && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenQr({
                              title: `${d.member_name} → Thủ quỹ (${treasurer?.name || 'Thủ quỹ'})`,
                              subtitle: `Tiền cầu ${formatMonthLabel(activeMonth)}`,
                              amount: d.amount,
                              transferContent: d.transferContent,
                              bankName: treasurer?.bank_name || '',
                              bankBin: treasurer?.bank_bin || '',
                              accountNo: treasurer?.account_no || '',
                              accountName: treasurer?.account_name || treasurer?.name || '',
                              vietQrUrl: d.vietQrUrl,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>VietQR</span>
                        </button>
                      )}

                      {isEditor ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleDuePaid(d.due_id, !d.is_paid, d.member_name)}
                          disabled={Boolean(busyKey)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 ${
                            d.is_paid
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          {busyKey === d.due_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>{d.is_paid ? 'Đã đóng' : 'Đã thu'}</span>
                        </button>
                      ) : (
                        d.is_paid && (
                          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                            Hoàn tất
                          </span>
                        )
                      )}
                    </div>
                  </div>
                ))}
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
              <p className="text-[11px] text-slate-500">Đã thu (trừ T.sau)</p>
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
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Chi tiết Vãng lai {formatMonthLabel(activeMonth)}
              </h2>
            </div>

            {!guestStats || guestStats.guests.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Không có khách vãng lai nào tham gia trong {formatMonthLabel(activeMonth)}.
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
                                  `vang lai T${activeMonth.slice(5, 7)}`
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

      {/* Modal Phát hành hóa đơn tháng */}
      {issueOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIssueOpen(false)}
        >
          <form
            onSubmit={handleIssueBill}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Phát hành hóa đơn {formatMonthLabel(activeMonth)}
              </h3>
              <button
                type="button"
                onClick={() => setIssueOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Dự toán tháng (tiền sân + hộp cầu báo với chủ sân)
              </label>
              <input
                type="number"
                min={0}
                step={10000}
                required
                value={estimateStr}
                onChange={(e) => setEstimateStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
              {monthlyBill && monthlyBill.suggestedEstimateFromSchedule > 0 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Gợi ý tiền sân từ lịch tháng: {formatVND(monthlyBill.suggestedEstimateFromSchedule)}
                </p>
              )}
            </div>

            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
              <p>
                Dư tháng trước chuyển sang:{' '}
                <span className="font-bold">{formatVND(issuePreview.carryIn)}</span>
              </p>
              <p>
                Cần thu thêm: <span className="font-bold">{formatVND(issuePreview.toCollect)}</span>
              </p>
              <p className="text-sm font-extrabold text-emerald-800 pt-0.5">
                Mỗi người đóng: {formatVND(issuePreview.perMember)} ({selectedMainIds.length} người)
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Chọn thành viên chính áp dụng ({selectedMainIds.length}/{mainMembers.length})
              </label>
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                {mainMembers.map((m) => (
                  <label
                    key={m.member_id}
                    className="flex items-center gap-2 text-xs font-semibold bg-slate-50 px-2.5 py-2 rounded-lg cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMainIds.includes(m.member_id)}
                      onChange={() =>
                        setSelectedMainIds((prev) =>
                          prev.includes(m.member_id)
                            ? prev.filter((id) => id !== m.member_id)
                            : [...prev, m.member_id]
                        )
                      }
                      className="accent-emerald-600"
                    />
                    <span className="truncate">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busyKey === 'issue'}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {busyKey === 'issue' ? 'Đang phát hành...' : 'Xác nhận phát hành hóa đơn'}
            </button>
          </form>
        </div>
      )}

      {/* Modal Chốt tháng */}
      {closeOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setCloseOpen(false)}
        >
          <form
            onSubmit={handleCloseMonth}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Chốt {formatMonthLabel(activeMonth)}
              </h3>
              <button
                type="button"
                onClick={() => setCloseOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Tổng chi thực tế sẽ tự trừ vào tiền đã thu + tiền vãng lai để chuyển phần dư/thiếu sang tháng kế tiếp.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tổng chi thực tế (VND)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={overrideCostStr}
                onChange={(e) => setOverrideCostStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <button
              type="submit"
              disabled={busyKey === 'close'}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {busyKey === 'close' ? 'Đang chốt tháng...' : 'Chốt & Chuyển dư sang tháng sau'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
