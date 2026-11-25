/**
 * dateFilters.ts
 * Bộ lọc và điều hướng kỳ báo cáo: Tuần (T2-CN), Tháng, Quý, Năm, Tất cả.
 */

import type { PeriodRange, PeriodType } from '../types';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(dateStr: string): Date {
  const match = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function getTodayDateStr(): string {
  return formatYmd(new Date());
}

/**
 * Định dạng YYYY-MM-DD -> DD/MM/YYYY
 */
export function formatDateVN(dateStr: string): string {
  if (!dateStr) return '';
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Định dạng YYYY-MM-DD -> DD/MM
 */
export function formatShortDateVN(dateStr: string): string {
  if (!dateStr) return '';
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  return `${match[3]}/${match[2]}`;
}

/**
 * Tính khoảng ngày bắt đầu - kết thúc và nhãn tiếng Việt cho bộ lọc Tuần / Tháng / Quý / Năm / Tất cả.
 */
export function getPeriodRange(periodType: PeriodType, refDate?: string | Date): PeriodRange {
  if (periodType === 'ALL') {
    return {
      type: 'ALL',
      startDate: null,
      endDate: null,
      label: 'Tất cả thời gian',
    };
  }

  const base = refDate instanceof Date
    ? new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate())
    : (typeof refDate === 'string' && refDate ? parseYmd(refDate) : parseYmd(getTodayDateStr()));

  const year = base.getFullYear();
  const month = base.getMonth() + 1; // 1..12
  const day = base.getDate();

  if (periodType === 'WEEK') {
    const jsDay = base.getDay(); // 0=CN, 1=T2..6=T7
    const diffToMon = jsDay === 0 ? -6 : 1 - jsDay;
    const monday = new Date(year, month - 1, day + diffToMon);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const startDate = formatYmd(monday);
    const endDate = formatYmd(sunday);
    return {
      type: 'WEEK',
      startDate,
      endDate,
      label: `Tuần ${pad2(monday.getDate())}/${pad2(monday.getMonth() + 1)} - ${pad2(sunday.getDate())}/${pad2(sunday.getMonth() + 1)}`,
    };
  }

  if (periodType === 'QUARTER') {
    const q = Math.floor((month - 1) / 3) + 1;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const lastDayQ = new Date(year, endMonth, 0).getDate();
    return {
      type: 'QUARTER',
      startDate: `${year}-${pad2(startMonth)}-01`,
      endDate: `${year}-${pad2(endMonth)}-${pad2(lastDayQ)}`,
      label: `Quý ${q}/${year}`,
    };
  }

  if (periodType === 'YEAR') {
    return {
      type: 'YEAR',
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      label: `Năm ${year}`,
    };
  }

  // MONTH
  const lastDayM = new Date(year, month, 0).getDate();
  return {
    type: 'MONTH',
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(lastDayM)}`,
    label: `Tháng ${pad2(month)}/${year}`,
  };
}

/**
 * Dịch chuyển ngày tham chiếu tiến (+1) hoặc lùi (-1) theo kỳ đang chọn
 * để hỗ trợ nút chọn tuần/tháng/quý/năm bất kỳ.
 */
export function shiftPeriodDate(periodType: PeriodType, refDate: string, delta: number): string {
  const d = parseYmd(refDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  switch (periodType) {
    case 'WEEK':
      return formatYmd(new Date(year, month, day + delta * 7));
    case 'MONTH':
      return formatYmd(new Date(year, month + delta, 1));
    case 'QUARTER':
      return formatYmd(new Date(year, month + delta * 3, 1));
    case 'YEAR':
      return formatYmd(new Date(year + delta, 0, 1));
    case 'ALL':
    default:
      return formatYmd(d);
  }
}

export function isDateInRange(dateStr: string, range: PeriodRange): boolean {
  if (!dateStr) return false;
  const clean = String(dateStr).trim().slice(0, 10);
  if (range.startDate && clean < range.startDate) return false;
  if (range.endDate && clean > range.endDate) return false;
  return true;
}

export function filterByPeriod<T>(
  items: T[],
  getDate: (item: T) => string,
  periodType: PeriodType,
  refDate?: string | Date
): T[] {
  const range = getPeriodRange(periodType, refDate);
  if (range.type === 'ALL') return items;
  return items.filter((item) => isDateInRange(getDate(item), range));
}
