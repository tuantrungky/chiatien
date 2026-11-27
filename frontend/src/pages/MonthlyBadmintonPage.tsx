import { useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Lock,
  PackagePlus,
  Plus,
  QrCode,
  Receipt,
  UserCheck,
  Users,
} from 'lucide-react';
import { CloseMonthModal } from '../components/monthly/CloseMonthModal';
import { IssueMonthlyBillModal } from '../components/monthly/IssueMonthlyBillModal';
import { MonthlyContributionsModal } from '../components/monthly/MonthlyContributionsModal';
import { OverdueBadge } from '../components/OverdueBadge';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { confirmPayment, markDuePaid } from '../services/api';
import type {
  BootstrapData,
  GuestStatItem,
  GuestStatsData,
  Member,
  MonthlyBillData,
  ShuttleContributionItem,
} from '../types';
import { formatShortDateVN, getTodayDateStr } from '../utils/dateFilters';
import { getOverdueInfo } from '../utils/overdue';
import { buildTransferContent, buildVietQrUrl, formatVND } from '../utils/vietqr';
import { buildMonthlyBillZaloMessage } from '../utils/zaloShare';

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
  const { isEditor, idToken, myMemberId, handleApiError } = useAuth();
  const toast = useToast();
  const todayStr = getTodayDateStr();

  const [subTab, setSubTab] = useState<'MONTHLY_BILL' | 'GUEST_STATS'>('MONTHLY_BILL');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const settings = bootstrap?.settings;
  const members = bootstrap?.members || [];
  const treasurer: Member | undefined = useMemo(
    () => members.find((m) => m.member_id === settings?.treasurer_member_id),
    [members, settings]
  );

  const membersMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.member_id, m);
    return map;
  }, [members]);

  const bill = monthlyBill?.bill;
  const dues = monthlyBill?.dues || [];
  const contributions = useMemo(() => {
    if (monthlyBill?.contributions && monthlyBill.contributions.length > 0) {
      return monthlyBill.contributions;
    }
    if (bill?.shuttle_contributions) {
      try {
        const parsed = JSON.parse(bill.shuttle_contributions);
        return Array.isArray(parsed) ? (parsed as ShuttleContributionItem[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [monthlyBill, bill]);

  const openIssueModal = () => setIssueOpen(true);
  const openContribModal = () => setContribOpen(true);
  const handleOpenCloseModal = () => setCloseOpen(true);

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

  const paidCount = dues.filter((d) => d.is_paid).length;
  const totalContribAmount = contributions.reduce((sum, c) => sum + (c.amount || 0), 0);
  const totalContribTubes = contributions.reduce((sum, c) => sum + (c.tube_qty || 0), 0);

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('MONTHLY_BILL')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'MONTHLY_BILL'
              ? 'bg-white text-[#113b66] shadow-xs'
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
              ? 'bg-white text-[#113b66] shadow-xs'
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
                <Calculator className="w-4 h-4 text-[#1d5fa7]" />
                <h2 className="text-sm font-bold text-slate-900">
                  Quyết toán {formatMonthLabel(activeMonth)}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {bill && dues.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const msg = buildMonthlyBillZaloMessage({
                        clubName: bootstrap?.settings.club_name || 'Lông Ca Club',
                        month: activeMonth,
                        bill,
                        dues,
                        treasurer,
                        appUrl: window.location.origin,
                      });
                      try {
                        await navigator.clipboard.writeText(msg);
                        toast.success('Đã copy tin nhắn báo thu tháng cho Zalo!');
                      } catch {
                        toast.error('Trình duyệt không cho phép copy tự động.');
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-bold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy báo thu Zalo</span>
                  </button>
                )}
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
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <p className="text-slate-500">Tổng hóa đơn chủ sân</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {formatVND(bill?.estimate ?? 0)}
                </p>
                {(bill?.shuttle_tube_amount || bill?.prev_overtime_fee) ? (
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                    Sân {formatVND(bill?.court_fee ?? 0)}
                    {(bill?.shuttle_tube_amount ?? 0) > 0 &&
                      ` • ${bill?.shuttle_tube_qty || 0} ống (${formatVND(bill?.shuttle_tube_amount ?? 0)})`}
                    {(bill?.prev_overtime_fee ?? 0) > 0 &&
                      ` • Thêm giờ ${formatVND(bill?.prev_overtime_fee ?? 0)}`}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <p className="text-slate-500">Bù trừ tháng trước</p>
                <p
                  className={`text-sm font-extrabold mt-0.5 ${
                    (bill?.carry_in ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {(bill?.carry_in ?? 0) >= 0 ? '+' : ''}
                  {formatVND(bill?.carry_in ?? 0)}
                </p>
                {(bill?.applied_credits_total ?? 0) > 0 && (
                  <p className="text-[10px] text-blue-700 font-semibold mt-0.5">
                    Trừ góp cầu: {formatVND(bill?.applied_credits_total ?? 0)}
                  </p>
                )}
              </div>

              <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-200">
                <p className="text-emerald-800">Mỗi MAIN (phần gốc)</p>
                <p className="text-base font-extrabold text-emerald-700 mt-0.5">
                  {formatVND(bill?.per_member ?? 0)}
                </p>
                <p className="text-[10px] text-emerald-700">
                  {bill?.member_count ?? 0} MAIN • Thực thu {formatVND(bill?.billed_total ?? 0)}
                </p>
              </div>

              <div className="rounded-xl bg-blue-50 p-2.5 border border-blue-200">
                <p className="text-blue-800">Chuyển sang tháng sau</p>
                <p
                  className={`text-base font-extrabold mt-0.5 ${
                    (bill?.carry_out ?? 0) >= 0 ? 'text-blue-700' : 'text-rose-600'
                  }`}
                >
                  {(bill?.carry_out ?? 0) >= 0 ? '+' : ''}
                  {formatVND(bill?.carry_out ?? 0)}
                </p>
                <p className="text-[10px] text-blue-700 leading-snug">
                  {bill?.is_projected_cost
                    ? `Chi dự kiến (chủ sân): ${formatVND(bill?.actual_cost ?? 0)}`
                    : `Chi: ${formatVND(bill?.actual_cost ?? 0)}`}{' '}
                  • VL thu: {formatVND(bill?.guest_income ?? 0)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                  Sân thêm giờ phát sinh (nếu có) sẽ được cộng vào hóa đơn tháng sau.
                </p>
              </div>
            </div>

            {((monthlyBill?.refundCredits?.length ?? 0) > 0 || (bill?.refund_credits_total ?? 0) > 0) && (
              <div className="rounded-xl bg-amber-50/80 border border-amber-200 px-3 py-2 text-xs space-y-1">
                <p className="font-bold text-amber-900">
                  Khoản Thủ quỹ hoàn riêng cho người góp cầu không đánh MAIN ({formatVND(bill?.refund_credits_total ?? 0)}):
                </p>
                {(monthlyBill?.refundCredits || []).map((r) => (
                  <p key={r.id} className="text-[11px] text-amber-800">
                    • <span className="font-semibold">{r.member_name || r.member_id}</span>:{' '}
                    <span className="font-bold">{formatVND(r.amount)}</span>
                  </p>
                ))}
              </div>
            )}

            {isEditor && (
              <div className="flex gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={openIssueModal}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[#113b66] hover:bg-[#174676] text-white text-xs font-bold cursor-pointer"
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

          {/* Card Người góp ống cầu trong tháng (tự trừ vào đầu tháng tới) */}
          <section className="bg-white rounded-2xl border border-amber-200/90 p-4 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <PackagePlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Người góp ống cầu trong {formatMonthLabel(activeMonth)}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Tự động trừ vào tiền đóng đầu tháng tới của người góp (giá tùy nhập)
                  </p>
                </div>
              </div>

              {isEditor && (
                <button
                  type="button"
                  onClick={openContribModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{contributions.length > 0 ? 'Sửa góp cầu' : 'Thêm người góp cầu'}</span>
                </button>
              )}
            </div>

            {contributions.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                Chưa có thành viên nào góp ống cầu riêng trong {formatMonthLabel(activeMonth)}.
              </p>
            ) : (
              <div className="space-y-1.5">
                {contributions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-amber-50/60 border border-amber-100 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">
                        {c.member_name || membersMap.get(c.member_id)?.name || c.member_id}
                        <span className="font-medium text-slate-600 ml-1.5">
                          • {c.tube_qty} ống × {formatVND(c.unit_price)}
                        </span>
                      </p>
                      {c.note && <p className="text-[11px] text-slate-500 truncate">{c.note}</p>}
                    </div>
                    <span className="font-extrabold text-amber-800 shrink-0">
                      {formatVND(c.amount)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1 px-1 text-slate-600">
                  <span>Tổng góp trong tháng ({totalContribTubes} ống):</span>
                  <span className="font-extrabold text-slate-900">
                    {formatVND(totalContribAmount)}
                  </span>
                </div>
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
                {dues.map((d) => {
                  const hasCredit = (d.credit_amount ?? 0) > 0;
                  const baseAmt = d.base_amount ?? d.amount;
                  const isMine = myMemberId === d.member_id;
                  const dueDateRef = d.issued_at || `${activeMonth}-01`;
                  const ov = !d.is_paid ? getOverdueInfo(dueDateRef, todayStr) : null;
                  return (
                    <div
                      key={d.due_id}
                      className={`px-4 py-3 flex items-center justify-between gap-2.5 flex-wrap ${
                        ov?.rowClass || (isMine ? 'bg-sky-50/40' : '')
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {d.is_paid ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        ) : (
                          <Clock className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {d.member_name}
                            </p>
                            {isMine && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                                Bạn
                              </span>
                            )}
                            {hasCredit && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                                Đã trừ góp cầu
                              </span>
                            )}
                            {!d.is_paid && <OverdueBadge fromDate={dueDateRef} todayStr={todayStr} />}
                          </div>
                          <p className="text-xs text-slate-500">
                            {d.is_paid
                              ? `Đã đóng ${formatVND(d.amount)}`
                              : `Cần đóng ${formatVND(d.amount)}`}
                            {hasCredit &&
                              ` (Gốc ${formatVND(baseAmt)} − Trừ ${formatVND(d.credit_amount ?? 0)})`}
                          </p>
                          {d.credit_note && (
                            <p className="text-[11px] text-blue-700 truncate">{d.credit_note}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!d.is_paid && d.amount > 0 && (
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
              <p className="text-[11px] text-slate-500">
                Đã thu (buổi T.{activeMonth.slice(5, 7)})
              </p>
              <p className="text-sm sm:text-base font-extrabold text-emerald-700 mt-1">
                {formatVND(guestStats?.summary.totalPaid ?? 0)}
              </p>
              {guestStats?.summary.collectedInMonthAmount !== undefined &&
                guestStats.summary.collectedInMonthAmount !== guestStats.summary.totalPaid && (
                  <p className="text-[10px] font-semibold text-blue-700 mt-0.5 leading-snug">
                    Thực thu quỹ T.{activeMonth.slice(5, 7)}:{' '}
                    {formatVND(guestStats.summary.collectedInMonthAmount)}
                  </p>
                )}
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
                  const oldestUnpaidDate = hasDebt
                    ? g.sessions
                        .filter((s) => !s.isPaid)
                        .map((s) => s.date)
                        .sort()[0] || [...g.dates].sort()[0]
                    : '';
                  const ov = hasDebt && oldestUnpaidDate ? getOverdueInfo(oldestUnpaidDate, todayStr) : null;
                  return (
                    <div key={g.memberId} className={`p-4 space-y-2.5 ${ov?.rowClass || ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900">{g.name}</h3>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                              {g.sessionCount} buổi
                            </span>
                            {hasDebt && oldestUnpaidDate && (
                              <OverdueBadge fromDate={oldestUnpaidDate} todayStr={todayStr} />
                            )}
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

      {/* MODAL 1: PHÁT HÀNH / SỬA HÓA ĐƠN THÁNG */}
      {issueOpen && isEditor && (
        <IssueMonthlyBillModal
          activeMonth={activeMonth}
          todayStr={todayStr}
          monthlyBill={monthlyBill}
          settings={settings}
          members={members}
          onClose={() => setIssueOpen(false)}
          onSuccess={onRefreshAll}
        />
      )}

      {/* MODAL 2: THÊM / SỬA NGƯỜI GÓP ỐNG CẦU TRONG THÁNG */}
      {contribOpen && isEditor && (
        <MonthlyContributionsModal
          activeMonth={activeMonth}
          contributions={contributions}
          members={members}
          onClose={() => setContribOpen(false)}
          onSuccess={onRefreshAll}
        />
      )}

      {/* MODAL 3: CHỐT THÁNG */}
      {closeOpen && isEditor && (
        <CloseMonthModal
          activeMonth={activeMonth}
          defaultCarryOut={bill?.carry_out ?? 0}
          onClose={() => setCloseOpen(false)}
          onSuccess={onRefreshAll}
        />
      )}
    </div>
  );
}
