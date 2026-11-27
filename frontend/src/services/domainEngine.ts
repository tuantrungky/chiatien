/**
 * domainEngine.ts
 * Nghiệp vụ tính toán & mutation planner thuần (pure TypeScript),
 * đối chiếu 100% với gas-backend/SheetService.gs để dùng chung cho FirebaseProvider & MockProvider.
 */

import type {
  AllDataResponse,
  Attendance,
  CloseMonthPayload,
  ConfirmPaymentPayload,
  ConfirmPaymentResponse,
  CreateSessionPayload,
  CreateSessionResponse,
  DashboardData,
  Editor,
  EditorRole,
  GenerateSchedulePayload,
  GuestStatItem,
  GuestStatsData,
  IssueMonthlyBillPayload,
  ManageEditorsPayload,
  MarkDuePaidPayload,
  Member,
  MemberPrivateRecord,
  MonthlyBill,
  MonthlyBillData,
  MonthlyBillDetail,
  MonthlyDue,
  PeriodType,
  SaveMonthlyContributionsPayload,
  ScheduleData,
  ScheduleDay,
  SeparatedDebtsData,
  Session,
  SessionDetailData,
  SessionItem,
  SessionItemInput,
  SettingRow,
  SettingsMap,
  Settlement,
  ShuttleContributionItem,
  UpdateScheduleDayPayload,
  UpdateSessionPayload,
  UpdateSettingsPayload,
  UpsertMemberPayload,
} from '../types';
import { calculateAdhocPerPerson } from '../utils/badmintonCost';
import { getNowVN, getPeriodRange, getTodayDateStr } from '../utils/dateFilters';
import { buildBadmintonDues, simplifyDebts } from '../utils/debtSimplifier';
import { calculateDrinkingSplit } from '../utils/drinkingSplit';
import { calculateDetailedMonthlyBill, calculateMonthlyBill } from '../utils/monthlyBill';
import {
  estimateCourtCostFromSchedule,
  generateMonthScheduleDates,
} from '../utils/schedule';
import {
  ApiClientError,
  type BatchMutationPlan,
  type ClubDataset,
  type CollectionKey,
  type MutationUpsertItem,
} from './providers/types';

export const DEFAULT_SETTING_DESCRIPTIONS: Record<string, string> = {
  guest_fee: 'Phí vãng lai mặc định mỗi buổi cầu lông (VND)',
  court_price_per_hour: 'Giá thuê 1 sân / 1 giờ mặc định (VND)',
  shuttle_price: 'Giá 1 quả cầu mặc định (VND)',
  default_court_count: 'Số sân mặc định mỗi buổi',
  default_play_hours: 'Số giờ chơi mặc định mỗi buổi',
  drive_folder_id: 'ID thư mục gốc Google Drive lưu ảnh hóa đơn theo tháng YYYY-MM',
  club_name: 'Tên câu lạc bộ hiển thị trên Web App',
  treasurer_member_id: 'member_id của Thủ quỹ (người giữ tiền và nhận chuyển khoản cầu lông mặc định)',
  rounding_unit: 'Bội số làm tròn khi chia tiền (VND)',
  vietqr_template: 'Template ảnh VietQR (compact, compact2, qr_only, print)',
  transfer_prefix: 'Tiền tố nội dung chuyển khoản VietQR',
};

export function nowIsoVN(): string {
  const now = new Date();
  const vn = getNowVN(now);
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${vn.date}T${vn.time}:${ss}+07:00`;
}

export function generateEntityId(prefix: string, suffix = ''): string {
  const now = new Date();
  const vn = getNowVN(now);
  const compactDate = vn.date.replace(/-/g, '');
  const compactTime = vn.time.replace(/:/g, '') + String(now.getSeconds()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}_${compactDate}_${compactTime}_${rand}${suffix ? `_${suffix}` : ''}`;
}

export function prevMonthStr(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  const mm = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${mm < 10 ? `0${mm}` : String(mm)}`;
}

export function getCutoffDateSixMonthsAgo(refDateStr: string): string {
  const parts = refDateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 7, 1));
  const mm = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${mm < 10 ? `0${mm}` : String(mm)}-01`;
}

export function parseContributionsSafe(raw?: string): ShuttleContributionItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function normalizeContributionsList(
  rawList: unknown,
  membersMap: Map<string, Member>,
  now = nowIsoVN()
): ShuttleContributionItem[] {
  if (!Array.isArray(rawList)) return [];
  const out: ShuttleContributionItem[] = [];
  rawList.forEach((rawIt, idx) => {
    const it = (rawIt || {}) as Record<string, unknown>;
    const mId = String(it.member_id || it.memberId || '').trim();
    if (!mId) return;
    const qty = Math.max(0, Number(it.tube_qty ?? it.tubeQty ?? 0) || 0);
    const unitPrice = Math.max(0, Math.round(Number(it.unit_price ?? it.unitPrice ?? 0) || 0));
    const rawAmt =
      it.amount !== undefined && it.amount !== '' && it.amount !== null
        ? Math.round(Number(it.amount) || 0)
        : Math.round(qty * unitPrice);
    const amount = Math.max(0, rawAmt);
    if (amount <= 0 && qty <= 0) return;
    const mName = String(
      it.member_name || it.memberName || membersMap.get(mId)?.name || mId
    ).trim();
    out.push({
      id: String(it.id || `${generateEntityId('CNT', String(idx))}`),
      member_id: mId,
      member_name: mName,
      tube_qty: qty,
      unit_price: unitPrice,
      amount,
      note: String(it.note || '').trim(),
      created_at: String(it.created_at || now),
    });
  });
  return out;
}

export function buildSettingsMapFromRows(rows: SettingRow[]): SettingsMap {
  const byKey = new Map<string, string>();
  for (const r of rows) {
    if (r.key) byKey.set(String(r.key).trim(), String(r.value ?? ''));
  }
  const num = (k: string, fallback: number): number => {
    const v = Number(byKey.get(k));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    club_name: byKey.get('club_name') || 'CLB Cầu Lông & Nhậu',
    treasurer_member_id: byKey.get('treasurer_member_id') || '',
    guest_fee: num('guest_fee', 50000),
    court_price_per_hour: num('court_price_per_hour', 0),
    shuttle_price: num('shuttle_price', 0),
    default_court_count: num('default_court_count', 2),
    default_play_hours: num('default_play_hours', 1.5),
    drive_folder_id: byKey.get('drive_folder_id') || '',
    rounding_unit: num('rounding_unit', 1000) || 1000,
    vietqr_template: byKey.get('vietqr_template') || 'compact2',
    transfer_prefix: byKey.get('transfer_prefix') || 'CLN',
    raw: rows,
  };
}

export function settingsMapToRows(
  settings: SettingsMap,
  updatedBy = 'system',
  updatedAt = nowIsoVN()
): SettingRow[] {
  if (Array.isArray(settings.raw) && settings.raw.length > 0) {
    return settings.raw;
  }
  const keys: Array<keyof SettingsMap> = [
    'guest_fee',
    'court_price_per_hour',
    'shuttle_price',
    'default_court_count',
    'default_play_hours',
    'drive_folder_id',
    'club_name',
    'treasurer_member_id',
    'rounding_unit',
    'vietqr_template',
    'transfer_prefix',
  ];
  return keys.map((k) => ({
    key: String(k),
    value: String(settings[k] ?? ''),
    description: DEFAULT_SETTING_DESCRIPTIONS[String(k)] || '',
    updated_at: updatedAt,
    updated_by: updatedBy,
  }));
}

function buildMembersMap(members: Member[]): Map<string, Member> {
  const map = new Map<string, Member>();
  for (const m of members) map.set(m.member_id, m);
  return map;
}

function toPublicMemberRecord(m: Member, hasEmail?: boolean): Member {
  const { phone: _phone, email: _email, ...rest } = m;
  return {
    ...rest,
    has_email: hasEmail ?? Boolean(m.email || m.has_email),
  };
}

function stripTransientMonthlyBillFields(bill: MonthlyBill): MonthlyBill {
  const { logged_sessions_cost: _lsc, is_projected_cost: _ipc, ...clean } = bill;
  return clean;
}

function cloneDataset(dataset: ClubDataset): ClubDataset {
  return {
    settings: { ...dataset.settings, raw: dataset.settings.raw ? [...dataset.settings.raw] : undefined },
    settingsRows: dataset.settingsRows ? structuredClone(dataset.settingsRows) : undefined,
    members: structuredClone(dataset.members),
    members_private: dataset.members_private ? structuredClone(dataset.members_private) : undefined,
    sessions: structuredClone(dataset.sessions),
    attendance: structuredClone(dataset.attendance),
    session_items: structuredClone(dataset.session_items),
    schedule: structuredClone(dataset.schedule),
    monthly_bills: structuredClone(dataset.monthly_bills),
    monthly_dues: structuredClone(dataset.monthly_dues),
    settlements: structuredClone(dataset.settlements),
    editors: structuredClone(dataset.editors),
  };
}

/**
 * Áp dụng BatchMutationPlan lên bản sao ClubDataset trong bộ nhớ (dùng cho MockProvider & tái tính sau mutation).
 */
export function applyMutationPlanToDataset(
  dataset: ClubDataset,
  plan: BatchMutationPlan<unknown>
): ClubDataset {
  const next = cloneDataset(dataset);

  const upsertTable = <T extends Record<string, unknown>>(
    list: T[],
    idField: keyof T,
    items?: MutationUpsertItem[]
  ): T[] => {
    if (!items || items.length === 0) return list;
    const map = new Map<string, T>();
    for (const row of list) map.set(String(row[idField]), row);
    for (const it of items) map.set(it.id, it.data as T);
    return Array.from(map.values());
  };

  const deleteTable = <T extends Record<string, unknown>>(
    list: T[],
    idField: keyof T,
    ids?: string[]
  ): T[] => {
    if (!ids || ids.length === 0) return list;
    const delSet = new Set(ids);
    return list.filter((row) => !delSet.has(String(row[idField])));
  };

  const { upserts, deletes } = plan;

  next.members = deleteTable(next.members as unknown as Record<string, unknown>[], 'member_id', deletes.members) as unknown as Member[];
  next.members = upsertTable(next.members as unknown as Record<string, unknown>[], 'member_id', upserts.members) as unknown as Member[];

  if (next.members_private || upserts.members_private || deletes.members_private) {
    const curPriv = next.members_private || [];
    const afterDelPriv = deleteTable(
      curPriv as unknown as Record<string, unknown>[],
      'member_id',
      deletes.members_private
    );
    next.members_private = upsertTable(
      afterDelPriv,
      'member_id',
      upserts.members_private
    ) as unknown as MemberPrivateRecord[];
  }

  next.sessions = deleteTable(next.sessions as unknown as Record<string, unknown>[], 'session_id', deletes.sessions) as unknown as Session[];
  next.sessions = upsertTable(next.sessions as unknown as Record<string, unknown>[], 'session_id', upserts.sessions) as unknown as Session[];

  next.attendance = deleteTable(next.attendance as unknown as Record<string, unknown>[], 'attendance_id', deletes.attendance) as unknown as Attendance[];
  next.attendance = upsertTable(next.attendance as unknown as Record<string, unknown>[], 'attendance_id', upserts.attendance) as unknown as Attendance[];

  next.session_items = deleteTable(next.session_items as unknown as Record<string, unknown>[], 'item_id', deletes.session_items) as unknown as SessionItem[];
  next.session_items = upsertTable(next.session_items as unknown as Record<string, unknown>[], 'item_id', upserts.session_items) as unknown as SessionItem[];

  next.schedule = deleteTable(next.schedule as unknown as Record<string, unknown>[], 'plan_id', deletes.schedule) as unknown as ScheduleDay[];
  next.schedule = upsertTable(next.schedule as unknown as Record<string, unknown>[], 'plan_id', upserts.schedule) as unknown as ScheduleDay[];

  next.monthly_bills = deleteTable(next.monthly_bills as unknown as Record<string, unknown>[], 'month', deletes.monthly_bills) as unknown as MonthlyBill[];
  next.monthly_bills = upsertTable(next.monthly_bills as unknown as Record<string, unknown>[], 'month', upserts.monthly_bills) as unknown as MonthlyBill[];

  next.monthly_dues = deleteTable(next.monthly_dues as unknown as Record<string, unknown>[], 'due_id', deletes.monthly_dues) as unknown as MonthlyDue[];
  next.monthly_dues = upsertTable(next.monthly_dues as unknown as Record<string, unknown>[], 'due_id', upserts.monthly_dues) as unknown as MonthlyDue[];

  next.settlements = deleteTable(next.settlements as unknown as Record<string, unknown>[], 'settlement_id', deletes.settlements) as unknown as Settlement[];
  next.settlements = upsertTable(next.settlements as unknown as Record<string, unknown>[], 'settlement_id', upserts.settlements) as unknown as Settlement[];

  next.editors = deleteTable(next.editors as unknown as Record<string, unknown>[], 'email', deletes.editors) as unknown as Editor[];
  next.editors = upsertTable(next.editors as unknown as Record<string, unknown>[], 'email', upserts.editors) as unknown as Editor[];

  if (upserts.settings && upserts.settings.length > 0) {
    const clubDoc = upserts.settings.find((x) => x.id === 'club');
    if (clubDoc) {
      next.settings = clubDoc.data as unknown as SettingsMap;
    }
  }

  return next;
}

// ============================================================================
// READ AGGREGATORS
// ============================================================================

export function buildScheduleData(dataset: ClubDataset, monthStr?: string): ScheduleData {
  const targetMonth =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())
      ? monthStr.trim()
      : getTodayDateStr().slice(0, 7);

  const fixedByDate = new Map<string, Session>();
  for (const s of dataset.sessions) {
    if (s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC' && s.date.slice(0, 7) === targetMonth) {
      if (!fixedByDate.has(s.date)) fixedByDate.set(s.date, s);
    }
  }

  const days: ScheduleDay[] = dataset.schedule
    .filter((d) => d.date.slice(0, 7) === targetMonth)
    .map((d) => {
      const matched = fixedByDate.get(d.date);
      if (d.status !== 'CANCELLED' && matched) {
        return {
          ...d,
          status: 'DONE' as const,
          session_id: d.session_id || matched.session_id,
        };
      }
      return { ...d };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { month: targetMonth, days };
}

export function buildMonthlyBillData(
  dataset: ClubDataset,
  monthStr?: string,
  _depth = 0
): MonthlyBillData {
  const targetMonth =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())
      ? monthStr.trim()
      : getTodayDateStr().slice(0, 7);

  const membersMap = buildMembersMap(dataset.members);
  const prevMonth = prevMonthStr(targetMonth);
  const billRow = dataset.monthly_bills.find((b) => b.month === targetMonth);
  const prevRow = dataset.monthly_bills.find((b) => b.month === prevMonth);

  const adhocSessionIds = new Set(
    dataset.sessions
      .filter((s) => s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC')
      .map((s) => s.session_id)
  );
  const sessionsInMonth = dataset.sessions
    .filter((s) => s.type === 'BADMINTON' && s.date.slice(0, 7) === targetMonth && s.billing_mode !== 'AD_HOC')
    .sort((a, b) => b.date.localeCompare(a.date));
  const sessionsCost = sessionsInMonth.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);

  let paidCount = 0;
  let paidAmount = 0;
  let unpaidAmount = 0;
  for (const a of dataset.attendance) {
    if (a.session_type !== 'BADMINTON' || adhocSessionIds.has(a.session_id)) continue;
    if (a.member_type_snapshot !== 'GUEST' || a.fee_amount <= 0) continue;
    const refMonth = a.is_paid && a.paid_at ? a.paid_at.slice(0, 7) : a.session_date.slice(0, 7);
    if (refMonth === targetMonth) {
      if (a.is_paid) {
        paidCount++;
        paidAmount += Number(a.fee_amount) || 0;
      } else {
        unpaidAmount += Number(a.fee_amount) || 0;
      }
    }
  }

  const schedule = buildScheduleData(dataset, targetMonth);
  const suggestedEstimate = estimateCourtCostFromSchedule(
    schedule.days,
    dataset.settings.court_price_per_hour
  );

  let carryIn = 0;
  if (billRow) {
    carryIn = Number(billRow.carry_in) || 0;
  } else if (prevRow) {
    carryIn =
      prevRow.status === 'CLOSED' || _depth > 0
        ? Number(prevRow.carry_out) || 0
        : buildMonthlyBillData(dataset, prevMonth, 1).bill.carry_out;
  }
  const estimate = billRow ? Number(billRow.estimate) || 0 : suggestedEstimate;
  const hasOverride =
    billRow &&
    billRow.actual_cost_override !== null &&
    billRow.actual_cost_override !== undefined &&
    String(billRow.actual_cost_override) !== '';
  const actualCostOverride = hasOverride ? Number(billRow.actual_cost_override) : null;
  const billedTotal = billRow ? Number(billRow.billed_total) || 0 : 0;
  const status = billRow ? billRow.status : ('OPEN' as const);
  const isProjectedCost =
    status === 'OPEN' && actualCostOverride === null && estimate > 0 && sessionsCost < estimate;
  const actualCost =
    actualCostOverride !== null
      ? actualCostOverride
      : isProjectedCost
        ? estimate
        : sessionsCost;

  const calc = calculateMonthlyBill({
    estimate,
    carryIn,
    memberCount: billRow?.member_count || 0,
    roundingUnit: dataset.settings.rounding_unit,
    actualCost,
    guestIncome: paidAmount,
  });

  let parsedBillDetail: MonthlyBillDetail = {};
  if (billRow?.bill_detail) {
    try {
      const parsed = JSON.parse(billRow.bill_detail);
      if (parsed && typeof parsed === 'object') {
        parsedBillDetail = parsed as MonthlyBillDetail;
      }
    } catch {
      parsedBillDetail = {};
    }
  }
  const hasCarryOutOverride =
    parsedBillDetail.carryOutOverride !== undefined &&
    parsedBillDetail.carryOutOverride !== null &&
    Number.isFinite(Number(parsedBillDetail.carryOutOverride));
  const refundCredits = Array.isArray(parsedBillDetail.refundCredits)
    ? parsedBillDetail.refundCredits
    : [];
  const refundCreditsTotal =
    parsedBillDetail.refundCreditsTotal !== undefined
      ? Math.max(0, Math.round(Number(parsedBillDetail.refundCreditsTotal) || 0))
      : refundCredits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const carryOut = hasCarryOutOverride
    ? Math.round(Number(parsedBillDetail.carryOutOverride))
    : carryIn + billedTotal + paidAmount - actualCost - refundCreditsTotal;

  const bill: MonthlyBill = {
    month: targetMonth,
    estimate,
    carry_in: carryIn,
    to_collect: billRow ? Number(billRow.to_collect) || 0 : calc.toCollect,
    member_count: billRow ? Number(billRow.member_count) || 0 : 0,
    per_member: billRow ? Number(billRow.per_member) || 0 : 0,
    billed_total: billedTotal,
    actual_cost: actualCost,
    logged_sessions_cost: sessionsCost,
    is_projected_cost: isProjectedCost,
    actual_cost_override: actualCostOverride,
    guest_income: paidAmount,
    carry_out: carryOut,
    status,
    created_by: billRow?.created_by || '',
    closed_at: billRow?.closed_at || '',
    updated_at: billRow?.updated_at || '',
    court_fee: billRow?.court_fee ?? suggestedEstimate,
    shuttle_tube_qty: billRow?.shuttle_tube_qty ?? 0,
    shuttle_tube_price: billRow?.shuttle_tube_price ?? 0,
    shuttle_tube_amount: billRow?.shuttle_tube_amount ?? 0,
    prev_overtime_fee: billRow?.prev_overtime_fee ?? 0,
    bill_detail: billRow?.bill_detail ?? '',
    shuttle_contributions: billRow?.shuttle_contributions ?? '[]',
    applied_credits_total: billRow?.applied_credits_total ?? 0,
    refund_credits_total: refundCreditsTotal,
    carry_over_credits: billRow?.carry_over_credits ?? '[]',
  };

  const duesRaw = dataset.monthly_dues.filter((d) => d.month === targetMonth);
  const badmintonDues = buildBadmintonDues({
    monthlyDues: duesRaw.map((d) => ({ ...d, is_paid: false })),
    attendances: [],
    sessions: dataset.sessions,
    members: dataset.members,
    treasurerMemberId: dataset.settings.treasurer_member_id,
    transferPrefix: dataset.settings.transfer_prefix,
    vietqrTemplate: dataset.settings.vietqr_template,
  });

  const qrByDueId = new Map(badmintonDues.monthlyDues.map((x) => [x.due_id, x]));
  const issuedAtRef = billRow?.updated_at?.slice(0, 10) || `${targetMonth}-01`;
  const dues = duesRaw.map((d) => {
    const qr = qrByDueId.get(d.due_id);
    return {
      due_id: d.due_id,
      month: d.month,
      member_id: d.member_id,
      member_name: membersMap.get(d.member_id)?.name || d.member_name || d.member_id,
      amount: d.amount,
      base_amount: d.base_amount ?? d.amount,
      credit_amount: d.credit_amount ?? 0,
      credit_note: d.credit_note || '',
      issued_at: d.issued_at || issuedAtRef,
      is_paid: d.is_paid,
      paid_at: d.paid_at,
      transferContent: qr?.transferContent || '',
      vietQrUrl: qr?.vietQrUrl || null,
    };
  });

  let suggestedPrevOvertime = 0;
  for (const s of dataset.sessions) {
    if (s.type !== 'BADMINTON' || s.billing_mode === 'AD_HOC' || s.date.slice(0, 7) !== prevMonth) continue;
    if (s.cost_detail) {
      try {
        const parsed = JSON.parse(s.cost_detail) as {
          courtLines?: Array<{
            isExtra?: boolean;
            amount?: number;
            courts?: number;
            hours?: number;
            pricePerHour?: number;
          }>;
        };
        if (Array.isArray(parsed.courtLines)) {
          for (const line of parsed.courtLines) {
            if (!line?.isExtra) continue;
            const amt =
              line.amount !== undefined
                ? Number(line.amount) || 0
                : Math.round((Number(line.courts) || 0) * (Number(line.hours) || 0) * (Number(line.pricePerHour) || 0));
            suggestedPrevOvertime += Math.max(0, amt);
          }
          continue;
        }
      } catch {
        // fallback below
      }
    }
    if (s.court_amount > 0 && s.shuttle_amount === 0 && s.other_amount === 0) {
      suggestedPrevOvertime += s.court_amount;
    }
  }

  return {
    month: targetMonth,
    bill,
    dues,
    sessions: sessionsInMonth,
    guestIncomeDetail: { paidCount, paidAmount, unpaidAmount },
    suggestedEstimateFromSchedule: suggestedEstimate,
    suggestedPrevOvertime,
    contributions: normalizeContributionsList(
      parseContributionsSafe(billRow?.shuttle_contributions),
      membersMap
    ),
    prevMonthContributions: [
      ...normalizeContributionsList(parseContributionsSafe(prevRow?.shuttle_contributions), membersMap),
      ...normalizeContributionsList(parseContributionsSafe(prevRow?.carry_over_credits), membersMap),
    ],
    refundCredits,
  };
}

export function buildDebtsData(dataset: ClubDataset): SeparatedDebtsData {
  const membersMap = buildMembersMap(dataset.members);
  const badmintonBase = buildBadmintonDues({
    monthlyDues: dataset.monthly_dues,
    attendances: dataset.attendance,
    sessions: dataset.sessions,
    members: dataset.members,
    treasurerMemberId: dataset.settings.treasurer_member_id,
    transferPrefix: dataset.settings.transfer_prefix,
    vietqrTemplate: dataset.settings.vietqr_template,
  });

  const billByMonth = new Map(dataset.monthly_bills.map((b) => [b.month, b]));
  const enrichSettlement = (st: Settlement): Settlement => ({
    ...st,
    from_name: st.from_name || membersMap.get(st.from_member_id)?.name || st.from_member_id,
    to_name: st.to_name || membersMap.get(st.to_member_id)?.name || st.to_member_id,
  });

  const badminton = {
    ...badmintonBase,
    monthlyDues: badmintonBase.monthlyDues.map((d) => ({
      ...d,
      issued_at: d.issued_at || billByMonth.get(d.month)?.updated_at?.slice(0, 10) || `${d.month}-01`,
    })),
    recentSettlements: dataset.settlements
      .filter((s) => s.category === 'BADMINTON')
      .map(enrichSettlement)
      .sort((a, b) => b.settled_at.localeCompare(a.settled_at))
      .slice(0, 30),
  };

  const drinkingUnpaid = dataset.attendance
    .filter((a) => a.session_type === 'DRINKING' && !a.is_paid)
    .map((a) => ({
      ...a,
      member_name: a.member_name || membersMap.get(a.member_id)?.name || a.member_id,
      creditor_name: a.creditor_name || membersMap.get(a.creditor_id)?.name || a.creditor_id,
    }));

  const unreconciledDrinking = dataset.settlements.filter(
    (s) => !s.is_reconciled && (!s.category || s.category === 'DRINKING')
  );

  const simplified = simplifyDebts({
    attendances: drinkingUnpaid,
    sessions: dataset.sessions,
    members: dataset.members,
    unreconciledSettlements: unreconciledDrinking,
    transferPrefix: dataset.settings.transfer_prefix,
    vietqrTemplate: dataset.settings.vietqr_template,
  });

  return {
    treasurerMemberId: dataset.settings.treasurer_member_id,
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
      recentSettlements: dataset.settlements
        .filter((s) => !s.category || s.category === 'DRINKING')
        .map(enrichSettlement)
        .sort((a, b) => b.settled_at.localeCompare(a.settled_at))
        .slice(0, 30),
      unreconciledSettlements: unreconciledDrinking.map(enrichSettlement),
      imbalanceAmount: simplified.imbalanceAmount ?? 0,
      totalOutstanding: simplified.totalOutstanding,
    },
  };
}

export function buildGuestStatsData(dataset: ClubDataset, monthStr?: string): GuestStatsData {
  const targetMonth =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())
      ? monthStr.trim()
      : getTodayDateStr().slice(0, 7);

  const membersMap = buildMembersMap(dataset.members);
  const byGuest = new Map<string, GuestStatItem>();
  const adhocSessionIds = new Set(
    dataset.sessions
      .filter((s) => s.type === 'BADMINTON' && s.billing_mode === 'AD_HOC')
      .map((s) => s.session_id)
  );
  let totalVisits = 0;
  let totalFee = 0;
  let totalPaid = 0;
  let totalUnpaid = 0;
  let collectedInMonthAmount = 0;

  for (const att of dataset.attendance) {
    if (
      att.member_type_snapshot !== 'GUEST' ||
      att.session_type !== 'BADMINTON' ||
      adhocSessionIds.has(att.session_id)
    ) {
      continue;
    }

    const fee = Number(att.fee_amount) || 0;
    const paidRefMonth = att.is_paid && att.paid_at ? att.paid_at.slice(0, 7) : att.session_date.slice(0, 7);
    if (att.is_paid && paidRefMonth === targetMonth) {
      collectedInMonthAmount += fee;
    }

    if (att.session_date.slice(0, 7) !== targetMonth) {
      continue;
    }

    let item = byGuest.get(att.member_id);
    if (!item) {
      item = {
        memberId: att.member_id,
        name: membersMap.get(att.member_id)?.name || att.member_name || att.member_id,
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
    item.totalFee += fee;
    if (att.is_paid) {
      item.totalPaid += fee;
      totalPaid += fee;
    } else {
      item.totalUnpaid += fee;
      totalUnpaid += fee;
    }
    totalVisits += 1;
    totalFee += fee;

    item.sessions.push({
      attendanceId: att.attendance_id,
      sessionId: att.session_id,
      date: att.session_date,
      sessionType: att.session_type,
      feeAmount: fee,
      isPaid: att.is_paid,
    });
  }

  const guests = Array.from(byGuest.values())
    .map((g) => ({
      ...g,
      dates: [...g.dates].sort(),
      sessions: [...g.sessions].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) =>
      b.totalUnpaid !== a.totalUnpaid
        ? b.totalUnpaid - a.totalUnpaid
        : b.sessionCount - a.sessionCount
    );
  return {
    month: targetMonth,
    summary: {
      totalGuests: guests.length,
      totalVisits,
      totalFee,
      totalPaid,
      totalUnpaid,
      collectedInMonthAmount,
    },
    guests,
  };
}

export function buildDashboardData(
  dataset: ClubDataset,
  periodType: PeriodType = 'MONTH',
  refDate?: string
): DashboardData {
  const rDate = refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate) ? refDate : getTodayDateStr();
  const period = getPeriodRange(periodType, rDate);
  const currentMonth = rDate.slice(0, 7);
  const monthlyBill = buildMonthlyBillData(dataset, currentMonth);
  const debts = buildDebtsData(dataset);
  const membersMap = buildMembersMap(dataset.members);

  let monthlyBillCostInPeriod = 0;
  const issuedOrClosedMonths = new Set<string>();
  if (periodType !== 'WEEK') {
    const startMonth = period.startDate ? period.startDate.slice(0, 7) : '';
    const endMonth = period.endDate ? period.endDate.slice(0, 7) : '9999-12';
    const monthSet = new Set<string>();
    for (const b of dataset.monthly_bills) {
      if (b.month) monthSet.add(b.month);
    }
    for (const d of dataset.monthly_dues) {
      if (d.month) monthSet.add(d.month);
    }
    for (const m of monthSet) {
      if (startMonth && m < startMonth) continue;
      if (m > endMonth) continue;
      const mb = buildMonthlyBillData(dataset, m);
      const isIssuedOrClosed =
        mb.bill.status === 'CLOSED' || mb.bill.billed_total > 0 || mb.dues.length > 0;
      if (isIssuedOrClosed) {
        issuedOrClosedMonths.add(m);
        monthlyBillCostInPeriod += Number(mb.bill.actual_cost) || 0;
      }
    }
  }

  let badCost = 0;
  let badCount = 0;
  let fixedCount = 0;
  let adhocCount = 0;
  let drinkCost = 0;
  let drinkCount = 0;

  for (const s of dataset.sessions) {
    if (period.startDate && s.date < period.startDate) continue;
    if (period.endDate && s.date > period.endDate) continue;
    if (s.type === 'BADMINTON') {
      badCount++;
      if (s.billing_mode === 'AD_HOC') {
        adhocCount++;
        badCost += Number(s.total_amount) || 0;
      } else {
        fixedCount++;
        // Tránh đếm trùng: tháng đã phát hành/chốt hóa đơn đã tính qua monthlyBillCostInPeriod
        if (periodType === 'WEEK' || !issuedOrClosedMonths.has(s.date.slice(0, 7))) {
          badCost += Number(s.total_amount) || 0;
        }
      }
    } else if (s.type === 'DRINKING') {
      drinkCost += Number(s.total_amount) || 0;
      drinkCount++;
    }
  }

  const recentSessions = [...dataset.sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((s) => ({
      ...s,
      payer_name: s.payer_name || membersMap.get(s.payer_id)?.name || s.payer_id,
    }));

  return {
    period,
    currentMonth,
    badminton: {
      periodCost: badCost + monthlyBillCostInPeriod,
      monthlyBillCostInPeriod,
      sessionCount: badCount,
      fixedSessionCount: fixedCount,
      adhocSessionCount: adhocCount,
      guestIncomeInMonth: monthlyBill.bill.guest_income,
      carryIn: monthlyBill.bill.carry_in,
      projectedCarryOut: monthlyBill.bill.carry_out,
      unpaidTotal: debts.badminton.totalOutstanding,
      monthlyBillIssued: monthlyBill.dues.length > 0 || monthlyBill.bill.billed_total > 0,
      monthlyBillStatus: monthlyBill.bill.status,
      estimate: monthlyBill.bill.estimate,
      billedTotal: monthlyBill.bill.billed_total,
      actualCost: monthlyBill.bill.actual_cost,
      perMember: monthlyBill.bill.per_member,
      paidMembersCount: monthlyBill.dues.filter((d) => d.is_paid).length,
      totalMembersCount: monthlyBill.dues.length,
    },
    drinking: {
      periodCost: drinkCost,
      sessionCount: drinkCount,
      unpaidTotal: debts.drinking.totalOutstanding,
    },
    recentSessions,
  };
}

export function buildSessionDetail(dataset: ClubDataset, sessionId: string): SessionDetailData {
  const membersMap = buildMembersMap(dataset.members);
  const rawSession = dataset.sessions.find((s) => s.session_id === sessionId);
  if (!rawSession) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`, 404);
  }
  const session: Session = {
    ...rawSession,
    payer_name: rawSession.payer_name || membersMap.get(rawSession.payer_id)?.name || rawSession.payer_id,
  };
  const attendances = dataset.attendance
    .filter((a) => a.session_id === sessionId)
    .map((a) => ({
      ...a,
      member_name: a.member_name || membersMap.get(a.member_id)?.name || a.member_id,
      creditor_name: a.creditor_name || membersMap.get(a.creditor_id)?.name || a.creditor_id,
    }));
  const items = dataset.session_items
    .filter((it) => it.session_id === sessionId)
    .map((it) => ({
      ...it,
      member_name: it.member_name || membersMap.get(it.member_id)?.name || it.member_id,
    }));

  return { session, attendances, items };
}

export function buildAllData(
  dataset: ClubDataset,
  periodType: PeriodType = 'MONTH',
  refDate?: string,
  month?: string
): AllDataResponse {
  const rDate = refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate) ? refDate : getTodayDateStr();
  const targetMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : rDate.slice(0, 7);
  const membersMap = buildMembersMap(dataset.members);

  const debts = buildDebtsData(dataset);
  const cutoffDateStr = getCutoffDateSixMonthsAgo(rDate);
  const unpaidSessionSet = new Set<string>();
  for (const a of debts.drinking.unpaidAttendances) unpaidSessionSet.add(a.session_id);
  for (const g of debts.badminton.guestDues) unpaidSessionSet.add(g.session_id);
  for (const ad of debts.badminton.adhocDues) unpaidSessionSet.add(ad.session_id);

  const recentSessions = dataset.sessions
    .filter((s) => s.date >= cutoffDateStr || unpaidSessionSet.has(s.session_id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .map((s) => ({
      ...s,
      payer_name: s.payer_name || membersMap.get(s.payer_id)?.name || s.payer_id,
    }));

  return {
    bootstrap: {
      settings: { ...dataset.settings },
      members: [...dataset.members],
      closedMonths: dataset.monthly_bills
        .filter((b) => b.status === 'CLOSED')
        .map((b) => b.month),
    },
    dashboard: buildDashboardData(dataset, periodType, rDate),
    sessions: recentSessions,
    debts,
    schedule: buildScheduleData(dataset, targetMonth),
    monthlyBill: buildMonthlyBillData(dataset, targetMonth),
    guestStats: buildGuestStatsData(dataset, targetMonth),
  };
}

// ============================================================================
// MUTATION PLANNERS (100% Parity with SheetService.gs)
// ============================================================================

function resolveQuickNewGuests(
  existingMembers: Member[],
  rawNewGuests: CreateSessionPayload['new_guests'] = [],
  rawPaidImmediate: string[] = [],
  now: string
): {
  allMembers: Member[];
  createdMembers: Member[];
  newGuestMemberIds: string[];
  paidImmediatelySet: Set<string>;
} {
  const allMembers = [...existingMembers];
  const byNameLower = new Map<string, Member>();
  for (const m of allMembers) {
    byNameLower.set(m.name.trim().toLowerCase(), m);
  }
  const paidImmediatelySet = new Set<string>(rawPaidImmediate.map((id) => String(id).trim()).filter(Boolean));
  const createdMembers: Member[] = [];
  const newGuestMemberIds: string[] = [];

  rawNewGuests.forEach((gItem, gIdx) => {
    const gName = typeof gItem === 'string' ? gItem.trim() : String(gItem?.name || '').trim();
    if (!gName) return;

    const existing = byNameLower.get(gName.toLowerCase());
    if (existing) {
      newGuestMemberIds.push(existing.member_id);
      if (typeof gItem === 'object' && gItem?.paidImmediately === true) {
        paidImmediatelySet.add(existing.member_id);
      }
      return;
    }

    const newId = generateEntityId('MEM', String(gIdx));
    const newMem: Member = {
      member_id: newId,
      name: gName,
      aliases: typeof gItem === 'object' && gItem ? String(gItem.aliases || '').trim() : '',
      type: 'GUEST',
      phone: '',
      bank_bin: '',
      bank_name: '',
      account_no: '',
      account_name: '',
      email: '',
      has_email: false,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    allMembers.push(newMem);
    createdMembers.push(newMem);
    byNameLower.set(gName.toLowerCase(), newMem);
    newGuestMemberIds.push(newId);

    if (typeof gItem === 'object' && gItem?.paidImmediately === true) {
      paidImmediatelySet.add(newId);
    }
  });

  return { allMembers, createdMembers, newGuestMemberIds, paidImmediatelySet };
}

function resolvePrimaryDrinkingPayer(
  items: SessionItem[],
  fallbackPayerId: string
): string {
  const billTotals = new Map<string, number>();
  const anyTotals = new Map<string, number>();
  for (const it of items) {
    const amt = Math.max(0, Number(it.amount) || 0);
    const mId = String(it.member_id || '').trim();
    if (!mId || amt <= 0) continue;
    anyTotals.set(mId, (anyTotals.get(mId) || 0) + amt);
    if (String(it.kind || '').toUpperCase() === 'BILL') {
      billTotals.set(mId, (billTotals.get(mId) || 0) + amt);
    }
  }
  const sourceMap = billTotals.size > 0 ? billTotals : anyTotals;
  let bestId = '';
  let bestAmt = -1;
  for (const [mId, amt] of sourceMap.entries()) {
    if (amt > bestAmt) {
      bestAmt = amt;
      bestId = mId;
    }
  }
  return bestId || fallbackPayerId;
}

function buildDrinkingSplitRows(params: {
  sessionId: string;
  dateStr: string;
  attendeeIds: string[];
  rawItems: SessionItemInput[] | undefined;
  payerId: string;
  totalAmountFallback: number;
  roundingUnit: number;
  membersMap: Map<string, Member>;
  now: string;
}): {
  totalAmount: number;
  perPersonAmount: number;
  attendeeCount: number;
  attendanceRows: Attendance[];
  itemsToSave: SessionItem[];
  primaryPayerId: string;
} {
  const {
    sessionId,
    dateStr,
    attendeeIds,
    rawItems,
    payerId,
    totalAmountFallback,
    roundingUnit,
    membersMap,
    now,
  } = params;

  const normalizedItems: SessionItemInput[] =
    Array.isArray(rawItems) && rawItems.length > 0
      ? rawItems.filter((it) => Math.round(Number(it.amount) || 0) > 0 && String(it.member_id || '').trim())
      : totalAmountFallback > 0 && payerId
        ? [{ member_id: payerId, kind: 'BILL', item_name: 'Hóa đơn quán', amount: totalAmountFallback }]
        : [];

  const itemsToSave: SessionItem[] = normalizedItems.map((it, idx) => ({
    item_id: generateEntityId('ITM', String(idx)),
    session_id: sessionId,
    member_id: it.member_id.trim(),
    member_name: membersMap.get(it.member_id.trim())?.name || '',
    kind: it.kind || 'ITEM',
    item_name: String(it.item_name || 'Đóng góp').trim(),
    amount: Math.max(0, Math.round(Number(it.amount) || 0)),
  }));

  const primaryPayerId = resolvePrimaryDrinkingPayer(itemsToSave, payerId);
  const split = calculateDrinkingSplit(attendeeIds, normalizedItems, roundingUnit, primaryPayerId);

  const attendanceRows: Attendance[] = split.splits.map((sp, idx) => {
    const member = membersMap.get(sp.memberId);
    return {
      attendance_id: generateEntityId('ATT', String(idx)),
      session_id: sessionId,
      session_date: dateStr,
      session_type: 'DRINKING',
      member_id: sp.memberId,
      member_name: member?.name || sp.memberId,
      member_type_snapshot: member?.type === 'GUEST' ? 'GUEST' : 'MAIN',
      fee_amount: sp.perPersonAmount,
      creditor_id: primaryPayerId || '',
      contributed_amount: sp.contributedAmount,
      net_amount: sp.netAmount,
      is_paid: sp.isPaid,
      paid_at: sp.isPaid ? now : '',
      settlement_id: '',
      note: '',
    };
  });

  return {
    totalAmount: split.totalAmount,
    perPersonAmount: split.perPersonAmount,
    attendeeCount: attendanceRows.length,
    attendanceRows,
    itemsToSave,
    primaryPayerId,
  };
}

export function planCreateSession(
  dataset: ClubDataset,
  payload: CreateSessionPayload,
  editorEmail: string
): BatchMutationPlan<CreateSessionResponse> {
  const now = nowIsoVN();
  const sessionType = payload.type;
  if (sessionType !== 'BADMINTON' && sessionType !== 'DRINKING') {
    throw new ApiClientError('BAD_REQUEST', 'type phải là BADMINTON hoặc DRINKING.', 400);
  }
  const dateStr = String(payload.date || getTodayDateStr()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ApiClientError('BAD_REQUEST', 'Định dạng date phải là YYYY-MM-DD.', 400);
  }

  const settings = dataset.settings;
  const guestFee = Math.max(0, Math.round(Number(payload.guestFee ?? settings.guest_fee) || 0));
  const treasurerId = settings.treasurer_member_id;
  let payerId = String(payload.payerId || treasurerId || '').trim();

  const guestRes = resolveQuickNewGuests(
    dataset.members,
    payload.new_guests || [],
    payload.paidImmediatelyMemberIds || [],
    now
  );
  const membersMap = buildMembersMap(guestRes.allMembers);
  const attendeeIds = Array.from(
    new Set([...(payload.attendeeIds || []), ...guestRes.newGuestMemberIds].map((id) => String(id).trim()).filter(Boolean))
  );

  const sessionId = generateEntityId('SES');
  const billingMode =
    sessionType === 'BADMINTON'
      ? payload.billingMode === 'AD_HOC'
        ? 'AD_HOC'
        : 'MONTHLY'
      : undefined;

  let planId = String(payload.planId || '').trim();
  if (sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' && !planId) {
    const matchedPlan = dataset.schedule.find(
      (d) => d.date === dateStr && d.status !== 'CANCELLED'
    );
    if (matchedPlan) planId = matchedPlan.plan_id;
  }

  let totalAmount = Math.max(0, Math.round(Number(payload.totalAmount) || 0));
  let perPerson = 0;
  let attendeeCount = attendeeIds.length;
  let attendanceRows: Attendance[] = [];
  let itemsToSave: SessionItem[] = [];
  const unit = settings.rounding_unit || 1000;

  if (sessionType === 'BADMINTON') {
    if (billingMode === 'AD_HOC') {
      perPerson = calculateAdhocPerPerson(totalAmount, attendeeIds.length, unit);
      attendanceRows = attendeeIds.map((mId, idx) => {
        const member = membersMap.get(mId);
        if (!member) throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${mId}`, 404);
        const isPaid = mId === payerId || guestRes.paidImmediatelySet.has(mId) || perPerson === 0;
        return {
          attendance_id: generateEntityId('ATT', String(idx)),
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_name: member.name,
          member_type_snapshot: member.type === 'GUEST' ? 'GUEST' : 'MAIN',
          fee_amount: perPerson,
          creditor_id: payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : perPerson,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: '',
        };
      });
    } else {
      attendanceRows = attendeeIds.map((mId, idx) => {
        const member = membersMap.get(mId);
        if (!member) throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${mId}`, 404);
        const mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        const fee = mType === 'GUEST' ? guestFee : 0;
        const isPaid = mType === 'MAIN' || guestRes.paidImmediatelySet.has(mId) || fee === 0;
        return {
          attendance_id: generateEntityId('ATT', String(idx)),
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_name: member.name,
          member_type_snapshot: mType,
          fee_amount: fee,
          creditor_id: treasurerId || payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : fee,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: '',
        };
      });
    }
  } else {
    const split = buildDrinkingSplitRows({
      sessionId,
      dateStr,
      attendeeIds,
      rawItems: payload.items,
      payerId,
      totalAmountFallback: totalAmount,
      roundingUnit: unit,
      membersMap,
      now,
    });
    if (split.attendeeCount === 0) {
      throw new ApiClientError('BAD_REQUEST', 'Buổi Ăn nhậu phải có ít nhất 1 người tham gia.', 400);
    }
    totalAmount = split.totalAmount;
    perPerson = split.perPersonAmount;
    attendeeCount = split.attendeeCount;
    attendanceRows = split.attendanceRows;
    itemsToSave = split.itemsToSave;
    payerId = split.primaryPayerId;
  }

  const resolvedPayerId =
    sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' ? treasurerId || payerId : payerId;
  const session: Session = {
    session_id: sessionId,
    date: dateStr,
    type: sessionType,
    title: String(payload.title || (sessionType === 'BADMINTON' ? `Cầu lông ${dateStr}` : `Ăn nhậu ${dateStr}`)).trim(),
    total_amount: totalAmount,
    guest_fee: sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' ? guestFee : 0,
    payer_id: resolvedPayerId,
    payer_name: membersMap.get(resolvedPayerId)?.name || '',
    per_person_amount: perPerson,
    attendee_count: attendeeCount,
    receipt_drive_id: String(payload.receiptDriveId || '').trim(),
    receipt_url: String(payload.receiptUrl || '').trim(),
    receipt_summary: String(payload.receiptSummary || '').trim(),
    note: String(payload.note || '').trim(),
    court_amount: sessionType === 'BADMINTON' ? Math.max(0, Math.round(Number(payload.courtAmount) || 0)) : 0,
    shuttle_qty: sessionType === 'BADMINTON' ? Math.max(0, Math.round(Number(payload.shuttleQty) || 0)) : 0,
    shuttle_amount: sessionType === 'BADMINTON' ? Math.max(0, Math.round(Number(payload.shuttleAmount) || 0)) : 0,
    other_amount: sessionType === 'BADMINTON' ? Math.max(0, Math.round(Number(payload.otherAmount) || 0)) : 0,
    cost_detail: sessionType === 'BADMINTON' && payload.costDetail ? JSON.stringify(payload.costDetail) : '',
    venue_type: sessionType === 'DRINKING' ? payload.venueType || 'RESTAURANT' : '',
    plan_id: planId,
    billing_mode: billingMode,
    created_by: editorEmail,
    created_at: now,
    updated_at: now,
  };

  const upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>> = {
    sessions: [{ id: session.session_id, data: session as unknown as Record<string, unknown> }],
  };
  if (guestRes.createdMembers.length > 0) {
    upserts.members = guestRes.createdMembers.map((m) => ({
      id: m.member_id,
      data: toPublicMemberRecord(m, false) as unknown as Record<string, unknown>,
    }));
    upserts.members_private = guestRes.createdMembers.map((m) => ({
      id: m.member_id,
      data: {
        member_id: m.member_id,
        phone: '',
        email: '',
        updated_at: now,
      },
    }));
  }
  if (attendanceRows.length > 0) {
    upserts.attendance = attendanceRows.map((a) => ({
      id: a.attendance_id,
      data: a as unknown as Record<string, unknown>,
    }));
  }
  if (itemsToSave.length > 0) {
    upserts.session_items = itemsToSave.map((it) => ({
      id: it.item_id,
      data: it as unknown as Record<string, unknown>,
    }));
  }
  if (planId) {
    const existingPlan = dataset.schedule.find((d) => d.plan_id === planId);
    if (existingPlan) {
      const updatedPlan: ScheduleDay & { month?: string } = {
        ...existingPlan,
        status: 'DONE',
        session_id: sessionId,
        planned_member_ids: attendeeIds.join(','),
        updated_at: now,
        month: existingPlan.date.slice(0, 7),
      };
      upserts.schedule = [{ id: planId, data: updatedPlan as unknown as Record<string, unknown> }];
    }
  }

  return {
    upserts,
    deletes: {},
    result: {
      session,
      createdMembers: guestRes.createdMembers,
      attendances: attendanceRows,
      items: itemsToSave,
    },
  };
}

export function planUpdateSession(
  dataset: ClubDataset,
  payload: UpdateSessionPayload
): BatchMutationPlan<{ session: Session }> {
  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) throw new ApiClientError('BAD_REQUEST', 'Thiếu sessionId cần cập nhật.', 400);

  const oldSession = dataset.sessions.find((s) => s.session_id === sessionId);
  if (!oldSession) throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`, 404);

  const oldAttendances = dataset.attendance.filter((a) => a.session_id === sessionId);
  const oldItems = dataset.session_items.filter((it) => it.session_id === sessionId);
  const hasSettledAttendance = oldAttendances.some((a) => Boolean(a.settlement_id));

  const now = nowIsoVN();
  const settings = dataset.settings;
  const sessionTypeRaw = String(payload.type || oldSession.type).trim().toUpperCase();
  if (sessionTypeRaw !== 'BADMINTON' && sessionTypeRaw !== 'DRINKING') {
    throw new ApiClientError('BAD_REQUEST', 'type phải là BADMINTON hoặc DRINKING.', 400);
  }
  const sessionType = sessionTypeRaw as Session['type'];
  const dateStr = String(payload.date || oldSession.date).trim();
  const title = String(payload.title || oldSession.title).trim();
  const billingMode =
    sessionType === 'BADMINTON'
      ? (payload.billingMode || oldSession.billing_mode || 'MONTHLY') === 'AD_HOC'
        ? 'AD_HOC'
        : 'MONTHLY'
      : undefined;
  const guestFeeFallback = oldSession.guest_fee > 0 ? oldSession.guest_fee : settings.guest_fee;
  const guestFee = Math.max(0, Math.round(Number(payload.guestFee ?? guestFeeFallback) || 0));
  const treasurerId = settings.treasurer_member_id;
  const payerId = String(payload.payerId || oldSession.payer_id || treasurerId || '').trim();

  if (hasSettledAttendance) {
    const oldAttendeeIds = Array.from(new Set(oldAttendances.map((a) => a.member_id))).sort();
    const newAttendeeIds = Array.from(
      new Set((payload.attendeeIds || []).map((id) => String(id).trim()).filter(Boolean))
    ).sort();
    const sameAttendees =
      oldAttendeeIds.length === newAttendeeIds.length &&
      oldAttendeeIds.every((id, idx) => id === newAttendeeIds[idx]);
    const hasNewGuests = (payload.new_guests || []).length > 0;
    const nextTotalAmount =
      payload.totalAmount !== undefined
        ? Math.max(0, Math.round(Number(payload.totalAmount) || 0))
        : oldSession.total_amount;
    const sameBillingMode =
      sessionType !== 'BADMINTON' ||
      (billingMode || 'MONTHLY') === (oldSession.billing_mode || 'MONTHLY');
    const samePayer =
      sessionType === 'DRINKING' ||
      billingMode !== 'AD_HOC' ||
      payerId === (oldSession.payer_id || treasurerId || '');
    const sameGuestFee =
      sessionType !== 'BADMINTON' ||
      billingMode !== 'MONTHLY' ||
      guestFee === (oldSession.guest_fee > 0 ? oldSession.guest_fee : settings.guest_fee);

    let sameDrinkingItems = true;
    if (sessionType === 'DRINKING' && payload.items !== undefined) {
      const normOldItems = oldItems
        .filter((it) => it.amount > 0 && it.member_id)
        .map((it) => `${it.member_id}|${it.kind}|${Math.round(it.amount)}|${String(it.item_name || '').trim()}`)
        .sort();
      const normNewItems = (payload.items || [])
        .filter((it) => Number(it.amount) > 0 && it.member_id)
        .map((it) => `${String(it.member_id).trim()}|${it.kind === 'BILL' ? 'BILL' : 'ITEM'}|${Math.round(Number(it.amount) || 0)}|${String(it.item_name || '').trim()}`)
        .sort();
      sameDrinkingItems =
        normOldItems.length === normNewItems.length &&
        normOldItems.every((v, idx) => v === normNewItems[idx]);
    }

    const financialUnchanged =
      sessionType === oldSession.type &&
      dateStr === oldSession.date &&
      sameBillingMode &&
      nextTotalAmount === oldSession.total_amount &&
      sameGuestFee &&
      samePayer &&
      sameAttendees &&
      !hasNewGuests &&
      sameDrinkingItems;

    if (!financialUnchanged) {
      throw new ApiClientError(
        'BAD_REQUEST',
        'Buổi đã có khoản thanh toán đối soát, chỉ được sửa Tiêu đề, Ghi chú hoặc Ảnh hóa đơn (không sửa được số tiền / người tham gia).',
        400
      );
    }

    const metadataSession: Session = {
      ...oldSession,
      title,
      receipt_drive_id:
        payload.receiptDriveId !== undefined
          ? String(payload.receiptDriveId)
          : oldSession.receipt_drive_id,
      receipt_url:
        payload.receiptUrl !== undefined ? String(payload.receiptUrl) : oldSession.receipt_url,
      receipt_summary:
        payload.receiptSummary !== undefined
          ? String(payload.receiptSummary)
          : oldSession.receipt_summary,
      note: payload.note !== undefined ? String(payload.note) : oldSession.note,
      venue_type:
        sessionType === 'DRINKING'
          ? payload.venueType || oldSession.venue_type || 'RESTAURANT'
          : oldSession.venue_type,
      updated_at: now,
    };

    return {
      upserts: {
        sessions: [{ id: sessionId, data: metadataSession as unknown as Record<string, unknown> }],
      },
      deletes: {},
      result: { session: metadataSession },
    };
  }

  const guestRes = resolveQuickNewGuests(
    dataset.members,
    payload.new_guests || [],
    payload.paidImmediatelyMemberIds || [],
    now
  );
  const membersMap = buildMembersMap(guestRes.allMembers);
  const attendeeIds = Array.from(
    new Set([...(payload.attendeeIds || []), ...guestRes.newGuestMemberIds].map((id) => String(id).trim()).filter(Boolean))
  );

  let totalAmount = Math.max(0, Math.round(Number(payload.totalAmount ?? oldSession.total_amount) || 0));
  let resolvedDrinkPayerId = payerId;
  let perPerson = 0;
  let attendeeCount = attendeeIds.length;
  let attendanceRows: Attendance[] = [];
  let itemsToSave: SessionItem[] = [];
  const unit = settings.rounding_unit || 1000;

  if (sessionType === 'BADMINTON') {
    for (const mId of attendeeIds) {
      if (!membersMap.has(mId)) {
        throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${mId}`, 404);
      }
    }
    if (billingMode === 'AD_HOC') {
      perPerson = calculateAdhocPerPerson(totalAmount, attendeeIds.length, unit);
      attendanceRows = attendeeIds.map((mId, idx) => {
        const member = membersMap.get(mId)!;
        const isPaid = mId === payerId || guestRes.paidImmediatelySet.has(mId) || perPerson === 0;
        return {
          attendance_id: generateEntityId('ATT', `U_${idx}`),
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_name: member.name,
          member_type_snapshot: member.type === 'GUEST' ? 'GUEST' : 'MAIN',
          fee_amount: perPerson,
          creditor_id: payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : perPerson,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: '',
        };
      });
    } else {
      attendanceRows = attendeeIds.map((mId, idx) => {
        const member = membersMap.get(mId)!;
        const mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        const fee = mType === 'GUEST' ? guestFee : 0;
        const isPaid = mType === 'MAIN' || guestRes.paidImmediatelySet.has(mId) || fee === 0;
        return {
          attendance_id: generateEntityId('ATT', `U_${idx}`),
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_name: member.name,
          member_type_snapshot: mType,
          fee_amount: fee,
          creditor_id: treasurerId || payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : fee,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: '',
        };
      });
    }
    attendeeCount = attendanceRows.length;
  } else {
    const split = buildDrinkingSplitRows({
      sessionId,
      dateStr,
      attendeeIds,
      rawItems: payload.items,
      payerId,
      totalAmountFallback: totalAmount,
      roundingUnit: unit,
      membersMap,
      now,
    });
    if (split.attendeeCount === 0) {
      throw new ApiClientError('BAD_REQUEST', 'Buổi Ăn nhậu phải có ít nhất 1 người tham gia.', 400);
    }
    totalAmount = split.totalAmount;
    perPerson = split.perPersonAmount;
    attendeeCount = split.attendeeCount;
    attendanceRows = split.attendanceRows;
    itemsToSave = split.itemsToSave;
    resolvedDrinkPayerId = split.primaryPayerId;
  }

  let nextPlanId =
    sessionType === 'BADMINTON' && billingMode !== 'AD_HOC'
      ? payload.planId !== undefined
        ? String(payload.planId || '').trim()
        : oldSession.plan_id
      : '';
  if (sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' && !nextPlanId) {
    const matchedPlan = dataset.schedule.find(
      (d) => d.date === dateStr && d.status !== 'CANCELLED'
    );
    if (matchedPlan) nextPlanId = matchedPlan.plan_id;
  }

  const resolvedPayerId =
    sessionType === 'BADMINTON' && billingMode !== 'AD_HOC'
      ? treasurerId || payerId
      : resolvedDrinkPayerId;
  const updatedSession: Session = {
    ...oldSession,
    date: dateStr,
    type: sessionType,
    title,
    total_amount: totalAmount,
    guest_fee: sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' ? guestFee : 0,
    payer_id: resolvedPayerId,
    payer_name: membersMap.get(resolvedPayerId)?.name || '',
    per_person_amount: perPerson,
    attendee_count: attendeeCount,
    receipt_drive_id: payload.receiptDriveId !== undefined ? String(payload.receiptDriveId) : oldSession.receipt_drive_id,
    receipt_url: payload.receiptUrl !== undefined ? String(payload.receiptUrl) : oldSession.receipt_url,
    receipt_summary: payload.receiptSummary !== undefined ? String(payload.receiptSummary) : oldSession.receipt_summary,
    note: payload.note !== undefined ? String(payload.note) : oldSession.note,
    court_amount:
      sessionType === 'BADMINTON'
        ? Math.max(0, Math.round(Number(payload.courtAmount ?? oldSession.court_amount) || 0))
        : 0,
    shuttle_qty:
      sessionType === 'BADMINTON'
        ? Math.max(0, Math.round(Number(payload.shuttleQty ?? oldSession.shuttle_qty) || 0))
        : 0,
    shuttle_amount:
      sessionType === 'BADMINTON'
        ? Math.max(0, Math.round(Number(payload.shuttleAmount ?? oldSession.shuttle_amount) || 0))
        : 0,
    other_amount:
      sessionType === 'BADMINTON'
        ? Math.max(0, Math.round(Number(payload.otherAmount ?? oldSession.other_amount) || 0))
        : 0,
    cost_detail:
      sessionType === 'BADMINTON'
        ? payload.costDetail
          ? JSON.stringify(payload.costDetail)
          : oldSession.cost_detail
        : '',
    venue_type: sessionType === 'DRINKING' ? payload.venueType || oldSession.venue_type || 'RESTAURANT' : '',
    billing_mode: billingMode,
    plan_id: nextPlanId,
    updated_at: now,
  };

  const upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>> = {
    sessions: [{ id: sessionId, data: updatedSession as unknown as Record<string, unknown> }],
  };
  if (guestRes.createdMembers.length > 0) {
    upserts.members = guestRes.createdMembers.map((m) => ({
      id: m.member_id,
      data: toPublicMemberRecord(m, false) as unknown as Record<string, unknown>,
    }));
    upserts.members_private = guestRes.createdMembers.map((m) => ({
      id: m.member_id,
      data: {
        member_id: m.member_id,
        phone: '',
        email: '',
        updated_at: now,
      },
    }));
  }
  if (attendanceRows.length > 0) {
    upserts.attendance = attendanceRows.map((a) => ({
      id: a.attendance_id,
      data: a as unknown as Record<string, unknown>,
    }));
  }
  if (itemsToSave.length > 0) {
    upserts.session_items = itemsToSave.map((it) => ({
      id: it.item_id,
      data: it as unknown as Record<string, unknown>,
    }));
  }

  const scheduleUpdates: MutationUpsertItem[] = [];
  if (oldSession.plan_id && oldSession.plan_id !== nextPlanId) {
    const oldPlan = dataset.schedule.find((d) => d.plan_id === oldSession.plan_id);
    if (oldPlan && (!oldPlan.session_id || oldPlan.session_id === sessionId)) {
      const resetOldPlan: ScheduleDay & { month?: string } = {
        ...oldPlan,
        status: 'PLANNED',
        session_id: '',
        updated_at: now,
        month: oldPlan.date.slice(0, 7),
      };
      scheduleUpdates.push({
        id: oldPlan.plan_id,
        data: resetOldPlan as unknown as Record<string, unknown>,
      });
    }
  }
  if (nextPlanId) {
    const nextPlan = dataset.schedule.find((d) => d.plan_id === nextPlanId);
    if (nextPlan) {
      const doneNextPlan: ScheduleDay & { month?: string } = {
        ...nextPlan,
        status: 'DONE',
        session_id: sessionId,
        planned_member_ids: attendeeIds.join(','),
        updated_at: now,
        month: nextPlan.date.slice(0, 7),
      };
      scheduleUpdates.push({
        id: nextPlanId,
        data: doneNextPlan as unknown as Record<string, unknown>,
      });
    }
  }
  if (scheduleUpdates.length > 0) {
    upserts.schedule = scheduleUpdates;
  }

  return {
    upserts,
    deletes: {
      attendance: oldAttendances.map((a) => a.attendance_id),
      session_items: oldItems.map((it) => it.item_id),
    },
    result: { session: updatedSession },
  };
}

export function planDeleteSession(
  dataset: ClubDataset,
  sessionId: string
): BatchMutationPlan<{ deletedSessionId: string }> {
  const target = dataset.sessions.find((s) => s.session_id === sessionId);
  if (!target) throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`, 404);

  const sessAtts = dataset.attendance.filter((a) => a.session_id === sessionId);
  if (sessAtts.some((a) => Boolean(a.settlement_id))) {
    throw new ApiClientError(
      'BAD_REQUEST',
      'Không thể xóa buổi đã có khoản thanh toán được đối soát.',
      400
    );
  }
  const sessItems = dataset.session_items.filter((it) => it.session_id === sessionId);

  const upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>> = {};
  if (target.plan_id) {
    const plan = dataset.schedule.find((d) => d.plan_id === target.plan_id);
    if (plan && (!plan.session_id || plan.session_id === sessionId)) {
      const resetPlan: ScheduleDay & { month?: string } = {
        ...plan,
        status: 'PLANNED',
        session_id: '',
        updated_at: nowIsoVN(),
        month: plan.date.slice(0, 7),
      };
      upserts.schedule = [{ id: plan.plan_id, data: resetPlan as unknown as Record<string, unknown> }];
    }
  }

  return {
    upserts,
    deletes: {
      sessions: [sessionId],
      attendance: sessAtts.map((a) => a.attendance_id),
      session_items: sessItems.map((it) => it.item_id),
    },
    result: { deletedSessionId: sessionId },
  };
}

const REC_LEDGER_PREFIX = 'REC:';

function encodeReconciledIds(ids: string[]): string {
  const clean = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)));
  return clean.length > 0 ? `${REC_LEDGER_PREFIX}${clean.join(',')}` : '';
}

function parseReconciledIds(raw: string | undefined): string[] {
  const str = String(raw || '').trim();
  if (!str.startsWith(REC_LEDGER_PREFIX)) return [];
  return str
    .slice(REC_LEDGER_PREFIX.length)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function applyDrinkingItemsPaymentToRows(
  rows: Attendance[],
  sessionId: string,
  sourceAttIds: Set<string>,
  toMemberId: string,
  settlementId: string,
  paidAt: string
): Attendance[] {
  let reduction = 0;
  const nextRows = rows.map((a) => {
    if (a.session_id === sessionId && sourceAttIds.has(a.attendance_id) && !a.is_paid) {
      const amt = Math.abs(Math.round(Number(a.net_amount) || Number(a.fee_amount) || 0));
      reduction += amt;
      return {
        ...a,
        net_amount: 0,
        is_paid: true,
        paid_at: paidAt,
        settlement_id: settlementId,
      };
    }
    return { ...a };
  });

  if (reduction <= 0) return nextRows;

  // Phân bổ giảm nợ cho chủ nợ trong buổi: ưu tiên toMemberId, sau đó chủ nợ âm nhiều nhất
  const creditorIndices = nextRows
    .map((a, idx) => ({ a, idx }))
    .filter(({ a }) => a.session_id === sessionId && !a.is_paid && a.net_amount < 0)
    .sort((x, y) => {
      const xPref = x.a.member_id === toMemberId ? 0 : 1;
      const yPref = y.a.member_id === toMemberId ? 0 : 1;
      if (xPref !== yPref) return xPref - yPref;
      return x.a.net_amount - y.a.net_amount;
    });

  let remaining = reduction;
  for (const { idx } of creditorIndices) {
    if (remaining <= 0) break;
    const creditor = nextRows[idx];
    const canAbsorb = Math.abs(creditor.net_amount);
    const apply = Math.min(remaining, canAbsorb);
    const nextNet = Math.round(creditor.net_amount + apply);
    const closed = nextNet >= 0;
    nextRows[idx] = {
      ...creditor,
      net_amount: closed ? 0 : nextNet,
      is_paid: closed,
      paid_at: closed ? paidAt : creditor.paid_at,
      settlement_id: closed ? settlementId : creditor.settlement_id,
    };
    remaining -= apply;
  }

  return nextRows;
}

export function planConfirmPayment(
  dataset: ClubDataset,
  payload: ConfirmPaymentPayload,
  editorEmail: string
): BatchMutationPlan<ConfirmPaymentResponse> {
  if (!payload.fromMemberId || !payload.toMemberId) {
    throw new ApiClientError('BAD_REQUEST', 'Thiếu fromMemberId hoặc toMemberId.', 400);
  }

  const now = nowIsoVN();
  const settlementId = generateEntityId('SET');
  const membersMap = buildMembersMap(dataset.members);
  const category = String(payload.category || 'DRINKING').trim().toUpperCase();
  const mode = String(
    payload.mode || (category === 'BADMINTON' ? 'ITEMS' : 'SIMPLIFIED_TRANSFER')
  )
    .trim()
    .toUpperCase();

  if (category === 'BADMINTON') {
    const setIds = new Set((payload.attendanceIds || []).map((id) => String(id).trim()).filter(Boolean));
    let paidSum = 0;
    const updatedAtts: Attendance[] = [];

    for (const a of dataset.attendance) {
      if (a.session_type === 'BADMINTON' && setIds.has(a.attendance_id) && !a.is_paid) {
        paidSum += Number(a.fee_amount) || 0;
        updatedAtts.push({
          ...a,
          net_amount: 0,
          is_paid: true,
          paid_at: now,
          settlement_id: settlementId,
        });
      }
    }

    if (updatedAtts.length === 0) {
      throw new ApiClientError(
        'CONFLICT_LOCK',
        'Các khoản này đã được thanh toán trước đó hoặc không có khoản nợ hợp lệ để gạch nợ.',
        409
      );
    }

    const updatedAttIds = updatedAtts.map((a) => a.attendance_id);

    const settlement: Settlement = {
      settlement_id: settlementId,
      from_member_id: payload.fromMemberId,
      from_name: membersMap.get(payload.fromMemberId)?.name || payload.fromMemberId,
      to_member_id: payload.toMemberId,
      to_name: membersMap.get(payload.toMemberId)?.name || payload.toMemberId,
      amount: paidSum || Math.round(Number(payload.amount) || 0),
      settled_at: now,
      method: payload.method || 'VIETQR',
      category: 'BADMINTON',
      source_attendance_ids: updatedAttIds.join(','),
      source_ledger_ids: '',
      is_reconciled: true,
      transfer_content: payload.transferContent || '',
      note: payload.note || '',
      confirmed_by: editorEmail,
    };

    const plan: BatchMutationPlan<ConfirmPaymentResponse> = {
      upserts: {
        attendance: updatedAtts.map((a) => ({
          id: a.attendance_id,
          data: a as unknown as Record<string, unknown>,
        })),
        settlements: [
          { id: settlement.settlement_id, data: settlement as unknown as Record<string, unknown> },
        ],
      },
      deletes: {},
      result: { settlement, updatedDebts: { treasurerMemberId: '', badminton: {} as SeparatedDebtsData['badminton'], drinking: {} as SeparatedDebtsData['drinking'] } },
    };
    const nextDataset = applyMutationPlanToDataset(dataset, plan);
    plan.result.updatedDebts = buildDebtsData(nextDataset);
    return plan;
  }

  // DRINKING
  if (mode === 'ITEMS') {
    const setIds = new Set((payload.attendanceIds || []).map((id) => String(id).trim()).filter(Boolean));
    let totalPaid = 0;
    const affectedSessionIds = new Set<string>();
    const paidDebtorIds: string[] = [];

    for (const a of dataset.attendance) {
      const rawNet = Math.round(Number(a.net_amount) || 0);
      const fallbackFee = rawNet === 0 ? Math.round(Number(a.fee_amount) || 0) : 0;
      const payableAmt = rawNet > 0 ? rawNet : fallbackFee;
      if (a.session_type === 'DRINKING' && setIds.has(a.attendance_id) && !a.is_paid && payableAmt > 0) {
        totalPaid += payableAmt;
        paidDebtorIds.push(a.attendance_id);
        if (a.session_id) affectedSessionIds.add(a.session_id);
      }
    }

    if (paidDebtorIds.length === 0) {
      throw new ApiClientError(
        'CONFLICT_LOCK',
        'Các khoản này đã được thanh toán trước đó hoặc không phải khoản nợ hợp lệ.',
        409
      );
    }

    const validDebtorSet = new Set(paidDebtorIds);
    const updatedAtts: Attendance[] = [];
    for (const sid of affectedSessionIds) {
      const sessRows = dataset.attendance.filter((a) => a.session_id === sid && a.session_type === 'DRINKING');
      const nextSessRows = applyDrinkingItemsPaymentToRows(
        sessRows,
        sid,
        validDebtorSet,
        payload.toMemberId,
        settlementId,
        now
      );
      const beforeById = new Map(sessRows.map((r) => [r.attendance_id, r]));
      for (const r of nextSessRows) {
        const prev = beforeById.get(r.attendance_id);
        if (
          !prev ||
          prev.net_amount !== r.net_amount ||
          prev.is_paid !== r.is_paid ||
          prev.settlement_id !== r.settlement_id
        ) {
          updatedAtts.push(r);
        }
      }
    }

    const settlement: Settlement = {
      settlement_id: settlementId,
      from_member_id: payload.fromMemberId,
      from_name: membersMap.get(payload.fromMemberId)?.name || payload.fromMemberId,
      to_member_id: payload.toMemberId,
      to_name: membersMap.get(payload.toMemberId)?.name || payload.toMemberId,
      amount: totalPaid || Math.round(Number(payload.amount) || 0),
      settled_at: now,
      method: payload.method || 'VIETQR',
      category: 'DRINKING',
      source_attendance_ids: paidDebtorIds.join(','),
      source_ledger_ids: '',
      is_reconciled: true,
      transfer_content: payload.transferContent || '',
      note: payload.note || '',
      confirmed_by: editorEmail,
    };

    const plan: BatchMutationPlan<ConfirmPaymentResponse> = {
      upserts: {
        attendance: updatedAtts.map((a) => ({
          id: a.attendance_id,
          data: a as unknown as Record<string, unknown>,
        })),
        settlements: [
          { id: settlement.settlement_id, data: settlement as unknown as Record<string, unknown> },
        ],
      },
      deletes: {},
      result: { settlement, updatedDebts: { treasurerMemberId: '', badminton: {} as SeparatedDebtsData['badminton'], drinking: {} as SeparatedDebtsData['drinking'] } },
    };
    const nextDataset = applyMutationPlanToDataset(dataset, plan);
    plan.result.updatedDebts = buildDebtsData(nextDataset);
    return plan;
  }

  // mode = SIMPLIFIED_TRANSFER
  const amount = Math.round(Number(payload.amount) || 0);
  if (amount <= 0) {
    throw new ApiClientError('BAD_REQUEST', 'Số tiền thanh toán phải lớn hơn 0.', 400);
  }

  const settlement: Settlement = {
    settlement_id: settlementId,
    from_member_id: payload.fromMemberId,
    from_name: membersMap.get(payload.fromMemberId)?.name || payload.fromMemberId,
    to_member_id: payload.toMemberId,
    to_name: membersMap.get(payload.toMemberId)?.name || payload.toMemberId,
    amount,
    settled_at: now,
    method: payload.method || 'VIETQR',
    category: 'DRINKING',
    source_attendance_ids: '',
    source_ledger_ids: '',
    is_reconciled: false,
    transfer_content: payload.transferContent || '',
    note: payload.note || '',
    confirmed_by: editorEmail,
  };

  const initialPlan: BatchMutationPlan<ConfirmPaymentResponse> = {
    upserts: {
      settlements: [
        { id: settlement.settlement_id, data: settlement as unknown as Record<string, unknown> },
      ],
    },
    deletes: {},
    result: { settlement, updatedDebts: { treasurerMemberId: '', badminton: {} as SeparatedDebtsData['badminton'], drinking: {} as SeparatedDebtsData['drinking'] } },
  };
  let nextDataset = applyMutationPlanToDataset(dataset, initialPlan);
  let debtsAfter = buildDebtsData(nextDataset);

  if (debtsAfter.drinking.simplifiedTransfers.length === 0) {
    const closedAtts: Attendance[] = nextDataset.attendance
      .filter((a) => a.session_type === 'DRINKING' && !a.is_paid)
      .map((a) => ({
        ...a,
        is_paid: true,
        paid_at: now,
        settlement_id: settlementId,
      }));
    const batchRaw = nextDataset.settlements.filter(
      (s) => (!s.category || String(s.category).trim().toUpperCase() === 'DRINKING') && !s.is_reconciled
    );
    const encodedBatch = encodeReconciledIds(batchRaw.map((s) => s.settlement_id));
    const reconciledSettlements: Settlement[] = batchRaw.map((s) => ({
      ...s,
      is_reconciled: true,
      source_ledger_ids:
        s.settlement_id === settlementId ? encodedBatch : s.source_ledger_ids,
    }));

    if (closedAtts.length > 0) {
      initialPlan.upserts.attendance = closedAtts.map((a) => ({
        id: a.attendance_id,
        data: a as unknown as Record<string, unknown>,
      }));
    }
    initialPlan.upserts.settlements = reconciledSettlements.map((s) => ({
      id: s.settlement_id,
      data: s as unknown as Record<string, unknown>,
    }));
    const updatedPrimary = reconciledSettlements.find((s) => s.settlement_id === settlementId);
    if (updatedPrimary) {
      initialPlan.result.settlement = updatedPrimary;
    }
    nextDataset = applyMutationPlanToDataset(dataset, initialPlan);
    debtsAfter = buildDebtsData(nextDataset);
  }

  initialPlan.result.updatedDebts = debtsAfter;
  return initialPlan;
}

export function planUndoSettlement(
  dataset: ClubDataset,
  settlementId: string
): BatchMutationPlan<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
  const st = dataset.settlements.find((s) => s.settlement_id === settlementId);
  if (!st) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy giao dịch thanh toán ${settlementId}`, 404);
  }

  const category = (st.category || 'DRINKING').toUpperCase();
  const sourceSet = new Set(
    String(st.source_attendance_ids || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
  const updatedAttMap = new Map<string, Attendance>();
  const updatedSettlements: Settlement[] = [];

  if (category === 'BADMINTON') {
    for (const a of dataset.attendance) {
      if (a.settlement_id === settlementId || sourceSet.has(a.attendance_id)) {
        const fee = Math.round(Number(a.fee_amount) || 0);
        updatedAttMap.set(a.attendance_id, {
          ...a,
          is_paid: false,
          paid_at: '',
          settlement_id: '',
          net_amount: fee,
        });
      }
    }
  } else if (sourceSet.size === 0) {
    // DRINKING SIMPLIFIED_TRANSFER:
    // - Nếu chưa đối soát (!st.is_reconciled): chỉ cần xóa bản ghi settlement
    // - Nếu đã chốt đợt: mở lại attendance gắn với giao dịch chốt đợt & trả các giao dịch còn lại về is_reconciled=false
    if (st.is_reconciled) {
      const ownBatchIds = parseReconciledIds(st.source_ledger_ids);
      const closingSt =
        ownBatchIds.length > 0
          ? st
          : dataset.settlements.find((s) => parseReconciledIds(s.source_ledger_ids).includes(settlementId));

      if (closingSt) {
        const batchIds = parseReconciledIds(closingSt.source_ledger_ids);
        for (const a of dataset.attendance) {
          if (a.settlement_id === closingSt.settlement_id) {
            updatedAttMap.set(a.attendance_id, {
              ...a,
              is_paid: false,
              paid_at: '',
              settlement_id: '',
            });
          }
        }
        for (const bId of batchIds) {
          if (bId === settlementId) continue;
          const bSt = dataset.settlements.find((s) => s.settlement_id === bId);
          if (bSt) {
            updatedSettlements.push({
              ...bSt,
              is_reconciled: false,
              source_ledger_ids: bSt.settlement_id === closingSt.settlement_id ? '' : bSt.source_ledger_ids,
            });
          }
        }
      } else {
        // Fallback cho dữ liệu cũ chưa gắn REC:
        for (const a of dataset.attendance) {
          if (a.settlement_id === settlementId) {
            updatedAttMap.set(a.attendance_id, {
              ...a,
              is_paid: false,
              paid_at: '',
              settlement_id: '',
            });
          }
        }
      }
    }
  } else {
    // DRINKING ITEMS: tính lại gốc buổi bị ảnh hưởng rồi replay các settlement ITEMS còn lại
    const affectedSessionIds = new Set<string>();
    for (const a of dataset.attendance) {
      if (a.settlement_id === settlementId || sourceSet.has(a.attendance_id)) {
        if (a.session_id) affectedSessionIds.add(a.session_id);
      }
    }

    if (affectedSessionIds.size > 0) {
      const membersMap = buildMembersMap(dataset.members);
      const unit = dataset.settings.rounding_unit || 1000;
      const now = nowIsoVN();

      const remainingItemSettlements = dataset.settlements
        .filter(
          (s) =>
            s.settlement_id !== settlementId &&
            (!s.category || String(s.category).trim().toUpperCase() === 'DRINKING') &&
            String(s.source_attendance_ids || '').trim() !== ''
        )
        .sort((a, b) => (a.settled_at || '').localeCompare(b.settled_at || ''));

      for (const sId of affectedSessionIds) {
        const sess = dataset.sessions.find((s) => s.session_id === sId);
        if (!sess) continue;
        const sessAtts = dataset.attendance.filter((a) => a.session_id === sId);
        if (sessAtts.length === 0) continue;
        const sessItems = dataset.session_items.filter((it) => it.session_id === sId);

        const recomputed = buildDrinkingSplitRows({
          sessionId: sId,
          dateStr: sess.date,
          attendeeIds: sessAtts.map((a) => a.member_id),
          rawItems: sessItems.map((it) => ({
            member_id: it.member_id,
            kind: it.kind,
            item_name: it.item_name,
            amount: it.amount,
          })),
          payerId: sess.payer_id,
          totalAmountFallback: sess.total_amount,
          roundingUnit: unit,
          membersMap,
          now,
        });

        const netByMember = new Map(recomputed.attendanceRows.map((r) => [r.member_id, r]));
        let workingRows: Attendance[] = sessAtts.map((a) => {
          const rRow = netByMember.get(a.member_id);
          if (!rRow) return { ...a };
          const isZero = rRow.net_amount === 0;
          return {
            ...a,
            net_amount: rRow.net_amount,
            is_paid: isZero,
            paid_at: isZero ? a.paid_at || now : '',
            settlement_id: '',
          };
        });

        for (const remSt of remainingItemSettlements) {
          const remAttSet = new Set(
            String(remSt.source_attendance_ids || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          );
          if (!workingRows.some((r) => remAttSet.has(r.attendance_id))) continue;
          workingRows = applyDrinkingItemsPaymentToRows(
            workingRows,
            sId,
            remAttSet,
            remSt.to_member_id,
            remSt.settlement_id,
            remSt.settled_at || now
          );
        }

        // Bảo toàn trạng thái nếu buổi đang nằm trong đợt chốt SIMPLIFIED_TRANSFER khác còn hiệu lực
        for (const r of workingRows) {
          const orig = sessAtts.find((o) => o.attendance_id === r.attendance_id);
          if (
            orig &&
            !r.is_paid &&
            orig.is_paid &&
            orig.settlement_id &&
            orig.settlement_id !== settlementId
          ) {
            const origSt = dataset.settlements.find((s) => s.settlement_id === orig.settlement_id);
            if (origSt && origSt.is_reconciled && !origSt.source_attendance_ids) {
              r.is_paid = true;
              r.paid_at = orig.paid_at;
              r.settlement_id = orig.settlement_id;
            }
          }
          updatedAttMap.set(r.attendance_id, r);
        }
      }
    }
  }

  const upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>> = {};
  if (updatedAttMap.size > 0) {
    upserts.attendance = Array.from(updatedAttMap.values()).map((a) => ({
      id: a.attendance_id,
      data: a as unknown as Record<string, unknown>,
    }));
  }
  if (updatedSettlements.length > 0) {
    upserts.settlements = updatedSettlements.map((s) => ({
      id: s.settlement_id,
      data: s as unknown as Record<string, unknown>,
    }));
  }

  const plan: BatchMutationPlan<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> = {
    upserts,
    deletes: { settlements: [settlementId] },
    result: {
      undoneSettlementId: settlementId,
      updatedDebts: {
        treasurerMemberId: '',
        badminton: {} as SeparatedDebtsData['badminton'],
        drinking: {} as SeparatedDebtsData['drinking'],
      },
    },
  };

  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result.updatedDebts = buildDebtsData(nextDataset);
  return plan;
}

export function planGenerateSchedule(
  dataset: ClubDataset,
  payload: GenerateSchedulePayload
): BatchMutationPlan<ScheduleData> {
  const monthStr = String(payload.month || getTodayDateStr().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    throw new ApiClientError('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.', 400);
  }

  const dates = generateMonthScheduleDates(monthStr, payload.weekdays, payload.fromDate);
  const existingDates = new Set(
    dataset.schedule.filter((d) => d.date.slice(0, 7) === monthStr).map((d) => d.date)
  );
  const fixedByDate = new Map<string, Session>();
  for (const s of dataset.sessions) {
    if (s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC' && s.date.slice(0, 7) === monthStr) {
      if (!fixedByDate.has(s.date)) fixedByDate.set(s.date, s);
    }
  }

  const now = nowIsoVN();
  const toCreate: Array<ScheduleDay & { month: string }> = [];
  for (const d of dates) {
    if (existingDates.has(d)) continue;
    const matched = fixedByDate.get(d);
    toCreate.push({
      plan_id: generateEntityId('PLN', d.slice(8, 10)),
      date: d,
      month: monthStr,
      start_time: payload.startTime || '20:00',
      end_time: payload.endTime || '21:30',
      courts: Math.max(1, Math.round(Number(payload.courts) || 2)),
      planned_member_ids: (payload.plannedMemberIds || []).join(','),
      status: matched ? 'DONE' : 'PLANNED',
      session_id: matched?.session_id || '',
      note: payload.note || '',
      created_at: now,
      updated_at: now,
    });
  }

  const plan: BatchMutationPlan<ScheduleData> = {
    upserts: toCreate.length > 0
      ? {
          schedule: toCreate.map((row) => ({
            id: row.plan_id,
            data: row as unknown as Record<string, unknown>,
          })),
        }
      : {},
    deletes: {},
    result: { month: monthStr, days: [] },
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = buildScheduleData(nextDataset, monthStr);
  return plan;
}

export function planUpdateScheduleDay(
  dataset: ClubDataset,
  payload: UpdateScheduleDayPayload
): BatchMutationPlan<{ schedule?: ScheduleData; deletedPlanId?: string }> {
  const now = nowIsoVN();
  if (payload.operation === 'DELETE') {
    if (!payload.planId) {
      throw new ApiClientError('BAD_REQUEST', 'Thiếu planId để xóa lịch.', 400);
    }
    return {
      upserts: {},
      deletes: { schedule: [payload.planId] },
      result: { deletedPlanId: payload.planId },
    };
  }

  const dateStr = String(payload.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ApiClientError('BAD_REQUEST', 'date phải đúng định dạng YYYY-MM-DD.', 400);
  }
  const monthStr = dateStr.slice(0, 7);
  const existing = payload.planId
    ? dataset.schedule.find((d) => d.plan_id === payload.planId)
    : undefined;

  const row: ScheduleDay & { month: string } = existing
    ? {
        ...existing,
        date: dateStr,
        month: monthStr,
        start_time: payload.startTime || existing.start_time,
        end_time: payload.endTime || existing.end_time,
        courts:
          payload.courts !== undefined
            ? Math.max(1, Math.round(Number(payload.courts) || 2))
            : existing.courts,
        planned_member_ids:
          payload.plannedMemberIds !== undefined
            ? payload.plannedMemberIds.join(',')
            : existing.planned_member_ids,
        status: payload.status || existing.status,
        note: payload.note !== undefined ? payload.note : existing.note,
        updated_at: now,
      }
    : {
        plan_id: payload.planId || generateEntityId('PLN'),
        date: dateStr,
        month: monthStr,
        start_time: payload.startTime || '20:00',
        end_time: payload.endTime || '21:30',
        courts: Math.max(1, Math.round(Number(payload.courts) || 2)),
        planned_member_ids: (payload.plannedMemberIds || []).join(','),
        status: payload.status || 'PLANNED',
        session_id: '',
        note: payload.note || '',
        created_at: now,
        updated_at: now,
      };

  const plan: BatchMutationPlan<{ schedule?: ScheduleData; deletedPlanId?: string }> = {
    upserts: {
      schedule: [{ id: row.plan_id, data: row as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: {},
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = { schedule: buildScheduleData(nextDataset, monthStr) };
  return plan;
}

export function planIssueMonthlyBill(
  dataset: ClubDataset,
  payload: IssueMonthlyBillPayload,
  editorEmail: string
): BatchMutationPlan<MonthlyBillData> {
  const targetMonth = String(payload.month || getTodayDateStr().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new ApiClientError('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.', 400);
  }

  const mainMembers = dataset.members.filter((m) => m.is_active && m.type === 'MAIN');
  const memberIds =
    payload.memberIds && payload.memberIds.length > 0
      ? Array.from(new Set(payload.memberIds.map((id) => String(id).trim()).filter(Boolean)))
      : mainMembers.map((m) => m.member_id);
  if (memberIds.length === 0) {
    throw new ApiClientError('BAD_REQUEST', 'Không có thành viên chính (MAIN) nào để chia tiền tháng.', 400);
  }

  const membersForCalc = [...dataset.members];
  const updatedMembers: Member[] = [];
  const now = nowIsoVN();
  if (payload.syncMemberTypes) {
    const selectedSet = new Set(memberIds);
    for (let i = 0; i < membersForCalc.length; i++) {
      const m = membersForCalc[i];
      if (!m.is_active) continue;
      const targetType: Member['type'] = selectedSet.has(m.member_id) ? 'MAIN' : 'GUEST';
      if (m.type !== targetType) {
        const updatedM: Member = { ...m, type: targetType, updated_at: now };
        membersForCalc[i] = updatedM;
        updatedMembers.push(updatedM);
      }
    }
  }

  const membersMap = buildMembersMap(membersForCalc);
  const current = buildMonthlyBillData(
    updatedMembers.length > 0 ? { ...dataset, members: membersForCalc } : dataset,
    targetMonth
  );
  const carryIn =
    payload.carryIn !== undefined ? Math.round(Number(payload.carryIn) || 0) : current.bill.carry_in;

  const appliedCredits = normalizeContributionsList(
    payload.appliedCredits ?? current.prevMonthContributions,
    membersMap,
    now
  );
  const courtFee = Math.max(0, Math.round(Number(payload.courtFee ?? 0) || 0));
  const shuttleTubeQty = Math.max(0, Number(payload.shuttleTubeQty) || 0);
  const shuttleTubePrice = Math.max(0, Math.round(Number(payload.shuttleTubePrice) || 0));
  const shuttleTubeAmount =
    payload.shuttleTubeAmount !== undefined
      ? Math.max(0, Math.round(Number(payload.shuttleTubeAmount) || 0))
      : Math.round(shuttleTubeQty * shuttleTubePrice);
  const prevOvertimeFee = Math.max(0, Math.round(Number(payload.prevOvertimeFee) || 0));
  const hasExplicitEstimate =
    payload.estimate !== undefined &&
    payload.estimate !== null &&
    String(payload.estimate).trim() !== '';

  const previewCalc = calculateDetailedMonthlyBill({
    courtFee,
    shuttleTubeQty,
    shuttleTubePrice,
    shuttleAmountOverride: payload.shuttleTubeAmount !== undefined,
    manualShuttleAmount: shuttleTubeAmount,
    prevOvertimeFee,
    venueTotalOverride: hasExplicitEstimate,
    manualVenueTotal: hasExplicitEstimate ? payload.estimate : undefined,
    carryIn,
    memberIds,
    appliedCredits,
    roundingUnit: dataset.settings.rounding_unit,
    actualCost: current.bill.actual_cost,
    guestIncome: current.bill.guest_income,
  });

  const existingBill = dataset.monthly_bills.find((b) => b.month === targetMonth);
  const hasExistingOverride =
    existingBill &&
    existingBill.actual_cost_override !== null &&
    existingBill.actual_cost_override !== undefined &&
    String(existingBill.actual_cost_override) !== '';
  const existingActualOverride = hasExistingOverride
    ? Number(existingBill.actual_cost_override)
    : null;
  const nextIsProjected =
    existingActualOverride === null &&
    previewCalc.venueTotal > 0 &&
    (current.bill.logged_sessions_cost ?? 0) < previewCalc.venueTotal;
  const nextActualCost =
    existingActualOverride !== null
      ? existingActualOverride
      : nextIsProjected
        ? previewCalc.venueTotal
        : (current.bill.logged_sessions_cost ?? 0);

  const detailed = calculateDetailedMonthlyBill({
    courtFee,
    shuttleTubeQty,
    shuttleTubePrice,
    shuttleAmountOverride: payload.shuttleTubeAmount !== undefined,
    manualShuttleAmount: shuttleTubeAmount,
    prevOvertimeFee,
    venueTotalOverride: hasExplicitEstimate,
    manualVenueTotal: hasExplicitEstimate ? payload.estimate : undefined,
    carryIn,
    memberIds,
    appliedCredits,
    roundingUnit: dataset.settings.rounding_unit,
    actualCost: nextActualCost,
    guestIncome: current.bill.guest_income,
  });

  const existingDues = dataset.monthly_dues.filter((d) => d.month === targetMonth);
  const oldDueByMember = new Map(existingDues.map((d) => [d.member_id, d]));
  const oldPaidMap = new Map(
    existingDues.filter((d) => d.is_paid).map((d) => [d.member_id, d])
  );
  const todayDate = now.slice(0, 10);

  const nextDues: MonthlyDue[] = detailed.memberDues.map((line, i) => {
    const oldDue = oldDueByMember.get(line.memberId);
    const oldPaid = oldPaidMap.get(line.memberId);
    const oldPaidAmount = oldPaid ? Math.round(Number(oldPaid.amount) || 0) : 0;
    const isExactMatch = Boolean(oldPaid && (oldPaidAmount === line.netAmount || line.netAmount === 0));
    const isPaid = isExactMatch || line.netAmount === 0;
    let creditNote = line.creditNote;
    if (oldPaid && !isExactMatch) {
      const diff = line.netAmount - oldPaidAmount;
      const diffNote =
        diff > 0
          ? `Đã đóng trước ${oldPaidAmount.toLocaleString('vi-VN')}đ — thiếu thêm ${diff.toLocaleString('vi-VN')}đ`
          : `Đã đóng trước ${oldPaidAmount.toLocaleString('vi-VN')}đ — dư ${(-diff).toLocaleString('vi-VN')}đ cần hoàn`;
      creditNote = creditNote ? `${creditNote} • ${diffNote}` : diffNote;
    }
    return {
      due_id: generateEntityId('DUE', String(i)),
      month: targetMonth,
      member_id: line.memberId,
      member_name: membersMap.get(line.memberId)?.name || line.memberId,
      amount: line.netAmount,
      base_amount: line.baseAmount,
      credit_amount: line.creditAmount,
      credit_note: creditNote,
      issued_at: oldDue?.issued_at || todayDate,
      is_paid: isPaid,
      paid_at: isExactMatch ? oldPaid?.paid_at || now : line.netAmount === 0 ? now : '',
      confirmed_by: isExactMatch
        ? oldPaid?.confirmed_by || editorEmail
        : line.netAmount === 0
        ? editorEmail
        : '',
    };
  });

  const carryOverCredits: ShuttleContributionItem[] = detailed.carryOverCredits.map((c) => ({
    ...c,
    id: `CARRY_${targetMonth}_${c.member_id}`,
    member_name: membersMap.get(c.member_id)?.name || c.member_id,
    note: `Dư góp cầu T${targetMonth.slice(5, 7)} chuyển sang`,
    created_at: now,
  }));

  const refundCredits: ShuttleContributionItem[] = detailed.refundCredits.map((r) => ({
    ...r,
    member_name: membersMap.get(r.member_id)?.name || r.member_name || r.member_id,
    created_at: now,
  }));

  const nextBill: MonthlyBill = {
    month: targetMonth,
    estimate: detailed.venueTotal,
    carry_in: detailed.carryIn,
    to_collect: detailed.toCollect,
    member_count: detailed.memberCount,
    per_member: detailed.perMember,
    billed_total: detailed.billedTotal,
    actual_cost: detailed.actualCost,
    actual_cost_override: existingBill ? existingBill.actual_cost_override : null,
    guest_income: detailed.guestIncome,
    carry_out: detailed.carryOut,
    status: 'OPEN',
    created_by: existingBill?.created_by || editorEmail,
    closed_at: '',
    updated_at: now,
    court_fee: courtFee,
    shuttle_tube_qty: shuttleTubeQty,
    shuttle_tube_price: shuttleTubePrice,
    shuttle_tube_amount: shuttleTubeAmount,
    prev_overtime_fee: prevOvertimeFee,
    bill_detail: JSON.stringify({
      ...(payload.billDetail || {}),
      appliedCredits,
      refundCredits,
      refundCreditsTotal: detailed.refundCreditsTotal,
    }),
    shuttle_contributions: existingBill?.shuttle_contributions || '[]',
    applied_credits_total: detailed.appliedCreditsTotal,
    refund_credits_total: detailed.refundCreditsTotal,
    carry_over_credits: JSON.stringify(carryOverCredits),
  };

  const scheduleUpserts: Array<{ id: string; data: Record<string, unknown> }> = [];
  const sc = payload.scheduleConfig;
  if (sc && Array.isArray(sc.weekdays) && sc.weekdays.length > 0) {
    const genDates = generateMonthScheduleDates(targetMonth, sc.weekdays, sc.fromDate);
    const existingDates = new Set(
      dataset.schedule.filter((d) => d.date.slice(0, 7) === targetMonth).map((d) => d.date)
    );
    const fixedByDate = new Map<string, Session>();
    for (const s of dataset.sessions) {
      if (s.type === 'BADMINTON' && s.billing_mode !== 'AD_HOC' && s.date.slice(0, 7) === targetMonth) {
        if (!fixedByDate.has(s.date)) fixedByDate.set(s.date, s);
      }
    }
    const courtsNum = Math.max(1, Math.round(Number(sc.courts) || dataset.settings.default_court_count || 2));
    const sTime = sc.startTime || '20:00';
    const eTime = sc.endTime || '21:30';
    const plannedCsv = memberIds.join(',');

    for (const d of genDates) {
      if (existingDates.has(d)) continue;
      const matched = fixedByDate.get(d);
      const newPlan: ScheduleDay & { month: string } = {
        plan_id: generateEntityId('PLN', d.slice(8, 10)),
        date: d,
        month: targetMonth,
        start_time: sTime,
        end_time: eTime,
        courts: courtsNum,
        planned_member_ids: plannedCsv,
        status: matched ? 'DONE' : 'PLANNED',
        session_id: matched?.session_id || '',
        note: '',
        created_at: now,
        updated_at: now,
      };
      scheduleUpserts.push({
        id: newPlan.plan_id,
        data: newPlan as unknown as Record<string, unknown>,
      });
    }

    for (const row of dataset.schedule) {
      if (row.date.slice(0, 7) === targetMonth && row.status === 'PLANNED') {
        const updatedPlan: ScheduleDay & { month: string } = {
          ...row,
          month: targetMonth,
          planned_member_ids: plannedCsv,
          updated_at: now,
        };
        scheduleUpserts.push({
          id: updatedPlan.plan_id,
          data: updatedPlan as unknown as Record<string, unknown>,
        });
      }
    }
  }

  const upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>> = {
    monthly_bills: [{ id: targetMonth, data: nextBill as unknown as Record<string, unknown> }],
    monthly_dues: nextDues.map((d) => ({
      id: d.due_id,
      data: d as unknown as Record<string, unknown>,
    })),
  };
  if (updatedMembers.length > 0) {
    upserts.members = updatedMembers.map((m) => ({
      id: m.member_id,
      data: toPublicMemberRecord(m) as unknown as Record<string, unknown>,
    }));
  }
  if (scheduleUpserts.length > 0) {
    upserts.schedule = scheduleUpserts;
  }

  const plan: BatchMutationPlan<MonthlyBillData> = {
    upserts,
    deletes: {
      monthly_dues: existingDues.map((d) => d.due_id),
    },
    result: current,
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = buildMonthlyBillData(nextDataset, targetMonth);
  return plan;
}

export function planSaveMonthlyContributions(
  dataset: ClubDataset,
  payload: SaveMonthlyContributionsPayload,
  editorEmail: string
): BatchMutationPlan<MonthlyBillData> {
  const targetMonth = String(payload.month || getTodayDateStr().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new ApiClientError('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.', 400);
  }
  const now = nowIsoVN();
  const membersMap = buildMembersMap(dataset.members);
  const normalized = normalizeContributionsList(payload.contributions || [], membersMap, now);
  const serialized = JSON.stringify(normalized);

  const existing = dataset.monthly_bills.find((b) => b.month === targetMonth);
  const current = buildMonthlyBillData(dataset, targetMonth);
  const nextBill: MonthlyBill = stripTransientMonthlyBillFields(
    existing
      ? {
          ...existing,
          shuttle_contributions: serialized,
          updated_at: now,
        }
      : {
          ...current.bill,
          created_by: editorEmail,
          updated_at: now,
          shuttle_contributions: serialized,
        }
  );

  const plan: BatchMutationPlan<MonthlyBillData> = {
    upserts: {
      monthly_bills: [{ id: targetMonth, data: nextBill as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: current,
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = buildMonthlyBillData(nextDataset, targetMonth);
  return plan;
}

export function planMarkDuePaid(
  dataset: ClubDataset,
  payload: MarkDuePaidPayload,
  editorEmail: string
): BatchMutationPlan<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
  const due = dataset.monthly_dues.find((d) => d.due_id === payload.dueId);
  if (!due) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy khoản thu ${payload.dueId}`, 404);
  }
  const nextPaid = payload.isPaid ?? true;
  const now = nowIsoVN();
  const updatedDue: MonthlyDue = {
    ...due,
    is_paid: nextPaid,
    paid_at: nextPaid ? now : '',
    confirmed_by: nextPaid ? editorEmail : '',
  };

  const plan: BatchMutationPlan<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> = {
    upserts: {
      monthly_dues: [{ id: updatedDue.due_id, data: updatedDue as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: {
      monthlyBill: {} as MonthlyBillData,
      debts: {} as SeparatedDebtsData,
    },
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = {
    monthlyBill: buildMonthlyBillData(nextDataset, due.month),
    debts: buildDebtsData(nextDataset),
  };
  return plan;
}

export function planCloseMonth(
  dataset: ClubDataset,
  payload: CloseMonthPayload,
  editorEmail: string
): BatchMutationPlan<MonthlyBillData> {
  const targetMonth = String(payload.month || getTodayDateStr().slice(0, 7)).trim();
  const current = buildMonthlyBillData(dataset, targetMonth);
  const existing = dataset.monthly_bills.find((b) => b.month === targetMonth);

  let parsedDetail: MonthlyBillDetail = {};
  const rawDetail = existing?.bill_detail || current.bill.bill_detail;
  if (rawDetail) {
    try {
      const parsed = JSON.parse(rawDetail);
      if (parsed && typeof parsed === 'object') {
        parsedDetail = parsed as MonthlyBillDetail;
      }
    } catch {
      parsedDetail = {};
    }
  }

  const hasCarryOutOverride =
    payload.carryOutOverride !== undefined &&
    payload.carryOutOverride !== null &&
    String(payload.carryOutOverride).trim() !== '' &&
    Number.isFinite(Number(payload.carryOutOverride));
  const hasActualOverride =
    payload.actualCostOverride !== undefined &&
    payload.actualCostOverride !== null &&
    String(payload.actualCostOverride).trim() !== '';
  const actualCostOverride = hasActualOverride
    ? Math.max(0, Math.round(Number(payload.actualCostOverride) || 0))
    : null;

  let actualCost = current.bill.actual_cost;
  let carryOut: number;
  let nextActualCostOverride = existing?.actual_cost_override ?? current.bill.actual_cost_override ?? null;

  if (hasCarryOutOverride) {
    carryOut = Math.round(Number(payload.carryOutOverride));
    parsedDetail = { ...parsedDetail, carryOutOverride: carryOut };
  } else {
    actualCost = actualCostOverride !== null ? actualCostOverride : current.bill.actual_cost;
    carryOut =
      current.bill.carry_in +
      current.bill.billed_total +
      current.bill.guest_income -
      actualCost -
      (current.bill.refund_credits_total || 0);
    nextActualCostOverride = actualCostOverride;
    if ('carryOutOverride' in parsedDetail) {
      const { carryOutOverride: _removed, ...rest } = parsedDetail;
      parsedDetail = rest;
    }
  }

  const now = nowIsoVN();
  const nextBillDetailStr = Object.keys(parsedDetail).length > 0 ? JSON.stringify(parsedDetail) : '';

  const closedBill: MonthlyBill = stripTransientMonthlyBillFields({
    ...(existing || current.bill),
    actual_cost: actualCost,
    actual_cost_override: nextActualCostOverride,
    guest_income: current.bill.guest_income,
    carry_out: carryOut,
    bill_detail: nextBillDetailStr,
    status: 'CLOSED',
    created_by: existing?.created_by || current.bill.created_by || editorEmail,
    closed_at: now,
    updated_at: now,
  });

  const plan: BatchMutationPlan<MonthlyBillData> = {
    upserts: {
      monthly_bills: [{ id: targetMonth, data: closedBill as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: current,
  };
  const nextDataset = applyMutationPlanToDataset(dataset, plan);
  plan.result = buildMonthlyBillData(nextDataset, targetMonth);
  return plan;
}

export function planLinkMemberEmail(
  dataset: ClubDataset,
  memberId: string,
  userEmail: string
): BatchMutationPlan<{ linkedMemberId: string; email: string }> {
  const email = String(userEmail || '').trim().toLowerCase();
  const cleanId = String(memberId || '').trim();
  if (!cleanId) throw new ApiClientError('BAD_REQUEST', 'Thiếu memberId cần liên kết.', 400);
  if (!email) throw new ApiClientError('UNAUTHORIZED', 'Thiếu email tài khoản Google.', 401);

  const target = dataset.members.find((m) => m.member_id === cleanId);
  if (!target) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${cleanId}`, 404);
  }
  const privByMemberId = new Map<string, MemberPrivateRecord>(
    (dataset.members_private || []).map((p) => [p.member_id, p])
  );
  const currentTargetEmail = String(
    privByMemberId.get(cleanId)?.email ?? target.email ?? ''
  )
    .trim()
    .toLowerCase();
  if (currentTargetEmail && currentTargetEmail !== email) {
    throw new ApiClientError(
      'BAD_REQUEST',
      `Thành viên ${target.name} đã được liên kết với tài khoản Google khác.`,
      400
    );
  }

  const now = nowIsoVN();
  const memberUpdates: MutationUpsertItem[] = [];
  const privateUpdates: MutationUpsertItem[] = [];

  // Gỡ liên kết cũ của chính userEmail nếu trước đó gắn nhầm thành viên khác
  for (const m of dataset.members) {
    const mPriv = privByMemberId.get(m.member_id);
    const mEmail = String(mPriv?.email ?? m.email ?? '').trim().toLowerCase();
    if (mEmail === email && m.member_id !== cleanId) {
      memberUpdates.push({
        id: m.member_id,
        data: toPublicMemberRecord(m, false) as unknown as Record<string, unknown>,
      });
      privateUpdates.push({
        id: m.member_id,
        data: {
          member_id: m.member_id,
          phone: mPriv?.phone ?? m.phone ?? '',
          email: '',
          updated_at: now,
        },
      });
    }
  }

  const targetPriv = privByMemberId.get(cleanId);
  memberUpdates.push({
    id: target.member_id,
    data: toPublicMemberRecord(target, true) as unknown as Record<string, unknown>,
  });
  privateUpdates.push({
    id: target.member_id,
    data: {
      member_id: target.member_id,
      phone: targetPriv?.phone ?? target.phone ?? '',
      email,
      updated_at: now,
    },
  });

  return {
    upserts: {
      members: memberUpdates,
      members_private: privateUpdates,
    },
    deletes: {},
    result: { linkedMemberId: cleanId, email },
  };
}

export function planUpsertMember(
  dataset: ClubDataset,
  payload: UpsertMemberPayload
): BatchMutationPlan<{ member: Member }> {
  const name = String(payload.name || '').trim();
  if (!name) {
    throw new ApiClientError('BAD_REQUEST', 'Tên thành viên không được để trống.', 400);
  }

  const now = nowIsoVN();
  const type = payload.type === 'GUEST' ? 'GUEST' : 'MAIN';
  const memberId = String(payload.memberId || '').trim();

  if (!memberId) {
    const phone = String(payload.phone || '').trim();
    const member: Member = {
      member_id: generateEntityId('MEM'),
      name,
      aliases: String(payload.aliases || '').trim(),
      type,
      phone,
      bank_bin: String(payload.bankBin || '').trim(),
      bank_name: String(payload.bankName || '').trim(),
      account_no: String(payload.accountNo || '').trim(),
      account_name: String(payload.accountName || '').trim().toUpperCase(),
      email: '',
      has_email: false,
      is_active: payload.isActive ?? true,
      created_at: now,
      updated_at: now,
    };
    return {
      upserts: {
        members: [{ id: member.member_id, data: toPublicMemberRecord(member, false) as unknown as Record<string, unknown> }],
        members_private: [
          {
            id: member.member_id,
            data: {
              member_id: member.member_id,
              phone,
              email: '',
              updated_at: now,
            },
          },
        ],
      },
      deletes: {},
      result: { member },
    };
  }

  const existing = dataset.members.find((m) => m.member_id === memberId);
  if (!existing) {
    throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${memberId}`, 404);
  }
  const existingPriv = (dataset.members_private || []).find((p) => p.member_id === memberId);
  const preservedEmail = String(existingPriv?.email ?? existing.email ?? '').trim().toLowerCase();
  const nextPhone =
    payload.phone !== undefined
      ? String(payload.phone).trim()
      : String(existingPriv?.phone ?? existing.phone ?? '').trim();

  const updated: Member = {
    ...existing,
    name,
    aliases: payload.aliases !== undefined ? String(payload.aliases).trim() : existing.aliases,
    type,
    phone: nextPhone,
    email: preservedEmail,
    has_email: Boolean(preservedEmail || existing.has_email),
    bank_bin: payload.bankBin !== undefined ? String(payload.bankBin).trim() : existing.bank_bin,
    bank_name: payload.bankName !== undefined ? String(payload.bankName).trim() : existing.bank_name,
    account_no: payload.accountNo !== undefined ? String(payload.accountNo).trim() : existing.account_no,
    account_name: (payload.accountName !== undefined
      ? String(payload.accountName).trim()
      : existing.account_name
    ).toUpperCase(),
    is_active: payload.isActive ?? existing.is_active,
    updated_at: now,
  };

  return {
    upserts: {
      members: [{ id: updated.member_id, data: toPublicMemberRecord(updated, Boolean(preservedEmail || existing.has_email)) as unknown as Record<string, unknown> }],
      members_private: [
        {
          id: updated.member_id,
          data: {
            member_id: updated.member_id,
            phone: nextPhone,
            email: preservedEmail,
            updated_at: now,
          },
        },
      ],
    },
    deletes: {},
    result: { member: updated },
  };
}

export function planUpdateSettings(
  dataset: ClubDataset,
  payload: UpdateSettingsPayload,
  editorEmail: string
): BatchMutationPlan<{ settings: SettingsMap }> {
  const incoming = payload.settings || {};
  const keys = Object.keys(incoming);
  if (keys.length === 0) {
    throw new ApiClientError('BAD_REQUEST', 'Không có khóa cấu hình nào để cập nhật.', 400);
  }

  const now = nowIsoVN();
  const baseRows = settingsMapToRows(dataset.settings, editorEmail, now);
  const rowMap = new Map<string, SettingRow>(baseRows.map((r) => [r.key, { ...r }]));

  for (const key of keys) {
    const rawVal = incoming[key];
    if (rawVal === undefined) continue;
    const prev = rowMap.get(key);
    rowMap.set(key, {
      key,
      value: String(rawVal ?? ''),
      description: prev?.description || DEFAULT_SETTING_DESCRIPTIONS[key] || '',
      updated_at: now,
      updated_by: editorEmail,
    });
  }

  const nextRows = Array.from(rowMap.values());
  const nextSettings = buildSettingsMapFromRows(nextRows);

  return {
    upserts: {
      settings: [{ id: 'club', data: nextSettings as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: { settings: nextSettings },
  };
}

export function planManageEditors(
  dataset: ClubDataset,
  payload: ManageEditorsPayload,
  actorEmail: string,
  actorRole: EditorRole
): BatchMutationPlan<Editor[]> {
  if (actorRole !== 'ADMIN') {
    throw new ApiClientError(
      'FORBIDDEN',
      'Chỉ tài khoản có vai trò ADMIN mới được quản lý danh sách Editors.',
      403
    );
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw new ApiClientError('BAD_REQUEST', 'Thiếu email của Editor.', 400);

  if (payload.operation === 'DELETE') {
    if (email === actorEmail.trim().toLowerCase()) {
      throw new ApiClientError(
        'BAD_REQUEST',
        'Không thể tự xóa chính tài khoản ADMIN đang đăng nhập.',
        400
      );
    }
    const nextList = dataset.editors.filter((e) => e.email.toLowerCase() !== email);
    return {
      upserts: {},
      deletes: { editors: [email] },
      result: nextList,
    };
  }

  const existing = dataset.editors.find((e) => e.email.toLowerCase() === email);
  const role: EditorRole =
    payload.role === 'ADMIN' || payload.role === 'EDITOR'
      ? payload.role
      : existing?.role || 'EDITOR';

  const nextEditor: Editor = existing
    ? {
        ...existing,
        email,
        name:
          payload.operation !== 'TOGGLE_ACTIVE' && payload.name !== undefined
            ? String(payload.name).trim() || email
            : existing.name,
        role: payload.operation !== 'TOGGLE_ACTIVE' ? role : existing.role,
        is_active: payload.isActive ?? existing.is_active,
      }
    : {
        email,
        name: String(payload.name || email).trim(),
        role,
        is_active: payload.isActive ?? true,
        added_at: nowIsoVN(),
      };

  const nextList = existing
    ? dataset.editors.map((e) => (e.email.toLowerCase() === email ? nextEditor : e))
    : [...dataset.editors, nextEditor];

  return {
    upserts: {
      editors: [{ id: email, data: nextEditor as unknown as Record<string, unknown> }],
    },
    deletes: {},
    result: nextList,
  };
}
