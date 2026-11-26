/**
 * writeTracker.ts
 * Theo dõi các thao tác đang ghi dữ liệu lên Database (Firebase / Google Sheet / Mock)
 * và quá trình đồng bộ lại dữ liệu ngay sau khi ghi để hiển thị Global Saving Overlay,
 * ngăn người dùng bấm trùng hoặc thoát trang giữa chừng.
 */

import { getActiveProviderMode } from '../services/providerRegistry';

function getTargetDbLabel(): string {
  const mode = getActiveProviderMode();
  if (mode === 'firebase') return 'Firebase';
  if (mode === 'gas') return 'Google Sheet';
  return 'Mock Demo';
}

const ACTION_VERBS: Record<string, string> = {
  createSession: 'Đang lưu buổi chơi lên',
  updateSession: 'Đang cập nhật buổi chơi lên',
  deleteSession: 'Đang xóa buổi chơi khỏi',
  confirmPayment: 'Đang xác nhận thanh toán lên',
  undoSettlement: 'Đang hoàn tác gạch nợ trên',
  generateSchedule: 'Đang tạo lịch tháng lên',
  updateScheduleDay: 'Đang cập nhật lịch ngày lên',
  issueMonthlyBill: 'Đang phát hành hóa đơn tháng lên',
  saveMonthlyContributions: 'Đang lưu danh sách góp cầu lên',
  markDuePaid: 'Đang gạch nợ tiền cầu tháng lên',
  closeMonth: 'Đang chốt hóa đơn tháng lên',
  upsertMember: 'Đang lưu thông tin thành viên lên',
  updateSettings: 'Đang lưu cài đặt CLB lên',
  manageEditors: 'Đang cập nhật quyền Editor lên',
};

const FIXED_ACTION_LABELS: Record<string, string> = {
  linkMemberEmail: 'Đang liên kết tài khoản thành viên...',
  parseBillAI: 'Đang tải ảnh lên Drive & quét hóa đơn AI...',
  pullSheetToFirebase: 'Đang kéo dữ liệu từ Google Sheet sang Firebase...',
  pushFirebaseToSheet: 'Đang sao lưu dữ liệu từ Firebase sang Google Sheet...',
};

export const WRITE_ACTION_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    Object.keys(ACTION_VERBS).map((k) => [k, `${ACTION_VERBS[k]} hệ thống...`])
  ),
  ...FIXED_ACTION_LABELS,
};

function resolveActionMessage(actionOrMessage: string): string {
  if (FIXED_ACTION_LABELS[actionOrMessage]) {
    return FIXED_ACTION_LABELS[actionOrMessage];
  }
  if (ACTION_VERBS[actionOrMessage]) {
    return `${ACTION_VERBS[actionOrMessage]} ${getTargetDbLabel()}...`;
  }
  return actionOrMessage || `Đang lưu dữ liệu lên ${getTargetDbLabel()}...`;
}

export interface WriteActivitySnapshot {
  activeCount: number;
  message: string;
}

interface ActiveWriteEntry {
  id: number;
  message: string;
}

let nextWriteId = 1;
let activeWrites: ActiveWriteEntry[] = [];
let lastWriteFinishedAt = 0;
let cachedSnapshot: WriteActivitySnapshot = { activeCount: 0, message: '' };
const listeners = new Set<() => void>();

function updateSnapshotAndNotify(): void {
  const nextCount = activeWrites.length;
  const nextMessage = nextCount > 0 ? activeWrites[nextCount - 1].message : '';
  if (
    cachedSnapshot.activeCount === nextCount &&
    cachedSnapshot.message === nextMessage
  ) {
    return;
  }
  cachedSnapshot = {
    activeCount: nextCount,
    message: nextMessage,
  };
  for (const listener of listeners) {
    listener();
  }
}

export function beginWrite(actionOrMessage: string): () => void {
  const id = nextWriteId++;
  const message = resolveActionMessage(actionOrMessage);
  activeWrites = [...activeWrites, { id, message }];
  updateSnapshotAndNotify();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeWrites = activeWrites.filter((entry) => entry.id !== id);
    if (activeWrites.length === 0) {
      lastWriteFinishedAt = Date.now();
    }
    updateSnapshotAndNotify();
  };
}

export async function trackWrite<T>(
  actionOrMessage: string,
  fn: () => Promise<T>
): Promise<T> {
  const end = beginWrite(actionOrMessage);
  try {
    return await fn();
  } finally {
    end();
  }
}

export function wasWriteJustFinished(windowMs = 1500): boolean {
  if (lastWriteFinishedAt <= 0) return false;
  return Date.now() - lastWriteFinishedAt <= windowMs;
}

export function subscribeWriteActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWriteActivitySnapshot(): WriteActivitySnapshot {
  return cachedSnapshot;
}

export function resetWriteTrackerForTest(): void {
  activeWrites = [];
  lastWriteFinishedAt = 0;
  cachedSnapshot = { activeCount: 0, message: '' };
}
