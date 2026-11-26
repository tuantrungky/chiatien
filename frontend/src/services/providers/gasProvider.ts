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
} from '../../types';
import type { ApiResponse } from '../../types';
import { getTodayDateStr } from '../../utils/dateFilters';
import { trackWrite, WRITE_ACTION_LABELS } from '../../utils/writeTracker';
import { ApiClientError, type DataProvider, type RawClubTables } from './types';

export function getGasApiUrl(): string {
  return String(import.meta.env?.VITE_GAS_API_URL || '').trim();
}

export function isGasConfigured(): boolean {
  const url = getGasApiUrl();
  return Boolean(url && !url.includes('YOUR_DEPLOYMENT_ID'));
}

function assertGasUrl(): string {
  const url = getGasApiUrl();
  if (!url || url.includes('YOUR_DEPLOYMENT_ID')) {
    throw new ApiClientError(
      'BAD_REQUEST',
      'Chưa cấu hình VITE_GAS_API_URL (Web App URL Google Apps Script).',
      400
    );
  }
  return url;
}

export async function gasGet<T>(
  action: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const baseUrl = assertGasUrl();
  const url = new URL(baseUrl);
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

export async function gasPost<T>(
  action: string,
  idToken: string,
  payload: unknown,
  trackLabel?: string
): Promise<T> {
  const baseUrl = assertGasUrl();
  const exec = async (): Promise<T> => {
    const res = await fetch(baseUrl, {
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
  };

  if (trackLabel) {
    return trackWrite(trackLabel, exec);
  }
  if (WRITE_ACTION_LABELS[action]) {
    return trackWrite(action, exec);
  }
  return exec();
}

export async function exportRawTablesFromGas(
  idToken: string
): Promise<{ tables: RawClubTables; exportedAt: string }> {
  return gasPost<{ tables: RawClubTables; exportedAt: string }>(
    'exportRawTables',
    idToken,
    {},
    'Đang đọc toàn bộ dữ liệu từ Google Sheet...'
  );
}

export async function importRawTablesToGas(
  idToken: string,
  tables: RawClubTables
): Promise<{ importedCounts: Record<string, number>; importedAt: string }> {
  return gasPost<{ importedCounts: Record<string, number>; importedAt: string }>(
    'importRawTables',
    idToken,
    { tables },
    'Đang đẩy dữ liệu từ Firebase sang Google Sheet...'
  );
}

export const gasProvider: DataProvider = {
  mode: 'gas',

  fetchAllData(periodType: PeriodType = 'MONTH', refDate?: string, month?: string): Promise<AllDataResponse> {
    const rDate = refDate || getTodayDateStr();
    const targetMonth = month || rDate.slice(0, 7);
    return gasGet<AllDataResponse>('getAll', {
      periodType,
      refDate: rDate,
      month: targetMonth,
    });
  },

  fetchBootstrap(): Promise<BootstrapData> {
    return gasGet<BootstrapData>('bootstrap');
  },

  fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
    return gasGet<SessionDetailData>('getSessionDetail', { sessionId });
  },

  fetchSchedule(month: string): Promise<ScheduleData> {
    return gasGet<ScheduleData>('getSchedule', { month });
  },

  fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
    return gasGet<MonthlyBillData>('getMonthlyBill', { month });
  },

  fetchGuestStats(month: string): Promise<GuestStatsData> {
    return gasGet<GuestStatsData>('getGuestStats', { month });
  },

  fetchDebts(): Promise<SeparatedDebtsData> {
    return gasGet<SeparatedDebtsData>('getDebts');
  },

  verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
    return gasPost<VerifyEditorResponse>('verifyUser', idToken, {});
  },

  linkMemberEmail(idToken: string, memberId: string): Promise<{ linkedMemberId: string; email: string }> {
    return gasPost<{ linkedMemberId: string; email: string }>('linkMemberEmail', idToken, {
      memberId,
    });
  },

  parseBillAI(
    idToken: string,
    payload: { base64Image: string; mimeType: string; sessionDate?: string }
  ): Promise<ParseBillAIResponse> {
    return gasPost<ParseBillAIResponse>('parseBillAI', idToken, payload);
  },

  createSession(idToken: string, payload: CreateSessionPayload): Promise<CreateSessionResponse> {
    return gasPost<CreateSessionResponse>('createSession', idToken, payload);
  },

  updateSession(idToken: string, payload: UpdateSessionPayload): Promise<{ session: Session }> {
    return gasPost<{ session: Session }>('updateSession', idToken, payload);
  },

  deleteSession(idToken: string, sessionId: string): Promise<{ deletedSessionId: string }> {
    return gasPost<{ deletedSessionId: string }>('deleteSession', idToken, { sessionId });
  },

  confirmPayment(idToken: string, payload: ConfirmPaymentPayload): Promise<ConfirmPaymentResponse> {
    return gasPost<ConfirmPaymentResponse>('confirmPayment', idToken, payload);
  },

  undoSettlement(
    idToken: string,
    settlementId: string
  ): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
    return gasPost<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }>(
      'undoSettlement',
      idToken,
      { settlementId }
    );
  },

  generateSchedule(idToken: string, payload: GenerateSchedulePayload): Promise<ScheduleData> {
    return gasPost<ScheduleData>('generateSchedule', idToken, payload);
  },

  updateScheduleDay(
    idToken: string,
    payload: UpdateScheduleDayPayload
  ): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
    return gasPost<{ schedule?: ScheduleData; deletedPlanId?: string }>(
      'updateScheduleDay',
      idToken,
      payload
    );
  },

  issueMonthlyBill(idToken: string, payload: IssueMonthlyBillPayload): Promise<MonthlyBillData> {
    return gasPost<MonthlyBillData>('issueMonthlyBill', idToken, payload);
  },

  saveMonthlyContributions(
    idToken: string,
    payload: SaveMonthlyContributionsPayload
  ): Promise<MonthlyBillData> {
    return gasPost<MonthlyBillData>('saveMonthlyContributions', idToken, payload);
  },

  markDuePaid(
    idToken: string,
    payload: MarkDuePaidPayload
  ): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
    return gasPost<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }>(
      'markDuePaid',
      idToken,
      payload
    );
  },

  closeMonth(idToken: string, payload: CloseMonthPayload): Promise<MonthlyBillData> {
    return gasPost<MonthlyBillData>('closeMonth', idToken, payload);
  },

  upsertMember(idToken: string, payload: UpsertMemberPayload): Promise<{ member: Member }> {
    return gasPost<{ member: Member }>('upsertMember', idToken, payload);
  },

  updateSettings(idToken: string, payload: UpdateSettingsPayload): Promise<{ settings: SettingsMap }> {
    return gasPost<{ settings: SettingsMap }>('updateSettings', idToken, payload);
  },

  async fetchEditors(idToken: string): Promise<Editor[]> {
    const res = await gasPost<{ editors: Editor[] }>('getEditors', idToken, {});
    return res.editors;
  },

  async manageEditors(idToken: string, payload: ManageEditorsPayload): Promise<Editor[]> {
    const res = await gasPost<{ editors: Editor[] }>('manageEditors', idToken, payload);
    return res.editors;
  },
};
