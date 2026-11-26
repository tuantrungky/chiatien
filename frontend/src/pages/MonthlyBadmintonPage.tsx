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
  RotateCcw,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { OverdueBadge } from '../components/OverdueBadge';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  closeMonth,
  confirmPayment,
  issueMonthlyBill,
  markDuePaid,
  saveMonthlyContributions,
} from '../services/api';
import type {
  BootstrapData,
  GuestStatItem,
  GuestStatsData,
  Member,
  MonthlyBillData,
  MonthlyBillDetail,
  ShuttleContributionItem,
} from '../types';
import { formatShortDateVN, getTodayDateStr } from '../utils/dateFilters';
import { calculateDetailedMonthlyBill } from '../utils/monthlyBill';
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

  // Modal Phát hành / Sửa hóa đơn đầu tháng (cho phép sửa toàn bộ)
  const [issueOpen, setIssueOpen] = useState(false);
  const [courtFeeStr, setCourtFeeStr] = useState('0');
  const [tubeQtyStr, setTubeQtyStr] = useState('0');
  const [tubePriceStr, setTubePriceStr] = useState('0');
  const [shuttleAmountOverride, setShuttleAmountOverride] = useState(false);
  const [manualShuttleAmountStr, setManualShuttleAmountStr] = useState('0');
  const [prevOvertimeStr, setPrevOvertimeStr] = useState('0');
  const [venueTotalOverride, setVenueTotalOverride] = useState(false);
  const [manualVenueTotalStr, setManualVenueTotalStr] = useState('0');
  const [carryInStr, setCarryInStr] = useState('0');
  const [appliedCredits, setAppliedCredits] = useState<ShuttleContributionItem[]>([]);
  const [selectedMainIds, setSelectedMainIds] = useState<string[]>([]);

  // Modal Thêm / Sửa danh sách người góp ống cầu trong tháng
  const [contribOpen, setContribOpen] = useState(false);
  const [contribDrafts, setContribDrafts] = useState<ShuttleContributionItem[]>([]);

  // Modal Chốt tháng
  const [closeOpen, setCloseOpen] = useState(false);
  const [overrideCostStr, setOverrideCostStr] = useState('');

  const settings = bootstrap?.settings;
  const members = bootstrap?.members || [];
  const treasurer: Member | undefined = useMemo(
    () => members.find((m) => m.member_id === settings?.treasurer_member_id),
    [members, settings]
  );

  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members]);
  const mainMembers = useMemo(
    () => members.filter((m) => m.is_active && m.type === 'MAIN'),
    [members]
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

  const prevMonthContributions = monthlyBill?.prevMonthContributions || [];

  const openIssueModal = () => {
    const suggestedCourt =
      bill?.court_fee !== undefined && (bill.court_fee > 0 || (bill.estimate ?? 0) > 0)
        ? bill.court_fee
        : monthlyBill?.suggestedEstimateFromSchedule || 0;
    const defaultTubePrice =
      bill?.shuttle_tube_price ||
      (settings?.shuttle_price ? settings.shuttle_price * 12 : 0);

    let parsedDetail: MonthlyBillDetail = {};
    if (bill?.bill_detail) {
      try {
        parsedDetail = JSON.parse(bill.bill_detail) as MonthlyBillDetail;
      } catch {
        parsedDetail = {};
      }
    }

    setCourtFeeStr(String(suggestedCourt));
    setTubeQtyStr(String(bill?.shuttle_tube_qty ?? 0));
    setTubePriceStr(String(defaultTubePrice));
    setShuttleAmountOverride(Boolean(parsedDetail.shuttleAmountOverride));
    setManualShuttleAmountStr(String(bill?.shuttle_tube_amount ?? 0));
    setPrevOvertimeStr(String(bill?.prev_overtime_fee ?? 0));
    setVenueTotalOverride(Boolean(parsedDetail.venueTotalOverride));
    setManualVenueTotalStr(String(bill?.estimate ?? suggestedCourt));
    setCarryInStr(String(bill?.carry_in ?? 0));

    const existingApplied =
      parsedDetail.appliedCredits && parsedDetail.appliedCredits.length > 0
        ? parsedDetail.appliedCredits
        : prevMonthContributions;
    setAppliedCredits(existingApplied.map((c) => ({ ...c })));

    const currentDueMemberIds = dues.map((d) => d.member_id);
    setSelectedMainIds(
      currentDueMemberIds.length > 0
        ? currentDueMemberIds
        : mainMembers.map((m) => m.member_id)
    );
    setIssueOpen(true);
  };

  const issuePreview = useMemo(() => {
    return calculateDetailedMonthlyBill({
      courtFee: Number(courtFeeStr) || 0,
      shuttleTubeQty: Number(tubeQtyStr) || 0,
      shuttleTubePrice: Number(tubePriceStr) || 0,
      shuttleAmountOverride,
      manualShuttleAmount: Number(manualShuttleAmountStr) || 0,
      prevOvertimeFee: Number(prevOvertimeStr) || 0,
      venueTotalOverride,
      manualVenueTotal: Number(manualVenueTotalStr) || 0,
      carryIn: Number(carryInStr) || 0,
      memberIds: selectedMainIds,
      appliedCredits,
      roundingUnit: settings?.rounding_unit || 1000,
      actualCost: bill?.actual_cost || 0,
      guestIncome: bill?.guest_income || 0,
    });
  }, [
    courtFeeStr,
    tubeQtyStr,
    tubePriceStr,
    shuttleAmountOverride,
    manualShuttleAmountStr,
    prevOvertimeStr,
    venueTotalOverride,
    manualVenueTotalStr,
    carryInStr,
    selectedMainIds,
    appliedCredits,
    settings?.rounding_unit,
    bill?.actual_cost,
    bill?.guest_income,
  ]);

  const handleAddAppliedCredit = () => {
    const defaultMember = mainMembers[0] || activeMembers[0];
    if (!defaultMember) return;
    setAppliedCredits((prev) => [
      ...prev,
      {
        id: `CR_${Date.now()}_${prev.length}`,
        member_id: defaultMember.member_id,
        member_name: defaultMember.name,
        tube_qty: 1,
        unit_price: 250000,
        amount: 250000,
        note: 'Góp ống cầu',
      },
    ]);
  };

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
        estimate: issuePreview.venueTotal,
        memberIds: selectedMainIds,
        courtFee: issuePreview.courtFee,
        shuttleTubeQty: issuePreview.shuttleTubeQty,
        shuttleTubePrice: issuePreview.shuttleTubePrice,
        shuttleTubeAmount: issuePreview.shuttleTubeAmount,
        prevOvertimeFee: issuePreview.prevOvertimeFee,
        carryIn: issuePreview.carryIn,
        appliedCredits: appliedCredits
          .filter((c) => c.member_id && c.amount > 0)
          .map((c) => ({
            ...c,
            member_name: membersMap.get(c.member_id)?.name || c.member_name || c.member_id,
          })),
        billDetail: {
          shuttleAmountOverride,
          venueTotalOverride,
          carryInOverride: Number(carryInStr) !== (bill?.carry_in ?? 0),
        },
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

  const openContribModal = () => {
    if (contributions.length > 0) {
      setContribDrafts(contributions.map((c) => ({ ...c })));
    } else {
      const first = mainMembers[0] || activeMembers[0];
      setContribDrafts(
        first
          ? [
              {
                id: `CNT_${Date.now()}`,
                member_id: first.member_id,
                member_name: first.name,
                tube_qty: 1,
                unit_price: 250000,
                amount: 250000,
                note: '',
              },
            ]
          : []
      );
    }
    setContribOpen(true);
  };

  const handleAddContribDraft = () => {
    const first = mainMembers[0] || activeMembers[0];
    if (!first) return;
    setContribDrafts((prev) => [
      ...prev,
      {
        id: `CNT_${Date.now()}_${prev.length}`,
        member_id: first.member_id,
        member_name: first.name,
        tube_qty: 1,
        unit_price: 250000,
        amount: 250000,
        note: '',
      },
    ]);
  };

  const handleSaveContributions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busyKey) return;
    setBusyKey('contrib');
    try {
      const cleaned = contribDrafts
        .filter((c) => c.member_id && (c.amount > 0 || c.tube_qty > 0))
        .map((c) => ({
          ...c,
          member_name: membersMap.get(c.member_id)?.name || c.member_name || c.member_id,
        }));
      await saveMonthlyContributions(idToken, {
        month: activeMonth,
        contributions: cleaned,
      });
      setContribOpen(false);
      await onRefreshAll();
      toast.success(`Đã lưu danh sách góp ống cầu ${formatMonthLabel(activeMonth)}.`);
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
    const suggestedActual =
      bill && bill.actual_cost > 0 ? bill.actual_cost : bill?.estimate ?? 0;
    setOverrideCostStr(String(suggestedActual));
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
              </div>
            </div>

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

      {/* MODAL 1: PHÁT HÀNH / SỬA HÓA ĐƠN THÁNG (TOÀN QUYỀN CHỈNH SỬA THEO CHỦ SÂN) */}
      {issueOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIssueOpen(false)}
        >
          <form
            onSubmit={handleIssueBill}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Phát hành hóa đơn {formatMonthLabel(activeMonth)}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Ưu tiên số chủ sân đưa ra — bạn có thể sửa toàn bộ mọi ô bên dưới
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIssueOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Tiền sân + Ống cầu + Thêm giờ tháng trước */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  1. Chi phí theo báo giá chủ sân
                </span>
                {(monthlyBill?.suggestedEstimateFromSchedule ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCourtFeeStr(String(monthlyBill?.suggestedEstimateFromSchedule || 0))
                    }
                    className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                  >
                    Lấy gợi ý sân ({formatVND(monthlyBill?.suggestedEstimateFromSchedule || 0)})
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tiền sân tháng (VND)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={courtFeeStr}
                  onChange={(e) => setCourtFeeStr(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Số ống cầu
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={tubeQtyStr}
                    onChange={(e) => setTubeQtyStr(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Giá / ống (đ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={tubePriceStr}
                    onChange={(e) => setTubePriceStr(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-600">Tiền ống</label>
                    {shuttleAmountOverride && (
                      <button
                        type="button"
                        onClick={() => setShuttleAmountOverride(false)}
                        className="text-[10px] font-semibold text-blue-600 cursor-pointer"
                      >
                        Tự tính
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={
                      shuttleAmountOverride
                        ? manualShuttleAmountStr
                        : String(issuePreview.calculatedShuttleAmount)
                    }
                    onChange={(e) => {
                      setShuttleAmountOverride(true);
                      setManualShuttleAmountStr(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Tiền thêm giờ tháng trước (VND)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={prevOvertimeStr}
                    onChange={(e) => setPrevOvertimeStr(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-[#113b66]">
                      Tổng tiền chủ sân {venueTotalOverride ? '(Sửa tay)' : '(Tự cộng)'}
                    </label>
                    {venueTotalOverride && (
                      <button
                        type="button"
                        onClick={() => setVenueTotalOverride(false)}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Tự tính</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={
                      venueTotalOverride
                        ? manualVenueTotalStr
                        : String(issuePreview.calculatedVenueTotal)
                    }
                    onChange={(e) => {
                      setVenueTotalOverride(true);
                      setManualVenueTotalStr(e.target.value);
                    }}
                    className="w-full rounded-xl border-2 border-[#1d5fa7] bg-white px-3 py-2 text-sm font-extrabold text-[#113b66]"
                  />
                </div>
              </div>
            </div>

            {/* 2. Dư / thiếu tháng trước & Trừ tiền góp ống cầu */}
            <div className="rounded-2xl bg-amber-50/50 border border-amber-200 p-3.5 space-y-3">
              <span className="block text-xs font-bold text-slate-800">
                2. Bù trừ &amp; Khấu trừ người góp ống cầu tháng trước
              </span>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Dư (+) / thiếu (−) tháng trước chuyển sang (có thể sửa tay)
                </label>
                <input
                  type="number"
                  step={1000}
                  value={carryInStr}
                  onChange={(e) => setCarryInStr(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">
                    Khấu trừ người góp ống cầu ({appliedCredits.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddAppliedCredit}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Thêm trừ góp cầu</span>
                  </button>
                </div>

                {appliedCredits.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    Không có khoản trừ góp ống cầu nào áp dụng cho tháng này.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {appliedCredits.map((cr, idx) => (
                      <div
                        key={cr.id || idx}
                        className="rounded-xl bg-white border border-amber-200 p-2.5 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            value={cr.member_id}
                            onChange={(e) =>
                              setAppliedCredits((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, member_id: e.target.value } : it
                                )
                              )
                            }
                            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                          >
                            {activeMembers.map((m) => (
                              <option key={m.member_id} value={m.member_id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setAppliedCredits((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                            aria-label="Xóa dòng trừ góp cầu"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <label className="block text-[10px] text-slate-500">Số ống</label>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={cr.tube_qty}
                              onChange={(e) => {
                                const qty = Number(e.target.value) || 0;
                                setAppliedCredits((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          tube_qty: qty,
                                          amount: Math.round(qty * (it.unit_price || 0)),
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-500">Giá/ống (đ)</label>
                            <input
                              type="number"
                              min={0}
                              step={1000}
                              value={cr.unit_price}
                              onChange={(e) => {
                                const price = Number(e.target.value) || 0;
                                setAppliedCredits((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          unit_price: price,
                                          amount: Math.round((it.tube_qty || 0) * price),
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-500">Trừ (đ)</label>
                            <input
                              type="number"
                              min={0}
                              step={1000}
                              value={cr.amount}
                              onChange={(e) =>
                                setAppliedCredits((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? { ...it, amount: Number(e.target.value) || 0 }
                                      : it
                                  )
                                )
                              }
                              className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-xs font-extrabold text-amber-900"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Chọn MAIN & Xem trước bảng chia */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                3. Chọn thành viên chính áp dụng ({selectedMainIds.length}/{mainMembers.length})
              </label>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
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
                      className="accent-[#113b66]"
                    />
                    <span className="truncate">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preview kết quả chia */}
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-700">
                <span>Mỗi người phần gốc:</span>
                <span className="text-sm font-extrabold text-emerald-800">
                  {formatVND(issuePreview.perMember)} / người
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>Tổng thực thu về Thủ quỹ:</span>
                <span className="font-bold text-slate-900">
                  {formatVND(issuePreview.billedTotal)} (Cần trả chủ sân:{' '}
                  {formatVND(issuePreview.toCollect)})
                </span>
              </div>
              {issuePreview.memberDues.some((d) => d.creditAmount > 0) && (
                <div className="pt-1 border-t border-emerald-200/80 space-y-1">
                  {issuePreview.memberDues
                    .filter((d) => d.creditAmount > 0)
                    .map((d) => (
                      <div key={d.memberId} className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-blue-900">
                          {membersMap.get(d.memberId)?.name || d.memberId} (đã trừ góp cầu):
                        </span>
                        <span className="font-extrabold text-blue-700">
                          Đóng {formatVND(d.netAmount)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={busyKey === 'issue'}
              className="w-full py-3 rounded-xl bg-[#113b66] hover:bg-[#174676] text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {busyKey === 'issue' ? 'Đang phát hành...' : 'Xác nhận phát hành hóa đơn'}
            </button>
          </form>
        </div>
      )}

      {/* MODAL 2: THÊM / SỬA NGƯỜI GÓP ỐNG CẦU TRONG THÁNG */}
      {contribOpen && isEditor && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setContribOpen(false)}
        >
          <form
            onSubmit={handleSaveContributions}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Người góp ống cầu {formatMonthLabel(activeMonth)}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tự điền giá riêng theo từng loại cầu; sẽ trừ vào tiền đóng tháng tới
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContribOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {contribDrafts.map((c, idx) => (
                <div
                  key={c.id || idx}
                  className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <select
                      value={c.member_id}
                      onChange={(e) =>
                        setContribDrafts((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, member_id: e.target.value } : it
                          )
                        )
                      }
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                    >
                      {activeMembers.map((m) => (
                        <option key={m.member_id} value={m.member_id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setContribDrafts((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-1.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                      aria-label="Xóa người góp cầu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Số ống</label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={c.tube_qty}
                        onChange={(e) => {
                          const qty = Number(e.target.value) || 0;
                          setContribDrafts((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? {
                                    ...it,
                                    tube_qty: qty,
                                    amount: Math.round(qty * (it.unit_price || 0)),
                                  }
                                : it
                            )
                          );
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Giá/ống (đ)</label>
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={c.unit_price}
                        onChange={(e) => {
                          const price = Number(e.target.value) || 0;
                          setContribDrafts((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? {
                                    ...it,
                                    unit_price: price,
                                    amount: Math.round((it.tube_qty || 0) * price),
                                  }
                                : it
                            )
                          );
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Thành tiền</label>
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={c.amount}
                        onChange={(e) =>
                          setContribDrafts((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? { ...it, amount: Number(e.target.value) || 0 }
                                : it
                            )
                          )
                        }
                        className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs font-extrabold text-amber-800"
                      />
                    </div>
                  </div>

                  <input
                    type="text"
                    value={c.note || ''}
                    onChange={(e) =>
                      setContribDrafts((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, note: e.target.value } : it))
                      )
                    }
                    placeholder="Ghi chú loại cầu (VD: Cầu Hải Yến / Lining)..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddContribDraft}
              className="w-full py-2 rounded-xl border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm dòng góp ống cầu</span>
            </button>

            <button
              type="submit"
              disabled={busyKey === 'contrib'}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {busyKey === 'contrib' ? 'Đang lưu...' : 'Lưu danh sách góp ống cầu'}
            </button>
          </form>
        </div>
      )}

      {/* MODAL 3: CHỐT THÁNG */}
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
              Ưu tiên nhập đúng tổng tiền thực tế chủ sân chốt cuối tháng để tính dư/thiếu chuyển
              sang tháng kế tiếp.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tổng chi thực tế theo chủ sân (VND)
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
