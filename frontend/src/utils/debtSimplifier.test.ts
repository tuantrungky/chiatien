import { describe, expect, it } from 'vitest';
import type { Attendance, Member, MonthlyDue, Session, Settlement } from '../types';
import { buildBadmintonDues, simplifyDebts } from './debtSimplifier';

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
    total_amount: type === 'DRINKING' ? 300000 : 500000,
    guest_fee: type === 'BADMINTON' ? 50000 : 0,
    payer_id: payerId,
    per_person_amount: type === 'DRINKING' ? 100000 : 0,
    attendee_count: 3,
    receipt_drive_id: '',
    receipt_url: '',
    receipt_summary: '',
    note: '',
    court_amount: type === 'BADMINTON' ? 360000 : 0,
    shuttle_qty: type === 'BADMINTON' ? 6 : 0,
    shuttle_amount: type === 'BADMINTON' ? 140000 : 0,
    other_amount: 0,
    cost_detail: '',
    venue_type: type === 'DRINKING' ? 'RESTAURANT' : '',
    plan_id: '',
    created_by: 'tuantrungky@gmail.com',
    created_at: `${date}T20:00:00+07:00`,
    updated_at: `${date}T20:00:00+07:00`,
  };
}

function makeDrinkingAttendance(
  id: string,
  sessionId: string,
  date: string,
  memberId: string,
  perPerson: number,
  contributed: number,
  creditorId: string,
  isPaid = false
): Attendance {
  return {
    attendance_id: id,
    session_id: sessionId,
    session_date: date,
    session_type: 'DRINKING',
    member_id: memberId,
    member_type_snapshot: 'MAIN',
    fee_amount: perPerson,
    creditor_id: creditorId,
    contributed_amount: contributed,
    net_amount: perPerson - contributed,
    is_paid: isPaid,
    paid_at: isPaid ? `${date}T21:00:00+07:00` : '',
    settlement_id: '',
    note: '',
  };
}

describe('debtSimplifier (Tách biệt Cầu lông & Ăn nhậu)', () => {
  const thao = makeMember('MEM_001', 'Thảo', 'MAIN');
  const tuan = makeMember('MEM_002', 'Tuấn', 'MAIN');
  const hung = makeMember('MEM_003', 'Hùng', 'MAIN');
  const huan = makeMember('MEM_G1', 'Huấn', 'GUEST');
  const members = [thao, tuan, hung, huan];

  it('Hồi quy lỗi cũ: Tạo buổi cầu lông có vãng lai KHÔNG sinh lệnh chuyển chéo giữa các MAIN', () => {
    const sBad = makeSession('SES_B1', '2026-11-25', 'BADMINTON', 'Cầu lông T4', 'MEM_001');
    const badAttendances: Attendance[] = [
      {
        attendance_id: 'ATT_M1',
        session_id: 'SES_B1',
        session_date: '2026-11-25',
        session_type: 'BADMINTON',
        member_id: 'MEM_001',
        member_type_snapshot: 'MAIN',
        fee_amount: 0,
        creditor_id: 'MEM_001',
        contributed_amount: 0,
        net_amount: 0,
        is_paid: true,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_M2',
        session_id: 'SES_B1',
        session_date: '2026-11-25',
        session_type: 'BADMINTON',
        member_id: 'MEM_002',
        member_type_snapshot: 'MAIN',
        fee_amount: 0,
        creditor_id: 'MEM_001',
        contributed_amount: 0,
        net_amount: 0,
        is_paid: true,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_G1',
        session_id: 'SES_B1',
        session_date: '2026-11-25',
        session_type: 'BADMINTON',
        member_id: 'MEM_G1',
        member_type_snapshot: 'GUEST',
        fee_amount: 50000,
        creditor_id: 'MEM_001',
        contributed_amount: 0,
        net_amount: 50000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
    ];

    // 1. simplifyDebts (Nhậu) phải hoàn toàn rỗng khi chỉ có buổi cầu lông
    const drinkingResult = simplifyDebts({
      attendances: badAttendances,
      sessions: [sBad],
      members,
    });
    expect(drinkingResult.transfers).toHaveLength(0);
    expect(drinkingResult.totalOutstanding).toBe(0);

    // 2. buildBadmintonDues chỉ hiện vãng lai Huấn nợ Thủ quỹ Thảo 50k + hóa đơn tháng (nếu có)
    const monthlyDues: MonthlyDue[] = [
      {
        due_id: 'DUE_1',
        month: '2026-11',
        member_id: 'MEM_002',
        amount: 300000,
        is_paid: false,
        paid_at: '',
        confirmed_by: '',
      },
    ];
    const badmintonDues = buildBadmintonDues({
      monthlyDues,
      attendances: badAttendances,
      sessions: [sBad],
      members,
      treasurerMemberId: 'MEM_001',
    });

    expect(badmintonDues.monthlyDues).toHaveLength(1);
    expect(badmintonDues.monthlyDues[0].member_id).toBe('MEM_002');
    expect(badmintonDues.guestDues).toHaveLength(1);
    expect(badmintonDues.guestDues[0].member_id).toBe('MEM_G1');
    expect(badmintonDues.totalOutstanding).toBe(350000);
  });

  it('Nợ vòng tròn Ăn nhậu A -> B -> C được cấn trừ thành A -> C', () => {
    const s1 = makeSession('SES_D1', '2026-11-11', 'DRINKING', 'Nhậu 1', 'MEM_002');
    const s2 = makeSession('SES_D2', '2026-11-13', 'DRINKING', 'Nhậu 2', 'MEM_003');

    // Buổi 1: Thảo nợ 100k, Tuấn được nhận 100k
    // Buổi 2: Tuấn nợ 100k, Hùng được nhận 100k
    const attendances: Attendance[] = [
      makeDrinkingAttendance('A1', 'SES_D1', '2026-11-11', 'MEM_001', 100000, 0, 'MEM_002', false),
      makeDrinkingAttendance('A2', 'SES_D1', '2026-11-11', 'MEM_002', 100000, 200000, 'MEM_002', false),
      makeDrinkingAttendance('A3', 'SES_D2', '2026-11-13', 'MEM_002', 100000, 0, 'MEM_003', false),
      makeDrinkingAttendance('A4', 'SES_D2', '2026-11-13', 'MEM_003', 100000, 200000, 'MEM_003', false),
    ];

    const result = simplifyDebts({ attendances, sessions: [s1, s2], members });
    expect(result.totalOutstanding).toBe(100000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].fromMember.member_id).toBe('MEM_001');
    expect(result.transfers[0].toMember.member_id).toBe('MEM_003');
    expect(result.transfers[0].amount).toBe(100000);
  });

  it('Cộng dồn nhiều buổi ăn nhậu có góp món và thanh toán một phần', () => {
    const s1 = makeSession('SES_D1', '2026-11-15', 'DRINKING', 'Nhậu ở nhà', 'MEM_001');
    const s2 = makeSession('SES_D2', '2026-11-18', 'DRINKING', 'Nhậu quán ốc', 'MEM_001');

    // Tổng 2 buổi: Tuấn nợ Thảo 150k + 200k = 350k
    const attendances: Attendance[] = [
      makeDrinkingAttendance('A1', 'SES_D1', '2026-11-15', 'MEM_002', 150000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A2', 'SES_D1', '2026-11-15', 'MEM_001', 150000, 300000, 'MEM_001', false),
      makeDrinkingAttendance('A3', 'SES_D2', '2026-11-18', 'MEM_002', 200000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A4', 'SES_D2', '2026-11-18', 'MEM_001', 200000, 400000, 'MEM_001', false),
    ];

    const partial: Settlement = {
      settlement_id: 'SET_1',
      from_member_id: 'MEM_002',
      to_member_id: 'MEM_001',
      amount: 100000,
      settled_at: '2026-11-19T10:00:00+07:00',
      method: 'VIETQR',
      category: 'DRINKING',
      source_attendance_ids: '',
      source_ledger_ids: '',
      is_reconciled: false,
      transfer_content: 'CLN Tuan tra Thao',
      note: '',
      confirmed_by: 'tuantrungky@gmail.com',
    };

    const result = simplifyDebts({
      attendances,
      sessions: [s1, s2],
      members,
      unreconciledSettlements: [partial],
    });

    expect(result.totalOutstanding).toBe(250000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].amount).toBe(250000);
    expect(result.transfers[0].breakdownSessions).toHaveLength(2);
  });

  it('Buổi cầu phát sinh (AD_HOC) chia đều cho cả MAIN & GUEST và không chảy sang Ăn nhậu', () => {
    const adhocSession: Session = {
      ...makeSession('SES_ADHOC', '2026-11-24', 'BADMINTON', 'Cầu phát sinh T3', 'MEM_002'),
      billing_mode: 'AD_HOC',
      total_amount: 300000,
      per_person_amount: 100000,
      guest_fee: 0,
    };
    const adhocAttendances: Attendance[] = [
      {
        attendance_id: 'ATT_AH_1',
        session_id: 'SES_ADHOC',
        session_date: '2026-11-24',
        session_type: 'BADMINTON',
        member_id: 'MEM_002',
        member_type_snapshot: 'MAIN',
        fee_amount: 100000,
        creditor_id: 'MEM_002',
        contributed_amount: 0,
        net_amount: 0,
        is_paid: true,
        paid_at: '2026-11-24T20:00:00+07:00',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_AH_2',
        session_id: 'SES_ADHOC',
        session_date: '2026-11-24',
        session_type: 'BADMINTON',
        member_id: 'MEM_003',
        member_type_snapshot: 'MAIN',
        fee_amount: 100000,
        creditor_id: 'MEM_002',
        contributed_amount: 0,
        net_amount: 100000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_AH_3',
        session_id: 'SES_ADHOC',
        session_date: '2026-11-24',
        session_type: 'BADMINTON',
        member_id: 'MEM_G1',
        member_type_snapshot: 'GUEST',
        fee_amount: 100000,
        creditor_id: 'MEM_002',
        contributed_amount: 0,
        net_amount: 100000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
    ];

    const drinkingRes = simplifyDebts({
      attendances: adhocAttendances,
      sessions: [adhocSession],
      members,
    });
    expect(drinkingRes.transfers).toHaveLength(0);

    const badRes = buildBadmintonDues({
      monthlyDues: [],
      attendances: adhocAttendances,
      sessions: [adhocSession],
      members,
      treasurerMemberId: 'MEM_001',
    });
    expect(badRes.guestDues).toHaveLength(0);
    expect(badRes.adhocDues).toHaveLength(2);
    expect(badRes.adhocDues[0].creditor_id).toBe('MEM_002');
    expect(badRes.totalAdhocUnpaid).toBe(200000);
    expect(badRes.totalOutstanding).toBe(200000);
  });
});
