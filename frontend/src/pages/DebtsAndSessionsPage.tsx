import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  ExternalLink,
  History,
  Home,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  Utensils,
} from 'lucide-react';
import { MyDebtFilterBar } from '../components/MyDebtFilterBar';
import { OverdueBadge } from '../components/OverdueBadge';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  confirmPayment,
  deleteSession,
  fetchSessionDetail,
  markDuePaid,
  undoSettlement,
} from '../services/api';
import type {
  Attendance,
  BadmintonCostDetail,
  BootstrapData,
  SeparatedDebtsData,
  Session,
  SessionDetailData,
  SimplifiedDebtResult,
} from '../types';
import { formatDateVN, formatShortDateVN, getTodayDateStr } from '../utils/dateFilters';
import { getOverdueInfo } from '../utils/overdue';
import { formatVND } from '../utils/vietqr';
import { buildDebtsZaloMessage } from '../utils/zaloShare';

interface DebtsAndSessionsPageProps {
  bootstrap: BootstrapData | null;
  debts: SeparatedDebtsData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  sessions: Session[];
  onOpenQr: (data: VietQRModalData) => void;
  onRefreshAll: () => Promise<boolean>;
  onEditSession: (session: Session) => void;
  onCreateNewSession: (type: 'BADMINTON' | 'DRINKING') => void;
}

export function DebtsAndSessionsPage({
  bootstrap,
  debts,
  simplifiedDrinkingDebts,
  sessions,
  onOpenQr,
  onRefreshAll,
  onEditSession,
  onCreateNewSession,
}: DebtsAndSessionsPageProps) {
  const { isEditor, idToken, myMemberId, setMyMemberId, handleApiError } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayStr = getTodayDateStr();
  const [subTab, setSubTab] = useState<'DEBTS' | 'SESSIONS'>(() =>
    searchParams.get('tab') === 'sessions' ? 'SESSIONS' : 'DEBTS'
  );
  const [debtViewMode, setDebtViewMode] = useState<'ALL' | 'MINE'>('ALL');
  const [expandedTransferKey, setExpandedTransferKey] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'ALL' | 'BADMINTON' | 'DRINKING'>(() => {
    const typeParam = searchParams.get('type');
    return typeParam === 'BADMINTON' || typeParam === 'DRINKING' ? typeParam : 'ALL';
  });

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const typeParam = searchParams.get('type');
    setSubTab(tabParam === 'sessions' ? 'SESSIONS' : 'DEBTS');
    if (typeParam === 'BADMINTON' || typeParam === 'DRINKING' || typeParam === 'ALL') {
      setSessionFilter(typeParam);
    } else if (tabParam === 'sessions') {
      setSessionFilter('ALL');
    }
  }, [searchParams]);

  const handleSelectSubTab = (nextTab: 'DEBTS' | 'SESSIONS') => {
    setSubTab(nextTab);
    if (nextTab === 'DEBTS') {
      setSearchParams({}, { replace: true });
    } else {
      const nextParams: Record<string, string> = { tab: 'sessions' };
      if (sessionFilter !== 'ALL') {
        nextParams.type = sessionFilter;
      }
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleSelectSessionFilter = (nextFilter: 'ALL' | 'BADMINTON' | 'DRINKING') => {
    setSessionFilter(nextFilter);
    const nextParams: Record<string, string> = { tab: 'sessions' };
    if (nextFilter !== 'ALL') {
      nextParams.type = nextFilter;
    }
    setSearchParams(nextParams, { replace: true });
  };
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionDetailCache, setSessionDetailCache] = useState<Record<string, SessionDetailData>>({});
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const treasurer = useMemo(
    () =>
      bootstrap?.members.find(
        (m) => m.member_id === (debts?.treasurerMemberId || bootstrap.settings.treasurer_member_id)
      ),
    [bootstrap, debts]
  );

  const unpaidDrinkingBySession = useMemo(() => {
    const map = new Map<string, Attendance[]>();
    for (const att of debts?.drinking.unpaidAttendances || []) {
      if (!map.has(att.session_id)) map.set(att.session_id, []);
      map.get(att.session_id)!.push(att);
    }
    return map;
  }, [debts]);

  const unpaidBadmintonGuestBySession = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of debts?.badminton.guestDues || []) {
      map.set(g.session_id, (map.get(g.session_id) || 0) + 1);
    }
    for (const a of debts?.badminton.adhocDues || []) {
      map.set(a.session_id, (map.get(a.session_id) || 0) + 1);
    }
    return map;
  }, [debts]);

  const filteredSessions = useMemo(
    () => sessions.filter((s) => sessionFilter === 'ALL' || s.type === sessionFilter),
    [sessions, sessionFilter]
  );

  const handleToggleSessionDetail = async (sessionId: string, forceReload = false) => {
    if (!forceReload && expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(sessionId);
    if (forceReload || !sessionDetailCache[sessionId]) {
      setLoadingSessionId(sessionId);
      try {
        const detail = await fetchSessionDetail(sessionId);
        setSessionDetailCache((prev) => ({ ...prev, [sessionId]: detail }));
      } catch {
        // Ignore
      } finally {
        setLoadingSessionId(null);
      }
    }
  };

  const handleMarkMonthlyDuePaid = async (dueId: string, memberName: string) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(dueId);
    setActionError(null);
    try {
      await markDuePaid(idToken, { dueId, isPaid: true });
      await onRefreshAll();
      toast.success(`Đã thu tiền cầu tháng của ${memberName}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleMarkGuestDuePaid = async (
    attendanceId: string,
    memberId: string,
    amount: number,
    memberName: string,
    sessionId: string,
    creditorId?: string
  ) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(attendanceId);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        category: 'BADMINTON',
        mode: 'ITEMS',
        fromMemberId: memberId,
        toMemberId: creditorId || debts?.treasurerMemberId || treasurer?.member_id || '',
        attendanceIds: [attendanceId],
        amount,
        method: 'CASH',
      });
      if (expandedSessionId === sessionId) {
        await handleToggleSessionDetail(sessionId, true);
      }
      await onRefreshAll();
      toast.success(`Đã thu ${formatVND(amount)} của ${memberName}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmDrinkingTransfer = async (
    tr: SimplifiedDebtResult['transfers'][number]
  ) => {
    if (!isEditor || !idToken || busyKey) return;
    const key = `${tr.fromMember.member_id}-${tr.toMember.member_id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        category: 'DRINKING',
        mode: 'SIMPLIFIED_TRANSFER',
        fromMemberId: tr.fromMember.member_id,
        toMemberId: tr.toMember.member_id,
        amount: tr.amount,
        method: 'VIETQR',
        transferContent: tr.transferContent,
      });
      setSessionDetailCache({});
      await onRefreshAll();
      toast.success(
        `Đã xác nhận ${tr.fromMember.name} chuyển ${formatVND(tr.amount)} cho ${tr.toMember.name}.`
      );
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleMarkDrinkingAttPaid = async (att: Attendance, receiverId: string) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(att.attendance_id);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        category: 'DRINKING',
        mode: 'ITEMS',
        fromMemberId: att.member_id,
        toMemberId: receiverId,
        attendanceIds: [att.attendance_id],
        amount: Math.abs(att.net_amount || att.fee_amount),
        method: 'CASH',
      });
      await handleToggleSessionDetail(att.session_id, true);
      await onRefreshAll();
      toast.success(`Đã gạch nợ nhậu cho ${att.member_name || att.member_id}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteSession = async (s: Session) => {
    if (!isEditor || !idToken || busyKey) return;
    if (!window.confirm(`Bạn có chắc muốn xóa buổi "${s.title}" (${formatDateVN(s.date)})?`)) {
      return;
    }
    setBusyKey(s.session_id);
    setActionError(null);
    try {
      await deleteSession(idToken, s.session_id);
      if (expandedSessionId === s.session_id) setExpandedSessionId(null);
      await onRefreshAll();
      toast.success(`Đã xóa buổi "${s.title}".`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleUndoSettlement = async (settlementId: string, label: string) => {
    if (!idToken) return;
    if (!window.confirm(`Hoàn tác gạch nợ "${label}"? Khoản nợ sẽ được khôi phục lại.`)) return;
    setBusyKey(`undo-${settlementId}`);
    setActionError(null);
    try {
      await undoSettlement(idToken, settlementId);
      await onRefreshAll();
      toast.success(`Đã hoàn tác gạch nợ: ${label}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopyDebtsZalo = async () => {
    const msg = buildDebtsZaloMessage({
      clubName: bootstrap?.settings.club_name || 'Lông Ca Club',
      debts,
      simplifiedDrinkingDebts,
      treasurer,
      appUrl: window.location.origin,
      todayStr,
    });
    try {
      await navigator.clipboard.writeText(msg);
      toast.success('Đã copy tin nhắn nhắc nợ Zalo!');
    } catch {
      toast.error('Trình duyệt không cho phép copy tự động.');
    }
  };

  const adhocDues = debts?.badminton.adhocDues ?? [];
  const badmintonTotal = debts?.badminton.totalOutstanding ?? 0;
  const drinkingTotal = simplifiedDrinkingDebts.totalOutstanding;
  const onlyMine = debtViewMode === 'MINE' && Boolean(myMemberId);
  const visibleMonthlyDues = (debts?.badminton.monthlyDues || []).filter(
    (d) => !onlyMine || d.member_id === myMemberId
  );
  const visibleGuestDues = (debts?.badminton.guestDues || []).filter(
    (g) => !onlyMine || g.member_id === myMemberId
  );
  const visibleAdhocDues = adhocDues.filter(
    (a) => !onlyMine || a.member_id === myMemberId
  );
  const visibleDrinkingTransfers = simplifiedDrinkingDebts.transfers.filter(
    (tr) => !onlyMine || tr.fromMember.member_id === myMemberId
  );

  return (
    <div className="space-y-4">
      {isEditor && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onCreateNewSession('BADMINTON')}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm buổi Cầu lông</span>
          </button>
          <button
            type="button"
            onClick={() => onCreateNewSession('DRINKING')}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs sm:text-sm font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm buổi Ăn nhậu</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => handleSelectSubTab('DEBTS')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'DEBTS'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Công nợ tách biệt</span>
        </button>
        <button
          type="button"
          onClick={() => handleSelectSubTab('SESSIONS')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'SESSIONS'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Lịch sử các buổi ({sessions.length})</span>
        </button>
      </div>

      {actionError && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* TAB 1: CÔNG NỢ TÁCH BIỆT 2 KHỐI */}
      {subTab === 'DEBTS' && (
        <div className="space-y-5">
          <div className="space-y-2.5">
            <MyDebtFilterBar
              members={bootstrap?.members || []}
              myMemberId={myMemberId}
              onSelectMemberId={setMyMemberId}
              viewMode={debtViewMode}
              onChangeViewMode={setDebtViewMode}
              debts={debts}
              simplifiedDrinkingDebts={simplifiedDrinkingDebts}
            />

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => void handleCopyDebtsZalo()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-bold cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy tin nhắn nhắc nợ Zalo</span>
              </button>
            </div>
          </div>

          {/* KHỐI 1: TIỀN CẦU LÔNG (THẲNG THỦ QUỸ) */}
          <section className="bg-white rounded-2xl border border-emerald-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3 bg-emerald-50/70 border-b border-emerald-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-emerald-700" />
                <div>
                  <h2 className="text-sm font-bold text-emerald-950">1. Tiền Cầu lông</h2>
                  <p className="text-[11px] text-emerald-700">
                    Chuyển thẳng Thủ quỹ {treasurer?.name || ''} (không cấn trừ với tiền nhậu)
                  </p>
                </div>
              </div>
              <span className="text-sm font-extrabold text-rose-600">
                {formatVND(badmintonTotal)}
              </span>
            </div>

            {visibleMonthlyDues.length === 0 &&
            visibleGuestDues.length === 0 &&
            visibleAdhocDues.length === 0 ? (
              <div className="p-6 text-center text-xs sm:text-sm text-slate-500">
                {onlyMine ? 'Bạn không còn khoản nợ Cầu lông nào.' : 'Không còn khoản nợ Cầu lông nào.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleMonthlyDues.map((d) => {
                  const dateRef = d.issued_at || `${d.month}-01`;
                  const ov = getOverdueInfo(dateRef, todayStr);
                  const isMine = myMemberId === d.member_id;
                  return (
                    <div
                      key={d.due_id}
                      className={`p-3.5 flex items-center justify-between gap-2 flex-wrap ${
                        ov.rowClass || (isMine ? 'bg-sky-50/40' : '')
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{d.member_name}</span>
                          {isMine && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                              Bạn
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            Cầu T{d.month.slice(5, 7)}
                          </span>
                          {(d.credit_amount ?? 0) > 0 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                              Đã trừ {formatVND(d.credit_amount ?? 0)} góp cầu
                            </span>
                          )}
                          <OverdueBadge fromDate={dateRef} todayStr={todayStr} />
                        </div>
                        <p className="text-xs font-extrabold text-rose-600 mt-0.5">
                          {formatVND(d.amount)} → {treasurer?.name || 'Thủ quỹ'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenQr({
                              title: `${d.member_name} → Thủ quỹ (${treasurer?.name || ''})`,
                              subtitle: `Tiền cầu tháng ${d.month.slice(5, 7)}/${d.month.slice(0, 4)}`,
                              amount: d.amount,
                              transferContent: d.transferContent,
                              bankName: debts?.badminton.treasurerBank?.bankName || '',
                              bankBin: debts?.badminton.treasurerBank?.bankBin || '',
                              accountNo: debts?.badminton.treasurerBank?.accountNo || '',
                              accountName: debts?.badminton.treasurerBank?.accountName || '',
                              vietQrUrl: d.vietQrUrl,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>VietQR</span>
                        </button>

                        {isEditor && (
                          <button
                            type="button"
                            onClick={() => void handleMarkMonthlyDuePaid(d.due_id, d.member_name)}
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                          >
                            {busyKey === d.due_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>Đã thu</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {visibleGuestDues.map((g) => {
                  const ov = getOverdueInfo(g.session_date, todayStr);
                  const isMine = myMemberId === g.member_id;
                  return (
                    <div
                      key={g.attendance_id}
                      className={`p-3.5 flex items-center justify-between gap-2 flex-wrap ${
                        ov.rowClass || (isMine ? 'bg-sky-50/40' : '')
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{g.member_name}</span>
                          {isMine && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                              Bạn
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            Vãng lai {formatShortDateVN(g.session_date)}
                          </span>
                          <OverdueBadge fromDate={g.session_date} todayStr={todayStr} />
                        </div>
                        <p className="text-xs font-extrabold text-rose-600 mt-0.5">
                          {formatVND(g.amount)} → {treasurer?.name || 'Thủ quỹ'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenQr({
                              title: `${g.member_name} → Thủ quỹ (${treasurer?.name || ''})`,
                              subtitle: `${g.session_title} (${formatDateVN(g.session_date)})`,
                              amount: g.amount,
                              transferContent: g.transferContent,
                              bankName: debts?.badminton.treasurerBank?.bankName || '',
                              bankBin: debts?.badminton.treasurerBank?.bankBin || '',
                              accountNo: debts?.badminton.treasurerBank?.accountNo || '',
                              accountName: debts?.badminton.treasurerBank?.accountName || '',
                              vietQrUrl: g.vietQrUrl,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>VietQR</span>
                        </button>

                        {isEditor && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleMarkGuestDuePaid(
                                g.attendance_id,
                                g.member_id,
                                g.amount,
                                g.member_name,
                                g.session_id
                              )
                            }
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                          >
                            {busyKey === g.attendance_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>Đã thu</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {visibleAdhocDues.map((a) => {
                  const ov = getOverdueInfo(a.session_date, todayStr);
                  const isMine = myMemberId === a.member_id;
                  return (
                    <div
                      key={a.attendance_id}
                      className={`p-3.5 flex items-center justify-between gap-2 flex-wrap ${
                        ov.rowClass || (isMine ? 'bg-sky-50/40' : '')
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{a.member_name}</span>
                          {isMine && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                              Bạn
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                            Phát sinh {formatShortDateVN(a.session_date)}
                          </span>
                          <OverdueBadge fromDate={a.session_date} todayStr={todayStr} />
                        </div>
                        <p className="text-xs font-extrabold text-rose-600 mt-0.5">
                          {formatVND(a.amount)} → {a.creditor_name}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>VietQR</span>
                        </button>

                        {isEditor && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleMarkGuestDuePaid(
                                a.attendance_id,
                                a.member_id,
                                a.amount,
                                a.member_name,
                                a.session_id,
                                a.creditor_id
                              )
                            }
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                          >
                            {busyKey === a.attendance_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>Đã thu</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* KHỐI 2: TIỀN ĂN NHẬU (TỐI ƯU NỘI BỘ NHÓM NHẬU) */}
          <section className="bg-white rounded-2xl border border-orange-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3 bg-orange-50/70 border-b border-orange-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-orange-600" />
                <div>
                  <h2 className="text-sm font-bold text-orange-950">2. Tiền Ăn nhậu</h2>
                  <p className="text-[11px] text-orange-700">
                    Tự cấn trừ món góp &amp; gộp các buổi nhậu chưa trả
                  </p>
                </div>
              </div>
              <span className="text-sm font-extrabold text-rose-600">
                {formatVND(drinkingTotal)}
              </span>
            </div>

            {visibleDrinkingTransfers.length === 0 ? (
              <div className="p-6 text-center text-xs sm:text-sm text-slate-500">
                {onlyMine ? 'Bạn không còn khoản nợ Ăn nhậu nào.' : 'Không còn khoản nợ Ăn nhậu nào.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleDrinkingTransfers.map((tr) => {
                  const key = `${tr.fromMember.member_id}-${tr.toMember.member_id}`;
                  const isExpanded = expandedTransferKey === key;
                  const isBusy = busyKey === key;
                  const oldestDate = tr.breakdownSessions.map((b) => b.sessionDate).sort()[0];
                  const ov = oldestDate ? getOverdueInfo(oldestDate, todayStr) : null;
                  const isMine = myMemberId === tr.fromMember.member_id;
                  return (
                    <div
                      key={key}
                      className={`p-4 space-y-3 ${ov?.rowClass || (isMine ? 'bg-sky-50/40' : '')}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-base font-bold text-slate-900">
                              {tr.fromMember.name}
                            </span>
                            {isMine && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                                Bạn
                              </span>
                            )}
                            <ArrowRight className="w-4 h-4 text-slate-400" />
                            <span className="text-base font-bold text-orange-700">
                              {tr.toMember.name}
                            </span>
                            {oldestDate && <OverdueBadge fromDate={oldestDate} todayStr={todayStr} />}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            Nội dung CK: <span className="font-mono">{tr.transferContent}</span>
                          </p>
                        </div>

                        <p className="text-lg font-extrabold text-rose-600 shrink-0">
                          {formatVND(tr.amount)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setExpandedTransferKey(isExpanded ? null : key)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                          <span>Chi tiết ({tr.breakdownSessions.length})</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenQr({
                                title: `${tr.fromMember.name} → ${tr.toMember.name}`,
                                subtitle: `Tiền nhậu (${tr.breakdownSessions.length} buổi)`,
                                amount: tr.amount,
                                transferContent: tr.transferContent,
                                bankName: tr.toMember.bank_name,
                                bankBin: tr.toMember.bank_bin,
                                accountNo: tr.toMember.account_no,
                                accountName: tr.toMember.account_name || tr.toMember.name,
                                vietQrUrl: tr.vietQrUrl,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" />
                            <span>VietQR</span>
                          </button>

                          {isEditor && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmDrinkingTransfer(tr)}
                              disabled={Boolean(busyKey)}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                            >
                              {isBusy ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                              <span>Xác nhận đã chuyển</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="bg-slate-50 rounded-xl p-3 space-y-2 border border-slate-100">
                          {tr.breakdownSessions.map((b, idx) => (
                            <div
                              key={`${b.attendanceId}-${idx}`}
                              className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-slate-200/70 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800 truncate">
                                  {formatShortDateVN(b.sessionDate)} • {b.sessionTitle}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  Phần chia: {formatVND(b.perPersonAmount)} • Đã góp:{' '}
                                  {formatVND(b.contributedAmount)}
                                </p>
                              </div>
                              <span className="font-bold text-rose-600 shrink-0">
                                {formatVND(b.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {((debts?.badminton.recentSettlements?.length ?? 0) > 0 ||
            (debts?.drinking.recentSettlements.length ?? 0) > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Đã thanh toán gần đây</h3>
                <span className="text-[11px] text-slate-400">
                  {isEditor ? 'Bấm Hoàn tác nếu gạch nhầm' : 'Lịch sử thu'}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  ...(debts?.badminton.recentSettlements || []),
                  ...(debts?.drinking.recentSettlements || []),
                ]
                  .sort((a, b) => (b.settled_at || '').localeCompare(a.settled_at || ''))
                  .slice(0, 8)
                  .map((st) => {
                    const label = `${st.from_name || st.from_member_id} → ${
                      st.to_name || st.to_member_id
                    } (${formatVND(st.amount)})`;
                    const isUndoing = busyKey === `undo-${st.settlement_id}`;
                    return (
                      <div
                        key={st.settlement_id}
                        className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-800 truncate">
                              {st.from_name || st.from_member_id} → {st.to_name || st.to_member_id}
                            </span>
                            {st.category && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  st.category === 'BADMINTON'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-orange-50 text-orange-700'
                                }`}
                              >
                                {st.category === 'BADMINTON' ? 'Cầu lông' : 'Ăn nhậu'}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-400">
                            {formatDateVN(st.settled_at)} • {st.method}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold text-emerald-700">
                            {formatVND(st.amount)}
                          </span>
                          {isEditor && (
                            <button
                              type="button"
                              onClick={() => void handleUndoSettlement(st.settlement_id, label)}
                              disabled={Boolean(busyKey)}
                              title="Hoàn tác gạch nợ"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                            >
                              {isUndoing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              <span>Hoàn tác</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LỊCH SỬ CÁC BUỔI */}
      {subTab === 'SESSIONS' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'ALL' as const, label: 'Tất cả' },
                { id: 'BADMINTON' as const, label: 'Cầu lông' },
                { id: 'DRINKING' as const, label: 'Ăn nhậu' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => handleSelectSessionFilter(pill.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                    sessionFilter === pill.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredSessions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                Chưa có buổi chơi nào trong danh sách.
              </div>
            ) : (
              filteredSessions.map((s) => {
                const unpaidDrinkCount = (unpaidDrinkingBySession.get(s.session_id) || []).filter(
                  (a) => a.net_amount > 0
                ).length;
                const unpaidBadGuestCount = unpaidBadmintonGuestBySession.get(s.session_id) || 0;
                const unpaidCount = s.type === 'BADMINTON' ? unpaidBadGuestCount : unpaidDrinkCount;
                const isExpanded = expandedSessionId === s.session_id;
                const detail = sessionDetailCache[s.session_id];
                const isBadminton = s.type === 'BADMINTON';

                let parsedCost: BadmintonCostDetail | null = null;
                if (isBadminton && s.cost_detail) {
                  try {
                    parsedCost = JSON.parse(s.cost_detail) as BadmintonCostDetail;
                  } catch {
                    parsedCost = null;
                  }
                }

                return (
                  <div
                    key={s.session_id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
                  >
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              isBadminton
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-orange-50 text-orange-600'
                            }`}
                          >
                            {isBadminton ? (
                              <Trophy className="w-4 h-4" />
                            ) : s.venue_type === 'HOME' ? (
                              <Home className="w-4 h-4" />
                            ) : (
                              <Utensils className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isBadminton
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-orange-50 text-orange-700'
                                }`}
                              >
                                {isBadminton
                                  ? 'Cầu lông'
                                  : s.venue_type === 'HOME'
                                  ? 'Nhậu ở nhà'
                                  : 'Nhậu quán'}
                              </span>
                              {isBadminton && s.billing_mode === 'AD_HOC' && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                                  Phát sinh
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                <Calendar className="w-3 h-3" />
                                {formatDateVN(s.date)}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 mt-1">{s.title}</h3>
                            {s.receipt_summary && (
                              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                {s.receipt_summary}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-base font-extrabold text-slate-900">
                            {formatVND(s.total_amount)}
                          </p>
                          {((!isBadminton && s.per_person_amount > 0) ||
                            (isBadminton && s.billing_mode === 'AD_HOC' && s.per_person_amount > 0)) && (
                            <p
                              className={`text-[11px] font-semibold ${
                                isBadminton ? 'text-sky-700' : 'text-orange-600'
                              }`}
                            >
                              {formatVND(s.per_person_amount)}/người
                            </p>
                          )}
                          {isBadminton && s.court_amount > 0 && (
                            <p className="text-[11px] text-slate-500">
                              Sân {formatVND(s.court_amount)} • Cầu {formatVND(s.shuttle_amount)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            {s.attendee_count} người
                          </span>

                          {isBadminton &&
                          s.billing_mode === 'AD_HOC' &&
                          s.total_amount === 0 &&
                          s.attendee_count === 0 ? (
                            <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg">
                              Chưa chốt / Dự kiến
                            </span>
                          ) : unpaidCount === 0 ? (
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                              {isBadminton
                                ? s.billing_mode === 'AD_HOC'
                                  ? 'Đã thu đủ'
                                  : 'Vãng lai đã thu đủ'
                                : 'Đã tất toán'}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg">
                              Chưa thu {unpaidCount} người
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {s.receipt_url && (
                            <a
                              href={s.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              <span>Hóa đơn</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}

                          {isEditor && (
                            <>
                              <button
                                type="button"
                                onClick={() => onEditSession(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteSession(s)}
                                disabled={busyKey === s.session_id}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Xóa</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleToggleSessionDetail(s.session_id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            <span>Chi tiết</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 space-y-3">
                        {isBadminton && parsedCost && (
                          <div className="bg-white rounded-xl p-3 border border-slate-200/80 text-xs space-y-1">
                            <p className="font-bold text-slate-700">Chi tiết chi phí buổi cầu:</p>
                            {parsedCost.courtLines.map((cl, i) => (
                              <p key={i} className="text-slate-600">
                                • {cl.label}: {cl.courts} sân × {cl.hours}h ×{' '}
                                {formatVND(cl.pricePerHour)} ={' '}
                                <span className="font-semibold">
                                  {formatVND(cl.amount ?? cl.courts * cl.hours * cl.pricePerHour)}
                                </span>
                              </p>
                            ))}
                            <p className="text-slate-600">
                              • Cầu: {s.shuttle_qty} quả ={' '}
                              <span className="font-semibold">{formatVND(s.shuttle_amount)}</span>
                              {s.other_amount > 0 && ` • Khác: ${formatVND(s.other_amount)}`}
                            </p>
                          </div>
                        )}

                        {loadingSessionId === s.session_id ? (
                          <p className="text-xs text-slate-500">Đang tải chi tiết...</p>
                        ) : detail ? (
                          <>
                            {!isBadminton && detail.items.length > 0 && (
                              <div className="bg-white rounded-xl p-3 border border-slate-200/80 text-xs space-y-1">
                                <p className="font-bold text-slate-700">Các khoản góp món / hóa đơn:</p>
                                {detail.items.map((it) => (
                                  <div
                                    key={it.item_id}
                                    className="flex items-center justify-between text-slate-600"
                                  >
                                    <span>
                                      • <span className="font-semibold">{it.member_name}</span>:{' '}
                                      {it.item_name}
                                    </span>
                                    <span className="font-bold text-slate-900">
                                      {formatVND(it.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {detail.attendances.map((a) => {
                                const drinkNet = a.net_amount || a.fee_amount;
                                return (
                                  <div
                                    key={a.attendance_id}
                                    className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200/70 text-xs"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-semibold text-slate-800 truncate">
                                        {a.member_name || a.member_id}
                                      </span>
                                      {a.member_type_snapshot === 'GUEST' && (
                                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded shrink-0">
                                          Vãng lai
                                        </span>
                                      )}
                                    </div>

                                    {isBadminton ? (
                                      a.fee_amount === 0 ? (
                                        <span className="text-slate-400 shrink-0">Hóa đơn tháng</span>
                                      ) : a.is_paid ? (
                                        <span className="font-semibold text-emerald-700 shrink-0">
                                          {s.billing_mode === 'AD_HOC' && a.member_id === s.payer_id
                                            ? 'Người ứng tiền'
                                            : `Đã trả (${formatVND(a.fee_amount)})`}
                                        </span>
                                      ) : (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span className="font-semibold text-rose-600">
                                            Nợ {formatVND(a.fee_amount)}
                                          </span>
                                          {isEditor && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void handleMarkGuestDuePaid(
                                                  a.attendance_id,
                                                  a.member_id,
                                                  a.fee_amount,
                                                  a.member_name || a.member_id,
                                                  a.session_id,
                                                  a.creditor_id || s.payer_id
                                                )
                                              }
                                              disabled={Boolean(busyKey)}
                                              className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                                            >
                                              Đã thu
                                            </button>
                                          )}
                                        </div>
                                      )
                                    ) : a.is_paid ? (
                                      <span className="font-semibold text-emerald-700 shrink-0">
                                        {drinkNet === 0
                                          ? 'Hòa (0đ)'
                                          : 'Đã tất toán'}
                                      </span>
                                    ) : drinkNet < 0 ? (
                                      <span className="font-bold text-emerald-700 shrink-0">
                                        Nhận {formatVND(-drinkNet)}
                                      </span>
                                    ) : (
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="font-bold text-rose-600">
                                          Trả {formatVND(drinkNet)}
                                        </span>
                                        {isEditor && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleMarkDrinkingAttPaid(
                                                a,
                                                s.payer_id || debts?.treasurerMemberId || ''
                                              )
                                            }
                                            disabled={Boolean(busyKey)}
                                            className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                                          >
                                            Đã thu
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400">Không có dữ liệu chi tiết.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
