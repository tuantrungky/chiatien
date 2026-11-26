/**
 * Schema 11 tabs Google Sheets & API Contract giữa Frontend và GAS Backend
 */

export type MemberType = 'MAIN' | 'GUEST';
export type SessionType = 'BADMINTON' | 'DRINKING';
export type BadmintonBillingMode = 'MONTHLY' | 'AD_HOC';
export type DrinkingVenueType = 'RESTAURANT' | 'HOME';
export type SessionItemKind = 'BILL' | 'ITEM';
export type ScheduleStatus = 'PLANNED' | 'DONE' | 'CANCELLED';
export type MonthlyBillStatus = 'OPEN' | 'CLOSED';
export type PaymentMethod = 'VIETQR' | 'CASH' | 'BANK_TRANSFER';
export type EditorRole = 'ADMIN' | 'EDITOR';
export type PeriodType = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'ALL';

// Giữ các type FundLedger để đọc dữ liệu lịch sử (không tham gia tính công nợ mới)
export type FundLedgerType = 'INCOME' | 'EXPENSE';
export type FundLedgerCategory =
  | 'MONTHLY_FUND'
  | 'GUEST_FEE'
  | 'OTHER_INCOME'
  | 'COURT'
  | 'SHUTTLECOCK'
  | 'WATER'
  | 'OTHER_EXPENSE';

// ============================================================================
// 1. SCHEMA GOOGLE SHEETS (11 TABS)
// ============================================================================

export interface Member {
  member_id: string;
  name: string;
  aliases: string;
  type: MemberType;
  phone: string;
  bank_bin: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CourtLineItem {
  label: string;
  courts: number;
  hours: number;
  pricePerHour: number;
  amount?: number;
  isExtra?: boolean;
}

export interface BadmintonCostDetail {
  courtLines: CourtLineItem[];
  shuttlePrice: number;
  courtOverride: boolean;
  shuttleOverride: boolean;
  totalOverride: boolean;
}

export interface Session {
  session_id: string;
  date: string; // YYYY-MM-DD
  type: SessionType;
  title: string;
  total_amount: number;
  guest_fee: number;
  payer_id: string;
  payer_name?: string;
  per_person_amount: number;
  attendee_count: number;
  receipt_drive_id: string;
  receipt_url: string;
  receipt_summary: string;
  note: string;
  court_amount: number;
  shuttle_qty: number;
  shuttle_amount: number;
  other_amount: number;
  cost_detail: string; // JSON stringified BadmintonCostDetail
  venue_type: DrinkingVenueType | '';
  plan_id: string;
  billing_mode?: BadmintonBillingMode;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SessionItem {
  item_id: string;
  session_id: string;
  member_id: string;
  member_name?: string;
  kind: SessionItemKind;
  item_name: string;
  amount: number;
}

export interface Attendance {
  attendance_id: string;
  session_id: string;
  session_date: string; // YYYY-MM-DD
  session_type: SessionType;
  member_id: string;
  member_name?: string;
  member_type_snapshot: MemberType;
  fee_amount: number;
  creditor_id: string;
  creditor_name?: string;
  contributed_amount: number;
  net_amount: number; // + phải trả thêm, - được nhận lại (DRINKING) hoặc phí vãng lai (BADMINTON GUEST)
  is_paid: boolean;
  paid_at: string;
  settlement_id: string;
  note: string;
}

export interface ScheduleDay {
  plan_id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  courts: number;
  planned_member_ids: string; // comma-separated member_ids
  status: ScheduleStatus;
  session_id: string;
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface MonthlyBill {
  month: string; // YYYY-MM
  estimate: number;
  carry_in: number;
  to_collect: number;
  member_count: number;
  per_member: number;
  billed_total: number;
  actual_cost: number;
  actual_cost_override: number | null;
  guest_income: number;
  carry_out: number;
  status: MonthlyBillStatus;
  created_by: string;
  closed_at: string;
  updated_at?: string;
}

export interface MonthlyDue {
  due_id: string;
  month: string;
  member_id: string;
  member_name?: string;
  amount: number;
  is_paid: boolean;
  paid_at: string;
  confirmed_by: string;
}

export interface FundLedgerEntry {
  ledger_id: string;
  date: string;
  type: FundLedgerType;
  category: FundLedgerCategory;
  amount: number;
  member_id: string;
  member_name?: string;
  session_id: string;
  attendance_id: string;
  period: string;
  is_paid: boolean;
  paid_at: string;
  settlement_id: string;
  receipt_drive_id: string;
  receipt_url: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface Settlement {
  settlement_id: string;
  from_member_id: string;
  from_name?: string;
  to_member_id: string;
  to_name?: string;
  amount: number;
  settled_at: string;
  method: PaymentMethod;
  category?: SessionType;
  source_attendance_ids: string;
  source_ledger_ids: string;
  is_reconciled: boolean;
  transfer_content: string;
  note: string;
  confirmed_by: string;
}

export interface SettingRow {
  key: string;
  value: string;
  description: string;
  updated_at: string;
  updated_by: string;
}

export interface SettingsMap {
  club_name: string;
  treasurer_member_id: string;
  guest_fee: number;
  court_price_per_hour: number;
  shuttle_price: number;
  default_court_count: number;
  default_play_hours: number;
  drive_folder_id: string;
  rounding_unit: number;
  vietqr_template: string;
  transfer_prefix: string;
  monthly_fee?: number;
  default_monthly_fund?: number;
  default_guest_fee?: number;
  raw?: SettingRow[];
}

export interface Editor {
  email: string;
  name: string;
  role: EditorRole;
  is_active: boolean;
  added_at: string;
}

// ============================================================================
// 2. API ENVELOPE & RESPONSE TYPES
// ============================================================================

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT_LOCK'
  | 'GEMINI_ERROR'
  | 'DRIVE_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  status?: number;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  meta: {
    timestamp: string;
  };
  error: ApiError | null;
}

export interface PeriodRange {
  type: PeriodType;
  startDate: string | null;
  endDate: string | null;
  label: string;
}

export interface BootstrapData {
  settings: SettingsMap;
  members: Member[];
}

export interface BankInfo {
  bankBin: string;
  bankName: string;
  accountNo: string;
  accountName: string;
}

export interface BadmintonMonthlyDueItem {
  due_id: string;
  month: string;
  member_id: string;
  member_name: string;
  amount: number;
  is_paid: boolean;
  paid_at: string;
  transferContent: string;
  vietQrUrl: string | null;
}

export interface BadmintonGuestDueItem {
  attendance_id: string;
  session_id: string;
  session_date: string;
  session_title: string;
  member_id: string;
  member_name: string;
  amount: number;
  transferContent: string;
  vietQrUrl: string | null;
}

export interface BadmintonAdhocDueItem {
  attendance_id: string;
  session_id: string;
  session_date: string;
  session_title: string;
  member_id: string;
  member_name: string;
  member_type_snapshot: MemberType;
  creditor_id: string;
  creditor_name: string;
  creditorBank: BankInfo | null;
  amount: number;
  transferContent: string;
  vietQrUrl: string | null;
}

export interface BadmintonDuesData {
  treasurerMemberId: string;
  treasurerBank: BankInfo | null;
  monthlyDues: BadmintonMonthlyDueItem[];
  guestDues: BadmintonGuestDueItem[];
  adhocDues: BadmintonAdhocDueItem[];
  totalMonthlyUnpaid: number;
  totalGuestUnpaid: number;
  totalAdhocUnpaid: number;
  totalOutstanding: number;
}

export interface SimplifiedTransfer {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
  transferContent: string;
  toBank: BankInfo | null;
  vietQrUrl: string | null;
}

export interface NetBalanceItem {
  memberId: string;
  name: string;
  balance: number;
}

export interface DrinkingDebtsData {
  netBalances: NetBalanceItem[];
  simplifiedTransfers: SimplifiedTransfer[];
  unpaidAttendances: Attendance[];
  recentSettlements: Settlement[];
  totalOutstanding: number;
}

export interface SeparatedDebtsData {
  treasurerMemberId: string;
  badminton: BadmintonDuesData;
  drinking: DrinkingDebtsData;
}

export interface DashboardData {
  period: PeriodRange;
  currentMonth: string;
  badminton: {
    periodCost: number;
    sessionCount: number;
    fixedSessionCount?: number;
    adhocSessionCount?: number;
    guestIncomeInMonth: number;
    carryIn: number;
    projectedCarryOut: number;
    unpaidTotal: number;
    monthlyBillIssued?: boolean;
    monthlyBillStatus?: MonthlyBillStatus;
    estimate?: number;
    billedTotal?: number;
    actualCost?: number;
    perMember?: number;
    paidMembersCount?: number;
    totalMembersCount?: number;
  };
  drinking: {
    periodCost: number;
    sessionCount: number;
    unpaidTotal: number;
  };
  recentSessions: Session[];
}

export interface SessionDetailData {
  session: Session;
  attendances: Attendance[];
  items: SessionItem[];
}

export interface MonthlyBillData {
  month: string;
  bill: MonthlyBill;
  dues: BadmintonMonthlyDueItem[];
  sessions: Session[];
  guestIncomeDetail: {
    paidCount: number;
    paidAmount: number;
    unpaidAmount: number;
  };
  suggestedEstimateFromSchedule: number;
}

export interface GuestStatSessionItem {
  attendanceId: string;
  sessionId: string;
  date: string;
  sessionType: SessionType;
  feeAmount: number;
  isPaid: boolean;
}

export interface GuestStatItem {
  memberId: string;
  name: string;
  sessionCount: number;
  dates: string[];
  totalFee: number;
  totalPaid: number;
  totalUnpaid: number;
  sessions: GuestStatSessionItem[];
}

export interface GuestStatsData {
  month: string;
  summary: {
    totalGuests: number;
    totalVisits: number;
    totalFee: number;
    totalPaid: number;
    totalUnpaid: number;
  };
  guests: GuestStatItem[];
}

export interface ScheduleData {
  month: string;
  days: ScheduleDay[];
}

export interface AllDataResponse {
  bootstrap: BootstrapData;
  dashboard: DashboardData;
  sessions: Session[];
  debts: SeparatedDebtsData;
  schedule: ScheduleData;
  monthlyBill: MonthlyBillData;
  guestStats: GuestStatsData;
}

// ============================================================================
// 3. CLIENT-SIDE DEBT SIMPLIFIER (CHỈ DÙNG CHO ĂN NHẬU)
// ============================================================================

export interface DebtBreakdownSession {
  attendanceId: string;
  sessionId: string;
  sessionDate: string;
  sessionTitle: string;
  sessionType: 'DRINKING';
  amount: number; // > 0 số tiền phải trả của người nợ ở buổi đó
  contributedAmount: number;
  perPersonAmount: number;
}

export interface SimplifiedTransferDetail {
  fromMember: Member;
  toMember: Member;
  amount: number;
  transferContent: string;
  vietQrUrl: string | null;
  breakdownSessions: DebtBreakdownSession[];
}

export interface SimplifiedDebtResult {
  netBalances: NetBalanceItem[];
  transfers: SimplifiedTransferDetail[];
  totalOutstanding: number;
}

// ============================================================================
// 4. EDITOR AUTH, AI & WRITE PAYLOADS
// ============================================================================

export interface VerifyEditorResponse {
  authorized: boolean;
  email: string;
  name: string;
  role: EditorRole;
}

export interface ParseBillAIResponse {
  receipt_drive_id: string;
  receipt_url: string;
  direct_url?: string;
  thumbnail_url?: string;
  folder_name?: string;
  total_amount: number;
  items_summary: string;
  suggested_title: string;
}

export interface QuickNewGuestInput {
  name: string;
  aliases?: string;
  paidImmediately?: boolean;
}

export interface SessionItemInput {
  member_id: string;
  kind: SessionItemKind;
  item_name: string;
  amount: number;
}

export interface CreateSessionPayload {
  date: string;
  type: SessionType;
  title: string;
  totalAmount: number;
  guestFee?: number;
  payerId?: string;
  receiptDriveId?: string;
  receiptUrl?: string;
  receiptSummary?: string;
  note?: string;
  attendeeIds: string[];
  paidImmediatelyMemberIds?: string[];
  new_guests?: Array<string | QuickNewGuestInput>;
  // Chi phí cầu lông
  courtAmount?: number;
  shuttleQty?: number;
  shuttleAmount?: number;
  otherAmount?: number;
  costDetail?: BadmintonCostDetail;
  planId?: string;
  billingMode?: BadmintonBillingMode;
  // Ăn nhậu góp món
  venueType?: DrinkingVenueType;
  items?: SessionItemInput[];
}

export interface UpdateSessionPayload extends CreateSessionPayload {
  sessionId: string;
}

export interface CreateSessionResponse {
  session: Session;
  createdMembers: Member[];
  attendances: Attendance[];
  items?: SessionItem[];
}

export interface ConfirmPaymentPayload {
  category: SessionType;
  mode?: 'SIMPLIFIED_TRANSFER' | 'ITEMS';
  fromMemberId: string;
  toMemberId: string;
  amount?: number;
  attendanceIds?: string[];
  method: PaymentMethod;
  transferContent?: string;
  note?: string;
}

export interface ConfirmPaymentResponse {
  settlement: Settlement;
  updatedDebts: SeparatedDebtsData;
}

export interface GenerateSchedulePayload {
  month: string; // YYYY-MM
  weekdays: number[]; // 1=T2 .. 6=T7, 0=CN
  startTime: string;
  endTime: string;
  courts: number;
  plannedMemberIds: string[];
  note?: string;
}

export interface UpdateScheduleDayPayload {
  operation: 'UPSERT' | 'DELETE';
  planId?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  courts?: number;
  plannedMemberIds?: string[];
  status?: ScheduleStatus;
  note?: string;
}

export interface IssueMonthlyBillPayload {
  month: string;
  estimate: number;
  memberIds: string[];
}

export interface MarkDuePaidPayload {
  dueId: string;
  isPaid?: boolean;
}

export interface CloseMonthPayload {
  month: string;
  actualCostOverride?: number | null;
}

export interface UpsertMemberPayload {
  memberId?: string | null;
  name: string;
  aliases?: string;
  type: MemberType;
  phone?: string;
  bankBin?: string;
  bankName?: string;
  accountNo?: string;
  accountName?: string;
  isActive?: boolean;
}

export interface UpdateSettingsPayload {
  settings: Partial<Record<string, string | number>>;
}

export interface ManageEditorsPayload {
  operation: 'UPSERT' | 'TOGGLE_ACTIVE' | 'DELETE';
  email: string;
  name?: string;
  role?: EditorRole;
  isActive?: boolean;
}

export interface EditorSessionState {
  idToken: string;
  editor: VerifyEditorResponse;
  exp: number;
}
