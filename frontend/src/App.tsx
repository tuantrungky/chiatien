import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Layout, type ActiveTab } from './components/Layout';
import { ReauthModal } from './components/ReauthModal';
import { SkeletonLoader } from './components/SkeletonLoader';
import { VietQRModal, type VietQRModalData } from './components/VietQRModal';
import { useAuth } from './contexts/AuthContext';
import { useToast } from './contexts/ToastContext';
import { useClubData } from './hooks/useClubData';
import { CreateSessionPage } from './pages/CreateSessionPage';
import { DashboardPage } from './pages/DashboardPage';
import { DebtsAndSessionsPage } from './pages/DebtsAndSessionsPage';
import { FundAndGuestsPage } from './pages/FundAndGuestsPage';
import { SettingsPage } from './pages/SettingsPage';
import type { Session } from './types';

export default function App() {
  const { isEditor } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [qrModalData, setQrModalData] = useState<VietQRModalData | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  const {
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
  } = useClubData();

  useEffect(() => {
    if (!isEditor && (activeTab === 'create' || activeTab === 'settings')) {
      setActiveTab('dashboard');
      setEditingSession(null);
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
    }
    setActiveTab(tab);
  };

  const handleEditSession = (session: Session) => {
    if (!isEditor) return;
    setEditingSession(session);
    setActiveTab('create');
  };

  const handleManualRefresh = async () => {
    const ok = await refreshAll();
    if (ok) {
      toast.success('Đã đồng bộ dữ liệu mới nhất.');
    } else {
      toast.error('Không thể đồng bộ dữ liệu mới.');
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onChangeTab={handleChangeTab}
      clubName={clubName}
      treasurer={treasurer}
      refreshing={refreshing}
      lastUpdatedAt={lastUpdatedAt}
      onRefresh={() => void handleManualRefresh()}
      outstandingCount={simplifiedDebts.transfers.length}
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
        <>
          {activeTab === 'dashboard' && (
            <DashboardPage
              periodType={periodType}
              refDate={refDate}
              onChangePeriodType={setPeriodType}
              onChangeRefDate={setRefDate}
              dashboard={dashboard}
              sessions={sessions}
              fundLedger={fundLedger}
              simplifiedDebts={simplifiedDebts}
              onOpenQr={setQrModalData}
              onGoToDebts={() => setActiveTab('debts')}
            />
          )}

          {activeTab === 'debts' && (
            <DebtsAndSessionsPage
              simplifiedDebts={simplifiedDebts}
              debts={debts}
              sessions={sessions}
              onOpenQr={setQrModalData}
              onRefreshAll={async () => {
                await refreshAll();
              }}
              onEditSession={handleEditSession}
            />
          )}

          {activeTab === 'create' && isEditor && bootstrap && (
            <CreateSessionPage
              members={bootstrap.members}
              settings={bootstrap.settings}
              editingSession={editingSession}
              onCancelEdit={() => {
                setEditingSession(null);
                setActiveTab('debts');
              }}
              onSaved={async () => {
                await refreshAll();
                setEditingSession(null);
                setActiveTab('debts');
              }}
            />
          )}

          {activeTab === 'fund' && (
            <FundAndGuestsPage
              bootstrap={bootstrap}
              fundLedger={fundLedger}
              guestStats={guestStats}
              guestMonth={guestMonth}
              onChangeGuestMonth={setGuestMonth}
              onOpenQr={setQrModalData}
              onRefreshAll={async () => {
                await refreshAll();
              }}
            />
          )}

          {activeTab === 'settings' && isEditor && bootstrap && (
            <SettingsPage
              members={bootstrap.members}
              settings={bootstrap.settings}
              onRefreshAll={async () => {
                await refreshAll();
              }}
            />
          )}
        </>
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
