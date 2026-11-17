import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Calendar as CalendarIcon,
  ClipboardCheck,
  Clock,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { DEFAULT_TIMEZONE } from '../domain/defaults';
import { useWorkspace, type NavRoute } from '../context/WorkspaceContext';
import { ErrorDiagnosticCard } from './ErrorDiagnosticCard';

const NAV_ITEMS: Array<{
  id: NavRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'daily_journal', label: 'Daily Journal', icon: BookOpen },
  { id: 'records', label: 'Daily / Session Records', icon: Clock },
  { id: 'trades', label: 'Trades', icon: ListOrdered },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'reviews', label: 'Reviews', icon: ClipboardCheck },
  { id: 'settings', label: 'Settings & Export', icon: Settings },
];

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const {
    activeRoute,
    setActiveRoute,
    theme,
    toggleTheme,
    dataset,
    activeLiveSession,
    activeTrade,
    signOutUser,
    activeError,
    retryingDiagnostic,
    retryActiveError,
    dismissActiveError,
    openDiagnosticsView,
    pendingOperations,
  } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentNav = NAV_ITEMS.find((n) => n.id === activeRoute) ?? NAV_ITEMS[0];

  const handleSelect = (route: NavRoute) => {
    setActiveRoute(route);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-[#111622] border-r border-neutral-200 dark:border-neutral-800">
      <div className="h-14 px-5 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800">
        <span className="font-display text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
          ATK Deck
        </span>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          const isLive =
            item.id === 'daily_journal' && (activeLiveSession !== null || activeTrade !== null);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {isLive && (
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                  Live
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
        <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate">
          <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {dataset.profile?.displayName || 'Personal Trader'}
          </div>
          <div className="truncate text-neutral-500 dark:text-neutral-400">
            {dataset.profile?.timezone || DEFAULT_TIMEZONE} · {dataset.profile?.currency || 'USD'}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void toggleTheme()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#FAFAFA] dark:bg-[#0B0E14] text-neutral-900 dark:text-neutral-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-[260px] max-w-[85vw] h-full z-10">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 sticky top-0 z-30 bg-[#FAFAFA]/95 dark:bg-[#0B0E14]/95 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="text-neutral-500 dark:text-neutral-400 hidden sm:inline whitespace-nowrap">
                ATK Deck
              </span>
              <span className="text-neutral-400 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeLiveSession && activeRoute !== 'daily_journal' && (
              <button
                type="button"
                onClick={() => setActiveRoute('daily_journal')}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
              >
                Session Live · {activeLiveSession.sessionName}
              </button>
            )}
            {!activeLiveSession && activeTrade && activeRoute !== 'daily_journal' && (
              <button
                type="button"
                onClick={() => setActiveRoute('daily_journal')}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
              >
                Trade Active · {activeTrade.instrument}
              </button>
            )}
            {!activeLiveSession && !activeTrade && activeRoute !== 'daily_journal' && (
              <button
                type="button"
                onClick={() => setActiveRoute('daily_journal')}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
              >
                Open Daily Journal
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-6 space-y-5">
          {activeError && (
            <ErrorDiagnosticCard
              record={activeError}
              onRetry={() => retryActiveError()}
              retrying={retryingDiagnostic}
              onDismiss={dismissActiveError}
              onOpenDiagnostics={openDiagnosticsView}
              compact
            />
          )}
          {!activeError && pendingOperations.length > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-amber-900 dark:text-amber-200">
                <span className="font-semibold">
                  {pendingOperations.length} pending local save{pendingOperations.length > 1 ? 's' : ''}
                </span>{' '}
                waiting to finish syncing to Cloud Vault.
              </span>
              <button
                type="button"
                onClick={openDiagnosticsView}
                className="px-3 py-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-[#111622] text-amber-900 dark:text-amber-200 font-medium hover:opacity-90 cursor-pointer"
              >
                Review &amp; Retry Sync
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
