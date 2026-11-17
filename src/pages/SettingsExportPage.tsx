import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useWorkspace, type SettingsTabRoute } from '../context/WorkspaceContext';
import {
  DEFAULT_TIMEZONE,
  buildInitialSessionTemplates,
  generateId,
  getLocalDateString,
} from '../domain/defaults';
import {
  ERROR_CATEGORY_LABELS,
  StructuredAppError,
  formatCloudStatusLabel,
  formatDiagnosticReport,
  formatLocalStatusLabel,
  formatPendingOperationDiagnosticReport,
  formatPendingStatusLabel,
  inspectAndRepairPendingTradeClose,
  type PendingOperationStatus,
} from '../domain/diagnostics';
import { errorHandler } from '../services/ErrorHandler';
import type {
  AccountType,
  InstrumentMarket,
  TradingAccount,
} from '../domain/types';
import {
  buildTradesCsvBlob,
  buildUtdsJsonBlob,
  buildUtdsZipBlob,
  buildXlsxBlob,
  parseAndValidateImportFile,
  type ConflictResolution,
  type ExportScope,
  type ParsedImportBundle,
} from '../domain/utds';
import { executeSafeUtdsImport, type ImportCommitSummary } from '../storage/repository';

type SettingsTab = SettingsTabRoute;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SettingsExportPage() {
  const {
    user,
    dataset,
    theme,
    toggleTheme,
    saveProfile,
    saveAccount,
    saveInstrument,
    saveSessionTemplate,
    saveChecklist,
    savePreferences,
    reloadWorkspace,
    logAudit,
    diagnostics,
    pendingOperations,
    requestedSettingsTab,
    clearRequestedSettingsTab,
    markDiagnosticResolved,
    clearResolvedDiagnostics,
    clearAllDiagnostics,
    reportDiagnostic,
    retryPendingOperation,
    discardPendingOperation,
  } = useWorkspace();

  const [tab, setTab] = useState<SettingsTab>(requestedSettingsTab || 'export_import');
  const [notice, setNotice] = useState('');
  const [expandedDiagIds, setExpandedDiagIds] = useState<Record<string, boolean>>({});
  const [expandedPendingIds, setExpandedPendingIds] = useState<Record<string, boolean>>({});
  const [copiedDiagId, setCopiedDiagId] = useState<string | null>(null);
  const [retryingOpId, setRetryingOpId] = useState<string | null>(null);

  useEffect(() => {
    if (requestedSettingsTab) {
      setTab(requestedSettingsTab);
      clearRequestedSettingsTab();
    }
  }, [requestedSettingsTab, clearRequestedSettingsTab]);

  // Profile State
  const [displayName, setDisplayName] = useState(dataset.profile?.displayName || '');
  const [timezone, setTimezone] = useState(dataset.profile?.timezone || DEFAULT_TIMEZONE);
  const [currency, setCurrency] = useState(dataset.profile?.currency || 'USD');

  // New Account State
  const [accName, setAccName] = useState('');
  const [accBroker, setAccBroker] = useState('');
  const [accType, setAccType] = useState<AccountType>('personal');
  const [accCurrency, setAccCurrency] = useState('USD');
  const [accBalance, setAccBalance] = useState('10000');
  const [accRisk, setAccRisk] = useState('1');

  // New Instrument State
  const [instSymbol, setInstSymbol] = useState('');
  const [instMarket, setInstMarket] = useState<InstrumentMarket>('Futures');
  const [instComm, setInstComm] = useState('4.5');

  // New Session Template State
  const [tplName, setTplName] = useState('');
  const [tplStart, setTplStart] = useState('09:30');
  const [tplEnd, setTplEnd] = useState('12:30');

  // Preferences State
  const [timeframesText, setTimeframesText] = useState(
    (dataset.preferences?.timeframes || []).join(', ')
  );
  const [setupsText, setSetupsText] = useState(
    (dataset.preferences?.setupLabels || []).join(', ')
  );
  const [pauseSeconds, setPauseSeconds] = useState(
    String(dataset.preferences?.antiBiasPauseSeconds ?? 10)
  );

  // Sync profile & preference controls whenever loaded dataset updates
  useEffect(() => {
    if (dataset.profile) {
      setDisplayName(dataset.profile.displayName || '');
      setTimezone(dataset.profile.timezone || DEFAULT_TIMEZONE);
      setCurrency(dataset.profile.currency || 'USD');
    }
  }, [dataset.profile]);

  useEffect(() => {
    if (dataset.preferences) {
      setTimeframesText((dataset.preferences.timeframes || []).join(', '));
      setSetupsText((dataset.preferences.setupLabels || []).join(', '));
      setPauseSeconds(String(dataset.preferences.antiBiasPauseSeconds ?? 10));
    }
  }, [dataset.preferences]);

  const activeTimezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;

  // Export State
  const [exportScope, setExportScope] = useState<ExportScope>('complete_backup');
  const [rangeStart, setRangeStart] = useState(() => {
    const todayTz = getLocalDateString(new Date(), activeTimezone);
    return `${todayTz.slice(0, 7)}-01`;
  });
  const [rangeEnd, setRangeEnd] = useState(() => getLocalDateString(new Date(), activeTimezone));
  const [exportBusy, setExportBusy] = useState(false);

  // Import State (10-Step Workflow)
  const [importBundle, setImportBundle] = useState<ParsedImportBundle | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportCommitSummary | null>(null);
  const [importError, setImportError] = useState('');

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'PROFILE_DISPLAY_NAME_REQUIRED',
          message: 'Display name is required.',
          userExplanation: 'Display name is required before saving profile settings.',
          recommendedAction: 'Enter a display name and click Save Profile.',
        }),
        {
          module: 'Settings',
          operation: 'saveProfile',
          actionSummary: 'Profile update validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    try {
      await saveProfile({ displayName: displayName.trim(), timezone, currency });
      setNotice('Profile & regional settings saved.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleAddAccount = async () => {
    if (!user) return;
    if (!accName.trim()) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'ACCOUNT_NAME_REQUIRED',
          message: 'Trading account name is required.',
          userExplanation: 'Trading account name is required.',
          recommendedAction: 'Enter an account name and try again.',
        }),
        {
          module: 'Settings',
          operation: 'addAccount',
          actionSummary: 'Account validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    const balNum = Number(accBalance || 0);
    const riskNum = Number(accRisk || 1);
    if (!Number.isFinite(balNum) || !Number.isFinite(riskNum)) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'ACCOUNT_NUMERIC_INVALID',
          message: 'Account balance and risk % must be valid numbers.',
          userExplanation: 'Account balance and default risk % must be valid numbers.',
          recommendedAction: 'Check numeric inputs and try again.',
        }),
        {
          module: 'Settings',
          operation: 'addAccount',
          actionSummary: 'Account validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    try {
      const acc: TradingAccount = {
        id: generateId('acc'),
        userId: user.uid,
        name: accName.trim(),
        broker: accBroker.trim() || undefined,
        accountType: accType,
        currency: accCurrency.trim() || 'USD',
        initialBalance: balNum,
        defaultRiskPercent: riskNum,
        isActive: true,
      };
      await saveAccount(acc, false);
      setAccName('');
      setAccBroker('');
      setNotice('Trading account added.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleAddInstrument = async () => {
    if (!user) return;
    if (!instSymbol.trim()) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'INSTRUMENT_SYMBOL_REQUIRED',
          message: 'Instrument symbol is required (e.g. NQ, ES, XAUUSD).',
          userExplanation: 'Instrument symbol is required (e.g. NQ, ES, XAUUSD).',
          recommendedAction: 'Enter a symbol and try again.',
        }),
        {
          module: 'Settings',
          operation: 'addInstrument',
          actionSummary: 'Instrument validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    const commNum = Number(instComm || 0);
    if (!Number.isFinite(commNum)) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'INSTRUMENT_COMMISSION_INVALID',
          message: 'Default commission must be a valid number.',
          userExplanation: 'Default commission must be a valid number.',
          recommendedAction: 'Enter a valid numeric commission and try again.',
        }),
        {
          module: 'Settings',
          operation: 'addInstrument',
          actionSummary: 'Instrument validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    try {
      await saveInstrument(
        {
          id: generateId('inst'),
          userId: user.uid,
          symbol: instSymbol.trim().toUpperCase(),
          market: instMarket,
          defaultCommission: commNum,
          isActive: true,
        },
        false
      );
      setInstSymbol('');
      setNotice('Instrument added.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleAddTemplate = async () => {
    if (!user) return;
    if (!tplName.trim()) {
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'TEMPLATE_NAME_REQUIRED',
          message: 'Session template name is required.',
          userExplanation: 'Session template name is required.',
          recommendedAction: 'Enter a template name and try again.',
        }),
        {
          module: 'Settings',
          operation: 'addTemplate',
          actionSummary: 'Session template validation failed',
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
      return;
    }
    try {
      await saveSessionTemplate(
        {
          id: generateId('tpl'),
          userId: user.uid,
          name: tplName.trim(),
          plannedStartTime: tplStart,
          plannedEndTime: tplEnd,
          timezone: dataset.profile?.timezone || DEFAULT_TIMEZONE,
          defaultChecklist: ['Levels marked', 'Risk limit verified'],
        },
        false
      );
      setTplName('');
      setNotice('Session template saved.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleApplyStandardIstTemplates = async () => {
    if (!user) return;
    try {
      const istDefaults = buildInitialSessionTemplates(
        user.uid,
        dataset.profile?.timezone || DEFAULT_TIMEZONE
      );
      for (const tpl of istDefaults) {
        const exists = dataset.sessionTemplates.some((existing) => existing.id === tpl.id);
        await saveSessionTemplate(tpl, exists);
      }
      setNotice('Standard IST session windows (Asian, London, New York) saved.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleSaveLoggerPrefs = async () => {
    if (!user || !dataset.preferences) return;
    try {
      await savePreferences({
        ...dataset.preferences,
        timeframes: timeframesText.split(',').map((s) => s.trim()).filter(Boolean),
        setupLabels: setupsText.split(',').map((s) => s.trim()).filter(Boolean),
        antiBiasPauseSeconds: Math.max(0, Math.min(300, Number(pauseSeconds || 10))),
      });
      setNotice('Logger preferences saved.');
    } catch {
      // Reported to global diagnostics by WorkspaceContext
    }
  };

  const handleExportZip = async () => {
    setExportBusy(true);
    try {
      const dr = exportScope === 'date_range' ? { start: rangeStart, end: rangeEnd } : undefined;
      const { blob, filename, manifest } = await buildUtdsZipBlob(dataset, exportScope, dr);
      triggerDownload(blob, filename);
      const total = Object.values(manifest.record_counts).reduce((a, b) => a + b, 0);
      await logAudit('export_backup', `Downloaded ${filename} (${manifest.format} v${manifest.format_version})`, total);
      setNotice(`Backup package ${filename} created and validated.`);
    } catch (err) {
      reportDiagnostic(err, {
        module: 'Exports & Backup',
        operation: 'export_zip_backup',
        actionSummary: 'Export ZIP Backup Package',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportJson = async () => {
    try {
      const dr = exportScope === 'date_range' ? { start: rangeStart, end: rangeEnd } : undefined;
      const { blob, filename, manifest } = await buildUtdsJsonBlob(dataset, exportScope, dr);
      triggerDownload(blob, filename);
      const total = Object.values(manifest.record_counts).reduce((a, b) => a + b, 0);
      await logAudit('export_json', `Downloaded ${filename}`, total);
      setNotice(`JSON export ${filename} downloaded.`);
    } catch (err) {
      reportDiagnostic(err, {
        module: 'Exports & Backup',
        operation: 'export_json_backup',
        actionSummary: 'Export JSON Package',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
    }
  };

  const handleExportCsv = async () => {
    try {
      const blob = buildTradesCsvBlob(dataset.trades, dataset.accounts);
      const filename = `ATK_Trades_${getLocalDateString(new Date(), activeTimezone)}.csv`;
      triggerDownload(blob, filename);
      await logAudit('export_csv', `Downloaded ${filename}`, dataset.trades.length);
      setNotice(`CSV export ${filename} downloaded.`);
    } catch (err) {
      reportDiagnostic(err, {
        module: 'Exports & Backup',
        operation: 'export_trades_csv',
        actionSummary: 'Export Trades CSV',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
    }
  };

  const handleExportXlsx = async () => {
    try {
      const dr = exportScope === 'date_range' ? { start: rangeStart, end: rangeEnd } : undefined;
      const blob = buildXlsxBlob(dataset, exportScope, dr);
      const filename = `ATK_Trading_Workbook_${getLocalDateString(new Date(), activeTimezone)}.xlsx`;
      triggerDownload(blob, filename);
      await logAudit('export_xlsx', `Downloaded ${filename}`, dataset.trades.length);
      setNotice(`Excel XLSX workbook ${filename} downloaded.`);
    } catch (err) {
      reportDiagnostic(err, {
        module: 'Exports & Backup',
        operation: 'export_xlsx_workbook',
        actionSummary: 'Export Excel Workbook',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
    }
  };

  const handleInspectImport = async (file: File) => {
    if (!user) return;
    setImportError('');
    setImportSummary(null);
    setImportBusy(true);
    try {
      const parsed = await parseAndValidateImportFile(file, dataset, user.uid);
      setImportBundle(parsed);
      const initialRes: Record<string, ConflictResolution> = {};
      for (const c of parsed.conflicts) {
        initialRes[`${c.entityType}:${c.id}`] = 'skip';
      }
      setResolutions(initialRes);
      await logAudit('import_preview', `Inspected ${file.name} (${parsed.totalDetected} records)`, parsed.totalDetected);
    } catch (err) {
      setImportBundle(null);
      const msg = err instanceof Error ? err.message : 'Failed to parse backup file.';
      setImportError(msg);
      reportDiagnostic(err, {
        module: 'Imports & Restore',
        operation: 'inspect_import_bundle',
        actionSummary: 'Validate Backup Archive',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const handleCommitImport = async () => {
    if (!user || !importBundle) return;
    setImportError('');
    setImportBusy(true);
    try {
      const summary = await executeSafeUtdsImport(user.uid, importBundle, dataset, resolutions);
      setImportSummary(summary);
      setImportBundle(null);
      await reloadWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed.';
      setImportError(msg);
      reportDiagnostic(
        err,
        {
          module: 'Imports & Restore',
          operation: 'commit_import_bundle',
          actionSummary: 'Import UTDS Backup to Cloud Vault',
          localStatus: 'preserved_in_form',
          cloudStatus: 'failed',
        },
        handleCommitImport
      );
    } finally {
      setImportBusy(false);
    }
  };

  const handleCopyDiag = async (diagId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDiagId(diagId);
      setTimeout(() => setCopiedDiagId((curr) => (curr === diagId ? null : curr)), 2000);
    } catch {
      // Clipboard API may be unavailable
    }
  };

  const unresolvedCount = diagnostics.filter((d) => d.resolutionStatus === 'unresolved').length;
  const diagBadgeCount = unresolvedCount + pendingOperations.length;

  const dailyDefaultChecklist = dataset.checklists.find((c) => c.scope === 'daily');

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Workspace Configuration, Personal Accounts &amp; Universal ATK-UTDS Data Portability
        </p>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
          Settings &amp; Export
        </h2>
      </div>

      {notice && (
        <div className="p-3 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit">
        {(
          [
            { id: 'export_import', label: 'Export, Import & Backup' },
            { id: 'profile', label: 'Profile & Theme' },
            { id: 'accounts', label: 'Trading Accounts' },
            { id: 'templates', label: 'Templates & Checklists' },
            { id: 'instruments', label: 'Instruments & Logger' },
            {
              id: 'diagnostics',
              label:
                diagBadgeCount > 0
                  ? `Error History & Diagnostics (${diagBadgeCount})`
                  : 'Error History & Diagnostics',
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === t.id
                ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 max-w-xl space-y-4 text-xs">
          <h3 className="text-sm font-semibold">Profile &amp; Regional Settings</h3>
          <div>
            <label className="block font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Timezone</label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                list="atk-timezone-presets"
                className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <datalist id="atk-timezone-presets">
                <option value="Asia/Kolkata" />
                <option value="UTC" />
                <option value="Europe/London" />
                <option value="America/New_York" />
                <option value="Asia/Tokyo" />
              </datalist>
            </div>
            <div>
              <label className="block font-medium mb-1">Base Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              >
                {['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <span>Theme Mode: {theme === 'dark' ? 'Dark' : 'Light'}</span>
            <button
              type="button"
              onClick={() => void toggleTheme().catch(() => {})}
              className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 cursor-pointer"
            >
              Switch to {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
          >
            Save Profile
          </button>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold">Saved Trading Accounts</h3>
            {dataset.accounts.map((a) => (
              <div
                key={a.id}
                className="p-3 rounded border border-neutral-200 dark:border-neutral-800 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{a.name}</p>
                  <p className="text-neutral-500 capitalize">
                    {a.accountType} · {a.currency} · Initial {a.initialBalance} · Risk {a.defaultRiskPercent}%
                  </p>
                </div>
                <span className="font-mono text-[11px] text-neutral-500">{a.id}</span>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold">Add Trading Account</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Account Name"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <input
                type="text"
                placeholder="Broker (Optional)"
                value={accBroker}
                onChange={(e) => setAccBroker(e.target.value)}
                className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <select
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountType)}
                className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              >
                <option value="personal">Personal</option>
                <option value="funded">Funded</option>
                <option value="demo">Demo</option>
                <option value="paper">Paper</option>
              </select>
              <input
                type="text"
                placeholder="Currency (USD)"
                value={accCurrency}
                onChange={(e) => setAccCurrency(e.target.value)}
                className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <input
                type="number"
                placeholder="Initial Balance"
                value={accBalance}
                onChange={(e) => setAccBalance(e.target.value)}
                className="px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <input
                type="number"
                step="0.1"
                placeholder="Default Risk %"
                value={accRisk}
                onChange={(e) => setAccRisk(e.target.value)}
                className="px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleAddAccount()}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Account
            </button>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Session Templates</h3>
              <button
                type="button"
                onClick={() => void handleApplyStandardIstTemplates()}
                className="px-2.5 py-1 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Add / Sync Standard IST Sessions
              </button>
            </div>
            <div className="space-y-2">
              {dataset.sessionTemplates.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-neutral-500 font-mono">
                      {t.plannedStartTime} – {t.plannedEndTime} ({t.timezone})
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      defaultValue={t.plannedStartTime}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== t.plannedStartTime) {
                          void saveSessionTemplate({ ...t, plannedStartTime: e.target.value }, true).catch(() => {});
                        }
                      }}
                      className="px-2 py-1 font-mono rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                    <input
                      type="time"
                      defaultValue={t.plannedEndTime}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== t.plannedEndTime) {
                          void saveSessionTemplate({ ...t, plannedEndTime: e.target.value }, true).catch(() => {});
                        }
                      }}
                      className="px-2 py-1 font-mono rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <input
                type="text"
                placeholder="Template Name"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                className="px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <input
                type="time"
                value={tplStart}
                onChange={(e) => setTplStart(e.target.value)}
                className="px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <input
                type="time"
                value={tplEnd}
                onChange={(e) => setTplEnd(e.target.value)}
                className="px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleAddTemplate()}
              className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
            >
              Add Session Template
            </button>
          </div>

          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold">Default Daily Checklist</h3>
            {dailyDefaultChecklist ? (
              <>
                <p className="text-neutral-500">
                  Comma-separated items used for new Daily Journal dates:
                </p>
                <textarea
                  rows={3}
                  defaultValue={dailyDefaultChecklist.items.join(', ')}
                  onBlur={(e) => {
                    const items = e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (items.length > 0) {
                      void saveChecklist({ ...dailyDefaultChecklist, items }, true).catch(() => {});
                    }
                  }}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </>
            ) : (
              <p className="text-neutral-500">No default daily checklist configured.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'instruments' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold">Instruments</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dataset.instruments.map((i) => (
                <div
                  key={i.id}
                  className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800 flex justify-between"
                >
                  <span className="font-medium">{i.symbol}</span>
                  <span className="text-neutral-500">
                    {i.market} · Comm: {i.defaultCommission ?? 0}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <input
                type="text"
                placeholder="Symbol (e.g. SPY)"
                value={instSymbol}
                onChange={(e) => setInstSymbol(e.target.value)}
                className="px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
              <select
                value={instMarket}
                onChange={(e) => setInstMarket(e.target.value as InstrumentMarket)}
                className="px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              >
                {(['Futures', 'Forex', 'Indices', 'Equities', 'Crypto', 'Commodities', 'Options'] as const).map(
                  (m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  )
                )}
              </select>
              <input
                type="number"
                step="0.1"
                placeholder="Comm"
                value={instComm}
                onChange={(e) => setInstComm(e.target.value)}
                className="px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleAddInstrument()}
              className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
            >
              Add Instrument
            </button>
          </div>

          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold">Timeframes, Setups &amp; Logger Settings</h3>
            <div>
              <label className="block font-medium mb-1">Timeframes (comma-separated)</label>
              <input
                type="text"
                value={timeframesText}
                onChange={(e) => setTimeframesText(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Setup Labels (comma-separated)</label>
              <textarea
                rows={2}
                value={setupsText}
                onChange={(e) => setSetupsText(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Anti-Bias Pause Duration (seconds)</label>
              <input
                type="number"
                min={0}
                max={300}
                value={pauseSeconds}
                onChange={(e) => setPauseSeconds(e.target.value)}
                className="w-32 px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSaveLoggerPrefs()}
              className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
            >
              Save Logger Preferences
            </button>
          </div>
        </div>
      )}

      {tab === 'export_import' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Export Panel */}
            <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4 text-xs">
              <div>
                <h3 className="text-sm font-semibold">Universal Export &amp; Backup (ATK-UTDS v1.0.0)</h3>
                <p className="text-neutral-500 mt-0.5">
                  Downloads a self-contained portable package compatible with ATK Deck and Hyper Tracker Commercial. No live connection between apps.
                </p>
              </div>

              <div>
                <label className="block font-medium mb-1">Export Scope</label>
                <select
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value as ExportScope)}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="complete_backup">Complete Backup (All records, settings, &amp; attachments)</option>
                  <option value="trading_records">Trading Records Only (Trades, sessions, journals &amp; timelines)</option>
                  <option value="date_range">Selected Date Range</option>
                </select>
              </div>

              {exportScope === 'date_range' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium mb-1">Start Date</label>
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">End Date</label>
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={() => void handleExportZip()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportBusy ? 'Building ZIP...' : 'Download ZIP Backup'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportJson()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> JSON Package
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportCsv()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Trades CSV
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportXlsx()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Excel (.xlsx) Workbook
                </button>
              </div>
            </div>

            {/* Import Panel */}
            <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4 text-xs">
              <div>
                <h3 className="text-sm font-semibold">Universal Import &amp; Restore</h3>
                <p className="text-neutral-500 mt-0.5">
                  Validates archive manifest, detects duplicate IDs and conflicts, preserves relationships and attachments, and rolls back automatically on error.
                </p>
              </div>

              <label className="flex flex-col items-center justify-center p-6 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-md cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
                <Upload className="w-5 h-5 text-neutral-500 mb-2" />
                <span className="font-medium">
                  {importBusy ? 'Validating Package...' : 'Select ATK-UTDS .zip or .json Backup'}
                </span>
                <input
                  type="file"
                  accept=".zip,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleInspectImport(f);
                  }}
                />
              </label>

              {importError && (
                <div className="p-3 rounded border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                  {importError}
                </div>
              )}

              {importSummary && (
                <div className="p-4 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" /> Import Completed Safely
                  </div>
                  <p>Total detected: {importSummary.totalDetected}</p>
                  <p>
                    Imported: {importSummary.importedCount} · Skipped: {importSummary.skippedCount} · Replaced:{' '}
                    {importSummary.replacedCount} · Copied (remapped IDs): {importSummary.copiedCount}
                  </p>
                  <p>Attachments imported: {importSummary.attachmentsImported}</p>
                </div>
              )}
            </div>
          </div>

          {/* Import Preview & Conflict Resolution */}
          {importBundle && (
            <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold">Import Preview &amp; Verification</h3>
                  <p className="text-neutral-500">
                    Source: {importBundle.manifest.source_application} ({importBundle.manifest.format} v
                    {importBundle.manifest.format_version}) · Exported {importBundle.manifest.export_timestamp} · Checksum{' '}
                    {importBundle.checksumValid ? 'Verified' : 'Mismatch Warning'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImportBundle(null)}
                    className="px-3 py-1.5 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={importBusy}
                    onClick={() => void handleCommitImport()}
                    className="px-4 py-1.5 font-medium rounded bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
                  >
                    {importBusy ? 'Importing...' : `Confirm Safe Import (${importBundle.totalDetected} items)`}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Trades</span>
                  <span className="font-mono font-semibold">{importBundle.dataset.trades.length}</span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Sessions</span>
                  <span className="font-mono font-semibold">{importBundle.dataset.sessions.length}</span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Daily Journals</span>
                  <span className="font-mono font-semibold">{importBundle.dataset.dailyJournals.length}</span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Events (S + T)</span>
                  <span className="font-mono font-semibold">
                    {importBundle.dataset.sessionEvents.length + importBundle.dataset.tradeEvents.length}
                  </span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Attachments</span>
                  <span className="font-mono font-semibold">{importBundle.attachmentCount}</span>
                </div>
              </div>

              {importBundle.warnings.length > 0 && (
                <div className="p-3 rounded border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 space-y-1">
                  {importBundle.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}

              {importBundle.unknownFieldNotes.length > 0 && (
                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 space-y-1">
                  <p className="font-medium">Preserved Extended Fields:</p>
                  {importBundle.unknownFieldNotes.map((n, i) => (
                    <p key={i} className="text-neutral-500">{n}</p>
                  ))}
                </div>
              )}

              {importBundle.conflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold">
                      Duplicate / Conflicting IDs Detected ({importBundle.conflicts.length})
                    </h4>
                    <div className="flex items-center gap-1.5">
                      {(['skip', 'copy', 'replace'] as const).map((bulk) => (
                        <button
                          key={bulk}
                          type="button"
                          onClick={() => {
                            const next: Record<string, ConflictResolution> = {};
                            for (const c of importBundle.conflicts) {
                              next[`${c.entityType}:${c.id}`] = bulk;
                            }
                            setResolutions(next);
                          }}
                          className="px-2.5 py-1 rounded border border-neutral-200 dark:border-neutral-700 capitalize cursor-pointer"
                        >
                          Set All: {bulk}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-neutral-200 dark:border-neutral-800 rounded">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500">
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Record</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3 text-right">Resolution</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                        {importBundle.conflicts.map((c) => {
                          const key = `${c.entityType}:${c.id}`;
                          return (
                            <tr key={key}>
                              <td className="py-2 px-3 capitalize">{c.entityType.replace('_', ' ')}</td>
                              <td className="py-2 px-3 font-medium">{c.label}</td>
                              <td className="py-2 px-3 text-neutral-500">
                                {c.identical ? 'Identical' : 'Modified'}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <select
                                  value={resolutions[key] || 'skip'}
                                  onChange={(e) =>
                                    setResolutions((prev) => ({
                                      ...prev,
                                      [key]: e.target.value as ConflictResolution,
                                    }))
                                  }
                                  className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                                >
                                  <option value="skip">Skip Existing</option>
                                  <option value="copy">Import as Separate Copy</option>
                                  <option value="replace">Replace Existing</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Audit History */}
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 text-xs">
            <h3 className="text-sm font-semibold mb-3">Export &amp; Import Audit Log</h3>
            {dataset.auditLogs.length === 0 ? (
              <p className="text-neutral-500">No export or import events recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {dataset.auditLogs.slice(0, 20).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start justify-between gap-3 py-1.5 border-b border-neutral-100 dark:border-neutral-800/70"
                  >
                    <div>
                      <span className="font-medium capitalize">{log.action.replace('_', ' ')}: </span>
                      <span className="text-neutral-600 dark:text-neutral-400">{log.details}</span>
                    </div>
                    <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                      {log.timestamp.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'diagnostics' && (
        <div className="space-y-6 text-xs">
          {/* Pending Local Sync Queue */}
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Pending Local Sync Queue ({pendingOperations.length})
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Operations saved locally after a cloud write failure. Retry once connectivity or permissions are restored.
                </p>
              </div>
            </div>

            {pendingOperations.length === 0 ? (
              <p className="text-neutral-500">All local changes are synchronised with Cloud Vault.</p>
            ) : (
              <div className="space-y-2.5">
                {pendingOperations.map((op) => {
                  const isInspecting = Boolean(expandedPendingIds[op.operationId]);
                  const inspection = inspectAndRepairPendingTradeClose(op, user?.uid);
                  const currentTrade = dataset.trades.find((t) => t.id === (inspection.tradeId || op.recordId));
                  const matchingDiag =
                    diagnostics.find(
                      (d) =>
                        d.operationId === op.operationId ||
                        (d.recordId === op.recordId &&
                          (d.operation === 'closeTrade' || d.operation === 'retryPendingOperation'))
                    ) ?? null;
                  const queueCopyKey = `queue_${op.operationId}`;
                  const queueReportText = formatPendingOperationDiagnosticReport(
                    op,
                    inspection,
                    matchingDiag,
                    currentTrade?.status
                  );
                  const opStatus: PendingOperationStatus = op.status ?? 'pending';
                  const statusBadgeCls =
                    opStatus === 'requires_attention' || opStatus === 'conflict'
                      ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
                      : opStatus === 'processing'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900'
                      : opStatus === 'synced'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                      : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800';
                  return (
                    <div
                      key={op.operationId}
                      className="p-3.5 rounded-md border border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                              {op.summary}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${statusBadgeCls}`}
                            >
                              {formatPendingStatusLabel(opStatus)}
                            </span>
                            <span className="font-mono text-[11px] text-neutral-500">
                              Record: {op.recordId}
                            </span>
                            {op.lastCorrelationId && (
                              <span className="font-mono text-[11px] text-neutral-500">
                                Ref: {op.lastCorrelationId}
                              </span>
                            )}
                          </div>
                          <p className="text-neutral-600 dark:text-neutral-400">
                            Attempts: {op.attemptCount} · Last tried:{' '}
                            {op.lastAttemptAt.slice(0, 19).replace('T', ' ')}
                            {op.lastErrorCode ? ` · Code: ${op.lastErrorCode}` : ''}
                            {op.lastErrorSummary ? ` · ${op.lastErrorSummary}` : ''}
                          </p>
                          {(opStatus === 'requires_attention' || opStatus === 'conflict') && (
                            <p className="text-[11px] text-red-700 dark:text-red-300 font-medium">
                              Automatic retries are paused because {opStatus === 'conflict' ? 'the server contains a newer state' : 'a permission or validation issue requires review'}. Inspect the item below before retrying.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPendingIds((prev) => ({
                                ...prev,
                                [op.operationId]: !prev[op.operationId],
                              }))
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 cursor-pointer"
                          >
                            {isInspecting ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            Inspect Queue Item
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyDiag(queueCopyKey, queueReportText)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            {copiedDiagId === queueCopyKey ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copiedDiagId === queueCopyKey ? 'Copied Report' : 'Copy Diagnostic Report'}
                          </button>
                          <button
                            type="button"
                            disabled={retryingOpId === op.operationId}
                            onClick={async () => {
                              setRetryingOpId(op.operationId);
                              try {
                                const ok = await retryPendingOperation(op.operationId);
                                if (ok) {
                                  setNotice(
                                    `Pending sync "${op.summary}" completed and saved to Cloud Vault.`
                                  );
                                }
                              } finally {
                                setRetryingOpId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${retryingOpId === op.operationId ? 'animate-spin' : ''}`}
                            />
                            {retryingOpId === op.operationId ? 'Retrying...' : 'Retry Sync'}
                          </button>
                          <button
                            type="button"
                            onClick={() => discardPendingOperation(op.operationId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" /> Discard
                          </button>
                        </div>
                      </div>

                      {isInspecting && (
                        <div className="pt-2.5 border-t border-amber-200/80 dark:border-amber-900/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px] text-neutral-700 dark:text-neutral-300">
                          <div>
                            <span className="text-neutral-500 block">Operation ID &amp; Type</span>
                            <span className="font-mono break-all">
                              {op.operationId} ({op.recordType || 'trade'} · {op.operationType || 'update'})
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Workspace / Owner UID</span>
                            <span className="font-mono break-all">
                              {op.workspaceId || op.userId} (user: {op.userId})
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Target Trade ID</span>
                            <span className="font-mono break-all">{inspection.tradeId || 'Missing'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Workspace / Auth Match</span>
                            <span
                              className={`font-medium ${
                                inspection.userIdMatch
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-red-700 dark:text-red-400'
                              }`}
                            >
                              {inspection.userIdMatch ? 'Matched to signed-in owner' : 'Account mismatch'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Status &amp; Result Transition</span>
                            <span className="font-mono">
                              {currentTrade?.status || 'unknown'} -&gt; {inspection.intendedStatus} · {inspection.intendedResult}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Last Error Code &amp; Category</span>
                            <span className="font-mono">
                              {op.lastErrorCode || matchingDiag?.errorCode || 'n/a'} ·{' '}
                              {op.lastErrorCategory || matchingDiag?.category || 'n/a'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Session Linkage</span>
                            <span className="font-mono">
                              {inspection.isOutOfSession
                                ? 'Out-of-Session'
                                : inspection.sessionId || 'Out-of-Session'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Exit Timestamp</span>
                            <span className="font-mono">{inspection.exitTimestamp || 'Missing'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500 block">Close Event Payload</span>
                            <span className="font-mono break-all">
                              {inspection.closeEventId || 'n/a'} ({inspection.closeEventPhase || 'exit'} /{' '}
                              {inspection.closeEventType || 'trade_closed'})
                            </span>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <span className="text-neutral-500 block">Firestore Batch Targets ({inspection.batchTargets.length})</span>
                            <span className="font-mono break-all">
                              {inspection.batchTargets.join(' , ')}
                            </span>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <span className="text-neutral-500 block">Payload Validation &amp; Update Keys</span>
                            {inspection.valid ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium break-all">
                                Valid — sanitized update ready for Cloud Vault ({inspection.updateFieldKeys.length}{' '}
                                fields: {inspection.updateFieldKeys.join(', ')})
                                {inspection.expectedSourceUpdatedAt
                                  ? ` · expectedSourceUpdatedAt=${inspection.expectedSourceUpdatedAt}`
                                  : ''}
                              </span>
                            ) : (
                              <span className="text-red-700 dark:text-red-400 font-medium">
                                Invalid — {inspection.validationErrors.join(' ')}
                              </span>
                            )}
                          </div>
                          {matchingDiag?.safeTechnicalMessage && (
                            <div className="sm:col-span-2 lg:col-span-3">
                              <span className="text-neutral-500 block">Latest Sanitized Firebase / Server Detail</span>
                              <span className="font-mono break-all text-red-700 dark:text-red-300">
                                {matchingDiag.safeTechnicalMessage}
                              </span>
                            </div>
                          )}
                          {op.attemptHistory && op.attemptHistory.length > 0 && (
                            <div className="sm:col-span-2 lg:col-span-3 pt-1.5 border-t border-amber-200/60 dark:border-amber-900/40 space-y-1">
                              <span className="text-neutral-500 block font-medium">
                                Attempt History ({op.attemptHistory.length})
                              </span>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {op.attemptHistory.map((h, idx) => (
                                  <div key={`${op.operationId}_att_${idx}`} className="font-mono text-[10px]">
                                    #{idx + 1} · {h.timestamp.slice(0, 19).replace('T', ' ')} · [{formatPendingStatusLabel(h.status)}]
                                    {h.errorCode ? ` ${h.errorCode}` : ''} — {h.summary}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Error History & Diagnostics */}
          <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Recent Error History &amp; Diagnostics ({diagnostics.length})
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Grouped, sanitized diagnostic records. Repeated attempts for the same operation are consolidated under one card.
                </p>
              </div>
              {diagnostics.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={clearResolvedDiagnostics}
                    className="px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    Clear Resolved
                  </button>
                  <button
                    type="button"
                    onClick={clearAllDiagnostics}
                    className="px-2.5 py-1.5 rounded-md border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {diagnostics.length === 0 ? (
              <p className="text-neutral-500 py-4">
                No diagnostic errors recorded in this browser workspace.
              </p>
            ) : (
              <div className="space-y-3">
                {diagnostics.map((d) => {
                  const isExpanded = Boolean(expandedDiagIds[d.id]);
                  const attemptCount = d.attemptCount ?? 1;
                  return (
                    <div
                      key={d.id}
                      className="p-3.5 rounded-md border border-neutral-200 dark:border-neutral-800 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                              {d.actionSummary}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-[11px]">
                              {ERROR_CATEGORY_LABELS[d.category]}
                            </span>
                            {attemptCount > 1 && (
                              <span className="px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 font-mono text-[11px]">
                                Attempts: {attemptCount}
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-medium capitalize ${
                                d.resolutionStatus === 'resolved'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : d.resolutionStatus === 'unresolved'
                                  ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                              }`}
                            >
                              {d.resolutionStatus}
                            </span>
                            <span className="font-mono text-[11px] text-neutral-500">
                              {d.correlationId}
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-500">
                            {d.timestamp.slice(0, 19).replace('T', ' ')} · {d.module} / {d.operation}
                            {d.recordId ? ` · Record ${d.recordId}` : ''}
                            {d.operationId ? ` · Op ${d.operationId}` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleCopyDiag(d.id, formatDiagnosticReport(d))}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            {copiedDiagId === d.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copiedDiagId === d.id ? 'Copied' : 'Copy Report'}
                          </button>
                          {d.resolutionStatus !== 'resolved' && (
                            <button
                              type="button"
                              onClick={() => markDiagnosticResolved(d.id, 'resolved')}
                              className="px-2.5 py-1 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                            >
                              Mark Resolved
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-neutral-700 dark:text-neutral-300">{d.userExplanation}</p>

                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-neutral-500">
                        <span>
                          <strong className="font-medium text-neutral-700 dark:text-neutral-300">
                            Local:
                          </strong>{' '}
                          {formatLocalStatusLabel(d.localStatus)}
                        </span>
                        <span>
                          <strong className="font-medium text-neutral-700 dark:text-neutral-300">
                            Cloud:
                          </strong>{' '}
                          {formatCloudStatusLabel(d.cloudStatus)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDiagIds((prev) => ({
                              ...prev,
                              [d.id]: !prev[d.id],
                            }))
                          }
                          className="inline-flex items-center gap-1 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                          Technical Details
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="p-2.5 rounded bg-neutral-50 dark:bg-neutral-900/70 border border-neutral-200 dark:border-neutral-800 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 break-all space-y-1.5">
                          <div>Code: {d.errorCode}</div>
                          <div>Sanitized Detail: {d.safeTechnicalMessage}</div>
                          <div>Next Step: {d.recommendedAction}</div>
                          {d.originalError && attemptCount > 1 && (
                            <div>
                              Original Error ({d.originalError.timestamp.slice(0, 19).replace('T', ' ')}):{' '}
                              {d.originalError.errorCode} — {d.originalError.userExplanation}
                            </div>
                          )}
                          {d.attemptHistory && d.attemptHistory.length > 1 && (
                            <div className="pt-1 border-t border-neutral-200 dark:border-neutral-800 space-y-0.5">
                              <div className="font-semibold">Attempt History ({d.attemptHistory.length}):</div>
                              {d.attemptHistory.map((h, i) => (
                                <div key={`${d.id}_hist_${i}`}>
                                  #{i + 1} · {h.timestamp.slice(0, 19).replace('T', ' ')} · {h.correlationId} ·{' '}
                                  {h.errorCode} · Cloud: {formatCloudStatusLabel(h.cloudStatus)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
