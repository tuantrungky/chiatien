import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllData } from '../services/api';
import type {
  AllDataResponse,
  BootstrapData,
  DashboardData,
  GuestStatsData,
  MonthlyBillData,
  PeriodType,
  ScheduleData,
  SeparatedDebtsData,
  Session,
  SimplifiedDebtResult,
} from '../types';
import { getTodayDateStr } from '../utils/dateFilters';
import { simplifyDebts } from '../utils/debtSimplifier';

const SWR_PREFIX = 'cln_swr_v5';

interface SwrCachePayload {
  data: AllDataResponse;
  lastUpdatedAt: number;
}

function getCacheKey(periodType: PeriodType, refDate: string, activeMonth: string): string {
  return `${SWR_PREFIX}_${activeMonth}_${periodType}_${refDate}`;
}

function readSwrCache(key: string): SwrCachePayload | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwrCachePayload;
    if (!parsed?.data?.bootstrap || !parsed.lastUpdatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSwrCache(key: string, payload: SwrCachePayload): void {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore quota exceeded
  }
}

export interface UseClubDataResult {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  periodType: PeriodType;
  refDate: string;
  setPeriodType: (type: PeriodType) => void;
  setRefDate: (date: string) => void;
  activeMonth: string;
  setActiveMonth: (month: string) => void;
  bootstrap: BootstrapData | null;
  dashboard: DashboardData | null;
  sessions: Session[];
  debts: SeparatedDebtsData | null;
  schedule: ScheduleData | null;
  monthlyBill: MonthlyBillData | null;
  guestStats: GuestStatsData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  refreshAll: () => Promise<boolean>;
}

export function useClubData(): UseClubDataResult {
  const [periodType, setPeriodType] = useState<PeriodType>('MONTH');
  const [refDate, setRefDate] = useState<string>(() => getTodayDateStr());
  const [activeMonth, setActiveMonth] = useState<string>(() => getTodayDateStr().slice(0, 7));

  const initialCache = useRef<SwrCachePayload | null>(
    readSwrCache(getCacheKey('MONTH', getTodayDateStr(), getTodayDateStr().slice(0, 7)))
  );

  const [allData, setAllData] = useState<AllDataResponse | null>(
    () => initialCache.current?.data ?? null
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    () => initialCache.current?.lastUpdatedAt ?? null
  );
  const [loading, setLoading] = useState<boolean>(() => !initialCache.current);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(
    async (showSkeleton: boolean): Promise<boolean> => {
      const cacheKey = getCacheKey(periodType, refDate, activeMonth);
      const cached = readSwrCache(cacheKey);
      if (cached && showSkeleton) {
        setAllData(cached.data);
        setLastUpdatedAt(cached.lastUpdatedAt);
        setLoading(false);
        setRefreshing(true);
      } else if (showSkeleton) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const res = await fetchAllData(periodType, refDate, activeMonth);
        const now = Date.now();
        setAllData(res);
        setLastUpdatedAt(now);
        writeSwrCache(cacheKey, { data: res, lastUpdatedAt: now });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không thể tải dữ liệu từ máy chủ.';
        setError(msg);
        return false;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [periodType, refDate, activeMonth]
  );

  useEffect(() => {
    void loadAll(allData === null);
  }, [loadAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = useCallback(async (): Promise<boolean> => {
    return loadAll(false);
  }, [loadAll]);

  const simplifiedDrinkingDebts = useMemo<SimplifiedDebtResult>(() => {
    if (!allData) return { netBalances: [], transfers: [], totalOutstanding: 0 };
    const unreconciled = allData.debts.drinking.recentSettlements.filter(
      (s) => !s.is_reconciled
    );
    return simplifyDebts({
      attendances: allData.debts.drinking.unpaidAttendances,
      sessions: allData.sessions,
      members: allData.bootstrap.members,
      unreconciledSettlements: unreconciled,
      transferPrefix: allData.bootstrap.settings.transfer_prefix,
      vietqrTemplate: allData.bootstrap.settings.vietqr_template,
    });
  }, [allData]);

  return {
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    periodType,
    refDate,
    setPeriodType,
    setRefDate,
    activeMonth,
    setActiveMonth,
    bootstrap: allData?.bootstrap ?? null,
    dashboard: allData?.dashboard ?? null,
    sessions: allData?.sessions ?? [],
    debts: allData?.debts ?? null,
    schedule: allData?.schedule ?? null,
    monthlyBill: allData?.monthlyBill ?? null,
    guestStats: allData?.guestStats ?? null,
    simplifiedDrinkingDebts,
    refreshAll,
  };
}
