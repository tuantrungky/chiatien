import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  CalendarDays,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trophy,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getActiveProviderMode,
  getLocalProviderOverride,
  subscribeProviderMode,
} from '../services/providerRegistry';
import type { DbProviderMode } from '../services/api';
import type { Member } from '../types';
import { formatTimeVN } from '../utils/dateFilters';
import { EditorLoginButton } from './EditorLoginButton';

export type ActiveTab = 'dashboard' | 'calendar' | 'debts' | 'monthly' | 'create' | 'settings';

interface LayoutProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  onCreateSession: (type: 'BADMINTON' | 'DRINKING') => void;
  clubName: string;
  treasurer?: Member;
  refreshing: boolean;
  lastUpdatedAt: number | null;
  onRefresh: () => void;
  outstandingCount: number;
  children: ReactNode;
}

interface NavItem {
  id: ActiveTab;
  label: string;
  mobileLabel: string;
  icon: typeof LayoutDashboard;
  editorOnly?: boolean;
}

const ALL_NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Tổng quan',
    mobileLabel: 'Tổng quan',
    icon: LayoutDashboard,
  },
  {
    id: 'calendar',
    label: 'Lịch tháng',
    mobileLabel: 'Lịch',
    icon: CalendarDays,
  },
  {
    id: 'debts',
    label: 'Công nợ & Buổi chơi',
    mobileLabel: 'Công nợ',
    icon: ArrowRightLeft,
  },
  {
    id: 'monthly',
    label: 'Tháng cầu & Vãng lai',
    mobileLabel: 'Tháng cầu',
    icon: Wallet,
  },
  {
    id: 'settings',
    label: 'Quản trị & Cài đặt',
    mobileLabel: 'Cài đặt',
    icon: Settings,
    editorOnly: true,
  },
];

function formatSyncTime(ts: number | null): string {
  if (!ts) return 'Chưa đồng bộ';
  return `Cập nhật lúc ${formatTimeVN(ts)}`;
}

export function Layout({
  activeTab,
  onChangeTab,
  onCreateSession,
  clubName,
  treasurer,
  refreshing,
  lastUpdatedAt,
  onRefresh,
  outstandingCount,
  children,
}: LayoutProps) {
  const { isEditor, isLoggedIn } = useAuth();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [providerMode, setProviderMode] = useState<DbProviderMode>(() => getActiveProviderMode());
  const isMock = providerMode === 'mock';
  const hasOverride = Boolean(getLocalProviderOverride());
  const providerBadgeText =
    providerMode === 'firebase' ? 'FIREBASE' : providerMode === 'gas' ? 'SHEET' : 'MOCK';
  const syncStatusLabel =
    providerMode === 'firebase'
      ? 'Đang đồng bộ Firebase...'
      : providerMode === 'gas'
        ? 'Đang đồng bộ Sheet...'
        : 'Đang đồng bộ dữ liệu...';

  useEffect(() => {
    return subscribeProviderMode((next) => setProviderMode(next));
  }, []);

  const navItems = ALL_NAV_ITEMS.filter((item) => !item.editorOnly || isEditor);

  const handleSelectTab = (tab: ActiveTab) => {
    setQuickAddOpen(false);
    onChangeTab(tab);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  const handleTriggerCreate = (type: 'BADMINTON' | 'DRINKING') => {
    setQuickAddOpen(false);
    onCreateSession(type);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-1 bg-gradient-to-r from-[#1d5fa7] via-[#f59e0b] to-[#65b741]" />
        <div className="p-4 bg-gradient-to-br from-[#0f2f52] via-[#174676] to-[#1e5a96] text-white flex items-center gap-3">
          <img
            src="/logo.jpg"
            alt="Lông Ca Club"
            className="w-12 h-12 rounded-full bg-white p-0.5 object-cover ring-2 ring-amber-400 shadow-md shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold text-white truncate">{clubName}</h1>
            <p className="text-[11px] font-semibold text-amber-300 truncate">Gà nhà đá nhau</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-100 bg-white/15 px-1.5 py-0.5 rounded">
                <ShieldCheck className="w-3 h-3 text-emerald-300" />
                {isEditor ? 'Editor Mode' : isLoggedIn ? 'Thành viên' : 'Viewer'}
              </span>
              <span
                title={hasOverride ? 'Đang chuyển nguồn cục bộ trên thiết bị này' : undefined}
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  isMock
                    ? 'text-amber-900 bg-amber-300'
                    : providerMode === 'firebase'
                      ? 'text-sky-950 bg-sky-300'
                      : 'text-emerald-950 bg-emerald-300'
                }`}
              >
                {providerBadgeText}
                {hasOverride ? '*' : ''}
              </span>
            </div>
          </div>
        </div>

        {isEditor && (
          <div className="p-3 pb-1 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">
              Tạo buổi nhanh
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTriggerCreate('BADMINTON')}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buổi cầu</span>
              </button>
              <button
                type="button"
                onClick={() => handleTriggerCreate('DRINKING')}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ăn nhậu</span>
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#eef5fc] text-[#113b66] font-bold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#1d5fa7]' : 'text-slate-400'}`} />
                  {item.label}
                </span>
                {item.id === 'debts' && outstandingCount > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                    {outstandingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {treasurer && (
          <div className="p-4 m-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
            <p className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
              Thủ quỹ CLB
            </p>
            <p className="font-semibold text-slate-800 truncate">{treasurer.name}</p>
            {treasurer.bank_name && treasurer.account_no && (
              <p className="text-slate-500 truncate">
                {treasurer.bank_name} • {treasurer.account_no}
              </p>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="md:hidden h-1 bg-gradient-to-r from-[#1d5fa7] via-[#f59e0b] to-[#65b741]" />
          <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 md:hidden">
              <img
                src="/logo.jpg"
                alt="Lông Ca Club"
                className="w-9 h-9 rounded-full bg-white p-0.5 object-cover ring-2 ring-sky-200 shadow-xs shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-extrabold text-[#113b66] truncate">{clubName}</h1>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-slate-500 truncate">
                    {isEditor ? 'Quản lý Editor' : 'Gà nhà đá nhau'}
                  </span>
                  <span
                    className={`text-[9px] font-semibold px-1 rounded ${
                      isMock
                        ? 'text-amber-700 bg-amber-100'
                        : providerMode === 'firebase'
                          ? 'text-sky-700 bg-sky-100'
                          : 'text-emerald-700 bg-emerald-100'
                    }`}
                  >
                    {providerBadgeText}
                  </span>
                </div>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <h2 className="text-base font-bold text-slate-900">
                {activeTab === 'create'
                  ? 'Ghi buổi chơi'
                  : navItems.find((n) => n.id === activeTab)?.label}
              </h2>
              <span className="text-xs text-slate-400">
                {refreshing ? syncStatusLabel : formatSyncTime(lastUpdatedAt)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {isEditor && activeTab !== 'create' && (
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(true)}
                  className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition cursor-pointer"
                  aria-label="Tạo buổi mới"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              )}

              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] transition disabled:opacity-60 cursor-pointer"
                title={formatSyncTime(lastUpdatedAt)}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
                <span className="hidden sm:inline">Làm mới</span>
              </button>

              <EditorLoginButton />
            </div>
          </div>
          <div className="md:hidden px-3 py-1 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>{refreshing ? syncStatusLabel : formatSyncTime(lastUpdatedAt)}</span>
            {isMock ? (
              <span className="font-semibold text-amber-700">Chế độ Demo (Mock)</span>
            ) : (
              <span className="font-semibold text-slate-500">
                Nguồn: {providerMode === 'firebase' ? 'Firebase' : 'Google Sheet'}
                {hasOverride ? ' (Tạm đổi)' : ''}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-3.5 sm:px-6 pt-4 pb-24 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Quick-Add Bottom Sheet (thay thế nút float để không che các nút thao tác khác) */}
      {isEditor && activeTab !== 'create' && quickAddOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tạo buổi nhanh"
          className="md:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end justify-center"
          onClick={() => setQuickAddOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-3xl shadow-2xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto" />
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tạo buổi nhanh</h3>
                <p className="text-xs text-slate-500">Chọn loại buổi muốn ghi nhận</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                aria-label="Đóng menu thêm buổi"
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => handleTriggerCreate('BADMINTON')}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-emerald-50/70 hover:bg-emerald-50 border border-emerald-200 text-left cursor-pointer active:scale-[0.99] transition"
              >
                <span className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Trophy className="w-5 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">+ Buổi Cầu lông</p>
                  <p className="text-xs text-slate-500">Lịch cố định hoặc Phát sinh chia đều</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleTriggerCreate('DRINKING')}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-orange-50/70 hover:bg-orange-50 border border-orange-200 text-left cursor-pointer active:scale-[0.99] transition"
              >
                <span className="w-11 h-11 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0">
                  <Utensils className="w-5 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">+ Buổi Ăn nhậu</p>
                  <p className="text-xs text-slate-500">Ra quán hoặc góp món tại nhà</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Điều hướng chính"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-2px_10px_rgba(15,23,42,0.06)] pb-[env(safe-area-inset-bottom)]"
      >
        <div
          className={`grid h-16 max-w-lg mx-auto ${
            navItems.length === 5 ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 px-1 transition-colors cursor-pointer ${
                  isActive ? 'text-[#113b66]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 inset-x-3 h-0.5 rounded-b bg-gradient-to-r from-[#1d5fa7] to-[#65b741]" />
                )}
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.id === 'debts' && outstandingCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {outstandingCount}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] leading-none truncate max-w-full ${
                    isActive ? 'font-bold' : 'font-medium'
                  }`}
                >
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
