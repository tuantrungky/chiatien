import { describe, expect, it } from 'vitest';
import type { Attendance, FundLedgerEntry, Member, Session, Settlement } from '../types';
import { simplifyDebts } from './debtSimplifier';

function makeMember(id: string, name: string, type: 'MAIN' | 'GUEST' = 'MAIN'): Member {
  return {
    member_id: id,
    name,
    aliases: name,
    type,
    phone: '',
    bank_bin: '970436',
    bank_name: 'Vietcombank',
    account_no: `0123456${id.slice(-3)}`,
    account_name: name.toUpperCase(),
    is_active: true,
    created_at: '2026-11-01T00:00:00+07:00',
    updated_at: '2026-11-01T00:00:00+07:00',
  };
}

function makeSession(
  id: string,
  date: string,
  type: 'BADMINTON' | 'DRINKING',
  title: string,
  payerId: string
): Session {
  return {
    session_id: id,
    date,
    type,
    title,
    total_amount: type === 'DRINKING' ? 300000 : 0,
    guest_fee: type === 'BADMINTON' ? 50000 : 0,
    payer_id: payerId,
    per_person_amount: type === 'DRINKING' ? 100000 : 0,
    attendee_count: 3,
    receipt_drive_id: '',
    receipt_url: '',
    receipt_summary: '',
    note: '',
    created_by: 'tuan@gmail.com',
    created_at: `${date}T20:00:00+07:00`,
    updated_at: `${date}T20:00:00+07:00`,
  };
}

function makeAttendance(
  id: string,
  sessionId: string,
  date: string,
  sessionType: 'BADMINTON' | 'DRINKING',
  memberId: string,
  memberType: 'MAIN' | 'GUEST',
  feeAmount: number,
  creditorId: string,
  isPaid = false
): Attendance {
  return {
    attendance_id: id,
    session_id: sessionId,
    session_date: date,
    session_type: sessionType,
    member_id: memberId,
    member_type_snapshot: memberType,
    fee_amount: feeAmount,
    creditor_id: creditorId,
    is_paid: isPaid,
    paid_at: isPaid ? `${date}T21:00:00+07:00` : '',
    settlement_id: '',
    note: '',
  };
}

describe('simplifyDebts', () => {
  const tuan = makeMember('MEM_A', 'Tuấn', 'MAIN');
  const hung = makeMember('MEM_B', 'Hùng', 'MAIN');
  const dung = makeMember('MEM_C', 'Dũng', 'MAIN');
  const minh = makeMember('MEM_G1', 'Minh', 'GUEST');
  const members = [tuan, hung, dung, minh];

  it('Kịch bản 1: Nợ đơn giản (khách vãng lai nợ Thủ quỹ + buổi ăn nhậu đơn lẻ)', () => {
    const s1 = makeSession('SES_1', '2026-11-10', 'BADMINTON', 'Cầu lông tối T3', 'MEM_A');
    const attendances: Attendance[] = [
      makeAttendance('ATT_1', 'SES_1', '2026-11-10', 'BADMINTON', 'MEM_A', 'MAIN', 0, 'MEM_A', true),
      makeAttendance('ATT_2', 'SES_1', '2026-11-10', 'BADMINTON', 'MEM_G1', 'GUEST', 50000, 'MEM_A', false),
    ];

    const result = simplifyDebts({
      attendances,
      sessions: [s1],
      members,
      treasurerMemberId: 'MEM_A',
    });

    expect(result.totalOutstanding).toBe(50000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].fromMember.member_id).toBe('MEM_G1');
    expect(result.transfers[0].toMember.member_id).toBe('MEM_A');
    expect(result.transfers[0].amount).toBe(50000);
    expect(result.transfers[0].transferContent).toBe('CLN Minh tra Tuan');
    expect(result.transfers[0].vietQrUrl).toContain('amount=50000');
    expect(result.transfers[0].breakdownSessions).toHaveLength(1);
    expect(result.transfers[0].breakdownSessions[0].sessionTitle).toBe('Cầu lông tối T3');
  });

  it('Kịch bản 2: Nợ vòng tròn A -> B -> C được cấn trừ thành A -> C', () => {
    // Tuấn (A) nợ Hùng (B) 100k ở buổi nhậu 1; Hùng (B) nợ Dũng (C) 100k ở buổi nhậu 2
    const s1 = makeSession('SES_1', '2026-11-11', 'DRINKING', 'Nhậu sau sân T3', 'MEM_B');
    const s2 = makeSession('SES_2', '2026-11-13', 'DRINKING', 'Nhậu sau sân T5', 'MEM_C');

    const attendances: Attendance[] = [
      makeAttendance('ATT_1', 'SES_1', '2026-11-11', 'DRINKING', 'MEM_A', 'MAIN', 100000, 'MEM_B', false),
      makeAttendance('ATT_2', 'SES_2', '2026-11-13', 'DRINKING', 'MEM_B', 'MAIN', 100000, 'MEM_C', false),
    ];

    const result = simplifyDebts({
      attendances,
      sessions: [s1, s2],
      members,
      treasurerMemberId: 'MEM_A',
    });

    expect(result.totalOutstanding).toBe(100000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].fromMember.member_id).toBe('MEM_A');
    expect(result.transfers[0].toMember.member_id).toBe('MEM_C');
    expect(result.transfers[0].amount).toBe(100000);

    // Sub-case: Vòng tròn khép kín A -> B -> C -> A triệt tiêu hoàn toàn còn 0 giao dịch
    const s3 = makeSession('SES_3', '2026-11-15', 'DRINKING', 'Nhậu T7', 'MEM_A');
    const closedLoop = simplifyDebts({
      attendances: [
        ...attendances,
        makeAttendance('ATT_3', 'SES_3', '2026-11-15', 'DRINKING', 'MEM_C', 'MAIN', 100000, 'MEM_A', false),
      ],
      sessions: [s1, s2, s3],
      members,
      treasurerMemberId: 'MEM_A',
    });
    expect(closedLoop.transfers).toHaveLength(0);
    expect(closedLoop.totalOutstanding).toBe(0);
  });

  it('Kịch bản 3: Cộng dồn nhiều buổi ăn nhậu + phí vãng lai cầu lông + hoàn ứng mua cầu', () => {
    // Minh (GUEST) nợ Thủ quỹ Tuấn 2 buổi cầu lông (50k x 2 = 100k) + 1 buổi nhậu (120k) = 220k
    // Đồng thời Hùng (MAIN) đã chi hộ quỹ 70k tiền mua cầu (chưa hoàn ứng) -> Tuấn (Thủ quỹ) nợ Hùng 70k
    // Kết quả tối ưu: Minh chuyển Hùng 70k và chuyển Tuấn 150k (tổng đúng 220k, không cần Tuấn nhận 220k rồi chuyển lại Hùng 70k)
    const sBad1 = makeSession('SES_B1', '2026-11-05', 'BADMINTON', 'Cầu lông T4', 'MEM_A');
    const sBad2 = makeSession('SES_B2', '2026-11-12', 'BADMINTON', 'Cầu lông T4 tuần 2', 'MEM_A');
    const sDrink = makeSession('SES_D1', '2026-11-12', 'DRINKING', 'Nhậu Lẩu Dê', 'MEM_A');

    const attendances: Attendance[] = [
      makeAttendance('ATT_G1', 'SES_B1', '2026-11-05', 'BADMINTON', 'MEM_G1', 'GUEST', 50000, 'MEM_A', false),
      makeAttendance('ATT_G2', 'SES_B2', '2026-11-12', 'BADMINTON', 'MEM_G1', 'GUEST', 50000, 'MEM_A', false),
      makeAttendance('ATT_G3', 'SES_D1', '2026-11-12', 'DRINKING', 'MEM_G1', 'GUEST', 120000, 'MEM_A', false),
    ];

    const unpaidReimbursements: FundLedgerEntry[] = [
      {
        ledger_id: 'LED_1',
        date: '2026-11-12',
        type: 'EXPENSE',
        category: 'SHUTTLECOCK',
        amount: 70000,
        member_id: 'MEM_B',
        session_id: 'SES_B2',
        attendance_id: '',
        period: '2026-11',
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        receipt_drive_id: '',
        receipt_url: '',
        description: 'Hùng ứng tiền 1 ống cầu',
        created_by: 'tuan@gmail.com',
        created_at: '2026-11-12T20:00:00+07:00',
      },
    ];

    const result = simplifyDebts({
      attendances,
      sessions: [sBad1, sBad2, sDrink],
      members,
      treasurerMemberId: 'MEM_A',
      unpaidReimbursements,
    });

    expect(result.totalOutstanding).toBe(220000);
    expect(result.transfers).toHaveLength(2);

    const toTuan = result.transfers.find((t) => t.toMember.member_id === 'MEM_A');
    const toHung = result.transfers.find((t) => t.toMember.member_id === 'MEM_B');
    expect(toTuan?.fromMember.member_id).toBe('MEM_G1');
    expect(toTuan?.amount).toBe(150000);
    expect(toHung?.fromMember.member_id).toBe('MEM_G1');
    expect(toHung?.amount).toBe(70000);
    expect(toTuan?.breakdownSessions).toHaveLength(3);
  });

  it('Kịch bản 4: Có người đã thanh toán một phần (unreconciledSettlements)', () => {
    const s1 = makeSession('SES_1', '2026-11-18', 'DRINKING', 'Nhậu tất niên sớm', 'MEM_B');
    const attendances: Attendance[] = [
      makeAttendance('ATT_1', 'SES_1', '2026-11-18', 'DRINKING', 'MEM_A', 'MAIN', 200000, 'MEM_B', false),
    ];

    // Tuấn (A) đã chuyển trước cho Hùng (B) 80.000đ nhưng chưa tất toán hết
    const partialSettlement: Settlement = {
      settlement_id: 'SET_1',
      from_member_id: 'MEM_A',
      to_member_id: 'MEM_B',
      amount: 80000,
      settled_at: '2026-11-19T10:00:00+07:00',
      method: 'VIETQR',
      source_attendance_ids: '',
      source_ledger_ids: '',
      is_reconciled: false,
      transfer_content: 'CLN Tuan tra Hung',
      note: 'Trả trước 80k',
      confirmed_by: 'tuan@gmail.com',
    };

    const result = simplifyDebts({
      attendances,
      sessions: [s1],
      members,
      treasurerMemberId: 'MEM_A',
      unreconciledSettlements: [partialSettlement],
    });

    expect(result.totalOutstanding).toBe(120000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].fromMember.member_id).toBe('MEM_A');
    expect(result.transfers[0].toMember.member_id).toBe('MEM_B');
    expect(result.transfers[0].amount).toBe(120000);

    // Nếu thanh toán nốt 120.000đ còn lại -> công nợ về 0
    const fullyPaidResult = simplifyDebts({
      attendances,
      sessions: [s1],
      members,
      treasurerMemberId: 'MEM_A',
      unreconciledSettlements: [
        partialSettlement,
        { ...partialSettlement, settlement_id: 'SET_2', amount: 120000 },
      ],
    });
    expect(fullyPaidResult.totalOutstanding).toBe(0);
    expect(fullyPaidResult.transfers).toHaveLength(0);
  });
});
