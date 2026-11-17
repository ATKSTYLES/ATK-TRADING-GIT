import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { APP_NAME, APP_VERSION, UTDS_FORMAT, UTDS_VERSION, generateId } from './defaults';
import type {
  Attachment,
  ChecklistDefinition,
  DailyJournal,
  ExportManifest,
  Instrument,
  Review,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradeEvent,
  TradeGroup,
  TradingAccount,
  TradingSession,
  UserPreferences,
  UserProfile,
  WorkspaceDataset,
} from './types';

export type ExportScope = 'complete_backup' | 'trading_records' | 'date_range';
export type ConflictResolution = 'skip' | 'copy' | 'replace';

export interface ImportConflict {
  entityType: string;
  id: string;
  label: string;
  existingUpdatedAt: string;
  incomingUpdatedAt: string;
  identical: boolean;
  resolution: ConflictResolution;
}

export interface ParsedImportBundle {
  manifest: ExportManifest;
  dataset: WorkspaceDataset;
  warnings: string[];
  unknownFieldNotes: string[];
  conflicts: ImportConflict[];
  totalDetected: number;
  attachmentCount: number;
  checksumValid: boolean;
}

const KNOWN_TRADE_KEYS = new Set([
  'id', 'tradeGroupId', 'userId', 'date', 'timezone', 'sessionId', 'isOutOfSession',
  'accountId', 'instrument', 'market', 'direction', 'status', 'bias', 'timeframe',
  'entryType', 'setupLabel', 'entryTimestamp', 'entryPrice', 'stopLoss', 'takeProfit',
  'positionSize', 'plannedRisk', 'riskPercent', 'expectedProfitPercent', 'actualProfitPercent',
  'tpOutcome', 'slOutcome', 'exitOutcome', 'entryReason', 'expectedOutcome',
  'preEntryEmotion', 'confidence', 'antiBiasPauseCompleted', 'duringTradeDurationSeconds',
  'exitTimestamp', 'exitPrice', 'exitReason', 'actualOutcome', 'grossPnl', 'commission',
  'otherCharges', 'netPnl', 'realisedR', 'result', 'postExitEmotions', 'mistakes',
  'lessons', 'disciplineQuestions', 'attachmentIds', 'sourceApplication',
  'sourceCreatedAt', 'sourceUpdatedAt', 'unknownFields', 'createdAt', 'updatedAt',
]);

const KNOWN_SESSION_KEYS = new Set([
  'id', 'userId', 'date', 'sessionName', 'sessionCategory', 'sessionTemplateId', 'timezone',
  'plannedStart', 'plannedEnd', 'actualStart', 'actualEnd', 'attendanceStatus',
  'arrivalDelayMinutes', 'earlyDepartureMinutes', 'setupAvailability',
  'sittingLocation', 'sittingLocationOther', 'preSessionEmotion', 'preSessionEmotionNote',
  'preSessionPreparation', 'sessionBias', 'sessionEmotions', 'postSessionEmotions',
  'sessionChecklist', 'sessionNotes', 'observations', 'steppedBackCount',
  'linkedTradeCount', 'sessionSummary', 'planAdherence', 'closingReflection',
  'status', 'sourceApplication', 'sourceCreatedAt', 'sourceUpdatedAt',
  'unknownFields', 'createdAt', 'updatedAt',
]);

function stripFirestoreMeta<T extends Record<string, unknown>>(doc: T): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'createdAt' || k === 'updatedAt') {
      if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
        copy[k] = (v as { toDate: () => Date }).toDate().toISOString();
      } else if (typeof v === 'string') {
        copy[k] = v;
      }
      continue;
    }
    copy[k] = v;
  }
  return copy;
}

function preserveUnknownFields(
  raw: Record<string, unknown>,
  knownKeys: Set<string>
): Record<string, unknown> | undefined {
  const unknown: Record<string, unknown> =
    raw.unknownFields && typeof raw.unknownFields === 'object' && !Array.isArray(raw.unknownFields)
      ? { ...(raw.unknownFields as Record<string, unknown>) }
      : {};
  let count = Object.keys(unknown).length;
  for (const [k, v] of Object.entries(raw)) {
    if (!knownKeys.has(k) && count < 30 && v !== undefined) {
      unknown[k] = v;
      count += 1;
    }
  }
  return Object.keys(unknown).length > 0 ? unknown : undefined;
}

async function computeSha256(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'sha256-unavailable';
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function filterDatasetByScope(
  dataset: WorkspaceDataset,
  scope: ExportScope,
  dateRange?: { start: string; end: string }
): WorkspaceDataset {
  if (scope === 'complete_backup') {
    return dataset;
  }

  const inRange = (d?: string) => {
    if (scope !== 'date_range' || !dateRange) return true;
    if (!d) return false;
    return d >= dateRange.start && d <= dateRange.end;
  };

  const sessions = dataset.sessions.filter((s) => inRange(s.date));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const trades = dataset.trades.filter((t) => inRange(t.date));
  const tradeIds = new Set(trades.map((t) => t.id));
  const dailyJournals = dataset.dailyJournals.filter((j) => inRange(j.date));
  const journalIds = new Set(dailyJournals.map((j) => j.id));
  const sessionEvents = dataset.sessionEvents.filter((e) => sessionIds.has(e.sessionId));
  const tradeEvents = dataset.tradeEvents.filter((e) => tradeIds.has(e.tradeId));
  const reviews = dataset.reviews.filter((r) => inRange(r.periodStart) || inRange(r.periodEnd));
  const reviewIds = new Set(reviews.map((r) => r.id));

  const attachments = dataset.attachments.filter((a) => {
    if (a.entityType === 'trade') return tradeIds.has(a.entityId);
    if (a.entityType === 'session') return sessionIds.has(a.entityId);
    if (a.entityType === 'daily_journal') return journalIds.has(a.entityId);
    if (a.entityType === 'review') return reviewIds.has(a.entityId);
    return false;
  });

  if (scope === 'trading_records') {
    return {
      profile: dataset.profile,
      accounts: dataset.accounts,
      dailyJournals,
      sessions,
      sessionEvents,
      trades,
      tradeEvents,
      tradeGroups: dataset.tradeGroups,
      attachments: [],
      sessionTemplates: [],
      checklists: [],
      instruments: [],
      preferences: null,
      reviews: [],
      auditLogs: [],
    };
  }

  return {
    ...dataset,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    tradeEvents,
    reviews,
    attachments,
  };
}

export async function buildUtdsZipBlob(
  dataset: WorkspaceDataset,
  scope: ExportScope,
  dateRange?: { start: string; end: string }
): Promise<{ blob: Blob; manifest: ExportManifest; filename: string }> {
  const filtered = filterDatasetByScope(dataset, scope, dateRange);
  const zip = new JSZip();

  const payloadFiles: Record<string, unknown> = {
    'profile.json': filtered.profile ? stripFirestoreMeta(filtered.profile as unknown as Record<string, unknown>) : null,
    'accounts.json': filtered.accounts.map((a) => stripFirestoreMeta(a as unknown as Record<string, unknown>)),
    'daily_journals.json': filtered.dailyJournals.map((j) => stripFirestoreMeta(j as unknown as Record<string, unknown>)),
    'sessions.json': filtered.sessions.map((s) => stripFirestoreMeta(s as unknown as Record<string, unknown>)),
    'session_events.json': filtered.sessionEvents.map((e) => stripFirestoreMeta(e as unknown as Record<string, unknown>)),
    'trades.json': filtered.trades.map((t) => stripFirestoreMeta(t as unknown as Record<string, unknown>)),
    'trade_events.json': filtered.tradeEvents.map((e) => stripFirestoreMeta(e as unknown as Record<string, unknown>)),
    'trade_groups.json': filtered.tradeGroups.map((g) => stripFirestoreMeta(g as unknown as Record<string, unknown>)),
    'reviews.json': filtered.reviews.map((r) => stripFirestoreMeta(r as unknown as Record<string, unknown>)),
    'settings.json': filtered.preferences ? stripFirestoreMeta(filtered.preferences as unknown as Record<string, unknown>) : null,
    'templates.json': filtered.sessionTemplates.map((t) => stripFirestoreMeta(t as unknown as Record<string, unknown>)),
    'instruments.json': filtered.instruments.map((i) => stripFirestoreMeta(i as unknown as Record<string, unknown>)),
    'checklists.json': filtered.checklists.map((c) => stripFirestoreMeta(c as unknown as Record<string, unknown>)),
  };

  let concatenated = '';
  for (const [name, content] of Object.entries(payloadFiles)) {
    const json = JSON.stringify(content, null, 2);
    concatenated += json;
    zip.file(name, json);
  }

  const attachmentsFolder = zip.folder('attachments');
  const attachmentMeta = filtered.attachments.map((att) => {
    const safeName = `${att.id}_${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if (attachmentsFolder && att.dataUrl) {
      try {
        attachmentsFolder.file(safeName, dataUrlToUint8Array(att.dataUrl));
      } catch {
        // Skip binary write if malformed dataUrl
      }
    }
    const stripped = stripFirestoreMeta(att as unknown as Record<string, unknown>);
    delete stripped.dataUrl;
    return { ...stripped, archivePath: `attachments/${safeName}` };
  });

  const attIndexJson = JSON.stringify(attachmentMeta, null, 2);
  zip.file('attachments_index.json', attIndexJson);
  concatenated += attIndexJson;

  const checksum = await computeSha256(concatenated);

  const manifest: ExportManifest = {
    format: UTDS_FORMAT,
    format_version: UTDS_VERSION,
    export_timestamp: new Date().toISOString(),
    source_application: APP_NAME,
    source_application_version: APP_VERSION,
    export_scope: scope,
    ...(scope === 'date_range' && dateRange ? { date_range: dateRange } : {}),
    record_counts: {
      profile: filtered.profile ? 1 : 0,
      accounts: filtered.accounts.length,
      daily_journals: filtered.dailyJournals.length,
      sessions: filtered.sessions.length,
      session_events: filtered.sessionEvents.length,
      trades: filtered.trades.length,
      trade_events: filtered.tradeEvents.length,
      trade_groups: filtered.tradeGroups.length,
      reviews: filtered.reviews.length,
      templates: filtered.sessionTemplates.length,
      instruments: filtered.instruments.length,
      checklists: filtered.checklists.length,
    },
    attachment_count: filtered.attachments.length,
    checksum_sha256: checksum,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename =
    scope === 'complete_backup'
      ? `ATK_Trading_Backup_${dateStamp}.zip`
      : `ATK_UTDS_${scope}_${dateStamp}.zip`;

  return { blob, manifest, filename };
}

export async function buildUtdsJsonBlob(
  dataset: WorkspaceDataset,
  scope: ExportScope,
  dateRange?: { start: string; end: string }
): Promise<{ blob: Blob; filename: string; manifest: ExportManifest }> {
  const filtered = filterDatasetByScope(dataset, scope, dateRange);
  const body = {
    profile: filtered.profile ? stripFirestoreMeta(filtered.profile as unknown as Record<string, unknown>) : null,
    accounts: filtered.accounts.map((a) => stripFirestoreMeta(a as unknown as Record<string, unknown>)),
    daily_journals: filtered.dailyJournals.map((j) => stripFirestoreMeta(j as unknown as Record<string, unknown>)),
    sessions: filtered.sessions.map((s) => stripFirestoreMeta(s as unknown as Record<string, unknown>)),
    session_events: filtered.sessionEvents.map((e) => stripFirestoreMeta(e as unknown as Record<string, unknown>)),
    trades: filtered.trades.map((t) => stripFirestoreMeta(t as unknown as Record<string, unknown>)),
    trade_events: filtered.tradeEvents.map((e) => stripFirestoreMeta(e as unknown as Record<string, unknown>)),
    trade_groups: filtered.tradeGroups.map((g) => stripFirestoreMeta(g as unknown as Record<string, unknown>)),
    reviews: filtered.reviews.map((r) => stripFirestoreMeta(r as unknown as Record<string, unknown>)),
    settings: filtered.preferences ? stripFirestoreMeta(filtered.preferences as unknown as Record<string, unknown>) : null,
    templates: filtered.sessionTemplates.map((t) => stripFirestoreMeta(t as unknown as Record<string, unknown>)),
    instruments: filtered.instruments.map((i) => stripFirestoreMeta(i as unknown as Record<string, unknown>)),
    checklists: filtered.checklists.map((c) => stripFirestoreMeta(c as unknown as Record<string, unknown>)),
    attachments: filtered.attachments.map((a) => stripFirestoreMeta(a as unknown as Record<string, unknown>)),
  };
  const checksum = await computeSha256(JSON.stringify(body));
  const manifest: ExportManifest = {
    format: UTDS_FORMAT,
    format_version: UTDS_VERSION,
    export_timestamp: new Date().toISOString(),
    source_application: APP_NAME,
    source_application_version: APP_VERSION,
    export_scope: scope,
    ...(scope === 'date_range' && dateRange ? { date_range: dateRange } : {}),
    record_counts: {
      accounts: filtered.accounts.length,
      daily_journals: filtered.dailyJournals.length,
      sessions: filtered.sessions.length,
      session_events: filtered.sessionEvents.length,
      trades: filtered.trades.length,
      trade_events: filtered.tradeEvents.length,
      reviews: filtered.reviews.length,
    },
    attachment_count: filtered.attachments.length,
    checksum_sha256: checksum,
  };
  const json = JSON.stringify({ manifest, ...body }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = `ATK_UTDS_Export_${new Date().toISOString().slice(0, 10)}.json`;
  return { blob, filename, manifest };
}

function escapeCsv(val: unknown): string {
  const s = val === undefined || val === null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildTradesCsvBlob(trades: Trade[], accounts: TradingAccount[]): Blob {
  const accMap = new Map(accounts.map((a) => [a.id, a.name]));
  const headers = [
    'Trade ID', 'Date', 'Account', 'Session ID', 'Out Of Session', 'Instrument', 'Market',
    'Direction', 'Status', 'Timeframe', 'Setup', 'Entry Time', 'Entry Price',
    'Stop Loss', 'Take Profit', 'Position Size', 'Planned Risk', 'Risk %',
    'Expected Profit %', 'Actual Profit %', 'TP Outcome', 'SL Outcome', 'Exit Outcome',
    'Exit Time', 'Exit Price', 'Gross P&L', 'Commission', 'Other Charges', 'Net P&L',
    'Realised R', 'Result', 'Pre-Entry Emotion', 'Confidence', 'Followed Plan',
    'Followed Risk', 'Impulsive Entry', 'Exited Per Plan', 'Mistakes', 'Lessons',
  ];
  const rows = trades.map((t) => [
    t.id,
    t.date,
    accMap.get(t.accountId) || t.accountId,
    t.sessionId || '',
    t.isOutOfSession ? 'Yes' : 'No',
    t.instrument,
    t.market || '',
    t.direction,
    t.status,
    t.timeframe || '',
    t.setupLabel || '',
    t.entryTimestamp || '',
    t.entryPrice ?? '',
    t.stopLoss ?? '',
    t.takeProfit ?? '',
    t.positionSize ?? '',
    t.plannedRisk ?? '',
    t.riskPercent ?? '',
    t.expectedProfitPercent ?? '',
    t.actualProfitPercent ?? '',
    t.tpOutcome ?? '',
    t.slOutcome ?? '',
    t.exitOutcome ?? '',
    t.exitTimestamp || '',
    t.exitPrice ?? '',
    t.grossPnl ?? '',
    t.commission ?? '',
    t.otherCharges ?? '',
    t.netPnl ?? '',
    t.realisedR ?? '',
    t.result,
    t.preEntryEmotion || '',
    t.confidence ?? '',
    t.disciplineQuestions?.followedPlan ?? '',
    t.disciplineQuestions?.followedRiskRules ?? '',
    t.disciplineQuestions?.impulsiveEntry ?? '',
    t.disciplineQuestions?.exitedPerPlan ?? '',
    (t.mistakes || []).join('; '),
    t.lessons || '',
  ]);
  const csv = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

export function buildXlsxBlob(dataset: WorkspaceDataset, scope: ExportScope, dateRange?: { start: string; end: string }): Blob {
  const filtered = filterDatasetByScope(dataset, scope, dateRange);
  const accMap = new Map(filtered.accounts.map((a) => [a.id, a.name]));

  const wb = XLSX.utils.book_new();

  const tradeRows = filtered.trades.map((t) => ({
    ID: t.id,
    Date: t.date,
    Account: accMap.get(t.accountId) || t.accountId,
    SessionID: t.sessionId || '',
    OutOfSession: t.isOutOfSession,
    Instrument: t.instrument,
    Direction: t.direction,
    Status: t.status,
    Setup: t.setupLabel || '',
    Timeframe: t.timeframe || '',
    RiskPercent: t.riskPercent ?? null,
    ExpectedProfitPercent: t.expectedProfitPercent ?? null,
    ActualProfitPercent: t.actualProfitPercent ?? null,
    TPOutcome: t.tpOutcome || '',
    SLOutcome: t.slOutcome || '',
    ExitOutcome: t.exitOutcome || '',
    EntryPrice: t.entryPrice ?? null,
    ExitPrice: t.exitPrice ?? null,
    GrossPnL: t.grossPnl ?? null,
    Commission: t.commission ?? null,
    OtherCharges: t.otherCharges ?? null,
    NetPnL: t.netPnl ?? null,
    RealisedR: t.realisedR ?? null,
    Result: t.result,
    PreEntryEmotion: t.preEntryEmotion || '',
    Confidence: t.confidence ?? null,
    Lessons: t.lessons || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradeRows), 'Trades');

  const sessionRows = filtered.sessions.map((s) => ({
    ID: s.id,
    Date: s.date,
    SessionName: s.sessionName,
    Category: s.sessionCategory || 'standard',
    Status: s.status,
    Attendance: s.attendanceStatus,
    SittingLocation: s.sittingLocation === 'Other' ? s.sittingLocationOther || 'Other' : s.sittingLocation || '',
    PreSessionEmotion: s.preSessionEmotion || '',
    SetupAvailability: s.setupAvailability || '',
    PlanAdherence: s.planAdherence || '',
    SteppedBackCount: s.steppedBackCount,
    LinkedTrades: s.linkedTradeCount,
    ActualStart: s.actualStart || '',
    ActualEnd: s.actualEnd || '',
    ClosingReflection: s.closingReflection || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionRows), 'Sessions');

  const journalRows = filtered.dailyJournals.map((j) => ({
    ID: j.id,
    Date: j.date,
    EmotionalState: j.dailyEmotionalState || '',
    DisciplineRating: j.disciplineRating ?? null,
    ChecklistCompleted: j.checklistItems.filter((c) => c.completed).length,
    ChecklistTotal: j.checklistItems.length,
    MorningNotes: j.morningNotes || '',
    DailyReflection: j.dailyReflection || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(journalRows), 'Daily Journals');

  const reviewRows = filtered.reviews.map((r) => ({
    ID: r.id,
    Type: r.reviewType,
    Title: r.title,
    PeriodStart: r.periodStart,
    PeriodEnd: r.periodEnd,
    Rating: r.rating ?? null,
    Summary: r.summary || '',
    Mistakes: r.tradingMistakes || '',
    Lessons: r.lessonsLearned || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reviewRows), 'Reviews');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function migrateVersionIfNeeded(
  manifest: ExportManifest,
  warnings: string[]
): ExportManifest {
  const version = manifest.format_version || '1.0.0';
  const [major] = version.split('.').map(Number);
  if (major === 0) {
    warnings.push(`Migrated legacy ATK-UTDS v${version} structure to v${UTDS_VERSION}.`);
    return { ...manifest, format_version: UTDS_VERSION };
  }
  if (major > 1) {
    warnings.push(
      `Backup uses newer schema v${version}. Compatible fields will be imported and unrecognized fields preserved.`
    );
  }
  return manifest;
}

export async function parseAndValidateImportFile(
  file: File,
  existing: WorkspaceDataset,
  targetUserId: string
): Promise<ParsedImportBundle> {
  const warnings: string[] = [];
  const unknownFieldNotes: string[] = [];

  let manifest: ExportManifest | null = null;
  let rawProfile: Record<string, unknown> | null = null;
  let rawAccounts: Record<string, unknown>[] = [];
  let rawJournals: Record<string, unknown>[] = [];
  let rawSessions: Record<string, unknown>[] = [];
  let rawSessionEvents: Record<string, unknown>[] = [];
  let rawTrades: Record<string, unknown>[] = [];
  let rawTradeEvents: Record<string, unknown>[] = [];
  let rawTradeGroups: Record<string, unknown>[] = [];
  let rawReviews: Record<string, unknown>[] = [];
  let rawSettings: Record<string, unknown> | null = null;
  let rawTemplates: Record<string, unknown>[] = [];
  let rawInstruments: Record<string, unknown>[] = [];
  let rawChecklists: Record<string, unknown>[] = [];
  let rawAttachments: Attachment[] = [];
  let checksumValid = true;

  if (file.name.toLowerCase().endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    manifest = (parsed.manifest as ExportManifest) ?? null;
    rawProfile = (parsed.profile as Record<string, unknown>) ?? null;
    rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    rawJournals = Array.isArray(parsed.daily_journals) ? parsed.daily_journals : [];
    rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    rawSessionEvents = Array.isArray(parsed.session_events) ? parsed.session_events : [];
    rawTrades = Array.isArray(parsed.trades) ? parsed.trades : [];
    rawTradeEvents = Array.isArray(parsed.trade_events) ? parsed.trade_events : [];
    rawTradeGroups = Array.isArray(parsed.trade_groups) ? parsed.trade_groups : [];
    rawReviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
    rawSettings = (parsed.settings as Record<string, unknown>) ?? null;
    rawTemplates = Array.isArray(parsed.templates) ? parsed.templates : [];
    rawInstruments = Array.isArray(parsed.instruments) ? parsed.instruments : [];
    rawChecklists = Array.isArray(parsed.checklists) ? parsed.checklists : [];
    rawAttachments = Array.isArray(parsed.attachments) ? (parsed.attachments as Attachment[]) : [];
  } else {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid ATK-UTDS archive: manifest.json is missing.');
    }
    manifest = JSON.parse(await manifestFile.async('string')) as ExportManifest;

    const readJson = async <T>(name: string, fallback: T): Promise<T> => {
      const entry = zip.file(name);
      if (!entry) return fallback;
      const content = await entry.async('string');
      return JSON.parse(content) as T;
    };

    const fileOrder = [
      'profile.json', 'accounts.json', 'daily_journals.json', 'sessions.json',
      'session_events.json', 'trades.json', 'trade_events.json', 'trade_groups.json',
      'reviews.json', 'settings.json', 'templates.json', 'instruments.json', 'checklists.json',
    ];
    let concatenated = '';
    for (const f of fileOrder) {
      const entry = zip.file(f);
      if (entry) {
        concatenated += await entry.async('string');
      }
    }
    const attIndexEntry = zip.file('attachments_index.json');
    if (attIndexEntry) {
      concatenated += await attIndexEntry.async('string');
    }

    if (manifest.checksum_sha256 && manifest.checksum_sha256 !== 'sha256-unavailable') {
      const actualHash = await computeSha256(concatenated);
      checksumValid = actualHash === manifest.checksum_sha256;
      if (!checksumValid) {
        warnings.push('Archive checksum differs from manifest; verify source file integrity before confirming.');
      }
    }

    rawProfile = await readJson('profile.json', null);
    rawAccounts = await readJson('accounts.json', []);
    rawJournals = await readJson('daily_journals.json', []);
    rawSessions = await readJson('sessions.json', []);
    rawSessionEvents = await readJson('session_events.json', []);
    rawTrades = await readJson('trades.json', []);
    rawTradeEvents = await readJson('trade_events.json', []);
    rawTradeGroups = await readJson('trade_groups.json', []);
    rawReviews = await readJson('reviews.json', []);
    rawSettings = await readJson('settings.json', null);
    rawTemplates = await readJson('templates.json', []);
    rawInstruments = await readJson('instruments.json', []);
    rawChecklists = await readJson('checklists.json', []);

    const attIndex = await readJson<Array<Record<string, unknown>>>('attachments_index.json', []);
    for (const meta of attIndex) {
      const archivePath = String(meta.archivePath || '');
      const binFile = archivePath ? zip.file(archivePath) : null;
      if (binFile) {
        const bytes = await binFile.async('uint8array');
        const mime = String(meta.mimeType || 'image/png');
        rawAttachments.push({
          ...(meta as unknown as Attachment),
          userId: targetUserId,
          dataUrl: uint8ArrayToDataUrl(bytes, mime),
        });
      } else {
        warnings.push(`Attachment binary missing in archive: ${String(meta.filename || meta.id)}`);
      }
    }
  }

  if (!manifest || manifest.format !== UTDS_FORMAT) {
    throw new Error('Unsupported backup format: expected format "ATK-UTDS".');
  }
  manifest = migrateVersionIfNeeded(manifest, warnings);

  // Normalize entities while preserving original IDs, timestamps, relationships, and unknownFields
  const accounts: TradingAccount[] = rawAccounts.map((r) => ({
    ...(r as unknown as TradingAccount),
    id: String(r.id || generateId('acc')),
    userId: targetUserId,
  }));

  const dailyJournals: DailyJournal[] = rawJournals.map((r) => ({
    ...(r as unknown as DailyJournal),
    id: String(r.id || r.date || generateId('dj')),
    userId: targetUserId,
  }));

  const sessions: TradingSession[] = rawSessions.map((r) => {
    const unknownFields = preserveUnknownFields(r, KNOWN_SESSION_KEYS);
    if (unknownFields) {
      unknownFieldNotes.push(`Session ${String(r.id)} preserved ${Object.keys(unknownFields).length} extended field(s).`);
    }
    return {
      ...(r as unknown as TradingSession),
      id: String(r.id || generateId('ses')),
      userId: targetUserId,
      steppedBackCount: Number(r.steppedBackCount ?? 0),
      linkedTradeCount: Number(r.linkedTradeCount ?? 0),
      ...(unknownFields ? { unknownFields } : {}),
    };
  });

  const sessionEvents: SessionEvent[] = rawSessionEvents.map((r) => ({
    ...(r as unknown as SessionEvent),
    id: String(r.id || generateId('se')),
    userId: targetUserId,
  }));

  const trades: Trade[] = rawTrades.map((r) => {
    const unknownFields = preserveUnknownFields(r, KNOWN_TRADE_KEYS);
    if (unknownFields) {
      unknownFieldNotes.push(`Trade ${String(r.id)} preserved ${Object.keys(unknownFields).length} extended field(s).`);
    }
    return {
      ...(r as unknown as Trade),
      id: String(r.id || generateId('trd')),
      userId: targetUserId,
      isOutOfSession: Boolean(r.isOutOfSession ?? !r.sessionId),
      ...(unknownFields ? { unknownFields } : {}),
    };
  });

  const tradeEvents: TradeEvent[] = rawTradeEvents.map((r) => ({
    ...(r as unknown as TradeEvent),
    id: String(r.id || generateId('te')),
    userId: targetUserId,
  }));

  const tradeGroups: TradeGroup[] = rawTradeGroups.map((r) => ({
    ...(r as unknown as TradeGroup),
    id: String(r.id || generateId('tg')),
    userId: targetUserId,
  }));

  const reviews: Review[] = rawReviews.map((r) => ({
    ...(r as unknown as Review),
    id: String(r.id || generateId('rev')),
    userId: targetUserId,
  }));

  const sessionTemplates: SessionTemplate[] = rawTemplates.map((r) => ({
    ...(r as unknown as SessionTemplate),
    id: String(r.id || generateId('tpl')),
    userId: targetUserId,
  }));

  const instruments: Instrument[] = rawInstruments.map((r) => ({
    ...(r as unknown as Instrument),
    id: String(r.id || generateId('inst')),
    userId: targetUserId,
  }));

  const checklists: ChecklistDefinition[] = rawChecklists.map((r) => ({
    ...(r as unknown as ChecklistDefinition),
    id: String(r.id || generateId('chk')),
    userId: targetUserId,
  }));

  const attachments: Attachment[] = rawAttachments.map((a) => ({
    ...a,
    id: String(a.id || generateId('att')),
    userId: targetUserId,
  }));

  const preferences: UserPreferences | null = rawSettings
    ? {
        ...(rawSettings as unknown as UserPreferences),
        id: 'pref_default',
        userId: targetUserId,
      }
    : null;

  const profile: UserProfile | null = rawProfile
    ? {
        ...(rawProfile as unknown as UserProfile),
        id: targetUserId,
        userId: targetUserId,
      }
    : null;

  // Duplicate & Conflict Detection
  const conflicts: ImportConflict[] = [];
  const checkConflicts = <T extends { id: string; sourceUpdatedAt?: string }>(
    entityType: string,
    incomingList: T[],
    existingList: T[],
    getLabel: (item: T) => string
  ) => {
    const existingMap = new Map(existingList.map((e) => [e.id, e]));
    for (const item of incomingList) {
      const match = existingMap.get(item.id);
      if (match) {
        const incTs = item.sourceUpdatedAt || '';
        const extTs = match.sourceUpdatedAt || '';
        const identical = JSON.stringify(stripFirestoreMeta(item as unknown as Record<string, unknown>)) ===
          JSON.stringify(stripFirestoreMeta(match as unknown as Record<string, unknown>));
        conflicts.push({
          entityType,
          id: item.id,
          label: getLabel(item),
          existingUpdatedAt: extTs || 'Unknown',
          incomingUpdatedAt: incTs || 'Unknown',
          identical,
          resolution: 'skip',
        });
      }
    }
  };

  checkConflicts('account', accounts, existing.accounts, (a) => a.name);
  checkConflicts('daily_journal', dailyJournals, existing.dailyJournals, (j) => `Journal ${j.date}`);
  checkConflicts('session', sessions, existing.sessions, (s) => `${s.date} · ${s.sessionName}`);
  checkConflicts('trade', trades, existing.trades, (t) => `${t.date} · ${t.instrument} (${t.direction})`);
  checkConflicts('review', reviews, existing.reviews, (r) => r.title);
  checkConflicts('session_template', sessionTemplates, existing.sessionTemplates, (t) => t.name);
  checkConflicts('instrument', instruments, existing.instruments, (i) => i.symbol);
  checkConflicts('checklist', checklists, existing.checklists, (c) => c.name);

  const totalDetected =
    accounts.length +
    dailyJournals.length +
    sessions.length +
    sessionEvents.length +
    trades.length +
    tradeEvents.length +
    tradeGroups.length +
    reviews.length +
    sessionTemplates.length +
    instruments.length +
    checklists.length +
    attachments.length;

  return {
    manifest,
    dataset: {
      profile,
      accounts,
      dailyJournals,
      sessions,
      sessionEvents,
      trades,
      tradeEvents,
      tradeGroups,
      attachments,
      sessionTemplates,
      checklists,
      instruments,
      preferences,
      reviews,
      auditLogs: [],
    },
    warnings,
    unknownFieldNotes: unknownFieldNotes.slice(0, 10),
    conflicts,
    totalDetected,
    attachmentCount: attachments.length,
    checksumValid,
  };
}
