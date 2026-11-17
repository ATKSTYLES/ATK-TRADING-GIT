import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { SidebarLayout } from './components/SidebarLayout';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CalendarPage } from './pages/CalendarPage';
import { DailyJournalPage } from './pages/DailyJournalPage';
import { DailySessionRecordsPage } from './pages/DailySessionRecordsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettingsExportPage } from './pages/SettingsExportPage';
import { TradesPage } from './pages/TradesPage';

function WorkspaceRouter() {
  const { user, authReady, loadingData, activeRoute } = useWorkspace();

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] dark:bg-[#0B0E14] text-sm text-neutral-500">
        Initializing workspace...
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <SidebarLayout>
      {loadingData ? (
        <div className="py-20 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Loading personal trading records...
        </div>
      ) : activeRoute === 'dashboard' ? (
        <DashboardPage />
      ) : activeRoute === 'daily_journal' ? (
        <DailyJournalPage />
      ) : activeRoute === 'records' ? (
        <DailySessionRecordsPage />
      ) : activeRoute === 'trades' ? (
        <TradesPage />
      ) : activeRoute === 'calendar' ? (
        <CalendarPage />
      ) : activeRoute === 'analytics' ? (
        <AnalyticsPage />
      ) : activeRoute === 'reviews' ? (
        <ReviewsPage />
      ) : (
        <SettingsExportPage />
      )}
    </SidebarLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WorkspaceProvider>
        <WorkspaceRouter />
      </WorkspaceProvider>
    </ErrorBoundary>
  );
}
