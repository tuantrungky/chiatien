/**
 * api.ts
 * Facade điều phối các API Đọc/Ghi tới đúng DataProvider đang hoạt động
 * (Firebase Firestore | Google Sheets GAS | Mock Demo), giữ nguyên 100% chữ ký hàm cho toàn bộ UI.
 * Tải động (dynamic import) firebaseProvider & mockProvider để giảm kích thước bundle khởi đầu.
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
  MemberPrivateRecord,
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
import { gasProvider } from './providers/gasProvider';
import { ApiClientError, type DataProvider, type DbProviderMode } from './providers/types';

export { ApiClientError };
export type { DbProviderMode };

export const IS_MOCK_MODE = getActiveProviderMode() === 'mock';

export function isMockMode(): boolean {
  return getActiveProviderMode() === 'mock';
}

let firebaseProviderPromise: Promise<DataProvider> | null = null;
let mockProviderPromise: Promise<DataProvider> | null = null;

async function resolveProvider(
  mode: DbProviderMode = getActiveProviderMode()
): Promise<DataProvider> {
  if (mode === 'firebase') {
    if (!firebaseProviderPromise) {
      firebaseProviderPromise = import('./providers/firebaseProvider').then(
        (m) => m.firebaseProvider
      );
    }
    return firebaseProviderPromise;
  }
  if (mode === 'mock') {
    if (!mockProviderPromise) {
      mockProviderPromise = import('./providers/mockProvider').then((m) => m.mockProvider);
    }
    return mockProviderPromise;
  }
  return gasProvider;
}

export function getActiveProvider(
  mode: DbProviderMode = getActiveProviderMode()
): Promise<DataProvider> {
  return resolveProvider(mode);
}

export function subscribeClubChanges(onRevision: (rev: number) => void): () => void {
  if (getActiveProviderMode() !== 'firebase') return () => {};
  let disposed = false;
  let unsubscribeInner: (() => void) | null = null;

  void resolveProvider('firebase')
    .then((provider) => {
      if (disposed || !provider.subscribeChanges) return;
      unsubscribeInner = provider.subscribeChanges(onRevision);
    })
    .catch(() => {
      // Ignore lazy-load failure for optional realtime listener
    });

  return () => {
    disposed = true;
    if (unsubscribeInner) {
      unsubscribeInner();
      unsubscribeInner = null;
    }
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
  return (await resolveProvider()).fetchAllData(periodType, refDate, month);
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  return (await resolveProvider()).fetchBootstrap();
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
  return (await resolveProvider()).fetchSessionDetail(sessionId);
}

export async function fetchSchedule(month: string): Promise<ScheduleData> {
  return (await resolveProvider()).fetchSchedule(month);
}

export async function fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
  return (await resolveProvider()).fetchMonthlyBill(month);
}

export async function fetchGuestStats(month: string): Promise<GuestStatsData> {
  return (await resolveProvider()).fetchGuestStats(month);
}

export async function fetchDebts(): Promise<SeparatedDebtsData> {
  return (await resolveProvider()).fetchDebts();
}

// ============================================================================
// EDITOR AUTH, AI & WRITE APIs
// ============================================================================

export async function verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
  return (await resolveProvider()).verifyEditor(idToken);
}

export async function linkMemberEmail(
  idToken: string,
  memberId: string
): Promise<{ linkedMemberId: string; email: string }> {
  return (await resolveProvider()).linkMemberEmail(idToken, memberId);
}

export async function undoSettlement(
  idToken: string,
  settlementId: string
): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
  return (await resolveProvider()).undoSettlement(idToken, settlementId);
}

export async function parseBillAI(
  idToken: string,
  payload: { base64Image: string; mimeType: string; sessionDate?: string }
): Promise<ParseBillAIResponse> {
  return (await resolveProvider()).parseBillAI(idToken, payload);
}

export async function createSession(
  idToken: string,
  payload: CreateSessionPayload
): Promise<CreateSessionResponse> {
  return (await resolveProvider()).createSession(idToken, payload);
}

export async function updateSession(
  idToken: string,
  payload: UpdateSessionPayload
): Promise<{ session: Session }> {
  return (await resolveProvider()).updateSession(idToken, payload);
}

export async function deleteSession(
  idToken: string,
  sessionId: string
): Promise<{ deletedSessionId: string }> {
  return (await resolveProvider()).deleteSession(idToken, sessionId);
}

export async function confirmPayment(
  idToken: string,
  payload: ConfirmPaymentPayload
): Promise<ConfirmPaymentResponse> {
  return (await resolveProvider()).confirmPayment(idToken, payload);
}

export async function generateSchedule(
  idToken: string,
  payload: GenerateSchedulePayload
): Promise<ScheduleData> {
  return (await resolveProvider()).generateSchedule(idToken, payload);
}

export async function updateScheduleDay(
  idToken: string,
  payload: UpdateScheduleDayPayload
): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
  return (await resolveProvider()).updateScheduleDay(idToken, payload);
}

export async function issueMonthlyBill(
  idToken: string,
  payload: IssueMonthlyBillPayload
): Promise<MonthlyBillData> {
  return (await resolveProvider()).issueMonthlyBill(idToken, payload);
}

export async function saveMonthlyContributions(
  idToken: string,
  payload: SaveMonthlyContributionsPayload
): Promise<MonthlyBillData> {
  return (await resolveProvider()).saveMonthlyContributions(idToken, payload);
}

export async function markDuePaid(
  idToken: string,
  payload: MarkDuePaidPayload
): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
  return (await resolveProvider()).markDuePaid(idToken, payload);
}

export async function closeMonth(
  idToken: string,
  payload: CloseMonthPayload
): Promise<MonthlyBillData> {
  return (await resolveProvider()).closeMonth(idToken, payload);
}

export async function upsertMember(
  idToken: string,
  payload: UpsertMemberPayload
): Promise<{ member: Member }> {
  return (await resolveProvider()).upsertMember(idToken, payload);
}

export async function fetchMembersPrivate(idToken: string): Promise<MemberPrivateRecord[]> {
  return (await resolveProvider()).fetchMembersPrivate(idToken);
}

export async function updateSettings(
  idToken: string,
  payload: UpdateSettingsPayload
): Promise<{ settings: SettingsMap }> {
  return (await resolveProvider()).updateSettings(idToken, payload);
}

export async function fetchEditors(idToken: string): Promise<Editor[]> {
  return (await resolveProvider()).fetchEditors(idToken);
}

export async function manageEditors(
  idToken: string,
  payload: ManageEditorsPayload
): Promise<Editor[]> {
  return (await resolveProvider()).manageEditors(idToken, payload);
}
