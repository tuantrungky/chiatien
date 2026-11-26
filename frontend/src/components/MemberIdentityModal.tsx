import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Search, UserCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Member } from '../types';

interface MemberIdentityModalProps {
  members: Member[];
  onLinked?: () => Promise<unknown> | void;
}

export function MemberIdentityModal({ members, onLinked }: MemberIdentityModalProps) {
  const {
    editor,
    needsMemberLink,
    linkMyMember,
    dismissMemberLinkPrompt,
    myMemberId,
  } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>(myMemberId || '');
  const [saving, setSaving] = useState(false);

  const sortedMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => m.is_active)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'MAIN' ? -1 : 1;
        return a.name.localeCompare(b.name, 'vi');
      });
  }, [members, search]);

  if (!needsMemberLink || !editor) return null;

  const handleConfirm = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const ok = await linkMyMember(selectedId);
      if (ok) {
        await onLinked?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">Bạn là ai trong CLB?</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tài khoản <span className="font-semibold text-slate-700">{editor.email}</span> chưa gắn tên thành viên. Chọn tên của bạn để lưu vào Google Sheet và xem nhanh khoản nợ cá nhân.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissMemberLinkPrompt}
            aria-label="Đóng chọn thành viên"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên của bạn..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-64">
          {sortedMembers.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">Không tìm thấy thành viên phù hợp.</p>
          ) : (
            sortedMembers.map((m) => {
              const isSelected = selectedId === m.member_id;
              return (
                <button
                  key={m.member_id}
                  type="button"
                  onClick={() => setSelectedId(m.member_id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition cursor-pointer ${
                    isSelected
                      ? 'bg-sky-50 border-sky-400 ring-1 ring-sky-300'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 truncate">{m.name}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          m.type === 'MAIN'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {m.type === 'MAIN' ? 'Cố định' : 'Vãng lai'}
                      </span>
                    </div>
                    {m.email && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        Đang gắn: {m.email}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={dismissMemberLinkPrompt}
            disabled={saving}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
          >
            Để sau
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!selectedId || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>{saving ? 'Đang lưu vào Sheet...' : 'Xác nhận tên của tôi'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
