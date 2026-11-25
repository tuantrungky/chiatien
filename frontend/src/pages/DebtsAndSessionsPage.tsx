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
  Loader2,
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
import { confirmPayment, deleteSession, fetchSessionDetail } from '../services/api';
import type {
  Attendance,
  DebtsData,
  Session,
  SessionDetailData,
  SimplifiedDebtResult,
} from '../types';
import { formatDateVN, formatShortDateVN } from '../utils/dateFilters';
import { formatVND } from '../utils/vietqr';

interface DebtsAndSessionsPageProps {
  simplifiedDebts: SimplifiedDebtResult;
  debts: DebtsData | null;
  sessions: Session[];
  onOpenQr: (data: VietQRModalData) => void;
  onRefreshAll: () => Promise<void>;
  onEditSession: (session: Session) => void;
}

export function DebtsAndSessionsPage({
  simplifiedDebts,
  debts,
  sessions,
  onOpenQr,
  onRefreshAll,
  onEditSession,
}: DebtsAndSessionsPageProps) {
  const { isEditor, idToken, handleApiError } = useAuth();
  const toast = useToast();
  const [subTab, setSubTab] = useState<'SIMPLIFIED' | 'SESSIONS'>('SIMPLIFIED');
  const [expandedTransferKey, setExpandedTransferKey] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'ALL' | 'BADMINTON' | 'DRINKING'>('ALL');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionDetailCache, setSessionDetailCache] = useState<Record<string, SessionDetailData>>({});
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const unpaidBySession = useMemo(() => {
    const map = new Map<string, Attendance[]>();
    for (const att of debts?.unpaidAttendances || []) {
      if (!map.has(att.session_id)) map.set(att.session_id, []);
      map.get(att.session_id)!.push(att);
    }
    return map;
  }, [debts]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => sessionFilter === 'ALL' || s.type === sessionFilter);
  }, [sessions, sessionFilter]);

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
        // Không crash nếu lỗi mạng
      } finally {
        setLoadingSessionId(null);
      }
    }
  };

  const handleConfirmSimplified = async (tr: SimplifiedDebtResult['transfers'][number]) => {
    if (!isEditor || !idToken || busyKey) return;
    const key = `${tr.fromMember.member_id}-${tr.toMember.member_id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        mode: 'SIMPLIFIED_TRANSFER',
        fromMemberId: tr.fromMember.member_id,
        toMemberId: tr.toMember.member_id,
        amount: tr.amount,
        method: 'VIETQR',
        transferContent: tr.transferContent,
      });
      setSessionDetailCache({});
      await onRefreshAll();
      toast.success(`Đã xác nhận ${tr.fromMember.name} chuyển ${formatVND(tr.amount)} cho ${tr.toMember.name}.`);
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleMarkAttendancePaid = async (att: Attendance) => {
    if (!isEditor || !idToken || busyKey) return;
    setBusyKey(att.attendance_id);
    setActionError(null);
    try {
      await confirmPayment(idToken, {
        mode: 'ITEMS',
        fromMemberId: att.member_id,
        toMemberId: att.creditor_id || debts?.treasurerMemberId || '',
        attendanceIds: [att.attendance_id],
        amount: att.fee_amount,
        method: 'CASH',
        note: `Thu trực tiếp buổi ${att.session_date}`,
      });
      await handleToggleSessionDetail(att.session_id, true);
      await onRefreshAll();
      toast.success(`Đã gạch nợ cho ${att.member_name || att.member_id}.`);
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

  return (
    <div className="space-y-4">
      {/* Segmented Switcher */}
      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('SIMPLIFIED')}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            subTab === 'SIMPLIFIED'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Tối ưu chuyển khoản ({simplifiedDebts.transfers.length})</span>
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

      {/* TAB 1: TỐI ƯU CHUYỂN KHOẢN */}
      {subTab === 'SIMPLIFIED' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-3 shadow-xs">
            <div>
              <p className="text-xs text-slate-500 font-medium">Tổng công nợ cần tất toán</p>
              <p className="text-xl font-extrabold text-rose-600 mt-0.5">
                {formatVND(simplifiedDebts.totalOutstanding)}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                {simplifiedDebts.transfers.length} lệnh chuyển
              </span>
            </div>
          </div>

          {simplifiedDebts.transfers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              Không còn khoản nợ nào chưa thanh toán.
            </div>
          ) : (
            <div className="space-y-3">
              {simplifiedDebts.transfers.map((tr) => {
                const key = `${tr.fromMember.member_id}-${tr.toMember.member_id}`;
                const isExpanded = expandedTransferKey === key;
                const isBusy = busyKey === key;
                return (
                  <div
                    key={key}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
                  >
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-base font-bold text-slate-900">
                              {tr.fromMember.name}
                            </span>
                            <ArrowRight className="w-4 h-4 text-slate-400" />
                            <span className="text-base font-bold text-emerald-700">
                              {tr.toMember.name}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            Nội dung CK: <span className="font-mono">{tr.transferContent}</span>
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-lg font-extrabold text-rose-600">
                            {formatVND(tr.amount)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setExpandedTransferKey(isExpanded ? null : key)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
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
                                subtitle: `Tối ưu ${tr.breakdownSessions.length} khoản nợ`,
                                amount: tr.amount,
                                transferContent: tr.transferContent,
                                bankName: tr.toMember.bank_name,
                                bankBin: tr.toMember.bank_bin,
                                accountNo: tr.toMember.account_no,
                                accountName: tr.toMember.account_name || tr.toMember.name,
                                vietQrUrl: tr.vietQrUrl,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs active:scale-95 transition cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" />
                            <span>VietQR</span>
                          </button>

                          {isEditor && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmSimplified(tr)}
                              disabled={Boolean(busyKey)}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs active:scale-95 transition cursor-pointer disabled:opacity-60"
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
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          Các khoản nợ của {tr.fromMember.name} được cộng dồn:
                        </p>
                        {tr.breakdownSessions.map((b, idx) => (
                          <div
                            key={`${b.attendanceId || b.ledgerId || idx}`}
                            className="flex items-center justify-between gap-2 bg-white rounded-xl px-3 py-2 border border-slate-200/70 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                                    b.sessionType === 'BADMINTON'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : b.sessionType === 'DRINKING'
                                      ? 'bg-orange-50 text-orange-700'
                                      : 'bg-purple-50 text-purple-700'
                                  }`}
                                >
                                  {b.sessionType === 'BADMINTON'
                                    ? 'Cầu lông'
                                    : b.sessionType === 'DRINKING'
                                    ? 'Ăn nhậu'
                                    : 'Hoàn ứng'}
                                </span>
                                <span className="text-slate-400">
                                  {formatShortDateVN(b.sessionDate)}
                                </span>
                              </div>
                              <p className="font-semibold text-slate-800 truncate mt-0.5">
                                {b.sessionTitle}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                Người ứng: {b.originalCreditorName}
                              </p>
                            </div>
                            <span className="font-bold text-slate-900 shrink-0">
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

          {debts && debts.recentSettlements.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Đã thanh toán gần đây</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {debts.recentSettlements.slice(0, 6).map((st) => (
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
          <div className="flex items-center gap-2">
            {[
              { id: 'ALL' as const, label: 'Tất cả' },
              { id: 'BADMINTON' as const, label: 'Cầu lông' },
              { id: 'DRINKING' as const, label: 'Ăn nhậu' },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setSessionFilter(pill.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                  sessionFilter === pill.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredSessions.map((s) => {
              const unpaidList = unpaidBySession.get(s.session_id) || [];
              const isExpanded = expandedSessionId === s.session_id;
              const detail = sessionDetailCache[s.session_id];
              const isBadminton = s.type === 'BADMINTON';

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
                              {isBadminton ? 'Cầu lông' : 'Ăn nhậu'}
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
                        {isBadminton && (
                          <p className="text-[11px] text-slate-500">
                            Vãng lai: {formatVND(s.guest_fee)}
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

                        {unpaidList.length === 0 ? (
                          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                            Đã thu đủ
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg">
                            Chưa thu {unpaidList.length} người
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
                          <span>Người đi</span>
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
                    <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                      {loadingSessionId === s.session_id ? (
                        <p className="text-xs text-slate-500">Đang tải danh sách điểm danh...</p>
                      ) : detail ? (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold text-slate-500 uppercase">
                            Người ứng / nhận tiền: {s.payer_name || s.payer_id}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {detail.attendances.map((a) => (
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

                                {a.fee_amount === 0 ? (
                                  <span className="text-slate-400 shrink-0">Quỹ tháng</span>
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
                                        onClick={() => void handleMarkAttendancePaid(a)}
                                        disabled={Boolean(busyKey)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                                      >
                                        {busyKey === a.attendance_id ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Check className="w-3 h-3" />
                                        )}
                                        <span>Đã thu</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">Không có dữ liệu chi tiết.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
