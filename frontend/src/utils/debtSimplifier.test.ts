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

  it('Phát hiện imbalanceAmount khi bị lệch tổng chủ nợ / con nợ và đánh dấu isSplitFromMultipleTransfers', () => {
    const splitSession = makeSession('SES_SPLIT', '2026-11-25', 'DRINKING', 'Nhậu chia 2 chủ nợ', 'MEM_001');
    const splitAtts: Attendance[] = [
      {
        attendance_id: 'ATT_S1',
        session_id: 'SES_SPLIT',
        session_date: '2026-11-25',
        session_type: 'DRINKING',
        member_id: 'MEM_001',
        member_type_snapshot: 'MAIN',
        fee_amount: 100000,
        creditor_id: 'MEM_001',
        contributed_amount: 200000,
        net_amount: -100000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_S2',
        session_id: 'SES_SPLIT',
        session_date: '2026-11-25',
        session_type: 'DRINKING',
        member_id: 'MEM_002',
        member_type_snapshot: 'MAIN',
        fee_amount: 100000,
        creditor_id: 'MEM_002',
        contributed_amount: 300000,
        net_amount: -200000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
      {
        attendance_id: 'ATT_S3',
        session_id: 'SES_SPLIT',
        session_date: '2026-11-25',
        session_type: 'DRINKING',
        member_id: 'MEM_003',
        member_type_snapshot: 'MAIN',
        fee_amount: 300000,
        creditor_id: 'MEM_001',
        contributed_amount: 0,
        net_amount: 300000,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: '',
      },
    ];

    const splitRes = simplifyDebts({
      attendances: splitAtts,
      sessions: [splitSession],
      members,
    });
    expect(splitRes.imbalanceAmount).toBe(0);
    expect(splitRes.transfers).toHaveLength(2);
    expect(splitRes.transfers.every((t) => t.isSplitFromMultipleTransfers === true)).toBe(true);

    // Nếu tạo thêm khoản lệch giả lập (ví dụ thanh toán 1 phần lệch) -> imbalanceAmount != 0
    const skewedAtts: Attendance[] = [
      ...splitAtts.slice(0, 2),
      { ...splitAtts[2], net_amount: 250000 },
    ];
    const skewedRes = simplifyDebts({
      attendances: skewedAtts,
      sessions: [splitSession],
      members,
    });
    expect(skewedRes.imbalanceAmount).toBe(50000);
  });

  it('2 buổi nhậu độc lập (21/11 Chung trả & 23/11 Thảo trả) giữ đúng chủ nợ từng bữa, không ghép chéo', () => {
    const chung = makeMember('MEM_CHUNG', 'Chung', 'MAIN');
    const binh = makeMember('MEM_BINH', 'Bình', 'MAIN');
    const minh = makeMember('MEM_MINH', 'Minh', 'MAIN');
    const ha = makeMember('MEM_HA', 'Hà', 'MAIN');
    const nam = makeMember('MEM_NAM', 'Nam', 'MAIN');
    const lan = makeMember('MEM_LAN', 'Lan', 'MAIN');
    const duc = makeMember('MEM_DUC', 'Đức', 'MAIN');
    const allMembers = [thao, chung, binh, minh, ha, nam, lan, duc];

    const ses21 = makeSession('SES_21', '2026-11-21', 'DRINKING', 'Nhậu nhà anh Chung', 'MEM_CHUNG');
    const ses23 = makeSession('SES_23', '2026-11-23', 'DRINKING', 'Phương câu em', 'MEM_001');

    // 21/11: Chung trả 1.000.000đ cho 4 người (250k/người): Chung nhận 750k, Bình/Minh/Hà mỗi người trả 250k
    const atts21: Attendance[] = [
      makeDrinkingAttendance('A21_C', 'SES_21', '2026-11-21', 'MEM_CHUNG', 250000, 1000000, 'MEM_CHUNG', false),
      makeDrinkingAttendance('A21_B', 'SES_21', '2026-11-21', 'MEM_BINH', 250000, 0, 'MEM_CHUNG', false),
      makeDrinkingAttendance('A21_M', 'SES_21', '2026-11-21', 'MEM_MINH', 250000, 0, 'MEM_CHUNG', false),
      makeDrinkingAttendance('A21_H', 'SES_21', '2026-11-21', 'MEM_HA', 250000, 0, 'MEM_CHUNG', false),
    ];

    // 23/11: Thảo trả bill, 6 người nợ 159k (Bình, Nam, Lan, Đức, Tuấn, Hùng) -> Thảo nhận 954k
    const atts23: Attendance[] = [
      makeDrinkingAttendance('A23_T', 'SES_23', '2026-11-23', 'MEM_001', 159000, 1113000, 'MEM_001', false),
      makeDrinkingAttendance('A23_B', 'SES_23', '2026-11-23', 'MEM_BINH', 159000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A23_N', 'SES_23', '2026-11-23', 'MEM_NAM', 159000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A23_L', 'SES_23', '2026-11-23', 'MEM_LAN', 159000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A23_D', 'SES_23', '2026-11-23', 'MEM_DUC', 159000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A23_TU', 'SES_23', '2026-11-23', 'MEM_002', 159000, 0, 'MEM_001', false),
      makeDrinkingAttendance('A23_HU', 'SES_23', '2026-11-23', 'MEM_003', 159000, 0, 'MEM_001', false),
    ];

    const res = simplifyDebts({
      attendances: [...atts21, ...atts23],
      sessions: [ses21, ses23],
      members: [...allMembers, tuan, hung],
    });

    // Phải ra đúng 9 lệnh chuyển (3 lệnh 250k về Chung + 6 lệnh 159k về Thảo), không bị tách 45k/114k
    expect(res.transfers).toHaveLength(9);
    expect(res.totalOutstanding).toBe(750000 + 954000);

    const toChung = res.transfers.filter((t) => t.toMember.member_id === 'MEM_CHUNG');
    const toThao = res.transfers.filter((t) => t.toMember.member_id === 'MEM_001');
    expect(toChung).toHaveLength(3);
    expect(toChung.every((t) => t.amount === 250000)).toBe(true);
    expect(toChung.every((t) => t.breakdownSessions.length === 1 && t.breakdownSessions[0].sessionId === 'SES_21')).toBe(true);
    expect(toChung[0].breakdownSessions[0].payerName).toBe('Chung');

    expect(toThao).toHaveLength(6);
    expect(toThao.every((t) => t.amount === 159000)).toBe(true);
    expect(toThao.every((t) => t.breakdownSessions.length === 1 && t.breakdownSessions[0].sessionId === 'SES_23')).toBe(true);
    expect(toThao[0].breakdownSessions[0].payerName).toBe('Thảo');
  });
});
