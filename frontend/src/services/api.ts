/**
 * api.ts
 * API client giao tiếp với Google Apps Script Web App (VITE_GAS_API_URL).
 * - GET cho các request đọc dữ liệu công khai (Viewer)
 * - POST dùng Content-Type: text/plain;charset=utf-8 để tránh CORS preflight trên GAS
 * - Hỗ trợ chế độ Mock Data (VITE_USE_MOCK=true hoặc chưa cấu hình VITE_GAS_API_URL)
 */

import type {
  AddFundEntryPayload,
  ApiResponse,
  BootstrapData,
  ConfirmPaymentPayload,
  ConfirmPaymentResponse,
  CreateSessionPayload,
  CreateSessionResponse,
  DashboardData,
  DebtsData,
  Editor,
  FundLedgerData,
  FundLedgerEntry,
  FundLedgerType,
  GuestStatItem,
  GuestStatsData,
  ManageEditorsPayload,
  Member,
  ParseBillAIResponse,
  ParseVoiceAttendanceAIResponse,
  PeriodType,
  SessionDetailData,
  SettingsMap,
  UpdateSessionPayload,
  UpdateSettingsPayload,
  UpsertMemberPayload,
  VerifyEditorResponse,
} from '../types';
import { getPeriodRange, getTodayDateStr, isDateInRange } from '../utils/dateFilters';
import { simplifyDebts } from '../utils/debtSimplifier';
import {
  initialMockAttendances,
  initialMockEditors,
  initialMockFundLedger,
  initialMockMembers,
  initialMockSessions,
  initialMockSettings,
  initialMockSettlements,
} from './mockData';

export class ApiClientError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

const GAS_API_URL = String(import.meta.env?.VITE_GAS_API_URL || '').trim();
export const IS_MOCK_MODE =
  String(import.meta.env?.VITE_USE_MOCK || '').toLowerCase() === 'true' ||
  !GAS_API_URL ||
  GAS_API_URL.includes('YOUR_DEPLOYMENT_ID');

// State trong bộ nhớ cho Mock Mode
const mockState = {
  settings: { ...initialMockSettings },
  members: structuredClone(initialMockMembers),
  sessions: structuredClone(initialMockSessions),
  attendances: structuredClone(initialMockAttendances),
  fundLedger: structuredClone(initialMockFundLedger),
  settlements: structuredClone(initialMockSettlements),
  editors: structuredClone(initialMockEditors),
};

function nowIso(): string {
  return new Date().toISOString();
}

function mockDelay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function gasGet<T>(action: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const url = new URL(GAS_API_URL);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new ApiClientError('INTERNAL_ERROR', `Lỗi HTTP ${res.status} từ GAS`, res.status);
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok || json.data === null) {
    throw new ApiClientError(
      json.error?.code || 'INTERNAL_ERROR',
      json.error?.message || 'Yêu cầu thất bại.',
      json.error?.status
    );
  }
  return json.data;
}

async function gasPost<T>(action: string, idToken: string, payload: unknown): Promise<T> {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action,
      id_token: idToken,
      payload,
    }),
  });

  if (!res.ok) {
    throw new ApiClientError('INTERNAL_ERROR', `Lỗi HTTP ${res.status} từ GAS`, res.status);
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok || json.data === null) {
    throw new ApiClientError(
      json.error?.code || 'INTERNAL_ERROR',
      json.error?.message || 'Yêu cầu POST thất bại.',
      json.error?.status
    );
  }
  return json.data;
}

function buildMockDebts(): DebtsData {
  const unpaidReimbursements = mockState.fundLedger.filter(
    (l) => l.type === 'EXPENSE' && !l.is_paid && l.member_id !== mockState.settings.treasurer_member_id
  );
  const unreconciledSettlements = mockState.settlements.filter((s) => !s.is_reconciled);

  const simplified = simplifyDebts({
    attendances: mockState.attendances,
    sessions: mockState.sessions,
    members: mockState.members,
    treasurerMemberId: mockState.settings.treasurer_member_id,
    unpaidReimbursements,
    unreconciledSettlements,
    transferPrefix: mockState.settings.transfer_prefix,
    vietqrTemplate: mockState.settings.vietqr_template,
  });

  return {
    treasurerMemberId: mockState.settings.treasurer_member_id,
    netBalances: simplified.netBalances,
    simplifiedTransfers: simplified.transfers.map((t) => ({
      fromMemberId: t.fromMember.member_id,
      fromName: t.fromMember.name,
      toMemberId: t.toMember.member_id,
      toName: t.toMember.name,
      amount: t.amount,
      transferContent: t.transferContent,
      toBank: t.toMember.bank_bin
        ? {
            bankBin: t.toMember.bank_bin,
            bankName: t.toMember.bank_name,
            accountNo: t.toMember.account_no,
            accountName: t.toMember.account_name,
          }
        : null,
      vietQrUrl: t.vietQrUrl,
    })),
    unpaidAttendances: mockState.attendances.filter((a) => !a.is_paid && a.fee_amount > 0),
    unpaidReimbursements: unpaidReimbursements.map((l) => ({
      ledger_id: l.ledger_id,
      date: l.date,
      category: l.category,
      amount: l.amount,
      member_id: l.member_id,
      member_name: l.member_name || l.member_id,
      description: l.description,
    })),
    recentSettlements: [...mockState.settlements].sort((a, b) => b.settled_at.localeCompare(a.settled_at)),
  };
}

// ============================================================================
// PUBLIC READ APIs (Viewer)
// ============================================================================

export async function fetchBootstrap(): Promise<BootstrapData> {
  if (!IS_MOCK_MODE) {
    return gasGet<BootstrapData>('bootstrap');
  }
  return mockDelay({
    settings: { ...mockState.settings },
    members: [...mockState.members],
  });
}

export async function fetchDashboard(periodType: PeriodType = 'MONTH', refDate?: string): Promise<DashboardData> {
  if (!IS_MOCK_MODE) {
    return gasGet<DashboardData>('getDashboard', { periodType, refDate });
  }

  const ref = refDate || getTodayDateStr();
  const period = getPeriodRange(periodType, ref);
  const ledger = await fetchFundLedger(periodType, ref, 'ALL');
  const allLedger = await fetchFundLedger('ALL', ref, 'ALL');
  const debts = buildMockDebts();
  const currentMonth = ref.slice(0, 7);

  const paidMonthlyByMember = new Map<string, number>();
  let pendingReimbursement = 0;
  for (const l of mockState.fundLedger) {
    if (l.type === 'INCOME' && l.category === 'MONTHLY_FUND' && l.period === currentMonth) {
      paidMonthlyByMember.set(l.member_id, (paidMonthlyByMember.get(l.member_id) || 0) + l.amount);
    }
    if (l.type === 'EXPENSE' && !l.is_paid) {
      pendingReimbursement += l.amount;
    }
  }

  const monthlyFundStatus = mockState.members
    .filter((m) => m.is_active && m.type === 'MAIN')
    .map((m) => {
      const paidAmount = paidMonthlyByMember.get(m.member_id) || 0;
      return { member_id: m.member_id, name: m.name, paidAmount, isPaid: paidAmount > 0 };
    });

  const totalOutstanding = debts.simplifiedTransfers.reduce((sum, t) => sum + t.amount, 0);

  return mockDelay({
    period,
    currentMonth,
    fund: {
      currentBalance: allLedger.summary.closingBalance,
      periodIncome: ledger.summary.totalIncome,
      periodExpense: ledger.summary.totalExpense,
      pendingReimbursement,
    },
    debtsSummary: {
      totalOutstanding,
      pendingTransferCount: debts.simplifiedTransfers.length,
    },
    simplifiedTransfers: debts.simplifiedTransfers,
    recentSessions: [...mockState.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    monthlyFundStatus,
  });
}

export async function fetchMembers(activeOnly = false): Promise<Member[]> {
  if (!IS_MOCK_MODE) {
    const data = await gasGet<{ members: Member[] }>('getMembers', { activeOnly });
    return data.members;
  }
  return mockDelay(
    activeOnly ? mockState.members.filter((m) => m.is_active) : [...mockState.members]
  );
}

export async function fetchSessions(filters?: {
  type?: 'ALL' | 'BADMINTON' | 'DRINKING';
  startDate?: string | null;
  endDate?: string | null;
}) {
  if (!IS_MOCK_MODE) {
    const data = await gasGet<{ sessions: typeof mockState.sessions }>('getSessions', {
      type: filters?.type || 'ALL',
      startDate: filters?.startDate || undefined,
      endDate: filters?.endDate || undefined,
    });
    return data.sessions;
  }

  const typeFilter = filters?.type || 'ALL';
  return mockDelay(
    mockState.sessions
      .filter((s) => {
        if (typeFilter !== 'ALL' && s.type !== typeFilter) return false;
        if (filters?.startDate && s.date < filters.startDate) return false;
        if (filters?.endDate && s.date > filters.endDate) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  );
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
  if (!IS_MOCK_MODE) {
    return gasGet<SessionDetailData>('getSessionDetail', { sessionId });
  }
  const session = mockState.sessions.find((s) => s.session_id === sessionId);
  if (!session) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`);
  }
  return mockDelay({
    session,
    attendances: mockState.attendances.filter((a) => a.session_id === sessionId),
    linkedExpenses: mockState.fundLedger.filter((l) => l.session_id === sessionId),
  });
}

export async function fetchFundLedger(
  periodType: PeriodType = 'MONTH',
  refDate?: string,
  type: 'ALL' | FundLedgerType = 'ALL'
): Promise<FundLedgerData> {
  if (!IS_MOCK_MODE) {
    return gasGet<FundLedgerData>('getFundLedger', { periodType, refDate, type });
  }

  const period = getPeriodRange(periodType, refDate || getTodayDateStr());
  let openingBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  const entries: FundLedgerEntry[] = [];

  for (const row of mockState.fundLedger) {
    if (period.startDate && row.date < period.startDate) {
      openingBalance += row.type === 'INCOME' ? row.amount : -row.amount;
      continue;
    }
    if (!isDateInRange(row.date, period)) continue;

    if (row.type === 'INCOME') totalIncome += row.amount;
    else totalExpense += row.amount;

    if (type === 'ALL' || row.type === type) {
      entries.push(row);
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return mockDelay({
    period,
    summary: {
      openingBalance,
      totalIncome,
      totalExpense,
      closingBalance: openingBalance + totalIncome - totalExpense,
    },
    entries,
  });
}

export async function fetchSettings(): Promise<SettingsMap> {
  if (!IS_MOCK_MODE) {
    const data = await gasGet<{ settings: SettingsMap }>('getSettings');
    return data.settings;
  }
  return mockDelay({ ...mockState.settings });
}

export async function fetchGuestStats(month?: string): Promise<GuestStatsData> {
  if (!IS_MOCK_MODE) {
    return gasGet<GuestStatsData>('getGuestStats', { month });
  }

  const targetMonth = month || getTodayDateStr().slice(0, 7);
  const byGuest = new Map<string, GuestStatItem>();
  let totalVisits = 0;
  let totalFee = 0;
  let totalPaid = 0;
  let totalUnpaid = 0;

  for (const att of mockState.attendances) {
    if (att.member_type_snapshot !== 'GUEST' || att.session_date.slice(0, 7) !== targetMonth) {
      continue;
    }
    let item = byGuest.get(att.member_id);
    if (!item) {
      const mName = mockState.members.find((m) => m.member_id === att.member_id)?.name || att.member_name || att.member_id;
      item = {
        memberId: att.member_id,
        name: mName,
        sessionCount: 0,
        dates: [],
        totalFee: 0,
        totalPaid: 0,
        totalUnpaid: 0,
        sessions: [],
      };
      byGuest.set(att.member_id, item);
    }

    item.sessionCount += 1;
    if (!item.dates.includes(att.session_date)) item.dates.push(att.session_date);
    item.totalFee += att.fee_amount;
    if (att.is_paid) {
      item.totalPaid += att.fee_amount;
      totalPaid += att.fee_amount;
    } else {
      item.totalUnpaid += att.fee_amount;
      totalUnpaid += att.fee_amount;
    }
    totalVisits += 1;
    totalFee += att.fee_amount;

    item.sessions.push({
      attendanceId: att.attendance_id,
      sessionId: att.session_id,
      date: att.session_date,
      sessionType: att.session_type,
      feeAmount: att.fee_amount,
      isPaid: att.is_paid,
    });
  }

  const guests = Array.from(byGuest.values()).sort((a, b) => b.totalUnpaid - a.totalUnpaid);
  return mockDelay({
    month: targetMonth,
    summary: {
      totalGuests: guests.length,
      totalVisits,
      totalFee,
      totalPaid,
      totalUnpaid,
    },
    guests,
  });
}

export async function fetchDebts(): Promise<DebtsData> {
  if (!IS_MOCK_MODE) {
    return gasGet<DebtsData>('getDebts');
  }
  return mockDelay(buildMockDebts());
}

// ============================================================================
// EDITOR AUTH, AI & WRITE APIs (POST text/plain + id_token)
// ============================================================================

export async function verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
  if (!IS_MOCK_MODE) {
    return gasPost<VerifyEditorResponse>('verifyEditor', idToken, {});
  }
  return mockDelay({
    authorized: true,
    email: 'editor.mock@gmail.com',
    name: 'Mock Editor',
    role: 'ADMIN',
  });
}

export async function parseBillAI(
  idToken: string,
  payload: { base64Image: string; mimeType: string; sessionDate?: string }
): Promise<ParseBillAIResponse> {
  if (!IS_MOCK_MODE) {
    return gasPost<ParseBillAIResponse>('parseBillAI', idToken, payload);
  }
  return mockDelay(
    {
      receipt_drive_id: 'MOCK_FILE_ID',
      receipt_url: 'https://drive.google.com',
      total_amount: 640000,
      items_summary: 'Lẩu gà lá é (1), Gà nướng (1), Bia Tiger (10)',
      suggested_title: 'Nhậu Quán Lẩu Gà',
    },
    450
  );
}

export async function parseVoiceAttendanceAI(
  idToken: string,
  payload: { transcript?: string; audioBase64?: string; mimeType?: string }
): Promise<ParseVoiceAttendanceAIResponse> {
  if (!IS_MOCK_MODE) {
    return gasPost<ParseVoiceAttendanceAIResponse>('parseVoiceAttendanceAI', idToken, payload);
  }
  const text = (payload.transcript || '').toLowerCase();
  const matched = mockState.members
    .filter((m) => m.is_active && text.includes(m.name.split(' ').pop()?.toLowerCase() || ''))
    .map((m) => m.member_id);
  return mockDelay(
    {
      matched_member_ids: matched,
      new_guests: text.includes('nam') ? ['Nam'] : [],
      notes: 'Mock AI voice parser',
    },
    350
  );
}

export async function createSession(
  idToken: string,
  payload: CreateSessionPayload
): Promise<CreateSessionResponse> {
  if (!IS_MOCK_MODE) {
    return gasPost<CreateSessionResponse>('createSession', idToken, payload);
  }

  const now = nowIso();
  const createdMembers: Member[] = [];
  const newGuestIds: string[] = [];

  for (const g of payload.new_guests || []) {
    const name = typeof g === 'string' ? g.trim() : g.name.trim();
    if (!name) continue;
    const existing = mockState.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      newGuestIds.push(existing.member_id);
      continue;
    }
    const member: Member = {
      member_id: `MEM_MOCK_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      aliases: typeof g === 'object' ? g.aliases || '' : '',
      type: 'GUEST',
      phone: '',
      bank_bin: '',
      bank_name: '',
      account_no: '',
      account_name: '',
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    mockState.members.push(member);
    createdMembers.push(member);
    newGuestIds.push(member.member_id);
  }

  const attendeeIds = Array.from(new Set([...payload.attendeeIds, ...newGuestIds]));
  const sessionType = payload.type || payload.category || 'BADMINTON';
  const guestFee = payload.guestFee ?? mockState.settings.guest_fee;
  const unit = mockState.settings.rounding_unit || 1000;
  const perPerson =
    sessionType === 'DRINKING' && attendeeIds.length > 0
      ? Math.round(payload.totalAmount / attendeeIds.length / unit) * unit
      : 0;

  const sessionId = `SES_MOCK_${Date.now()}`;
  const session = {
    session_id: sessionId,
    date: payload.date,
    type: sessionType,
    title: payload.title,
    total_amount: payload.totalAmount,
    guest_fee: sessionType === 'BADMINTON' ? guestFee : 0,
    payer_id: payload.payerId,
    payer_name: mockState.members.find((m) => m.member_id === payload.payerId)?.name || '',
    per_person_amount: perPerson,
    attendee_count: attendeeIds.length,
    receipt_drive_id: payload.receiptDriveId || '',
    receipt_url: payload.receiptUrl || '',
    receipt_summary: payload.receiptSummary || '',
    note: payload.note || '',
    created_by: 'editor.mock@gmail.com',
    created_at: now,
    updated_at: now,
  };
  mockState.sessions.push(session);

  const paidImmSet = new Set(payload.paidImmediatelyMemberIds || []);
  const newAttendances = attendeeIds.map((mId, idx) => {
    const member = mockState.members.find((m) => m.member_id === mId)!;
    const isBadminton = sessionType === 'BADMINTON';
    const fee = isBadminton ? (member.type === 'GUEST' ? guestFee : 0) : perPerson;
    const isPaid = isBadminton
      ? member.type === 'MAIN' || paidImmSet.has(mId) || fee === 0
      : mId === payload.payerId || fee === 0;
    const att = {
      attendance_id: `ATT_MOCK_${Date.now()}_${idx}`,
      session_id: sessionId,
      session_date: payload.date,
      session_type: sessionType,
      member_id: mId,
      member_name: member.name,
      member_type_snapshot: member.type,
      fee_amount: fee,
      creditor_id: isBadminton ? mockState.settings.treasurer_member_id : payload.payerId,
      is_paid: isPaid,
      paid_at: isPaid ? now : '',
      settlement_id: '',
      note: '',
    };
    mockState.attendances.push(att);
    return att;
  });

  const ledgerEntries: FundLedgerEntry[] = [];
  if (sessionType === 'BADMINTON' && payload.totalAmount > 0) {
    const exp: FundLedgerEntry = {
      ledger_id: `LED_MOCK_${Date.now()}`,
      date: payload.date,
      type: 'EXPENSE',
      category: payload.expenseCategory || 'COURT',
      amount: payload.totalAmount,
      member_id: payload.payerId,
      session_id: sessionId,
      attendance_id: '',
      period: payload.date.slice(0, 7),
      is_paid: payload.payerId === mockState.settings.treasurer_member_id,
      paid_at: payload.payerId === mockState.settings.treasurer_member_id ? now : '',
      settlement_id: '',
      receipt_drive_id: payload.receiptDriveId || '',
      receipt_url: payload.receiptUrl || '',
      description: payload.expenseDescription || payload.title,
      created_by: 'editor.mock@gmail.com',
      created_at: now,
    };
    mockState.fundLedger.push(exp);
    ledgerEntries.push(exp);
  }

  return mockDelay({ session, createdMembers, attendances: newAttendances, ledgerEntries });
}

export async function confirmPayment(
  idToken: string,
  payload: ConfirmPaymentPayload
): Promise<ConfirmPaymentResponse> {
  if (!IS_MOCK_MODE) {
    return gasPost<ConfirmPaymentResponse>('confirmPayment', idToken, payload);
  }

  const now = nowIso();
  const settlementId = `SET_MOCK_${Date.now()}`;
  const mode = payload.mode || 'SIMPLIFIED_TRANSFER';

  const appendGuestFeeIfNeeded = (att: (typeof mockState.attendances)[number]) => {
    if (att.session_type !== 'BADMINTON' || att.member_type_snapshot !== 'GUEST' || att.fee_amount <= 0) {
      return;
    }
    const exists = mockState.fundLedger.some((l) => l.attendance_id === att.attendance_id);
    if (exists) return;
    mockState.fundLedger.push({
      ledger_id: `LED_MOCK_GF_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      date: att.session_date,
      type: 'INCOME',
      category: 'GUEST_FEE',
      amount: att.fee_amount,
      member_id: att.member_id,
      member_name: att.member_name,
      session_id: att.session_id,
      attendance_id: att.attendance_id,
      period: att.session_date.slice(0, 7),
      is_paid: true,
      paid_at: now,
      settlement_id: settlementId,
      receipt_drive_id: '',
      receipt_url: '',
      description: `Thu phí vãng lai: ${att.member_name || att.member_id}`,
      created_by: 'editor.mock@gmail.com',
      created_at: now,
    });
  };

  if (mode === 'ITEMS') {
    const attSet = new Set(payload.attendanceIds || []);
    const ledSet = new Set(payload.ledgerIds || []);
    let sumAmt = 0;

    for (const att of mockState.attendances) {
      if (attSet.has(att.attendance_id) && !att.is_paid) {
        att.is_paid = true;
        att.paid_at = now;
        att.settlement_id = settlementId;
        sumAmt += att.fee_amount;
        appendGuestFeeIfNeeded(att);
      }
    }
    for (const led of mockState.fundLedger) {
      if (ledSet.has(led.ledger_id) && !led.is_paid) {
        led.is_paid = true;
        led.paid_at = now;
        led.settlement_id = settlementId;
        sumAmt += led.amount;
      }
    }

    const settlement = {
      settlement_id: settlementId,
      from_member_id: payload.fromMemberId,
      from_name: mockState.members.find((m) => m.member_id === payload.fromMemberId)?.name || '',
      to_member_id: payload.toMemberId,
      to_name: mockState.members.find((m) => m.member_id === payload.toMemberId)?.name || '',
      amount: sumAmt || payload.amount || 0,
      settled_at: now,
      method: payload.method,
      source_attendance_ids: (payload.attendanceIds || []).join(','),
      source_ledger_ids: (payload.ledgerIds || []).join(','),
      is_reconciled: true,
      transfer_content: payload.transferContent || '',
      note: payload.note || '',
      confirmed_by: 'editor.mock@gmail.com',
    };
    mockState.settlements.push(settlement);
    return mockDelay({ settlement, updatedDebts: buildMockDebts() });
  }

  const amount = payload.amount || 0;
  const settlement = {
    settlement_id: settlementId,
    from_member_id: payload.fromMemberId,
    from_name: mockState.members.find((m) => m.member_id === payload.fromMemberId)?.name || '',
    to_member_id: payload.toMemberId,
    to_name: mockState.members.find((m) => m.member_id === payload.toMemberId)?.name || '',
    amount,
    settled_at: now,
    method: payload.method,
    source_attendance_ids: '',
    source_ledger_ids: '',
    is_reconciled: false,
    transfer_content: payload.transferContent || '',
    note: payload.note || '',
    confirmed_by: 'editor.mock@gmail.com',
  };
  mockState.settlements.push(settlement);

  // Phân bổ FIFO cho phí vãng lai cầu lông của fromMemberId
  let budget = amount;
  for (const att of mockState.attendances) {
    if (
      att.member_id === payload.fromMemberId &&
      !att.is_paid &&
      att.session_type === 'BADMINTON' &&
      att.member_type_snapshot === 'GUEST' &&
      att.fee_amount > 0 &&
      budget >= att.fee_amount
    ) {
      budget -= att.fee_amount;
      att.is_paid = true;
      att.paid_at = now;
      att.settlement_id = settlementId;
      appendGuestFeeIfNeeded(att);
    }
  }

  const debtsAfter = buildMockDebts();
  if (debtsAfter.simplifiedTransfers.length === 0) {
    for (const att of mockState.attendances) {
      if (!att.is_paid && att.fee_amount > 0) {
        att.is_paid = true;
        att.paid_at = now;
        att.settlement_id = settlementId;
        appendGuestFeeIfNeeded(att);
      }
    }
    for (const led of mockState.fundLedger) {
      if (led.type === 'EXPENSE' && !led.is_paid) {
        led.is_paid = true;
        led.paid_at = now;
        led.settlement_id = settlementId;
      }
    }
    for (const st of mockState.settlements) {
      st.is_reconciled = true;
    }
  }

  return mockDelay({ settlement, updatedDebts: buildMockDebts() });
}

export async function updateSession(
  idToken: string,
  payload: UpdateSessionPayload
): Promise<{ session: (typeof mockState.sessions)[number] }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ session: (typeof mockState.sessions)[number] }>('updateSession', idToken, payload);
  }

  const idx = mockState.sessions.findIndex((s) => s.session_id === payload.sessionId);
  if (idx === -1) throw new ApiClientError('NOT_FOUND', 'Không tìm thấy buổi cần sửa.');

  const now = nowIso();
  const createdIds: string[] = [];
  for (const g of payload.new_guests || []) {
    const name = typeof g === 'string' ? g.trim() : g.name.trim();
    if (!name) continue;
    const existing = mockState.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      createdIds.push(existing.member_id);
      continue;
    }
    const member: Member = {
      member_id: `MEM_MOCK_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      aliases: typeof g === 'object' ? g.aliases || '' : '',
      type: 'GUEST',
      phone: '',
      bank_bin: '',
      bank_name: '',
      account_no: '',
      account_name: '',
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    mockState.members.push(member);
    createdIds.push(member.member_id);
  }

  const attendeeIds = Array.from(new Set([...payload.attendeeIds, ...createdIds]));
  const sessionType = payload.type || payload.category || mockState.sessions[idx].type;
  const guestFee = payload.guestFee ?? mockState.settings.guest_fee;
  const unit = mockState.settings.rounding_unit || 1000;
  const perPerson =
    sessionType === 'DRINKING' && attendeeIds.length > 0
      ? Math.round(payload.totalAmount / attendeeIds.length / unit) * unit
      : 0;

  const updated = {
    ...mockState.sessions[idx],
    date: payload.date,
    type: sessionType,
    title: payload.title,
    total_amount: payload.totalAmount,
    guest_fee: sessionType === 'BADMINTON' ? guestFee : 0,
    payer_id: payload.payerId,
    payer_name: mockState.members.find((m) => m.member_id === payload.payerId)?.name || '',
    per_person_amount: perPerson,
    attendee_count: attendeeIds.length,
    receipt_drive_id: payload.receiptDriveId ?? mockState.sessions[idx].receipt_drive_id,
    receipt_url: payload.receiptUrl ?? mockState.sessions[idx].receipt_url,
    receipt_summary: payload.receiptSummary ?? mockState.sessions[idx].receipt_summary,
    note: payload.note ?? mockState.sessions[idx].note,
    updated_at: now,
  };
  mockState.sessions[idx] = updated;

  // Giữ Attendance đã có settlement_id, thay thế phần chưa đối soát
  const lockedMemberIds = new Set(
    mockState.attendances
      .filter((a) => a.session_id === payload.sessionId && a.settlement_id)
      .map((a) => a.member_id)
  );
  mockState.attendances = mockState.attendances.filter(
    (a) => !(a.session_id === payload.sessionId && !a.settlement_id)
  );

  const paidImmSet = new Set(payload.paidImmediatelyMemberIds || []);
  attendeeIds.forEach((mId, i) => {
    if (lockedMemberIds.has(mId)) return;
    const member = mockState.members.find((m) => m.member_id === mId);
    if (!member) return;
    const isBadminton = sessionType === 'BADMINTON';
    const fee = isBadminton ? (member.type === 'GUEST' ? guestFee : 0) : perPerson;
    const isPaid = isBadminton
      ? member.type === 'MAIN' || paidImmSet.has(mId) || fee === 0
      : mId === payload.payerId || fee === 0;
    mockState.attendances.push({
      attendance_id: `ATT_MOCK_${Date.now()}_${i}`,
      session_id: payload.sessionId,
      session_date: payload.date,
      session_type: sessionType,
      member_id: mId,
      member_name: member.name,
      member_type_snapshot: member.type,
      fee_amount: fee,
      creditor_id: isBadminton ? mockState.settings.treasurer_member_id : payload.payerId,
      is_paid: isPaid,
      paid_at: isPaid ? now : '',
      settlement_id: '',
      note: '',
    });
  });

  mockState.fundLedger = mockState.fundLedger.filter(
    (l) => !(l.session_id === payload.sessionId && l.type === 'EXPENSE' && !l.settlement_id)
  );
  if (sessionType === 'BADMINTON' && payload.totalAmount > 0) {
    mockState.fundLedger.push({
      ledger_id: `LED_MOCK_${Date.now()}`,
      date: payload.date,
      type: 'EXPENSE',
      category: payload.expenseCategory || 'COURT',
      amount: payload.totalAmount,
      member_id: payload.payerId,
      member_name: mockState.members.find((m) => m.member_id === payload.payerId)?.name || '',
      session_id: payload.sessionId,
      attendance_id: '',
      period: payload.date.slice(0, 7),
      is_paid: payload.payerId === mockState.settings.treasurer_member_id,
      paid_at: payload.payerId === mockState.settings.treasurer_member_id ? now : '',
      settlement_id: '',
      receipt_drive_id: updated.receipt_drive_id,
      receipt_url: updated.receipt_url,
      description: payload.expenseDescription || updated.title,
      created_by: 'editor.mock@gmail.com',
      created_at: now,
    });
  }

  return mockDelay({ session: updated });
}

export async function deleteSession(
  idToken: string,
  sessionId: string
): Promise<{ deletedSessionId: string }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ deletedSessionId: string }>('deleteSession', idToken, { sessionId });
  }
  const hasSettled =
    mockState.attendances.some((a) => a.session_id === sessionId && a.settlement_id) ||
    mockState.fundLedger.some((l) => l.session_id === sessionId && l.settlement_id);
  if (hasSettled) {
    throw new ApiClientError('BAD_REQUEST', 'Không thể xóa buổi đã có khoản thanh toán được đối soát.');
  }
  mockState.sessions = mockState.sessions.filter((s) => s.session_id !== sessionId);
  mockState.attendances = mockState.attendances.filter((a) => a.session_id !== sessionId);
  mockState.fundLedger = mockState.fundLedger.filter((l) => l.session_id !== sessionId);
  return mockDelay({ deletedSessionId: sessionId });
}

export async function fetchEditors(idToken: string): Promise<Editor[]> {
  if (!IS_MOCK_MODE) {
    const res = await gasPost<{ editors: Editor[] }>('getEditors', idToken, {});
    return res.editors;
  }
  return mockDelay([...mockState.editors]);
}

export async function manageEditors(
  idToken: string,
  payload: ManageEditorsPayload
): Promise<Editor[]> {
  if (!IS_MOCK_MODE) {
    const res = await gasPost<{ editors: Editor[] }>('manageEditors', idToken, payload);
    return res.editors;
  }
  const email = payload.email.trim().toLowerCase();
  if (payload.operation === 'DELETE') {
    mockState.editors = mockState.editors.filter((e) => e.email.toLowerCase() !== email);
    return mockDelay([...mockState.editors]);
  }
  const idx = mockState.editors.findIndex((e) => e.email.toLowerCase() === email);
  if (idx >= 0) {
    mockState.editors[idx] = {
      ...mockState.editors[idx],
      name: payload.name ?? mockState.editors[idx].name,
      role: payload.role ?? mockState.editors[idx].role,
      is_active: payload.isActive ?? mockState.editors[idx].is_active,
    };
  } else {
    mockState.editors.push({
      email,
      name: payload.name || email,
      role: payload.role || 'EDITOR',
      is_active: payload.isActive ?? true,
      added_at: nowIso(),
    });
  }
  return mockDelay([...mockState.editors]);
}

export async function upsertMember(
  idToken: string,
  payload: UpsertMemberPayload
): Promise<{ member: Member }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ member: Member }>('upsertMember', idToken, payload);
  }
  const now = nowIso();
  if (!payload.memberId) {
    const member: Member = {
      member_id: `MEM_MOCK_${Date.now()}`,
      name: payload.name,
      aliases: payload.aliases || '',
      type: payload.type,
      phone: payload.phone || '',
      bank_bin: payload.bankBin || '',
      bank_name: payload.bankName || '',
      account_no: payload.accountNo || '',
      account_name: (payload.accountName || '').toUpperCase(),
      is_active: payload.isActive ?? true,
      created_at: now,
      updated_at: now,
    };
    mockState.members.push(member);
    return mockDelay({ member });
  }
  const idx = mockState.members.findIndex((m) => m.member_id === payload.memberId);
  if (idx === -1) throw new ApiClientError('NOT_FOUND', 'Không tìm thấy thành viên');
  const updated: Member = {
    ...mockState.members[idx],
    name: payload.name,
    aliases: payload.aliases ?? mockState.members[idx].aliases,
    type: payload.type,
    phone: payload.phone ?? mockState.members[idx].phone,
    bank_bin: payload.bankBin ?? mockState.members[idx].bank_bin,
    bank_name: payload.bankName ?? mockState.members[idx].bank_name,
    account_no: payload.accountNo ?? mockState.members[idx].account_no,
    account_name: (payload.accountName ?? mockState.members[idx].account_name).toUpperCase(),
    is_active: payload.isActive ?? mockState.members[idx].is_active,
    updated_at: now,
  };
  mockState.members[idx] = updated;
  return mockDelay({ member: updated });
}

export async function addFundEntry(
  idToken: string,
  payload: AddFundEntryPayload
): Promise<{ entry: FundLedgerEntry }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ entry: FundLedgerEntry }>('addFundEntry', idToken, payload);
  }
  const now = nowIso();
  const isPaid = payload.type === 'INCOME' || payload.memberId === mockState.settings.treasurer_member_id;
  const entry: FundLedgerEntry = {
    ledger_id: `LED_MOCK_${Date.now()}`,
    date: payload.date,
    type: payload.type,
    category: payload.category,
    amount: payload.amount,
    member_id: payload.memberId,
    member_name: mockState.members.find((m) => m.member_id === payload.memberId)?.name || '',
    session_id: '',
    attendance_id: '',
    period: payload.period || payload.date.slice(0, 7),
    is_paid: isPaid,
    paid_at: isPaid ? now : '',
    settlement_id: '',
    receipt_drive_id: payload.receiptDriveId || '',
    receipt_url: payload.receiptUrl || '',
    description: payload.description,
    created_by: 'editor.mock@gmail.com',
    created_at: now,
  };
  mockState.fundLedger.push(entry);
  return mockDelay({ entry });
}

export async function updateSettings(
  idToken: string,
  payload: UpdateSettingsPayload
): Promise<{ settings: SettingsMap }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ settings: SettingsMap }>('updateSettings', idToken, payload);
  }
  const next = payload.settings;
  if (next.club_name !== undefined) mockState.settings.club_name = String(next.club_name);
  if (next.treasurer_member_id !== undefined) mockState.settings.treasurer_member_id = String(next.treasurer_member_id);
  if (next.monthly_fee !== undefined) {
    mockState.settings.monthly_fee = Number(next.monthly_fee) || 0;
    mockState.settings.default_monthly_fund = mockState.settings.monthly_fee;
  }
  if (next.guest_fee !== undefined) {
    mockState.settings.guest_fee = Number(next.guest_fee) || 0;
    mockState.settings.default_guest_fee = mockState.settings.guest_fee;
  }
  if (next.drive_folder_id !== undefined) mockState.settings.drive_folder_id = String(next.drive_folder_id);
  if (next.rounding_unit !== undefined) mockState.settings.rounding_unit = Number(next.rounding_unit) || 1000;
  if (next.transfer_prefix !== undefined) mockState.settings.transfer_prefix = String(next.transfer_prefix);
  return mockDelay({ settings: { ...mockState.settings } });
}
