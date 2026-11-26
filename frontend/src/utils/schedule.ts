/**
 * schedule.ts
 * Sinh lịch cầu lông cố định theo tháng (VD: Thứ 2, 4, 6 vào 20:00 - 21:30)
 * và tính ước lượng tiền sân tháng từ lịch.
 */

import type { ScheduleDay } from '../types';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
 * Sinh danh sách ngày trong tháng YYYY-MM khớp các thứ đã chọn (0=CN, 1=T2 ... 6=T7).
 */
export function generateMonthScheduleDates(monthStr: string, weekdays: number[]): string[] {
  const match = String(monthStr || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]); // 1..12
  if (month < 1 || month > 12) return [];

  const weekdaySet = new Set(weekdays);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    if (weekdaySet.has(d.getDay())) {
      dates.push(`${year}-${pad2(month)}-${pad2(day)}`);
    }
  }
  return dates;
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
