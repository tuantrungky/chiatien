import type { ReactNode } from 'react';
import {
  ArrowRightLeft,
  CalendarDays,
  LayoutDashboard,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trophy,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { IS_MOCK_MODE } from '../services/api';
import type { Member } from '../types';
import { EditorLoginButton } from './EditorLoginButton';

export type ActiveTab = 'dashboard' | 'calendar' | 'debts' | 'monthly' | 'create' | 'settings';

interface LayoutProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
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
  const d = new Date(ts);
  const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours());
  const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes());
  return `Cập nhật lúc ${hh}:${mm}`;
}

export function Layout({
  activeTab,
  onChangeTab,
  clubName,
  treasurer,
  refreshing,
  lastUpdatedAt,
  onRefresh,
  outstandingCount,
  children,
}: LayoutProps) {
  const { isEditor } = useAuth();
  const navItems = ALL_NAV_ITEMS.filter((item) => !item.editorOnly || isEditor);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900 truncate">{clubName}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                <ShieldCheck className="w-3 h-3" />
                {isEditor ? 'Editor Mode' : 'Viewer'}
              </span>
              {IS_MOCK_MODE && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  MOCK
                </span>
              )}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
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
          <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 md:hidden">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-bold text-slate-900 truncate">{clubName}</h1>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 truncate">
                    {isEditor ? 'Quản lý Editor' : 'Xem công khai'}
                  </span>
                  {IS_MOCK_MODE && (
                    <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1 rounded">
                      MOCK
                    </span>
                  )}
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
                {refreshing ? 'Đang đồng bộ Sheet...' : formatSyncTime(lastUpdatedAt)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
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
            <span>{refreshing ? 'Đang đồng bộ dữ liệu mới nhất...' : formatSyncTime(lastUpdatedAt)}</span>
            {IS_MOCK_MODE && <span className="font-semibold text-amber-700">Chế độ Demo (Mock)</span>}
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-3.5 sm:px-6 pt-4 pb-24 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Điều hướng chính"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-2px_10px_rgba(15,23,42,0.06)]"
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
                onClick={() => onChangeTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 px-1 transition-colors cursor-pointer ${
                  isActive ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 inset-x-3 h-0.5 rounded-b bg-emerald-600" />
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
