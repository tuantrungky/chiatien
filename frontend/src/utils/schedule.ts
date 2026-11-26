/**
 * schedule.ts
 * Sinh lịch cầu lông cố định theo tháng (VD: Thứ 2, 4, 6 vào 20:00 - 21:30),
 * xác định trạng thái hiệu lực theo giờ Việt Nam (Asia/Ho_Chi_Minh),
 * và tính ước lượng tiền sân tháng từ lịch.
 */

import type { ScheduleDay, Session } from '../types';
import { getNowVN } from './dateFilters';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type EffectiveScheduleStatus =
  | 'DONE'
  | 'CANCELLED'
  | 'PAST_UNLOGGED'
  | 'ONGOING'
  | 'UPCOMING';

export interface EffectiveScheduleStatusInfo {
  status: EffectiveScheduleStatus;
  label: string;
  badgeClass: string;
  dotClass: string;
  isPast: boolean;
}

/**
 * Tính số giờ giữa startTime và endTime (VD "20:00" - "21:30" -> 1.5).
 */
export function calculateDurationHours(startTime: string, endTime: string): number {
  const parseMinutes = (t: string): number | null => {
    const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const s = parseMinutes(startTime);
  const e = parseMinutes(endTime);
  if (s === null || e === null || e <= s) return 0;
  return Math.round(((e - s) / 60) * 100) / 100;
}

/**
 * Sinh danh sách ngày trong tháng YYYY-MM khớp các thứ đã chọn (0=CN, 1=T2 ... 6=T7),
 * độc lập timezone nhờ Date.UTC. Nếu truyền fromDate (YYYY-MM-DD), bỏ qua ngày trước fromDate.
 */
export function generateMonthScheduleDates(
  monthStr: string,
  weekdays: number[],
  fromDate?: string
): string[] {
  const match = String(monthStr || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]); // 1..12
  if (month < 1 || month > 12) return [];

  const cleanFrom =
    fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate.trim()) ? fromDate.trim() : '';
  const weekdaySet = new Set(weekdays);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!weekdaySet.has(d.getUTCDay())) continue;
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    if (cleanFrom && dateStr < cleanFrom) continue;
    dates.push(dateStr);
  }
  return dates;
}

/**
 * Xác định trạng thái hiển thị thực tế của một ngày lịch cố định
 * dựa trên trạng thái Sheet, buổi cầu cố định thực tế cùng ngày và giờ Việt Nam (Asia/Ho_Chi_Minh).
 */
export function getEffectiveScheduleStatus(
  plan: ScheduleDay,
  daySessions: Session[] = [],
  nowVN: { date: string; time: string } = getNowVN()
): EffectiveScheduleStatusInfo {
  if (plan.status === 'CANCELLED') {
    return {
      status: 'CANCELLED',
      label: 'Đã hủy / Nghỉ',
      badgeClass: 'bg-slate-200 text-slate-600 line-through',
      dotClass: 'bg-slate-400',
      isPast: plan.date < nowVN.date,
    };
  }

  const hasFixedSession = daySessions.some(
    (s) => s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC'
  );
  if (plan.status === 'DONE' || hasFixedSession) {
    return {
      status: 'DONE',
      label: 'Đã diễn ra',
      badgeClass: 'bg-emerald-100 text-emerald-700',
      dotClass: 'bg-emerald-600',
      isPast: true,
    };
  }

  const isPastDay = plan.date < nowVN.date;
  const isTodayAfterEnd =
    plan.date === nowVN.date && Boolean(plan.end_time) && nowVN.time >= plan.end_time;

  if (isPastDay || isTodayAfterEnd) {
    return {
      status: 'PAST_UNLOGGED',
      label: 'Đã qua — chưa ghi buổi',
      badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300',
      dotClass: 'bg-amber-500',
      isPast: true,
    };
  }

  const isOngoingToday =
    plan.date === nowVN.date && Boolean(plan.start_time) && nowVN.time >= plan.start_time;
  if (isOngoingToday) {
    return {
      status: 'ONGOING',
      label: 'Đang diễn ra',
      badgeClass: 'bg-purple-100 text-purple-800 animate-pulse',
      dotClass: 'bg-purple-600 animate-pulse',
      isPast: false,
    };
  }

  return {
    status: 'UPCOMING',
    label: 'Sắp diễn ra',
    badgeClass: 'bg-sky-100 text-sky-700',
    dotClass: 'bg-sky-500',
    isPast: false,
  };
}

/**
 * Ước lượng tổng tiền sân tháng từ các buổi không bị hủy trong Schedule.
 */
export function estimateCourtCostFromSchedule(
  days: ScheduleDay[],
  courtPricePerHour: number
): number {
  const price = Math.max(0, Number(courtPricePerHour) || 0);
  if (price <= 0) return 0;
  return days.reduce((sum, day) => {
    if (day.status === 'CANCELLED') return sum;
    const hours = calculateDurationHours(day.start_time, day.end_time);
    const courts = Math.max(0, Number(day.courts) || 0);
    return sum + Math.round(courts * hours * price);
  }, 0);
}
