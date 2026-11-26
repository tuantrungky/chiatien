import { isFirebaseConfigured } from '../firebase/config';
import {
  exportAllRawTablesFromFirestore,
  getFirestoreSyncMeta,
  importAllRawTablesToFirestore,
  markFirestorePushToSheet,
} from '../providers/firebaseProvider';
import {
  exportRawTablesFromGas,
  importRawTablesToGas,
  isGasConfigured,
} from '../providers/gasProvider';
import {
  ApiClientError,
  type RawClubTables,
  type SyncMetaState,
  type TableCountComparison,
} from '../providers/types';

export const TABLE_LABELS: Array<{ key: keyof RawClubTables; label: string }> = [
  { key: 'members', label: 'Thành viên (Members)' },
  { key: 'sessions', label: 'Buổi chơi (Sessions)' },
  { key: 'attendance', label: 'Điểm danh & Nợ (Attendance)' },
  { key: 'session_items', label: 'Món góp nhậu (Session_Items)' },
  { key: 'schedule', label: 'Lịch cố định (Schedule)' },
  { key: 'monthly_bills', label: 'Hóa đơn tháng (Monthly_Bills)' },
  { key: 'monthly_dues', label: 'Khoản thu tháng (Monthly_Dues)' },
  { key: 'settlements', label: 'Lịch sử thanh toán (Settlements)' },
  { key: 'settings', label: 'Cấu hình (Settings)' },
  { key: 'editors', label: 'Quyền Editor (Editors)' },
  { key: 'fund_ledger', label: 'Sổ quỹ lịch sử (Fund_Ledger)' },
];

export function computeTableComparisons(
  firebaseTables: RawClubTables,
  sheetTables: RawClubTables
): TableCountComparison[] {
  return TABLE_LABELS.map(({ key, label }) => {
    const firebaseCount = Array.isArray(firebaseTables[key]) ? firebaseTables[key].length : 0;
    const sheetCount = Array.isArray(sheetTables[key]) ? sheetTables[key].length : 0;
    return {
      table: key,
      label,
      firebaseCount,
      sheetCount,
      diff: firebaseCount - sheetCount,
    };
  });
}

export function validateRawTablesSnapshot(
  tables: Partial<RawClubTables> | null | undefined,
  sourceLabel: string
): asserts tables is RawClubTables {
  if (!tables || typeof tables !== 'object') {
    throw new ApiClientError('BAD_REQUEST', `Dữ liệu từ ${sourceLabel} không hợp lệ.`, 400);
  }
  const editors = tables.editors;
  if (!Array.isArray(editors) || editors.length === 0) {
    throw new ApiClientError(
      'BAD_REQUEST',
      `Dữ liệu từ ${sourceLabel} không có danh sách Editors — từ chối ghi đè để tránh tự khóa quyền ADMIN.`,
      400
    );
  }
}

function assertBothConfigured(): void {
  if (!isFirebaseConfigured()) {
    throw new ApiClientError(
      'BAD_REQUEST',
      'Chưa cấu hình biến môi trường Firebase (VITE_FIREBASE_*).',
      400
    );
  }
  if (!isGasConfigured()) {
    throw new ApiClientError(
      'BAD_REQUEST',
      'Chưa cấu hình VITE_GAS_API_URL để kết nối Google Sheets.',
      400
    );
  }
}

export async function compareFirebaseAndSheet(idToken: string): Promise<{
  comparisons: TableCountComparison[];
  meta: SyncMetaState | null;
  sheetExportedAt: string;
}> {
  assertBothConfigured();
  const [fbTables, gasRes, meta] = await Promise.all([
    exportAllRawTablesFromFirestore(),
    exportRawTablesFromGas(idToken),
    getFirestoreSyncMeta(),
  ]);
  return {
    comparisons: computeTableComparisons(fbTables, gasRes.tables),
    meta,
    sheetExportedAt: gasRes.exportedAt,
  };
}

export async function pullSheetToFirebase(
  idToken: string,
  actorEmail: string,
  onProgress?: (message: string, percent: number) => void
): Promise<{
  counts: Record<keyof RawClubTables, number>;
  exportedAt: string;
}> {
  assertBothConfigured();
  onProgress?.('Đang kéo dữ liệu 11 bảng từ Google Sheets...', 10);
  const gasRes = await exportRawTablesFromGas(idToken);
  validateRawTablesSnapshot(gasRes.tables, 'Google Sheets');
  const counts = await importAllRawTablesToFirestore(gasRes.tables, actorEmail, onProgress);
  return { counts, exportedAt: gasRes.exportedAt };
}

export async function pushFirebaseToSheet(
  idToken: string,
  actorEmail: string,
  onProgress?: (message: string, percent: number) => void
): Promise<{
  importedCounts: Record<string, number>;
  importedAt: string;
}> {
  assertBothConfigured();
  onProgress?.('Đang đọc dữ liệu từ Cloud Firestore...', 20);
  const fbTables = await exportAllRawTablesFromFirestore();
  validateRawTablesSnapshot(fbTables, 'Cloud Firestore');
  onProgress?.('Đang ghi đè 11 tab lên Google Sheets...', 60);
  const res = await importRawTablesToGas(idToken, fbTables);
  await markFirestorePushToSheet(actorEmail);
  onProgress?.('Đã sao lưu xong sang Google Sheets!', 100);
  return res;
}
