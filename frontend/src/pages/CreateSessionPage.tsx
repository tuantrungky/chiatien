import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Home,
  Loader2,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Trophy,
  Utensils,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  createSession,
  fetchSessionDetail,
  parseBillAI,
  updateSession,
} from '../services/api';
import type {
  BadmintonBillingMode,
  BadmintonCostDetail,
  CourtLineItem,
  DrinkingVenueType,
  Member,
  ScheduleDay,
  Session,
  SessionItemInput,
  SessionItemKind,
  SessionType,
  SettingsMap,
} from '../types';
import {
  calculateAdhocPerPerson,
  calculateBadmintonCost,
  calculateCourtLineAmount,
} from '../utils/badmintonCost';
import { getTodayDateStr } from '../utils/dateFilters';
import { calculateDrinkingSplit } from '../utils/drinkingSplit';
import { compressImageToBase64 } from '../utils/imageCompress';
import { calculateDurationHours } from '../utils/schedule';
import { formatVND } from '../utils/vietqr';

interface CreateSessionPageProps {
  members: Member[];
  settings: SettingsMap;
  closedMonths?: string[];
  editingSession: Session | null;
  prefillPlan: ScheduleDay | null;
  initialType?: SessionType;
  initialDate?: string;
  initialAdhoc?: boolean;
  onCancelEdit: () => void;
  onSaved: () => Promise<void>;
}

interface QuickGuestItem {
  name: string;
  selected: boolean;
  paidImmediately: boolean;
}

export function CreateSessionPage({
  members,
  settings,
  closedMonths = [],
  editingSession,
  prefillPlan,
  initialType = 'BADMINTON',
  initialDate,
  initialAdhoc = false,
  onCancelEdit,
  onSaved,
}: CreateSessionPageProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members]);
  const defaultTreasurerId = settings.treasurer_member_id || activeMembers[0]?.member_id || '';

  const [sessionType, setSessionType] = useState<SessionType>(
    editingSession?.type || (prefillPlan ? 'BADMINTON' : initialType)
  );
  const [date, setDate] = useState<string>(
    editingSession?.date || prefillPlan?.date || initialDate || getTodayDateStr()
  );
  const [title, setTitle] = useState<string>(editingSession?.title || '');
  const [guestFeeStr, setGuestFeeStr] = useState<string>(
    String(editingSession?.guest_fee || settings.guest_fee || 50000)
  );
  const [receiptDriveId, setReceiptDriveId] = useState<string>(editingSession?.receipt_drive_id || '');
  const [receiptUrl, setReceiptUrl] = useState<string>(editingSession?.receipt_url || '');
  const [receiptSummary, setReceiptSummary] = useState<string>(editingSession?.receipt_summary || '');
  const [note, setNote] = useState<string>(editingSession?.note || prefillPlan?.note || '');
  const [planId, setPlanId] = useState<string>(editingSession?.plan_id || prefillPlan?.plan_id || '');
  const [billingMode, setBillingMode] = useState<BadmintonBillingMode>(() => {
    if (editingSession?.type === 'BADMINTON') {
      return editingSession.billing_mode === 'AD_HOC' ? 'AD_HOC' : 'MONTHLY';
    }
    if (prefillPlan) return 'MONTHLY';
    return initialAdhoc ? 'AD_HOC' : 'MONTHLY';
  });
  const [badmintonPayerId, setBadmintonPayerId] = useState<string>(
    editingSession?.payer_id || defaultTreasurerId
  );

  // Chi phí Cầu lông:
  // - Buổi cố định (MONTHLY): mặc định 0đ (không sinh Sân chính), chỉ tính Vãng lai + Sân thêm giờ (nếu đông)
  // - Buổi phát sinh (AD_HOC): tính đủ Tiền sân + Tiền cầu + Chi phí khác
  const defaultHours = prefillPlan
    ? calculateDurationHours(prefillPlan.start_time, prefillPlan.end_time) || settings.default_play_hours || 1.5
    : settings.default_play_hours || 1.5;

  const [courtLines, setCourtLines] = useState<CourtLineItem[]>(() =>
    !editingSession && initialAdhoc
      ? [
          {
            label: 'Sân chính',
            courts: settings.default_court_count || 2,
            hours: defaultHours,
            pricePerHour: settings.court_price_per_hour || 0,
          },
        ]
      : []
  );
  const [courtOverride, setCourtOverride] = useState<boolean>(false);
  const [manualCourtStr, setManualCourtStr] = useState<string>('0');
  const [shuttleQtyStr, setShuttleQtyStr] = useState<string>('0');
  const [shuttlePriceStr, setShuttlePriceStr] = useState<string>(
    String(settings.shuttle_price || 0)
  );
  const [shuttleOverride, setShuttleOverride] = useState<boolean>(false);
  const [manualShuttleStr, setManualShuttleStr] = useState<string>('0');
  const [otherAmountStr, setOtherAmountStr] = useState<string>('0');
  const [totalOverride, setTotalOverride] = useState<boolean>(false);
  const [manualTotalStr, setManualTotalStr] = useState<string>('0');

  // Ăn nhậu (Ra quán / Ở nhà + Danh sách góp món)
  const [venueType, setVenueType] = useState<DrinkingVenueType>(
    (editingSession?.venue_type as DrinkingVenueType) || 'RESTAURANT'
  );
  const [drinkingItems, setDrinkingItems] = useState<SessionItemInput[]>(() => [
    {
      member_id: defaultTreasurerId,
      kind: 'BILL',
      item_name: 'Hóa đơn quán',
      amount: 0,
    },
  ]);

  // Điểm danh tick tay + Thêm vãng lai nhanh (KHÔNG giọng nói)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (prefillPlan?.planned_member_ids) {
      return prefillPlan.planned_member_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  });
  const [paidImmediatelyIds, setPaidImmediatelyIds] = useState<string[]>([]);
  const [quickGuests, setQuickGuests] = useState<QuickGuestItem[]>([]);
  const [quickGuestName, setQuickGuestName] = useState<string>('');
  const [memberSearch, setMemberSearch] = useState<string>('');

  // AI Receipt state
  const [billPreviewUrl, setBillPreviewUrl] = useState<string>('');
  const [billImageSizeKB, setBillImageSizeKB] = useState<number>(0);
  const [aiBillLoading, setAiBillLoading] = useState<boolean>(false);

  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [hasSettledAttendances, setHasSettledAttendances] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Nạp dữ liệu khi Sửa buổi cũ
  useEffect(() => {
    if (!editingSession) {
      setHasSettledAttendances(false);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setSessionType(editingSession.type);
    setDate(editingSession.date);
    setTitle(editingSession.title);
    setGuestFeeStr(String(editingSession.guest_fee || settings.guest_fee || 50000));
    setReceiptDriveId(editingSession.receipt_drive_id || '');
    setReceiptUrl(editingSession.receipt_url || '');
    setReceiptSummary(editingSession.receipt_summary || '');
    setNote(editingSession.note || '');
    setPlanId(editingSession.plan_id || '');
    setVenueType((editingSession.venue_type as DrinkingVenueType) || 'RESTAURANT');
    const isAdhocEdit = editingSession.type === 'BADMINTON' && editingSession.billing_mode === 'AD_HOC';
    setBillingMode(isAdhocEdit ? 'AD_HOC' : 'MONTHLY');
    setBadmintonPayerId(editingSession.payer_id || defaultTreasurerId);

    if (editingSession.type === 'BADMINTON') {
      if (editingSession.cost_detail) {
        try {
          const parsed = JSON.parse(editingSession.cost_detail) as BadmintonCostDetail;
          if (Array.isArray(parsed.courtLines)) {
            if (isAdhocEdit) {
              setCourtLines(parsed.courtLines);
            } else {
              setCourtLines(parsed.courtLines.filter((l) => l.isExtra || (l.amount ?? 0) > 0));
            }
          }
          setShuttlePriceStr(String(parsed.shuttlePrice ?? settings.shuttle_price ?? 0));
          setCourtOverride(Boolean(parsed.courtOverride));
          setShuttleOverride(Boolean(parsed.shuttleOverride));
          setTotalOverride(Boolean(parsed.totalOverride));
        } catch {
          // Fallback below
        }
      } else if (!isAdhocEdit && editingSession.total_amount === 0 && editingSession.court_amount === 0) {
        setCourtLines([]);
      }
      setManualCourtStr(String(editingSession.court_amount || 0));
      setShuttleQtyStr(String(editingSession.shuttle_qty || 0));
      setManualShuttleStr(String(editingSession.shuttle_amount || 0));
      setOtherAmountStr(String(editingSession.other_amount || 0));
      setManualTotalStr(String(editingSession.total_amount || 0));
      if (isAdhocEdit && !editingSession.cost_detail && editingSession.total_amount > 0 && editingSession.court_amount === 0) {
        setTotalOverride(true);
      }
    }

    fetchSessionDetail(editingSession.session_id)
      .then((detail) => {
        if (cancelled) return;
        setHasSettledAttendances(detail.attendances.some((a) => Boolean(a.settlement_id)));
        setSelectedIds(detail.attendances.map((a) => a.member_id));
        const payerForEdit = editingSession.payer_id || defaultTreasurerId;
        setPaidImmediatelyIds(
          detail.attendances
            .filter((a) => {
              if (!a.is_paid) return false;
              if (editingSession.billing_mode === 'AD_HOC') {
                return a.member_id !== payerForEdit;
              }
              return a.member_type_snapshot === 'GUEST';
            })
            .map((a) => a.member_id)
        );
        if (editingSession.type === 'DRINKING') {
          if (detail.items && detail.items.length > 0) {
            setDrinkingItems(
              detail.items.map((it) => ({
                member_id: it.member_id,
                kind: it.kind,
                item_name: it.item_name,
                amount: it.amount,
              }))
            );
          } else if (editingSession.total_amount > 0) {
            setDrinkingItems([
              {
                member_id: editingSession.payer_id || defaultTreasurerId,
                kind: 'BILL',
                item_name: 'Hóa đơn quán',
                amount: editingSession.total_amount,
              },
            ]);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(handleApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingSession, defaultTreasurerId, settings.guest_fee, settings.shuttle_price, handleApiError]);

  const guestFee = Math.max(0, Math.round(Number(guestFeeStr) || 0));

  const badmintonCost = useMemo(
    () =>
      calculateBadmintonCost({
        courtLines,
        shuttleQty: Number(shuttleQtyStr) || 0,
        shuttlePrice: Number(shuttlePriceStr) || 0,
        otherAmount: Number(otherAmountStr) || 0,
        courtOverride,
        manualCourtAmount: Number(manualCourtStr) || 0,
        shuttleOverride,
        manualShuttleAmount: Number(manualShuttleStr) || 0,
        totalOverride,
        manualTotalAmount: Number(manualTotalStr) || 0,
      }),
    [
      courtLines,
      shuttleQtyStr,
      shuttlePriceStr,
      otherAmountStr,
      courtOverride,
      manualCourtStr,
      shuttleOverride,
      manualShuttleStr,
      totalOverride,
      manualTotalStr,
    ]
  );

  const selectedQuickGuests = useMemo(
    () => quickGuests.filter((g) => g.selected && g.name.trim()),
    [quickGuests]
  );

  const totalBadmintonAttendees = selectedIds.length + selectedQuickGuests.length;
  const adhocPerPerson = useMemo(
    () =>
      calculateAdhocPerPerson(
        badmintonCost.totalAmount,
        totalBadmintonAttendees,
        settings.rounding_unit || 1000
      ),
    [badmintonCost.totalAmount, totalBadmintonAttendees, settings.rounding_unit]
  );

  const drinkingSplitPreview = useMemo(() => {
    if (sessionType !== 'DRINKING') {
      return {
        totalAmount: 0,
        perPersonAmount: 0,
        splits: [],
        roundingAdjustment: 0,
        roundingAdjustedMemberId: '',
      };
    }
    return calculateDrinkingSplit(
      selectedIds,
      drinkingItems,
      settings.rounding_unit || 1000
    );
  }, [sessionType, selectedIds, drinkingItems, settings.rounding_unit]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.aliases.toLowerCase().includes(q)
    );
  }, [activeMembers, memberSearch]);

  const toggleMember = (memberId: string) => {
    setSelectedIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const togglePaidImmediately = (memberId: string) => {
    setPaidImmediatelyIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const handleToggleBillingMode = (nextAdhoc: boolean) => {
    const nextMode: BadmintonBillingMode = nextAdhoc ? 'AD_HOC' : 'MONTHLY';
    setBillingMode(nextMode);
    if (nextMode === 'AD_HOC') {
      setCourtLines((prev) => {
        if (prev.some((l) => !l.isExtra)) return prev;
        return [
          {
            label: 'Sân chính',
            courts: prefillPlan?.courts || settings.default_court_count || 2,
            hours: defaultHours,
            pricePerHour: settings.court_price_per_hour || 0,
          },
          ...prev,
        ];
      });
    } else {
      setCourtLines((prev) => prev.filter((l) => l.isExtra));
      setShuttleQtyStr('0');
      setOtherAmountStr('0');
      setShuttleOverride(false);
      setTotalOverride(false);
    }
  };

  const handleAddExtraCourtLine = () => {
    setCourtLines((prev) => [
      ...prev,
      {
        label: 'Sân thêm giờ',
        courts: 1,
        hours: 1,
        pricePerHour: settings.court_price_per_hour || prev[0]?.pricePerHour || 0,
        isExtra: true,
      },
    ]);
  };

  const handleUpdateCourtLine = (idx: number, patch: Partial<CourtLineItem>) => {
    setCourtLines((prev) => prev.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  };

  const handleRemoveCourtLine = (idx: number) => {
    setCourtLines((prev) =>
      billingMode === 'MONTHLY'
        ? prev.filter((_, i) => i !== idx)
        : prev.length <= 1
        ? prev
        : prev.filter((_, i) => i !== idx)
    );
  };

  const handleAddDrinkingItem = (kind: SessionItemKind = 'ITEM') => {
    setDrinkingItems((prev) => [
      ...prev,
      {
        member_id: activeMembers[0]?.member_id || defaultTreasurerId,
        kind,
        item_name: kind === 'BILL' ? 'Hóa đơn quán' : '',
        amount: 0,
      },
    ]);
  };

  const handleUpdateDrinkingItem = (idx: number, patch: Partial<SessionItemInput>) => {
    setDrinkingItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleRemoveDrinkingItem = (idx: number) => {
    setDrinkingItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleBillFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !idToken) return;

    setErrorMsg(null);
    setAiBillLoading(true);
    try {
      const compressed = await compressImageToBase64(file, 1200, 0.75);
      setBillPreviewUrl(compressed.previewUrl);
      setBillImageSizeKB(compressed.sizeKB);

      const res = await parseBillAI(idToken, {
        base64Image: compressed.base64,
        mimeType: compressed.mimeType,
        sessionDate: date,
      });

      if (res.total_amount > 0) {
        if (sessionType === 'BADMINTON') {
          if (billingMode === 'MONTHLY') {
            setCourtOverride(true);
            setManualCourtStr(String(res.total_amount));
          } else {
            setTotalOverride(true);
            setManualTotalStr(String(res.total_amount));
          }
        } else {
          setDrinkingItems((prev) => {
            if (prev.length === 0) {
              return [
                {
                  member_id: defaultTreasurerId,
                  kind: 'BILL',
                  item_name: res.items_summary || 'Hóa đơn quán',
                  amount: res.total_amount,
                },
              ];
            }
            const next = [...prev];
            next[0] = {
              ...next[0],
              amount: res.total_amount,
              item_name: next[0].item_name || res.items_summary || 'Hóa đơn quán',
            };
            return next;
          });
        }
      }
      if (res.items_summary) {
        setReceiptSummary(res.items_summary);
      }
      if (!title.trim() && res.suggested_title) {
        setTitle(res.suggested_title);
      }
      setReceiptDriveId(res.receipt_drive_id || '');
      setReceiptUrl(res.receipt_url || '');
      toast.success(
        res.total_amount > 0
          ? `AI đã đọc hóa đơn: ${formatVND(res.total_amount)}`
          : 'Đã lưu ảnh hóa đơn lên Google Drive.'
      );
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setAiBillLoading(false);
    }
  };

  const handleAddQuickGuest = () => {
    const clean = quickGuestName.trim();
    if (!clean) return;
    setQuickGuests((prev) => {
      if (prev.some((g) => g.name.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, { name: clean, selected: true, paidImmediately: false }];
    });
    setQuickGuestName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || submitting) return;

    const totalAttendeeCount = selectedIds.length + selectedQuickGuests.length;
    const isFutureOrTodayAdhoc =
      sessionType === 'BADMINTON' &&
      billingMode === 'AD_HOC' &&
      date >= getTodayDateStr();

    if (totalAttendeeCount === 0 && !isFutureOrTodayAdhoc) {
      setErrorMsg('Vui lòng chọn ít nhất 1 người tham gia.');
      return;
    }

    if (
      sessionType === 'BADMINTON' &&
      billingMode === 'AD_HOC' &&
      badmintonCost.totalAmount <= 0 &&
      !isFutureOrTodayAdhoc
    ) {
      setErrorMsg('Buổi cầu phát sinh đã qua cần có tổng tiền buổi > 0đ.');
      return;
    }

    if (sessionType === 'DRINKING' && drinkingSplitPreview.totalAmount <= 0) {
      setErrorMsg('Buổi Ăn nhậu cần có ít nhất 1 khoản hóa đơn / góp món > 0đ.');
      return;
    }

    const sessionMonth = date.slice(0, 7);
    if (
      !hasSettledAttendances &&
      sessionType === 'BADMINTON' &&
      billingMode === 'MONTHLY' &&
      closedMonths.includes(sessionMonth)
    ) {
      const ok = window.confirm(
        `Tháng ${sessionMonth.slice(5, 7)}/${sessionMonth.slice(0, 4)} đã CHỐT KỲ. Buổi cố định mới (khách vãng lai / sân thêm giờ) sẽ cần lưu ý khi đối chiếu lại tháng. Bạn vẫn muốn lưu?`
      );
      if (!ok) return;
    }

    const finalTitle =
      title.trim() ||
      (sessionType === 'BADMINTON'
        ? `Cầu lông ${date}`
        : venueType === 'HOME'
        ? `Nhậu tại nhà ${date}`
        : `Ăn nhậu ${date}`);

    const monthlyExtraCourtAmount = courtOverride
      ? Math.max(0, Math.round(Number(manualCourtStr) || 0))
      : badmintonCost.calculatedCourtAmount;
    const monthlyExtraCostDetail: BadmintonCostDetail = {
      courtLines: badmintonCost.courtLines.filter((l) => l.isExtra),
      shuttlePrice: 0,
      courtOverride,
      shuttleOverride: false,
      totalOverride: false,
    };

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const payload =
        sessionType === 'BADMINTON'
          ? {
              date,
              type: 'BADMINTON' as const,
              title: finalTitle,
              totalAmount:
                billingMode === 'MONTHLY' ? monthlyExtraCourtAmount : badmintonCost.totalAmount,
              guestFee: billingMode === 'MONTHLY' ? guestFee : 0,
              billingMode,
              payerId: billingMode === 'AD_HOC' ? badmintonPayerId || defaultTreasurerId : undefined,
              courtAmount:
                billingMode === 'MONTHLY' ? monthlyExtraCourtAmount : badmintonCost.courtAmount,
              shuttleQty:
                billingMode === 'MONTHLY'
                  ? 0
                  : Math.max(0, Math.round(Number(shuttleQtyStr) || 0)),
              shuttleAmount: billingMode === 'MONTHLY' ? 0 : badmintonCost.shuttleAmount,
              otherAmount: billingMode === 'MONTHLY' ? 0 : badmintonCost.otherAmount,
              costDetail:
                billingMode === 'MONTHLY' ? monthlyExtraCostDetail : badmintonCost.detail,
              planId: planId || undefined,
              receiptDriveId,
              receiptUrl,
              receiptSummary,
              note,
              attendeeIds: selectedIds,
              paidImmediatelyMemberIds: paidImmediatelyIds,
              new_guests: selectedQuickGuests.map((g) => ({
                name: g.name,
                paidImmediately: g.paidImmediately,
              })),
            }
          : {
              date,
              type: 'DRINKING' as const,
              title: finalTitle,
              totalAmount: drinkingSplitPreview.totalAmount,
              payerId: (() => {
                const billTotals = new Map<string, number>();
                const anyTotals = new Map<string, number>();
                for (const it of drinkingItems) {
                  const amt = Math.max(0, Number(it.amount) || 0);
                  if (!it.member_id || amt <= 0) continue;
                  anyTotals.set(it.member_id, (anyTotals.get(it.member_id) || 0) + amt);
                  if (it.kind === 'BILL') {
                    billTotals.set(it.member_id, (billTotals.get(it.member_id) || 0) + amt);
                  }
                }
                const sourceMap = billTotals.size > 0 ? billTotals : anyTotals;
                let bestId = '';
                let bestAmt = -1;
                for (const [mId, amt] of sourceMap.entries()) {
                  if (amt > bestAmt) {
                    bestAmt = amt;
                    bestId = mId;
                  }
                }
                return bestId || drinkingItems[0]?.member_id || defaultTreasurerId;
              })(),
              venueType,
              items: drinkingItems.filter((it) => it.amount > 0 && it.member_id),
              receiptDriveId,
              receiptUrl,
              receiptSummary,
              note,
              attendeeIds: selectedIds,
              new_guests: selectedQuickGuests.map((g) => ({ name: g.name })),
            };

      if (editingSession) {
        await updateSession(idToken, { ...payload, sessionId: editingSession.session_id });
        toast.success('Đã cập nhật buổi chơi thành công!');
      } else {
        await createSession(idToken, payload);
        toast.success('Đã lưu buổi mới thành công!');
      }
      await onSaved();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-2 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            {editingSession
              ? 'Chỉnh sửa buổi chơi'
              : prefillPlan
              ? `Điểm danh buổi ${prefillPlan.date}`
              : 'Tạo buổi mới'}
          </h2>
          <p className="text-xs text-slate-500">
            {sessionType === 'BADMINTON'
              ? billingMode === 'AD_HOC'
                ? 'Buổi phát sinh: chia đều trực tiếp cho tất cả người tham gia'
                : 'Buổi cố định: MAIN tính theo tháng, vãng lai đóng theo buổi'
              : 'Góp món / hóa đơn quán & tự cấn trừ phần chia'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancelEdit}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>Quay lại</span>
        </button>
      </div>

      {loadingDetail && (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-3 flex items-center gap-2 text-xs text-blue-700">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Đang tải dữ liệu buổi cũ...</span>
        </div>
      )}

      {hasSettledAttendances && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-3 flex items-start gap-2 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Buổi này đã có khoản thanh toán đối soát nên <strong>khóa sửa số tiền &amp; người tham gia</strong>.
            Bạn vẫn có thể sửa <strong>Tiêu đề, Ghi chú</strong> và <strong>Ảnh hóa đơn</strong>.
          </span>
        </div>
      )}

      {/* 1. Loại buổi & Ngày / Tiêu đề */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            disabled={hasSettledAttendances}
            onClick={() => setSessionType('BADMINTON')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
              sessionType === 'BADMINTON'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Cầu lông</span>
          </button>
          <button
            type="button"
            disabled={hasSettledAttendances}
            onClick={() => setSessionType('DRINKING')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
              sessionType === 'DRINKING'
                ? 'bg-orange-500 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>Ăn nhậu</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày diễn ra</label>
            <input
              type="date"
              value={date}
              disabled={hasSettledAttendances}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tiêu đề buổi</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                sessionType === 'BADMINTON' ? 'VD: Cầu lông tối T4' : 'VD: Nhậu nhà Thảo / Quán Ốc'
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {sessionType === 'BADMINTON' && (
          <label
            className={`flex items-start gap-2.5 p-3 rounded-xl border transition ${
              hasSettledAttendances ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
            } ${
              billingMode === 'AD_HOC'
                ? 'bg-sky-50 border-sky-300'
                : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
            }`}
          >
            <input
              type="checkbox"
              disabled={hasSettledAttendances}
              checked={billingMode === 'AD_HOC'}
              onChange={(e) => handleToggleBillingMode(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-sky-600"
            />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-bold text-slate-900">
                Buổi cầu phát sinh (ngoài lịch cố định)
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                Chia đều tổng tiền buổi cho <strong>tất cả người tham gia</strong> (cả thành viên chính
                &amp; vãng lai, làm tròn lên 1.000đ). Không tính vào hóa đơn cố định tháng.
              </p>
            </div>
          </label>
        )}

        {/* Quét hóa đơn AI dùng chung cho cả Cầu lông & Ăn nhậu */}
        <div className="pt-2 border-t border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-xs font-bold text-slate-700">
                {sessionType === 'BADMINTON'
                  ? 'Ảnh phiếu tính tiền sân / cầu (Quét AI)'
                  : 'Ảnh hóa đơn quán / phiếu tính tiền (Quét AI)'}
              </p>
              <p className="text-[11px] text-slate-500">
                Chụp hoặc chọn ảnh để AI tự trích tổng tiền &amp; lưu biên lai lên Google Drive.
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleBillFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={aiBillLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-60"
              >
                {aiBillLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
                <span>{aiBillLoading ? 'Đang quét AI...' : 'Quét hóa đơn AI'}</span>
              </button>
            </div>
          </div>

          {billPreviewUrl && (
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5 border border-slate-200">
              <img
                src={billPreviewUrl}
                alt="Xem trước hóa đơn"
                className="w-14 h-14 object-cover rounded-lg border border-slate-200"
              />
              <div className="text-xs text-slate-600 min-w-0">
                <p className="font-semibold text-slate-800">Đã nén ảnh ({billImageSizeKB} KB)</p>
                {receiptUrl && (
                  <a
                    href={receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline truncate block"
                  >
                    Xem ảnh lưu trên Google Drive
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <fieldset disabled={hasSettledAttendances} className="space-y-4 disabled:opacity-75">
      {/* 2A. CHI PHÍ CẦU LÔNG */}
      {sessionType === 'BADMINTON' && billingMode === 'MONTHLY' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-xs">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-xs text-emerald-900">
            <p className="font-bold">Buổi đánh theo lịch cố định (đã thu đầu tháng)</p>
            <p className="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
              Thành viên chính <strong>không phát sinh tiền buổi</strong> — chỉ tính phí{' '}
              <strong>Vãng lai theo buổi</strong> và <strong>Sân thêm giờ</strong> nếu đông phải thuê thêm.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Phí Vãng lai buổi này (VND)
              </label>
              <input
                type="number"
                min={0}
                step={5000}
                value={guestFeeStr}
                onChange={(e) => setGuestFeeStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Ghi chú thêm giờ / vãng lai
              </label>
              <input
                type="text"
                value={receiptSummary}
                onChange={(e) => setReceiptSummary(e.target.value)}
                placeholder="VD: Thu thêm 1h sân 3 do đông vãng lai"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  Sân thêm giờ (tùy chọn — mặc định 0đ)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Chỉ bấm khi hôm nay đông vãng lai phải thuê thêm sân hoặc thêm giờ
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddExtraCourtLine}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Sân thêm giờ</span>
              </button>
            </div>

            {courtLines.length === 0 && !courtOverride ? (
              <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>Không có sân thêm giờ (0đ)</span>
                <button
                  type="button"
                  onClick={() => {
                    setCourtOverride(true);
                    setManualCourtStr('0');
                  }}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  Hoặc tự nhập số tiền
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {courtLines.map((line, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={line.label}
                        onChange={(e) => handleUpdateCourtLine(idx, { label: e.target.value })}
                        className="text-xs font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-700">
                          {formatVND(calculateCourtLineAmount(line))}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCourtLine(idx)}
                          className="text-rose-500 hover:text-rose-700 cursor-pointer"
                          aria-label="Xóa dòng sân thêm giờ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Số sân</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={line.courts}
                          onChange={(e) =>
                            handleUpdateCourtLine(idx, { courts: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Số giờ</label>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={line.hours}
                          onChange={(e) =>
                            handleUpdateCourtLine(idx, { hours: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Giá/giờ (đ)</label>
                        <input
                          type="number"
                          min={0}
                          step={5000}
                          value={line.pricePerHour}
                          onChange={(e) =>
                            handleUpdateCourtLine(idx, { pricePerHour: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-600">
                      Tiền sân thêm giờ {courtOverride ? '(Nhập tay)' : '(Tự tính)'}
                    </label>
                    {courtOverride && (
                      <button
                        type="button"
                        onClick={() => {
                          setCourtOverride(false);
                          setManualCourtStr('0');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{courtLines.length > 0 ? 'Tự tính lại' : 'Đưa về 0đ'}</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={
                      courtOverride ? manualCourtStr : String(badmintonCost.calculatedCourtAmount)
                    }
                    onChange={(e) => {
                      setCourtOverride(true);
                      setManualCourtStr(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 2A. CHI PHÍ CẦU LÔNG PHÁT SINH (SÂN + SÂN THÊM GIỜ + CẦU + KHÁC) */}
      {sessionType === 'BADMINTON' && billingMode === 'AD_HOC' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Chi phí buổi Cầu lông</h3>
              <p className="text-[11px] text-slate-500">
                Tổng buổi = Tiền sân + Tiền cầu + Chi phí khác (Thủ quỹ tổng hợp tháng)
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddExtraCourtLine}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Sân thêm giờ</span>
            </button>
          </div>

          {/* Các dòng Sân */}
          <div className="space-y-2">
            {courtLines.map((line, idx) => (
              <div
                key={idx}
                className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={line.label}
                    onChange={(e) => handleUpdateCourtLine(idx, { label: e.target.value })}
                    className="text-xs font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-700">
                      {formatVND(calculateCourtLineAmount(line))}
                    </span>
                    {courtLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCourtLine(idx)}
                        className="text-rose-500 hover:text-rose-700 cursor-pointer"
                        aria-label="Xóa dòng sân"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Số sân</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={line.courts}
                      onChange={(e) =>
                        handleUpdateCourtLine(idx, { courts: Number(e.target.value) || 0 })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Số giờ</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={line.hours}
                      onChange={(e) =>
                        handleUpdateCourtLine(idx, { hours: Number(e.target.value) || 0 })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Giá/giờ (đ)</label>
                    <input
                      type="number"
                      min={0}
                      step={5000}
                      value={line.pricePerHour}
                      onChange={(e) =>
                        handleUpdateCourtLine(idx, { pricePerHour: Number(e.target.value) || 0 })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tiền sân (Tự tính / Tự điền) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">
                  Tiền sân {courtOverride ? '(Nhập tay)' : '(Tự tính)'}
                </label>
                {courtOverride && (
                  <button
                    type="button"
                    onClick={() => setCourtOverride(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Tự tính lại</span>
                  </button>
                )}
              </div>
              <input
                type="number"
                min={0}
                step={1000}
                value={courtOverride ? manualCourtStr : String(badmintonCost.calculatedCourtAmount)}
                onChange={(e) => {
                  setCourtOverride(true);
                  setManualCourtStr(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Người ứng tiền sân/cầu
              </label>
              <select
                value={badmintonPayerId}
                onChange={(e) => setBadmintonPayerId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
              >
                {activeMembers.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name} {m.member_id === defaultTreasurerId ? '(Thủ quỹ)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-sky-900 font-medium">
              Chia đều {totalBadmintonAttendees} người (làm tròn lên 1.000đ):
            </span>
            <span className="font-extrabold text-sky-700 text-sm">
              {formatVND(adhocPerPerson)} / người
            </span>
          </div>

          {/* Tiền quả cầu */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Số quả cầu</label>
              <input
                type="number"
                min={0}
                step={1}
                value={shuttleQtyStr}
                onChange={(e) => setShuttleQtyStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Giá/quả (đ)</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={shuttlePriceStr}
                onChange={(e) => setShuttlePriceStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600 truncate">Tiền cầu</label>
                {shuttleOverride && (
                  <button
                    type="button"
                    onClick={() => setShuttleOverride(false)}
                    className="text-[10px] font-semibold text-emerald-700 cursor-pointer"
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
                  shuttleOverride
                    ? manualShuttleStr
                    : String(badmintonCost.calculatedShuttleAmount)
                }
                onChange={(e) => {
                  setShuttleOverride(true);
                  setManualShuttleStr(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
          </div>

          {/* Chi phí khác & Tổng tiền buổi cầu */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Chi phí khác (nước, gửi xe...)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={otherAmountStr}
                onChange={(e) => setOtherAmountStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">
                  Tổng tiền buổi cầu {totalOverride ? '(Nhập tay)' : '(Sân + Cầu + Khác)'}
                </label>
                {totalOverride && (
                  <button
                    type="button"
                    onClick={() => setTotalOverride(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Tự tính lại</span>
                  </button>
                )}
              </div>
              <input
                type="number"
                min={0}
                step={1000}
                value={totalOverride ? manualTotalStr : String(badmintonCost.calculatedTotalAmount)}
                onChange={(e) => {
                  setTotalOverride(true);
                  setManualTotalStr(e.target.value);
                }}
                className="w-full rounded-xl border-2 border-emerald-400 bg-emerald-50/40 px-3 py-2 text-sm font-extrabold text-emerald-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Số lượng cầu / chi phí khác
            </label>
            <input
              type="text"
              value={receiptSummary}
              onChange={(e) => setReceiptSummary(e.target.value)}
              placeholder="VD: 8 quả cầu Hải Yến, 1 thùng nước suối"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </section>
      )}

      {/* 2B. CHI PHÍ ĂN NHẬU (RA QUÁN / Ở NHÀ + GÓP MÓN) */}
      {sessionType === 'DRINKING' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="inline-flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setVenueType('RESTAURANT')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  venueType === 'RESTAURANT' ? 'bg-white text-orange-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>Ra quán</span>
              </button>
              <button
                type="button"
                onClick={() => setVenueType('HOME')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  venueType === 'HOME' ? 'bg-white text-orange-600 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Home className="w-3.5 h-3.5" />
                <span>Ở nhà (góp món)</span>
              </button>
            </div>
          </div>

          {/* Danh sách đóng góp (Hóa đơn quán / Món góp) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <label className="text-xs font-bold text-slate-700 block">
                  Danh sách thanh toán &amp; góp món ({formatVND(drinkingSplitPreview.totalAmount)})
                </label>
                {(() => {
                  const billTotals = new Map<string, number>();
                  const anyTotals = new Map<string, number>();
                  for (const item of drinkingItems) {
                    const amt = Math.max(0, Number(item.amount) || 0);
                    if (!item.member_id || amt <= 0) continue;
                    anyTotals.set(item.member_id, (anyTotals.get(item.member_id) || 0) + amt);
                    if (item.kind === 'BILL') {
                      billTotals.set(item.member_id, (billTotals.get(item.member_id) || 0) + amt);
                    }
                  }
                  const src = billTotals.size > 0 ? billTotals : anyTotals;
                  let topId = drinkingItems[0]?.member_id || '';
                  let topAmt = -1;
                  for (const [mId, amt] of src.entries()) {
                    if (amt > topAmt) {
                      topAmt = amt;
                      topId = mId;
                    }
                  }
                  const payerName = activeMembers.find((m) => m.member_id === topId)?.name;
                  return payerName ? (
                    <p className="text-[11px] font-semibold text-orange-700 mt-0.5">
                      Người ứng tiền chính: {payerName}
                    </p>
                  ) : null;
                })()}
              </div>
              <button
                type="button"
                onClick={() => handleAddDrinkingItem('ITEM')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm món góp</span>
              </button>
            </div>

            {drinkingItems.map((it, idx) => (
              <div
                key={idx}
                className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-2"
              >
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Người ứng tiền / góp món
                    </label>
                    <select
                      value={it.member_id}
                      onChange={(e) => handleUpdateDrinkingItem(idx, { member_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                    >
                      {activeMembers.map((m) => (
                        <option key={m.member_id} value={m.member_id}>
                          {m.name} {m.member_id === defaultTreasurerId ? '(Thủ quỹ)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Loại khoản chi
                    </label>
                    <select
                      value={it.kind}
                      onChange={(e) =>
                        handleUpdateDrinkingItem(idx, { kind: e.target.value as SessionItemKind })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                    >
                      <option value="BILL">Trả hóa đơn quán</option>
                      <option value="ITEM">Góp món / đồ uống</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={it.item_name}
                    onChange={(e) => handleUpdateDrinkingItem(idx, { item_name: e.target.value })}
                    placeholder="VD: Thùng bia Tiger / Nồi lẩu"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={it.amount || ''}
                    onChange={(e) =>
                      handleUpdateDrinkingItem(idx, { amount: Number(e.target.value) || 0 })
                    }
                    placeholder="Số tiền"
                    className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-right"
                  />
                  {drinkingItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDrinkingItem(idx)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Tóm tắt món ăn (tùy chọn)
            </label>
            <input
              type="text"
              value={receiptSummary}
              onChange={(e) => setReceiptSummary(e.target.value)}
              placeholder="VD: Lẩu gà, Bia Tiger, Đồ nướng"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </section>
      )}

      {/* 3. ĐIỂM DANH TICK TAY & THÊM VÃNG LAI NHANH (KHÔNG GIỌNG NÓI) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Điểm danh người tham gia</h3>
            <p className="text-[11px] text-slate-500">Tick tay thành viên &amp; thêm nhanh vãng lai</p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
            Đã chọn {selectedIds.length + selectedQuickGuests.length}
          </span>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Tìm theo tên hoặc biệt danh..."
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-0.5">
          {filteredMembers.map((m) => {
            const checked = selectedIds.includes(m.member_id);
            const isPaidImm = paidImmediatelyIds.includes(m.member_id);
            return (
              <div
                key={m.member_id}
                onClick={() => toggleMember(m.member_id)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition cursor-pointer select-none ${
                  checked
                    ? 'bg-emerald-50 border-emerald-400'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                      checked ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {m.type === 'GUEST' ? 'Vãng lai' : 'Thành viên chính'}
                    </p>
                  </div>
                </div>

                {checked &&
                  sessionType === 'BADMINTON' &&
                  billingMode === 'AD_HOC' &&
                  m.member_id === badmintonPayerId && (
                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-800 shrink-0">
                      Người ứng tiền
                    </span>
                  )}

                {checked &&
                  sessionType === 'BADMINTON' &&
                  ((billingMode === 'AD_HOC' && m.member_id !== badmintonPayerId) ||
                    (billingMode === 'MONTHLY' && m.type === 'GUEST')) && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        togglePaidImmediately(m.member_id);
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 cursor-pointer ${
                        isPaidImm
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-slate-300 text-slate-600'
                      }`}
                    >
                      {isPaidImm ? 'Đã trả ngay' : 'Ghi nợ'}
                    </button>
                  )}
              </div>
            );
          })}
        </div>

        {/* Danh sách Vãng lai vừa thêm nhanh */}
        {quickGuests.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {quickGuests.map((g, idx) => (
              <div
                key={`${g.name}-${idx}`}
                className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
              >
                <label className="flex items-center gap-2 text-xs font-bold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={g.selected}
                    onChange={(e) =>
                      setQuickGuests((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, selected: e.target.checked } : it))
                      )
                    }
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>{g.name} (Vãng lai mới)</span>
                </label>

                {sessionType === 'BADMINTON' && g.selected && (
                  <label className="flex items-center gap-1 text-xs font-semibold text-emerald-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={g.paidImmediately}
                      onChange={(e) =>
                        setQuickGuests((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, paidImmediately: e.target.checked } : it
                          )
                        )
                      }
                      className="w-3.5 h-3.5 accent-emerald-600"
                    />
                    <span>Trả ngay</span>
                  </label>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={quickGuestName}
            onChange={(e) => setQuickGuestName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddQuickGuest();
              }
            }}
            placeholder="Tên khách vãng lai mới..."
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={handleAddQuickGuest}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm vãng lai</span>
          </button>
        </div>
      </section>
      </fieldset>

      {/* 4. XEM TRƯỚC PHÂN BỔ TIỀN */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5 shadow-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Xem trước kết quả</h3>
          {sessionType === 'BADMINTON' ? (
            billingMode === 'MONTHLY' ? (
              <span className="text-xs font-bold text-emerald-700">
                {(courtOverride
                  ? Math.max(0, Math.round(Number(manualCourtStr) || 0))
                  : badmintonCost.calculatedCourtAmount) > 0
                  ? `Sân thêm giờ: ${formatVND(
                      courtOverride
                        ? Math.max(0, Math.round(Number(manualCourtStr) || 0))
                        : badmintonCost.calculatedCourtAmount
                    )}`
                  : 'Theo lịch (0đ)'}
              </span>
            ) : (
              <span className="text-xs font-bold text-emerald-700">
                Tổng chi buổi: {formatVND(badmintonCost.totalAmount)}
              </span>
            )
          ) : (
            <span className="text-xs font-bold text-orange-600">
              {formatVND(drinkingSplitPreview.perPersonAmount)}/người
            </span>
          )}
        </div>

        {sessionType === 'BADMINTON' ? (
          billingMode === 'AD_HOC' ? (
            <div className="space-y-1.5 text-xs">
              {date >= getTodayDateStr() &&
                (totalBadmintonAttendees === 0 || badmintonCost.totalAmount === 0) && (
                  <p className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2 text-[11px] text-sky-900">
                    Buổi phát sinh hôm nay / sắp tới có thể lưu trước với <strong>0đ</strong> &amp;{' '}
                    <strong>chưa chọn người chơi</strong>, sau khi đánh xong bấm <strong>Sửa</strong> để chốt.
                  </p>
                )}
              <p className="text-sky-800 font-medium">
                Buổi phát sinh chia đều ({totalBadmintonAttendees} người):{' '}
                <span className="font-extrabold">{formatVND(adhocPerPerson)}/người</span>
              </p>
              {activeMembers
                .filter((m) => selectedIds.includes(m.member_id))
                .map((m) => {
                  const isPayer = m.member_id === badmintonPayerId;
                  const paid = isPayer || paidImmediatelyIds.includes(m.member_id) || adhocPerPerson === 0;
                  const payerName =
                    activeMembers.find((x) => x.member_id === badmintonPayerId)?.name || 'Người ứng';
                  return (
                    <div
                      key={m.member_id}
                      className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl"
                    >
                      <span className="font-semibold text-slate-800">
                        {m.name} {m.type === 'GUEST' ? '(Vãng lai)' : ''}
                      </span>
                      <span className={`font-bold ${paid ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {isPayer
                          ? 'Người ứng tiền (Đã cấn trừ)'
                          : paid
                          ? `Đã trả ${formatVND(adhocPerPerson)}`
                          : `Chuyển ${payerName} ${formatVND(adhocPerPerson)}`}
                      </span>
                    </div>
                  );
                })}
              {selectedQuickGuests.map((g) => {
                const payerName =
                  activeMembers.find((x) => x.member_id === badmintonPayerId)?.name || 'Người ứng';
                return (
                  <div
                    key={g.name}
                    className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl"
                  >
                    <span className="font-semibold text-slate-800">{g.name} (Vãng lai mới)</span>
                    <span
                      className={`font-bold ${g.paidImmediately ? 'text-emerald-700' : 'text-rose-600'}`}
                    >
                      {g.paidImmediately
                        ? `Đã trả ${formatVND(adhocPerPerson)}`
                        : `Chuyển ${payerName} ${formatVND(adhocPerPerson)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1.5 text-xs">
              <p className="text-slate-600">
                Thành viên chính (MAIN): <span className="font-semibold">Không thu lẻ theo buổi</span> (tính chung vào hóa đơn tháng).
              </p>
              {activeMembers
                .filter((m) => selectedIds.includes(m.member_id) && m.type === 'GUEST')
                .map((m) => {
                  const paid = paidImmediatelyIds.includes(m.member_id);
                  return (
                    <div
                      key={m.member_id}
                      className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl"
                    >
                      <span className="font-semibold text-slate-800">{m.name} (Vãng lai)</span>
                      <span className={`font-bold ${paid ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {paid ? `Đã trả ${formatVND(guestFee)}` : `Nợ Thủ quỹ ${formatVND(guestFee)}`}
                      </span>
                    </div>
                  );
                })}
              {selectedQuickGuests.map((g) => (
                <div
                  key={g.name}
                  className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl"
                >
                  <span className="font-semibold text-slate-800">{g.name} (Vãng lai mới)</span>
                  <span
                    className={`font-bold ${g.paidImmediately ? 'text-emerald-700' : 'text-rose-600'}`}
                  >
                    {g.paidImmediately
                      ? `Đã trả ${formatVND(guestFee)}`
                      : `Nợ Thủ quỹ ${formatVND(guestFee)}`}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {drinkingSplitPreview.splits.map((sp) => {
              const name =
                activeMembers.find((m) => m.member_id === sp.memberId)?.name || sp.memberId;
              return (
                <div
                  key={sp.memberId}
                  className="px-3 py-2 flex items-center justify-between text-xs bg-slate-50/60"
                >
                  <div>
                    <span className="font-bold text-slate-900">{name}</span>
                    {sp.contributedAmount > 0 && (
                      <span className="text-[11px] text-slate-500 ml-1.5">
                        (đã góp {formatVND(sp.contributedAmount)})
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-bold ${
                      sp.netAmount > 0
                        ? 'text-rose-600'
                        : sp.netAmount < 0
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {sp.netAmount > 0
                      ? `Trả thêm ${formatVND(sp.netAmount)}`
                      : sp.netAmount < 0
                      ? `Nhận lại ${formatVND(-sp.netAmount)}`
                      : 'Hòa (0đ)'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {sessionType === 'DRINKING' && drinkingSplitPreview.roundingAdjustment !== 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
            Làm tròn {formatVND(settings.rounding_unit || 1000)}: bù lệch{' '}
            <strong>
              {drinkingSplitPreview.roundingAdjustment > 0 ? '+' : ''}
              {formatVND(drinkingSplitPreview.roundingAdjustment)}
            </strong>{' '}
            cho{' '}
            <strong>
              {activeMembers.find(
                (m) => m.member_id === drinkingSplitPreview.roundingAdjustedMemberId
              )?.name || 'người nhận nhiều nhất'}
            </strong>{' '}
            để tổng chia cân bằng 0đ.
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Ghi chú thêm</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú buổi chơi (tùy chọn)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || loadingDetail}
        className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm active:scale-[0.99] transition cursor-pointer disabled:opacity-60"
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        <span>
          {submitting
            ? 'Đang lưu lên Google Sheets...'
            : editingSession
            ? 'Lưu thay đổi'
            : 'Lưu buổi chơi'}
        </span>
      </button>
    </form>
  );
}
