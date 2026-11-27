import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { saveMonthlyContributions } from '../../services/api';
import type { Member, ShuttleContributionItem } from '../../types';

export interface MonthlyContributionsModalProps {
  activeMonth: string;
  contributions: ShuttleContributionItem[];
  members: Member[];
  onClose: () => void;
  onSuccess: () => Promise<boolean | void>;
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  return `Tháng ${m}/${y}`;
}

/** Modal ghi nhận danh sách thành viên góp ống cầu trong tháng để trừ vào tháng kế tiếp. */
export function MonthlyContributionsModal({
  activeMonth,
  contributions,
  members,
  onClose,
  onSuccess,
}: MonthlyContributionsModalProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();

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

  const [contribDrafts, setContribDrafts] = useState<ShuttleContributionItem[]>(() => {
    if (contributions.length > 0) {
      return contributions.map((c) => ({ ...c }));
    }
    const first = mainMembers[0] || activeMembers[0];
    return first
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
      : [];
  });
  const [busy, setBusy] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    setBusy(true);
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
      onClose();
      await onSuccess();
      toast.success(`Đã lưu danh sách góp ống cầu ${formatMonthLabel(activeMonth)}.`);
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
            onClick={onClose}
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
                          i === idx ? { ...it, amount: Number(e.target.value) || 0 } : it
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
          disabled={busy}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
        >
          {busy ? 'Đang lưu...' : 'Lưu danh sách góp ống cầu'}
        </button>
      </form>
    </div>
  );
}
