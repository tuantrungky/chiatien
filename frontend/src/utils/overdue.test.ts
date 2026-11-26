import { describe, expect, it } from 'vitest';
import { getDaysOverdue, getOverdueInfo } from './overdue';

describe('overdue', () => {
  const today = '2026-11-30';

  it('Tính đúng số ngày quá hạn từ ngày YYYY-MM-DD hoặc YYYY-MM', () => {
    expect(getDaysOverdue('2026-11-25', today)).toBe(5);
    expect(getDaysOverdue('2026-11', today)).toBe(29);
    expect(getDaysOverdue('2026-12-05', today)).toBe(0);
  });

  it('Phân loại đủ 5 mốc cảnh báo 10, 15, 20 và 30+ ngày', () => {
    expect(getOverdueInfo('2026-11-25', today).severity).toBe('NONE');

    const w10 = getOverdueInfo('2026-11-20', today);
    expect(w10.severity).toBe('WARN_10');
    expect(w10.days).toBe(10);

    const w15 = getOverdueInfo('2026-11-15', today);
    expect(w15.severity).toBe('WARN_15');

    const d20 = getOverdueInfo('2026-11-10', today);
    expect(d20.severity).toBe('DANGER_20');
    expect(d20.badgeClass).toContain('animate-pulse');

    const c30 = getOverdueInfo('2026-10-25', today);
    expect(c30.severity).toBe('CRITICAL_30');
    expect(c30.label).toContain('Quá 1 tháng');
    expect(c30.badgeClass).toContain('animate-pulse');
  });
});
