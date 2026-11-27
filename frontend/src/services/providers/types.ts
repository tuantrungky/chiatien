import type {
  AllDataResponse,
  Attendance,
  BootstrapData,
  CloseMonthPayload,
  ConfirmPaymentPayload,
  ConfirmPaymentResponse,
  CreateSessionPayload,
  CreateSessionResponse,
  Editor,
  GenerateSchedulePayload,
  GuestStatsData,
  IssueMonthlyBillPayload,
  ManageEditorsPayload,
  MarkDuePaidPayload,
  Member,
  MemberPrivateRecord,
  MonthlyBill,
  MonthlyBillData,
  MonthlyDue,
  ParseBillAIResponse,
  PeriodType,
  SaveMonthlyContributionsPayload,
  ScheduleData,
  ScheduleDay,
  SeparatedDebtsData,
  Session,
  SessionDetailData,
  SessionItem,
  SettingRow,
  SettingsMap,
  Settlement,
  UpdateScheduleDayPayload,
  UpdateSessionPayload,
  UpdateSettingsPayload,
  UpsertMemberPayload,
  VerifyEditorResponse,
} from '../../types';

export type DbProviderMode = 'firebase' | 'gas' | 'mock';

export type CollectionKey =
  | 'members'
  | 'members_private'
  | 'sessions'
  | 'attendance'
  | 'session_items'
  | 'schedule'
  | 'monthly_bills'
  | 'monthly_dues'
  | 'settlements'
  | 'settings'
  | 'editors';

export interface RawClubTables {
  members: Member[];
  sessions: Session[];
  attendance: Attendance[];
  session_items: SessionItem[];
  schedule: ScheduleDay[];
  monthly_bills: MonthlyBill[];
  monthly_dues: MonthlyDue[];
  settlements: Settlement[];
  settings: SettingRow[];
  editors: Editor[];
}

export interface ClubDataset {
  settings: SettingsMap;
  settingsRows?: SettingRow[];
  members: Member[];
  members_private?: MemberPrivateRecord[];
  sessions: Session[];
  attendance: Attendance[];
  session_items: SessionItem[];
  schedule: ScheduleDay[];
  monthly_bills: MonthlyBill[];
  monthly_dues: MonthlyDue[];
  settlements: Settlement[];
  editors: Editor[];
}

export interface SyncMetaState {
  dataRevision: number;
  updatedAt: string;
  updatedBy: string;
  lastPullFromSheetAt?: string;
  lastPushToSheetAt?: string;
  schemaVersion: number;
}

export interface TableCountComparison {
  table: keyof RawClubTables;
  label: string;
  firebaseCount: number;
  sheetCount: number;
  diff: number;
}

export interface MutationUpsertItem {
  id: string;
  data: Record<string, unknown>;
}

export interface BatchMutationPlan<TResult> {
  upserts: Partial<Record<CollectionKey, MutationUpsertItem[]>>;
  deletes: Partial<Record<CollectionKey, string[]>>;
  result: TResult;
}

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

export interface DataProvider {
  readonly mode: DbProviderMode;

  fetchAllData(periodType?: PeriodType, refDate?: string, month?: string): Promise<AllDataResponse>;
  fetchBootstrap(): Promise<BootstrapData>;
  fetchSessionDetail(sessionId: string): Promise<SessionDetailData>;
  fetchSchedule(month: string): Promise<ScheduleData>;
  fetchMonthlyBill(month: string): Promise<MonthlyBillData>;
  fetchGuestStats(month: string): Promise<GuestStatsData>;
  fetchDebts(): Promise<SeparatedDebtsData>;

  verifyEditor(idToken: string): Promise<VerifyEditorResponse>;
  linkMemberEmail(idToken: string, memberId: string): Promise<{ linkedMemberId: string; email: string }>;
  parseBillAI(
    idToken: string,
    payload: { base64Image: string; mimeType: string; sessionDate?: string }
  ): Promise<ParseBillAIResponse>;

  createSession(idToken: string, payload: CreateSessionPayload): Promise<CreateSessionResponse>;
  updateSession(idToken: string, payload: UpdateSessionPayload): Promise<{ session: Session }>;
  deleteSession(idToken: string, sessionId: string): Promise<{ deletedSessionId: string }>;

  confirmPayment(idToken: string, payload: ConfirmPaymentPayload): Promise<ConfirmPaymentResponse>;
  undoSettlement(
    idToken: string,
    settlementId: string
  ): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }>;

  generateSchedule(idToken: string, payload: GenerateSchedulePayload): Promise<ScheduleData>;
  updateScheduleDay(
    idToken: string,
    payload: UpdateScheduleDayPayload
  ): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }>;

  issueMonthlyBill(idToken: string, payload: IssueMonthlyBillPayload): Promise<MonthlyBillData>;
  saveMonthlyContributions(
    idToken: string,
    payload: SaveMonthlyContributionsPayload
  ): Promise<MonthlyBillData>;
  markDuePaid(
    idToken: string,
    payload: MarkDuePaidPayload
  ): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }>;
  closeMonth(idToken: string, payload: CloseMonthPayload): Promise<MonthlyBillData>;

  upsertMember(idToken: string, payload: UpsertMemberPayload): Promise<{ member: Member }>;
  fetchMembersPrivate(idToken: string): Promise<MemberPrivateRecord[]>;
  updateSettings(idToken: string, payload: UpdateSettingsPayload): Promise<{ settings: SettingsMap }>;
  fetchEditors(idToken: string): Promise<Editor[]>;
  manageEditors(idToken: string, payload: ManageEditorsPayload): Promise<Editor[]>;

  subscribeChanges?(onRevision: (rev: number) => void): () => void;
}
