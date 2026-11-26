import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  History,
  Home,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  Utensils,
} from 'lucide-react';
import type { VietQRModalData } from '../components/VietQRModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { confirmPayment, deleteSession, fetchSessionDetail, markDuePaid } from '../services/api';
import type {
  Attendance,
  BadmintonCostDetail,
  BootstrapData,
  SeparatedDebtsData,
  Session,
  SessionDetailData,
  SimplifiedDebtResult,
} from '../types';
import { formatDateVN, formatShortDateVN } from '../utils/dateFilters';
import { formatVND } from '../utils/vietqr';

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
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();
  const [subTab, setSubTab] = useState<'DEBTS' | 'SESSIONS'>('DEBTS');
  const [expandedTransferKey, setExpandedTransferKey] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'ALL' | 'BADMINTON' | 'DRINKING'>('ALL');
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
    sessionId: string
  ) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(attendanceId);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        category: 'BADMINTON',
        mode: 'ITEMS',
        fromMemberId: memberId,
        toMemberId: debts?.treasurerMemberId || treasurer?.member_id || '',
        attendanceIds: [attendanceId],
        amount,
        method: 'CASH',
      });
      if (expandedSessionId === sessionId) {
        await handleToggleSessionDetail(sessionId, true);
      }
      await onRefreshAll();
      toast.success(`Đã thu phí vãng lai ${formatVND(amount)} của ${memberName}.`);
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

  const badmintonTotal = debts?.badminton.totalOutstanding ?? 0;
  const drinkingTotal = simplifiedDrinkingDebts.totalOutstanding;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('DEBTS')}
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
          onClick={() => setSubTab('SESSIONS')}
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

            {(debts?.badminton.monthlyDues.length ?? 0) === 0 &&
            (debts?.badminton.guestDues.length ?? 0) === 0 ? (
              <div className="p-6 text-center text-xs sm:text-sm text-slate-500">
                Không còn khoản nợ Cầu lông nào.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {debts?.badminton.monthlyDues.map((d) => (
                  <div
                    key={d.due_id}
                    className="p-3.5 flex items-center justify-between gap-2 flex-wrap"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900">{d.member_name}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          Cầu T{d.month.slice(5, 7)}
                        </span>
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
                            bankName: debts.badminton.treasurerBank?.bankName || '',
                            bankBin: debts.badminton.treasurerBank?.bankBin || '',
                            accountNo: debts.badminton.treasurerBank?.accountNo || '',
                            accountName: debts.badminton.treasurerBank?.accountName || '',
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
                ))}

                {debts?.badminton.guestDues.map((g) => (
                  <div
                    key={g.attendance_id}
                    className="p-3.5 flex items-center justify-between gap-2 flex-wrap"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900">{g.member_name}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          Vãng lai {formatShortDateVN(g.session_date)}
                        </span>
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
                            bankName: debts.badminton.treasurerBank?.bankName || '',
                            bankBin: debts.badminton.treasurerBank?.bankBin || '',
                            accountNo: debts.badminton.treasurerBank?.accountNo || '',
                            accountName: debts.badminton.treasurerBank?.accountName || '',
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
                ))}
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

            {simplifiedDrinkingDebts.transfers.length === 0 ? (
              <div className="p-6 text-center text-xs sm:text-sm text-slate-500">
                Không còn khoản nợ Ăn nhậu nào.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {simplifiedDrinkingDebts.transfers.map((tr) => {
                  const key = `${tr.fromMember.member_id}-${tr.toMember.member_id}`;
                  const isExpanded = expandedTransferKey === key;
                  const isBusy = busyKey === key;
                  return (
                    <div key={key} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-base font-bold text-slate-900">
                              {tr.fromMember.name}
                            </span>
                            <ArrowRight className="w-4 h-4 text-slate-400" />
                            <span className="text-base font-bold text-orange-700">
                              {tr.toMember.name}
                            </span>
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

          {debts && debts.drinking.recentSettlements.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Đã thanh toán nhậu gần đây</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {debts.drinking.recentSettlements.slice(0, 5).map((st) => (
                  <div
                    key={st.settlement_id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">
                        {st.from_name || st.from_member_id} → {st.to_name || st.to_member_id}
                      </p>
                      <p className="text-slate-400">
                        {formatDateVN(st.settled_at)} • {st.method}
                      </p>
                    </div>
                    <span className="font-bold text-emerald-700 shrink-0">
                      {formatVND(st.amount)}
                    </span>
                  </div>
                ))}
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
                  onClick={() => setSessionFilter(pill.id)}
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

            {isEditor && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onCreateNewSession('BADMINTON')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buổi cầu</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCreateNewSession('DRINKING')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buổi nhậu</span>
                </button>
              </div>
            )}
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
                          {!isBadminton && s.per_person_amount > 0 && (
                            <p className="text-[11px] text-orange-600 font-semibold">
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

                          {unpaidCount === 0 ? (
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                              {isBadminton ? 'Vãng lai đã thu đủ' : 'Đã tất toán'}
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
                                          Đã trả ({formatVND(a.fee_amount)})
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
                                                  a.session_id
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
