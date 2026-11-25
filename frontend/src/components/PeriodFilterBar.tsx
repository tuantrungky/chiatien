import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PeriodType } from '../types';
import { getPeriodRange, getTodayDateStr, shiftPeriodDate } from '../utils/dateFilters';

interface PeriodFilterBarProps {
  periodType: PeriodType;
  refDate: string;
  onChangePeriodType: (type: PeriodType) => void;
  onChangeRefDate: (date: string) => void;
}

const PERIOD_OPTIONS: Array<{ value: PeriodType; label: string }> = [
  { value: 'WEEK', label: 'Tuần' },
  { value: 'MONTH', label: 'Tháng' },
  { value: 'QUARTER', label: 'Quý' },
  { value: 'YEAR', label: 'Năm' },
];

export function PeriodFilterBar({
  periodType,
  refDate,
  onChangePeriodType,
  onChangeRefDate,
}: PeriodFilterBarProps) {
  const currentRange = getPeriodRange(periodType, refDate);
  const todayStr = getTodayDateStr();
  const todayRange = getPeriodRange(periodType, todayStr);
  const isCurrentPeriod = currentRange.label === todayRange.label;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-2.5">
      {/* Segmented buttons */}
      <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl">
        {PERIOD_OPTIONS.map((opt) => {
          const active = periodType === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChangePeriodType(opt.value)}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                active
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Period navigator */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChangeRefDate(shiftPeriodDate(periodType, refDate, -1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition cursor-pointer"
          aria-label="Kỳ trước"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-sm font-bold text-slate-800 truncate">{currentRange.label}</span>
          {!isCurrentPeriod && (
            <button
              type="button"
              onClick={() => onChangeRefDate(todayStr)}
              className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-full shrink-0 cursor-pointer"
            >
              Hiện tại
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => onChangeRefDate(shiftPeriodDate(periodType, refDate, 1))}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition cursor-pointer"
          aria-label="Kỳ sau"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
