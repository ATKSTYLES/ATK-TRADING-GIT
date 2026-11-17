import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  calculateFinancialMetrics,
  formatCurrency,
  formatDurationSeconds,
  formatSignedPercent,
  sortTradesChronologically,
} from '../domain/calculations';
import {
  DEFAULT_TIMEZONE,
  formatTimeInTimezone,
  formatTimestampWithSeconds,
  getLocalDateString,
  shiftDateString,
} from '../domain/defaults';
import type { Trade, TradingSession } from '../domain/types';

function computeSessionDurationSeconds(s: TradingSession): number | null {
  if (!s.actualStart || !s.actualEnd) return null;
  return Math.max(
    0,
    Math.floor((new Date(s.actualEnd).getTime() - new Date(s.actualStart).getTime()) / 1000)
  );
}

function formatOutcomeLabel(val?: string): string {
  if (!val) return '—';
  switch (val) {
    case 'trailed_be':
      return 'Trailed to BE';
    case 'not_used':
      return 'Not Used';
    case 'take_profit':
      return 'Take Profit';
    case 'stop_loss':
      return 'Stop Loss';
    case 'manual_exit':
      return 'Manual Exit';
    default:
      return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function DailySessionRecordsPage() {
  const {
    dataset,
    selectedDate,
    setSelectedDate,
    openDailyJournalForDate,
    setActiveRoute,
    markSessionOutcome,
  } = useWorkspace();

  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';
  const todayInTz = getLocalDateString(new Date(), timezone);

  const [sessionScope, setSessionScope] = useState<'selected_date' | 'all_dates'>('selected_date');
  const [inspectSession, setInspectSession] = useState<TradingSession | null>(null);
  const [inspectTrade, setInspectTrade] = useState<Trade | null>(null);

  // Quick list of dates with any saved journal, session, or trade record
  const recordedDates = useMemo(() => {
    const dates = new Set<string>();
    dataset.dailyJournals.forEach((j) => dates.add(j.date));
    dataset.sessions.forEach((s) => dates.add(s.date));
    dataset.trades.forEach((t) => dates.add(t.date));
    return Array.from(dates).sort((a, b) => b.localeCompare(a)).slice(0, 14);
  }, [dataset.dailyJournals, dataset.sessions, dataset.trades]);

  const journalForDate = useMemo(
    () => dataset.dailyJournals.find((j) => j.date === selectedDate) ?? null,
    [dataset.dailyJournals, selectedDate]
  );

  const daySessions = useMemo(
    () =>
      dataset.sessions
        .filter((s) => s.date === selectedDate)
        .sort((a, b) =>
          (a.actualStart || a.plannedStart || '').localeCompare(b.actualStart || b.plannedStart || '')
        ),
    [dataset.sessions, selectedDate]
  );

  const allSessionsSorted = useMemo(
    () =>
      [...dataset.sessions].sort((a, b) =>
        (b.actualStart || b.date).localeCompare(a.actualStart || a.date)
      ),
    [dataset.sessions]
  );

  const displayedSessions = sessionScope === 'selected_date' ? daySessions : allSessionsSorted;

  const dayTrades = useMemo(
    () => sortTradesChronologically(dataset.trades.filter((t) => t.date === selectedDate)),
    [dataset.trades, selectedDate]
  );
  const dayFin = useMemo(() => calculateFinancialMetrics(dayTrades), [dayTrades]);

  const accountMap = useMemo(
    () => new Map(dataset.accounts.map((a) => [a.id, a.name])),
    [dataset.accounts]
  );

  const sessionMap = useMemo(
    () => new Map(dataset.sessions.map((s) => [s.id, s])),
    [dataset.sessions]
  );

  const inspectSessionEvents = useMemo(() => {
    if (!inspectSession) return [];
    return dataset.sessionEvents
      .filter((e) => e.sessionId === inspectSession.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [inspectSession, dataset.sessionEvents]);

  const inspectSessionTrades = useMemo(() => {
    if (!inspectSession) return [];
    return sortTradesChronologically(
      dataset.trades.filter((t) => t.sessionId === inspectSession.id)
    );
  }, [inspectSession, dataset.trades]);

  const inspectTradeEvents = useMemo(() => {
    if (!inspectTrade) return [];
    return dataset.tradeEvents
      .filter((e) => e.tradeId === inspectTrade.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [inspectTrade, dataset.tradeEvents]);

  const inspectTradeAttachments = useMemo(() => {
    if (!inspectTrade) return [];
    return dataset.attachments.filter(
      (a) => a.entityType === 'trade' && a.entityId === inspectTrade.id
    );
  }, [inspectTrade, dataset.attachments]);

  const checklistDoneCount = journalForDate
    ? journalForDate.checklistItems.filter((c) => c.completed).length
    : 0;
  const checklistTotalCount = journalForDate ? journalForDate.checklistItems.length : 0;

  return (
    <div className="space-y-6">
      {/* ===================================================================== */}
      {/* HISTORICAL RECORDS HEADER & DATE NAVIGATION                           */}
      {/* ===================================================================== */}
      <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Historical Daily Journal &amp; Session Archive · Read directly from saved records
            </p>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
              Daily / Session Records
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate(shiftDateString(selectedDate, -1))}
              className="p-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              aria-label="Previous date"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono tabular-nums rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14] text-neutral-900 dark:text-neutral-100"
            />
            <button
              type="button"
              onClick={() => setSelectedDate(shiftDateString(selectedDate, 1))}
              className="p-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              aria-label="Next date"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {selectedDate !== todayInTz && (
              <button
                type="button"
                onClick={() => setSelectedDate(todayInTz)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => openDailyJournalForDate(selectedDate)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 cursor-pointer whitespace-nowrap"
            >
              Open in Daily Journal <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Recent Recorded Dates Quick Selector */}
        {recordedDates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-xs">
            <span className="text-neutral-500 dark:text-neutral-400 mr-1">Recorded dates:</span>
            {recordedDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`px-2.5 py-1 font-mono tabular-nums rounded-md border cursor-pointer ${
                  d === selectedDate
                    ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100'
                    : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* SAVED DAILY JOURNAL INFORMATION FOR SELECTED DATE                     */}
      {/* ===================================================================== */}
      <section className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Daily Journal Record — {selectedDate}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {journalForDate
                ? `Checklist ${checklistDoneCount}/${checklistTotalCount} · Discipline ${
                    journalForDate.disciplineRating ?? '—'
                  }/10${
                    journalForDate.dailyEmotionalState
                      ? ` · Emotion: ${journalForDate.dailyEmotionalState}`
                      : ''
                  }`
                : 'No daily journal entry saved for this date'}
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
            {daySessions.length} session(s) · {dayTrades.length} trade(s)
            {dayFin.totalProfitPercent !== null
              ? ` · ${formatSignedPercent(dayFin.totalProfitPercent)}`
              : dayFin.hasMonetaryPnl
              ? ` · ${formatCurrency(dayFin.netPnl, currency)}`
              : ''}
          </div>
        </div>

        {!journalForDate ? (
          <div className="py-6 text-center space-y-2 text-xs">
            <p className="text-neutral-500 dark:text-neutral-400">
              No daily preparation, notes, or checklist recorded for {selectedDate}.
            </p>
            <button
              type="button"
              onClick={() => openDailyJournalForDate(selectedDate)}
              className="px-3.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              Record Daily Journal for {selectedDate}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
            {/* Daily Checklist Completion */}
            <div className="lg:col-span-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Daily Checklist Completion
                </span>
                <span className="font-mono tabular-nums text-neutral-500">
                  {checklistDoneCount}/{checklistTotalCount}
                </span>
              </div>
              <div className="space-y-1.5">
                {journalForDate.checklistItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-md border ${
                      item.completed
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-neutral-700 dark:text-neutral-300'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[11px] flex items-center gap-1">
                      {item.completed ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          Done
                        </>
                      ) : (
                        'Incomplete'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily Emotions, Plan, Notes & Reflection */}
            <div className="lg:col-span-8 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Daily Emotion</span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {journalForDate.dailyEmotionalState || '—'}
                  </span>
                </div>
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Discipline Rating</span>
                  <span className="font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                    {journalForDate.disciplineRating !== undefined
                      ? `${journalForDate.disciplineRating}/10`
                      : '—'}
                  </span>
                </div>
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Timezone</span>
                  <span className="font-mono text-neutral-700 dark:text-neutral-300">
                    {journalForDate.timezone}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300 block">
                    Daily Plan
                  </span>
                  <p className="text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                    {journalForDate.plannedActivities?.trim() || '—'}
                  </p>
                </div>
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300 block">
                    Daily Notes
                  </span>
                  <p className="text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                    {journalForDate.morningNotes?.trim() || '—'}
                  </p>
                </div>
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300 block">
                    End-of-Day Reflection
                  </span>
                  <p className="text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                    {journalForDate.dailyReflection?.trim() || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* SESSION RECORDS TABLE (SELECTED DATE / ALL HISTORICAL)                */}
      {/* ===================================================================== */}
      <section className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {sessionScope === 'selected_date'
                ? `Sessions Recorded on ${selectedDate} (${daySessions.length})`
                : `All Historical Sessions (${allSessionsSorted.length})`}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Click any session row to inspect pre-session check-in, event timeline, closing notes, and linked trades
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setSessionScope('selected_date')}
              className={`px-3 py-1 rounded font-medium cursor-pointer ${
                sessionScope === 'selected_date'
                  ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Selected Date ({daySessions.length})
            </button>
            <button
              type="button"
              onClick={() => setSessionScope('all_dates')}
              className={`px-3 py-1 rounded font-medium cursor-pointer ${
                sessionScope === 'all_dates'
                  ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              All Dates ({allSessionsSorted.length})
            </button>
          </div>
        </div>

        {displayedSessions.length === 0 ? (
          <div className="p-10 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {sessionScope === 'selected_date'
              ? `No sessions recorded on ${selectedDate}.`
              : 'No sessions recorded yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                  {sessionScope === 'all_dates' && <th className="py-2.5 px-4 font-medium">Date</th>}
                  <th className="py-2.5 px-4 font-medium">Session</th>
                  <th className="py-2.5 px-3 font-medium">Attendance &amp; Status</th>
                  <th className="py-2.5 px-3 font-medium">Start / End &amp; Duration</th>
                  <th className="py-2.5 px-3 font-medium">Environment &amp; Emotion</th>
                  <th className="py-2.5 px-3 font-medium">Prep / Closing</th>
                  <th className="py-2.5 px-3 font-medium text-right">Trades</th>
                  <th className="py-2.5 px-4 font-medium text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                {displayedSessions.map((s) => {
                  const sTrades = dataset.trades.filter((t) => t.sessionId === s.id);
                  const sFin = calculateFinancialMetrics(sTrades);
                  const durSec = computeSessionDurationSeconds(s);
                  const loc =
                    s.sittingLocation === 'Other' && s.sittingLocationOther
                      ? s.sittingLocationOther
                      : s.sittingLocation;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setInspectSession(s)}
                      className="h-11 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 cursor-pointer"
                    >
                      {sessionScope === 'all_dates' && (
                        <td className="py-2 px-4 font-mono tabular-nums text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                          {s.date}
                        </td>
                      )}
                      <td className="py-2 px-4">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {s.sessionName}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {s.sessionCategory === 'custom' ? 'Custom' : 'Standard'} ·{' '}
                          {s.sessionBias || 'No bias logged'}
                        </div>
                      </td>
                      <td
                        className="py-2 px-3 capitalize"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="font-medium text-neutral-800 dark:text-neutral-200">
                          {s.attendanceStatus.replace('_', ' ')}
                        </div>
                        <div className="text-[11px] text-neutral-500 flex items-center gap-2">
                          <span>{s.status}</span>
                          {s.status === 'planned' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void markSessionOutcome(s, 'missed').catch(() => {})}
                                className="underline text-amber-700 dark:text-amber-400 cursor-pointer"
                              >
                                Mark Missed
                              </button>
                              <button
                                type="button"
                                onClick={() => void markSessionOutcome(s, 'cancelled').catch(() => {})}
                                className="underline text-neutral-500 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                        {s.actualStart
                          ? `${formatTimeInTimezone(s.actualStart, s.timezone)}–${
                              s.actualEnd ? formatTimeInTimezone(s.actualEnd, s.timezone) : 'Live'
                            }`
                          : s.plannedStart
                          ? `${s.plannedStart}–${s.plannedEnd || '?'} (Planned)`
                          : '—'}
                        <span className="block text-[11px] text-neutral-500">
                          {durSec !== null ? formatDurationSeconds(durSec) : '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-neutral-600 dark:text-neutral-400">
                        <div>{loc || '—'}</div>
                        <div className="text-[11px] text-neutral-500">
                          {s.preSessionEmotion || '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3 max-w-[220px] truncate text-neutral-600 dark:text-neutral-400">
                        {s.sessionSummary ||
                          s.closingReflection ||
                          s.preSessionPreparation ||
                          '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {sTrades.length}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums font-medium">
                        {sFin.totalProfitPercent !== null
                          ? formatSignedPercent(sFin.totalProfitPercent)
                          : sFin.hasMonetaryPnl
                          ? formatCurrency(sFin.netPnl, currency)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* TRADES LINKED TO SELECTED DATE (READ-ONLY SNAPSHOT)                   */}
      {/* ===================================================================== */}
      <section className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Trades on {selectedDate} ({dayTrades.length})
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Includes session-linked and out-of-session trades saved on this date
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveRoute('trades')}
            className="text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:underline cursor-pointer"
          >
            Open Full Trades Ledger
          </button>
        </div>

        {dayTrades.length === 0 ? (
          <p className="p-8 text-center text-xs text-neutral-500">
            No trades recorded on {selectedDate}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                  <th className="py-2 px-4 font-medium">Instrument</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Linked Session</th>
                  <th className="py-2 px-3 font-medium">Risk %</th>
                  <th className="py-2 px-4 font-medium text-right">Profit % / P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                {dayTrades.map((t) => {
                  const linkedSes = t.sessionId ? sessionMap.get(t.sessionId) : null;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setInspectTrade(t)}
                      className="h-10 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 cursor-pointer"
                    >
                      <td className="py-2 px-4 font-medium text-neutral-900 dark:text-neutral-100">
                        {t.instrument} · <span className="uppercase">{t.direction}</span>
                      </td>
                      <td className="py-2 px-3 capitalize text-neutral-600 dark:text-neutral-400">
                        {t.status.replace('_', ' ')}
                      </td>
                      <td className="py-2 px-3 text-neutral-600 dark:text-neutral-400">
                        {t.isOutOfSession
                          ? 'Out-of-Session'
                          : linkedSes
                          ? `${linkedSes.sessionName} (${linkedSes.id})`
                          : t.sessionId || 'Session'}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {t.riskPercent !== undefined ? `${t.riskPercent}%` : '—'}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums font-medium">
                        {typeof t.actualProfitPercent === 'number'
                          ? formatSignedPercent(t.actualProfitPercent)
                          : typeof t.netPnl === 'number'
                          ? formatCurrency(t.netPnl, currency)
                          : t.result}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* DRAWER: COMPLETE SESSION DETAIL                                       */}
      {/* ===================================================================== */}
      {inspectSession && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111622] h-full overflow-y-auto border-l border-neutral-200 dark:border-neutral-800 p-6 space-y-5 text-xs">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
              <div>
                <p className="font-mono text-neutral-500">
                  {inspectSession.date} ·{' '}
                  {inspectSession.sessionCategory === 'custom' ? 'Custom' : 'Standard'} ·{' '}
                  {inspectSession.id}
                </p>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {inspectSession.sessionName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectSession(null)}
                className="p-1 text-neutral-500 cursor-pointer"
                aria-label="Close session detail"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Status &amp; Attendance</span>
                <span className="font-medium capitalize">
                  {inspectSession.status} · {inspectSession.attendanceStatus.replace('_', ' ')}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Start &amp; End Times</span>
                <span className="font-mono tabular-nums font-medium">
                  {inspectSession.actualStart
                    ? `${formatTimeInTimezone(inspectSession.actualStart, inspectSession.timezone)}–${
                        inspectSession.actualEnd
                          ? formatTimeInTimezone(inspectSession.actualEnd, inspectSession.timezone)
                          : 'Live'
                      }`
                    : inspectSession.plannedStart
                    ? `${inspectSession.plannedStart}–${inspectSession.plannedEnd || '?'}`
                    : '—'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Session Duration</span>
                <span className="font-mono tabular-nums font-semibold">
                  {(() => {
                    const sec = computeSessionDurationSeconds(inspectSession);
                    return sec !== null ? formatDurationSeconds(sec) : '—';
                  })()}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Pre-Session Environment</span>
                <span className="font-medium">
                  {inspectSession.sittingLocation === 'Other' && inspectSession.sittingLocationOther
                    ? inspectSession.sittingLocationOther
                    : inspectSession.sittingLocation || '—'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Pre-Session Emotion</span>
                <span className="font-medium">{inspectSession.preSessionEmotion || '—'}</span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Session Bias</span>
                <span className="font-medium">{inspectSession.sessionBias || '—'}</span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Setup Availability</span>
                <span className="font-medium capitalize">
                  {(inspectSession.setupAvailability || 'unknown').replace(/_/g, ' ')}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Plan Adherence</span>
                <span className="font-medium capitalize">
                  {inspectSession.planAdherence || 'pending'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Stepped Back</span>
                <span className="font-mono font-medium">{inspectSession.steppedBackCount}</span>
              </div>
            </div>

            {(inspectSession.preSessionEmotionNote || inspectSession.preSessionPreparation) && (
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1.5">
                {inspectSession.preSessionEmotionNote && (
                  <p>
                    <span className="font-semibold">Pre-Session Emotion Note:</span>{' '}
                    {inspectSession.preSessionEmotionNote}
                  </p>
                )}
                {inspectSession.preSessionPreparation && (
                  <p className="whitespace-pre-wrap">
                    <span className="font-semibold">Preparation Notes:</span>{' '}
                    {inspectSession.preSessionPreparation}
                  </p>
                )}
              </div>
            )}

            {inspectSession.sessionChecklist && inspectSession.sessionChecklist.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="font-semibold">Session Checklist</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {inspectSession.sessionChecklist.map((chk) => (
                    <div
                      key={chk.id}
                      className="px-2.5 py-1.5 rounded border border-neutral-200 dark:border-neutral-800 flex items-center justify-between"
                    >
                      <span>{chk.label}</span>
                      <span className="font-mono text-[11px] text-neutral-500">
                        {chk.completed ? 'Done' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(inspectSession.sessionSummary ||
              inspectSession.closingReflection ||
              (inspectSession.postSessionEmotions &&
                inspectSession.postSessionEmotions.length > 0)) && (
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1.5">
                <h4 className="font-semibold">Session Closing Summary &amp; Reflection</h4>
                {inspectSession.sessionSummary && (
                  <p>
                    <span className="font-medium">Summary:</span> {inspectSession.sessionSummary}
                  </p>
                )}
                {inspectSession.postSessionEmotions &&
                  inspectSession.postSessionEmotions.length > 0 && (
                    <p>
                      <span className="font-medium">Post-Session Emotions:</span>{' '}
                      {inspectSession.postSessionEmotions.join(', ')}
                    </p>
                  )}
                {inspectSession.closingReflection && (
                  <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                    {inspectSession.closingReflection}
                  </p>
                )}
              </div>
            )}

            <div>
              <h4 className="font-semibold mb-2">
                Linked Trades ({inspectSessionTrades.length})
              </h4>
              {inspectSessionTrades.length === 0 ? (
                <p className="text-neutral-500">No trades taken in this session.</p>
              ) : (
                <div className="space-y-1.5">
                  {inspectSessionTrades.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectTrade(t)}
                      className="w-full p-2.5 rounded border border-neutral-200 dark:border-neutral-800 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-800/40 cursor-pointer text-left"
                    >
                      <span>
                        <span className="font-medium">
                          {t.instrument} {t.direction.toUpperCase()}
                        </span>{' '}
                        <span className="text-neutral-500">
                          · {t.status.replace('_', ' ')} · {t.setupLabel || t.entryType || 'Trade'}
                        </span>
                      </span>
                      <span className="font-mono">
                        {typeof t.actualProfitPercent === 'number'
                          ? formatSignedPercent(t.actualProfitPercent)
                          : typeof t.netPnl === 'number'
                          ? formatCurrency(t.netPnl, currency)
                          : t.result}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="font-semibold mb-2">
                Session Event Timeline ({inspectSessionEvents.length})
              </h4>
              {inspectSessionEvents.length === 0 ? (
                <p className="text-neutral-500">No session events recorded.</p>
              ) : (
                <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                  {inspectSessionEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start justify-between gap-3 py-1.5 border-b border-neutral-100 dark:border-neutral-800/60"
                    >
                      <div>
                        <p className="font-medium">{ev.label}</p>
                        {ev.notes && <p className="text-neutral-500 mt-0.5">{ev.notes}</p>}
                      </div>
                      <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                        {formatTimestampWithSeconds(ev.timestamp, ev.timezone || timezone)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* DRAWER: READ-ONLY LINKED TRADE DETAIL                                 */}
      {/* ===================================================================== */}
      {inspectTrade && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-xl bg-white dark:bg-[#111622] h-full overflow-y-auto border-l border-neutral-200 dark:border-neutral-800 p-6 space-y-5 text-xs">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
              <div>
                <p className="font-mono text-neutral-500">
                  {inspectTrade.date} · {inspectTrade.id}
                </p>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {inspectTrade.instrument} · {inspectTrade.direction.toUpperCase()}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectTrade(null)}
                className="p-1 text-neutral-500 cursor-pointer"
                aria-label="Close trade detail"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Status &amp; Result</span>
                <span className="font-medium capitalize">
                  {inspectTrade.status.replace('_', ' ')} · {inspectTrade.result}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Account</span>
                <span className="font-medium">
                  {accountMap.get(inspectTrade.accountId) || 'Account'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Session Link</span>
                <span className="font-medium">
                  {inspectTrade.isOutOfSession
                    ? 'Out-of-Session'
                    : inspectTrade.sessionId
                    ? `${sessionMap.get(inspectTrade.sessionId)?.sessionName || 'Session'} (${inspectTrade.sessionId})`
                    : '—'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Risk % / Expected %</span>
                <span className="font-mono font-semibold">
                  {inspectTrade.riskPercent !== undefined ? `${inspectTrade.riskPercent}%` : '—'} /{' '}
                  {inspectTrade.expectedProfitPercent !== undefined
                    ? `+${inspectTrade.expectedProfitPercent}%`
                    : '—'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Actual Profit %</span>
                <span className="font-mono font-semibold">
                  {formatSignedPercent(inspectTrade.actualProfitPercent)}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">TP / SL / Exit</span>
                <span className="font-medium">
                  {formatOutcomeLabel(inspectTrade.tpOutcome)} /{' '}
                  {formatOutcomeLabel(inspectTrade.slOutcome)} /{' '}
                  {formatOutcomeLabel(inspectTrade.exitOutcome)}
                </span>
              </div>
            </div>

            {inspectTrade.entryReason && (
              <div className="space-y-1">
                <h4 className="font-semibold">Entry Reasoning</h4>
                <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                  {inspectTrade.entryReason}
                </p>
              </div>
            )}

            {inspectTrade.lessons && (
              <div className="space-y-1">
                <h4 className="font-semibold">Lessons Learned</h4>
                <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                  {inspectTrade.lessons}
                </p>
              </div>
            )}

            {inspectTradeAttachments.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold">
                  Screenshots ({inspectTradeAttachments.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inspectTradeAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="border border-neutral-200 dark:border-neutral-800 rounded overflow-hidden"
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.filename}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-full h-36 object-cover"
                      />
                      <div className="p-2 text-[11px] truncate">{att.filename}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="font-semibold mb-2">
                Trade Event Timeline ({inspectTradeEvents.length})
              </h4>
              {inspectTradeEvents.length === 0 ? (
                <p className="text-neutral-500">No trade events logged.</p>
              ) : (
                <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                  {inspectTradeEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start justify-between gap-3 py-1.5 border-b border-neutral-100 dark:border-neutral-800/60"
                    >
                      <div>
                        <p className="font-medium">{ev.label}</p>
                        {ev.details && <p className="text-neutral-500 mt-0.5">{ev.details}</p>}
                      </div>
                      <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                        {formatTimestampWithSeconds(ev.timestamp, ev.timezone || timezone)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
