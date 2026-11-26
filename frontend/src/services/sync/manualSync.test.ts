import { describe, expect, it } from 'vitest';
import {
  initialMockAttendances,
  initialMockEditors,
  initialMockMembers,
  initialMockMonthlyBills,
  initialMockMonthlyDues,
  initialMockSchedule,
  initialMockSessionItems,
  initialMockSessions,
  initialMockSettlements,
} from '../mockData';
import type { RawClubTables } from '../providers/types';
import { computeTableComparisons, validateRawTablesSnapshot } from './manualSync';

function makeRawTables(): RawClubTables {
  return {
    members: structuredClone(initialMockMembers),
    sessions: structuredClone(initialMockSessions),
    attendance: structuredClone(initialMockAttendances),
    session_items: structuredClone(initialMockSessionItems),
    schedule: structuredClone(initialMockSchedule),
    monthly_bills: structuredClone(initialMockMonthlyBills),
    monthly_dues: structuredClone(initialMockMonthlyDues),
    settlements: structuredClone(initialMockSettlements),
    fund_ledger: [],
    settings: [],
    editors: structuredClone(initialMockEditors),
  };
}

describe('manualSync helpers', () => {
  it('computeTableComparisons tính đúng số lượng và chênh lệch cả 11 bảng', () => {
    const fb = makeRawTables();
    const sheet = makeRawTables();
    fb.members.push({ ...fb.members[0], member_id: 'MEM_999' });
    sheet.sessions.pop();

    const rows = computeTableComparisons(fb, sheet);
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.table === 'members')?.diff).toBe(1);
    expect(rows.find((r) => r.table === 'sessions')?.diff).toBe(1);
    expect(rows.find((r) => r.table === 'editors')?.diff).toBe(0);
  });

  it('validateRawTablesSnapshot từ chối snapshot thiếu hoặc rỗng danh sách Editors', () => {
    expect(() => validateRawTablesSnapshot(null, 'Google Sheets')).toThrow(/không hợp lệ/i);
    const emptyEditors = makeRawTables();
    emptyEditors.editors = [];
    expect(() => validateRawTablesSnapshot(emptyEditors, 'Google Sheets')).toThrow(/Editors/i);

    const valid = makeRawTables();
    expect(() => validateRawTablesSnapshot(valid, 'Google Sheets')).not.toThrow();
  });
});
