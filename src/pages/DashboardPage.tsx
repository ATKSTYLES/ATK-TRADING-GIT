import { useMemo, useState } from 'react';
import {
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  formatCurrency,
  formatSignedPercent,
  sortTradesChronologically,
} from '../domain/calculations';
import { DEFAULT_TIMEZONE, getLocalDateString } from '../domain/defaults';
import { useWorkspace } from '../context/WorkspaceContext';

type DashboardRange = 'all' | 'this_month' | 'last_30' | 'last_7' | 'today';

function shiftDateDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { dataset, setActiveRoute, openDailyJournalForDate } = useWorkspace();
  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';
  const today = getLocalDateString(new Date(), timezone);
  const currentMonth = today.slice(0, 7);
  const [dateRange, setDateRange] = useState<DashboardRange>('all');

  const rangeStart = useMemo(() => {
    switch (dateRange) {
      case 'today':
        return today;
      case 'last_7':
        return shiftDateDays(today, -6);
      case 'last_30':
        return shiftDateDays(today, -29);
      case 'this_month':
        return `${currentMonth}-01`;
      default:
        return null;
    }
  }, [dateRange, today, currentMonth]);

  const scopedTrades = useMemo(
    () => (rangeStart ? dataset.trades.filter((t) => t.date >= rangeStart && t.date <= today) : dataset.trades),
    [dataset.trades, rangeStart, today]
  );
  const scopedSessions = useMemo(
    () => (rangeStart ? dataset.sessions.filter((s) => s.date >= rangeStart && s.date <= today) : dataset.sessions),
    [dataset.sessions, rangeStart, today]
  );
  const scopedJournals = useMemo(
    () =>
      rangeStart
        ? dataset.dailyJournals.filter((j) => j.date >= rangeStart && j.date <= today)
        : dataset.dailyJournals,
    [dataset.dailyJournals, rangeStart, today]
  );

  const overallFin = useMemo(() => calculateFinancialMetrics(scopedTrades), [scopedTrades]);
  const todayTrades = useMemo(
    () => dataset.trades.filter((t) => t.date === today),
    [dataset.trades, today]
  );
  const todayFin = useMemo(() => calculateFinancialMetrics(todayTrades), [todayTrades]);
  const monthTrades = useMemo(
    () => dataset.trades.filter((t) => t.date.startsWith(currentMonth)),
    [dataset.trades, currentMonth]
  );
  const monthFin = useMemo(() => calculateFinancialMetrics(monthTrades), [monthTrades]);
  const monthSessions = useMemo(
    () => dataset.sessions.filter((s) => s.date.startsWith(currentMonth)),
    [dataset.sessions, currentMonth]
  );
  const activity = useMemo(
    () => calculateActivityMetrics(scopedSessions, scopedTrades),
    [scopedSessions, scopedTrades]
  );
  const discipline = useMemo(
    () => calculateDisciplineMetrics(scopedTrades, scopedSessions, scopedJournals),
    [scopedTrades, scopedSessions, scopedJournals]
  );

  const recentTrades = useMemo(
    () => sortTradesChronologically(scopedTrades).reverse().slice(0, 8),
    [scopedTrades]
  );
  const recentSessions = useMemo(
    () =>
      [...scopedSessions]
        .sort((a, b) => (b.actualStart || b.date).localeCompare(a.actualStart || a.date))
        .slice(0, 6),
    [scopedSessions]
  );

  const todayJournal = dataset.dailyJournals.find((j) => j.date === today);
  const todayChecklistDone = todayJournal
    ? todayJournal.checklistItems.filter((c) => c.completed).length
    : 0;
  const todayChecklistTotal = todayJournal ? todayJournal.checklistItems.length : 0;

  const rangeLabel =
    dateRange === 'all'
      ? 'All-Time'
      : dateRange === 'this_month'
      ? 'This Month'
      : dateRange === 'last_30'
      ? '30D'
      : dateRange === 'last_7'
      ? '7D'
      : 'Today';

  return (
    <div className="space-y-6">
      {/* Header Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Today · {today} · {timezone}
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
            Performance Overview
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Dashboard date range"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DashboardRange)}
            className="px-3 py-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622] text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="this_month">This Month</option>
            <option value="last_30">Last 30 Days</option>
            <option value="last_7">Last 7 Days</option>
            <option value="today">Today</option>
          </select>
          <button
            type="button"
            onClick={() => openDailyJournalForDate(today)}
            className="px-3.5 py-2 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            Daily Prep ({todayChecklistDone}/{todayChecklistTotal || 5})
          </button>
          <button
            type="button"
            onClick={() => openDailyJournalForDate(today)}
            className="px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
          >
            Open Daily Journal
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {overallFin.hasMonetaryPnl ? `Net P&L (${rangeLabel})` : `Net Return (${rangeLabel})`}
          </p>
          <p
            className={`text-xl font-semibold font-mono tabular-nums mt-1 ${
              (overallFin.hasMonetaryPnl ? overallFin.netPnl : overallFin.totalProfitPercent ?? 0) > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : (overallFin.hasMonetaryPnl ? overallFin.netPnl : overallFin.totalProfitPercent ?? 0) < 0
                ? 'text-red-700 dark:text-red-400'
                : 'text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {overallFin.hasMonetaryPnl
              ? formatCurrency(overallFin.netPnl, currency)
              : overallFin.totalProfitPercent !== null
              ? formatSignedPercent(overallFin.totalProfitPercent)
              : '—'}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            Today:{' '}
            {todayFin.hasMonetaryPnl
              ? formatCurrency(todayFin.netPnl, currency)
              : todayFin.totalProfitPercent !== null
              ? formatSignedPercent(todayFin.totalProfitPercent)
              : '—'}
          </p>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Monthly Performance</p>
          <p
            className={`text-xl font-semibold font-mono tabular-nums mt-1 ${
              (monthFin.hasMonetaryPnl ? monthFin.netPnl : monthFin.totalProfitPercent ?? 0) > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : (monthFin.hasMonetaryPnl ? monthFin.netPnl : monthFin.totalProfitPercent ?? 0) < 0
                ? 'text-red-700 dark:text-red-400'
                : 'text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {monthFin.hasMonetaryPnl
              ? formatCurrency(monthFin.netPnl, currency)
              : monthFin.totalProfitPercent !== null
              ? formatSignedPercent(monthFin.totalProfitPercent)
              : '—'}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            {monthFin.closedTrades} closed · {monthSessions.length} sessions
          </p>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Win Rate</p>
          <p className="text-xl font-semibold font-mono tabular-nums mt-1 text-neutral-900 dark:text-neutral-100">
            {overallFin.winRate !== null ? `${overallFin.winRate.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            {overallFin.wins}W · {overallFin.losses}L · {overallFin.breakeven}BE (n={overallFin.closedTrades})
          </p>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Profit Factor &amp; Avg R</p>
          <p className="text-xl font-semibold font-mono tabular-nums mt-1 text-neutral-900 dark:text-neutral-100">
            {overallFin.profitFactor === null
              ? '—'
              : overallFin.profitFactor === Infinity
              ? '∞'
              : overallFin.profitFactor.toFixed(2)}
            <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400 ml-2">
              {overallFin.averageR !== null ? `${overallFin.averageR >= 0 ? '+' : ''}${overallFin.averageR.toFixed(2)}R` : '— R'}
            </span>
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            Max DD: {overallFin.hasMonetaryPnl ? formatCurrency(-overallFin.maxDrawdown, currency) : '—'}
          </p>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Session Attendance</p>
          <p className="text-xl font-semibold font-mono tabular-nums mt-1 text-neutral-900 dark:text-neutral-100">
            {activity.sessionAdherenceRate !== null ? `${activity.sessionAdherenceRate.toFixed(0)}%` : '—'}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            {activity.attendedSessions} attended · {activity.missedSessions} missed · {activity.zeroTradeAttendedSessions} 0-trade
          </p>
        </div>
      </div>

      {/* Equity Trend + Discipline Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Cumulative Equity Curve
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Derived strictly from {overallFin.closedTrades} closed trade record(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveRoute('analytics')}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              Full Analytics
            </button>
          </div>
          {overallFin.equityCurve.length === 0 ? (
            <div className="flex-1 min-h-[200px] flex flex-col items-center justify-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-md p-6 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                No closed monetary trades recorded for this range.
              </p>
              <button
                type="button"
                onClick={() => openDailyJournalForDate(today)}
                className="mt-3 px-3.5 py-1.5 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
              >
                Log First Trade
              </button>
            </div>
          ) : (
            <EquityCurveSvg points={overallFin.equityCurve} currency={currency} />
          )}
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Discipline &amp; Process
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Execution quality separated from financial outcome
            </p>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80 text-sm">
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Followed Plan</span>
              <span className="font-mono tabular-nums font-medium">
                {discipline.followedPlanRate !== null
                  ? `${discipline.followedPlanRate.toFixed(0)}% (n=${discipline.followedPlanSampleSize})`
                  : '—'}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Followed Risk Rules</span>
              <span className="font-mono tabular-nums font-medium">
                {discipline.followedRiskRate !== null
                  ? `${discipline.followedRiskRate.toFixed(0)}% (n=${discipline.followedRiskSampleSize})`
                  : '—'}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Impulsive Entries</span>
              <span className="font-mono tabular-nums font-medium">
                {discipline.impulsiveEntryRate !== null
                  ? `${discipline.impulsiveEntryRate.toFixed(0)}% (n=${discipline.impulsiveEntrySampleSize})`
                  : '—'}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Stepped Back</span>
              <span className="font-mono tabular-nums font-medium">
                {discipline.totalSteppedBackCount}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Daily Checklist</span>
              <span className="font-mono tabular-nums font-medium">
                {discipline.checklistCompletionRate !== null
                  ? `${discipline.checklistCompletionRate.toFixed(0)}% (${discipline.checklistSampleDays}d)`
                  : '—'}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Out-of-Session Trades</span>
              <span className="font-mono tabular-nums font-medium">
                {activity.outOfSessionTrades}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Trades & Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Recent Trades
            </h3>
            <button
              type="button"
              onClick={() => setActiveRoute('trades')}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              View All ({dataset.trades.length})
            </button>
          </div>
          {recentTrades.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 py-8 text-center">
              No trades recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Instrument</th>
                    <th className="py-2 font-medium">Side</th>
                    <th className="py-2 font-medium text-right">R</th>
                    <th className="py-2 font-medium text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {recentTrades.map((t) => (
                    <tr key={t.id} className="h-9 hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                      <td className="py-2 font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {t.date}
                      </td>
                      <td className="py-2 font-medium text-neutral-900 dark:text-neutral-100">
                        {t.instrument}
                        {t.isOutOfSession && (
                          <span className="ml-1.5 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                            Out-of-session
                          </span>
                        )}
                      </td>
                      <td className="py-2 uppercase text-neutral-600 dark:text-neutral-400">
                        {t.direction}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {typeof t.realisedR === 'number'
                          ? `${t.realisedR >= 0 ? '+' : ''}${t.realisedR.toFixed(2)}R`
                          : '—'}
                      </td>
                      <td
                        className={`py-2 text-right font-mono tabular-nums font-medium ${
                          (t.netPnl ?? t.actualProfitPercent ?? 0) > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : (t.netPnl ?? t.actualProfitPercent ?? 0) < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {t.status !== 'closed'
                          ? t.status.replace('_', ' ')
                          : typeof t.netPnl === 'number'
                          ? formatCurrency(t.netPnl, currency)
                          : typeof t.actualProfitPercent === 'number'
                          ? formatSignedPercent(t.actualProfitPercent)
                          : t.result}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Recent Trading Sessions
            </h3>
            <button
              type="button"
              onClick={() => setActiveRoute('records')}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              View All ({dataset.sessions.length})
            </button>
          </div>
          {recentSessions.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 py-8 text-center">
              No trading sessions recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Session</th>
                    <th className="py-2 font-medium">Attendance</th>
                    <th className="py-2 font-medium text-right">Trades</th>
                    <th className="py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {recentSessions.map((s) => (
                    <tr key={s.id} className="h-9 hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                      <td className="py-2 font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {s.date}
                      </td>
                      <td className="py-2 font-medium text-neutral-900 dark:text-neutral-100">
                        {s.sessionName}
                      </td>
                      <td className="py-2 capitalize text-neutral-600 dark:text-neutral-400">
                        {s.attendanceStatus.replace('_', ' ')}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {dataset.trades.filter((t) => t.sessionId === s.id).length}
                      </td>
                      <td className="py-2 text-right capitalize text-neutral-700 dark:text-neutral-300">
                        {s.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EquityCurveSvg({
  points,
  currency,
}: {
  points: Array<{ index: number; date: string; equity: number }>;
  currency: string;
}) {
  const width = 640;
  const height = 210;
  const padX = 16;
  const padY = 18;

  const values = [0, ...points.map((p) => p.equity)];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const coords = [{ index: 0, date: points[0]?.date || '', equity: 0 }, ...points].map(
    (p, i, arr) => {
      const x = padX + (i / Math.max(1, arr.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.equity - minVal) / range) * (height - padY * 2);
      return { x, y, equity: p.equity, date: p.date };
    }
  );

  const pathD = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const zeroY = height - padY - ((0 - minVal) / range) * (height - padY * 2);
  const latest = points[points.length - 1];
  const strokeColor = latest.equity >= 0 ? '#16A34A' : '#DC2626';

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[210px] overflow-visible">
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-neutral-300 dark:text-neutral-700"
          strokeWidth="1"
        />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.length <= 40 &&
          coords.map((c, idx) => (
            <circle key={idx} cx={c.x} cy={c.y} r="2.5" fill={strokeColor} />
          ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-neutral-500 dark:text-neutral-400 mt-1">
        <span>Start · {formatCurrency(0, currency)}</span>
        <span>
          Peak: {formatCurrency(maxVal, currency)} · Low: {formatCurrency(minVal, currency)}
        </span>
        <span>Current · {formatCurrency(latest.equity, currency)}</span>
      </div>
    </div>
  );
}
