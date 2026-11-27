import { describe, expect, it } from 'vitest';
import {
  applyMutationPlanToDataset,
  buildAllData,
  buildMonthlyBillData,
  planCloseMonth,
  planConfirmPayment,
  planCreateSession,
  planDeleteSession,
  planIssueMonthlyBill,
  planLinkMemberEmail,
  planManageEditors,
  planMarkDuePaid,
  planUndoSettlement,
  planUpdateSession,
} from './domainEngine';
import {
  initialMockAttendances,
  initialMockEditors,
  initialMockMembers,
  initialMockMonthlyBills,
  initialMockMonthlyDues,
  initialMockSchedule,
  initialMockSessionItems,
  initialMockSessions,
  initialMockSettings,
  initialMockSettlements,
} from './mockData';
import type { ClubDataset } from './providers/types';

function createTestDataset(): ClubDataset {
  return {
    settings: { ...initialMockSettings },
    members: structuredClone(initialMockMembers),
    schedule: structuredClone(initialMockSchedule),
    sessions: structuredClone(initialMockSessions),
    session_items: structuredClone(initialMockSessionItems),
    attendance: structuredClone(initialMockAttendances),
    monthly_bills: structuredClone(initialMockMonthlyBills),
    monthly_dues: structuredClone(initialMockMonthlyDues),
    settlements: structuredClone(initialMockSettlements),
    editors: structuredClone(initialMockEditors),
  };
}

describe('domainEngine - SheetService.gs Parity', () => {
  it('createSession (BADMINTON MONTHLY) tự động liên kết Schedule cùng ngày và tạo khách vãng lai mới', () => {
    const ds = createTestDataset();
    const plan = planCreateSession(
      ds,
      {
        date: '2026-11-27',
        type: 'BADMINTON',
        title: 'Cầu lông T6',
        totalAmount: 500000,
        attendeeIds: ['MEM_001', 'MEM_002'],
        new_guests: [{ name: 'Khách Mới', paidImmediately: false }],
      },
      'tuantrungky@gmail.com'
    );

    expect(plan.result.session.plan_id).toBe('PLN_202611_03');
    expect(plan.result.createdMembers).toHaveLength(1);
    expect(plan.result.createdMembers[0].type).toBe('GUEST');

    const updatedSchedule = plan.upserts.schedule?.[0]?.data as { status: string; session_id: string };
    expect(updatedSchedule.status).toBe('DONE');
    expect(updatedSchedule.session_id).toBe(plan.result.session.session_id);

    const guestAtt = plan.result.attendances.find(
      (a) => a.member_id === plan.result.createdMembers[0].member_id
    );
    expect(guestAtt?.fee_amount).toBe(initialMockSettings.guest_fee);
    expect(guestAtt?.is_paid).toBe(false);
  });

  it('createSession (DRINKING) gộp người góp món và bù sai số làm tròn để sum(net_amount) === 0', () => {
    const ds = createTestDataset();
    const plan = planCreateSession(
      ds,
      {
        date: '2026-11-28',
        type: 'DRINKING',
        title: 'Nhậu cuối tuần',
        totalAmount: 100000,
        payerId: 'MEM_001',
        attendeeIds: ['MEM_001', 'MEM_002'],
        items: [{ member_id: 'MEM_003', kind: 'ITEM', item_name: 'Mồi', amount: 100000 }],
      },
      'tuantrungky@gmail.com'
    );

    expect(plan.result.attendances).toHaveLength(3);
    const netSum = plan.result.attendances.reduce((s, a) => s + a.net_amount, 0);
    expect(netSum).toBe(0);
  });

  it('updateSession giữ nguyên created_at/plan_id và chặn sửa nếu đã đối soát settlement_id', () => {
    const ds = createTestDataset();
    // SES_20261118_001 có ATT_003 mang settlement_id = SET_BAD_001 -> phải chặn
    expect(() =>
      planUpdateSession(ds, {
        sessionId: 'SES_20261118_001',
        date: '2026-11-18',
        type: 'BADMINTON',
        title: 'Sửa trái phép',
        totalAmount: 510000,
        attendeeIds: ['MEM_001'],
      })
    ).toThrow(/đối soát/i);

    // SES_20261123_001 chưa có settlement_id -> cho phép sửa và giữ nguyên plan_id/created_at
    const plan = planUpdateSession(ds, {
      sessionId: 'SES_20261123_001',
      date: '2026-11-23',
      type: 'BADMINTON',
      title: 'Cầu lông T2 đã cập nhật',
      totalAmount: 800000,
      attendeeIds: ['MEM_001', 'MEM_002', 'MEM_005'],
    });
    expect(plan.result.session.plan_id).toBe('PLN_202611_02');
    expect(plan.result.session.created_at).toBe('2026-11-23T21:45:00+07:00');
    expect(plan.deletes.attendance?.length).toBeGreaterThan(0);
  });

  it('deleteSession trả trạng thái Schedule về PLANNED khi xóa buổi cố định', () => {
    const ds = createTestDataset();
    const plan = planDeleteSession(ds, 'SES_20261123_001');
    expect(plan.deletes.sessions).toEqual(['SES_20261123_001']);
    const resetSchedule = plan.upserts.schedule?.[0]?.data as { status: string; session_id: string };
    expect(resetSchedule.status).toBe('PLANNED');
    expect(resetSchedule.session_id).toBe('');
  });

  it('confirmPayment (DRINKING ITEMS) & undoSettlement khôi phục chính xác net_amount cho cả chủ nợ', () => {
    const ds = createTestDataset();
    // Quyên (ATT_D4, +250k) trả cho Thảo (ATT_D1, -300k)
    const payPlan = planConfirmPayment(
      ds,
      {
        category: 'DRINKING',
        mode: 'ITEMS',
        fromMemberId: 'MEM_004',
        toMemberId: 'MEM_001',
        attendanceIds: ['ATT_D4'],
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );

    const dsAfterPay = applyMutationPlanToDataset(ds, payPlan);
    const attThaoAfterPay = dsAfterPay.attendance.find((a) => a.attendance_id === 'ATT_D1');
    const attQuyenAfterPay = dsAfterPay.attendance.find((a) => a.attendance_id === 'ATT_D4');
    expect(attQuyenAfterPay?.is_paid).toBe(true);
    expect(attThaoAfterPay?.net_amount).toBe(-50000);

    // Hoàn tác giao dịch vừa tạo
    const undoPlan = planUndoSettlement(dsAfterPay, payPlan.result.settlement.settlement_id);
    const dsAfterUndo = applyMutationPlanToDataset(dsAfterPay, undoPlan);
    const attThaoUndo = dsAfterUndo.attendance.find((a) => a.attendance_id === 'ATT_D1');
    const attQuyenUndo = dsAfterUndo.attendance.find((a) => a.attendance_id === 'ATT_D4');
    expect(attQuyenUndo?.is_paid).toBe(false);
    expect(attQuyenUndo?.net_amount).toBe(250000);
    expect(attThaoUndo?.net_amount).toBe(-300000);
  });

  it('issueMonthlyBill bảo toàn trạng thái đã đóng, tạo carry_over_credits và closeMonth tính đúng carry_out', () => {
    const ds = createTestDataset();
    const issuePlan = planIssueMonthlyBill(
      ds,
      {
        month: '2026-11',
        estimate: 600000,
        courtFee: 600000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
        appliedCredits: [
          {
            id: 'CNT_BIG',
            member_id: 'MEM_002',
            tube_qty: 2,
            unit_price: 250000,
            amount: 500000,
          },
        ],
      },
      'tuantrungky@gmail.com'
    );

    const dsAfterIssue = applyMutationPlanToDataset(ds, issuePlan);
    const billAfter = buildMonthlyBillData(dsAfterIssue, '2026-11');
    // MEM_001 đã đóng từ trước trong initialMockMonthlyDues -> vẫn giữ is_paid = true
    const dueThao = billAfter.dues.find((d) => d.member_id === 'MEM_001');
    const dueTuan = billAfter.dues.find((d) => d.member_id === 'MEM_002');
    expect(dueThao?.is_paid).toBe(true);
    // Tuấn góp 500k > per_member -> netAmount = 0 & tự động is_paid = true
    expect(dueTuan?.amount).toBe(0);
    expect(dueTuan?.is_paid).toBe(true);
    expect(JSON.parse(billAfter.bill.carry_over_credits || '[]').length).toBe(1);

    // Gạch nợ cho MEM_003 rồi chốt tháng
    const dueChung = billAfter.dues.find((d) => d.member_id === 'MEM_003')!;
    const markPlan = planMarkDuePaid(dsAfterIssue, { dueId: dueChung.due_id, isPaid: true }, 'tuantrungky@gmail.com');
    const dsAfterMark = applyMutationPlanToDataset(dsAfterIssue, markPlan);
    const closePlan = planCloseMonth(dsAfterMark, { month: '2026-11', actualCostOverride: 1000000 }, 'tuantrungky@gmail.com');
    expect(closePlan.result.bill.status).toBe('CLOSED');
    expect(closePlan.result.bill.carry_out).toBe(
      closePlan.result.bill.carry_in +
        closePlan.result.bill.billed_total +
        closePlan.result.bill.guest_income -
        1000000
    );
  });

  it('planCloseMonth hỗ trợ nhập thẳng carryOutOverride dương (+) và âm (−) chuyển sang tháng kế tiếp', () => {
    const ds = createTestDataset();
    const closePos = planCloseMonth(
      ds,
      { month: '2026-11', carryOutOverride: 250000 },
      'tuantrungky@gmail.com'
    );
    expect(closePos.result.bill.status).toBe('CLOSED');
    expect(closePos.result.bill.carry_out).toBe(250000);
    const dsPos = applyMutationPlanToDataset(ds, closePos);
    expect(buildMonthlyBillData(dsPos, '2026-11').bill.carry_out).toBe(250000);
    expect(buildMonthlyBillData(dsPos, '2026-12').bill.carry_in).toBe(250000);

    const closeNeg = planCloseMonth(
      dsPos,
      { month: '2026-11', carryOutOverride: -180000 },
      'tuantrungky@gmail.com'
    );
    expect(closeNeg.result.bill.carry_out).toBe(-180000);
    const dsNeg = applyMutationPlanToDataset(dsPos, closeNeg);
    expect(buildMonthlyBillData(dsNeg, '2026-11').bill.carry_out).toBe(-180000);
    expect(buildMonthlyBillData(dsNeg, '2026-12').bill.carry_in).toBe(-180000);
  });

  it('linkMemberEmail gỡ liên kết cũ và chặn liên kết vào thành viên đã có Gmail khác', () => {
    const ds = createTestDataset();
    const p1 = planLinkMemberEmail(ds, 'MEM_003', 'chung@gmail.com');
    const ds1 = applyMutationPlanToDataset(ds, p1);
    expect(ds1.members.find((m) => m.member_id === 'MEM_003')?.email).toBe('chung@gmail.com');

    // Người khác không thể chiếm MEM_003
    expect(() => planLinkMemberEmail(ds1, 'MEM_003', 'other@gmail.com')).toThrow();

    // Chính chung@gmail.com đổi sang MEM_004 -> MEM_003 được gỡ email
    const p2 = planLinkMemberEmail(ds1, 'MEM_004', 'chung@gmail.com');
    const ds2 = applyMutationPlanToDataset(ds1, p2);
    expect(ds2.members.find((m) => m.member_id === 'MEM_003')?.email).toBe('');
    expect(ds2.members.find((m) => m.member_id === 'MEM_004')?.email).toBe('chung@gmail.com');
  });

  it('manageEditors chỉ cho ADMIN và chặn tự xóa chính mình; buildAllData trả về cấu trúc đầy đủ', () => {
    const ds = createTestDataset();
    expect(() =>
      planManageEditors(ds, { operation: 'UPSERT', email: 'new@gmail.com' }, 'editor@gmail.com', 'EDITOR')
    ).toThrow();
    expect(() =>
      planManageEditors(ds, { operation: 'DELETE', email: 'tuantrungky@gmail.com' }, 'tuantrungky@gmail.com', 'ADMIN')
    ).toThrow();

    const all = buildAllData(ds, 'MONTH', '2026-11-26', '2026-11');
    expect(all.bootstrap.members).toHaveLength(6);
    expect(all.schedule.days.length).toBeGreaterThan(0);
  });
});
