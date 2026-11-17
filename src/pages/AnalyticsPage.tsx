import { useMemo, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  calculatePsychologyMetrics,
  formatCurrency,
  formatSignedPercent,
  type PsychologyBucket,
} from '../domain/calculations';
import { DEFAULT_TIMEZONE, getLocalDateString } from '../domain/defaults';

type AnalyticsTab = 'financial' | 'activity' | 'discipline' | 'psychology';
type DateRangePreset = 'all' | 'this_month' | 'last_30' | 'last_7' | 'custom';

function shiftDateDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function AnalyticsPage() {
  const { dataset } = useWorkspace();
  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';
  const today = getLocalDateString(new Date(), timezone);
  const [tab, setTab] = useState<AnalyticsTab>('financial');
  const [accountFilter, setAccountFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [customStart, setCustomStart] = useState(`${today.slice(0, 7)}-01`);
  const [customEnd, setCustomEnd] = useState(today);

  const dateBounds = useMemo(() => {
    switch (datePreset) {
      case 'this_month':
        return { start: `${today.slice(0, 7)}-01`, end: today };
      case 'last_30':
        return { start: shiftDateDays(today, -29), end: today };
      case 'last_7':
        return { start: shiftDateDays(today, -6), end: today };
      case 'custom': {
        const start = customStart <= customEnd ? customStart : customEnd;
        const end = customStart <= customEnd ? customEnd : customStart;
        return { start, end };
      }
      default:
        return null;
    }
  }, [datePreset, today, customStart, customEnd]);

  const filteredTrades = useMemo(() => {
    return dataset.trades.filter((t) => {
      if (accountFilter !== 'all' && t.accountId !== accountFilter) return false;
      if (dateBounds && (t.date < dateBounds.start || t.date > dateBounds.end)) return false;
      return true;
    });
  }, [dataset.trades, accountFilter, dateBounds]);

  const filteredSessions = useMemo(() => {
    if (!dateBounds) return dataset.sessions;
    return dataset.sessions.filter(
      (s) => s.date >= dateBounds.start && s.date <= dateBounds.end
    );
  }, [dataset.sessions, dateBounds]);

  const filteredJournals = useMemo(() => {
    if (!dateBounds) return dataset.dailyJournals;
    return dataset.dailyJournals.filter(
      (j) => j.date >= dateBounds.start && j.date <= dateBounds.end
    );
  }, [dataset.dailyJournals, dateBounds]);

  const financial = useMemo(() => calculateFinancialMetrics(filteredTrades), [filteredTrades]);
  const activity = useMemo(
    () => calculateActivityMetrics(filteredSessions, filteredTrades),
    [filteredSessions, filteredTrades]
  );
  const discipline = useMemo(
    () => calculateDisciplineMetrics(filteredTrades, filteredSessions, filteredJournals),
    [filteredTrades, filteredSessions, filteredJournals]
  );
  const psychology = useMemo(() => calculatePsychologyMetrics(filteredTrades), [filteredTrades]);

  const monetaryClosedCount = useMemo(
    () =>
      filteredTrades.filter(
        (t) => t.status === 'closed' && typeof t.netPnl === 'number' && Number.isFinite(t.netPnl)
      ).length,
    [filteredTrades]
  );

  const renderBucketRow = (b: PsychologyBucket) => (
    <tr key={b.label} className="h-9 border-b border-neutral-100 dark:border-neutral-800/70 text-xs">
      <td className="py-2 pr-4 font-medium text-neutral-900 dark:text-neutral-100">{b.label}</td>
      <td className="py-2 px-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
        n={b.trades}
      </td>
      <td className="py-2 px-3 text-right font-mono tabular-nums">
        {b.winRate !== null ? `${b.winRate.toFixed(1)}%` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono tabular-nums">
        {b.averageR !== null ? `${b.averageR >= 0 ? '+' : ''}${b.averageR.toFixed(2)}R` : '—'}
      </td>
      <td
        className={`py-2 pl-3 text-right font-mono tabular-nums font-medium ${
          (b.hasMonetaryPnl ? b.netPnl : b.totalProfitPercent ?? 0) > 0
            ? 'text-emerald-700 dark:text-emerald-400'
            : (b.hasMonetaryPnl ? b.netPnl : b.totalProfitPercent ?? 0) < 0
            ? 'text-red-700 dark:text-red-400'
            : ''
        }`}
      >
        {b.hasMonetaryPnl
          ? formatCurrency(b.netPnl, currency)
          : b.totalProfitPercent !== null
          ? formatSignedPercent(b.totalProfitPercent)
          : '—'}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Explicit Sample Sizes · Unrecorded Values Excluded · Execution Separated from Outcome
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
            Performance Analytics
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Analytics date range"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DateRangePreset)}
            className="px-3 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
          >
            <option value="all">All Time</option>
            <option value="this_month">This Month</option>
            <option value="last_30">Last 30 Days</option>
            <option value="last_7">Last 7 Days</option>
            <option value="custom">Custom Range</option>
          </select>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Start date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
              />
              <span className="text-xs text-neutral-400">to</span>
              <input
                type="date"
                aria-label="End date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
              />
            </div>
          )}

          <select
            aria-label="Analytics account filter"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
          >
            <option value="all">All Accounts ({filteredTrades.length} trades)</option>
            {dataset.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit">
        {(['financial', 'activity', 'discipline', 'psychology'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
              tab === t
                ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'financial' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[
            {
              label: financial.hasMonetaryPnl ? 'Net P&L' : 'Net Return %',
              val: financial.hasMonetaryPnl
                ? formatCurrency(financial.netPnl, currency)
                : formatSignedPercent(financial.totalProfitPercent),
              sub: `n=${financial.closedTrades} closed`,
            },
            { label: 'Win Rate', val: financial.winRate !== null ? `${financial.winRate.toFixed(1)}%` : '—', sub: `${financial.wins}W · ${financial.losses}L · ${financial.breakeven}BE` },
            { label: 'Profit Factor', val: financial.profitFactor === null ? '—' : financial.profitFactor === Infinity ? '∞' : financial.profitFactor.toFixed(2), sub: financial.hasMonetaryPnl ? `GP ${formatCurrency(financial.grossProfit, currency)}` : 'Requires monetary P&L' },
            { label: 'Expectancy / Trade', val: financial.expectancy !== null ? formatCurrency(financial.expectancy, currency) : '—', sub: `n=${monetaryClosedCount} with monetary P&L` },
            { label: 'Average Win', val: financial.averageWin !== null ? formatCurrency(financial.averageWin, currency) : '—', sub: `n=${financial.wins}` },
            { label: 'Average Loss', val: financial.averageLoss !== null ? formatCurrency(-financial.averageLoss, currency) : '—', sub: `n=${financial.losses}` },
            { label: 'Largest Win', val: financial.largestWin !== null ? formatCurrency(financial.largestWin, currency) : '—', sub: 'Single trade max' },
            { label: 'Largest Loss', val: financial.largestLoss !== null ? formatCurrency(financial.largestLoss, currency) : '—', sub: 'Single trade min' },
            { label: 'Average R', val: financial.averageR !== null ? `${financial.averageR >= 0 ? '+' : ''}${financial.averageR.toFixed(2)}R` : '—', sub: `n=${financial.rSampleSize} with risk` },
            { label: 'Max Drawdown', val: financial.hasMonetaryPnl ? formatCurrency(-financial.maxDrawdown, currency) : '—', sub: 'Peak-to-trough' },
            { label: 'Max Win Streak', val: String(financial.maxWinStreak), sub: 'Consecutive wins' },
            { label: 'Max Loss Streak', val: String(financial.maxLossStreak), sub: 'Consecutive losses' },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4"
            >
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{card.label}</p>
              <p className="text-lg font-semibold font-mono tabular-nums mt-1">{card.val}</p>
              <p className="text-[11px] text-neutral-500 mt-1 tabular-nums">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[
            { label: 'Planned Sessions', val: String(activity.plannedSessions), sub: 'Pending start' },
            { label: 'Attended Sessions', val: String(activity.attendedSessions), sub: 'Includes 0-trade attended' },
            { label: 'Missed Sessions', val: String(activity.missedSessions), sub: 'Unattended' },
            { label: 'Zero-Trade Sessions', val: String(activity.zeroTradeAttendedSessions), sub: 'Patience / no setup' },
            { label: 'Session Adherence', val: activity.sessionAdherenceRate !== null ? `${activity.sessionAdherenceRate.toFixed(1)}%` : '—', sub: `n=${activity.attendedSessions + activity.missedSessions}` },
            { label: 'Valid Setup Rate', val: activity.validSetupRate !== null ? `${activity.validSetupRate.toFixed(1)}%` : '—', sub: `n=${activity.validSetupSampleSize} rated` },
            { label: 'In-Session Trades', val: String(activity.inSessionTrades), sub: 'Linked to a session' },
            { label: 'Out-of-Session Trades', val: String(activity.outOfSessionTrades), sub: 'Explicitly out-of-session' },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4"
            >
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{card.label}</p>
              <p className="text-lg font-semibold font-mono tabular-nums mt-1">{card.val}</p>
              <p className="text-[11px] text-neutral-500 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'discipline' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: 'Followed Plan', val: discipline.followedPlanRate !== null ? `${discipline.followedPlanRate.toFixed(1)}%` : '—', sub: `n=${discipline.followedPlanSampleSize}` },
              { label: 'Followed Risk Rules', val: discipline.followedRiskRate !== null ? `${discipline.followedRiskRate.toFixed(1)}%` : '—', sub: `n=${discipline.followedRiskSampleSize}` },
              { label: 'Impulsive Entries', val: discipline.impulsiveEntryRate !== null ? `${discipline.impulsiveEntryRate.toFixed(1)}%` : '—', sub: `n=${discipline.impulsiveEntrySampleSize}` },
              { label: 'Exited Per Plan', val: discipline.exitedPerPlanRate !== null ? `${discipline.exitedPerPlanRate.toFixed(1)}%` : '—', sub: `n=${discipline.exitedPerPlanSampleSize}` },
              { label: 'Stepped Back Count', val: String(discipline.totalSteppedBackCount), sub: `Across ${filteredSessions.length} session(s)` },
              { label: 'Checklist Completion', val: discipline.checklistCompletionRate !== null ? `${discipline.checklistCompletionRate.toFixed(1)}%` : '—', sub: `n=${discipline.checklistSampleDays} journal days` },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4"
              >
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{card.label}</p>
                <p className="text-lg font-semibold font-mono tabular-nums mt-1">{card.val}</p>
                <p className="text-[11px] text-neutral-500 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
            <h3 className="text-sm font-semibold mb-1">
              Execution Quality vs Financial Outcome Matrix (n={discipline.executionVsOutcome.sampleSize})
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Separating process adherence from market outcome prevents rewarding lucky rule-breaking or punishing disciplined losses.
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
                <p className="font-medium text-emerald-800 dark:text-emerald-300">Good Process · Win</p>
                <p className="text-xl font-mono font-semibold mt-1">{discipline.executionVsOutcome.goodProcessWin}</p>
              </div>
              <div className="p-4 rounded border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20">
                <p className="font-medium text-sky-800 dark:text-sky-300">Good Process · Loss</p>
                <p className="text-xl font-mono font-semibold mt-1">{discipline.executionVsOutcome.goodProcessLoss}</p>
              </div>
              <div className="p-4 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20">
                <p className="font-medium text-amber-800 dark:text-amber-300">Poor Process · Win (Lucky)</p>
                <p className="text-xl font-mono font-semibold mt-1">{discipline.executionVsOutcome.poorProcessWin}</p>
              </div>
              <div className="p-4 rounded border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20">
                <p className="font-medium text-red-800 dark:text-red-300">Poor Process · Loss</p>
                <p className="text-xl font-mono font-semibold mt-1">{discipline.executionVsOutcome.poorProcessLoss}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'psychology' && (
        <div className="space-y-6">
          <div className="p-3.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-xs text-neutral-600 dark:text-neutral-400">
            Observational comparisons only: correlation does not imply causation. Only trades with explicitly recorded psychological fields are included; unrecorded states are never inferred.
          </div>

          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">State &amp; Behavioural Comparisons</h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500">
                  <th className="py-2 pr-4 font-medium">Condition</th>
                  <th className="py-2 px-3 font-medium text-right">Sample</th>
                  <th className="py-2 px-3 font-medium text-right">Win Rate</th>
                  <th className="py-2 px-3 font-medium text-right">Avg R</th>
                  <th className="py-2 pl-3 font-medium text-right">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {renderBucketRow(psychology.focusedVsDistracted.focused)}
                {renderBucketRow(psychology.focusedVsDistracted.distracted)}
                {renderBucketRow(psychology.calmVsAnxious.calm)}
                {renderBucketRow(psychology.calmVsAnxious.anxious)}
                {renderBucketRow(psychology.impulsiveVsPlanned.planned)}
                {renderBucketRow(psychology.impulsiveVsPlanned.impulsive)}
                {renderBucketRow(psychology.tradesAfterLoss)}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold mb-3">Confidence vs Results</h3>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500">
                    <th className="py-2 pr-4 font-medium">Confidence Band</th>
                    <th className="py-2 px-3 font-medium text-right">Sample</th>
                    <th className="py-2 px-3 font-medium text-right">Win Rate</th>
                    <th className="py-2 px-3 font-medium text-right">Avg R</th>
                    <th className="py-2 pl-3 font-medium text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>{psychology.confidenceBuckets.map(renderBucketRow)}</tbody>
              </table>
            </div>

            <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4 text-xs">
              <h3 className="text-sm font-semibold">Post-Exit Emotions After Wins vs Losses</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="font-medium text-emerald-700 dark:text-emerald-400 mb-2">After Wins</p>
                  {psychology.postExitOnWins.length === 0 ? (
                    <p className="text-neutral-500">No post-win emotions recorded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {psychology.postExitOnWins.map((e) => (
                        <li key={e.emotion} className="flex justify-between">
                          <span>{e.emotion}</span>
                          <span className="font-mono tabular-nums">{e.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-medium text-red-700 dark:text-red-400 mb-2">After Losses</p>
                  {psychology.postExitOnLosses.length === 0 ? (
                    <p className="text-neutral-500">No post-loss emotions recorded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {psychology.postExitOnLosses.map((e) => (
                        <li key={e.emotion} className="flex justify-between">
                          <span>{e.emotion}</span>
                          <span className="font-mono tabular-nums">{e.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
