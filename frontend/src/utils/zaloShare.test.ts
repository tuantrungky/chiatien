import { describe, expect, it } from 'vitest';
import { buildDebtsZaloMessage, buildMonthlyBillZaloMessage } from './zaloShare';

describe('zaloShare', () => {
  it('Tạo tin nhắn báo thu tháng có trừ góp cầu và STK Thủ quỹ', () => {
    const msg = buildMonthlyBillZaloMessage({
      clubName: 'Lông Ca Club',
      month: '2026-11',
      bill: {
        month: '2026-11',
        estimate: 2500000,
        court_fee: 1800000,
        shuttle_tube_qty: 2,
        shuttle_tube_amount: 500000,
        prev_overtime_fee: 200000,
        carry_in: 0,
        to_collect: 2500000,
        member_count: 4,
        per_member: 750000,
        billed_total: 2500000,
        actual_cost: 2500000,
        actual_cost_override: null,
        guest_income: 0,
        carry_out: 0,
        status: 'OPEN',
        created_by: '',
        closed_at: '',
      },
      dues: [
        {
          due_id: 'D1',
          month: '2026-11',
          member_id: 'M2',
          member_name: 'Tuấn',
          amount: 250000,
          base_amount: 750000,
          credit_amount: 500000,
          is_paid: false,
          paid_at: '',
          transferContent: 'CLN Tuan cau T11',
          vietQrUrl: null,
        },
      ],
      treasurer: {
        member_id: 'M1',
        name: 'Thảo',
        aliases: '',
        type: 'MAIN',
        phone: '',
        bank_bin: '970436',
        bank_name: 'Vietcombank',
        account_no: '2703999999',
        account_name: 'LAI THANH THAO',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
      appUrl: 'https://chiatien-lyart.vercel.app/monthly',
    });

    expect(msg).toContain('BÁO THU TIỀN CẦU THÁNG 11/2026');
    expect(msg).toContain('2 ống cầu 500.000');
    expect(msg).toContain('Tuấn: 250.000');
    expect(msg).toContain('đã trừ 500.000');
    expect(msg).toContain('2703999999');
  });

  it('Tạo tin nhắn tổng hợp công nợ kèm tag quá hạn', () => {
    const msg = buildDebtsZaloMessage({
      clubName: 'Lông Ca Club',
      todayStr: '2026-11-30',
      debts: {
        treasurerMemberId: 'M1',
        badminton: {
          treasurerMemberId: 'M1',
          treasurerBank: null,
          monthlyDues: [],
          guestDues: [],
          adhocDues: [
            {
              attendance_id: 'A1',
              session_id: 'S1',
              session_date: '2026-11-05',
              session_title: 'Cầu phát sinh',
              member_id: 'M3',
              member_name: 'Chung',
              member_type_snapshot: 'MAIN',
              creditor_id: 'M2',
              creditor_name: 'Tuấn',
              creditorBank: null,
              amount: 60000,
              transferContent: 'CLN Chung cau ps',
              vietQrUrl: null,
            },
          ],
          totalMonthlyUnpaid: 0,
          totalGuestUnpaid: 0,
          totalAdhocUnpaid: 60000,
          totalOutstanding: 60000,
        },
        drinking: {
          netBalances: [],
          simplifiedTransfers: [],
          unpaidAttendances: [],
          recentSettlements: [],
          totalOutstanding: 0,
        },
      },
      simplifiedDrinkingDebts: { netBalances: [], transfers: [], totalOutstanding: 0 },
      appUrl: 'https://chiatien-lyart.vercel.app/debts',
    });

    expect(msg).toContain('Chung -> Tuấn: 60.000');
    expect(msg).toContain('Quá 25 ngày');
  });
});
