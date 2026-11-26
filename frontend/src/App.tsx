import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Layout, type ActiveTab } from './components/Layout';
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

export default function App() {
  const { isEditor } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [qrModalData, setQrModalData] = useState<VietQRModalData | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [prefillPlan, setPrefillPlan] = useState<ScheduleDay | null>(null);
  const [createInitialType, setCreateInitialType] = useState<SessionType>('BADMINTON');
  const [createInitialDate, setCreateInitialDate] = useState<string | undefined>(undefined);

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
      setActiveTab('dashboard');
      setEditingSession(null);
      setPrefillPlan(null);
    }
  }, [isEditor, activeTab]);

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
    setActiveTab(tab);
  };

  const handleEditSession = (session: Session) => {
    if (!isEditor) return;
    setPrefillPlan(null);
    setEditingSession(session);
    setActiveTab('create');
  };

  const handleCheckInPlan = (plan: ScheduleDay) => {
    if (!isEditor) return;
    setEditingSession(null);
    setPrefillPlan(plan);
    setCreateInitialType('BADMINTON');
    setCreateInitialDate(plan.date);
    setActiveTab('create');
  };

  const handleCreateNewSession = (type: SessionType, date?: string) => {
    if (!isEditor) return;
    setEditingSession(null);
    setPrefillPlan(null);
    setCreateInitialType(type);
    setCreateInitialDate(date);
    setActiveTab('create');
  };

  const handleManualRefresh = async () => {
    const ok = await refreshAll();
    if (ok) toast.success('Đã đồng bộ dữ liệu mới nhất.');
    else toast.error('Không thể đồng bộ dữ liệu mới.');
  };

  const outstandingCount =
    (debts?.badminton.monthlyDues.length ?? 0) +
    (debts?.badminton.guestDues.length ?? 0) +
    simplifiedDrinkingDebts.transfers.length;

  return (
    <Layout
      activeTab={activeTab}
      onChangeTab={handleChangeTab}
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
          {activeTab === 'dashboard' && (
            <DashboardPage
              periodType={periodType}
              refDate={refDate}
              onChangePeriodType={setPeriodType}
              onChangeRefDate={setRefDate}
              bootstrap={bootstrap}
              dashboard={dashboard}
              sessions={sessions}
              debts={debts}
              simplifiedDrinkingDebts={simplifiedDrinkingDebts}
              onOpenQr={setQrModalData}
              onGoToDebts={() => setActiveTab('debts')}
            />
          )}

          {activeTab === 'calendar' && bootstrap && (
            <CalendarPage
              activeMonth={activeMonth}
              onChangeMonth={setActiveMonth}
              schedule={schedule}
              sessions={sessions}
              members={bootstrap.members}
              settings={bootstrap.settings}
              onRefreshAll={refreshAll}
              onCheckInPlan={handleCheckInPlan}
              onCreateDrinkingOnDate={(d) => handleCreateNewSession('DRINKING', d)}
            />
          )}

          {activeTab === 'debts' && (
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
          )}

          {activeTab === 'monthly' && (
            <MonthlyBadmintonPage
              bootstrap={bootstrap}
              monthlyBill={monthlyBill}
              guestStats={guestStats}
              activeMonth={activeMonth}
              onChangeMonth={setActiveMonth}
              onOpenQr={setQrModalData}
              onRefreshAll={refreshAll}
            />
          )}

          {activeTab === 'create' && isEditor && bootstrap && (
            <CreateSessionPage
              key={editingSession?.session_id || prefillPlan?.plan_id || `${createInitialType}-${createInitialDate || 'new'}`}
              members={bootstrap.members}
              settings={bootstrap.settings}
              editingSession={editingSession}
              prefillPlan={prefillPlan}
              initialType={createInitialType}
              initialDate={createInitialDate}
              onCancelEdit={() => {
                setEditingSession(null);
                setPrefillPlan(null);
                setActiveTab(prefillPlan ? 'calendar' : 'debts');
              }}
              onSaved={async () => {
                await refreshAll();
                const cameFromPlan = Boolean(prefillPlan);
                setEditingSession(null);
                setPrefillPlan(null);
                setActiveTab(cameFromPlan ? 'calendar' : 'debts');
              }}
            />
          )}

          {activeTab === 'settings' && isEditor && bootstrap && (
            <SettingsPage
              members={bootstrap.members}
              settings={bootstrap.settings}
              onRefreshAll={refreshAll}
            />
          )}
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

      <ReauthModal />
    </Layout>
  );
}
