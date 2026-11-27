import { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { issueMonthlyBill } from '../../services/api';
import type {
  Member,
  MonthlyBillData,
  MonthlyBillDetail,
  SettingsMap,
  ShuttleContributionItem,
} from '../../types';
import { formatDateVN } from '../../utils/dateFilters';
import { calculateDetailedMonthlyBill } from '../../utils/monthlyBill';
import { calculateDurationHours, generateMonthScheduleDates } from '../../utils/schedule';
import { formatVND } from '../../utils/vietqr';

const ISSUE_WEEKDAY_OPTIONS = [
  { val: 1, label: 'T2' },
  { val: 2, label: 'T3' },
  { val: 3, label: 'T4' },
  { val: 4, label: 'T5' },
  { val: 5, label: 'T6' },
  { val: 6, label: 'T7' },
  { val: 0, label: 'CN' },
];

export interface IssueMonthlyBillModalProps {
  activeMonth: string;
  todayStr: string;
  monthlyBill: MonthlyBillData | null;
  settings: SettingsMap | undefined;
  members: Member[];
  onClose: () => void;
  onSuccess: () => Promise<boolean | void>;
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  return `Tháng ${m}/${y}`;
}

function buildInitialIssueState(
  monthlyBill: MonthlyBillData | null,
  settings: SettingsMap | undefined,
  members: Member[],
  activeMonth: string,
  todayStr: string
) {
  const bill = monthlyBill?.bill;
  const dues = monthlyBill?.dues || [];
  const prevMonthContributions = monthlyBill?.prevMonthContributions || [];
  const mainMembers = members.filter((m) => m.is_active && m.type === 'MAIN');

  const suggestedCourt =
    bill?.court_fee !== undefined && (bill.court_fee > 0 || (bill.estimate ?? 0) > 0)
      ? bill.court_fee
      : monthlyBill?.suggestedEstimateFromSchedule || 0;
  const defaultTubePrice =
    bill?.shuttle_tube_price || (settings?.shuttle_price ? settings.shuttle_price * 12 : 0);

  let parsedDetail: MonthlyBillDetail = {};
  if (bill?.bill_detail) {
    try {
      parsedDetail = JSON.parse(bill.bill_detail) as MonthlyBillDetail;
    } catch {
      parsedDetail = {};
    }
  }

  const initialPrevOvertime =
    bill?.prev_overtime_fee && bill.prev_overtime_fee > 0
      ? bill.prev_overtime_fee
      : dues.length === 0
      ? monthlyBill?.suggestedPrevOvertime ?? 0
      : 0;

  const hasSavedCredits = Array.isArray(parsedDetail.appliedCredits);
  const existingApplied =
    dues.length > 0 || hasSavedCredits ? parsedDetail.appliedCredits || [] : prevMonthContributions;

  const currentDueMemberIds = dues.map((d) => d.member_id);

  return {
    courtFeeStr: String(suggestedCourt),
    tubeQtyStr: String(bill?.shuttle_tube_qty ?? 0),
    tubePriceStr: String(defaultTubePrice),
    shuttleAmountOverride: Boolean(parsedDetail.shuttleAmountOverride),
    manualShuttleAmountStr: String(bill?.shuttle_tube_amount ?? 0),
    prevOvertimeStr: String(initialPrevOvertime),
    venueTotalOverride: Boolean(parsedDetail.venueTotalOverride),
    manualVenueTotalStr: String(bill?.estimate ?? suggestedCourt),
    carryInStr: String(bill?.carry_in ?? 0),
    appliedCredits: existingApplied.map((c) => ({ ...c })),
    selectedMainIds:
      currentDueMemberIds.length > 0
        ? currentDueMemberIds
        : mainMembers.map((m) => m.member_id),
    schedCourts: String(settings?.default_court_count || 2),
    schedOnlyFromToday: activeMonth === todayStr.slice(0, 7),
  };
}

/** Modal phát hành hoặc cập nhật hóa đơn cầu lông đầu tháng. */
export function IssueMonthlyBillModal({
  activeMonth,
  todayStr,
  monthlyBill,
  settings,
  members,
  onClose,
  onSuccess,
}: IssueMonthlyBillModalProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();

  const initial = useMemo(
    () => buildInitialIssueState(monthlyBill, settings, members, activeMonth, todayStr),
    // Chỉ khởi tạo snapshot lúc mount modal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [courtFeeStr, setCourtFeeStr] = useState(initial.courtFeeStr);
  const [tubeQtyStr, setTubeQtyStr] = useState(initial.tubeQtyStr);
  const [tubePriceStr, setTubePriceStr] = useState(initial.tubePriceStr);
  const [shuttleAmountOverride, setShuttleAmountOverride] = useState(initial.shuttleAmountOverride);
  const [manualShuttleAmountStr, setManualShuttleAmountStr] = useState(
    initial.manualShuttleAmountStr
  );
  const [prevOvertimeStr, setPrevOvertimeStr] = useState(initial.prevOvertimeStr);
  const [venueTotalOverride, setVenueTotalOverride] = useState(initial.venueTotalOverride);
  const [manualVenueTotalStr, setManualVenueTotalStr] = useState(initial.manualVenueTotalStr);
  const [carryInStr, setCarryInStr] = useState(initial.carryInStr);
  const [appliedCredits, setAppliedCredits] = useState<ShuttleContributionItem[]>(
    initial.appliedCredits
  );
  const [selectedMainIds, setSelectedMainIds] = useState<string[]>(initial.selectedMainIds);
  const [memberSearch, setMemberSearch] = useState('');
  const [includeSchedule, setIncludeSchedule] = useState(false);
  const [schedWeekdays, setSchedWeekdays] = useState<number[]>([1, 3, 5]);
  const [schedStartTime, setSchedStartTime] = useState('20:00');
  const [schedEndTime, setSchedEndTime] = useState('21:30');
  const [schedCourts, setSchedCourts] = useState(initial.schedCourts);
  const [schedOnlyFromToday, setSchedOnlyFromToday] = useState(initial.schedOnlyFromToday);
  const [busy, setBusy] = useState(false);

  const bill = monthlyBill?.bill;
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

  const sortedActiveMembers = useMemo(
    () =>
      [...activeMembers].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'MAIN' ? -1 : 1;
        return a.name.localeCompare(b.name, 'vi');
      }),
    [activeMembers]
  );

  const filteredIssueMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return sortedActiveMembers;
    return sortedActiveMembers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.aliases.toLowerCase().includes(q)
    );
  }, [sortedActiveMembers, memberSearch]);

  const roleChangeCounts = useMemo(() => {
    const selectedSet = new Set(selectedMainIds);
    let toMain = 0;
    let toGuest = 0;
    for (const m of activeMembers) {
      const checked = selectedSet.has(m.member_id);
      if (checked && m.type !== 'MAIN') toMain++;
      if (!checked && m.type === 'MAIN') toGuest++;
    }
    return { toMain, toGuest };
  }, [activeMembers, selectedMainIds]);

  const schedDatesPreview = useMemo(
    () =>
      includeSchedule
        ? generateMonthScheduleDates(
            activeMonth,
            schedWeekdays,
            schedOnlyFromToday ? todayStr : undefined
          )
        : [],
    [includeSchedule, activeMonth, schedWeekdays, schedOnlyFromToday, todayStr]
  );

  const schedSuggestedCourtFee = useMemo(() => {
    const hours = calculateDurationHours(schedStartTime, schedEndTime);
    const courtsNum = Math.max(1, Number(schedCourts) || 2);
    const price = settings?.court_price_per_hour || 0;
    if (!includeSchedule || hours <= 0 || price <= 0) return 0;
    return Math.round(schedDatesPreview.length * courtsNum * hours * price);
  }, [
    includeSchedule,
    schedDatesPreview.length,
    schedStartTime,
    schedEndTime,
    schedCourts,
    settings?.court_price_per_hour,
  ]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    if (selectedMainIds.length === 0) {
      toast.error('Cần chọn ít nhất 1 thành viên đóng tiền tháng.');
      return;
    }
    if (includeSchedule && schedWeekdays.length === 0) {
      toast.error('Hãy chọn ít nhất 1 thứ trong tuần hoặc tắt mục Đặt lịch.');
      return;
    }

    setBusy(true);
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
        syncMemberTypes: true,
        scheduleConfig: includeSchedule
          ? {
              weekdays: schedWeekdays,
              startTime: schedStartTime,
              endTime: schedEndTime,
              courts: Math.max(1, Number(schedCourts) || 2),
              fromDate: schedOnlyFromToday ? todayStr : undefined,
            }
          : undefined,
      });
      onClose();
      await onSuccess();
      toast.success(
        `Đã phát hành hóa đơn ${formatMonthLabel(activeMonth)}${
          includeSchedule ? ' & đặt lịch tháng' : ''
        }.`
      );
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
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
            onClick={onClose}
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-600">
                  Tiền thêm giờ tháng trước (VND)
                </label>
                {(monthlyBill?.suggestedPrevOvertime ?? 0) > 0 &&
                  Number(prevOvertimeStr || 0) !== (monthlyBill?.suggestedPrevOvertime ?? 0) && (
                    <button
                      type="button"
                      onClick={() =>
                        setPrevOvertimeStr(String(monthlyBill?.suggestedPrevOvertime ?? 0))
                      }
                      className="text-[10px] font-semibold text-blue-600 cursor-pointer"
                    >
                      Dùng gợi ý ({formatVND(monthlyBill?.suggestedPrevOvertime ?? 0)})
                    </button>
                  )}
              </div>
              <input
                type="number"
                min={0}
                step={1000}
                value={prevOvertimeStr}
                onChange={(e) => setPrevOvertimeStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
              />
              {(monthlyBill?.suggestedPrevOvertime ?? 0) > 0 && (
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Gợi ý từ Sân thêm giờ T.trước: {formatVND(monthlyBill?.suggestedPrevOvertime ?? 0)}
                </p>
              )}
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
                                i === idx ? { ...it, amount: Number(e.target.value) || 0 } : it
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

        {/* 3. Chọn thành viên đóng tháng (tích -> Chính, bỏ tích -> Vãng lai) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                3. Chọn thành viên đóng tháng ({selectedMainIds.length}/{activeMembers.length})
              </label>
              <p className="text-[11px] text-slate-500">
                Người được tích thành <strong>Thành viên chính</strong>, bỏ tích tự chuyển sang{' '}
                <strong>Vãng lai</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedMainIds(mainMembers.map((m) => m.member_id))}
              className="text-[11px] font-semibold text-[#1d5fa7] hover:underline cursor-pointer"
            >
              Chỉ chọn Chính hiện tại
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Tìm nhanh thành viên..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1d5fa7]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
            {filteredIssueMembers.map((m) => {
              const isChecked = selectedMainIds.includes(m.member_id);
              const wasMain = m.type === 'MAIN';
              const badge =
                !wasMain && isChecked
                  ? { text: 'VL → Chính', cls: 'bg-sky-100 text-sky-800' }
                  : wasMain && !isChecked
                  ? { text: 'Chính → VL', cls: 'bg-amber-100 text-amber-800' }
                  : wasMain
                  ? { text: 'Chính', cls: 'bg-emerald-50 text-emerald-700' }
                  : { text: 'Vãng lai', cls: 'bg-slate-100 text-slate-500' };

              return (
                <label
                  key={m.member_id}
                  className={`flex items-center justify-between gap-2 text-xs font-semibold px-2.5 py-2 rounded-lg border cursor-pointer transition ${
                    isChecked
                      ? 'bg-sky-50/70 border-sky-200 text-slate-900'
                      : 'bg-slate-50 border-slate-200/70 text-slate-600'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        setSelectedMainIds((prev) =>
                          prev.includes(m.member_id)
                            ? prev.filter((id) => id !== m.member_id)
                            : [...prev, m.member_id]
                        )
                      }
                      className="accent-[#113b66] shrink-0"
                    />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${badge.cls}`}>
                    {badge.text}
                  </span>
                </label>
              );
            })}
          </div>

          {(roleChangeCounts.toMain > 0 || roleChangeCounts.toGuest > 0) && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 flex items-center gap-2 flex-wrap">
              <span>Khi xác nhận sẽ tự cập nhật:</span>
              {roleChangeCounts.toMain > 0 && (
                <span className="font-bold text-sky-800">
                  +{roleChangeCounts.toMain} người sang Chính
                </span>
              )}
              {roleChangeCounts.toGuest > 0 && (
                <span className="font-bold text-amber-800">
                  {roleChangeCounts.toGuest} người sang Vãng lai
                </span>
              )}
            </div>
          )}
        </div>

        {/* 4. Đặt lịch cầu lông tháng này (không bắt buộc) */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <CalendarIcon className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>4. Đặt lịch đánh cầu tháng này (không bắt buộc)</span>
            </span>
            <input
              type="checkbox"
              checked={includeSchedule}
              onChange={(e) => setIncludeSchedule(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
          </label>

          {includeSchedule && (
            <div className="space-y-2.5 pt-2 border-t border-slate-200">
              <div>
                <p className="text-[11px] font-semibold text-slate-600 mb-1">
                  Chọn ngày đánh trong tuần
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {ISSUE_WEEKDAY_OPTIONS.map((opt) => {
                    const active = schedWeekdays.includes(opt.val);
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() =>
                          setSchedWeekdays((prev) =>
                            prev.includes(opt.val)
                              ? prev.filter((x) => x !== opt.val)
                              : [...prev, opt.val]
                          )
                        }
                        className={`py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                          active
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
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
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Bắt đầu
                  </label>
                  <input
                    type="time"
                    value={schedStartTime}
                    onChange={(e) => setSchedStartTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Kết thúc
                  </label>
                  <input
                    type="time"
                    value={schedEndTime}
                    onChange={(e) => setSchedEndTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Số sân
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={schedCourts}
                    onChange={(e) => setSchedCourts(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedOnlyFromToday}
                  onChange={(e) => setSchedOnlyFromToday(e.target.checked)}
                  className="accent-emerald-600"
                />
                <span>Chỉ tạo từ hôm nay ({formatDateVN(todayStr)}) trở đi</span>
              </label>

              <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-slate-600 bg-white rounded-xl px-2.5 py-2 border border-slate-200">
                <span>
                  Sẽ tạo tối đa <strong className="text-emerald-700">{schedDatesPreview.length} buổi</strong>{' '}
                  (gắn {selectedMainIds.length} thành viên chính)
                </span>
                {schedSuggestedCourtFee > 0 && (
                  <button
                    type="button"
                    onClick={() => setCourtFeeStr(String(schedSuggestedCourtFee))}
                    className="font-bold text-[#1d5fa7] hover:underline cursor-pointer"
                  >
                    Áp vào Tiền sân ({formatVND(schedSuggestedCourtFee)})
                  </button>
                )}
              </div>
            </div>
          )}
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
          {issuePreview.refundCredits.length > 0 && (
            <div className="pt-1 border-t border-amber-300/80 space-y-1">
              <p className="text-[11px] font-bold text-amber-900">
                Thủ quỹ hoàn riêng cho người góp cầu không đánh MAIN:
              </p>
              {issuePreview.refundCredits.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-amber-900">
                    {membersMap.get(r.member_id)?.name || r.member_name || r.member_id}:
                  </span>
                  <span className="font-extrabold text-amber-800">
                    Hoàn {formatVND(r.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-xl bg-[#113b66] hover:bg-[#174676] text-white text-sm font-bold cursor-pointer disabled:opacity-60"
        >
          {busy ? 'Đang phát hành...' : 'Xác nhận phát hành hóa đơn'}
        </button>
      </form>
    </div>
  );
}
