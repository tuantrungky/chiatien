/**
 * overdue.ts
 * Tính số ngày quá hạn và mức độ cảnh báo (10, 15, 20, 30+ ngày)
 * để hiển thị badge đổi màu / nhấp nháy nhắc nhau đóng tiền đúng hạn.
 */

import { getTodayDateStr } from './dateFilters';

export type OverdueSeverity = 'NONE' | 'WARN_10' | 'WARN_15' | 'DANGER_20' | 'CRITICAL_30';

export interface OverdueInfo {
  days: number;
  severity: OverdueSeverity;
  label: string;
  badgeClass: string;
  rowClass: string;
  emoji: string;
}

function parseYmdToUtcDay(dateInput: string): number | null {
  const s = String(dateInput || '').trim().slice(0, 10);
  let normalized = s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    normalized = `${s}-01`;
  }
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return Math.floor(Date.UTC(y, mo - 1, d) / (1000 * 60 * 60 * 24));
}

export function getDaysOverdue(fromDateStr: string, todayStr?: string): number {
  const fromDay = parseYmdToUtcDay(fromDateStr);
  const toDay = parseYmdToUtcDay(todayStr || getTodayDateStr());
  if (fromDay === null || toDay === null) return 0;
  return Math.max(0, toDay - fromDay);
}

export function getOverdueInfo(fromDateStr: string, todayStr?: string): OverdueInfo {
  const days = getDaysOverdue(fromDateStr, todayStr);

  if (days >= 30) {
    return {
      days,
      severity: 'CRITICAL_30',
      label: `Quá 1 tháng (${days} ngày)`,
      badgeClass: 'bg-red-700 text-white ring-2 ring-red-300 animate-pulse',
      rowClass: 'bg-red-50/90 border-l-4 border-l-red-600',
      emoji: '🚨',
    };
  }
  if (days >= 20) {
    return {
      days,
      severity: 'DANGER_20',
      label: `Quá ${days} ngày`,
      badgeClass: 'bg-rose-600 text-white animate-pulse',
      rowClass: 'bg-rose-50/75 border-l-4 border-l-rose-500',
      emoji: '🔥',
    };
  }
  if (days >= 15) {
    return {
      days,
      severity: 'WARN_15',
      label: `Quá ${days} ngày`,
      badgeClass: 'bg-orange-100 text-orange-800 border border-orange-300',
      rowClass: 'bg-orange-50/60 border-l-4 border-l-orange-400',
      emoji: '⚠️',
    };
  }
  if (days >= 10) {
    return {
      days,
      severity: 'WARN_10',
      label: `Quá ${days} ngày`,
      badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300',
      rowClass: 'bg-amber-50/45',
      emoji: '⏰',
    };
  }

  return {
    days,
    severity: 'NONE',
    label: '',
    badgeClass: '',
    rowClass: '',
    emoji: '',
  };
}
