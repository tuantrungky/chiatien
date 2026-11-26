import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { GlobalSavingOverlay } from './components/GlobalSavingOverlay';
import { Layout, type ActiveTab } from './components/Layout';
import { MemberIdentityModal } from './components/MemberIdentityModal';
import { MobileExitGuard } from './components/MobileExitGuard';
import { ReauthModal } from './components/ReauthModal';
import { SkeletonLoader } from './components/SkeletonLoader';
import { VietQRModal, type VietQRModalData } from './components/VietQRModal';
import { useAuth } from './contexts/AuthContext';
import { useToast } from './contexts/ToastContext';
import { useClubData } from './hooks/useClubData';
import { DebtsAndSessionsPage } from './pages/DebtsAndSessionsPage';
import { MonthlyBadmintonPage } from './pages/MonthlyBadmintonPage';
import type { ScheduleDay, Session, SessionType } from './types';

// Code-splitting cho các trang nặng (Recharts, Calendar, CreateSession, Settings)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const CalendarPage = lazy(() =>
  import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage }))
);
const CreateSessionPage = lazy(() =>
  import('./pages/CreateSessionPage').then((m) => ({ default: m.CreateSessionPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

const TAB_PATHS: Record<ActiveTab, string> = {
  dashboard: '/',
  calendar: '/calendar',
  debts: '/debts',
  monthly: '/monthly',
  create: '/create',
  settings: '/settings',
};

function pathToTab(pathname: string): ActiveTab {
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/debts')) return 'debts';
  if (pathname.startsWith('/monthly')) return 'monthly';
  if (pathname.startsWith('/create')) return 'create';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'dashboard';
}

export default function App() {
  const { isEditor } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = pathToTab(location.pathname);

  const [qrModalData, setQrModalData] = useState<VietQRModalData | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [prefillPlan, setPrefillPlan] = useState<ScheduleDay | null>(null);
  const [createInitialType, setCreateInitialType] = useState<SessionType>('BADMINTON');
  const [createInitialDate, setCreateInitialDate] = useState<string | undefined>(undefined);
  const [createInitialAdhoc, setCreateInitialAdhoc] = useState<boolean>(false);

  const {
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
    bootstrap,
    dashboard,
    sessions,
    debts,
    schedule,
    monthlyBill,
    guestStats,
    simplifiedDrinkingDebts,
    refreshAll,
  } = useClubData();

  useEffect(() => {
    if (!isEditor && (activeTab === 'create' || activeTab === 'settings')) {
      navigate('/', { replace: true });
      setEditingSession(null);
      setPrefillPlan(null);
    }
  }, [isEditor, activeTab, navigate]);

  const treasurer = useMemo(
    () =>
      bootstrap?.members.find(
        (m) => m.member_id === bootstrap.settings.treasurer_member_id
      ),
    [bootstrap]
  );

  const clubName = bootstrap?.settings.club_name || 'CLB Cầu Lông & Nhậu';

  const handleChangeTab = (tab: ActiveTab) => {
    if (tab !== 'create') {
      setEditingSession(null);
      setPrefillPlan(null);
    }
    navigate(TAB_PATHS[tab]);
  };

  const handleEditSession = (session: Session) => {
    if (!isEditor) return;
    setPrefillPlan(null);
    setEditingSession(session);
    navigate('/create');
  };

  const handleCheckInPlan = (plan: ScheduleDay) => {
    if (!isEditor) return;
    setEditingSession(null);
    setPrefillPlan(plan);
    setCreateInitialType('BADMINTON');
    setCreateInitialDate(plan.date);
    setCreateInitialAdhoc(false);
    navigate('/create');
  };

  const handleCreateNewSession = (
    type: SessionType,
    options?: { date?: string; isAdhoc?: boolean }
  ) => {
    if (!isEditor) return;
    setEditingSession(null);
    setPrefillPlan(null);
    setCreateInitialType(type);
    setCreateInitialDate(options?.date);
    setCreateInitialAdhoc(Boolean(options?.isAdhoc));
    navigate('/create');
  };

  const handleManualRefresh = async () => {
    const ok = await refreshAll();
    if (ok) toast.success('Đã đồng bộ dữ liệu mới nhất.');
    else toast.error('Không thể đồng bộ dữ liệu mới.');
  };

  const outstandingCount =
    (debts?.badminton.monthlyDues.length ?? 0) +
    (debts?.badminton.guestDues.length ?? 0) +
    (debts?.badminton.adhocDues?.length ?? 0) +
    simplifiedDrinkingDebts.transfers.length;

  return (
    <Layout
      activeTab={activeTab}
      onChangeTab={handleChangeTab}
      onCreateSession={(t) => handleCreateNewSession(t)}
      clubName={clubName}
      treasurer={treasurer}
      refreshing={refreshing}
      lastUpdatedAt={lastUpdatedAt}
      onRefresh={() => void handleManualRefresh()}
      outstandingCount={outstandingCount}
    >
      {error && (
        <div className="mb-4 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-2.5 text-xs sm:text-sm text-rose-800">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Không thể tải dữ liệu mới</p>
            <p className="text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonLoader />
      ) : (
        <Suspense fallback={<SkeletonLoader />}>
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  periodType={periodType}
                  refDate={refDate}
                  onChangePeriodType={setPeriodType}
                  onChangeRefDate={setRefDate}
                  bootstrap={bootstrap}
                  dashboard={dashboard}
                  sessions={sessions}
                  debts={debts}
                  schedule={schedule}
                  monthlyBill={monthlyBill}
                  simplifiedDrinkingDebts={simplifiedDrinkingDebts}
                  onOpenQr={setQrModalData}
                  onGoToDebts={() => navigate('/debts')}
                  onGoToSessions={(type) =>
                    navigate(
                      type && type !== 'ALL' ? `/debts?tab=sessions&type=${type}` : '/debts?tab=sessions'
                    )
                  }
                  onGoToCalendar={() => navigate('/calendar')}
                  onGoToMonthly={() => navigate('/monthly')}
                  onCheckInPlan={handleCheckInPlan}
                  onCreateSession={handleCreateNewSession}
                />
              }
            />

            <Route
              path="/calendar"
              element={
                bootstrap ? (
                  <CalendarPage
                    activeMonth={activeMonth}
                    onChangeMonth={setActiveMonth}
                    schedule={schedule}
                    sessions={sessions}
                    members={bootstrap.members}
                    settings={bootstrap.settings}
                    onRefreshAll={refreshAll}
                    onCheckInPlan={handleCheckInPlan}
                    onEditSession={handleEditSession}
                    onCreateAdhocBadmintonOnDate={(d) =>
                      handleCreateNewSession('BADMINTON', { date: d, isAdhoc: true })
                    }
                    onCreateDrinkingOnDate={(d) => handleCreateNewSession('DRINKING', { date: d })}
                  />
                ) : (
                  <SkeletonLoader />
                )
              }
            />

            <Route
              path="/debts"
              element={
                <DebtsAndSessionsPage
                  bootstrap={bootstrap}
                  debts={debts}
                  simplifiedDrinkingDebts={simplifiedDrinkingDebts}
                  sessions={sessions}
                  onOpenQr={setQrModalData}
                  onRefreshAll={refreshAll}
                  onEditSession={handleEditSession}
                  onCreateNewSession={(t) => handleCreateNewSession(t)}
                />
              }
            />

            <Route
              path="/monthly"
              element={
                <MonthlyBadmintonPage
                  bootstrap={bootstrap}
                  monthlyBill={monthlyBill}
                  guestStats={guestStats}
                  activeMonth={activeMonth}
                  onChangeMonth={setActiveMonth}
                  onOpenQr={setQrModalData}
                  onRefreshAll={refreshAll}
                />
              }
            />

            <Route
              path="/create"
              element={
                isEditor && bootstrap ? (
                  <CreateSessionPage
                    key={
                      editingSession?.session_id ||
                      prefillPlan?.plan_id ||
                      `${createInitialType}-${createInitialDate || 'new'}-${createInitialAdhoc ? 'adhoc' : 'std'}`
                    }
                    members={bootstrap.members}
                    settings={bootstrap.settings}
                    editingSession={editingSession}
                    prefillPlan={prefillPlan}
                    initialType={createInitialType}
                    initialDate={createInitialDate}
                    initialAdhoc={createInitialAdhoc}
                    onCancelEdit={() => {
                      const cameFromPlan = Boolean(prefillPlan);
                      setEditingSession(null);
                      setPrefillPlan(null);
                      setCreateInitialAdhoc(false);
                      navigate(cameFromPlan ? '/calendar' : '/debts');
                    }}
                    onSaved={async () => {
                      await refreshAll();
                      const cameFromPlan = Boolean(prefillPlan);
                      setEditingSession(null);
                      setPrefillPlan(null);
                      setCreateInitialAdhoc(false);
                      navigate(cameFromPlan ? '/calendar' : '/debts');
                    }}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />

            <Route
              path="/settings"
              element={
                isEditor && bootstrap ? (
                  <SettingsPage
                    members={bootstrap.members}
                    settings={bootstrap.settings}
                    onRefreshAll={refreshAll}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      )}

      <VietQRModal
        key={
          qrModalData
            ? `${qrModalData.accountNo}-${qrModalData.amount}-${qrModalData.transferContent}`
            : 'empty'
        }
        data={qrModalData}
        onClose={() => setQrModalData(null)}
      />

      <MemberIdentityModal
        members={bootstrap?.members || []}
        onLinked={refreshAll}
      />

      <ReauthModal />

      <MobileExitGuard />

      <GlobalSavingOverlay />
    </Layout>
  );
}
