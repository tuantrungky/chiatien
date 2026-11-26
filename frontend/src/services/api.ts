/**
 * api.ts
 * API client giao tiếp với Google Apps Script Web App (VITE_GAS_API_URL).
 * - GET getAll gộp dữ liệu trong 1 request giảm cold-start latency
 * - POST dùng Content-Type: text/plain;charset=utf-8 để tránh CORS preflight trên GAS
 * - Hỗ trợ Mock Data (VITE_USE_MOCK=true hoặc chưa cấu hình VITE_GAS_API_URL)
 */

import type {
  AllDataResponse,
  ApiResponse,
  Attendance,
  BootstrapData,
  CloseMonthPayload,
  ConfirmPaymentPayload,
  ConfirmPaymentResponse,
  CreateSessionPayload,
  CreateSessionResponse,
  DashboardData,
  Editor,
  GenerateSchedulePayload,
  GuestStatItem,
  GuestStatsData,
  IssueMonthlyBillPayload,
  ManageEditorsPayload,
  MarkDuePaidPayload,
  Member,
  MonthlyBill,
  MonthlyBillData,
  ParseBillAIResponse,
  PeriodType,
  ScheduleData,
  SeparatedDebtsData,
  SessionDetailData,
  SettingsMap,
  UpdateScheduleDayPayload,
  UpdateSessionPayload,
  UpdateSettingsPayload,
  UpsertMemberPayload,
  VerifyEditorResponse,
} from '../types';
import { getPeriodRange, getTodayDateStr } from '../utils/dateFilters';
import { buildBadmintonDues, simplifyDebts } from '../utils/debtSimplifier';
import { calculateDrinkingSplit } from '../utils/drinkingSplit';
import { calculateMonthlyBill } from '../utils/monthlyBill';
import { estimateCourtCostFromSchedule, generateMonthScheduleDates } from '../utils/schedule';
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

const mockState = {
  settings: { ...initialMockSettings },
  members: structuredClone(initialMockMembers),
  schedule: structuredClone(initialMockSchedule),
  sessions: structuredClone(initialMockSessions),
  sessionItems: structuredClone(initialMockSessionItems),
  attendances: structuredClone(initialMockAttendances),
  monthlyBills: structuredClone(initialMockMonthlyBills),
  monthlyDues: structuredClone(initialMockMonthlyDues),
  settlements: structuredClone(initialMockSettlements),
  editors: structuredClone(initialMockEditors),
};

function nowIso(): string {
  return new Date().toISOString();
}

function mockDelay<T>(value: T, ms = 140): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function gasGet<T>(
  action: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
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
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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

function prevMonthStr(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  const mm = d.getMonth() + 1;
  return `${d.getFullYear()}-${mm < 10 ? '0' + mm : mm}`;
}

function buildMockSchedule(month: string): ScheduleData {
  const days = mockState.schedule
    .filter((d) => d.date.slice(0, 7) === month)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { month, days };
}

function buildMockMonthlyBill(month: string): MonthlyBillData {
  const billRow = mockState.monthlyBills.find((b) => b.month === month);
  const prevRow = mockState.monthlyBills.find((b) => b.month === prevMonthStr(month));
  const sessionsInMonth = mockState.sessions.filter(
    (s) => s.type === 'BADMINTON' && s.date.slice(0, 7) === month
  );
  const sessionsCost = sessionsInMonth.reduce((sum, s) => sum + s.total_amount, 0);

  let paidCount = 0;
  let paidAmount = 0;
  let unpaidAmount = 0;
  for (const a of mockState.attendances) {
    if (a.session_type !== 'BADMINTON' || a.member_type_snapshot !== 'GUEST' || a.fee_amount <= 0) continue;
    const refMonth = a.is_paid && a.paid_at ? a.paid_at.slice(0, 7) : a.session_date.slice(0, 7);
    if (refMonth === month) {
      if (a.is_paid) {
        paidCount++;
        paidAmount += a.fee_amount;
      } else {
        unpaidAmount += a.fee_amount;
      }
    }
  }

  const schedule = buildMockSchedule(month);
  const suggestedEstimate = estimateCourtCostFromSchedule(
    schedule.days,
    mockState.settings.court_price_per_hour
  );

  const carryIn = billRow ? billRow.carry_in : prevRow ? prevRow.carry_out : 0;
  const estimate = billRow ? billRow.estimate : suggestedEstimate;
  const actualCost =
    billRow && billRow.actual_cost_override !== null
      ? billRow.actual_cost_override
      : sessionsCost;
  const billedTotal = billRow ? billRow.billed_total : 0;
  const calc = calculateMonthlyBill({
    estimate,
    carryIn,
    memberCount: billRow?.member_count || 0,
    roundingUnit: mockState.settings.rounding_unit,
    actualCost,
    guestIncome: paidAmount,
  });

  const bill = {
    month,
    estimate,
    carry_in: carryIn,
    to_collect: billRow ? billRow.to_collect : calc.toCollect,
    member_count: billRow ? billRow.member_count : 0,
    per_member: billRow ? billRow.per_member : 0,
    billed_total: billedTotal,
    actual_cost: actualCost,
    actual_cost_override: billRow ? billRow.actual_cost_override : null,
    guest_income: paidAmount,
    carry_out: carryIn + billedTotal + paidAmount - actualCost,
    status: billRow ? billRow.status : ('OPEN' as const),
    created_by: billRow ? billRow.created_by : '',
    closed_at: billRow ? billRow.closed_at : '',
  };

  const duesRaw = mockState.monthlyDues.filter((d) => d.month === month);
  const badmintonDues = buildBadmintonDues({
    monthlyDues: duesRaw.map((d) => ({ ...d, is_paid: false })),
    attendances: [],
    sessions: mockState.sessions,
    members: mockState.members,
    treasurerMemberId: mockState.settings.treasurer_member_id,
    transferPrefix: mockState.settings.transfer_prefix,
    vietqrTemplate: mockState.settings.vietqr_template,
  });

  const qrByDueId = new Map(badmintonDues.monthlyDues.map((x) => [x.due_id, x]));
  const dues = duesRaw.map((d) => {
    const qr = qrByDueId.get(d.due_id);
    return {
      due_id: d.due_id,
      month: d.month,
      member_id: d.member_id,
      member_name: mockState.members.find((m) => m.member_id === d.member_id)?.name || d.member_id,
      amount: d.amount,
      is_paid: d.is_paid,
      paid_at: d.paid_at,
      transferContent: qr?.transferContent || '',
      vietQrUrl: qr?.vietQrUrl || null,
    };
  });

  return {
    month,
    bill,
    dues,
    sessions: sessionsInMonth,
    guestIncomeDetail: { paidCount, paidAmount, unpaidAmount },
    suggestedEstimateFromSchedule: suggestedEstimate,
  };
}

function buildMockDebts(): SeparatedDebtsData {
  const badminton = buildBadmintonDues({
    monthlyDues: mockState.monthlyDues,
    attendances: mockState.attendances,
    sessions: mockState.sessions,
    members: mockState.members,
    treasurerMemberId: mockState.settings.treasurer_member_id,
    transferPrefix: mockState.settings.transfer_prefix,
    vietqrTemplate: mockState.settings.vietqr_template,
  });

  const drinkingUnpaid = mockState.attendances.filter(
    (a) => a.session_type === 'DRINKING' && !a.is_paid
  );
  const unreconciledDrinking = mockState.settlements.filter(
    (s) => !s.is_reconciled && (!s.category || s.category === 'DRINKING')
  );

  const simplified = simplifyDebts({
    attendances: drinkingUnpaid,
    sessions: mockState.sessions,
    members: mockState.members,
    unreconciledSettlements: unreconciledDrinking,
    transferPrefix: mockState.settings.transfer_prefix,
    vietqrTemplate: mockState.settings.vietqr_template,
  });

  return {
    treasurerMemberId: mockState.settings.treasurer_member_id,
    badminton,
    drinking: {
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
      unpaidAttendances: drinkingUnpaid,
      recentSettlements: mockState.settlements
        .filter((s) => !s.category || s.category === 'DRINKING')
        .sort((a, b) => b.settled_at.localeCompare(a.settled_at)),
      totalOutstanding: simplified.totalOutstanding,
    },
  };
}

function buildMockGuestStats(month: string): GuestStatsData {
  const byGuest = new Map<string, GuestStatItem>();
  let totalVisits = 0;
  let totalFee = 0;
  let totalPaid = 0;
  let totalUnpaid = 0;

  for (const att of mockState.attendances) {
    if (
      att.member_type_snapshot !== 'GUEST' ||
      att.session_type !== 'BADMINTON' ||
      att.session_date.slice(0, 7) !== month
    ) {
      continue;
    }
    let item = byGuest.get(att.member_id);
    if (!item) {
      const mName =
        mockState.members.find((m) => m.member_id === att.member_id)?.name ||
        att.member_name ||
        att.member_id;
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
  return {
    month,
    summary: {
      totalGuests: guests.length,
      totalVisits,
      totalFee,
      totalPaid,
      totalUnpaid,
    },
    guests,
  };
}

function buildMockDashboard(periodType: PeriodType, refDate: string): DashboardData {
  const period = getPeriodRange(periodType, refDate);
  const currentMonth = refDate.slice(0, 7);
  const monthlyBill = buildMockMonthlyBill(currentMonth);
  const debts = buildMockDebts();

  let badCost = 0;
  let badCount = 0;
  let drinkCost = 0;
  let drinkCount = 0;

  for (const s of mockState.sessions) {
    if (period.startDate && s.date < period.startDate) continue;
    if (period.endDate && s.date > period.endDate) continue;
    if (s.type === 'BADMINTON') {
      badCost += s.total_amount;
      badCount++;
    } else {
      drinkCost += s.total_amount;
      drinkCount++;
    }
  }

  return {
    period,
    currentMonth,
    badminton: {
      periodCost: badCost,
      sessionCount: badCount,
      guestIncomeInMonth: monthlyBill.bill.guest_income,
      carryIn: monthlyBill.bill.carry_in,
      projectedCarryOut: monthlyBill.bill.carry_out,
      unpaidTotal: debts.badminton.totalOutstanding,
    },
    drinking: {
      periodCost: drinkCost,
      sessionCount: drinkCount,
      unpaidTotal: debts.drinking.totalOutstanding,
    },
    recentSessions: [...mockState.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  };
}

// ============================================================================
// PUBLIC READ APIs (Viewer)
// ============================================================================

export async function fetchAllData(
  periodType: PeriodType = 'MONTH',
  refDate?: string,
  month?: string
): Promise<AllDataResponse> {
  const rDate = refDate || getTodayDateStr();
  const targetMonth = month || rDate.slice(0, 7);

  if (!IS_MOCK_MODE) {
    return gasGet<AllDataResponse>('getAll', {
      periodType,
      refDate: rDate,
      month: targetMonth,
    });
  }

  return mockDelay({
    bootstrap: {
      settings: { ...mockState.settings },
      members: [...mockState.members],
    },
    dashboard: buildMockDashboard(periodType, rDate),
    sessions: [...mockState.sessions].sort((a, b) => b.date.localeCompare(a.date)),
    debts: buildMockDebts(),
    schedule: buildMockSchedule(targetMonth),
    monthlyBill: buildMockMonthlyBill(targetMonth),
    guestStats: buildMockGuestStats(targetMonth),
  });
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  if (!IS_MOCK_MODE) {
    return gasGet<BootstrapData>('bootstrap');
  }
  return mockDelay({
    settings: { ...mockState.settings },
    members: [...mockState.members],
  });
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
  if (!IS_MOCK_MODE) {
    return gasGet<SessionDetailData>('getSessionDetail', { sessionId });
  }
  const session = mockState.sessions.find((s) => s.session_id === sessionId);
  if (!session) throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`);
  return mockDelay({
    session,
    attendances: mockState.attendances.filter((a) => a.session_id === sessionId),
    items: mockState.sessionItems.filter((it) => it.session_id === sessionId),
  });
}

export async function fetchSchedule(month: string): Promise<ScheduleData> {
  if (!IS_MOCK_MODE) {
    return gasGet<ScheduleData>('getSchedule', { month });
  }
  return mockDelay(buildMockSchedule(month));
}

export async function fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
  if (!IS_MOCK_MODE) {
    return gasGet<MonthlyBillData>('getMonthlyBill', { month });
  }
  return mockDelay(buildMockMonthlyBill(month));
}

export async function fetchGuestStats(month: string): Promise<GuestStatsData> {
  if (!IS_MOCK_MODE) {
    return gasGet<GuestStatsData>('getGuestStats', { month });
  }
  return mockDelay(buildMockGuestStats(month));
}

export async function fetchDebts(): Promise<SeparatedDebtsData> {
  if (!IS_MOCK_MODE) {
    return gasGet<SeparatedDebtsData>('getDebts');
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
    email: 'tuantrungky@gmail.com',
    name: 'Tuấn (Mock)',
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
  const sessionType = payload.type;
  const guestFee = payload.guestFee ?? mockState.settings.guest_fee;
  const treasurerId = mockState.settings.treasurer_member_id;
  const payerId = payload.payerId || treasurerId;
  const sessionId = `SES_MOCK_${Date.now()}`;

  let totalAmount = payload.totalAmount;
  let perPerson = 0;
  let newAttendances: Attendance[] = [];
  const savedItems: (typeof mockState.sessionItems)[number][] = [];

  if (sessionType === 'BADMINTON') {
    const paidImmSet = new Set(payload.paidImmediatelyMemberIds || []);
    newAttendances = attendeeIds.map((mId, idx) => {
      const member = mockState.members.find((m) => m.member_id === mId)!;
      const fee = member.type === 'GUEST' ? guestFee : 0;
      const isPaid = member.type === 'MAIN' || paidImmSet.has(mId) || fee === 0;
      return {
        attendance_id: `ATT_MOCK_${Date.now()}_${idx}`,
        session_id: sessionId,
        session_date: payload.date,
        session_type: 'BADMINTON',
        member_id: mId,
        member_name: member.name,
        member_type_snapshot: member.type,
        fee_amount: fee,
        creditor_id: treasurerId,
        contributed_amount: 0,
        net_amount: isPaid ? 0 : fee,
        is_paid: isPaid,
        paid_at: isPaid ? now : '',
        settlement_id: '',
        note: '',
      };
    });
  } else {
    const rawItems =
      payload.items && payload.items.length > 0
        ? payload.items
        : [{ member_id: payerId, kind: 'BILL' as const, item_name: 'Hóa đơn quán', amount: totalAmount }];

    const split = calculateDrinkingSplit(attendeeIds, rawItems, mockState.settings.rounding_unit);
    totalAmount = split.totalAmount;
    perPerson = split.perPersonAmount;

    rawItems.forEach((it, idx) => {
      if (it.amount <= 0) return;
      savedItems.push({
        item_id: `ITM_MOCK_${Date.now()}_${idx}`,
        session_id: sessionId,
        member_id: it.member_id,
        member_name: mockState.members.find((m) => m.member_id === it.member_id)?.name || '',
        kind: it.kind,
        item_name: it.item_name,
        amount: it.amount,
      });
    });
    mockState.sessionItems.push(...savedItems);

    newAttendances = split.splits.map((sp, idx) => {
      const member = mockState.members.find((m) => m.member_id === sp.memberId)!;
      return {
        attendance_id: `ATT_MOCK_${Date.now()}_${idx}`,
        session_id: sessionId,
        session_date: payload.date,
        session_type: 'DRINKING',
        member_id: sp.memberId,
        member_name: member.name,
        member_type_snapshot: member.type,
        fee_amount: sp.perPersonAmount,
        creditor_id: payerId,
        contributed_amount: sp.contributedAmount,
        net_amount: sp.netAmount,
        is_paid: sp.isPaid,
        paid_at: sp.isPaid ? now : '',
        settlement_id: '',
        note: '',
      };
    });
  }

  const session = {
    session_id: sessionId,
    date: payload.date,
    type: sessionType,
    title: payload.title,
    total_amount: totalAmount,
    guest_fee: sessionType === 'BADMINTON' ? guestFee : 0,
    payer_id: sessionType === 'BADMINTON' ? treasurerId : payerId,
    payer_name: mockState.members.find((m) => m.member_id === (sessionType === 'BADMINTON' ? treasurerId : payerId))?.name || '',
    per_person_amount: perPerson,
    attendee_count: newAttendances.length,
    receipt_drive_id: payload.receiptDriveId || '',
    receipt_url: payload.receiptUrl || '',
    receipt_summary: payload.receiptSummary || '',
    note: payload.note || '',
    court_amount: sessionType === 'BADMINTON' ? payload.courtAmount || 0 : 0,
    shuttle_qty: sessionType === 'BADMINTON' ? payload.shuttleQty || 0 : 0,
    shuttle_amount: sessionType === 'BADMINTON' ? payload.shuttleAmount || 0 : 0,
    other_amount: sessionType === 'BADMINTON' ? payload.otherAmount || 0 : 0,
    cost_detail: payload.costDetail ? JSON.stringify(payload.costDetail) : '',
    venue_type: sessionType === 'DRINKING' ? payload.venueType || 'RESTAURANT' : ('' as const),
    plan_id: payload.planId || '',
    created_by: 'tuantrungky@gmail.com',
    created_at: now,
    updated_at: now,
  };

  mockState.sessions.push(session);
  mockState.attendances.push(...newAttendances);

  if (payload.planId) {
    const plan = mockState.schedule.find((d) => d.plan_id === payload.planId);
    if (plan) {
      plan.status = 'DONE';
      plan.session_id = sessionId;
      plan.planned_member_ids = attendeeIds.join(',');
    }
  }

  return mockDelay({ session, createdMembers, attendances: newAttendances, items: savedItems });
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

  const hasSettled = mockState.attendances.some((a) => a.session_id === payload.sessionId && a.settlement_id);
  if (hasSettled) {
    throw new ApiClientError('BAD_REQUEST', 'Buổi đã có khoản thanh toán đối soát, không thể sửa.');
  }

  // Tái tạo buổi trên ID cũ trong Mock
  const oldPlanId = mockState.sessions[idx].plan_id;
  mockState.sessions.splice(idx, 1);
  mockState.attendances = mockState.attendances.filter((a) => a.session_id !== payload.sessionId);
  mockState.sessionItems = mockState.sessionItems.filter((it) => it.session_id !== payload.sessionId);

  const created = await createSession(idToken, { ...payload, planId: payload.planId ?? oldPlanId });
  created.session.session_id = payload.sessionId;
  mockState.attendances
    .filter((a) => a.session_id === mockState.sessions[mockState.sessions.length - 1].session_id)
    .forEach((a) => {
      a.session_id = payload.sessionId;
    });
  mockState.sessionItems
    .filter((it) => it.session_id === mockState.sessions[mockState.sessions.length - 1].session_id)
    .forEach((it) => {
      it.session_id = payload.sessionId;
    });

  return mockDelay({ session: created.session });
}

export async function deleteSession(
  idToken: string,
  sessionId: string
): Promise<{ deletedSessionId: string }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ deletedSessionId: string }>('deleteSession', idToken, { sessionId });
  }
  const hasSettled = mockState.attendances.some((a) => a.session_id === sessionId && a.settlement_id);
  if (hasSettled) {
    throw new ApiClientError('BAD_REQUEST', 'Không thể xóa buổi đã có khoản thanh toán được đối soát.');
  }
  const target = mockState.sessions.find((s) => s.session_id === sessionId);
  if (target?.plan_id) {
    const plan = mockState.schedule.find((d) => d.plan_id === target.plan_id);
    if (plan) {
      plan.status = 'PLANNED';
      plan.session_id = '';
    }
  }
  mockState.sessions = mockState.sessions.filter((s) => s.session_id !== sessionId);
  mockState.attendances = mockState.attendances.filter((a) => a.session_id !== sessionId);
  mockState.sessionItems = mockState.sessionItems.filter((it) => it.session_id !== sessionId);
  return mockDelay({ deletedSessionId: sessionId });
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

  if (payload.category === 'BADMINTON') {
    const setIds = new Set(payload.attendanceIds || []);
    let sum = 0;
    for (const a of mockState.attendances) {
      if (a.session_type === 'BADMINTON' && setIds.has(a.attendance_id) && !a.is_paid) {
        a.is_paid = true;
        a.paid_at = now;
        a.settlement_id = settlementId;
        sum += a.fee_amount;
      }
    }
    const settlement = {
      settlement_id: settlementId,
      from_member_id: payload.fromMemberId,
      to_member_id: payload.toMemberId,
      amount: sum || payload.amount || 0,
      settled_at: now,
      method: payload.method,
      category: 'BADMINTON' as const,
      source_attendance_ids: (payload.attendanceIds || []).join(','),
      source_ledger_ids: '',
      is_reconciled: true,
      transfer_content: payload.transferContent || '',
      note: payload.note || '',
      confirmed_by: 'tuantrungky@gmail.com',
    };
    mockState.settlements.push(settlement);
    return mockDelay({ settlement, updatedDebts: buildMockDebts() });
  }

  // DRINKING
  const settlement = {
    settlement_id: settlementId,
    from_member_id: payload.fromMemberId,
    from_name: mockState.members.find((m) => m.member_id === payload.fromMemberId)?.name || '',
    to_member_id: payload.toMemberId,
    to_name: mockState.members.find((m) => m.member_id === payload.toMemberId)?.name || '',
    amount: payload.amount || 0,
    settled_at: now,
    method: payload.method,
    category: 'DRINKING' as const,
    source_attendance_ids: (payload.attendanceIds || []).join(','),
    source_ledger_ids: '',
    is_reconciled: payload.mode === 'ITEMS',
    transfer_content: payload.transferContent || '',
    note: payload.note || '',
    confirmed_by: 'tuantrungky@gmail.com',
  };

  if (payload.mode === 'ITEMS') {
    const setIds = new Set(payload.attendanceIds || []);
    for (const a of mockState.attendances) {
      if (a.session_type === 'DRINKING' && setIds.has(a.attendance_id) && !a.is_paid) {
        const amt = Math.abs(a.net_amount || a.fee_amount);
        a.net_amount = 0;
        a.is_paid = true;
        a.paid_at = now;
        a.settlement_id = settlementId;
        const receiver = mockState.attendances.find(
          (r) =>
            r.session_id === a.session_id &&
            r.member_id === payload.toMemberId &&
            r.net_amount < 0 &&
            !r.is_paid
        );
        if (receiver) {
          receiver.net_amount += amt;
          if (receiver.net_amount >= 0) {
            receiver.net_amount = 0;
            receiver.is_paid = true;
            receiver.paid_at = now;
            receiver.settlement_id = settlementId;
          }
        }
      }
    }
  }

  mockState.settlements.push(settlement);
  const debtsAfter = buildMockDebts();
  if (debtsAfter.drinking.simplifiedTransfers.length === 0) {
    for (const a of mockState.attendances) {
      if (a.session_type === 'DRINKING' && !a.is_paid) {
        a.is_paid = true;
        a.paid_at = now;
        a.settlement_id = settlementId;
      }
    }
    for (const st of mockState.settlements) {
      if (!st.category || st.category === 'DRINKING') st.is_reconciled = true;
    }
  }

  return mockDelay({ settlement, updatedDebts: buildMockDebts() });
}

export async function generateSchedule(
  idToken: string,
  payload: GenerateSchedulePayload
): Promise<ScheduleData> {
  if (!IS_MOCK_MODE) {
    return gasPost<ScheduleData>('generateSchedule', idToken, payload);
  }
  const dates = generateMonthScheduleDates(payload.month, payload.weekdays);
  const existingDates = new Set(mockState.schedule.map((d) => d.date));
  for (const d of dates) {
    if (existingDates.has(d)) continue;
    mockState.schedule.push({
      plan_id: `PLN_MOCK_${d}`,
      date: d,
      start_time: payload.startTime,
      end_time: payload.endTime,
      courts: payload.courts,
      planned_member_ids: payload.plannedMemberIds.join(','),
      status: 'PLANNED',
      session_id: '',
      note: payload.note || '',
    });
  }
  return mockDelay(buildMockSchedule(payload.month));
}

export async function updateScheduleDay(
  idToken: string,
  payload: UpdateScheduleDayPayload
): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ schedule?: ScheduleData; deletedPlanId?: string }>('updateScheduleDay', idToken, payload);
  }
  if (payload.operation === 'DELETE' && payload.planId) {
    mockState.schedule = mockState.schedule.filter((d) => d.plan_id !== payload.planId);
    return mockDelay({ deletedPlanId: payload.planId });
  }
  if (payload.planId) {
    const row = mockState.schedule.find((d) => d.plan_id === payload.planId);
    if (row) {
      row.date = payload.date;
      if (payload.startTime) row.start_time = payload.startTime;
      if (payload.endTime) row.end_time = payload.endTime;
      if (payload.courts !== undefined) row.courts = payload.courts;
      if (payload.plannedMemberIds !== undefined) row.planned_member_ids = payload.plannedMemberIds.join(',');
      if (payload.status) row.status = payload.status;
      if (payload.note !== undefined) row.note = payload.note;
    }
  } else {
    mockState.schedule.push({
      plan_id: `PLN_MOCK_${Date.now()}`,
      date: payload.date,
      start_time: payload.startTime || '20:00',
      end_time: payload.endTime || '21:30',
      courts: payload.courts || 2,
      planned_member_ids: (payload.plannedMemberIds || []).join(','),
      status: payload.status || 'PLANNED',
      session_id: '',
      note: payload.note || '',
    });
  }
  return mockDelay({ schedule: buildMockSchedule(payload.date.slice(0, 7)) });
}

export async function issueMonthlyBill(
  idToken: string,
  payload: IssueMonthlyBillPayload
): Promise<MonthlyBillData> {
  if (!IS_MOCK_MODE) {
    return gasPost<MonthlyBillData>('issueMonthlyBill', idToken, payload);
  }
  const current = buildMockMonthlyBill(payload.month);
  const calc = calculateMonthlyBill({
    estimate: payload.estimate,
    carryIn: current.bill.carry_in,
    memberCount: payload.memberIds.length,
    roundingUnit: mockState.settings.rounding_unit,
    actualCost: current.bill.actual_cost,
    guestIncome: current.bill.guest_income,
  });

  const oldPaidMap = new Map(
    mockState.monthlyDues
      .filter((d) => d.month === payload.month && d.is_paid)
      .map((d) => [d.member_id, d])
  );
  mockState.monthlyDues = mockState.monthlyDues.filter((d) => d.month !== payload.month);

  payload.memberIds.forEach((mId, i) => {
    const oldPaid = oldPaidMap.get(mId);
    mockState.monthlyDues.push({
      due_id: `DUE_${payload.month}_${i}_${Date.now()}`,
      month: payload.month,
      member_id: mId,
      member_name: mockState.members.find((m) => m.member_id === mId)?.name || mId,
      amount: calc.perMember,
      is_paid: oldPaid ? true : calc.perMember === 0,
      paid_at: oldPaid ? oldPaid.paid_at : calc.perMember === 0 ? nowIso() : '',
      confirmed_by: oldPaid ? oldPaid.confirmed_by : '',
    });
  });

  const existingBillIdx = mockState.monthlyBills.findIndex((b) => b.month === payload.month);
  const nextBill: MonthlyBill = {
    month: payload.month,
    estimate: calc.estimate,
    carry_in: calc.carryIn,
    to_collect: calc.toCollect,
    member_count: calc.memberCount,
    per_member: calc.perMember,
    billed_total: calc.billedTotal,
    actual_cost: calc.actualCost,
    actual_cost_override: existingBillIdx >= 0 ? mockState.monthlyBills[existingBillIdx].actual_cost_override : null,
    guest_income: calc.guestIncome,
    carry_out: calc.carryOut,
    status: 'OPEN',
    created_by: 'tuantrungky@gmail.com',
    closed_at: '',
  };
  if (existingBillIdx >= 0) mockState.monthlyBills[existingBillIdx] = nextBill;
  else mockState.monthlyBills.push(nextBill);

  return mockDelay(buildMockMonthlyBill(payload.month));
}

export async function markDuePaid(
  idToken: string,
  payload: MarkDuePaidPayload
): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
  if (!IS_MOCK_MODE) {
    return gasPost<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }>('markDuePaid', idToken, payload);
  }
  const due = mockState.monthlyDues.find((d) => d.due_id === payload.dueId);
  if (!due) throw new ApiClientError('NOT_FOUND', 'Không tìm thấy khoản thu');
  const nextPaid = payload.isPaid ?? true;
  due.is_paid = nextPaid;
  due.paid_at = nextPaid ? nowIso() : '';
  due.confirmed_by = nextPaid ? 'tuantrungky@gmail.com' : '';
  return mockDelay({
    monthlyBill: buildMockMonthlyBill(due.month),
    debts: buildMockDebts(),
  });
}

export async function closeMonth(
  idToken: string,
  payload: CloseMonthPayload
): Promise<MonthlyBillData> {
  if (!IS_MOCK_MODE) {
    return gasPost<MonthlyBillData>('closeMonth', idToken, payload);
  }
  const current = buildMockMonthlyBill(payload.month);
  const actualCost =
    payload.actualCostOverride !== undefined && payload.actualCostOverride !== null
      ? payload.actualCostOverride
      : current.bill.actual_cost;
  const carryOut = current.bill.carry_in + current.bill.billed_total + current.bill.guest_income - actualCost;

  const idx = mockState.monthlyBills.findIndex((b) => b.month === payload.month);
  const closedBill: MonthlyBill = {
    ...current.bill,
    actual_cost: actualCost,
    actual_cost_override: payload.actualCostOverride ?? null,
    carry_out: carryOut,
    status: 'CLOSED',
    closed_at: nowIso(),
  };
  if (idx >= 0) mockState.monthlyBills[idx] = closedBill;
  else mockState.monthlyBills.push(closedBill);

  return mockDelay(buildMockMonthlyBill(payload.month));
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
  if (next.guest_fee !== undefined) mockState.settings.guest_fee = Number(next.guest_fee) || 0;
  if (next.court_price_per_hour !== undefined) mockState.settings.court_price_per_hour = Number(next.court_price_per_hour) || 0;
  if (next.shuttle_price !== undefined) mockState.settings.shuttle_price = Number(next.shuttle_price) || 0;
  if (next.default_court_count !== undefined) mockState.settings.default_court_count = Number(next.default_court_count) || 2;
  if (next.default_play_hours !== undefined) mockState.settings.default_play_hours = Number(next.default_play_hours) || 1.5;
  if (next.drive_folder_id !== undefined) mockState.settings.drive_folder_id = String(next.drive_folder_id);
  if (next.rounding_unit !== undefined) mockState.settings.rounding_unit = Number(next.rounding_unit) || 1000;
  if (next.transfer_prefix !== undefined) mockState.settings.transfer_prefix = String(next.transfer_prefix);
  return mockDelay({ settings: { ...mockState.settings } });
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
