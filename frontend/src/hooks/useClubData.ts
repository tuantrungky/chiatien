import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchBootstrap,
  fetchDashboard,
  fetchDebts,
  fetchFundLedger,
  fetchGuestStats,
  fetchSessions,
} from '../services/api';
import type {
  BootstrapData,
  DashboardData,
  DebtsData,
  FundLedgerData,
  FundLedgerEntry,
  GuestStatsData,
  PeriodType,
  Session,
  SimplifiedDebtResult,
} from '../types';
import { getTodayDateStr } from '../utils/dateFilters';
import { simplifyDebts } from '../utils/debtSimplifier';

const SWR_CACHE_KEY = 'cln_swr_cache_v1';

interface SwrCachePayload {
  periodType: PeriodType;
  refDate: string;
  guestMonth: string;
  bootstrap: BootstrapData | null;
  dashboard: DashboardData | null;
  sessions: Session[];
  debts: DebtsData | null;
  fundLedger: FundLedgerData | null;
  guestStats: GuestStatsData | null;
  lastUpdatedAt: number;
}

function readSwrCache(): SwrCachePayload | null {
  try {
    const raw = localStorage.getItem(SWR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwrCachePayload;
    if (!parsed || !parsed.bootstrap || !parsed.lastUpdatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSwrCache(data: SwrCachePayload): void {
  try {
    localStorage.setItem(SWR_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota exceeded on private browsing
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
  guestMonth: string;
  setGuestMonth: (month: string) => void;
  bootstrap: BootstrapData | null;
  dashboard: DashboardData | null;
  sessions: Session[];
  debts: DebtsData | null;
  fundLedger: FundLedgerData | null;
  guestStats: GuestStatsData | null;
  simplifiedDebts: SimplifiedDebtResult;
  refreshAll: () => Promise<boolean>;
}

export function useClubData(): UseClubDataResult {
  const initialCache = useRef<SwrCachePayload | null>(readSwrCache());

  const [periodType, setPeriodType] = useState<PeriodType>('MONTH');
  const [refDate, setRefDate] = useState<string>(() => getTodayDateStr());
  const [guestMonth, setGuestMonth] = useState<string>(() => getTodayDateStr().slice(0, 7));

  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(
    () => initialCache.current?.bootstrap ?? null
  );
  const [dashboard, setDashboard] = useState<DashboardData | null>(
    () => initialCache.current?.dashboard ?? null
  );
  const [sessions, setSessions] = useState<Session[]>(
    () => initialCache.current?.sessions ?? []
  );
  const [debts, setDebts] = useState<DebtsData | null>(
    () => initialCache.current?.debts ?? null
  );
  const [fundLedger, setFundLedger] = useState<FundLedgerData | null>(
    () => initialCache.current?.fundLedger ?? null
  );
  const [guestStats, setGuestStats] = useState<GuestStatsData | null>(
    () => initialCache.current?.guestStats ?? null
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    () => initialCache.current?.lastUpdatedAt ?? null
  );

  // Nếu đã có SWR cache -> không chặn bằng skeleton toàn trang mà re-validate âm thầm
  const [loading, setLoading] = useState<boolean>(() => !initialCache.current);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadCoreAndPeriod = useCallback(async (showSkeleton: boolean): Promise<boolean> => {
    if (showSkeleton) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [bootRes, dashRes, sesRes, debtsRes, ledgerRes] = await Promise.all([
        fetchBootstrap(),
        fetchDashboard(periodType, refDate),
        fetchSessions({ type: 'ALL' }),
        fetchDebts(),
        fetchFundLedger(periodType, refDate, 'ALL'),
      ]);

      const now = Date.now();
      setBootstrap(bootRes);
      setDashboard(dashRes);
      setSessions(sesRes);
      setDebts(debtsRes);
      setFundLedger(ledgerRes);
      setLastUpdatedAt(now);

      writeSwrCache({
        periodType,
        refDate,
        guestMonth,
        bootstrap: bootRes,
        dashboard: dashRes,
        sessions: sesRes,
        debts: debtsRes,
        fundLedger: ledgerRes,
        guestStats,
        lastUpdatedAt: now,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tải dữ liệu từ máy chủ.';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [periodType, refDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadGuestStats = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetchGuestStats(guestMonth);
      setGuestStats(res);
      const prev = readSwrCache();
      if (prev) {
        writeSwrCache({ ...prev, guestMonth, guestStats: res });
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tải thống kê vãng lai.';
      setError(msg);
      return false;
    }
  }, [guestMonth]);

  useEffect(() => {
    void loadCoreAndPeriod(bootstrap === null);
  }, [loadCoreAndPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadGuestStats();
  }, [loadGuestStats]);

  const refreshAll = useCallback(async (): Promise<boolean> => {
    const [ok1, ok2] = await Promise.all([loadCoreAndPeriod(false), loadGuestStats()]);
    return ok1 && ok2;
  }, [loadCoreAndPeriod, loadGuestStats]);

  const simplifiedDebts = useMemo<SimplifiedDebtResult>(() => {
    if (!bootstrap || !debts) {
      return { netBalances: [], transfers: [], totalOutstanding: 0 };
    }

    const treasurerId = bootstrap.settings.treasurer_member_id;
    const unpaidReimbursements: FundLedgerEntry[] = debts.unpaidReimbursements.map((r) => ({
      ledger_id: r.ledger_id,
      date: r.date,
      type: 'EXPENSE',
      category: r.category,
      amount: r.amount,
      member_id: r.member_id,
      member_name: r.member_name,
      session_id: '',
      attendance_id: '',
      period: r.date.slice(0, 7),
      is_paid: false,
      paid_at: '',
      settlement_id: '',
      receipt_drive_id: '',
      receipt_url: '',
      description: r.description,
      created_by: '',
      created_at: '',
    }));

    const unreconciledSettlements = debts.recentSettlements.filter((s) => !s.is_reconciled);

    return simplifyDebts({
      attendances: debts.unpaidAttendances,
      sessions,
      members: bootstrap.members,
      treasurerMemberId: treasurerId,
      unpaidReimbursements,
      unreconciledSettlements,
      transferPrefix: bootstrap.settings.transfer_prefix,
      vietqrTemplate: bootstrap.settings.vietqr_template,
    });
  }, [bootstrap, debts, sessions]);

  return {
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    periodType,
    refDate,
    setPeriodType,
    setRefDate,
    guestMonth,
    setGuestMonth,
    bootstrap,
    dashboard,
    sessions,
    debts,
    fundLedger,
    guestStats,
    simplifiedDebts,
    refreshAll,
  };
}
