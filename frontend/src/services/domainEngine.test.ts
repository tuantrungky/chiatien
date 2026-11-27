import { describe, expect, it } from 'vitest';
import {
  applyMutationPlanToDataset,
  buildAllData,
  buildDashboardData,
  buildDebtsData,
  buildGuestStatsData,
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
  planUpsertMember,
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
    expect(plan.result.session.payer_id).toBe('MEM_003');
    expect(plan.result.session.payer_name).toBe('Chung');
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
        estimate: 900000,
        courtFee: 900000,
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

  it('linkMemberEmail gỡ liên kết cũ vào members_private và chặn liên kết vào thành viên đã có Gmail khác', () => {
    const ds = createTestDataset();
    const p1 = planLinkMemberEmail(ds, 'MEM_003', 'chung@gmail.com');
    const ds1 = applyMutationPlanToDataset(ds, p1);
    expect(ds1.members_private?.find((m) => m.member_id === 'MEM_003')?.email).toBe('chung@gmail.com');
    expect(ds1.members.find((m) => m.member_id === 'MEM_003')?.has_email).toBe(true);
    expect(ds1.members.find((m) => m.member_id === 'MEM_003')?.email).toBeUndefined();

    // Người khác không thể chiếm MEM_003
    expect(() => planLinkMemberEmail(ds1, 'MEM_003', 'other@gmail.com')).toThrow();

    // Chính chung@gmail.com đổi sang MEM_004 -> MEM_003 được gỡ email
    const p2 = planLinkMemberEmail(ds1, 'MEM_004', 'chung@gmail.com');
    const ds2 = applyMutationPlanToDataset(ds1, p2);
    expect(ds2.members_private?.find((m) => m.member_id === 'MEM_003')?.email).toBe('');
    expect(ds2.members.find((m) => m.member_id === 'MEM_003')?.has_email).toBe(false);
    expect(ds2.members_private?.find((m) => m.member_id === 'MEM_004')?.email).toBe('chung@gmail.com');
    expect(ds2.members.find((m) => m.member_id === 'MEM_004')?.has_email).toBe(true);
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
    expect(all.bootstrap.closedMonths).toBeDefined();
    expect(all.schedule.days.length).toBeGreaterThan(0);
  });

  it('planIssueMonthlyBill xử lý oldPaidMap đổi số tiền, refundCredits không thuộc MAIN, syncMemberTypes và scheduleConfig', () => {
    const ds = createTestDataset();
    // Phát hành lần 1
    const issue1 = planIssueMonthlyBill(
      ds,
      {
        month: '2026-11',
        estimate: 2000000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
        appliedCredits: [],
      },
      'tuantrungky@gmail.com'
    );
    let dsCur = applyMutationPlanToDataset(ds, issue1);
    const due3 = dsCur.monthly_dues.find((d) => d.month === '2026-11' && d.member_id === 'MEM_003')!;
    dsCur = applyMutationPlanToDataset(
      dsCur,
      planMarkDuePaid(dsCur, { dueId: due3.due_id, isPaid: true }, 'tuantrungky@gmail.com')
    );

    // Chia lại lần 2: tăng dự toán + đổi MEM_005 thành MAIN, MEM_004 thành GUEST + MEM_006 (GUEST) góp cầu
    const issue2 = planIssueMonthlyBill(
      dsCur,
      {
        month: '2026-11',
        estimate: 2400000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_005'],
        syncMemberTypes: true,
        appliedCredits: [
          { id: 'CR_G', member_id: 'MEM_006', tube_qty: 1, unit_price: 200000, amount: 200000 },
        ],
        scheduleConfig: { weekdays: [1, 3], startTime: '20:00', endTime: '21:30', courts: 2 },
      },
      'tuantrungky@gmail.com'
    );
    const dsAfter = applyMutationPlanToDataset(dsCur, issue2);
    const reDue3 = dsAfter.monthly_dues.find((d) => d.month === '2026-11' && d.member_id === 'MEM_003')!;
    // Số tiền thay đổi -> reset is_paid=false và gắn ghi chú chênh lệch
    expect(reDue3.is_paid).toBe(false);
    expect(reDue3.credit_note).toContain('Đã đóng trước');

    // syncMemberTypes cập nhật type của MEM_005 -> MAIN, MEM_004 -> GUEST
    expect(dsAfter.members.find((m) => m.member_id === 'MEM_005')?.type).toBe('MAIN');
    expect(dsAfter.members.find((m) => m.member_id === 'MEM_004')?.type).toBe('GUEST');

    // refundCredits của MEM_006 được ghi nhận và trừ khi closeMonth
    expect(issue2.result.refundCredits).toHaveLength(1);
    expect(issue2.result.bill.refund_credits_total).toBe(200000);
    const closePlan = planCloseMonth(
      dsAfter,
      { month: '2026-11', actualCostOverride: 1000000 },
      'tuantrungky@gmail.com'
    );
    expect(closePlan.result.bill.carry_out).toBe(
      closePlan.result.bill.carry_in +
        closePlan.result.bill.billed_total +
        closePlan.result.bill.guest_income -
        1000000 -
        200000
    );
  });

  it('confirmPayment (DRINKING ITEMS) phân bổ nhiều chủ nợ & undoSettlement replay đúng giao dịch còn lại', () => {
    const ds = createTestDataset();
    ds.settlements = [];
    ds.attendance = [];
    ds.sessions = [];
    ds.session_items = [];

    const createPlan = planCreateSession(
      ds,
      {
        date: '2026-11-28',
        type: 'DRINKING',
        title: 'Nhậu 2 chủ nợ',
        totalAmount: 400000,
        payerId: 'MEM_001',
        attendeeIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
        items: [
          { member_id: 'MEM_001', kind: 'BILL', item_name: 'Hóa đơn 1', amount: 150000 },
          { member_id: 'MEM_002', kind: 'ITEM', item_name: 'Mồi 2', amount: 250000 },
        ],
      },
      'tuantrungky@gmail.com'
    );
    const ds1 = applyMutationPlanToDataset(ds, createPlan);
    // Mỗi người 100k -> MEM_001 (-50k), MEM_002 (-150k), MEM_003 (+100k), MEM_004 (+100k)
    const att3 = ds1.attendance.find((a) => a.member_id === 'MEM_003')!;
    const att4 = ds1.attendance.find((a) => a.member_id === 'MEM_004')!;

    // MEM_003 trả 100k, ưu tiên MEM_001 (-50k -> 0đ), dư 50k trừ sang MEM_002 (-150k -> -100k)
    const pay3 = planConfirmPayment(
      ds1,
      {
        category: 'DRINKING',
        mode: 'ITEMS',
        fromMemberId: 'MEM_003',
        toMemberId: 'MEM_001',
        attendanceIds: [att3.attendance_id],
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );
    const ds2 = applyMutationPlanToDataset(ds1, pay3);
    const sumAfterPay3 = ds2.attendance.reduce((s, a) => s + a.net_amount, 0);
    expect(sumAfterPay3).toBe(0);
    expect(ds2.attendance.find((a) => a.member_id === 'MEM_001')?.net_amount).toBe(0);
    expect(ds2.attendance.find((a) => a.member_id === 'MEM_002')?.net_amount).toBe(-100000);

    // MEM_004 trả 100k cho MEM_002 -> đóng toàn bộ buổi
    const pay4 = planConfirmPayment(
      ds2,
      {
        category: 'DRINKING',
        mode: 'ITEMS',
        fromMemberId: 'MEM_004',
        toMemberId: 'MEM_002',
        attendanceIds: [att4.attendance_id],
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );
    const ds3 = applyMutationPlanToDataset(ds2, pay4);
    expect(ds3.attendance.every((a) => a.is_paid)).toBe(true);

    // Hoàn tác pay3 -> replay pay4 -> MEM_004 vẫn paid, MEM_003 nợ 100k, MEM_001 (-50k) + MEM_002 (-50k)
    const undo3 = planUndoSettlement(ds3, pay3.result.settlement.settlement_id);
    const ds4 = applyMutationPlanToDataset(ds3, undo3);
    expect(ds4.attendance.find((a) => a.member_id === 'MEM_004')?.is_paid).toBe(true);
    expect(ds4.attendance.find((a) => a.member_id === 'MEM_003')?.is_paid).toBe(false);
    expect(ds4.attendance.find((a) => a.member_id === 'MEM_003')?.net_amount).toBe(100000);
    expect(ds4.attendance.find((a) => a.member_id === 'MEM_001')?.net_amount).toBe(-50000);
    expect(ds4.attendance.find((a) => a.member_id === 'MEM_002')?.net_amount).toBe(-50000);
    expect(ds4.attendance.reduce((s, a) => s + a.net_amount, 0)).toBe(0);
  });

  it('SIMPLIFIED_TRANSFER ghi REC: vào source_ledger_ids và undo mở lại cả đợt chốt', () => {
    const ds = createTestDataset();
    ds.settlements = [];
    ds.attendance = [];
    ds.sessions = [];
    ds.session_items = [];

    const sPlan = planCreateSession(
      ds,
      {
        date: '2026-11-28',
        type: 'DRINKING',
        title: 'Nhậu chốt đợt',
        totalAmount: 300000,
        payerId: 'MEM_001',
        attendeeIds: ['MEM_001', 'MEM_002', 'MEM_003'],
        items: [{ member_id: 'MEM_001', kind: 'BILL', item_name: 'Bill', amount: 300000 }],
      },
      'tuantrungky@gmail.com'
    );
    const ds1 = applyMutationPlanToDataset(ds, sPlan);

    const p1 = planConfirmPayment(
      ds1,
      {
        category: 'DRINKING',
        mode: 'SIMPLIFIED_TRANSFER',
        fromMemberId: 'MEM_002',
        toMemberId: 'MEM_001',
        amount: 100000,
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );
    const ds2 = applyMutationPlanToDataset(ds1, p1);
    expect(p1.result.settlement.is_reconciled).toBe(false);

    const p2 = planConfirmPayment(
      ds2,
      {
        category: 'DRINKING',
        mode: 'SIMPLIFIED_TRANSFER',
        fromMemberId: 'MEM_003',
        toMemberId: 'MEM_001',
        amount: 100000,
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );
    const ds3 = applyMutationPlanToDataset(ds2, p2);
    expect(p2.result.settlement.is_reconciled).toBe(true);
    expect(p2.result.settlement.source_ledger_ids).toContain('REC:');
    expect(ds3.attendance.every((a) => a.is_paid)).toBe(true);

    // Hoàn tác p1 -> attendance mở lại và p2 quay về is_reconciled=false
    const u1 = planUndoSettlement(ds3, p1.result.settlement.settlement_id);
    const ds4 = applyMutationPlanToDataset(ds3, u1);
    expect(ds4.attendance.some((a) => !a.is_paid)).toBe(true);
    const sibling = ds4.settlements.find((s) => s.settlement_id === p2.result.settlement.settlement_id);
    expect(sibling?.is_reconciled).toBe(false);
    expect(buildDebtsData(ds4).drinking.totalOutstanding).toBe(100000);
  });

  it('planUpdateSession cho phép sửa tiêu đề/ghi chú/ảnh trên buổi đã đối soát', () => {
    const ds = createTestDataset();
    const settledSess = ds.sessions.find((s) => s.session_id === 'SES_20261118_001')!;
    const attIds = ds.attendance
      .filter((a) => a.session_id === 'SES_20261118_001')
      .map((a) => a.member_id);

    const metaPlan = planUpdateSession(ds, {
      sessionId: settledSess.session_id,
      date: settledSess.date,
      type: settledSess.type,
      billingMode: settledSess.billing_mode,
      totalAmount: settledSess.total_amount,
      guestFee: settledSess.guest_fee,
      payerId: settledSess.payer_id,
      attendeeIds: attIds,
      title: 'Tiêu đề đã sửa hợp lệ',
      note: 'Ghi chú mới',
      receiptUrl: 'https://example.com/receipt.jpg',
    });
    expect(metaPlan.result.session.title).toBe('Tiêu đề đã sửa hợp lệ');
    expect(metaPlan.deletes.attendance).toBeUndefined();
    const dsAfter = applyMutationPlanToDataset(ds, metaPlan);
    expect(dsAfter.attendance.find((a) => a.attendance_id === 'ATT_003')?.settlement_id).toBe(
      'SET_BAD_001'
    );
  });

  it('buildDashboardData tính monthlyBillCostInPeriod cho MONTH/QUARTER và bỏ qua WEEK; buildGuestStatsData tách collectedInMonthAmount', () => {
    const ds = createTestDataset();
    const issue = planIssueMonthlyBill(
      ds,
      {
        month: '2026-11',
        estimate: 2000000,
        courtFee: 2000000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
      },
      'tuantrungky@gmail.com'
    );
    const dsIssued = applyMutationPlanToDataset(ds, issue);
    const dashMonth = buildDashboardData(dsIssued, 'MONTH', '2026-11-26');
    const dashWeek = buildDashboardData(dsIssued, 'WEEK', '2026-11-26');
    expect(dashMonth.badminton.monthlyBillCostInPeriod).toBeGreaterThan(0);
    expect(dashMonth.badminton.periodCost).toBeGreaterThanOrEqual(
      dashMonth.badminton.monthlyBillCostInPeriod!
    );
    expect(dashWeek.badminton.monthlyBillCostInPeriod).toBe(0);

    // Gán một guest attendance chơi tháng 2026-11 nhưng paid_at tháng 2026-12
    const novGuestAtt = dsIssued.attendance.find(
      (a) => a.session_type === 'BADMINTON' && a.member_type_snapshot === 'GUEST'
    );
    if (novGuestAtt) {
      novGuestAtt.is_paid = true;
      novGuestAtt.paid_at = '2026-12-03T10:00:00+07:00';
      const statsNov = buildGuestStatsData(dsIssued, '2026-11');
      const statsDec = buildGuestStatsData(dsIssued, '2026-12');
      expect(statsNov.summary.totalPaid).toBeGreaterThanOrEqual(novGuestAtt.fee_amount);
      expect(statsDec.summary.collectedInMonthAmount).toBeGreaterThanOrEqual(novGuestAtt.fee_amount);
    }
  });

  it('B2: buildDashboardData không đếm trùng buổi MONTHLY thuộc tháng đã phát hành hóa đơn', () => {
    const ds = createTestDataset();
    // Ghi thêm một buổi MONTHLY có total_amount = 500k trong tháng 2026-11
    const fixedSess = ds.sessions.find(
      (s) => s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC' && s.date.startsWith('2026-11')
    );
    if (fixedSess) fixedSess.total_amount = 500000;
    const issue = planIssueMonthlyBill(
      ds,
      {
        month: '2026-11',
        estimate: 2000000,
        courtFee: 2000000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
      },
      'tuantrungky@gmail.com'
    );
    const dsIssued = applyMutationPlanToDataset(ds, issue);
    const dashMonth = buildDashboardData(dsIssued, 'MONTH', '2026-11-26');
    const adhocCost = dsIssued.sessions
      .filter((s) => s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC' && s.date.startsWith('2026-11'))
      .reduce((sum, s) => sum + s.total_amount, 0);
    expect(dashMonth.badminton.monthlyBillCostInPeriod).toBe(2000000);
    expect(dashMonth.badminton.periodCost).toBe(2000000 + adhocCost);
  });

  it('B3 & B4: issueMonthlyBill cập nhật actual_cost/carry_out theo estimate mới và bảo toàn issued_at khi lưu góp cầu', () => {
    const ds = createTestDataset();
    ds.monthly_bills = [];
    ds.monthly_dues = [];
    const issueNov = planIssueMonthlyBill(
      ds,
      {
        month: '2026-11',
        estimate: 2000000,
        courtFee: 2000000,
        memberIds: ['MEM_001', 'MEM_002', 'MEM_003', 'MEM_004'],
      },
      'tuantrungky@gmail.com'
    );
    expect(issueNov.result.bill.actual_cost).toBe(2000000);
    const ds1 = applyMutationPlanToDataset(ds, issueNov);
    const origIssuedAt = ds1.monthly_dues[0].issued_at;
    expect(origIssuedAt).toBeTruthy();

    // Lưu góp cầu làm thay đổi bill.updated_at -> issued_at của dues vẫn giữ nguyên
    const decPreview = buildMonthlyBillData(ds1, '2026-12');
    expect(decPreview.bill.carry_in).toBe(issueNov.result.bill.carry_out);
    ds1.monthly_bills[0].updated_at = '2026-12-20T10:00:00+07:00';
    const novAfterSaveContrib = buildMonthlyBillData(ds1, '2026-11');
    expect(novAfterSaveContrib.dues[0].issued_at).toBe(origIssuedAt);
  });

  it('B5, B6 & B7: confirmPayment chặn bấm đúp/chủ nợ & không mở lại dòng cũ khi undo; planCloseMonth bỏ qua chuỗi rỗng', () => {
    const ds = createTestDataset();
    const firstAtt = ds.attendance.find((a) => a.session_type === 'BADMINTON' && !a.is_paid)!;
    const paidAlready = ds.attendance.find((a) => a.session_type === 'BADMINTON' && a.is_paid)!;

    const p = planConfirmPayment(
      ds,
      {
        category: 'BADMINTON',
        mode: 'ITEMS',
        fromMemberId: firstAtt.member_id,
        toMemberId: 'MEM_002',
        attendanceIds: [firstAtt.attendance_id, paidAlready.attendance_id],
        method: 'VIETQR',
      },
      'tuantrungky@gmail.com'
    );
    expect(p.result.settlement.source_attendance_ids).toBe(firstAtt.attendance_id);
    const ds1 = applyMutationPlanToDataset(ds, p);
    // Bấm đúp lại -> phải từ chối thay vì tạo settlement ảo
    expect(() =>
      planConfirmPayment(
        ds1,
        {
          category: 'BADMINTON',
          mode: 'ITEMS',
          fromMemberId: firstAtt.member_id,
          toMemberId: 'MEM_002',
          attendanceIds: [firstAtt.attendance_id],
          method: 'VIETQR',
        },
        'tuantrungky@gmail.com'
      )
    ).toThrow();

    // Undo không làm ảnh hưởng paidAlready
    const u = planUndoSettlement(ds1, p.result.settlement.settlement_id);
    const ds2 = applyMutationPlanToDataset(ds1, u);
    expect(ds2.attendance.find((a) => a.attendance_id === paidAlready.attendance_id)?.is_paid).toBe(true);
    expect(ds2.attendance.find((a) => a.attendance_id === firstAtt.attendance_id)?.is_paid).toBe(false);

    // B7: chuỗi rỗng '' trong closeMonth không được biến thành 0
    const closeEmpty = planCloseMonth(
      ds,
      { month: '2026-11', actualCostOverride: '' as unknown as null, carryOutOverride: '' as unknown as null },
      'tuantrungky@gmail.com'
    );
    expect(closeEmpty.result.bill.actual_cost_override).toBeNull();
  });

  it('P5 & Privacy: planDeleteSession chỉ reset Schedule cùng session_id; planUpsertMember tách SĐT/Email sang members_private', () => {
    const ds = createTestDataset();
    // Gắn 1 session mới ghi đè session_id trên PLN_202611_02
    const sched = ds.schedule.find((d) => d.plan_id === 'PLN_202611_02')!;
    sched.session_id = 'SES_OTHER';
    const delPlan = planDeleteSession(ds, 'SES_20261123_001');
    expect(delPlan.upserts.schedule).toBeUndefined();

    const up = planUpsertMember(ds, {
      memberId: 'MEM_001',
      name: 'Thảo Mới',
      type: 'MAIN',
      phone: '0988777666',
    });
    const pubUpsert = up.upserts.members?.[0]?.data as Record<string, unknown>;
    const privUpsert = up.upserts.members_private?.[0]?.data as Record<string, unknown>;
    expect(pubUpsert.phone).toBeUndefined();
    expect(pubUpsert.email).toBeUndefined();
    expect(privUpsert.phone).toBe('0988777666');
    expect(up.result.member.phone).toBe('0988777666');
  });
});
