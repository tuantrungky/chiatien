import { describe, expect, it } from 'vitest';
import type { Member, SeparatedDebtsData, SimplifiedDebtResult } from '../types';
import {
  DEFAULT_DEBT_FILTER,
  countActiveDebtFilters,
  extractCollectorOptions,
  extractDateOptions,
  filterDebts,
  normalizeViText,
} from './debtFilters';

const members: Member[] = [
  {
    member_id: 'MEM_001',
    name: 'Nguyễn Thảo',
    aliases: 'Thảo quỹ',
    type: 'MAIN',
    phone: '',
    bank_bin: '',
    bank_name: '',
    account_no: '',
    account_name: '',
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  {
    member_id: 'MEM_002',
    name: 'Trần Tuấn',
    aliases: 'Tuan',
    type: 'MAIN',
    phone: '',
    bank_bin: '',
    bank_name: '',
    account_no: '',
    account_name: '',
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  {
    member_id: 'MEM_003',
    name: 'Lê Chung',
    aliases: 'Chung gà',
    type: 'MAIN',
    phone: '',
    bank_bin: '',
    bank_name: '',
    account_no: '',
    account_name: '',
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  {
    member_id: 'MEM_004',
    name: 'Phạm Định',
    aliases: 'Định VL',
    type: 'GUEST',
    phone: '',
    bank_bin: '',
    bank_name: '',
    account_no: '',
    account_name: '',
    is_active: true,
    created_at: '',
    updated_at: '',
  },
];

const debts: SeparatedDebtsData = {
  treasurerMemberId: 'MEM_001',
  badminton: {
    treasurerMemberId: 'MEM_001',
    treasurerBank: null,
    monthlyDues: [
      {
        due_id: 'DUE_1',
        month: '2026-11',
        member_id: 'MEM_002',
        member_name: 'Trần Tuấn',
        amount: 300000,
        issued_at: '2026-11-01',
        is_paid: false,
        paid_at: '',
        transferContent: 'CLN Tuan',
        vietQrUrl: null,
      },
    ],
    guestDues: [
      {
        attendance_id: 'ATT_G1',
        session_id: 'SES_1',
        session_date: '2026-11-20',
        session_title: 'Cầu lông T6',
        member_id: 'MEM_004',
        member_name: 'Phạm Định',
        amount: 50000,
        transferContent: 'CLN Dinh',
        vietQrUrl: null,
      },
    ],
    adhocDues: [
      {
        attendance_id: 'ATT_A1',
        session_id: 'SES_2',
        session_date: '2026-11-22',
        session_title: 'Kèo phát sinh CN',
        member_id: 'MEM_003',
        member_name: 'Lê Chung',
        member_type_snapshot: 'MAIN',
        creditor_id: 'MEM_002',
        creditor_name: 'Trần Tuấn',
        creditorBank: null,
        amount: 75000,
        transferContent: 'CLN Chung',
        vietQrUrl: null,
      },
    ],
    totalMonthlyUnpaid: 300000,
    totalGuestUnpaid: 50000,
    totalAdhocUnpaid: 75000,
    totalOutstanding: 425000,
  },
  drinking: {
    netBalances: [],
    simplifiedTransfers: [],
    unpaidAttendances: [],
    recentSettlements: [],
    totalOutstanding: 200000,
  },
};

const drinkingDebts: SimplifiedDebtResult = {
  netBalances: [],
  totalOutstanding: 200000,
  transfers: [
    {
      fromMember: members[2], // Lê Chung
      toMember: members[1], // Trần Tuấn
      amount: 200000,
      transferContent: 'CLN nhau',
      vietQrUrl: null,
      breakdownSessions: [
        {
          attendanceId: 'ATT_D1',
          sessionId: 'SES_D1',
          sessionDate: '2026-11-22',
          sessionTitle: 'Nhậu lẩu dê',
          sessionType: 'DRINKING',
          amount: 200000,
          contributedAmount: 0,
          perPersonAmount: 200000,
        },
      ],
    },
  ],
};

describe('debtFilters', () => {
  it('chuẩn hóa tiếng Việt không dấu chính xác', () => {
    expect(normalizeViText('Phạm Định')).toBe('pham dinh');
    expect(normalizeViText('Nguyễn Thảo')).toBe('nguyen thao');
  });

  it('lọc theo tên người nợ không dấu và alias', () => {
    const res = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, searchName: 'dinh vl' },
    });
    expect(res.guestDues).toHaveLength(1);
    expect(res.monthlyDues).toHaveLength(0);
    expect(res.adhocDues).toHaveLength(0);
    expect(res.drinkingTransfers).toHaveLength(0);
  });

  it('lọc theo người thu tiền (Thủ quỹ vs Chủ nợ phát sinh/nhậu)', () => {
    const collectors = extractCollectorOptions(debts, drinkingDebts, members[0]);
    expect(collectors[0].id).toBe('MEM_001'); // Thủ quỹ lên đầu
    expect(collectors[0].count).toBe(2);

    const byTuan = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, collectorId: 'MEM_002' },
    });
    expect(byTuan.monthlyDues).toHaveLength(0);
    expect(byTuan.adhocDues).toHaveLength(1);
    expect(byTuan.drinkingTransfers).toHaveLength(1);
  });

  it('lọc theo ngày (YYYY-MM-DD) và theo tháng (MONTH:YYYY-MM)', () => {
    const dates = extractDateOptions(debts, drinkingDebts);
    expect(dates.map((d) => d.value)).toEqual(['2026-11-22', '2026-11-20', 'MONTH:2026-11']);

    const byDay = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, dateFilter: '2026-11-22' },
    });
    expect(byDay.adhocDues).toHaveLength(1);
    expect(byDay.drinkingTransfers).toHaveLength(1);
    expect(byDay.guestDues).toHaveLength(0);

    const byMonth = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, dateFilter: 'MONTH:2026-11' },
    });
    expect(byMonth.totalFilteredCount).toBe(4);
  });

  it('lọc theo nguồn Cố định / Phát sinh / Vãng lai / Ăn nhậu và đếm categoryCounts chính xác', () => {
    const fixedOnly = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, sourceFilter: 'FIXED' },
    });
    expect(fixedOnly.categoryCounts).toEqual({
      all: 4,
      fixed: 2,
      adhoc: 1,
      guest: 1,
      drinking: 1,
    });
    expect(fixedOnly.monthlyDues).toHaveLength(1);
    expect(fixedOnly.guestDues).toHaveLength(1);
    expect(fixedOnly.adhocDues).toHaveLength(0);
    expect(fixedOnly.showBadmintonSection).toBe(true);
    expect(fixedOnly.showDrinkingSection).toBe(false);

    const adhocOnly = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, sourceFilter: 'ADHOC' },
    });
    expect(adhocOnly.adhocDues).toHaveLength(1);
    expect(adhocOnly.monthlyDues).toHaveLength(0);
    expect(adhocOnly.filteredBadmintonTotal).toBe(75000);

    const drinkingOnly = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      filters: { ...DEFAULT_DEBT_FILTER, sourceFilter: 'DRINKING' },
    });
    expect(drinkingOnly.showBadmintonSection).toBe(false);
    expect(drinkingOnly.showDrinkingSection).toBe(true);
    expect(drinkingOnly.filteredDrinkingTotal).toBe(200000);
    expect(countActiveDebtFilters({ ...DEFAULT_DEBT_FILTER, sourceFilter: 'DRINKING' })).toBe(1);
  });

  it('kết hợp onlyMine với các bộ lọc khác', () => {
    const res = filterDebts({
      debts,
      simplifiedDrinkingDebts: drinkingDebts,
      members,
      treasurer: members[0],
      onlyMine: true,
      myMemberId: 'MEM_003',
      filters: DEFAULT_DEBT_FILTER,
    });
    expect(res.totalFilteredCount).toBe(2); // 1 adhoc + 1 drinking của Lê Chung
    expect(res.monthlyDues).toHaveLength(0);
  });
});
