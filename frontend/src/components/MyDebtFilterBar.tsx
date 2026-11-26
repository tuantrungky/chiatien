import { useMemo } from 'react';
import { CheckCircle2, Filter, UserCheck, Users } from 'lucide-react';
import type { Member, SeparatedDebtsData, SimplifiedDebtResult } from '../types';
import { formatVND } from '../utils/vietqr';

interface MyDebtFilterBarProps {
  members: Member[];
  myMemberId: string | null;
  onSelectMemberId: (memberId: string | null) => void;
  viewMode: 'ALL' | 'MINE';
  onChangeViewMode: (mode: 'ALL' | 'MINE') => void;
  debts: SeparatedDebtsData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
}

export function MyDebtFilterBar({
  members,
  myMemberId,
  onSelectMemberId,
  viewMode,
  onChangeViewMode,
  debts,
  simplifiedDrinkingDebts,
}: MyDebtFilterBarProps) {
  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.is_active)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'MAIN' ? -1 : 1;
          return a.name.localeCompare(b.name, 'vi');
        }),
    [members]
  );

  const selectedMember = useMemo(
    () => members.find((m) => m.member_id === myMemberId) || null,
    [members, myMemberId]
  );

  const mySummary = useMemo(() => {
    if (!myMemberId) return { badminton: 0, drinking: 0, total: 0 };
    const monthly = (debts?.badminton.monthlyDues || [])
      .filter((d) => d.member_id === myMemberId)
      .reduce((s, d) => s + d.amount, 0);
    const guest = (debts?.badminton.guestDues || [])
      .filter((g) => g.member_id === myMemberId)
      .reduce((s, g) => s + g.amount, 0);
    const adhoc = (debts?.badminton.adhocDues || [])
      .filter((a) => a.member_id === myMemberId)
      .reduce((s, a) => s + a.amount, 0);
    const drinking = simplifiedDrinkingDebts.transfers
      .filter((tr) => tr.fromMember.member_id === myMemberId)
      .reduce((s, tr) => s + tr.amount, 0);
    const badminton = monthly + guest + adhoc;
    return { badminton, drinking, total: badminton + drinking };
  }, [myMemberId, debts, simplifiedDrinkingDebts]);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-3 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
            <UserCheck className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor="my-member-select" className="block text-[11px] font-semibold text-slate-500">
              Tôi là thành viên (lưu trên máy để xem nợ nhanh)
            </label>
            <select
              id="my-member-select"
              value={myMemberId || ''}
              onChange={(e) => {
                const nextId = e.target.value || null;
                onSelectMemberId(nextId);
                if (!nextId && viewMode === 'MINE') {
                  onChangeViewMode('ALL');
                }
              }}
              className="mt-0.5 w-full sm:max-w-xs rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">-- Chọn tên của bạn --</option>
              {activeMembers.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.name} ({m.type === 'MAIN' ? 'Cố định' : 'Vãng lai'})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="inline-flex bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => onChangeViewMode('ALL')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              viewMode === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Cả CLB (nhắc nhau)</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('MINE')}
            disabled={!myMemberId}
            title={!myMemberId ? 'Chọn tên của bạn trước để lọc nợ cá nhân' : 'Chỉ hiện khoản nợ của bạn'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
              viewMode === 'MINE'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Chỉ xem của tôi</span>
          </button>
        </div>
      </div>

      {selectedMember && (
        <div
          className={`rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border ${
            mySummary.total > 0
              ? 'bg-sky-50/70 border-sky-200'
              : 'bg-emerald-50/70 border-emerald-200'
          }`}
        >
          {mySummary.total > 0 ? (
            <>
              <div>
                <p className="text-xs font-bold text-slate-800">
                  Khoản cần chuyển của <span className="text-sky-800">{selectedMember.name}</span>:
                </p>
                <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px] text-slate-600">
                  {mySummary.badminton > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                      Cầu lông: {formatVND(mySummary.badminton)}
                    </span>
                  )}
                  {mySummary.drinking > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-semibold">
                      Ăn nhậu: {formatVND(mySummary.drinking)}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-base font-extrabold text-rose-600 shrink-0">
                {formatVND(mySummary.total)}
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{selectedMember.name} hiện không còn khoản nợ nào cần chuyển!</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
