import { describe, expect, it } from 'vitest';
import type { ScheduleDay, Session } from '../types';
import {
  calculateDurationHours,
  estimateCourtCostFromSchedule,
  generateMonthScheduleDates,
  getEffectiveScheduleStatus,
} from './schedule';

const basePlan: ScheduleDay = {
  plan_id: 'P1',
  date: '2026-11-26',
  start_time: '20:00',
  end_time: '21:30',
  courts: 2,
  planned_member_ids: 'M1,M2',
  status: 'PLANNED',
  session_id: '',
  note: '',
};

describe('schedule', () => {
  it('Sinh đúng các ngày Thứ 2, 4, 6 trong tháng 11/2026 và hỗ trợ fromDate', () => {
    const dates = generateMonthScheduleDates('2026-11', [1, 3, 5]);
    expect(dates[0]).toBe('2026-11-02');
    expect(dates[dates.length - 1]).toBe('2026-11-30');
    expect(dates).toHaveLength(13);

    const fromMidMonth = generateMonthScheduleDates('2026-11', [1, 3, 5], '2026-11-25');
    expect(fromMidMonth).toEqual(['2026-11-25', '2026-11-27', '2026-11-30']);
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
        { ...basePlan, date: '2026-11-02' },
        { ...basePlan, plan_id: 'P2', date: '2026-11-04', status: 'CANCELLED' },
      ],
      120000
    );
    expect(est).toBe(360000);
  });

  it('Xác định đúng 5 trạng thái lịch theo giờ Việt Nam (Asia/Ho_Chi_Minh)', () => {
    // 1. Sắp diễn ra (chưa tới giờ bắt đầu)
    expect(
      getEffectiveScheduleStatus(basePlan, [], { date: '2026-11-26', time: '12:30' }).status
    ).toBe('UPCOMING');

    // 2. Đang diễn ra (trong khung 20:00 - 21:30)
    expect(
      getEffectiveScheduleStatus(basePlan, [], { date: '2026-11-26', time: '20:45' }).status
    ).toBe('ONGOING');

    // 3. Đã qua giờ kết thúc hoặc sang ngày hôm sau mà chưa ghi buổi
    expect(
      getEffectiveScheduleStatus(basePlan, [], { date: '2026-11-26', time: '21:35' }).status
    ).toBe('PAST_UNLOGGED');
    expect(
      getEffectiveScheduleStatus(basePlan, [], { date: '2026-11-27', time: '08:00' }).status
    ).toBe('PAST_UNLOGGED');

    // 4. Đã có buổi cầu cố định thực tế cùng ngày -> DONE dù Sheet còn PLANNED
    const fixedSession = {
      session_id: 'SES_1',
      date: '2026-11-26',
      type: 'BADMINTON',
      billing_mode: 'MONTHLY',
    } as Session;
    expect(
      getEffectiveScheduleStatus(basePlan, [fixedSession], { date: '2026-11-27', time: '08:00' }).status
    ).toBe('DONE');

    // 5. Ngày hủy -> CANCELLED
    expect(
      getEffectiveScheduleStatus({ ...basePlan, status: 'CANCELLED' }, [], {
        date: '2026-11-27',
        time: '08:00',
      }).status
    ).toBe('CANCELLED');
  });
});
