import type {
  BadmintonAdhocDueItem,
  BadmintonGuestDueItem,
  BadmintonMonthlyDueItem,
  Member,
  SeparatedDebtsData,
  SimplifiedDebtResult,
  SimplifiedTransferDetail,
} from '../types';
import { formatDateVN } from './dateFilters';

export type DebtSourceFilter = 'ALL' | 'FIXED' | 'ADHOC' | 'GUEST' | 'DRINKING';

export interface DebtFilterState {
  searchName: string;
  collectorId: string;
  dateFilter: string;
  sourceFilter: DebtSourceFilter;
}

export const DEFAULT_DEBT_FILTER: DebtFilterState = {
  searchName: '',
  collectorId: '',
  dateFilter: '',
  sourceFilter: 'ALL',
};

export interface CollectorOption {
  id: string;
  name: string;
  isTreasurer?: boolean;
  count: number;
}

export interface DateFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface DebtCategoryCounts {
  all: number;
  fixed: number;
  adhoc: number;
  guest: number;
  drinking: number;
}

export interface FilterDebtsInput {
  debts: SeparatedDebtsData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  members: Member[];
  treasurer?: Member;
  onlyMine?: boolean;
  myMemberId?: string | null;
  filters: DebtFilterState;
}

export interface FilterDebtsResult {
  monthlyDues: BadmintonMonthlyDueItem[];
  guestDues: BadmintonGuestDueItem[];
  adhocDues: BadmintonAdhocDueItem[];
  drinkingTransfers: SimplifiedTransferDetail[];
  categoryCounts: DebtCategoryCounts;
  totalFilteredCount: number;
  totalUnfilteredCount: number;
  filteredBadmintonTotal: number;
  filteredDrinkingTotal: number;
  showBadmintonSection: boolean;
  showDrinkingSection: boolean;
}

/**
 * Chuẩn hóa chuỗi tiếng Việt (bỏ dấu, đ -> d, lowercase) để tìm kiếm không dấu trên mobile.
 */
export function normalizeViText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

export function countActiveDebtFilters(filters: DebtFilterState): number {
  let count = 0;
  if (filters.searchName.trim()) count++;
  if (filters.collectorId) count++;
  if (filters.dateFilter) count++;
  if (filters.sourceFilter !== 'ALL') count++;
  return count;
}

function resolveTreasurerId(
  debts: SeparatedDebtsData | null,
  treasurer?: Member
): string {
  return debts?.treasurerMemberId || treasurer?.member_id || '__TREASURER__';
}

export function extractCollectorOptions(
  debts: SeparatedDebtsData | null,
  simplifiedDrinkingDebts: SimplifiedDebtResult,
  treasurer?: Member
): CollectorOption[] {
  const map = new Map<string, CollectorOption>();
  const treasurerId = resolveTreasurerId(debts, treasurer);
  const treasurerName = treasurer?.name || 'Thủ quỹ';

  const upsert = (id: string, name: string, isTreasurer = false) => {
    if (!id) return;
    const existing = map.get(id);
    if (existing) {
      existing.count += 1;
      if (isTreasurer) existing.isTreasurer = true;
    } else {
      map.set(id, {
        id,
        name: name || id,
        isTreasurer,
        count: 1,
      });
    }
  };

  for (const _d of debts?.badminton.monthlyDues || []) {
    upsert(treasurerId, treasurerName, true);
  }
  for (const _g of debts?.badminton.guestDues || []) {
    upsert(treasurerId, treasurerName, true);
  }
  for (const a of debts?.badminton.adhocDues || []) {
    upsert(a.creditor_id, a.creditor_name || a.creditor_id, a.creditor_id === treasurerId);
  }
  for (const tr of simplifiedDrinkingDebts.transfers) {
    upsert(
      tr.toMember.member_id,
      tr.toMember.name || tr.toMember.member_id,
      tr.toMember.member_id === treasurerId
    );
  }

  return Array.from(map.values()).sort((a, b) => {
    if (Boolean(a.isTreasurer) !== Boolean(b.isTreasurer)) {
      return a.isTreasurer ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'vi');
  });
}

export function extractDateOptions(
  debts: SeparatedDebtsData | null,
  simplifiedDrinkingDebts: SimplifiedDebtResult
): DateFilterOption[] {
  const dayMap = new Map<string, number>();
  const monthMap = new Map<string, number>();

  for (const d of debts?.badminton.monthlyDues || []) {
    if (d.month) {
      const key = `MONTH:${d.month}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
  }

  for (const g of debts?.badminton.guestDues || []) {
    const day = String(g.session_date || '').slice(0, 10);
    if (day) {
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }
  }

  for (const a of debts?.badminton.adhocDues || []) {
    const day = String(a.session_date || '').slice(0, 10);
    if (day) {
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }
  }

  for (const tr of simplifiedDrinkingDebts.transfers) {
    const seenDatesInTransfer = new Set<string>();
    for (const b of tr.breakdownSessions) {
      const day = String(b.sessionDate || '').slice(0, 10);
      if (day && !seenDatesInTransfer.has(day)) {
        seenDatesInTransfer.add(day);
        dayMap.set(day, (dayMap.get(day) || 0) + 1);
      }
    }
  }

  const dayOptions: DateFilterOption[] = Array.from(dayMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([value, count]) => ({
      value,
      label: formatDateVN(value),
      count,
    }));

  const monthOptions: DateFilterOption[] = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([value, count]) => {
      const m = value.slice(6);
      const [yyyy, mm] = m.split('-');
      return {
        value,
        label: mm && yyyy ? `Tháng ${mm}/${yyyy}` : `Tháng ${m}`,
        count,
      };
    });

  return [...dayOptions, ...monthOptions];
}

function matchesMemberSearch(
  queryNorm: string,
  memberId: string,
  displayName: string,
  membersMap: Map<string, Member>
): boolean {
  if (!queryNorm) return true;
  if (normalizeViText(displayName).includes(queryNorm)) return true;
  const member = membersMap.get(memberId);
  if (!member) return false;
  if (normalizeViText(member.name).includes(queryNorm)) return true;
  if (member.aliases && normalizeViText(member.aliases).includes(queryNorm)) return true;
  return false;
}

export function filterDebts({
  debts,
  simplifiedDrinkingDebts,
  members,
  treasurer,
  onlyMine = false,
  myMemberId = null,
  filters,
}: FilterDebtsInput): FilterDebtsResult {
  const membersMap = new Map<string, Member>();
  for (const m of members) {
    membersMap.set(m.member_id, m);
  }

  const treasurerId = resolveTreasurerId(debts, treasurer);
  const queryNorm = normalizeViText(filters.searchName);
  const collectorId = filters.collectorId;
  const dateFilter = filters.dateFilter;
  const isMonthFilter = dateFilter.startsWith('MONTH:');
  const monthVal = isMonthFilter ? dateFilter.slice(6) : '';
  const mineActive = Boolean(onlyMine && myMemberId);

  const allMonthly = debts?.badminton.monthlyDues || [];
  const allGuest = debts?.badminton.guestDues || [];
  const allAdhoc = debts?.badminton.adhocDues || [];
  const allDrinking = simplifiedDrinkingDebts.transfers;

  const totalUnfilteredCount =
    allMonthly.length + allGuest.length + allAdhoc.length + allDrinking.length;

  const baseMonthly = allMonthly.filter((d) => {
    if (mineActive && d.member_id !== myMemberId) return false;
    if (!matchesMemberSearch(queryNorm, d.member_id, d.member_name, membersMap)) return false;
    if (collectorId && treasurerId !== collectorId) return false;
    if (dateFilter) {
      if (isMonthFilter) {
        if (d.month !== monthVal) return false;
      } else {
        if ((d.issued_at || '').slice(0, 10) !== dateFilter) return false;
      }
    }
    return true;
  });

  const baseGuest = allGuest.filter((g) => {
    if (mineActive && g.member_id !== myMemberId) return false;
    if (!matchesMemberSearch(queryNorm, g.member_id, g.member_name, membersMap)) return false;
    if (collectorId && treasurerId !== collectorId) return false;
    if (dateFilter) {
      const day = String(g.session_date || '').slice(0, 10);
      if (isMonthFilter) {
        if (day.slice(0, 7) !== monthVal) return false;
      } else if (day !== dateFilter) {
        return false;
      }
    }
    return true;
  });

  const baseAdhoc = allAdhoc.filter((a) => {
    if (mineActive && a.member_id !== myMemberId) return false;
    if (!matchesMemberSearch(queryNorm, a.member_id, a.member_name, membersMap)) return false;
    if (collectorId && a.creditor_id !== collectorId) return false;
    if (dateFilter) {
      const day = String(a.session_date || '').slice(0, 10);
      if (isMonthFilter) {
        if (day.slice(0, 7) !== monthVal) return false;
      } else if (day !== dateFilter) {
        return false;
      }
    }
    return true;
  });

  const baseDrinking = allDrinking.filter((tr) => {
    if (mineActive && tr.fromMember.member_id !== myMemberId) return false;
    if (
      !matchesMemberSearch(
        queryNorm,
        tr.fromMember.member_id,
        tr.fromMember.name,
        membersMap
      )
    ) {
      return false;
    }
    if (collectorId && tr.toMember.member_id !== collectorId) return false;
    if (dateFilter) {
      if (isMonthFilter) {
        if (!tr.breakdownSessions.some((b) => String(b.sessionDate || '').slice(0, 7) === monthVal)) {
          return false;
        }
      } else if (
        !tr.breakdownSessions.some((b) => String(b.sessionDate || '').slice(0, 10) === dateFilter)
      ) {
        return false;
      }
    }
    return true;
  });

  const categoryCounts: DebtCategoryCounts = {
    all: baseMonthly.length + baseGuest.length + baseAdhoc.length + baseDrinking.length,
    fixed: baseMonthly.length + baseGuest.length,
    adhoc: baseAdhoc.length,
    guest: baseGuest.length,
    drinking: baseDrinking.length,
  };

  let monthlyDues: BadmintonMonthlyDueItem[] = [];
  let guestDues: BadmintonGuestDueItem[] = [];
  let adhocDues: BadmintonAdhocDueItem[] = [];
  let drinkingTransfers: SimplifiedTransferDetail[] = [];

  switch (filters.sourceFilter) {
    case 'FIXED':
      monthlyDues = baseMonthly;
      guestDues = baseGuest;
      break;
    case 'ADHOC':
      adhocDues = baseAdhoc;
      break;
    case 'GUEST':
      guestDues = baseGuest;
      break;
    case 'DRINKING':
      drinkingTransfers = baseDrinking;
      break;
    case 'ALL':
    default:
      monthlyDues = baseMonthly;
      guestDues = baseGuest;
      adhocDues = baseAdhoc;
      drinkingTransfers = baseDrinking;
      break;
  }

  const filteredBadmintonTotal =
    monthlyDues.reduce((s, d) => s + d.amount, 0) +
    guestDues.reduce((s, g) => s + g.amount, 0) +
    adhocDues.reduce((s, a) => s + a.amount, 0);

  const filteredDrinkingTotal = drinkingTransfers.reduce((s, tr) => s + tr.amount, 0);

  const totalFilteredCount =
    monthlyDues.length + guestDues.length + adhocDues.length + drinkingTransfers.length;

  return {
    monthlyDues,
    guestDues,
    adhocDues,
    drinkingTransfers,
    categoryCounts,
    totalFilteredCount,
    totalUnfilteredCount,
    filteredBadmintonTotal,
    filteredDrinkingTotal,
    showBadmintonSection: filters.sourceFilter !== 'DRINKING',
    showDrinkingSection: filters.sourceFilter === 'ALL' || filters.sourceFilter === 'DRINKING',
  };
}
