import { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  formatCurrency,
  formatDurationSeconds,
  formatSignedPercent,
  sortTradesChronologically,
} from '../domain/calculations';
import {
  APP_NAME,
  DEFAULT_TIMEZONE,
  formatTimestampWithSeconds,
  generateId,
  getLocalDateString,
} from '../domain/defaults';
import { StructuredAppError } from '../domain/diagnostics';
import type { ExitOutcome, SlOutcome, TpOutcome, Trade, TradeLifecycleStatus } from '../domain/types';

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

function formatStatusLabel(status: TradeLifecycleStatus): string {
  switch (status) {
    case 'before_entry':
      return 'Before Entry';
    case 'during_trade':
      return 'During Trade';
    case 'closed':
      return 'Closed';
  }
}

function getStatusBadgeClass(status: TradeLifecycleStatus): string {
  switch (status) {
    case 'during_trade':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900';
    case 'before_entry':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    case 'closed':
      return 'bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700';
  }
}

export function TradesPage() {
  const {
    user,
    dataset,
    saveHistoricalTrade,
    deleteTradeRecord,
    addAttachment,
    removeAttachment,
    reportDiagnostic,
  } = useWorkspace();

  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';
  const [searchText, setSearchText] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'win' | 'loss' | 'breakeven'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TradeLifecycleStatus>('all');
  const [sessionFilter, setSessionFilter] = useState<'all' | 'in_session' | 'out_of_session'>('all');
  const [inspectTradeId, setInspectTradeId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingTrade, setSavingTrade] = useState(false);
  const [deletingTrade, setDeletingTrade] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [formError, setFormError] = useState('');

  // Add Historical / Out-of-Session Trade Form
  const [date, setDate] = useState(() => getLocalDateString(new Date(), timezone));
  const [accountId, setAccountId] = useState(dataset.accounts[0]?.id || '');
  const [sessionId, setSessionId] = useState('');
  const [instrument, setInstrument] = useState(dataset.instruments[0]?.symbol || 'NQ');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [setupLabel, setSetupLabel] = useState(dataset.preferences?.setupLabels[0] || '');
  const [timeframe, setTimeframe] = useState('5m');
  const [riskPercent, setRiskPercent] = useState('');
  const [actualProfitPercent, setActualProfitPercent] = useState('');
  const [tpOutcome, setTpOutcome] = useState<TpOutcome>('pending');
  const [slOutcome, setSlOutcome] = useState<SlOutcome>('pending');
  const [exitOutcome, setExitOutcome] = useState<ExitOutcome>('take_profit');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [plannedRisk, setPlannedRisk] = useState('');
  const [grossPnl, setGrossPnl] = useState('');
  const [commission, setCommission] = useState('');
  const [otherCharges, setOtherCharges] = useState('');
  const [lessons, setLessons] = useState('');
  const [followedPlan, setFollowedPlan] = useState(true);
  const [followedRiskRules, setFollowedRiskRules] = useState(true);
  const [impulsiveEntry, setImpulsiveEntry] = useState(false);

  const accountMap = useMemo(
    () => new Map(dataset.accounts.map((a) => [a.id, a.name])),
    [dataset.accounts]
  );

  const sessionMap = useMemo(
    () => new Map(dataset.sessions.map((s) => [s.id, s])),
    [dataset.sessions]
  );

  const inspectTrade = useMemo(
    () => (inspectTradeId ? dataset.trades.find((t) => t.id === inspectTradeId) ?? null : null),
    [dataset.trades, inspectTradeId]
  );

  const filteredTrades = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return sortTradesChronologically(dataset.trades)
      .reverse()
      .filter((t) => {
        if (resultFilter !== 'all' && t.result !== resultFilter) return false;
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (sessionFilter === 'in_session' && t.isOutOfSession) return false;
        if (sessionFilter === 'out_of_session' && !t.isOutOfSession) return false;
        if (q) {
          const linkedSession = t.sessionId ? sessionMap.get(t.sessionId) : undefined;
          const match =
            t.instrument.toLowerCase().includes(q) ||
            (t.setupLabel || '').toLowerCase().includes(q) ||
            (t.lessons || '').toLowerCase().includes(q) ||
            (t.sessionId || '').toLowerCase().includes(q) ||
            (linkedSession?.sessionName || '').toLowerCase().includes(q) ||
            t.date.includes(q);
          if (!match) return false;
        }
        return true;
      });
  }, [dataset.trades, searchText, resultFilter, statusFilter, sessionFilter, sessionMap]);

  const handleSaveManualTrade = async () => {
    if (!user || savingTrade) return;
    const reportInvalid = (message: string) => {
      setFormError(message);
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'HISTORICAL_TRADE_VALIDATION_FAILED',
          message,
          userExplanation: message,
          recommendedAction: 'Correct the highlighted fields and click Save Trade again.',
        }),
        {
          module: 'Trades Ledger',
          operation: 'validateHistoricalTrade',
          actionSummary: 'Historical trade validation failed',
          recordType: 'trade',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
    };

    if (!accountId) {
      reportInvalid('Please select a trading account before saving this trade.');
      return;
    }
    if (!date) {
      reportInvalid('Trade date is required.');
      return;
    }
    if (!instrument.trim()) {
      reportInvalid('Instrument symbol is required.');
      return;
    }

    const parseOptionalNum = (raw: string, label: string): number | undefined | 'invalid' => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const val = Number(trimmed);
      if (!Number.isFinite(val)) {
        reportInvalid(`${label} must be a valid number.`);
        return 'invalid';
      }
      return val;
    };

    const parsedGross = parseOptionalNum(grossPnl, 'Gross P&L');
    if (parsedGross === 'invalid') return;
    const parsedComm = parseOptionalNum(commission, 'Commission');
    if (parsedComm === 'invalid') return;
    const parsedOther = parseOptionalNum(otherCharges, 'Other Charges');
    if (parsedOther === 'invalid') return;
    const parsedRiskPct = parseOptionalNum(riskPercent, 'Planned Risk %');
    if (parsedRiskPct === 'invalid') return;
    const parsedActualPct = parseOptionalNum(actualProfitPercent, 'Actual Profit %');
    if (parsedActualPct === 'invalid') return;
    const parsedEntryPrice = parseOptionalNum(entryPrice, 'Entry Price');
    if (parsedEntryPrice === 'invalid') return;
    const parsedExitPrice = parseOptionalNum(exitPrice, 'Exit Price');
    if (parsedExitPrice === 'invalid') return;
    const parsedPlannedRisk = parseOptionalNum(plannedRisk, 'Planned Risk');
    if (parsedPlannedRisk === 'invalid') return;

    setFormError('');
    setSavingTrade(true);
    try {
      const nowIso = new Date().toISOString();
      const trade: Trade = {
        id: generateId('trd'),
        userId: user.uid,
        date,
        timezone,
        ...(sessionId ? { sessionId } : {}),
        isOutOfSession: !sessionId,
        accountId,
        instrument: instrument.trim().toUpperCase(),
        direction,
        status: 'closed',
        timeframe,
        setupLabel,
        tpOutcome,
        slOutcome,
        exitOutcome,
        ...(parsedRiskPct !== undefined ? { riskPercent: parsedRiskPct } : {}),
        ...(parsedActualPct !== undefined ? { actualProfitPercent: parsedActualPct } : {}),
        ...(parsedEntryPrice !== undefined ? { entryPrice: parsedEntryPrice } : {}),
        ...(parsedExitPrice !== undefined ? { exitPrice: parsedExitPrice } : {}),
        ...(parsedPlannedRisk !== undefined ? { plannedRisk: parsedPlannedRisk } : {}),
        ...(parsedGross !== undefined ? { grossPnl: parsedGross } : {}),
        ...(parsedComm !== undefined ? { commission: parsedComm } : {}),
        ...(parsedOther !== undefined ? { otherCharges: parsedOther } : {}),
        result: 'pending',
        lessons,
        disciplineQuestions: {
          followedPlan,
          followedRiskRules,
          impulsiveEntry,
          exitedPerPlan: true,
        },
        sourceApplication: APP_NAME,
        sourceCreatedAt: nowIso,
        sourceUpdatedAt: nowIso,
      };
      await saveHistoricalTrade(trade, false);
      setShowAddModal(false);
    } catch {
      // Error surfaced via global diagnostic banner; preserve modal inputs
    } finally {
      setSavingTrade(false);
    }
  };

  const inspectEvents = useMemo(() => {
    if (!inspectTrade) return [];
    return dataset.tradeEvents
      .filter((e) => e.tradeId === inspectTrade.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [inspectTrade, dataset.tradeEvents]);

  const inspectAttachments = useMemo(() => {
    if (!inspectTrade) return [];
    return dataset.attachments.filter(
      (a) => a.entityType === 'trade' && a.entityId === inspectTrade.id
    );
  }, [inspectTrade, dataset.attachments]);

  const handleUploadToTrade = async (file: File) => {
    if (!inspectTrade) return;
    setUploadError('');
    if (file.size > 650 * 1024) {
      setUploadError('Please keep screenshots under 650 KB for portable backup compatibility.');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
      });
      await addAttachment({
        entityType: 'trade',
        entityId: inspectTrade.id,
        filename: file.name,
        mimeType: file.type || 'image/png',
        sizeBytes: file.size,
        dataUrl,
      });
    } catch (err) {
      setUploadError('Could not attach screenshot. Please check the diagnostic notice.');
      reportDiagnostic(err, {
        module: 'Trades Ledger',
        operation: 'upload_trade_screenshot',
        actionSummary: 'Attach Trade Screenshot',
        recordType: 'attachment',
        recordId: inspectTrade.id,
        localStatus: 'not_modified',
        cloudStatus: 'failed',
      });
    }
  };

  const inspectLinkedSession = inspectTrade?.sessionId
    ? sessionMap.get(inspectTrade.sessionId)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Independent Trade Records · In-Session &amp; Out-of-Session Execution Archive
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
            Trades ({filteredTrades.length})
          </h2>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setDate(getLocalDateString(new Date(), timezone));
            setAccountId((prev) => prev || dataset.accounts[0]?.id || '');
            setInstrument((prev) => prev || dataset.instruments[0]?.symbol || 'NQ');
            setSetupLabel((prev) => prev || dataset.preferences?.setupLabels[0] || '');
            setShowAddModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" /> Record Historical Trade
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search symbol, setup, session ID, date, lesson..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-md">
            {(['all', 'win', 'loss', 'breakeven'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setResultFilter(r)}
                className={`px-2.5 py-1 text-xs font-medium rounded capitalize cursor-pointer ${
                  resultFilter === r
                    ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | TradeLifecycleStatus)
            }
            className="px-2.5 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
          >
            <option value="all">All Statuses</option>
            <option value="closed">Closed</option>
            <option value="during_trade">During Trade (Active)</option>
            <option value="before_entry">Before Entry</option>
          </select>

          <select
            value={sessionFilter}
            onChange={(e) =>
              setSessionFilter(e.target.value as 'all' | 'in_session' | 'out_of_session')
            }
            className="px-2.5 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
          >
            <option value="all">All Session Contexts</option>
            <option value="in_session">In-Session Only</option>
            <option value="out_of_session">Out-of-Session Only</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        {filteredTrades.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">
            No trades match your current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                  <th className="py-2.5 px-4 font-medium">Date</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Account</th>
                  <th className="py-2.5 px-4 font-medium">Instrument / Side</th>
                  <th className="py-2.5 px-4 font-medium">Session Link</th>
                  <th className="py-2.5 px-4 font-medium text-right">Risk %</th>
                  <th className="py-2.5 px-4 font-medium text-right">Profit %</th>
                  <th className="py-2.5 px-4 font-medium text-right">Realised R</th>
                  <th className="py-2.5 px-4 font-medium text-right">Outcome / P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {filteredTrades.map((t) => {
                  const linkedSession = t.sessionId ? sessionMap.get(t.sessionId) : undefined;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setInspectTradeId(t.id)}
                      className="h-11 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 cursor-pointer"
                    >
                      <td className="py-2 px-4 font-mono tabular-nums text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                        {t.date}
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border ${getStatusBadgeClass(
                            t.status
                          )}`}
                        >
                          {formatStatusLabel(t.status)}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-neutral-700 dark:text-neutral-300">
                        {accountMap.get(t.accountId) || 'Account'}
                      </td>
                      <td className="py-2 px-4">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {t.instrument}
                        </span>{' '}
                        <span className="uppercase text-neutral-500">{t.direction}</span>
                        {(t.setupLabel || t.timeframe) && (
                          <div className="text-[11px] text-neutral-500 truncate max-w-[180px]">
                            {[t.setupLabel, t.timeframe].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-4 text-neutral-600 dark:text-neutral-400">
                        {t.isOutOfSession || !t.sessionId ? (
                          <span className="text-neutral-500">Out-of-Session</span>
                        ) : (
                          <div>
                            <div className="text-neutral-800 dark:text-neutral-200 font-medium">
                              {linkedSession?.sessionName || 'Session'}
                            </div>
                            <div className="font-mono text-[10px] text-neutral-500 truncate max-w-[140px]">
                              {t.sessionId}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                        {typeof t.riskPercent === 'number' ? `${t.riskPercent}%` : '—'}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono tabular-nums font-medium ${
                          (t.actualProfitPercent ?? 0) > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : (t.actualProfitPercent ?? 0) < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {typeof t.actualProfitPercent === 'number'
                          ? formatSignedPercent(t.actualProfitPercent)
                          : t.expectedProfitPercent !== undefined
                          ? `Exp +${t.expectedProfitPercent}%`
                          : '—'}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums">
                        {typeof t.realisedR === 'number'
                          ? `${t.realisedR >= 0 ? '+' : ''}${t.realisedR.toFixed(2)}R`
                          : '—'}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono tabular-nums font-medium ${
                          (t.netPnl ?? t.actualProfitPercent ?? 0) > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : (t.netPnl ?? t.actualProfitPercent ?? 0) < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {t.status !== 'closed'
                          ? formatStatusLabel(t.status)
                          : typeof t.netPnl === 'number'
                          ? formatCurrency(t.netPnl, currency)
                          : formatOutcomeLabel(t.exitOutcome || t.result)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Historical Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Record Historical Trade</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {dataset.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Linked Session (Optional)</label>
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="">Out-of-Session Trade</option>
                  {dataset.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.date} · {s.sessionName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Instrument</label>
                <input
                  type="text"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'long' | 'short')}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Setup / Timeframe</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={setupLabel}
                    onChange={(e) => setSetupLabel(e.target.value)}
                    placeholder="Setup"
                    className="flex-1 px-2 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                  <input
                    type="text"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    placeholder="5m"
                    className="w-16 px-2 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Planned Risk %</label>
                <input
                  type="number"
                  step="0.05"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Actual Profit %</label>
                <input
                  type="number"
                  step="0.05"
                  value={actualProfitPercent}
                  onChange={(e) => setActualProfitPercent(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Exit Outcome</label>
                <select
                  value={exitOutcome}
                  onChange={(e) => setExitOutcome(e.target.value as ExitOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="take_profit">Take Profit</option>
                  <option value="stop_loss">Stop Loss</option>
                  <option value="manual_exit">Manual Exit</option>
                  <option value="breakeven">Breakeven</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">TP / SL Status</label>
                <div className="flex gap-1.5">
                  <select
                    value={tpOutcome}
                    onChange={(e) => setTpOutcome(e.target.value as TpOutcome)}
                    className="flex-1 px-2 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  >
                    <option value="pending">TP Pending</option>
                    <option value="hit">TP Hit</option>
                    <option value="partial">TP Partial</option>
                    <option value="missed">TP Missed</option>
                    <option value="not_used">TP Not Used</option>
                  </select>
                  <select
                    value={slOutcome}
                    onChange={(e) => setSlOutcome(e.target.value as SlOutcome)}
                    className="flex-1 px-2 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  >
                    <option value="pending">SL Pending</option>
                    <option value="hit">SL Hit</option>
                    <option value="trailed_be">Trailed BE</option>
                    <option value="moved">SL Moved</option>
                    <option value="not_used">SL Not Used</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Entry Price (Optional)</label>
                <input
                  type="number"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Exit Price (Optional)</label>
                <input
                  type="number"
                  step="any"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Planned Risk ({currency}, Opt.)</label>
                <input
                  type="number"
                  step="any"
                  value={plannedRisk}
                  onChange={(e) => setPlannedRisk(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Gross P&amp;L (Optional)</label>
                <input
                  type="number"
                  step="any"
                  value={grossPnl}
                  onChange={(e) => setGrossPnl(e.target.value)}
                  placeholder="Unrecorded"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Commission (Optional)</label>
                <input
                  type="number"
                  step="any"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  placeholder="Unrecorded"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Other Charges (Optional)</label>
                <input
                  type="number"
                  step="any"
                  value={otherCharges}
                  onChange={(e) => setOtherCharges(e.target.value)}
                  placeholder="Unrecorded"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={followedPlan}
                  onChange={(e) => setFollowedPlan(e.target.checked)}
                />
                Followed Plan
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={followedRiskRules}
                  onChange={(e) => setFollowedRiskRules(e.target.checked)}
                />
                Followed Risk Rules
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={impulsiveEntry}
                  onChange={(e) => setImpulsiveEntry(e.target.checked)}
                />
                Impulsive Entry
              </label>
            </div>

            <div className="text-xs">
              <label className="block font-medium mb-1">Lessons / Notes</label>
              <textarea
                rows={2}
                value={lessons}
                onChange={(e) => setLessons(e.target.value)}
                className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingTrade}
                onClick={() => void handleSaveManualTrade()}
                className="px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 cursor-pointer"
              >
                {savingTrade ? 'Saving Trade...' : 'Save Trade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Trade Inspector Drawer */}
      {inspectTrade && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111622] h-full overflow-y-auto border-l border-neutral-200 dark:border-neutral-800 p-6 space-y-5 text-xs">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
              <div>
                <p className="font-mono text-neutral-500">
                  {inspectTrade.date} · {inspectTrade.id}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {inspectTrade.instrument} · {inspectTrade.direction.toUpperCase()}
                  </h3>
                  <span
                    className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border ${getStatusBadgeClass(
                      inspectTrade.status
                    )}`}
                  >
                    {formatStatusLabel(inspectTrade.status)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deletingTrade}
                  onClick={async () => {
                    if (deletingTrade) return;
                    setDeletingTrade(true);
                    try {
                      await deleteTradeRecord(inspectTrade.id);
                      setInspectTradeId(null);
                    } catch {
                      // Error surfaced via global diagnostic banner
                    } finally {
                      setDeletingTrade(false);
                    }
                  }}
                  className="p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 cursor-pointer"
                  title="Delete trade"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setInspectTradeId(null)}
                  className="p-1.5 text-neutral-500 cursor-pointer"
                  aria-label="Close trade inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Core Context & Performance Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Account</span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {accountMap.get(inspectTrade.accountId) || 'Account'}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 sm:col-span-2">
                <span className="text-neutral-500 block">Session Context</span>
                {inspectTrade.isOutOfSession || !inspectTrade.sessionId ? (
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    Out-of-Session Trade
                  </span>
                ) : (
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {inspectLinkedSession?.sessionName || 'Session'}{' '}
                    <span className="font-mono text-[11px] text-neutral-500">
                      ({inspectTrade.sessionId})
                    </span>
                  </span>
                )}
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Risk % / Expected %</span>
                <span className="font-mono font-semibold">
                  {typeof inspectTrade.riskPercent === 'number'
                    ? `${inspectTrade.riskPercent}%`
                    : '—'}{' '}
                  /{' '}
                  {typeof inspectTrade.expectedProfitPercent === 'number'
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
                <span className="text-neutral-500 block">Result &amp; Realised R</span>
                <span className="font-mono font-semibold capitalize">
                  {inspectTrade.result}
                  {typeof inspectTrade.realisedR === 'number'
                    ? ` · ${inspectTrade.realisedR >= 0 ? '+' : ''}${inspectTrade.realisedR.toFixed(2)}R`
                    : ''}
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
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Net P&amp;L</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(inspectTrade.netPnl, currency)}
                </span>
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800">
                <span className="text-neutral-500 block">Duration</span>
                <span className="font-mono font-semibold">
                  {typeof inspectTrade.duringTradeDurationSeconds === 'number'
                    ? formatDurationSeconds(inspectTrade.duringTradeDurationSeconds)
                    : '—'}
                </span>
              </div>
            </div>

            {/* Entry & Exit Details */}
            <div className="p-4 rounded border border-neutral-200 dark:border-neutral-800 space-y-2">
              <h4 className="font-semibold text-neutral-900 dark:text-neutral-100">
                Entry &amp; Exit Details
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-neutral-500 block">Setup</span>
                  <span className="font-medium">{inspectTrade.setupLabel || '—'}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Entry Type</span>
                  <span className="font-medium">{inspectTrade.entryType || '—'}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Timeframe / Bias</span>
                  <span className="font-medium">
                    {[inspectTrade.timeframe, inspectTrade.bias].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Entry / Exit Time</span>
                  <span className="font-mono">
                    {inspectTrade.entryTimestamp
                      ? formatTimestampWithSeconds(
                          inspectTrade.entryTimestamp,
                          inspectTrade.timezone || timezone
                        )
                      : '—'}{' '}
                    →{' '}
                    {inspectTrade.exitTimestamp
                      ? formatTimestampWithSeconds(
                          inspectTrade.exitTimestamp,
                          inspectTrade.timezone || timezone
                        )
                      : '—'}
                  </span>
                </div>
                {(inspectTrade.entryPrice !== undefined ||
                  inspectTrade.exitPrice !== undefined ||
                  inspectTrade.stopLoss !== undefined ||
                  inspectTrade.takeProfit !== undefined ||
                  inspectTrade.positionSize !== undefined ||
                  inspectTrade.plannedRisk !== undefined ||
                  inspectTrade.grossPnl !== undefined) && (
                  <>
                    <div>
                      <span className="text-neutral-500 block">Entry / Exit Price</span>
                      <span className="font-mono">
                        {inspectTrade.entryPrice ?? '—'} → {inspectTrade.exitPrice ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Stop Loss / Take Profit</span>
                      <span className="font-mono">
                        {inspectTrade.stopLoss ?? '—'} / {inspectTrade.takeProfit ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Size / Planned Risk</span>
                      <span className="font-mono">
                        {inspectTrade.positionSize ?? '—'} /{' '}
                        {formatCurrency(inspectTrade.plannedRisk, currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Gross / Fees</span>
                      <span className="font-mono">
                        {formatCurrency(inspectTrade.grossPnl, currency)} /{' '}
                        {formatCurrency(
                          (inspectTrade.commission ?? 0) + (inspectTrade.otherCharges ?? 0),
                          currency
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Psychology & Execution */}
            <div className="p-4 rounded border border-neutral-200 dark:border-neutral-800 space-y-3">
              <h4 className="font-semibold text-neutral-900 dark:text-neutral-100">
                Psychology &amp; Execution
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-neutral-500 block">Pre-Entry Emotion</span>
                  <span className="font-medium">{inspectTrade.preEntryEmotion || '—'}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Confidence</span>
                  <span className="font-mono font-medium">
                    {typeof inspectTrade.confidence === 'number'
                      ? `${inspectTrade.confidence}/10`
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Anti-Bias Pause</span>
                  <span className="font-medium">
                    {inspectTrade.antiBiasPauseCompleted === undefined
                      ? '—'
                      : inspectTrade.antiBiasPauseCompleted
                      ? 'Completed'
                      : 'Skipped'}
                  </span>
                </div>
              </div>

              {inspectTrade.postExitEmotions && inspectTrade.postExitEmotions.length > 0 && (
                <div>
                  <span className="text-neutral-500 block mb-1">Post-Exit Emotions</span>
                  <div className="flex flex-wrap gap-1.5">
                    {inspectTrade.postExitEmotions.map((em) => (
                      <span
                        key={em}
                        className="px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
                      >
                        {em}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {inspectTrade.disciplineQuestions && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900/60">
                    <span className="text-neutral-500 block text-[11px]">Followed Plan</span>
                    <span className="font-medium">
                      {inspectTrade.disciplineQuestions.followedPlan === undefined
                        ? '—'
                        : inspectTrade.disciplineQuestions.followedPlan
                        ? 'Yes'
                        : 'No'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900/60">
                    <span className="text-neutral-500 block text-[11px]">Risk Rules</span>
                    <span className="font-medium">
                      {inspectTrade.disciplineQuestions.followedRiskRules === undefined
                        ? '—'
                        : inspectTrade.disciplineQuestions.followedRiskRules
                        ? 'Yes'
                        : 'No'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900/60">
                    <span className="text-neutral-500 block text-[11px]">Impulsive Entry</span>
                    <span className="font-medium">
                      {inspectTrade.disciplineQuestions.impulsiveEntry === undefined
                        ? '—'
                        : inspectTrade.disciplineQuestions.impulsiveEntry
                        ? 'Yes'
                        : 'No'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900/60">
                    <span className="text-neutral-500 block text-[11px]">Exited Per Plan</span>
                    <span className="font-medium">
                      {inspectTrade.disciplineQuestions.exitedPerPlan === undefined
                        ? '—'
                        : inspectTrade.disciplineQuestions.exitedPerPlan
                        ? 'Yes'
                        : 'No'}
                    </span>
                  </div>
                </div>
              )}

              {(inspectTrade.entryReason ||
                inspectTrade.expectedOutcome ||
                inspectTrade.exitReason ||
                inspectTrade.actualOutcome) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {inspectTrade.entryReason && (
                    <div>
                      <span className="text-neutral-500 block">Entry Reasoning</span>
                      <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                        {inspectTrade.entryReason}
                      </p>
                    </div>
                  )}
                  {inspectTrade.expectedOutcome && (
                    <div>
                      <span className="text-neutral-500 block">Expected Outcome</span>
                      <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                        {inspectTrade.expectedOutcome}
                      </p>
                    </div>
                  )}
                  {inspectTrade.exitReason && (
                    <div>
                      <span className="text-neutral-500 block">Exit Reasoning</span>
                      <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                        {inspectTrade.exitReason}
                      </p>
                    </div>
                  )}
                  {inspectTrade.actualOutcome && (
                    <div>
                      <span className="text-neutral-500 block">Actual Outcome Notes</span>
                      <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                        {inspectTrade.actualOutcome}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mistakes & Lessons */}
            {((inspectTrade.mistakes && inspectTrade.mistakes.length > 0) ||
              inspectTrade.lessons) && (
              <div className="p-4 rounded border border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <h4 className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Mistakes &amp; Lessons
                </h4>
                {inspectTrade.mistakes && inspectTrade.mistakes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {inspectTrade.mistakes.map((m) => (
                      <span
                        key={m}
                        className="px-2 py-0.5 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                {inspectTrade.lessons && (
                  <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                    {inspectTrade.lessons}
                  </p>
                )}
              </div>
            )}

            {/* Screenshots */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Screenshots ({inspectAttachments.length})</h4>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer">
                  <Upload className="w-3 h-3" /> Attach
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadToTrade(f);
                    }}
                  />
                </label>
              </div>
              {uploadError && (
                <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>
              )}
              {inspectAttachments.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inspectAttachments.map((att) => (
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
                      <div className="p-2 flex items-center justify-between text-[11px]">
                        <span className="truncate">{att.filename}</span>
                        <button
                          type="button"
                          onClick={() => void removeAttachment(att.id).catch(() => {})}
                          className="text-red-600 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trade Event Timeline */}
            <div>
              <h4 className="font-semibold mb-2">
                Trade Event Timeline ({inspectEvents.length})
              </h4>
              {inspectEvents.length === 0 ? (
                <p className="text-neutral-500">No trade events logged.</p>
              ) : (
                <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                  {inspectEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start justify-between gap-2 py-1.5 border-b border-neutral-100 dark:border-neutral-800/60"
                    >
                      <div>
                        <p className="font-medium">
                          <span className="text-neutral-500 uppercase text-[10px] mr-1.5">
                            [{ev.phase.replace('_', ' ')}]
                          </span>
                          {ev.label}
                        </p>
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
