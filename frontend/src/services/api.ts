/**
 * api.ts
 * Facade điều phối các API Đọc/Ghi tới đúng DataProvider đang hoạt động
 * (Firebase Firestore | Google Sheets GAS | Mock Demo), giữ nguyên 100% chữ ký hàm cho toàn bộ UI.
 */

import type {
  AllDataResponse,
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
  MonthlyBillData,
  ParseBillAIResponse,
  PeriodType,
  SaveMonthlyContributionsPayload,
  ScheduleData,
  SeparatedDebtsData,
  Session,
  SessionDetailData,
  SettingsMap,
  UpdateScheduleDayPayload,
  UpdateSessionPayload,
  UpdateSettingsPayload,
  UpsertMemberPayload,
  VerifyEditorResponse,
} from '../types';
import { getActiveProviderMode } from './providerRegistry';
import { firebaseProvider } from './providers/firebaseProvider';
import { gasProvider } from './providers/gasProvider';
import { mockProvider } from './providers/mockProvider';
import { ApiClientError, type DataProvider, type DbProviderMode } from './providers/types';

export { ApiClientError };
export type { DbProviderMode };

export const IS_MOCK_MODE = getActiveProviderMode() === 'mock';

export function isMockMode(): boolean {
  return getActiveProviderMode() === 'mock';
}

export function getActiveProvider(mode: DbProviderMode = getActiveProviderMode()): DataProvider {
  if (mode === 'firebase') return firebaseProvider;
  if (mode === 'gas') return gasProvider;
  return mockProvider;
}

export function subscribeClubChanges(onRevision: (rev: number) => void): () => void {
  const provider = getActiveProvider();
  return provider.subscribeChanges ? provider.subscribeChanges(onRevision) : () => {};
}

// ============================================================================
// PUBLIC READ APIs (Viewer)
// ============================================================================

export function fetchAllData(
  periodType: PeriodType = 'MONTH',
  refDate?: string,
  month?: string
): Promise<AllDataResponse> {
  return getActiveProvider().fetchAllData(periodType, refDate, month);
}

export function fetchBootstrap(): Promise<BootstrapData> {
  return getActiveProvider().fetchBootstrap();
}

export function fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
  return getActiveProvider().fetchSessionDetail(sessionId);
}

export function fetchSchedule(month: string): Promise<ScheduleData> {
  return getActiveProvider().fetchSchedule(month);
}

export function fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
  return getActiveProvider().fetchMonthlyBill(month);
}

export function fetchGuestStats(month: string): Promise<GuestStatsData> {
  return getActiveProvider().fetchGuestStats(month);
}

export function fetchDebts(): Promise<SeparatedDebtsData> {
  return getActiveProvider().fetchDebts();
}

// ============================================================================
// EDITOR AUTH, AI & WRITE APIs
// ============================================================================

export function verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
  return getActiveProvider().verifyEditor(idToken);
}

export function linkMemberEmail(
  idToken: string,
  memberId: string
): Promise<{ linkedMemberId: string; email: string }> {
  return getActiveProvider().linkMemberEmail(idToken, memberId);
}

export function undoSettlement(
  idToken: string,
  settlementId: string
): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
  return getActiveProvider().undoSettlement(idToken, settlementId);
}

export function parseBillAI(
  idToken: string,
  payload: { base64Image: string; mimeType: string; sessionDate?: string }
): Promise<ParseBillAIResponse> {
  return getActiveProvider().parseBillAI(idToken, payload);
}

export function createSession(
  idToken: string,
  payload: CreateSessionPayload
): Promise<CreateSessionResponse> {
  return getActiveProvider().createSession(idToken, payload);
}

export function updateSession(
  idToken: string,
  payload: UpdateSessionPayload
): Promise<{ session: Session }> {
  return getActiveProvider().updateSession(idToken, payload);
}

export function deleteSession(
  idToken: string,
  sessionId: string
): Promise<{ deletedSessionId: string }> {
  return getActiveProvider().deleteSession(idToken, sessionId);
}

export function confirmPayment(
  idToken: string,
  payload: ConfirmPaymentPayload
): Promise<ConfirmPaymentResponse> {
  return getActiveProvider().confirmPayment(idToken, payload);
}

export function generateSchedule(
  idToken: string,
  payload: GenerateSchedulePayload
): Promise<ScheduleData> {
  return getActiveProvider().generateSchedule(idToken, payload);
}

export function updateScheduleDay(
  idToken: string,
  payload: UpdateScheduleDayPayload
): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
  return getActiveProvider().updateScheduleDay(idToken, payload);
}

export function issueMonthlyBill(
  idToken: string,
  payload: IssueMonthlyBillPayload
): Promise<MonthlyBillData> {
  return getActiveProvider().issueMonthlyBill(idToken, payload);
}

export function saveMonthlyContributions(
  idToken: string,
  payload: SaveMonthlyContributionsPayload
): Promise<MonthlyBillData> {
  return getActiveProvider().saveMonthlyContributions(idToken, payload);
}

export function markDuePaid(
  idToken: string,
  payload: MarkDuePaidPayload
): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
  return getActiveProvider().markDuePaid(idToken, payload);
}

export function closeMonth(
  idToken: string,
  payload: CloseMonthPayload
): Promise<MonthlyBillData> {
  return getActiveProvider().closeMonth(idToken, payload);
}

export function upsertMember(
  idToken: string,
  payload: UpsertMemberPayload
): Promise<{ member: Member }> {
  return getActiveProvider().upsertMember(idToken, payload);
}

export function updateSettings(
  idToken: string,
  payload: UpdateSettingsPayload
): Promise<{ settings: SettingsMap }> {
  return getActiveProvider().updateSettings(idToken, payload);
}

export function fetchEditors(idToken: string): Promise<Editor[]> {
  return getActiveProvider().fetchEditors(idToken);
}

export function manageEditors(
  idToken: string,
  payload: ManageEditorsPayload
): Promise<Editor[]> {
  return getActiveProvider().manageEditors(idToken, payload);
}
