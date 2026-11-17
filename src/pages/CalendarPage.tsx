import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { DEFAULT_TIMEZONE, getLocalDateString } from '../domain/defaults';
import {
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  formatCurrency,
  formatSignedPercent,
  isSessionAttended,
} from '../domain/calculations';

type DayCategory =
  | 'profitable'
  | 'losing'
  | 'breakeven'
  | 'attended_no_trade'
  | 'missed'
  | 'no_session_planned'
  | 'no_record';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const { dataset, openRecordsForDate } = useWorkspace();
  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';

  const todayInTz = getLocalDateString(new Date(), timezone);
  const [initY, initM] = todayInTz.split('-').map(Number);
  const [year, setYear] = useState(initY || new Date().getFullYear());
  const [month, setMonth] = useState((initM ? initM - 1 : new Date().getMonth())); // 0-indexed

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Monday=0 ... Sunday=6
    const startOffset = (firstDay.getDay() + 6) % 7;

    const list: Array<{ date: string | null; dayNum: number | null }> = [];
    for (let i = 0; i < startOffset; i++) {
      list.push({ date: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
      list.push({ date: dateStr, dayNum: d });
    }
    while (list.length % 7 !== 0) {
      list.push({ date: null, dayNum: null });
    }
    return list;
  }, [year, month, monthPrefix]);

  const dayStats = useMemo(() => {
    const map = new Map<
      string,
      {
        pnl: number;
        hasMonetaryPnl: boolean;
        profitPercent: number | null;
        wins: number;
        losses: number;
        tradeCount: number;
        attendedCount: number;
        missedCount: number;
        plannedCount: number;
        hasJournal: boolean;
        category: DayCategory;
      }
    >();

    const allDates = new Set<string>();
    dataset.trades.forEach((t) => t.date.startsWith(monthPrefix) && allDates.add(t.date));
    dataset.sessions.forEach((s) => s.date.startsWith(monthPrefix) && allDates.add(s.date));
    dataset.dailyJournals.forEach((j) => j.date.startsWith(monthPrefix) && allDates.add(j.date));

    for (const date of allDates) {
      const trades = dataset.trades.filter((t) => t.date === date && t.status === 'closed');
      const sessions = dataset.sessions.filter((s) => s.date === date);
      const hasJournal = dataset.dailyJournals.some((j) => j.date === date);

      const dayFin = calculateFinancialMetrics(trades);
      const attendedCount = sessions.filter(
        (s) => isSessionAttended(s) || s.status === 'live' || s.status === 'completed'
      ).length;
      const missedCount = sessions.filter(
        (s) => s.status === 'missed' || s.attendanceStatus === 'missed'
      ).length;
      const plannedCount = sessions.filter((s) => s.status === 'planned').length;

      let category: DayCategory = 'no_record';
      if (trades.length > 0) {
        if (dayFin.hasMonetaryPnl) {
          if (dayFin.netPnl > 0.005) category = 'profitable';
          else if (dayFin.netPnl < -0.005) category = 'losing';
          else category = 'breakeven';
        } else if (dayFin.totalProfitPercent !== null) {
          if (dayFin.totalProfitPercent > 0.0001) category = 'profitable';
          else if (dayFin.totalProfitPercent < -0.0001) category = 'losing';
          else category = 'breakeven';
        } else {
          if (dayFin.wins > dayFin.losses) category = 'profitable';
          else if (dayFin.losses > dayFin.wins) category = 'losing';
          else category = 'breakeven';
        }
      } else if (attendedCount > 0) {
        category = 'attended_no_trade';
      } else if (missedCount > 0) {
        category = 'missed';
      } else if (hasJournal && plannedCount === 0) {
        category = 'no_session_planned';
      }

      map.set(date, {
        pnl: dayFin.netPnl,
        hasMonetaryPnl: dayFin.hasMonetaryPnl,
        profitPercent: dayFin.totalProfitPercent,
        wins: dayFin.wins,
        losses: dayFin.losses,
        tradeCount: trades.length,
        attendedCount,
        missedCount,
        plannedCount,
        hasJournal,
        category,
      });
    }
    return map;
  }, [dataset.trades, dataset.sessions, dataset.dailyJournals, monthPrefix]);

  const monthTrades = useMemo(
    () => dataset.trades.filter((t) => t.date.startsWith(monthPrefix)),
    [dataset.trades, monthPrefix]
  );
  const monthSessions = useMemo(
    () => dataset.sessions.filter((s) => s.date.startsWith(monthPrefix)),
    [dataset.sessions, monthPrefix]
  );
  const monthJournals = useMemo(
    () => dataset.dailyJournals.filter((j) => j.date.startsWith(monthPrefix)),
    [dataset.dailyJournals, monthPrefix]
  );

  const monthFinancial = useMemo(() => calculateFinancialMetrics(monthTrades), [monthTrades]);
  const monthActivity = useMemo(
    () => calculateActivityMetrics(monthSessions, monthTrades),
    [monthSessions, monthTrades]
  );
  const monthDiscipline = useMemo(
    () => calculateDisciplineMetrics(monthTrades, monthSessions, monthJournals),
    [monthTrades, monthSessions, monthJournals]
  );

  const cellStyle = (cat?: DayCategory) => {
    switch (cat) {
      case 'profitable':
        return 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/60';
      case 'losing':
        return 'bg-red-50/70 dark:bg-red-950/25 border-red-200 dark:border-red-900/60';
      case 'breakeven':
        return 'bg-neutral-100/80 dark:bg-neutral-800/40 border-neutral-300 dark:border-neutral-700';
      case 'attended_no_trade':
        return 'bg-sky-50/70 dark:bg-sky-950/25 border-sky-200 dark:border-sky-900/60';
      case 'missed':
        return 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900/60';
      case 'no_session_planned':
        return 'bg-neutral-50 dark:bg-neutral-900/30 border-neutral-200 dark:border-neutral-800';
      default:
        return 'bg-white dark:bg-[#111622] border-neutral-200 dark:border-neutral-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Monday–Sunday Trading Calendar · Click any date to view Daily / Session Records
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
            {monthLabel}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="p-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const cur = getLocalDateString(new Date(), timezone);
              const [y, m] = cur.split('-').map(Number);
              if (y && m) {
                setYear(y);
                setMonth(m - 1);
              }
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
          >
            Current Month
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="p-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-emerald-100 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-800" />
          Profitable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-800" />
          Losing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-neutral-200 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700" />
          Breakeven
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-sky-100 dark:bg-sky-950 border border-sky-300 dark:border-sky-800" />
          Attended (0 Trades)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-800" />
          Missed Session
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800" />
          No Session Planned / No Record
        </span>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
        <div className="grid grid-cols-7 gap-2 mb-2">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-xs font-medium text-neutral-500 dark:text-neutral-400 py-1"
            >
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {cells.map((cell, idx) => {
            if (!cell.date || !cell.dayNum) {
              return (
                <div
                  key={`empty_${idx}`}
                  className="min-h-[96px] rounded-md bg-neutral-50/40 dark:bg-neutral-900/20"
                />
              );
            }
            const stats = dayStats.get(cell.date);
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => openRecordsForDate(cell.date!)}
                className={`min-h-[96px] p-2.5 rounded-md border text-left flex flex-col justify-between transition-colors hover:border-neutral-400 dark:hover:border-neutral-600 cursor-pointer ${cellStyle(
                  stats?.category
                )}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-mono tabular-nums font-medium text-neutral-700 dark:text-neutral-300">
                    {cell.dayNum}
                  </span>
                  {stats && stats.attendedCount > 0 && (
                    <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">
                      {stats.attendedCount}S
                    </span>
                  )}
                </div>

                {stats ? (
                  <div className="space-y-0.5 mt-2">
                    {stats.tradeCount > 0 ? (
                      <>
                        <div
                          className={`text-xs font-mono tabular-nums font-semibold truncate ${
                            stats.category === 'profitable'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : stats.category === 'losing'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-neutral-700 dark:text-neutral-300'
                          }`}
                        >
                          {stats.hasMonetaryPnl
                            ? formatCurrency(stats.pnl, currency)
                            : stats.profitPercent !== null
                            ? formatSignedPercent(stats.profitPercent)
                            : `${stats.wins}W · ${stats.losses}L`}
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                          {stats.tradeCount} trade{stats.tradeCount > 1 ? 's' : ''}
                        </div>
                      </>
                    ) : stats.category === 'attended_no_trade' ? (
                      <div className="text-[11px] font-medium text-sky-800 dark:text-sky-300">
                        Attended · 0 trades
                      </div>
                    ) : stats.category === 'missed' ? (
                      <div className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                        Missed session
                      </div>
                    ) : (
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        Journal logged
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-600 mt-2">
                    No record
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Monthly Summaries Below Calendar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-2.5 text-xs">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Monthly Financial Summary
          </h3>
          <div className="flex justify-between">
            <span className="text-neutral-500">
              {monthFinancial.hasMonetaryPnl ? 'Net P&L' : 'Net Return %'}
            </span>
            <span className="font-mono tabular-nums font-medium">
              {monthFinancial.hasMonetaryPnl
                ? formatCurrency(monthFinancial.netPnl, currency)
                : formatSignedPercent(monthFinancial.totalProfitPercent)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Closed Trades</span>
            <span className="font-mono tabular-nums">{monthFinancial.closedTrades}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Win Rate</span>
            <span className="font-mono tabular-nums">
              {monthFinancial.winRate !== null ? `${monthFinancial.winRate.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Average R</span>
            <span className="font-mono tabular-nums">
              {monthFinancial.averageR !== null
                ? `${monthFinancial.averageR.toFixed(2)}R (n=${monthFinancial.rSampleSize})`
                : '—'}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-2.5 text-xs">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Monthly Activity Summary
          </h3>
          <div className="flex justify-between">
            <span className="text-neutral-500">Attended Sessions</span>
            <span className="font-mono tabular-nums">{monthActivity.attendedSessions}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Zero-Trade Sessions</span>
            <span className="font-mono tabular-nums">{monthActivity.zeroTradeAttendedSessions}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Missed Sessions</span>
            <span className="font-mono tabular-nums">{monthActivity.missedSessions}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Out-of-Session Trades</span>
            <span className="font-mono tabular-nums">{monthActivity.outOfSessionTrades}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-2.5 text-xs">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Monthly Discipline Summary
          </h3>
          <div className="flex justify-between">
            <span className="text-neutral-500">Followed Plan</span>
            <span className="font-mono tabular-nums">
              {monthDiscipline.followedPlanRate !== null
                ? `${monthDiscipline.followedPlanRate.toFixed(0)}% (n=${monthDiscipline.followedPlanSampleSize})`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Followed Risk Rules</span>
            <span className="font-mono tabular-nums">
              {monthDiscipline.followedRiskRate !== null
                ? `${monthDiscipline.followedRiskRate.toFixed(0)}% (n=${monthDiscipline.followedRiskSampleSize})`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Stepped Back Count</span>
            <span className="font-mono tabular-nums">{monthDiscipline.totalSteppedBackCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Checklist Completion</span>
            <span className="font-mono tabular-nums">
              {monthDiscipline.checklistCompletionRate !== null
                ? `${monthDiscipline.checklistCompletionRate.toFixed(0)}% (${monthDiscipline.checklistSampleDays}d)`
                : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
