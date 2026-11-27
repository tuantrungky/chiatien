import { ApiClientError } from '../services/providers/types';

/**
 * Kiểm tra khóa lạc quan dựa trên dataRevision của `_meta/sync_state`.
 * Ném `CONFLICT_LOCK` (409) nếu có người khác vừa ghi đè dữ liệu trong lúc đang xử lý.
 */
export function assertOptimisticRevision(expectedRevision: number, liveRevision: number): void {
  if (expectedRevision !== liveRevision) {
    throw new ApiClientError(
      'CONFLICT_LOCK',
      'Dữ liệu vừa được một Quản trị viên khác cập nhật. Hệ thống sẽ tải lại số liệu mới nhất, vui lòng kiểm tra lại trước khi thao tác tiếp.',
      409
    );
  }
}
