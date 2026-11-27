import { useState } from 'react';
import { Calendar, RotateCcw, Search, SlidersHorizontal, UserCheck, X } from 'lucide-react';
import {
  DEFAULT_DEBT_FILTER,
  countActiveDebtFilters,
  type CollectorOption,
  type DateFilterOption,
  type DebtCategoryCounts,
  type DebtFilterState,
  type DebtSourceFilter,
} from '../utils/debtFilters';

interface DebtFilterBarProps {
  filters: DebtFilterState;
  onChange: (next: DebtFilterState) => void;
  collectorOptions: CollectorOption[];
  dateOptions: DateFilterOption[];
  categoryCounts: DebtCategoryCounts;
  totalFilteredCount: number;
  totalUnfilteredCount: number;
}

export function DebtFilterBar({
  filters,
  onChange,
  collectorOptions,
  dateOptions,
  categoryCounts,
  totalFilteredCount,
  totalUnfilteredCount,
}: DebtFilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeCount = countActiveDebtFilters(filters);
  const advancedCount = (filters.collectorId ? 1 : 0) + (filters.dateFilter ? 1 : 0);
  const advancedVisible = showAdvanced || advancedCount > 0;

  const sourcePills: Array<{ id: DebtSourceFilter; label: string; count: number }> = [
    { id: 'ALL', label: 'Tất cả', count: categoryCounts.all },
    { id: 'FIXED', label: 'Cố định', count: categoryCounts.fixed },
    { id: 'ADHOC', label: 'Phát sinh', count: categoryCounts.adhoc },
    { id: 'GUEST', label: 'Vãng lai', count: categoryCounts.guest },
    { id: 'DRINKING', label: 'Ăn nhậu', count: categoryCounts.drinking },
  ];

  return (
    <section
      aria-label="Bộ lọc công nợ"
      className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5 shadow-xs"
    >
      {/* Hàng 1: Tìm theo tên + Nút mở lọc nâng cao (mobile) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={filters.searchName}
            onChange={(e) => onChange({ ...filters, searchName: e.target.value })}
            placeholder="Tìm tên người nợ (không dấu)..."
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#1d5fa7]"
          />
          {filters.searchName && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, searchName: '' })}
              aria-label="Xóa từ khóa tìm tên"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-slate-200/70 flex items-center justify-center text-slate-500 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={advancedVisible}
          className={`sm:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold shrink-0 cursor-pointer transition ${
            advancedVisible
              ? 'bg-[#eef5fc] border-[#1d5fa7]/40 text-[#113b66]'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Lọc</span>
          {advancedCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#113b66] text-white text-[10px] font-bold flex items-center justify-center">
              {advancedCount}
            </span>
          )}
        </button>
      </div>

      {/* Hàng 2: Dải pill lọc nguồn (Cố định / Phát sinh / Vãng lai / Ăn nhậu) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {sourcePills.map((pill) => {
          const active = filters.sourceFilter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => onChange({ ...filters, sourceFilter: pill.id })}
              className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                active
                  ? 'bg-[#113b66] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
              }`}
            >
              <span>{pill.label}</span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  active ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
                }`}
              >
                {pill.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hàng 3: Chọn Người thu tiền & Ngày/Tháng */}
      <div
        className={`${
          advancedVisible ? 'grid' : 'hidden sm:grid'
        } grid-cols-1 sm:grid-cols-2 gap-2`}
      >
        <div className="relative">
          <UserCheck className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            aria-label="Lọc theo người thu tiền"
            value={filters.collectorId}
            onChange={(e) => onChange({ ...filters, collectorId: e.target.value })}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#1d5fa7]"
          >
            <option value="">Tất cả người thu tiền</option>
            {collectorOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isTreasurer ? ' (Thủ quỹ)' : ''} • {c.count} khoản
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            aria-label="Lọc theo ngày hoặc tháng"
            value={filters.dateFilter}
            onChange={(e) => onChange({ ...filters, dateFilter: e.target.value })}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#1d5fa7]"
          >
            <option value="">Tất cả ngày / tháng</option>
            {dateOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} ({d.count} khoản)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Hàng 4: Trạng thái & Xóa bộ lọc */}
      {activeCount > 0 && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px]">
          <span className="font-semibold text-slate-600">
            Đang lọc:{' '}
            <strong className="text-[#113b66]">
              {totalFilteredCount}/{totalUnfilteredCount}
            </strong>{' '}
            khoản nợ
          </span>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_DEBT_FILTER)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Xóa bộ lọc</span>
          </button>
        </div>
      )}
    </section>
  );
}
