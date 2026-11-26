import { describe, expect, it } from 'vitest';
import { getNowVN, getTodayDateStr, getWeekdayIndex } from './dateFilters';

describe('dateFilters (Asia/Ho_Chi_Minh)', () => {
  it('Chuyển đổi chuẩn sang giờ Việt Nam (+07:00) khi qua ngày mới so với UTC', () => {
    const utcEvening = new Date('2026-11-26T18:30:00.000Z');
    const vn = getNowVN(utcEvening);
    expect(vn.date).toBe('2026-11-27');
    expect(vn.time).toBe('01:30');
    expect(getTodayDateStr(utcEvening)).toBe('2026-11-27');
  });

  it('Tính đúng thứ trong tuần theo lịch UTC cho YYYY-MM-DD', () => {
    expect(getWeekdayIndex('2026-11-26')).toBe(4); // Thứ 5
    expect(getWeekdayIndex('2026-11-29')).toBe(0); // Chủ nhật
  });
});
