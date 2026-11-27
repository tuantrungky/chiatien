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
} from '../../types';
import { trackWrite } from '../../utils/writeTracker';
import {
  applyMutationPlanToDataset,
  buildAllData,
  buildDebtsData,
  buildGuestStatsData,
  buildMonthlyBillData,
  buildScheduleData,
  buildSessionDetail,
  planCloseMonth,
  planConfirmPayment,
  planCreateSession,
  planDeleteSession,
  planGenerateSchedule,
  planIssueMonthlyBill,
  planLinkMemberEmail,
  planManageEditors,
  planMarkDuePaid,
  planSaveMonthlyContributions,
  planUndoSettlement,
  planUpdateScheduleDay,
  planUpdateSession,
  planUpdateSettings,
  planUpsertMember,
} from '../domainEngine';
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
} from '../mockData';
import type { ClubDataset, DataProvider } from './types';

function toPublicMembers(members: Member[], membersPrivate?: MemberPrivateRecord[]): Member[] {
  const privById = new Map((membersPrivate || []).map((p) => [p.member_id, p]));
  return members.map((m) => {
    const priv = privById.get(m.member_id);
    const { phone: _p, email: _e, ...rest } = m;
    return {
      ...rest,
      has_email: Boolean(priv?.email || m.email || m.has_email),
    };
  });
}

function buildInitialMockDataset(): ClubDataset {
  const membersRaw = structuredClone(initialMockMembers);
  return {
    settings: { ...initialMockSettings },
    members: toPublicMembers(membersRaw),
    members_private: membersRaw.map((m) => ({
      member_id: m.member_id,
      phone: m.phone || '',
      email: (m.email || '').toLowerCase(),
      updated_at: m.updated_at,
    })),
    schedule: structuredClone(initialMockSchedule),
    sessions: structuredClone(initialMockSessions),
    session_items: structuredClone(initialMockSessionItems),
    attendance: structuredClone(initialMockAttendances),
    monthly_bills: structuredClone(initialMockMonthlyBills),
    monthly_dues: structuredClone(initialMockMonthlyDues),
    settlements: structuredClone(initialMockSettlements),
    editors: structuredClone(initialMockEditors),
  };
}

let mockDataset: ClubDataset = buildInitialMockDataset();

export function resetMockDatasetForTest(): void {
  mockDataset = buildInitialMockDataset();
}

function mockDelay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function mockWriteDelay<T>(action: string, value: T, ms = 260): Promise<T> {
  return trackWrite(action, () => mockDelay(value, ms));
}

function resolveMockActor(idToken: string): { email: string; role: 'ADMIN' | 'EDITOR' | 'MEMBER' } {
  if (idToken === 'MOCK_MEMBER_ID_TOKEN') {
    return { email: 'member.mock@gmail.com', role: 'MEMBER' };
  }
  return { email: 'tuantrungky@gmail.com', role: 'ADMIN' };
}

export const mockProvider: DataProvider = {
  mode: 'mock',

  fetchAllData(periodType: PeriodType = 'MONTH', refDate?: string, month?: string): Promise<AllDataResponse> {
    const res = buildAllData(mockDataset, periodType, refDate, month);
    return mockDelay({
      ...res,
      bootstrap: {
        ...res.bootstrap,
        members: toPublicMembers(res.bootstrap.members, mockDataset.members_private),
      },
    });
  },

  fetchBootstrap(): Promise<BootstrapData> {
    return mockDelay({
      settings: { ...mockDataset.settings },
      members: toPublicMembers(mockDataset.members, mockDataset.members_private),
    });
  },

  fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
    return mockDelay(buildSessionDetail(mockDataset, sessionId));
  },

  fetchSchedule(month: string): Promise<ScheduleData> {
    return mockDelay(buildScheduleData(mockDataset, month));
  },

  fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
    return mockDelay(buildMonthlyBillData(mockDataset, month));
  },

  fetchGuestStats(month: string): Promise<GuestStatsData> {
    return mockDelay(buildGuestStatsData(mockDataset, month));
  },

  fetchDebts(): Promise<SeparatedDebtsData> {
    return mockDelay(buildDebtsData(mockDataset));
  },

  verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
    if (idToken === 'MOCK_MEMBER_ID_TOKEN') {
      const priv = (mockDataset.members_private || []).find(
        (p) => p.email === 'member.mock@gmail.com'
      );
      const linked = priv
        ? mockDataset.members.find((m) => m.member_id === priv.member_id)
        : mockDataset.members.find((m) => m.email === 'member.mock@gmail.com');
      return mockDelay({
        authorized: true,
        isEditor: false,
        email: 'member.mock@gmail.com',
        name: linked?.name || 'Thành viên Demo',
        role: 'MEMBER',
        linkedMemberId: linked?.member_id,
      });
    }
    return mockDelay({
      authorized: true,
      isEditor: true,
      email: 'tuantrungky@gmail.com',
      name: 'Tuấn (Mock)',
      role: 'ADMIN',
      linkedMemberId: 'MEM_002',
    });
  },

  linkMemberEmail(idToken: string, memberId: string): Promise<{ linkedMemberId: string; email: string }> {
    const actor = resolveMockActor(idToken);
    const plan = planLinkMemberEmail(mockDataset, memberId, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('linkMemberEmail', plan.result);
  },

  parseBillAI(
    _idToken: string,
    _payload: { base64Image: string; mimeType: string; sessionDate?: string }
  ): Promise<ParseBillAIResponse> {
    return mockWriteDelay(
      'parseBillAI',
      {
        receipt_drive_id: 'MOCK_FILE_ID',
        receipt_url: 'https://drive.google.com',
        total_amount: 640000,
        items_summary: 'Lẩu gà lá é (1), Gà nướng (1), Bia Tiger (10)',
        suggested_title: 'Nhậu Quán Lẩu Gà',
      },
      350
    );
  },

  createSession(idToken: string, payload: CreateSessionPayload): Promise<CreateSessionResponse> {
    const actor = resolveMockActor(idToken);
    const plan = planCreateSession(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('createSession', plan.result);
  },

  updateSession(_idToken: string, payload: UpdateSessionPayload): Promise<{ session: Session }> {
    const plan = planUpdateSession(mockDataset, payload);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('updateSession', plan.result);
  },

  deleteSession(_idToken: string, sessionId: string): Promise<{ deletedSessionId: string }> {
    const plan = planDeleteSession(mockDataset, sessionId);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('deleteSession', plan.result);
  },

  confirmPayment(idToken: string, payload: ConfirmPaymentPayload): Promise<ConfirmPaymentResponse> {
    const actor = resolveMockActor(idToken);
    const plan = planConfirmPayment(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('confirmPayment', plan.result);
  },

  undoSettlement(
    _idToken: string,
    settlementId: string
  ): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
    const plan = planUndoSettlement(mockDataset, settlementId);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('undoSettlement', plan.result);
  },

  generateSchedule(_idToken: string, payload: GenerateSchedulePayload): Promise<ScheduleData> {
    const plan = planGenerateSchedule(mockDataset, payload);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('generateSchedule', plan.result);
  },

  updateScheduleDay(
    _idToken: string,
    payload: UpdateScheduleDayPayload
  ): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
    const plan = planUpdateScheduleDay(mockDataset, payload);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('updateScheduleDay', plan.result);
  },

  issueMonthlyBill(idToken: string, payload: IssueMonthlyBillPayload): Promise<MonthlyBillData> {
    const actor = resolveMockActor(idToken);
    const plan = planIssueMonthlyBill(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('issueMonthlyBill', plan.result);
  },

  saveMonthlyContributions(
    idToken: string,
    payload: SaveMonthlyContributionsPayload
  ): Promise<MonthlyBillData> {
    const actor = resolveMockActor(idToken);
    const plan = planSaveMonthlyContributions(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('saveMonthlyContributions', plan.result);
  },

  markDuePaid(
    idToken: string,
    payload: MarkDuePaidPayload
  ): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
    const actor = resolveMockActor(idToken);
    const plan = planMarkDuePaid(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('markDuePaid', plan.result);
  },

  closeMonth(idToken: string, payload: CloseMonthPayload): Promise<MonthlyBillData> {
    const actor = resolveMockActor(idToken);
    const plan = planCloseMonth(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('closeMonth', plan.result);
  },

  upsertMember(_idToken: string, payload: UpsertMemberPayload): Promise<{ member: Member }> {
    const plan = planUpsertMember(mockDataset, payload);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('upsertMember', plan.result);
  },

  fetchMembersPrivate(_idToken: string): Promise<MemberPrivateRecord[]> {
    return mockDelay(structuredClone(mockDataset.members_private || []));
  },

  updateSettings(idToken: string, payload: UpdateSettingsPayload): Promise<{ settings: SettingsMap }> {
    const actor = resolveMockActor(idToken);
    const plan = planUpdateSettings(mockDataset, payload, actor.email);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('updateSettings', plan.result);
  },

  fetchEditors(_idToken: string): Promise<Editor[]> {
    return mockDelay([...mockDataset.editors]);
  },

  manageEditors(idToken: string, payload: ManageEditorsPayload): Promise<Editor[]> {
    const actor = resolveMockActor(idToken);
    const plan = planManageEditors(mockDataset, payload, actor.email, actor.role);
    mockDataset = applyMutationPlanToDataset(mockDataset, plan);
    return mockWriteDelay('manageEditors', plan.result);
  },
};
