/**
 * Schema 7 tabs Google Sheets & API Contract giữa Frontend và GAS Backend
 */

export type MemberType = 'MAIN' | 'GUEST';
export type SessionType = 'BADMINTON' | 'DRINKING';
export type FundLedgerType = 'INCOME' | 'EXPENSE';
export type FundLedgerCategory =
  | 'MONTHLY_FUND'
  | 'GUEST_FEE'
  | 'OTHER_INCOME'
  | 'COURT'
  | 'SHUTTLECOCK'
  | 'WATER'
  | 'OTHER_EXPENSE';

export type PaymentMethod = 'VIETQR' | 'CASH' | 'BANK_TRANSFER';
export type EditorRole = 'ADMIN' | 'EDITOR';
export type PeriodType = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'ALL';

// ============================================================================
// 1. SCHEMA 7 TABS GOOGLE SHEETS
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
  created_by: string;
  created_at: string;
  updated_at: string;
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
  is_paid: boolean;
  paid_at: string;
  settlement_id: string;
  note: string;
}

export interface FundLedgerEntry {
  ledger_id: string;
  date: string; // YYYY-MM-DD
  type: FundLedgerType;
  category: FundLedgerCategory;
  amount: number;
  member_id: string;
  member_name?: string;
  session_id: string;
  attendance_id: string;
  period: string; // YYYY-MM
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
  monthly_fee: number;
  guest_fee: number;
  default_monthly_fund: number;
  default_guest_fee: number;
  drive_folder_id: string;
  rounding_unit: number;
  vietqr_template: string;
  transfer_prefix: string;
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

export interface MonthlyFundStatusItem {
  member_id: string;
  name: string;
  paidAmount: number;
  isPaid: boolean;
}

export interface BankInfo {
  bankBin: string;
  bankName: string;
  accountNo: string;
  accountName: string;
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

export interface DashboardData {
  period: PeriodRange;
  currentMonth: string;
  fund: {
    currentBalance: number;
    periodIncome: number;
    periodExpense: number;
    pendingReimbursement: number;
  };
  debtsSummary: {
    totalOutstanding: number;
    pendingTransferCount: number;
  };
  simplifiedTransfers: SimplifiedTransfer[];
  recentSessions: Session[];
  monthlyFundStatus: MonthlyFundStatusItem[];
}

export interface SessionDetailData {
  session: Session;
  attendances: Attendance[];
  linkedExpenses: FundLedgerEntry[];
}

export interface FundLedgerData {
  period: PeriodRange;
  summary: {
    openingBalance: number;
    totalIncome: number;
    totalExpense: number;
    closingBalance: number;
  };
  entries: FundLedgerEntry[];
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

export interface NetBalanceItem {
  memberId: string;
  name: string;
  balance: number;
}

export interface UnpaidReimbursementItem {
  ledger_id: string;
  date: string;
  category: FundLedgerCategory;
  amount: number;
  member_id: string;
  member_name: string;
  description: string;
}

export interface DebtsData {
  treasurerMemberId: string;
  netBalances: NetBalanceItem[];
  simplifiedTransfers: SimplifiedTransfer[];
  unpaidAttendances: Attendance[];
  unpaidReimbursements: UnpaidReimbursementItem[];
  recentSettlements: Settlement[];
}

// ============================================================================
// 3. CLIENT-SIDE DEBT SIMPLIFIER OUTPUT TYPES
// ============================================================================

export interface DebtBreakdownSession {
  attendanceId?: string;
  ledgerId?: string;
  sessionId?: string;
  sessionDate: string;
  sessionTitle: string;
  sessionType: SessionType | 'REIMBURSEMENT';
  amount: number;
  originalCreditorId: string;
  originalCreditorName: string;
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

export interface ParseVoiceAttendanceAIResponse {
  matched_member_ids: string[];
  new_guests: string[];
  notes: string;
}

export interface QuickNewGuestInput {
  name: string;
  aliases?: string;
  paidImmediately?: boolean;
}

export interface CreateSessionExpenseInput {
  category: FundLedgerCategory;
  amount: number;
  memberId: string;
  description: string;
}

export interface CreateSessionPayload {
  date: string;
  type: SessionType;
  category?: SessionType;
  title: string;
  totalAmount: number;
  guestFee?: number;
  payerId: string;
  receiptDriveId?: string;
  receiptUrl?: string;
  receiptSummary?: string;
  note?: string;
  attendeeIds: string[];
  paidImmediatelyMemberIds?: string[];
  new_guests?: Array<string | QuickNewGuestInput>;
  expenses?: CreateSessionExpenseInput[];
  expenseCategory?: FundLedgerCategory;
  expenseDescription?: string;
}

export interface UpdateSessionPayload extends CreateSessionPayload {
  sessionId: string;
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

export interface CreateSessionResponse {
  session: Session;
  createdMembers: Member[];
  attendances: Attendance[];
  ledgerEntries: FundLedgerEntry[];
}

export interface ConfirmPaymentPayload {
  mode?: 'SIMPLIFIED_TRANSFER' | 'ITEMS';
  fromMemberId: string;
  toMemberId: string;
  amount?: number;
  attendanceIds?: string[];
  ledgerIds?: string[];
  method: PaymentMethod;
  transferContent?: string;
  note?: string;
}

export interface ConfirmPaymentResponse {
  settlement: Settlement;
  updatedDebts: DebtsData;
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

export interface AddFundEntryPayload {
  date: string;
  type: FundLedgerType;
  category: FundLedgerCategory;
  amount: number;
  memberId: string;
  period?: string;
  receiptDriveId?: string;
  receiptUrl?: string;
  description: string;
}

export interface UpdateSettingsPayload {
  settings: Partial<Record<string, string | number>>;
}
