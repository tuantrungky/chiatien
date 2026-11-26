/**
 * writeTracker.ts
 * Theo dõi các thao tác đang ghi dữ liệu lên Google Sheet (qua GAS POST)
 * và quá trình đồng bộ lại dữ liệu ngay sau khi ghi để hiển thị Global Saving Overlay,
 * ngăn người dùng bấm trùng hoặc thoát trang giữa chừng.
 */

export const WRITE_ACTION_LABELS: Record<string, string> = {
  createSession: 'Đang lưu buổi chơi lên Google Sheet...',
  updateSession: 'Đang cập nhật buổi chơi lên Google Sheet...',
  deleteSession: 'Đang xóa buổi chơi khỏi Google Sheet...',
  confirmPayment: 'Đang xác nhận thanh toán lên Google Sheet...',
  undoSettlement: 'Đang hoàn tác gạch nợ trên Google Sheet...',
  generateSchedule: 'Đang tạo lịch tháng lên Google Sheet...',
  updateScheduleDay: 'Đang cập nhật lịch ngày lên Google Sheet...',
  issueMonthlyBill: 'Đang phát hành hóa đơn tháng lên Google Sheet...',
  saveMonthlyContributions: 'Đang lưu danh sách góp cầu lên Google Sheet...',
  markDuePaid: 'Đang gạch nợ tiền cầu tháng lên Google Sheet...',
  closeMonth: 'Đang chốt hóa đơn tháng lên Google Sheet...',
  upsertMember: 'Đang lưu thông tin thành viên lên Google Sheet...',
  updateSettings: 'Đang lưu cài đặt CLB lên Google Sheet...',
  manageEditors: 'Đang cập nhật quyền Editor lên Google Sheet...',
  linkMemberEmail: 'Đang liên kết tài khoản thành viên...',
  parseBillAI: 'Đang tải ảnh lên Drive & quét hóa đơn AI...',
};

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
  const message =
    WRITE_ACTION_LABELS[actionOrMessage] ||
    actionOrMessage ||
    'Đang lưu dữ liệu lên Google Sheet...';
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
