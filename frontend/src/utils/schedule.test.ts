import { describe, expect, it } from 'vitest';
import {
  calculateDurationHours,
  estimateCourtCostFromSchedule,
  generateMonthScheduleDates,
} from './schedule';

describe('schedule', () => {
  it('Sinh đúng các ngày Thứ 2, 4, 6 trong tháng 11/2026', () => {
    const dates = generateMonthScheduleDates('2026-11', [1, 3, 5]);
    expect(dates[0]).toBe('2026-11-02'); // Thứ 2
    expect(dates[dates.length - 1]).toBe('2026-11-30'); // Thứ 2
    expect(dates).toHaveLength(13);
  });

  it('Xử lý tháng 2 năm không nhuận (2026-02 có 28 ngày) và năm nhuận (2024-02 có 29 ngày)', () => {
    const feb2026 = generateMonthScheduleDates('2026-02', [0, 1, 2, 3, 4, 5, 6]);
    const feb2024 = generateMonthScheduleDates('2024-02', [0, 1, 2, 3, 4, 5, 6]);
    expect(feb2026).toHaveLength(28);
    expect(feb2024).toHaveLength(29);
  });

  it('Tính thời lượng 20:00 - 21:30 = 1.5h và ước lượng tiền sân bỏ qua ngày CANCELLED', () => {
    expect(calculateDurationHours('20:00', '21:30')).toBe(1.5);
    const est = estimateCourtCostFromSchedule(
      [
        {
          plan_id: 'P1',
          date: '2026-11-02',
          start_time: '20:00',
          end_time: '21:30',
          courts: 2,
          planned_member_ids: 'M1,M2',
          status: 'PLANNED',
          session_id: '',
          note: '',
        },
        {
          plan_id: 'P2',
          date: '2026-11-04',
          start_time: '20:00',
          end_time: '21:30',
          courts: 2,
          planned_member_ids: 'M1,M2',
          status: 'CANCELLED',
          session_id: '',
          note: '',
        },
      ],
      120000
    );
    expect(est).toBe(360000);
  });
});
