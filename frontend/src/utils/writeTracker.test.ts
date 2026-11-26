import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginWrite,
  getWriteActivitySnapshot,
  resetWriteTrackerForTest,
  subscribeWriteActivity,
  trackWrite,
  wasWriteJustFinished,
} from './writeTracker';

describe('writeTracker', () => {
  beforeEach(() => {
    resetWriteTrackerForTest();
  });

  it('Tăng và giảm activeCount, giữ ổn định reference của snapshot cho useSyncExternalStore', async () => {
    const snapBefore = getWriteActivitySnapshot();
    expect(snapBefore.activeCount).toBe(0);
    expect(getWriteActivitySnapshot()).toBe(snapBefore);

    let notifications = 0;
    const unsub = subscribeWriteActivity(() => {
      notifications++;
    });

    const result = await trackWrite('createSession', async () => {
      const during = getWriteActivitySnapshot();
      expect(during.activeCount).toBe(1);
      expect(during.message).toContain('buổi chơi');
      expect(getWriteActivitySnapshot()).toBe(during);
      return 'OK';
    });

    unsub();
    expect(result).toBe('OK');
    expect(getWriteActivitySnapshot().activeCount).toBe(0);
    expect(notifications).toBe(2);
    expect(wasWriteJustFinished(1500)).toBe(true);
  });

  it('Giải phóng đúng khi Promise reject và hỗ trợ giải phóng idempotent', async () => {
    await expect(
      trackWrite('markDuePaid', async () => {
        expect(getWriteActivitySnapshot().activeCount).toBe(1);
        throw new Error('GAS timeout');
      })
    ).rejects.toThrow('GAS timeout');

    expect(getWriteActivitySnapshot().activeCount).toBe(0);

    const end = beginWrite('Đang đồng bộ...');
    expect(getWriteActivitySnapshot().activeCount).toBe(1);
    end();
    end(); // Gọi lần 2 không gây lỗi hoặc âm
    expect(getWriteActivitySnapshot().activeCount).toBe(0);
  });
});
