import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore';
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
  EditorRole,
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
import { getPeriodRange, getTodayDateStr } from '../../utils/dateFilters';
import { trackWrite } from '../../utils/writeTracker';
import {
  buildAllData,
  buildDebtsData,
  buildGuestStatsData,
  buildMonthlyBillData,
  buildScheduleData,
  buildSessionDetail,
  buildSettingsMapFromRows,
  getCutoffDateSixMonthsAgo,
  nowIsoVN,
  planCloseMonth,
  planConfirmPayment,
  planCreateSession,
  planDeleteSession,
  planGenerateSchedule,
  planIssueMonthlyBill,
  planManageEditors,
  planMarkDuePaid,
  planSaveMonthlyContributions,
  planUndoSettlement,
  planUpdateScheduleDay,
  planUpdateSession,
  planUpdateSettings,
  planUpsertMember,
  prevMonthStr,
  settingsMapToRows,
} from '../domainEngine';
import {
  ApiClientError,
  type BatchMutationPlan,
  type ClubDataset,
  type CollectionKey,
  type DataProvider,
  type RawClubTables,
  type SyncMetaState,
} from './types';
import {
  getFirebaseAuth,
  getFirebaseDb,
  getFreshFirebaseIdToken,
  isFirebaseConfigured,
} from '../firebase/config';
import { gasProvider, isGasConfigured } from './gasProvider';

const BATCH_CHUNK_SIZE = 450;

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function snapToDocs<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map((d) => d.data() as T);
}

function dedupeById<T>(items: T[], getId: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = getId(item);
    if (id) map.set(id, item);
  }
  return Array.from(map.values());
}

function decodeEmailAndNameFromJwt(idToken: string): { email: string; name: string } | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    const parsed = JSON.parse(json) as { email?: string; name?: string };
    const email = String(parsed.email || '').trim().toLowerCase();
    if (!email) return null;
    return { email, name: String(parsed.name || email).trim() };
  } catch {
    return null;
  }
}

function resolveCurrentActor(idToken: string): { email: string; name: string } {
  if (isFirebaseConfigured()) {
    const user = getFirebaseAuth().currentUser;
    if (user?.email) {
      return {
        email: user.email.trim().toLowerCase(),
        name: String(user.displayName || user.email).trim(),
      };
    }
  }
  const fromJwt = decodeEmailAndNameFromJwt(idToken);
  if (fromJwt) return fromJwt;
  throw new ApiClientError('UNAUTHORIZED', 'Phiên đăng nhập Firebase không hợp lệ.', 401);
}

async function fetchSettingsDoc(): Promise<SettingsMap> {
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, 'settings', 'club'));
  if (!snap.exists()) {
    return buildSettingsMapFromRows([]);
  }
  const data = snap.data() as Partial<SettingsMap>;
  if (Array.isArray(data.raw) && data.raw.length > 0 && !data.club_name) {
    return buildSettingsMapFromRows(data.raw);
  }
  return {
    ...buildSettingsMapFromRows(Array.isArray(data.raw) ? data.raw : []),
    ...data,
  };
}

async function fetchSessionsByIds(ids: string[]): Promise<Session[]> {
  if (ids.length === 0) return [];
  const db = getFirebaseDb();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) {
    chunks.push(ids.slice(i, i + 30));
  }
  const snaps = await Promise.all(
    chunks.map((c) => getDocs(query(collection(db, 'sessions'), where(documentId(), 'in', c))))
  );
  return snaps.flatMap((s) => snapToDocs<Session>(s));
}

async function fetchScopedDataset(options: {
  activeMonth: string;
  refDate?: string;
  periodType?: PeriodType;
  includeAllSessions?: boolean;
}): Promise<ClubDataset> {
  const db = getFirebaseDb();
  const rDate = options.refDate || getTodayDateStr();
  const targetMonth = options.activeMonth || rDate.slice(0, 7);
  const prevMonth = prevMonthStr(targetMonth);
  const monthStart = `${targetMonth}-01`;
  const prevMonthStart = `${prevMonth}-01`;
  const sixMonthsCutoff = getCutoffDateSixMonthsAgo(rDate);
  const periodRange = options.periodType ? getPeriodRange(options.periodType, rDate) : null;

  let sessionCutoff = sixMonthsCutoff < prevMonthStart ? sixMonthsCutoff : prevMonthStart;
  if (periodRange?.startDate && periodRange.startDate < sessionCutoff) {
    sessionCutoff = periodRange.startDate;
  }
  const loadAllSessions = options.includeAllSessions || options.periodType === 'ALL';

  const [
    settings,
    membersSnap,
    billsSnap,
    scheduleSnap,
    unpaidDuesSnap,
    monthDuesSnap,
    unpaidAttSnap,
    monthAttSnap,
    paidInMonthAttSnap,
    sessionsSnap,
    unreconciledSetSnap,
    recentSetSnap,
  ] = await Promise.all([
    fetchSettingsDoc(),
    getDocs(collection(db, 'members')),
    getDocs(collection(db, 'monthly_bills')),
    getDocs(query(collection(db, 'schedule'), where('month', '==', targetMonth))),
    getDocs(query(collection(db, 'monthly_dues'), where('is_paid', '==', false))),
    getDocs(query(collection(db, 'monthly_dues'), where('month', '==', targetMonth))),
    getDocs(query(collection(db, 'attendance'), where('is_paid', '==', false))),
    getDocs(query(collection(db, 'attendance'), where('session_date', '>=', monthStart))),
    getDocs(query(collection(db, 'attendance'), where('paid_at', '>=', monthStart))),
    loadAllSessions
      ? getDocs(collection(db, 'sessions'))
      : getDocs(query(collection(db, 'sessions'), where('date', '>=', sessionCutoff))),
    getDocs(query(collection(db, 'settlements'), where('is_reconciled', '==', false))),
    getDocs(query(collection(db, 'settlements'), orderBy('settled_at', 'desc'), limit(50))),
  ]);

  const attendance = dedupeById(
    [
      ...snapToDocs<Attendance>(unpaidAttSnap),
      ...snapToDocs<Attendance>(monthAttSnap),
      ...snapToDocs<Attendance>(paidInMonthAttSnap),
    ],
    (a) => a.attendance_id
  );

  let sessions = snapToDocs<Session>(sessionsSnap);
  if (!loadAllSessions) {
    const loadedSessionIds = new Set(sessions.map((s) => s.session_id));
    const missingIds = Array.from(
      new Set(
        attendance
          .filter((a) => !a.is_paid && a.session_id && !loadedSessionIds.has(a.session_id))
          .map((a) => a.session_id)
      )
    );
    if (missingIds.length > 0) {
      const extraSessions = await fetchSessionsByIds(missingIds);
      sessions = dedupeById([...sessions, ...extraSessions], (s) => s.session_id);
    }
  }

  return {
    settings,
    members: snapToDocs<Member>(membersSnap),
    monthly_bills: snapToDocs<MonthlyBill>(billsSnap),
    schedule: snapToDocs<ScheduleDay>(scheduleSnap),
    monthly_dues: dedupeById(
      [...snapToDocs<MonthlyDue>(unpaidDuesSnap), ...snapToDocs<MonthlyDue>(monthDuesSnap)],
      (d) => d.due_id
    ),
    attendance,
    sessions,
    settlements: dedupeById(
      [...snapToDocs<Settlement>(unreconciledSetSnap), ...snapToDocs<Settlement>(recentSetSnap)],
      (s) => s.settlement_id
    ),
    session_items: [],
    editors: [],
  };
}

interface BatchOp {
  type: 'set' | 'delete';
  col: string;
  id: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

async function commitOpsInChunks(ops: BatchOp[]): Promise<void> {
  if (ops.length === 0) return;
  const db = getFirebaseDb();
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_SIZE) {
    const chunk = ops.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, op.col, op.id);
      if (op.type === 'delete') {
        batch.delete(ref);
      } else {
        const cleanData = stripUndefined(op.data || {});
        if (op.merge) batch.set(ref, cleanData, { merge: true });
        else batch.set(ref, cleanData);
      }
    }
    await batch.commit();
  }
}

async function commitMutationPlan(
  plan: BatchMutationPlan<unknown>,
  actorEmail: string
): Promise<void> {
  const ops: BatchOp[] = [];

  for (const [col, ids] of Object.entries(plan.deletes) as Array<[CollectionKey, string[] | undefined]>) {
    if (!ids) continue;
    for (const id of ids) {
      ops.push({ type: 'delete', col, id });
    }
  }

  for (const [col, items] of Object.entries(plan.upserts) as Array<
    [CollectionKey, Array<{ id: string; data: Record<string, unknown> }> | undefined]
  >) {
    if (!items) continue;
    for (const item of items) {
      ops.push({ type: 'set', col, id: item.id, data: item.data });
    }
  }

  ops.push({
    type: 'set',
    col: '_meta',
    id: 'sync_state',
    data: {
      dataRevision: Date.now(),
      updatedAt: nowIsoVN(),
      updatedBy: actorEmail,
      schemaVersion: 1,
    },
    merge: true,
  });

  await commitOpsInChunks(ops);
}

async function verifyActorEditorRole(idToken: string): Promise<{
  email: string;
  name: string;
  role: EditorRole;
  isEditor: boolean;
  linkedMemberId: string;
}> {
  const db = getFirebaseDb();
  const actor = resolveCurrentActor(idToken);
  const [editorSnap, privSnap] = await Promise.all([
    getDoc(doc(db, 'editors', actor.email)),
    getDocs(query(collection(db, 'members_private'), where('email', '==', actor.email))),
  ]);

  let linkedMemberId = '';
  let linkedMemberName = '';
  const privDoc = privSnap.docs[0]?.data() as MemberPrivateRecord | undefined;
  if (privDoc?.member_id) {
    linkedMemberId = privDoc.member_id;
    const mSnap = await getDoc(doc(db, 'members', linkedMemberId));
    if (mSnap.exists()) {
      linkedMemberName = String((mSnap.data() as Member).name || '').trim();
    }
  } else {
    // Fallback nhẹ trong thời gian chuyển đổi trước khi chạy migrate members_private
    try {
      const legacySnap = await getDocs(
        query(collection(db, 'members'), where('email', '==', actor.email))
      );
      const legacyMember = legacySnap.docs[0]?.data() as Member | undefined;
      if (legacyMember) {
        linkedMemberId = legacyMember.member_id || '';
        linkedMemberName = legacyMember.name || '';
      }
    } catch {
      // Ignore if legacy fallback fails
    }
  }

  if (editorSnap.exists()) {
    const ed = editorSnap.data() as Editor;
    const isActive = ed.is_active === true;
    const role = (String(ed.role || 'EDITOR').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'EDITOR') as EditorRole;
    if (isActive) {
      return {
        email: actor.email,
        name: String(ed.name || actor.name || actor.email).trim(),
        role,
        isEditor: true,
        linkedMemberId,
      };
    }
  }

  return {
    email: actor.email,
    name: linkedMemberName || actor.name || actor.email,
    role: 'MEMBER',
    isEditor: false,
    linkedMemberId,
  };
}

async function assertEditorActor(idToken: string): Promise<{ email: string; role: EditorRole }> {
  const info = await verifyActorEditorRole(idToken);
  if (!info.isEditor) {
    throw new ApiClientError(
      'FORBIDDEN',
      `Tài khoản ${info.email} chỉ có quyền thành viên xem công khai, không thể chỉnh sửa dữ liệu.`,
      403
    );
  }
  return { email: info.email, role: info.role };
}

function mapFirebaseError(err: unknown): never {
  if (err instanceof ApiClientError) throw err;
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : 'Lỗi thao tác Firebase Firestore.';
  if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
    throw new ApiClientError(
      'FORBIDDEN',
      'Bạn không có quyền thực hiện thao tác này trên Firestore (kiểm tra danh sách Editors / Security Rules).',
      403
    );
  }
  if (code === 'unauthenticated') {
    throw new ApiClientError('UNAUTHORIZED', 'Phiên đăng nhập Firebase đã hết hạn.', 401);
  }
  throw new ApiClientError('INTERNAL_ERROR', message, 500);
}

// ============================================================================
// SYNC HELPERS (Dùng cho services/sync/manualSync.ts)
// ============================================================================

export async function getFirestoreSyncMeta(): Promise<SyncMetaState | null> {
  if (!isFirebaseConfigured()) return null;
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, '_meta', 'sync_state'));
  return snap.exists() ? (snap.data() as SyncMetaState) : null;
}

export async function markFirestorePushToSheet(actorEmail: string): Promise<void> {
  await commitOpsInChunks([
    {
      type: 'set',
      col: '_meta',
      id: 'sync_state',
      data: {
        lastPushToSheetAt: nowIsoVN(),
        updatedBy: actorEmail,
      },
      merge: true,
    },
  ]);
}

export async function exportAllRawTablesFromFirestore(): Promise<RawClubTables> {
  const db = getFirebaseDb();
  const [
    membersSnap,
    membersPrivateSnap,
    sessionsSnap,
    attendanceSnap,
    itemsSnap,
    scheduleSnap,
    billsSnap,
    duesSnap,
    settlementsSnap,
    settingsMap,
    editorsSnap,
  ] = await Promise.all([
    getDocs(collection(db, 'members')),
    getDocs(collection(db, 'members_private')),
    getDocs(collection(db, 'sessions')),
    getDocs(collection(db, 'attendance')),
    getDocs(collection(db, 'session_items')),
    getDocs(collection(db, 'schedule')),
    getDocs(collection(db, 'monthly_bills')),
    getDocs(collection(db, 'monthly_dues')),
    getDocs(collection(db, 'settlements')),
    fetchSettingsDoc(),
    getDocs(collection(db, 'editors')),
  ]);

  const privByMemberId = new Map<string, MemberPrivateRecord>(
    snapToDocs<MemberPrivateRecord>(membersPrivateSnap).map((p) => [p.member_id, p])
  );
  const membersMerged: Member[] = snapToDocs<Member>(membersSnap).map((m) => {
    const priv = privByMemberId.get(m.member_id);
    const { has_email: _he, ...rest } = m;
    return {
      ...rest,
      phone: String(priv?.phone ?? m.phone ?? '').trim(),
      email: String(priv?.email ?? m.email ?? '').trim().toLowerCase(),
    };
  });

  const schedule = snapToDocs<ScheduleDay & { month?: string }>(scheduleSnap).map((row) => {
    const clean = { ...row };
    delete clean.month;
    return clean as ScheduleDay;
  });

  return {
    members: membersMerged,
    sessions: snapToDocs<Session>(sessionsSnap),
    attendance: snapToDocs<Attendance>(attendanceSnap),
    session_items: snapToDocs<SessionItem>(itemsSnap),
    schedule,
    monthly_bills: snapToDocs<MonthlyBill>(billsSnap),
    monthly_dues: snapToDocs<MonthlyDue>(duesSnap),
    settlements: snapToDocs<Settlement>(settlementsSnap),
    settings: settingsMapToRows(settingsMap),
    editors: snapToDocs<Editor>(editorsSnap),
  };
}

export async function migrateMembersPrivateOnFirestore(
  actorEmail: string
): Promise<{ migrated: number; cleaned: number }> {
  const db = getFirebaseDb();
  const [membersSnap, privSnap] = await Promise.all([
    getDocs(collection(db, 'members')),
    getDocs(collection(db, 'members_private')),
  ]);

  const existingPriv = new Map<string, MemberPrivateRecord>(
    snapToDocs<MemberPrivateRecord>(privSnap).map((p) => [p.member_id, p])
  );
  const now = nowIsoVN();
  const ops: BatchOp[] = [];
  let migrated = 0;
  let cleaned = 0;

  for (const mDoc of membersSnap.docs) {
    const raw = mDoc.data() as Member & Record<string, unknown>;
    const memberId = String(raw.member_id || mDoc.id).trim();
    if (!memberId) continue;

    const prevPriv = existingPriv.get(memberId);
    const phone = String(raw.phone ?? prevPriv?.phone ?? '').trim();
    const email = String(raw.email ?? prevPriv?.email ?? '').trim().toLowerCase();
    const hasEmail = Boolean(email || raw.has_email);

    if (!prevPriv || (raw.phone !== undefined && raw.phone !== prevPriv.phone) || (raw.email !== undefined && String(raw.email).toLowerCase() !== prevPriv.email)) {
      ops.push({
        type: 'set',
        col: 'members_private',
        id: memberId,
        data: {
          member_id: memberId,
          phone,
          email,
          updated_at: prevPriv?.updated_at || raw.updated_at || now,
        },
      });
      migrated++;
    }

    if ('phone' in raw || 'email' in raw || raw.has_email !== hasEmail) {
      const { phone: _p, email: _e, ...publicFields } = raw;
      ops.push({
        type: 'set',
        col: 'members',
        id: memberId,
        data: {
          ...publicFields,
          member_id: memberId,
          has_email: hasEmail,
          updated_at: raw.updated_at || now,
        },
      });
      cleaned++;
    }
  }

  if (ops.length > 0) {
    ops.push({
      type: 'set',
      col: '_meta',
      id: 'sync_state',
      data: {
        dataRevision: Date.now(),
        updatedAt: now,
        updatedBy: actorEmail,
        schemaVersion: 1,
      },
      merge: true,
    });
    await commitOpsInChunks(ops);
  }

  return { migrated, cleaned };
}

export async function importAllRawTablesToFirestore(
  tables: RawClubTables,
  actorEmail: string,
  onProgress?: (message: string, percent: number) => void
): Promise<Record<keyof RawClubTables, number>> {
  const db = getFirebaseDb();
  const ops: BatchOp[] = [];
  onProgress?.('Đang đối chiếu dữ liệu cũ trên Firestore...', 20);

  const str = (v: unknown): string => String(v ?? '').trim();

  const syncCollection = async <T extends object>(
    colName: CollectionKey,
    rows: T[],
    getId: (row: T) => string,
    transform?: (row: T) => Record<string, unknown>
  ) => {
    const existingSnap = await getDocs(collection(db, colName));
    const nextIds = new Set<string>();
    for (const row of rows) {
      const id = getId(row);
      if (!id) continue;
      nextIds.add(id);
      ops.push({
        type: 'set',
        col: colName,
        id,
        data: transform ? transform(row) : (row as unknown as Record<string, unknown>),
      });
    }
    for (const oldDoc of existingSnap.docs) {
      if (!nextIds.has(oldDoc.id)) {
        ops.push({ type: 'delete', col: colName, id: oldDoc.id });
      }
    }
  };

  const now = nowIsoVN();
  const membersList = tables.members || [];

  await Promise.all([
    syncCollection(
      'members',
      membersList,
      (r) => str(r.member_id),
      (r) => {
        const email = str(r.email).toLowerCase();
        const { phone: _p, email: _e, ...rest } = r;
        return {
          ...rest,
          member_id: str(r.member_id),
          bank_bin: str(r.bank_bin),
          account_no: str(r.account_no),
          has_email: Boolean(email || r.has_email),
        };
      }
    ),
    syncCollection(
      'members_private',
      membersList,
      (r) => str(r.member_id),
      (r) => ({
        member_id: str(r.member_id),
        phone: str(r.phone),
        email: str(r.email).toLowerCase(),
        updated_at: r.updated_at || now,
      })
    ),
    syncCollection(
      'sessions',
      tables.sessions || [],
      (r) => str(r.session_id),
      (r) => ({
        ...r,
        session_id: str(r.session_id),
        date: str(r.date),
      }) as unknown as Record<string, unknown>
    ),
    syncCollection(
      'attendance',
      tables.attendance || [],
      (r) => str(r.attendance_id),
      (r) => ({
        ...r,
        attendance_id: str(r.attendance_id),
        session_date: str(r.session_date),
      }) as unknown as Record<string, unknown>
    ),
    syncCollection('session_items', tables.session_items || [], (r) => str(r.item_id)),
    syncCollection(
      'schedule',
      tables.schedule || [],
      (r) => str(r.plan_id),
      (r) => ({
        ...r,
        plan_id: str(r.plan_id),
        date: str(r.date),
        month: str(r.date).slice(0, 7),
        start_time: str(r.start_time || '20:00'),
        end_time: str(r.end_time || '21:30'),
      }) as unknown as Record<string, unknown>
    ),
    syncCollection(
      'monthly_bills',
      tables.monthly_bills || [],
      (r) => str(r.month),
      (r) => ({ ...r, month: str(r.month) }) as unknown as Record<string, unknown>
    ),
    syncCollection(
      'monthly_dues',
      tables.monthly_dues || [],
      (r) => str(r.due_id),
      (r) => ({
        ...r,
        due_id: str(r.due_id),
        month: str(r.month),
        issued_at: str(r.issued_at),
      }) as unknown as Record<string, unknown>
    ),
    syncCollection('settlements', tables.settlements || [], (r) => str(r.settlement_id)),
    syncCollection(
      'editors',
      tables.editors || [],
      (r) => str(r.email).toLowerCase(),
      (r) => ({ ...r, email: str(r.email).toLowerCase() }) as unknown as Record<string, unknown>
    ),
  ]);

  const settingsRows = (tables.settings || []) as SettingRow[];
  const settingsMap = buildSettingsMapFromRows(settingsRows);
  ops.push({
    type: 'set',
    col: 'settings',
    id: 'club',
    data: settingsMap as unknown as Record<string, unknown>,
  });

  ops.push({
    type: 'set',
    col: '_meta',
    id: 'sync_state',
    data: {
      dataRevision: Date.now(),
      updatedAt: now,
      updatedBy: actorEmail,
      lastPullFromSheetAt: now,
      schemaVersion: 1,
    },
    merge: true,
  });

  onProgress?.(`Đang ghi ${ops.length} thao tác lên Cloud Firestore...`, 65);
  await commitOpsInChunks(ops);
  onProgress?.('Hoàn tất đồng bộ về Firebase!', 100);

  return {
    members: membersList.length,
    sessions: (tables.sessions || []).length,
    attendance: (tables.attendance || []).length,
    session_items: (tables.session_items || []).length,
    schedule: (tables.schedule || []).length,
    monthly_bills: (tables.monthly_bills || []).length,
    monthly_dues: (tables.monthly_dues || []).length,
    settlements: (tables.settlements || []).length,
    settings: settingsRows.length,
    editors: (tables.editors || []).length,
  };
}

// ============================================================================
// FIREBASE DATA PROVIDER
// ============================================================================

export const firebaseProvider: DataProvider = {
  mode: 'firebase',

  async fetchAllData(
    periodType: PeriodType = 'MONTH',
    refDate?: string,
    month?: string
  ): Promise<AllDataResponse> {
    try {
      const rDate = refDate || getTodayDateStr();
      const targetMonth = month || rDate.slice(0, 7);
      const dataset = await fetchScopedDataset({
        activeMonth: targetMonth,
        refDate: rDate,
        periodType,
      });
      return buildAllData(dataset, periodType, rDate, targetMonth);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchBootstrap(): Promise<BootstrapData> {
    try {
      const db = getFirebaseDb();
      const [settings, membersSnap, billsSnap] = await Promise.all([
        fetchSettingsDoc(),
        getDocs(collection(db, 'members')),
        getDocs(collection(db, 'monthly_bills')),
      ]);
      const closedMonths = snapToDocs<MonthlyBill>(billsSnap)
        .filter((b) => b.status === 'CLOSED')
        .map((b) => b.month);
      return {
        settings,
        members: snapToDocs<Member>(membersSnap),
        closedMonths,
      };
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchSessionDetail(sessionId: string): Promise<SessionDetailData> {
    try {
      const db = getFirebaseDb();
      const [sessSnap, attSnap, itemsSnap, membersSnap, settings] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(query(collection(db, 'attendance'), where('session_id', '==', sessionId))),
        getDocs(query(collection(db, 'session_items'), where('session_id', '==', sessionId))),
        getDocs(collection(db, 'members')),
        fetchSettingsDoc(),
      ]);
      if (!sessSnap.exists()) {
        throw new ApiClientError('NOT_FOUND', `Không tìm thấy buổi ${sessionId}`, 404);
      }
      const dataset: ClubDataset = {
        settings,
        members: snapToDocs<Member>(membersSnap),
        sessions: [sessSnap.data() as Session],
        attendance: snapToDocs<Attendance>(attSnap),
        session_items: snapToDocs<SessionItem>(itemsSnap),
        schedule: [],
        monthly_bills: [],
        monthly_dues: [],
        settlements: [],
        editors: [],
      };
      return buildSessionDetail(dataset, sessionId);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchSchedule(month: string): Promise<ScheduleData> {
    try {
      const dataset = await fetchScopedDataset({ activeMonth: month });
      return buildScheduleData(dataset, month);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchMonthlyBill(month: string): Promise<MonthlyBillData> {
    try {
      const dataset = await fetchScopedDataset({ activeMonth: month });
      return buildMonthlyBillData(dataset, month);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchGuestStats(month: string): Promise<GuestStatsData> {
    try {
      const dataset = await fetchScopedDataset({ activeMonth: month });
      return buildGuestStatsData(dataset, month);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async fetchDebts(): Promise<SeparatedDebtsData> {
    try {
      const dataset = await fetchScopedDataset({ activeMonth: getTodayDateStr().slice(0, 7) });
      return buildDebtsData(dataset);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async verifyEditor(idToken: string): Promise<VerifyEditorResponse> {
    try {
      const info = await verifyActorEditorRole(idToken);
      return {
        authorized: true,
        isEditor: info.isEditor,
        email: info.email,
        name: info.name,
        role: info.role,
        linkedMemberId: info.linkedMemberId,
      };
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async linkMemberEmail(
    idToken: string,
    memberId: string
  ): Promise<{ linkedMemberId: string; email: string }> {
    return trackWrite('linkMemberEmail', async () => {
      try {
        const actor = resolveCurrentActor(idToken);
        const cleanId = String(memberId || '').trim();
        if (!cleanId) {
          throw new ApiClientError('BAD_REQUEST', 'Thiếu memberId cần liên kết.', 400);
        }
        const db = getFirebaseDb();
        const [targetSnap, myPrivSnap] = await Promise.all([
          getDoc(doc(db, 'members', cleanId)),
          getDocs(query(collection(db, 'members_private'), where('email', '==', actor.email))),
        ]);
        if (!targetSnap.exists()) {
          throw new ApiClientError('NOT_FOUND', `Không tìm thấy thành viên ${cleanId}`, 404);
        }

        const now = nowIsoVN();
        const batch = writeBatch(db);
        for (const oldDoc of myPrivSnap.docs) {
          if (oldDoc.id !== cleanId) {
            batch.update(doc(db, 'members_private', oldDoc.id), {
              email: '',
              updated_at: now,
            });
          }
        }
        batch.set(
          doc(db, 'members_private', cleanId),
          {
            member_id: cleanId,
            email: actor.email,
            updated_at: now,
          },
          { merge: true }
        );
        try {
          await batch.commit();
        } catch (commitErr) {
          const code =
            typeof commitErr === 'object' && commitErr && 'code' in commitErr
              ? String((commitErr as { code: unknown }).code)
              : '';
          const msg = commitErr instanceof Error ? commitErr.message : '';
          if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
            throw new ApiClientError(
              'BAD_REQUEST',
              'Thành viên này đã được liên kết với tài khoản Google khác (hoặc email chưa xác minh).',
              400
            );
          }
          throw commitErr;
        }
        return { linkedMemberId: cleanId, email: actor.email };
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async parseBillAI(
    idToken: string,
    payload: { base64Image: string; mimeType: string; sessionDate?: string }
  ): Promise<ParseBillAIResponse> {
    if (!isGasConfigured()) {
      throw new ApiClientError(
        'BAD_REQUEST',
        'Chưa cấu hình VITE_GAS_API_URL để quét hóa đơn AI và lưu ảnh lên Google Drive.',
        400
      );
    }
    const freshToken = (await getFreshFirebaseIdToken()) || idToken;
    return gasProvider.parseBillAI(freshToken, payload);
  },

  async createSession(
    idToken: string,
    payload: CreateSessionPayload
  ): Promise<CreateSessionResponse> {
    return trackWrite('createSession', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const targetMonth = String(payload.date || getTodayDateStr()).slice(0, 7);
        const cleanPlanId = String(payload.planId || '').trim();
        const [settings, membersSnap, scheduleSnap, extraPlanSnap] = await Promise.all([
          fetchSettingsDoc(),
          getDocs(collection(db, 'members')),
          getDocs(query(collection(db, 'schedule'), where('month', '==', targetMonth))),
          cleanPlanId ? getDoc(doc(db, 'schedule', cleanPlanId)) : Promise.resolve(null),
        ]);
        const scheduleRows = dedupeById(
          [
            ...snapToDocs<ScheduleDay>(scheduleSnap),
            ...(extraPlanSnap && extraPlanSnap.exists()
              ? [extraPlanSnap.data() as ScheduleDay]
              : []),
          ],
          (d) => d.plan_id
        );
        const dataset: ClubDataset = {
          settings,
          members: snapToDocs<Member>(membersSnap),
          schedule: scheduleRows,
          sessions: [],
          attendance: [],
          session_items: [],
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
          editors: [],
        };
        const plan = planCreateSession(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async updateSession(
    idToken: string,
    payload: UpdateSessionPayload
  ): Promise<{ session: Session }> {
    return trackWrite('updateSession', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const targetMonth = String(payload.date || getTodayDateStr()).slice(0, 7);
        const cleanPlanId = String(payload.planId || '').trim();
        const [settings, membersSnap, sessSnap, attSnap, itemsSnap, scheduleSnap, newPlanSnap] =
          await Promise.all([
            fetchSettingsDoc(),
            getDocs(collection(db, 'members')),
            getDoc(doc(db, 'sessions', payload.sessionId)),
            getDocs(query(collection(db, 'attendance'), where('session_id', '==', payload.sessionId))),
            getDocs(query(collection(db, 'session_items'), where('session_id', '==', payload.sessionId))),
            getDocs(query(collection(db, 'schedule'), where('month', '==', targetMonth))),
            cleanPlanId ? getDoc(doc(db, 'schedule', cleanPlanId)) : Promise.resolve(null),
          ]);
        const oldSess = sessSnap.exists() ? (sessSnap.data() as Session) : null;
        const extraSchedules: ScheduleDay[] = [];
        if (newPlanSnap && newPlanSnap.exists()) {
          extraSchedules.push(newPlanSnap.data() as ScheduleDay);
        }
        if (oldSess?.plan_id && oldSess.plan_id !== cleanPlanId) {
          const oldPlanSnap = await getDoc(doc(db, 'schedule', oldSess.plan_id));
          if (oldPlanSnap.exists()) {
            extraSchedules.push(oldPlanSnap.data() as ScheduleDay);
          }
        }
        const dataset: ClubDataset = {
          settings,
          members: snapToDocs<Member>(membersSnap),
          sessions: oldSess ? [oldSess] : [],
          attendance: snapToDocs<Attendance>(attSnap),
          session_items: snapToDocs<SessionItem>(itemsSnap),
          schedule: dedupeById(
            [...snapToDocs<ScheduleDay>(scheduleSnap), ...extraSchedules],
            (d) => d.plan_id
          ),
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
          editors: [],
        };
        const plan = planUpdateSession(dataset, payload);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async deleteSession(idToken: string, sessionId: string): Promise<{ deletedSessionId: string }> {
    return trackWrite('deleteSession', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const [settings, sessSnap, attSnap, itemsSnap] = await Promise.all([
          fetchSettingsDoc(),
          getDoc(doc(db, 'sessions', sessionId)),
          getDocs(query(collection(db, 'attendance'), where('session_id', '==', sessionId))),
          getDocs(query(collection(db, 'session_items'), where('session_id', '==', sessionId))),
        ]);
        const sessData = sessSnap.exists() ? (sessSnap.data() as Session) : null;
        let scheduleRows: ScheduleDay[] = [];
        if (sessData?.plan_id) {
          const planSnap = await getDoc(doc(db, 'schedule', sessData.plan_id));
          if (planSnap.exists()) scheduleRows = [planSnap.data() as ScheduleDay];
        }
        const dataset: ClubDataset = {
          settings,
          members: [],
          sessions: sessData ? [sessData] : [],
          attendance: snapToDocs<Attendance>(attSnap),
          session_items: snapToDocs<SessionItem>(itemsSnap),
          schedule: scheduleRows,
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
          editors: [],
        };
        const plan = planDeleteSession(dataset, sessionId);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async confirmPayment(
    idToken: string,
    payload: ConfirmPaymentPayload
  ): Promise<ConfirmPaymentResponse> {
    return trackWrite('confirmPayment', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const dataset = await fetchScopedDataset({
          activeMonth: getTodayDateStr().slice(0, 7),
        });
        const plan = planConfirmPayment(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async undoSettlement(
    idToken: string,
    settlementId: string
  ): Promise<{ undoneSettlementId: string; updatedDebts: SeparatedDebtsData }> {
    return trackWrite('undoSettlement', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const [dataset, targetSetSnap, bySettlementAttSnap, allDrinkingSetSnap] = await Promise.all([
          fetchScopedDataset({ activeMonth: getTodayDateStr().slice(0, 7) }),
          getDoc(doc(db, 'settlements', settlementId)),
          getDocs(query(collection(db, 'attendance'), where('settlement_id', '==', settlementId))),
          getDocs(query(collection(db, 'settlements'), where('category', '==', 'DRINKING'))),
        ]);

        const targetSet = targetSetSnap.exists() ? (targetSetSnap.data() as Settlement) : null;
        const drinkingSets = snapToDocs<Settlement>(allDrinkingSetSnap);
        dataset.settlements = dedupeById(
          [...dataset.settlements, ...drinkingSets, ...(targetSet ? [targetSet] : [])],
          (s) => s.settlement_id
        );

        const extraAtts = snapToDocs<Attendance>(bySettlementAttSnap);
        const sourceAttIds = String(targetSet?.source_attendance_ids || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);

        // Nếu targetSet nằm trong một đợt chốt SIMPLIFIED_TRANSFER, tải thêm các attendance của giao dịch chốt đợt
        if (targetSet && targetSet.is_reconciled && sourceAttIds.length === 0) {
          const closingSt = dataset.settlements.find((s) => {
            const raw = String(s.source_ledger_ids || '').trim();
            if (!raw.startsWith('REC:')) return false;
            const ids = raw.slice(4).split(',').map((x) => x.trim());
            return ids.includes(settlementId);
          });
          if (closingSt && closingSt.settlement_id !== settlementId) {
            const closingAttSnap = await getDocs(
              query(collection(db, 'attendance'), where('settlement_id', '==', closingSt.settlement_id))
            );
            extraAtts.push(...snapToDocs<Attendance>(closingAttSnap));
          }
        }
        if (sourceAttIds.length > 0) {
          const existingAttIds = new Set([...dataset.attendance, ...extraAtts].map((a) => a.attendance_id));
          const missingAttIds = sourceAttIds.filter((id) => !existingAttIds.has(id));
          for (let i = 0; i < missingAttIds.length; i += 30) {
            const snap = await getDocs(
              query(collection(db, 'attendance'), where(documentId(), 'in', missingAttIds.slice(i, i + 30)))
            );
            extraAtts.push(...snapToDocs<Attendance>(snap));
          }
        }
        dataset.attendance = dedupeById([...dataset.attendance, ...extraAtts], (a) => a.attendance_id);

        if ((targetSet?.category || 'DRINKING').toUpperCase() === 'DRINKING') {
          const affectedSessionIds = Array.from(
            new Set(
              dataset.attendance
                .filter(
                  (a) => a.settlement_id === settlementId || sourceAttIds.includes(a.attendance_id)
                )
                .map((a) => a.session_id)
                .filter(Boolean)
            )
          );
          if (affectedSessionIds.length > 0) {
            const loadedSessIds = new Set(dataset.sessions.map((s) => s.session_id));
            const missingSessIds = affectedSessionIds.filter((id) => !loadedSessIds.has(id));
            if (missingSessIds.length > 0) {
              const extraSessions = await fetchSessionsByIds(missingSessIds);
              dataset.sessions = dedupeById([...dataset.sessions, ...extraSessions], (s) => s.session_id);
            }
            for (let i = 0; i < affectedSessionIds.length; i += 30) {
              const chunk = affectedSessionIds.slice(i, i + 30);
              const [sessAttsSnap, sessItemsSnap] = await Promise.all([
                getDocs(query(collection(db, 'attendance'), where('session_id', 'in', chunk))),
                getDocs(query(collection(db, 'session_items'), where('session_id', 'in', chunk))),
              ]);
              dataset.attendance = dedupeById(
                [...dataset.attendance, ...snapToDocs<Attendance>(sessAttsSnap)],
                (a) => a.attendance_id
              );
              dataset.session_items = dedupeById(
                [...dataset.session_items, ...snapToDocs<SessionItem>(sessItemsSnap)],
                (it) => it.item_id
              );
            }
          }
        }

        const plan = planUndoSettlement(dataset, settlementId);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async generateSchedule(idToken: string, payload: GenerateSchedulePayload): Promise<ScheduleData> {
    return trackWrite('generateSchedule', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const dataset = await fetchScopedDataset({ activeMonth: payload.month });
        const plan = planGenerateSchedule(dataset, payload);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async updateScheduleDay(
    idToken: string,
    payload: UpdateScheduleDayPayload
  ): Promise<{ schedule?: ScheduleData; deletedPlanId?: string }> {
    return trackWrite('updateScheduleDay', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const month = (payload.date || getTodayDateStr()).slice(0, 7);
        const dataset = await fetchScopedDataset({ activeMonth: month });
        const plan = planUpdateScheduleDay(dataset, payload);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async issueMonthlyBill(
    idToken: string,
    payload: IssueMonthlyBillPayload
  ): Promise<MonthlyBillData> {
    return trackWrite('issueMonthlyBill', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const dataset = await fetchScopedDataset({ activeMonth: payload.month });
        const plan = planIssueMonthlyBill(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async saveMonthlyContributions(
    idToken: string,
    payload: SaveMonthlyContributionsPayload
  ): Promise<MonthlyBillData> {
    return trackWrite('saveMonthlyContributions', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const dataset = await fetchScopedDataset({ activeMonth: payload.month });
        const plan = planSaveMonthlyContributions(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async markDuePaid(
    idToken: string,
    payload: MarkDuePaidPayload
  ): Promise<{ monthlyBill: MonthlyBillData; debts: SeparatedDebtsData }> {
    return trackWrite('markDuePaid', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const targetDueSnap = await getDoc(doc(db, 'monthly_dues', payload.dueId));
        if (!targetDueSnap.exists()) {
          throw new ApiClientError('NOT_FOUND', `Không tìm thấy khoản thu ${payload.dueId}`, 404);
        }
        const targetDue = targetDueSnap.data() as MonthlyDue;
        const dataset = await fetchScopedDataset({ activeMonth: targetDue.month });
        dataset.monthly_dues = dedupeById([...dataset.monthly_dues, targetDue], (d) => d.due_id);
        const plan = planMarkDuePaid(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async closeMonth(idToken: string, payload: CloseMonthPayload): Promise<MonthlyBillData> {
    return trackWrite('closeMonth', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const dataset = await fetchScopedDataset({ activeMonth: payload.month });
        const plan = planCloseMonth(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async upsertMember(idToken: string, payload: UpsertMemberPayload): Promise<{ member: Member }> {
    return trackWrite('upsertMember', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const [settings, membersSnap, privSnap] = await Promise.all([
          fetchSettingsDoc(),
          getDocs(collection(db, 'members')),
          getDocs(collection(db, 'members_private')),
        ]);
        const dataset: ClubDataset = {
          settings,
          members: snapToDocs<Member>(membersSnap),
          members_private: snapToDocs<MemberPrivateRecord>(privSnap),
          sessions: [],
          attendance: [],
          session_items: [],
          schedule: [],
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
          editors: [],
        };
        const plan = planUpsertMember(dataset, payload);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async fetchMembersPrivate(idToken: string): Promise<MemberPrivateRecord[]> {
    try {
      await assertEditorActor(idToken);
      const db = getFirebaseDb();
      const [privSnap, membersSnap] = await Promise.all([
        getDocs(collection(db, 'members_private')),
        getDocs(collection(db, 'members')),
      ]);
      const privById = new Map<string, MemberPrivateRecord>(
        snapToDocs<MemberPrivateRecord>(privSnap).map((p) => [p.member_id, p])
      );
      return snapToDocs<Member>(membersSnap).map((m) => {
        const p = privById.get(m.member_id);
        return {
          member_id: m.member_id,
          phone: String(p?.phone ?? m.phone ?? '').trim(),
          email: String(p?.email ?? m.email ?? '').trim().toLowerCase(),
          updated_at: p?.updated_at || m.updated_at,
        };
      });
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async updateSettings(
    idToken: string,
    payload: UpdateSettingsPayload
  ): Promise<{ settings: SettingsMap }> {
    return trackWrite('updateSettings', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const settings = await fetchSettingsDoc();
        const dataset: ClubDataset = {
          settings,
          members: [],
          sessions: [],
          attendance: [],
          session_items: [],
          schedule: [],
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
          editors: [],
        };
        const plan = planUpdateSettings(dataset, payload, actor.email);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  async fetchEditors(idToken: string): Promise<Editor[]> {
    try {
      await assertEditorActor(idToken);
      const db = getFirebaseDb();
      const snap = await getDocs(collection(db, 'editors'));
      return snapToDocs<Editor>(snap);
    } catch (err) {
      mapFirebaseError(err);
    }
  },

  async manageEditors(idToken: string, payload: ManageEditorsPayload): Promise<Editor[]> {
    return trackWrite('manageEditors', async () => {
      try {
        const actor = await assertEditorActor(idToken);
        const db = getFirebaseDb();
        const [settings, editorsSnap] = await Promise.all([
          fetchSettingsDoc(),
          getDocs(collection(db, 'editors')),
        ]);
        const dataset: ClubDataset = {
          settings,
          editors: snapToDocs<Editor>(editorsSnap),
          members: [],
          sessions: [],
          attendance: [],
          session_items: [],
          schedule: [],
          monthly_bills: [],
          monthly_dues: [],
          settlements: [],
        };
        const plan = planManageEditors(dataset, payload, actor.email, actor.role);
        await commitMutationPlan(plan, actor.email);
        return plan.result;
      } catch (err) {
        mapFirebaseError(err);
      }
    });
  },

  subscribeChanges(onRevision: (rev: number) => void): () => void {
    if (!isFirebaseConfigured()) return () => {};
    const db = getFirebaseDb();
    let isFirst = true;
    return onSnapshot(
      doc(db, '_meta', 'sync_state'),
      (snap) => {
        if (isFirst) {
          isFirst = false;
          return;
        }
        const rev = Number(snap.data()?.dataRevision || 0);
        if (rev > 0) onRevision(rev);
      },
      () => {
        // Ignore transient offline snapshot listener error
      }
    );
  },
};
