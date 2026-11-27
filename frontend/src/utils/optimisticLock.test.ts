import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../services/providers/types';
import { assertOptimisticRevision } from './optimisticLock';

describe('assertOptimisticRevision', () => {
  it('cho phép ghi khi expectedRevision khớp liveRevision', () => {
    expect(() => assertOptimisticRevision(0, 0)).not.toThrow();
    expect(() => assertOptimisticRevision(1700000000000, 1700000000000)).not.toThrow();
  });

  it('ném CONFLICT_LOCK (409) khi liveRevision đã thay đổi', () => {
    try {
      assertOptimisticRevision(1700000000000, 1700000000001);
      expect.fail('Expected assertOptimisticRevision to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.code).toBe('CONFLICT_LOCK');
      expect(apiErr.status).toBe(409);
    }
  });
});
