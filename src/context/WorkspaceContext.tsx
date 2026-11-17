import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  APP_NAME,
  DEFAULT_DAILY_CHECKLIST_ITEMS,
  DEFAULT_TIMEZONE,
  createChecklistStates,
  generateId,
  getCurrentTimeMinutesInTimezone,
  getLocalDateString,
  parseTimeToMinutes,
} from '../domain/defaults';
import { computeTradeFinancials, formatCurrency, formatSignedPercent } from '../domain/calculations';
import type {
  Attachment,
  AttachmentEntityType,
  ChecklistDefinition,
  DailyJournal,
  ExitOutcome,
  Instrument,
  PlanAdherence,
  Review,
  SessionAttendanceStatus,
  SessionCategory,
  SessionEvent,
  SessionTemplate,
  SetupAvailability,
  SittingLocation,
  SlOutcome,
  ThemeMode,
  TpOutcome,
  Trade,
  TradeEvent,
  TradeResult,
  TradingAccount,
  TradingSession,
  UserPreferences,
  UserProfile,
  WorkspaceDataset,
} from '../domain/types';
import {
  inspectAndRepairPendingTradeClose,
  loadDiagnosticHistory,
  loadPendingOperations,
  pendingStatusForCategory,
  persistDiagnosticHistory,
  removePendingOperation,
  savePendingOperation,
  shouldAutoRetryPendingOp,
  StructuredAppError,
  upsertGroupedDiagnostic,
  type ClassifyErrorContext,
  type DiagnosticRecord,
  type PendingOperationRecord,
} from '../domain/diagnostics';
import { errorHandler } from '../services/ErrorHandler';
import {
  auth,
  googleAuthProvider,
  testFirestoreConnection,
} from '../storage/firebase';
import {
  commitAtomicSessionClose,
  commitAtomicSessionStart,
  commitAtomicTradeClose,
  commitAtomicTradeCreate,
  commitAtomicTradeDelete,
  commitAtomicTradeEnter,
  createImmutableRecord,
  deleteEntity,
  ensureUserWorkspace,
  loadFullWorkspace,
  recordAuditLog,
  saveProfileUpdates,
  upsertEntity,
} from '../storage/repository';

export type NavRoute =
  | 'dashboard'
  | 'daily_journal'
  | 'records'
  | 'trades'
  | 'calendar'
  | 'analytics'
  | 'reviews'
  | 'settings';

export type SettingsTabRoute =
  | 'profile'
  | 'accounts'
  | 'templates'
  | 'instruments'
  | 'export_import'
  | 'diagnostics';

export interface StartSessionInput {
  date?: string;
  sessionName: string;
  sessionCategory?: SessionCategory;
  templateId?: string;
  plannedStart?: string;
  plannedEnd?: string;
  sittingLocation?: SittingLocation;
  sittingLocationOther?: string;
  preSessionEmotion?: string;
  preSessionEmotionNote?: string;
  preSessionPreparation?: string;
  sessionBias?: string;
  sessionChecklistLabels?: string[];
}

export interface CreateTradeInput {
  date?: string;
  statusMode?: 'before_entry' | 'during_trade';
  sessionId?: string;
  isOutOfSession: boolean;
  accountId: string;
  instrument: string;
  market?: string;
  direction: 'long' | 'short';
  timeframe?: string;
  entryType?: string;
  setupLabel?: string;
  bias?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionSize?: number;
  plannedRisk?: number;
  riskPercent?: number;
  expectedProfitPercent?: number;
  actualProfitPercent?: number;
  tpOutcome?: TpOutcome;
  slOutcome?: SlOutcome;
  entryReason?: string;
  expectedOutcome?: string;
  preEntryEmotion?: string;
  confidence?: number;
  antiBiasPauseCompleted?: boolean;
}

export interface CloseTradeInput {
  exitTimestamp: string;
  exitPrice?: number;
  exitReason?: string;
  actualOutcome?: string;
  exitOutcome?: ExitOutcome;
  tpOutcome?: TpOutcome;
  slOutcome?: SlOutcome;
  actualProfitPercent?: number;
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  explicitResult?: TradeResult;
  postExitEmotions: string[];
  mistakes: string[];
  lessons: string;
  disciplineQuestions: NonNullable<Trade['disciplineQuestions']>;
  duringTradeDurationSeconds?: number;
}

interface WorkspaceContextValue {
  user: User | null;
  authReady: boolean;
  authError: string | null;
  loadingData: boolean;
  dataset: WorkspaceDataset;
  activeRoute: NavRoute;
  setActiveRoute: (route: NavRoute) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedJournalDate: string;
  setSelectedJournalDate: (date: string) => void;
  openDailyJournalForDate: (date: string) => void;
  openRecordsForDate: (date: string) => void;
  openDailySessionsForDate: (date: string) => void;
  theme: ThemeMode;
  toggleTheme: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  reloadWorkspace: () => Promise<void>;
  activeLiveSession: TradingSession | null;
  activeTrade: Trade | null;
  openTrades: Trade[];
  setActiveTradeId: (id: string | null) => void;
  // Domain Actions
  saveDailyJournal: (journal: DailyJournal) => Promise<void>;
  startSession: (input: StartSessionInput) => Promise<TradingSession>;
  createPlannedSession: (input: {
    date: string;
    sessionName: string;
    sessionCategory?: SessionCategory;
    templateId?: string;
    plannedStart?: string;
    plannedEnd?: string;
    preSessionPreparation?: string;
    sessionBias?: string;
  }) => Promise<TradingSession>;
  activatePlannedSession: (
    session: TradingSession,
    checkIn?: Partial<
      Pick<
        TradingSession,
        | 'sessionCategory'
        | 'sittingLocation'
        | 'sittingLocationOther'
        | 'preSessionEmotion'
        | 'preSessionEmotionNote'
        | 'preSessionPreparation'
        | 'sessionBias'
      >
    >
  ) => Promise<void>;
  updateSessionFields: (session: TradingSession) => Promise<void>;
  markSessionOutcome: (session: TradingSession, status: 'missed' | 'cancelled') => Promise<void>;
  closeLiveSession: (
    session: TradingSession,
    closing: {
      actualEnd: string;
      attendanceStatus: SessionAttendanceStatus;
      setupAvailability: SetupAvailability;
      planAdherence: PlanAdherence;
      postSessionEmotions: string[];
      closingReflection: string;
      sessionSummary?: string;
    }
  ) => Promise<void>;
  logSessionEvent: (input: {
    sessionId: string;
    eventType: string;
    label: string;
    notes?: string;
    emotion?: string;
    isSteppedBack?: boolean;
  }) => Promise<void>;
  createBeforeEntryTrade: (input: CreateTradeInput) => Promise<Trade>;
  enterTrade: (trade: Trade, entryPrice?: number, notes?: string) => Promise<Trade>;
  logTradeEvent: (input: {
    tradeId: string;
    phase: TradeEvent['phase'];
    eventType: string;
    label: string;
    details?: string;
    price?: number;
    quantity?: number;
    emotion?: string;
  }) => Promise<void>;
  updateDuringTrade: (trade: Trade, patch: Partial<Trade>) => Promise<void>;
  closeTrade: (
    trade: Trade,
    exit: CloseTradeInput,
    options?: { operationId?: string; expectedSourceUpdatedAt?: string }
  ) => Promise<{ outcome: 'closed' | 'already_closed_by_this_op' }>;
  saveHistoricalTrade: (trade: Trade, existsAlready: boolean) => Promise<void>;
  deleteTradeRecord: (tradeId: string) => Promise<void>;
  addAttachment: (input: {
    entityType: AttachmentEntityType;
    entityId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
    caption?: string;
  }) => Promise<Attachment>;
  removeAttachment: (attachmentId: string) => Promise<void>;
  saveReview: (review: Review, existsAlready: boolean) => Promise<void>;
  removeReview: (reviewId: string) => Promise<void>;
  saveAccount: (account: TradingAccount, existsAlready: boolean) => Promise<void>;
  saveInstrument: (instrument: Instrument, existsAlready: boolean) => Promise<void>;
  saveSessionTemplate: (template: SessionTemplate, existsAlready: boolean) => Promise<void>;
  saveChecklist: (checklist: ChecklistDefinition, existsAlready: boolean) => Promise<void>;
  savePreferences: (prefs: UserPreferences) => Promise<void>;
  saveProfile: (updates: Partial<Pick<UserProfile, 'displayName' | 'timezone' | 'currency' | 'theme'>>) => Promise<void>;
  logAudit: (action: Parameters<typeof recordAuditLog>[1], details: string, count: number) => Promise<void>;
  // Global Error Diagnostics & Pending Recovery
  diagnostics: DiagnosticRecord[];
  activeError: DiagnosticRecord | null;
  pendingOperations: PendingOperationRecord[];
  retryingDiagnostic: boolean;
  requestedSettingsTab: SettingsTabRoute | null;
  clearRequestedSettingsTab: () => void;
  openDiagnosticsView: () => void;
  dismissActiveError: () => void;
  markDiagnosticResolved: (id: string, status?: 'resolved' | 'dismissed') => void;
  clearResolvedDiagnostics: () => void;
  clearAllDiagnostics: () => void;
  reportDiagnostic: (
    err: unknown,
    ctx: Omit<ClassifyErrorContext, 'workspaceId' | 'isOnline' | 'emailVerified'>,
    retryFn?: () => Promise<void>
  ) => DiagnosticRecord;
  retryActiveError: () => Promise<void>;
  retryPendingOperation: (operationId: string) => Promise<boolean>;
  discardPendingOperation: (operationId: string) => void;
}

const EMPTY_DATASET: WorkspaceDataset = {
  profile: null,
  accounts: [],
  dailyJournals: [],
  sessions: [],
  sessionEvents: [],
  trades: [],
  tradeEvents: [],
  tradeGroups: [],
  attachments: [],
  sessionTemplates: [],
  checklists: [],
  instruments: [],
  preferences: null,
  reviews: [],
  auditLogs: [],
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataset, setDataset] = useState<WorkspaceDataset>(EMPTY_DATASET);
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    getLocalDateString(new Date(), DEFAULT_TIMEZONE)
  );
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRecord[]>([]);
  const [activeError, setActiveError] = useState<DiagnosticRecord | null>(null);
  const [pendingOperations, setPendingOperations] = useState<PendingOperationRecord[]>([]);
  const [retryingDiagnostic, setRetryingDiagnostic] = useState(false);
  const [requestedSettingsTab, setRequestedSettingsTab] = useState<SettingsTabRoute | null>(null);
  const retryHandlersRef = React.useRef<Map<string, () => Promise<void>>>(new Map());

  const theme: ThemeMode = dataset.profile?.theme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  const diagnosticsRef = React.useRef<DiagnosticRecord[]>(diagnostics);
  diagnosticsRef.current = diagnostics;

  const reportDiagnostic = useCallback(
    (
      err: unknown,
      ctx: Omit<ClassifyErrorContext, 'workspaceId' | 'isOnline' | 'emailVerified'>,
      retryFn?: () => Promise<void>
    ): DiagnosticRecord => {
      const uid = auth.currentUser?.uid || user?.uid;
      const rawRecord = errorHandler.capture(
        err,
        {
          ...ctx,
          workspaceId: uid,
          isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
          emailVerified: auth.currentUser?.emailVerified ?? user?.emailVerified ?? null,
        },
        { notify: false }
      );

      const nextList = upsertGroupedDiagnostic(diagnosticsRef.current, rawRecord);
      const groupedRecord = nextList[0] ?? rawRecord;
      diagnosticsRef.current = nextList;
      if (uid) persistDiagnosticHistory(uid, nextList);
      setDiagnostics(nextList);

      if (retryFn && groupedRecord.retryable) {
        retryHandlersRef.current.set(groupedRecord.id, retryFn);
      }

      setActiveError(groupedRecord);
      return groupedRecord;
    },
    [user]
  );

  const dismissActiveError = useCallback(() => {
    setActiveError(null);
  }, []);

  const markDiagnosticResolved = useCallback(
    (id: string, status: 'resolved' | 'dismissed' = 'resolved') => {
      const uid = auth.currentUser?.uid || user?.uid;
      setDiagnostics((prev) => {
        const next = prev.map((d) =>
          d.id === id
            ? {
                ...d,
                resolutionStatus: status,
                ...(status === 'resolved' ? { cloudStatus: 'synced' as const } : {}),
              }
            : d
        );
        diagnosticsRef.current = next;
        if (uid) persistDiagnosticHistory(uid, next);
        return next;
      });
      setActiveError((prev) => (prev && prev.id === id ? null : prev));
    },
    [user]
  );

  const clearResolvedDiagnostics = useCallback(() => {
    const uid = auth.currentUser?.uid || user?.uid;
    setDiagnostics((prev) => {
      const next = prev.filter((d) => d.resolutionStatus === 'unresolved' || d.resolutionStatus === 'retried');
      diagnosticsRef.current = next;
      if (uid) persistDiagnosticHistory(uid, next);
      return next;
    });
  }, [user]);

  const clearAllDiagnostics = useCallback(() => {
    const uid = auth.currentUser?.uid || user?.uid;
    diagnosticsRef.current = [];
    setDiagnostics([]);
    setActiveError(null);
    retryHandlersRef.current.clear();
    if (uid) persistDiagnosticHistory(uid, []);
  }, [user]);

  const openDiagnosticsView = useCallback(() => {
    setRequestedSettingsTab('diagnostics');
    setActiveRoute('settings');
  }, []);

  const clearRequestedSettingsTab = useCallback(() => {
    setRequestedSettingsTab(null);
  }, []);

  const retryActiveError = useCallback(async () => {
    if (!activeError) return;
    const handler = retryHandlersRef.current.get(activeError.id);
    if (!handler) return;
    setRetryingDiagnostic(true);
    const uid = auth.currentUser?.uid || user?.uid;
    setDiagnostics((prev) => {
      const next = prev.map((d) =>
        d.id === activeError.id ? { ...d, resolutionStatus: 'retried' as const } : d
      );
      if (uid) persistDiagnosticHistory(uid, next);
      return next;
    });
    try {
      await handler();
      markDiagnosticResolved(activeError.id, 'resolved');
    } catch {
      // handler failure is reported inside reportDiagnostic
    } finally {
      setRetryingDiagnostic(false);
    }
  }, [activeError, markDiagnosticResolved, user]);

  const executeSafely = useCallback(
    async <T,>(
      ctx: Omit<ClassifyErrorContext, 'workspaceId' | 'isOnline' | 'emailVerified'>,
      action: () => Promise<T>,
      retryFn?: () => Promise<void>
    ): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        reportDiagnostic(err, ctx, retryFn);
        throw err;
      }
    },
    [reportDiagnostic]
  );

  const reloadWorkspace = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoadingData(true);
    try {
      const uid = auth.currentUser.uid;
      await ensureUserWorkspace({
        uid,
        email: auth.currentUser.email || '',
        displayName: auth.currentUser.displayName || 'Trader',
      });
      const data = await loadFullWorkspace(uid);
      setDataset(data);
      setActiveError(null);
    } catch (err) {
      reportDiagnostic(
        err,
        {
          module: 'Cloud Vault Sync',
          operation: 'reloadWorkspace',
          actionSummary: 'Workspace synchronisation failed',
          recordType: 'workspace',
          localStatus: 'not_modified',
          cloudStatus: 'failed',
        },
        async () => {
          await reloadWorkspace();
        }
      );
      throw err;
    } finally {
      setLoadingData(false);
    }
  }, [reportDiagnostic]);

  const autoReconcilingRef = React.useRef(false);
  const PENDING_RECOVERY_MARKER = '2026-11-17-rules-r4';

  const hasCompletedRecoveryPass = (uid: string): boolean => {
    try {
      return (
        typeof window !== 'undefined' &&
        typeof window.localStorage !== 'undefined' &&
        window.localStorage.getItem(`atk_deck_recovery_marker_${uid}`) === PENDING_RECOVERY_MARKER
      );
    } catch {
      return true;
    }
  };

  const markRecoveryPassAttempted = (uid: string): void => {
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        window.localStorage.setItem(`atk_deck_recovery_marker_${uid}`, PENDING_RECOVERY_MARKER);
      }
    } catch {
      // Ignore storage access errors
    }
  };

  const executePendingCloseSync = useCallback(
    async (
      uid: string,
      pending: PendingOperationRecord,
      options?: { silentIfOffline?: boolean }
    ): Promise<boolean> => {
      if (pending.kind !== 'close_trade' || pending.userId !== uid) return false;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (options?.silentIfOffline) return false;
        const offlineErr = new StructuredAppError({
          message: 'Device is offline; Cloud Vault cannot be reached.',
          category: 'network',
          errorCode: 'NETWORK_OFFLINE',
          userExplanation: 'Your device is offline. Reconnect and retry syncing pending changes.',
          recommendedAction: 'Check internet connectivity and retry sync.',
          retryable: true,
          operationId: pending.operationId,
          cloudStatus: 'pending_retry',
        });
        const attemptAt = new Date().toISOString();
        const diag = reportDiagnostic(offlineErr, {
          module: 'Cloud Vault Sync',
          operation: 'retryPendingOperation',
          actionSummary: `Pending sync failed (${pending.summary})`,
          recordType: 'trade',
          recordId: pending.recordId,
          operationId: pending.operationId,
          localStatus: 'saved_locally',
          cloudStatus: 'pending_retry',
        });
        const updatedPending = savePendingOperation(uid, {
          ...pending,
          workspaceId: pending.workspaceId || uid,
          recordType: 'trade',
          operationType: 'update',
          status: 'failed',
          lastAttemptAt: attemptAt,
          attemptCount: pending.attemptCount + 1,
          lastErrorCode: diag.errorCode,
          lastErrorCategory: diag.category,
          lastCorrelationId: diag.correlationId,
          lastErrorSummary: diag.userExplanation,
          attemptHistory: [
            ...(pending.attemptHistory || []),
            {
              timestamp: attemptAt,
              correlationId: diag.correlationId,
              errorCode: diag.errorCode,
              category: diag.category,
              summary: diag.userExplanation,
              status: 'failed' as const,
            },
          ].slice(-20),
        });
        setPendingOperations(updatedPending.list);
        return false;
      }

      const processingSave = savePendingOperation(uid, {
        ...pending,
        workspaceId: pending.workspaceId || uid,
        recordType: 'trade',
        operationType: 'update',
        status: 'processing',
      });
      setPendingOperations(processingSave.list);

      const inspection = inspectAndRepairPendingTradeClose(pending, uid);
      try {
        if (!inspection.valid || !inspection.repairedPayload) {
          throw new StructuredAppError({
            message: `Pending trade close validation failed: ${inspection.validationErrors.join(' ')}`,
            category: 'validation',
            errorCode: 'PENDING_PAYLOAD_INVALID',
            userExplanation:
              inspection.validationErrors[0] ||
              'Pending trade closure is missing required information.',
            recommendedAction:
              'Inspect this queue item to see what is missing, or open the trade to complete required fields.',
            retryable: false,
            operationId: pending.operationId,
            cloudStatus: 'unverified',
          });
        }

        const repaired = inspection.repairedPayload;
        const repairedTrade = repaired.updatedTrade as unknown as Trade;
        const repairedEvent = repaired.closeEvent as unknown as TradeEvent;

        await commitAtomicTradeClose({
          uid,
          updatedTrade: repairedTrade,
          updateFields: repaired.updateFields,
          closeEvent: repairedEvent,
          operationId: pending.operationId,
          expectedSourceUpdatedAt: repaired.expectedSourceUpdatedAt,
        });

        setPendingOperations(removePendingOperation(uid, pending.operationId));
        setDiagnostics((prev) => {
          const next = prev.map((d) =>
            d.operationId === pending.operationId ||
            (d.recordId === pending.recordId &&
              (d.operation === 'closeTrade' || d.operation === 'retryPendingOperation'))
              ? { ...d, resolutionStatus: 'resolved' as const, cloudStatus: 'synced' as const }
              : d
          );
          diagnosticsRef.current = next;
          persistDiagnosticHistory(uid, next);
          return next;
        });
        setActiveError((prev) =>
          prev &&
          (prev.operationId === pending.operationId ||
            (prev.recordId === pending.recordId &&
              (prev.operation === 'closeTrade' || prev.operation === 'retryPendingOperation')))
            ? null
            : prev
        );
        setDataset((prev) => ({
          ...prev,
          trades: prev.trades.map((t) =>
            t.id === repairedTrade.id ? { ...t, ...repairedTrade } : t
          ),
          tradeEvents: prev.tradeEvents.some((e) => e.id === repairedEvent.id)
            ? prev.tradeEvents
            : [repairedEvent, ...prev.tradeEvents],
        }));
        setActiveTradeId((prev) => (prev === repairedTrade.id ? null : prev));
        return true;
      } catch (err) {
        const attemptAt = new Date().toISOString();
        const diag = reportDiagnostic(
          err,
          {
            module: 'Cloud Vault Sync',
            operation: 'retryPendingOperation',
            actionSummary: `Pending sync failed (${pending.summary})`,
            recordType: 'trade',
            recordId: pending.recordId,
            operationId: pending.operationId,
            localStatus: 'saved_locally',
            cloudStatus: 'failed',
          },
          async () => {
            await executePendingCloseSync(uid, pending);
          }
        );
        const nextStatus = pendingStatusForCategory(diag.category);
        const updatedPending = savePendingOperation(uid, {
          ...pending,
          workspaceId: pending.workspaceId || uid,
          recordType: 'trade',
          operationType: 'update',
          status: nextStatus,
          lastAttemptAt: attemptAt,
          attemptCount: pending.attemptCount + 1,
          lastErrorCode: diag.errorCode,
          lastErrorCategory: diag.category,
          lastCorrelationId: diag.correlationId,
          lastErrorSummary: diag.userExplanation,
          attemptHistory: [
            ...(pending.attemptHistory || []),
            {
              timestamp: attemptAt,
              correlationId: diag.correlationId,
              errorCode: diag.errorCode,
              category: diag.category,
              summary: diag.userExplanation,
              status: nextStatus,
            },
          ].slice(-20),
        });
        setPendingOperations(updatedPending.list);
        return false;
      }
    },
    [reportDiagnostic]
  );

  const reconcilePendingForUser = useCallback(
    async (uid: string) => {
      if (autoReconcilingRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const queued = loadPendingOperations(uid);
      if (queued.length === 0) return;

      const allowOneTimeRecovery = !hasCompletedRecoveryPass(uid);
      if (allowOneTimeRecovery) {
        // Persist recovery marker before syncing so failures never create infinite retry loops
        markRecoveryPassAttempted(uid);
      }

      // Never auto-retry permission, validation, authentication, or conflict operations indefinitely;
      // allow at most one guarded recovery pass per rules fix release for queued permission close_trade ops.
      const autoRetryCandidates = queued.filter(
        (op) =>
          shouldAutoRetryPendingOp(op) ||
          (allowOneTimeRecovery &&
            op.kind === 'close_trade' &&
            op.status === 'requires_attention' &&
            op.lastErrorCategory === 'permission')
      );
      if (autoRetryCandidates.length === 0) return;

      autoReconcilingRef.current = true;
      try {
        for (const pending of autoRetryCandidates) {
          await executePendingCloseSync(uid, pending, { silentIfOffline: true });
        }
      } finally {
        autoReconcilingRef.current = false;
      }
    },
    [executePendingCloseSync]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        setDiagnostics(loadDiagnosticHistory(u.uid));
        setPendingOperations(loadPendingOperations(u.uid));
        setLoadingData(true);
        try {
          await ensureUserWorkspace({
            uid: u.uid,
            email: u.email || '',
            displayName: u.displayName || 'Trader',
          });
          const data = await loadFullWorkspace(u.uid);
          setDataset(data);
          setAuthError(null);
          if (data.profile?.timezone) {
            setSelectedDate(getLocalDateString(new Date(), data.profile.timezone));
          }
          // Safely reconcile any queued pending local closures after cloud state is loaded
          void reconcilePendingForUser(u.uid);
        } catch (err) {
          const diag = reportDiagnostic(err, {
            module: 'Cloud Vault Sync',
            operation: 'initialWorkspaceLoad',
            actionSummary: 'Failed to load trading workspace',
            recordType: 'workspace',
            localStatus: 'not_modified',
            cloudStatus: 'failed',
          });
          setAuthError(`${diag.userExplanation} (Ref: ${diag.correlationId})`);
        } finally {
          setLoadingData(false);
        }
      } else {
        setDataset(EMPTY_DATASET);
        setDiagnostics([]);
        setPendingOperations([]);
        setActiveError(null);
      }
    });
    return () => unsub();
  }, [reportDiagnostic, reconcilePendingForUser]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const handleOnline = () => {
      void reconcilePendingForUser(user.uid);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user, reconcilePendingForUser]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const diag = reportDiagnostic(err, {
        module: 'Authentication',
        operation: 'signInWithGoogle',
        actionSummary: 'Google Sign-In failed',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      });
      setAuthError(`${diag.userExplanation} (Ref: ${diag.correlationId})`);
    }
  }, [reportDiagnostic]);

  const signOutUser = useCallback(async () => {
    await executeSafely(
      {
        module: 'Authentication',
        operation: 'signOutUser',
        actionSummary: 'Sign out failed',
        localStatus: 'not_modified',
        cloudStatus: 'unverified',
      },
      async () => {
        await signOut(auth);
        setDataset(EMPTY_DATASET);
        setActiveTradeId(null);
        setActiveError(null);
      }
    );
  }, [executeSafely]);

  const openDailyJournalForDate = useCallback((date: string) => {
    setSelectedDate(date);
    setActiveRoute('daily_journal');
  }, []);

  const openRecordsForDate = useCallback((date: string) => {
    setSelectedDate(date);
    setActiveRoute('records');
  }, []);

  const activeLiveSession = useMemo(() => {
    return dataset.sessions.find((s) => s.status === 'live') ?? null;
  }, [dataset.sessions]);

  const openTrades = useMemo(() => {
    return dataset.trades.filter((t) => t.status === 'before_entry' || t.status === 'during_trade');
  }, [dataset.trades]);

  const activeTrade = useMemo(() => {
    if (activeTradeId) {
      const explicit = dataset.trades.find((t) => t.id === activeTradeId && t.status !== 'closed');
      if (explicit) return explicit;
    }
    return openTrades[0] ?? null;
  }, [activeTradeId, dataset.trades, openTrades]);

  const requireUid = () => {
    if (!user) {
      throw new StructuredAppError({
        message: 'Not authenticated',
        category: 'authentication',
        errorCode: 'AUTH_REQUIRED',
        userExplanation: 'Your session is not signed in. Sign in to save to Cloud Vault.',
        recommendedAction: 'Sign in again and retry your save.',
        retryable: false,
      });
    }
    return user.uid;
  };

  const toggleTheme = useCallback(async () => {
    if (!user || !dataset.profile) return;
    const prevTheme = theme;
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setDataset((prev) =>
      prev.profile ? { ...prev, profile: { ...prev.profile, theme: next } } : prev
    );
    try {
      await saveProfileUpdates(user.uid, { theme: next });
    } catch (err) {
      setDataset((prev) =>
        prev.profile ? { ...prev, profile: { ...prev.profile, theme: prevTheme } } : prev
      );
      reportDiagnostic(err, {
        module: 'Appearance',
        operation: 'toggleTheme',
        actionSummary: 'Failed to save theme preference',
        recordType: 'profile',
        recordId: user.uid,
        localStatus: 'not_modified',
      });
    }
  }, [user, dataset.profile, theme, reportDiagnostic]);

  const saveProfile = useCallback(
    async (updates: Partial<Pick<UserProfile, 'displayName' | 'timezone' | 'currency' | 'theme'>>) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'saveProfile',
          actionSummary: 'Failed to save profile settings',
          recordType: 'profile',
          recordId: uid,
        },
        async () => {
          await saveProfileUpdates(uid, updates);
          setDataset((prev) =>
            prev.profile
              ? { ...prev, profile: { ...prev.profile, ...updates, sourceUpdatedAt: new Date().toISOString() } }
              : prev
          );
        },
        () => saveProfile(updates)
      );
    },
    [user, executeSafely]
  );

  const saveDailyJournal = useCallback(
    async (journal: DailyJournal) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Daily Journal',
          operation: 'saveDailyJournal',
          actionSummary: `Failed to save Daily Journal (${journal.date})`,
          recordType: 'daily_journal',
          recordId: journal.id,
        },
        async () => {
          const exists = dataset.dailyJournals.some((j) => j.id === journal.id);
          const updated = { ...journal, userId: uid, sourceUpdatedAt: new Date().toISOString() };
          await upsertEntity(uid, 'daily_journals', updated, exists, [
            'timezone',
            'plannedActivities',
            'morningNotes',
            'dailyEmotionalState',
            'disciplineRating',
            'checklistItems',
            'dailyReflection',
          ]);
          setDataset((prev) => {
            const idx = prev.dailyJournals.findIndex((j) => j.id === updated.id);
            const next = [...prev.dailyJournals];
            if (idx >= 0) next[idx] = updated;
            else next.unshift(updated);
            return { ...prev, dailyJournals: next };
          });
        },
        () => saveDailyJournal(journal)
      );
    },
    [user, dataset.dailyJournals, executeSafely]
  );

  const startSession = useCallback(
    async (input: StartSessionInput) => {
      const uid = requireUid();
      return executeSafely(
        {
          module: 'Session Logger',
          operation: 'startSession',
          actionSummary: `Failed to start session (${input.sessionName || 'Trading Session'})`,
          recordType: 'session',
        },
        async () => {
          const now = new Date();
          const nowIso = now.toISOString();
          const tz = dataset.profile?.timezone || DEFAULT_TIMEZONE;
          const todayInTz = getLocalDateString(now, tz);
          const date = input.date || todayInTz;
          const checklistLabels =
            input.sessionChecklistLabels ?? ['HTF levels marked', 'Risk rules verified'];

          let arrivalDelayMinutes = 0;
          let attendanceStatus: SessionAttendanceStatus = 'attended';
          const plannedMin = parseTimeToMinutes(input.plannedStart);
          if (plannedMin !== null && date === todayInTz) {
            const currentMin = getCurrentTimeMinutesInTimezone(tz, now);
            const diffMin = currentMin - plannedMin;
            if (diffMin > 5) {
              arrivalDelayMinutes = diffMin;
              attendanceStatus = 'late';
            }
          }

          const session: TradingSession = {
            id: generateId('ses'),
            userId: uid,
            date,
            sessionName: input.sessionName.trim() || 'Trading Session',
            ...(input.sessionCategory ? { sessionCategory: input.sessionCategory } : {}),
            ...(input.templateId ? { sessionTemplateId: input.templateId } : {}),
            timezone: tz,
            ...(input.plannedStart ? { plannedStart: input.plannedStart } : {}),
            ...(input.plannedEnd ? { plannedEnd: input.plannedEnd } : {}),
            actualStart: nowIso,
            attendanceStatus,
            arrivalDelayMinutes,
            setupAvailability: 'unknown',
            ...(input.sittingLocation ? { sittingLocation: input.sittingLocation } : {}),
            ...(input.sittingLocation === 'Other' && input.sittingLocationOther?.trim()
              ? { sittingLocationOther: input.sittingLocationOther.trim() }
              : {}),
            ...(input.preSessionEmotion ? { preSessionEmotion: input.preSessionEmotion } : {}),
            ...(input.preSessionEmotionNote?.trim()
              ? { preSessionEmotionNote: input.preSessionEmotionNote.trim() }
              : {}),
            ...(input.preSessionPreparation?.trim()
              ? { preSessionPreparation: input.preSessionPreparation.trim() }
              : {}),
            ...(input.sessionBias?.trim() ? { sessionBias: input.sessionBias.trim() } : {}),
            sessionEmotions: input.preSessionEmotion ? [input.preSessionEmotion] : [],
            sessionChecklist: createChecklistStates(checklistLabels),
            steppedBackCount: 0,
            linkedTradeCount: 0,
            planAdherence: 'pending',
            status: 'live',
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
            sourceUpdatedAt: nowIso,
          };

          const locationLabel =
            input.sittingLocation === 'Other' && input.sittingLocationOther?.trim()
              ? `Other (${input.sittingLocationOther.trim()})`
              : input.sittingLocation;

          const checkInNotes = [
            locationLabel ? `Location: ${locationLabel}` : null,
            input.preSessionEmotion ? `Feeling: ${input.preSessionEmotion}` : null,
            input.preSessionEmotionNote?.trim() ? `Note: ${input.preSessionEmotionNote.trim()}` : null,
            input.sessionBias?.trim() ? `Bias: ${input.sessionBias.trim()}` : null,
            arrivalDelayMinutes > 0
              ? `Arrived ${arrivalDelayMinutes}m after planned start`
              : input.plannedStart
              ? 'On time'
              : null,
          ]
            .filter(Boolean)
            .join(' · ');

          const startEvent: SessionEvent = {
            id: generateId('se'),
            userId: uid,
            sessionId: session.id,
            eventType: 'session_started',
            label: `Session Started — ${session.sessionName}`,
            ...(checkInNotes ? { notes: checkInNotes } : {}),
            ...(input.preSessionEmotion ? { emotion: input.preSessionEmotion } : {}),
            timestamp: nowIso,
            timezone: tz,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };

          const existingJournal = dataset.dailyJournals.find((j) => j.date === date);
          let newJournal: DailyJournal | undefined;
          if (!existingJournal) {
            const dailyChecklist =
              dataset.checklists.find((c) => c.scope === 'daily')?.items ?? DEFAULT_DAILY_CHECKLIST_ITEMS;
            newJournal = {
              id: date,
              userId: uid,
              date,
              timezone: tz,
              checklistItems: createChecklistStates(dailyChecklist),
              sourceApplication: APP_NAME,
              sourceCreatedAt: nowIso,
              sourceUpdatedAt: nowIso,
            };
          }

          await commitAtomicSessionStart({
            uid,
            session,
            startEvent,
            newDailyJournal: newJournal,
          });

          setDataset((prev) => ({
            ...prev,
            ...(newJournal ? { dailyJournals: [newJournal, ...prev.dailyJournals] } : {}),
            sessions: [session, ...prev.sessions],
            sessionEvents: [startEvent, ...prev.sessionEvents],
          }));

          return session;
        },
        async () => {
          await startSession(input);
        }
      );
    },
    [user, dataset.profile, dataset.dailyJournals, dataset.checklists, executeSafely]
  );

  const createPlannedSession = useCallback(
    async (input: {
      date: string;
      sessionName: string;
      sessionCategory?: SessionCategory;
      templateId?: string;
      plannedStart?: string;
      plannedEnd?: string;
      preSessionPreparation?: string;
      sessionBias?: string;
    }) => {
      const uid = requireUid();
      return executeSafely(
        {
          module: 'Session Logger',
          operation: 'createPlannedSession',
          actionSummary: `Failed to schedule session (${input.sessionName})`,
          recordType: 'session',
        },
        async () => {
          const nowIso = new Date().toISOString();
          const tz = dataset.profile?.timezone || DEFAULT_TIMEZONE;
          const session: TradingSession = {
            id: generateId('ses'),
            userId: uid,
            date: input.date,
            sessionName: input.sessionName.trim() || 'Planned Session',
            ...(input.sessionCategory ? { sessionCategory: input.sessionCategory } : {}),
            ...(input.templateId ? { sessionTemplateId: input.templateId } : {}),
            timezone: tz,
            ...(input.plannedStart ? { plannedStart: input.plannedStart } : {}),
            ...(input.plannedEnd ? { plannedEnd: input.plannedEnd } : {}),
            attendanceStatus: 'pending',
            setupAvailability: 'unknown',
            ...(input.preSessionPreparation ? { preSessionPreparation: input.preSessionPreparation } : {}),
            ...(input.sessionBias ? { sessionBias: input.sessionBias } : {}),
            steppedBackCount: 0,
            linkedTradeCount: 0,
            planAdherence: 'pending',
            status: 'planned',
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
            sourceUpdatedAt: nowIso,
          };
          await upsertEntity(uid, 'sessions', session, false);
          setDataset((prev) => ({ ...prev, sessions: [session, ...prev.sessions] }));
          return session;
        },
        async () => {
          await createPlannedSession(input);
        }
      );
    },
    [user, dataset.profile, executeSafely]
  );

  const activatePlannedSession = useCallback(
    async (
      session: TradingSession,
      checkIn?: Partial<
        Pick<
          TradingSession,
          | 'sessionCategory'
          | 'sittingLocation'
          | 'sittingLocationOther'
          | 'preSessionEmotion'
          | 'preSessionEmotionNote'
          | 'preSessionPreparation'
          | 'sessionBias'
        >
      >
    ) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Session Logger',
          operation: 'activatePlannedSession',
          actionSummary: `Failed to start planned session (${session.sessionName})`,
          recordType: 'session',
          recordId: session.id,
        },
        async () => {
          const nowIso = new Date().toISOString();
          const updated: TradingSession = {
            ...session,
            ...checkIn,
            status: 'live',
            attendanceStatus: 'attended',
            actualStart: nowIso,
            sourceUpdatedAt: nowIso,
          };
          const fields = [
            'status',
            'attendanceStatus',
            'actualStart',
            ...(checkIn?.sessionCategory ? ['sessionCategory'] : []),
            ...(checkIn?.sittingLocation ? ['sittingLocation'] : []),
            ...(checkIn?.sittingLocationOther ? ['sittingLocationOther'] : []),
            ...(checkIn?.preSessionEmotion ? ['preSessionEmotion'] : []),
            ...(checkIn?.preSessionEmotionNote ? ['preSessionEmotionNote'] : []),
            ...(checkIn?.preSessionPreparation ? ['preSessionPreparation'] : []),
            ...(checkIn?.sessionBias ? ['sessionBias'] : []),
          ];
          await upsertEntity(uid, 'sessions', updated, true, fields);
          const ev: SessionEvent = {
            id: generateId('se'),
            userId: uid,
            sessionId: session.id,
            eventType: 'session_started',
            label: `Session Started — ${session.sessionName}`,
            ...(checkIn?.preSessionEmotion ? { emotion: checkIn.preSessionEmotion } : {}),
            timestamp: nowIso,
            timezone: session.timezone,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };
          await createImmutableRecord(uid, 'session_events', ev);
          setDataset((prev) => ({
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === session.id ? updated : s)),
            sessionEvents: [ev, ...prev.sessionEvents],
          }));
        },
        () => activatePlannedSession(session, checkIn)
      );
    },
    [user, executeSafely]
  );

  const updateSessionFields = useCallback(
    async (session: TradingSession) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Session Logger',
          operation: 'updateSessionFields',
          actionSummary: `Failed to update session (${session.sessionName})`,
          recordType: 'session',
          recordId: session.id,
        },
        async () => {
          const updated = { ...session, sourceUpdatedAt: new Date().toISOString() };
          await upsertEntity(uid, 'sessions', updated, true);
          setDataset((prev) => ({
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === updated.id ? updated : s)),
          }));
        },
        () => updateSessionFields(session)
      );
    },
    [user, executeSafely]
  );

  const markSessionOutcome = useCallback(
    async (session: TradingSession, status: 'missed' | 'cancelled') => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Session Logger',
          operation: 'markSessionOutcome',
          actionSummary: `Failed to mark session as ${status}`,
          recordType: 'session',
          recordId: session.id,
        },
        async () => {
          const updated: TradingSession = {
            ...session,
            status,
            attendanceStatus: status,
            sourceUpdatedAt: new Date().toISOString(),
          };
          await upsertEntity(uid, 'sessions', updated, true, ['status', 'attendanceStatus']);
          setDataset((prev) => ({
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === updated.id ? updated : s)),
          }));
        },
        () => markSessionOutcome(session, status)
      );
    },
    [user, executeSafely]
  );

  const closeLiveSession = useCallback(
    async (
      session: TradingSession,
      closing: {
        actualEnd: string;
        attendanceStatus: SessionAttendanceStatus;
        setupAvailability: SetupAvailability;
        planAdherence: PlanAdherence;
        postSessionEmotions: string[];
        closingReflection: string;
        sessionSummary?: string;
      }
    ) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Session Logger',
          operation: 'closeLiveSession',
          actionSummary: `Failed to close session (${session.sessionName})`,
          recordType: 'session',
          recordId: session.id,
        },
        async () => {
          const linkedTrades = dataset.trades.filter((t) => t.sessionId === session.id).length;
          const updated: TradingSession = {
            ...session,
            actualEnd: closing.actualEnd,
            attendanceStatus: closing.attendanceStatus,
            setupAvailability: closing.setupAvailability,
            planAdherence: closing.planAdherence,
            postSessionEmotions: closing.postSessionEmotions,
            closingReflection: closing.closingReflection,
            ...(closing.sessionSummary ? { sessionSummary: closing.sessionSummary } : {}),
            linkedTradeCount: linkedTrades,
            status: 'completed',
            sourceUpdatedAt: new Date().toISOString(),
          };
          const updateFields = [
            'actualEnd',
            'attendanceStatus',
            'setupAvailability',
            'planAdherence',
            'postSessionEmotions',
            'closingReflection',
            ...(closing.sessionSummary ? ['sessionSummary'] : []),
            'linkedTradeCount',
            'status',
          ];
          const closeEv: SessionEvent = {
            id: generateId('se'),
            userId: uid,
            sessionId: session.id,
            eventType: 'session_completed',
            label: `Session Closed (${closing.attendanceStatus})`,
            notes: `Setup availability: ${closing.setupAvailability} · Plan adherence: ${closing.planAdherence}`,
            timestamp: closing.actualEnd,
            timezone: session.timezone,
            sourceApplication: APP_NAME,
            sourceCreatedAt: closing.actualEnd,
          };
          await commitAtomicSessionClose({
            uid,
            updatedSession: updated,
            updateFields,
            closeEvent: closeEv,
          });
          // Ending a session updates ONLY the session; any open trades keep running!
          setDataset((prev) => ({
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === updated.id ? updated : s)),
            sessionEvents: [closeEv, ...prev.sessionEvents],
          }));
        },
        () => closeLiveSession(session, closing)
      );
    },
    [user, dataset.trades, executeSafely]
  );

  const logSessionEvent = useCallback(
    async (input: {
      sessionId: string;
      eventType: string;
      label: string;
      notes?: string;
      emotion?: string;
      isSteppedBack?: boolean;
    }) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Session Logger',
          operation: 'logSessionEvent',
          actionSummary: 'Failed to log session event',
          recordType: 'session_event',
          recordId: input.sessionId,
        },
        async () => {
          const nowIso = new Date().toISOString();
          const targetSession = dataset.sessions.find((s) => s.id === input.sessionId);
          if (!targetSession) {
            throw new StructuredAppError({
              message: 'Session not found',
              category: 'database',
              errorCode: 'SESSION_NOT_FOUND',
              userExplanation: 'The target session could not be found in the current workspace.',
              recommendedAction: 'Reload your workspace and verify the session still exists.',
              retryable: false,
            });
          }

          const ev: SessionEvent = {
            id: generateId('se'),
            userId: uid,
            sessionId: input.sessionId,
            eventType: input.eventType,
            label: input.label,
            ...(input.notes ? { notes: input.notes } : {}),
            ...(input.emotion ? { emotion: input.emotion } : {}),
            timestamp: nowIso,
            timezone: targetSession.timezone,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };
          await createImmutableRecord(uid, 'session_events', ev);

          if (input.isSteppedBack) {
            const updatedSession: TradingSession = {
              ...targetSession,
              steppedBackCount: (targetSession.steppedBackCount || 0) + 1,
              sourceUpdatedAt: nowIso,
            };
            await upsertEntity(uid, 'sessions', updatedSession, true, ['steppedBackCount']);
            setDataset((prev) => ({
              ...prev,
              sessions: prev.sessions.map((s) => (s.id === updatedSession.id ? updatedSession : s)),
              sessionEvents: [ev, ...prev.sessionEvents],
            }));
          } else {
            setDataset((prev) => ({
              ...prev,
              sessionEvents: [ev, ...prev.sessionEvents],
            }));
          }
        },
        () => logSessionEvent(input)
      );
    },
    [user, dataset.sessions, executeSafely]
  );

  const createBeforeEntryTrade = useCallback(
    async (input: CreateTradeInput) => {
      const uid = requireUid();
      return executeSafely(
        {
          module: 'Live Trade Logger',
          operation: 'createBeforeEntryTrade',
          actionSummary: `Failed to create trade (${input.instrument})`,
          recordType: 'trade',
        },
        async () => {
          const now = new Date();
          const nowIso = now.toISOString();
          const tz = dataset.profile?.timezone || DEFAULT_TIMEZONE;
          const date = input.date || getLocalDateString(now, tz);
          const validSession =
            input.sessionId && !input.isOutOfSession
              ? dataset.sessions.find((s) => s.id === input.sessionId)
              : undefined;
          const isOutOfSession = input.isOutOfSession || !validSession;
          const statusMode = input.statusMode === 'during_trade' ? 'during_trade' : 'before_entry';

          const trade: Trade = {
            id: generateId('trd'),
            userId: uid,
            date,
            timezone: tz,
            ...(validSession ? { sessionId: validSession.id } : {}),
            isOutOfSession,
            accountId: input.accountId,
            instrument: input.instrument.trim().toUpperCase(),
            ...(input.market ? { market: input.market } : {}),
            direction: input.direction,
            status: statusMode,
            ...(statusMode === 'during_trade' ? { entryTimestamp: nowIso } : {}),
            ...(input.timeframe ? { timeframe: input.timeframe } : {}),
            ...(input.entryType ? { entryType: input.entryType } : {}),
            ...(input.setupLabel ? { setupLabel: input.setupLabel } : {}),
            ...(input.bias ? { bias: input.bias } : {}),
            ...(input.entryPrice !== undefined ? { entryPrice: input.entryPrice } : {}),
            ...(input.stopLoss !== undefined ? { stopLoss: input.stopLoss } : {}),
            ...(input.takeProfit !== undefined ? { takeProfit: input.takeProfit } : {}),
            ...(input.positionSize !== undefined ? { positionSize: input.positionSize } : {}),
            ...(input.plannedRisk !== undefined ? { plannedRisk: input.plannedRisk } : {}),
            ...(input.riskPercent !== undefined ? { riskPercent: input.riskPercent } : {}),
            ...(input.expectedProfitPercent !== undefined
              ? { expectedProfitPercent: input.expectedProfitPercent }
              : {}),
            ...(input.actualProfitPercent !== undefined
              ? { actualProfitPercent: input.actualProfitPercent }
              : {}),
            tpOutcome: input.tpOutcome ?? 'pending',
            slOutcome: input.slOutcome ?? 'pending',
            ...(input.entryReason ? { entryReason: input.entryReason } : {}),
            ...(input.expectedOutcome ? { expectedOutcome: input.expectedOutcome } : {}),
            ...(input.preEntryEmotion ? { preEntryEmotion: input.preEntryEmotion } : {}),
            ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
            antiBiasPauseCompleted: Boolean(input.antiBiasPauseCompleted),
            result: 'pending',
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
            sourceUpdatedAt: nowIso,
          };

          const ev: TradeEvent = {
            id: generateId('te'),
            userId: uid,
            tradeId: trade.id,
            phase: statusMode,
            eventType: statusMode === 'during_trade' ? 'position_entered' : 'trade_prepared',
            label:
              statusMode === 'during_trade'
                ? `Entered ${trade.direction.toUpperCase()} ${trade.instrument}`
                : `Pre-Entry Plan — ${trade.instrument} (${trade.direction.toUpperCase()})`,
            ...(trade.entryReason ? { details: trade.entryReason } : {}),
            ...(trade.preEntryEmotion ? { emotion: trade.preEntryEmotion } : {}),
            timestamp: nowIso,
            timezone: tz,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };

          const nextSession = validSession
            ? {
                ...validSession,
                linkedTradeCount: (validSession.linkedTradeCount || 0) + 1,
              }
            : undefined;

          await commitAtomicTradeCreate({
            uid,
            trade,
            event: ev,
            sessionToUpdate: nextSession,
          });

          setDataset((prev) => ({
            ...prev,
            sessions: nextSession
              ? prev.sessions.map((x) => (x.id === nextSession.id ? nextSession : x))
              : prev.sessions,
            trades: [trade, ...prev.trades],
            tradeEvents: [ev, ...prev.tradeEvents],
          }));
          setActiveTradeId(trade.id);
          return trade;
        },
        async () => {
          await createBeforeEntryTrade(input);
        }
      );
    },
    [user, dataset.profile, dataset.sessions, executeSafely]
  );

  const enterTrade = useCallback(
    async (trade: Trade, entryPrice?: number, notes?: string) => {
      const uid = requireUid();
      return executeSafely(
        {
          module: 'Live Trade Logger',
          operation: 'enterTrade',
          actionSummary: `Failed to enter trade (${trade.instrument})`,
          recordType: 'trade',
          recordId: trade.id,
        },
        async () => {
          const nowIso = new Date().toISOString();
          const updated: Trade = {
            ...trade,
            status: 'during_trade',
            entryTimestamp: nowIso,
            ...(entryPrice !== undefined ? { entryPrice } : {}),
            sourceUpdatedAt: nowIso,
          };
          const ev: TradeEvent = {
            id: generateId('te'),
            userId: uid,
            tradeId: trade.id,
            phase: 'during_trade',
            eventType: 'position_entered',
            label: `Entered ${trade.direction.toUpperCase()} ${trade.instrument}`,
            ...(entryPrice !== undefined ? { price: entryPrice } : {}),
            ...(notes ? { details: notes } : {}),
            timestamp: nowIso,
            timezone: trade.timezone,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };
          await commitAtomicTradeEnter({
            uid,
            updatedTrade: updated,
            updateFields: [
              'status',
              'entryTimestamp',
              ...(entryPrice !== undefined ? ['entryPrice'] : []),
            ],
            event: ev,
          });
          setDataset((prev) => ({
            ...prev,
            trades: prev.trades.map((t) => (t.id === updated.id ? updated : t)),
            tradeEvents: [ev, ...prev.tradeEvents],
          }));
          return updated;
        },
        async () => {
          await enterTrade(trade, entryPrice, notes);
        }
      );
    },
    [user, executeSafely]
  );

  const logTradeEvent = useCallback(
    async (input: {
      tradeId: string;
      phase: TradeEvent['phase'];
      eventType: string;
      label: string;
      details?: string;
      price?: number;
      quantity?: number;
      emotion?: string;
    }) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Live Trade Logger',
          operation: 'logTradeEvent',
          actionSummary: 'Failed to log trade event',
          recordType: 'trade_event',
          recordId: input.tradeId,
        },
        async () => {
          const nowIso = new Date().toISOString();
          const trade = dataset.trades.find((t) => t.id === input.tradeId);
          if (!trade) {
            throw new StructuredAppError({
              message: 'Trade not found',
              category: 'database',
              errorCode: 'TRADE_NOT_FOUND',
              userExplanation: 'The target trade could not be found in the current workspace.',
              recommendedAction: 'Reload your workspace and verify the trade still exists.',
              retryable: false,
            });
          }
          const ev: TradeEvent = {
            id: generateId('te'),
            userId: uid,
            tradeId: input.tradeId,
            phase: input.phase,
            eventType: input.eventType,
            label: input.label,
            ...(input.details ? { details: input.details } : {}),
            ...(input.price !== undefined ? { price: input.price } : {}),
            ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
            ...(input.emotion ? { emotion: input.emotion } : {}),
            timestamp: nowIso,
            timezone: trade.timezone,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };
          await createImmutableRecord(uid, 'trade_events', ev);
          setDataset((prev) => ({
            ...prev,
            tradeEvents: [ev, ...prev.tradeEvents],
          }));
        },
        () => logTradeEvent(input)
      );
    },
    [user, dataset.trades, executeSafely]
  );

  const updateDuringTrade = useCallback(
    async (trade: Trade, patch: Partial<Trade>) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Live Trade Logger',
          operation: 'updateDuringTrade',
          actionSummary: `Failed to update active trade (${trade.instrument})`,
          recordType: 'trade',
          recordId: trade.id,
        },
        async () => {
          const updated = { ...trade, ...patch, sourceUpdatedAt: new Date().toISOString() };
          const updateKeys = Object.entries(patch)
            .filter(([, val]) => val !== undefined)
            .map(([k]) => k);
          if (updateKeys.length === 0) return;
          await upsertEntity(uid, 'trades', updated, true, updateKeys);
          setDataset((prev) => ({
            ...prev,
            trades: prev.trades.map((t) => (t.id === updated.id ? updated : t)),
          }));
        },
        () => updateDuringTrade(trade, patch)
      );
    },
    [user, executeSafely]
  );

  const closeTrade = useCallback(
    async (
      trade: Trade,
      exit: CloseTradeInput,
      options?: { operationId?: string; expectedSourceUpdatedAt?: string }
    ): Promise<{ outcome: 'closed' | 'already_closed_by_this_op' }> => {
      const uid = requireUid();
      const rawOpId = options?.operationId || generateId('op');
      const safeOpId = rawOpId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      const expectedSourceUpdatedAt = options?.expectedSourceUpdatedAt ?? trade.sourceUpdatedAt;

      if (trade.userId && trade.userId !== uid) {
        const err = new StructuredAppError({
          message: 'Trade ownership mismatch',
          category: 'permission',
          errorCode: 'TRADE_OWNER_MISMATCH',
          userExplanation: 'This trade does not belong to the signed-in account.',
          recommendedAction: 'Sign in with the account that created this trade.',
          retryable: false,
          operationId: safeOpId,
        });
        reportDiagnostic(err, {
          module: 'Live Trade Logger',
          operation: 'closeTrade',
          actionSummary: 'Trade closure failed',
          recordType: 'trade',
          recordId: trade.id,
          operationId: safeOpId,
          localStatus: 'preserved_in_form',
          cloudStatus: 'failed',
        });
        throw err;
      }

      if (!exit.exitReason || !exit.exitReason.trim()) {
        const err = new StructuredAppError({
          message: 'Trade could not be closed because an exit reason is required.',
          category: 'validation',
          errorCode: 'EXIT_REASON_REQUIRED',
          userExplanation: 'Trade could not be closed because an exit reason is required.',
          recommendedAction: 'Enter an exit reason and click Complete & Save Trade again.',
          retryable: false,
          fieldErrors: {
            exitReason: 'Trade could not be closed because an exit reason is required.',
          },
          operationId: safeOpId,
          cloudStatus: 'unverified',
        });
        reportDiagnostic(err, {
          module: 'Live Trade Logger',
          operation: 'closeTrade',
          actionSummary: 'Trade closure validation failed',
          recordType: 'trade',
          recordId: trade.id,
          operationId: safeOpId,
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        });
        throw err;
      }

      const calc = computeTradeFinancials({
        grossPnl: exit.grossPnl,
        commission: exit.commission,
        otherCharges: exit.otherCharges,
        plannedRisk: trade.plannedRisk,
        actualProfitPercent: exit.actualProfitPercent,
        riskPercent: trade.riskPercent,
        exitOutcome: exit.exitOutcome,
        explicitResult: exit.explicitResult,
      });

      const resolvedTpOutcome = exit.tpOutcome ?? trade.tpOutcome;
      const resolvedSlOutcome = exit.slOutcome ?? trade.slOutcome;
      const trimmedExitReason = exit.exitReason.trim();
      const trimmedActualOutcome = exit.actualOutcome?.trim() || undefined;

      // Preserve original trade ID, sessionId, isOutOfSession, and lifecycle linkage
      const updated: Trade = {
        ...trade,
        status: 'closed',
        exitTimestamp: exit.exitTimestamp,
        ...(exit.exitPrice !== undefined ? { exitPrice: exit.exitPrice } : {}),
        exitReason: trimmedExitReason,
        ...(trimmedActualOutcome ? { actualOutcome: trimmedActualOutcome } : {}),
        ...(exit.exitOutcome ? { exitOutcome: exit.exitOutcome } : {}),
        ...(resolvedTpOutcome ? { tpOutcome: resolvedTpOutcome } : {}),
        ...(resolvedSlOutcome ? { slOutcome: resolvedSlOutcome } : {}),
        ...(exit.actualProfitPercent !== undefined
          ? { actualProfitPercent: exit.actualProfitPercent }
          : {}),
        ...(calc.grossPnl !== undefined ? { grossPnl: calc.grossPnl } : {}),
        ...(calc.commission !== undefined ? { commission: calc.commission } : {}),
        ...(calc.otherCharges !== undefined ? { otherCharges: calc.otherCharges } : {}),
        ...(calc.netPnl !== undefined ? { netPnl: calc.netPnl } : {}),
        ...(calc.realisedR !== undefined ? { realisedR: calc.realisedR } : {}),
        result: calc.result,
        postExitEmotions: exit.postExitEmotions,
        mistakes: exit.mistakes,
        lessons: exit.lessons,
        disciplineQuestions: exit.disciplineQuestions,
        ...(exit.duringTradeDurationSeconds !== undefined
          ? { duringTradeDurationSeconds: exit.duringTradeDurationSeconds }
          : {}),
        sourceUpdatedAt: exit.exitTimestamp,
      };

      const updateFields = [
        'status',
        'exitTimestamp',
        ...(exit.exitPrice !== undefined ? ['exitPrice'] : []),
        'exitReason',
        ...(trimmedActualOutcome ? ['actualOutcome'] : []),
        ...(exit.exitOutcome ? ['exitOutcome'] : []),
        ...(resolvedTpOutcome ? ['tpOutcome'] : []),
        ...(resolvedSlOutcome ? ['slOutcome'] : []),
        ...(exit.actualProfitPercent !== undefined ? ['actualProfitPercent'] : []),
        ...(calc.grossPnl !== undefined ? ['grossPnl'] : []),
        ...(calc.commission !== undefined ? ['commission'] : []),
        ...(calc.otherCharges !== undefined ? ['otherCharges'] : []),
        ...(calc.netPnl !== undefined ? ['netPnl'] : []),
        ...(calc.realisedR !== undefined ? ['realisedR'] : []),
        'result',
        'postExitEmotions',
        'mistakes',
        'lessons',
        'disciplineQuestions',
        ...(exit.duringTradeDurationSeconds !== undefined ? ['duringTradeDurationSeconds'] : []),
      ];

      const outcomeSummary =
        calc.netPnl !== undefined
          ? formatCurrency(calc.netPnl, dataset.profile?.currency || 'USD')
          : exit.actualProfitPercent !== undefined
          ? formatSignedPercent(exit.actualProfitPercent)
          : exit.exitOutcome
          ? exit.exitOutcome.replace('_', ' ')
          : 'No outcome entered';

      // Deterministic event ID tied to safeOpId guarantees idempotency across retries
      const closeEvId = `te_close_${safeOpId}`.slice(0, 128);
      const closeEv: TradeEvent = {
        id: closeEvId,
        userId: uid,
        tradeId: trade.id,
        phase: 'exit',
        eventType: 'trade_closed',
        label: `Closed ${trade.instrument} (${calc.result.toUpperCase()} · ${outcomeSummary})`,
        ...(exit.exitPrice !== undefined ? { price: exit.exitPrice } : {}),
        details: trimmedExitReason,
        timestamp: exit.exitTimestamp,
        timezone: trade.timezone,
        sourceApplication: APP_NAME,
        sourceCreatedAt: exit.exitTimestamp,
      };

      const nowIso = new Date().toISOString();
      const existingPending = pendingOperations.find((p) => p.operationId === safeOpId);
      const basePendingOp: PendingOperationRecord = {
        operationId: safeOpId,
        kind: 'close_trade',
        userId: uid,
        workspaceId: uid,
        recordId: trade.id,
        recordType: 'trade',
        operationType: 'update',
        status: 'processing',
        createdAt: existingPending?.createdAt ?? nowIso,
        lastAttemptAt: nowIso,
        attemptCount: (existingPending?.attemptCount ?? 0) + 1,
        summary: `Close ${trade.direction.toUpperCase()} ${trade.instrument} (${trade.date})`,
        payload: {
          updatedTrade: updated,
          updateFields,
          closeEvent: closeEv,
          expectedSourceUpdatedAt,
        },
        attemptHistory: existingPending?.attemptHistory ?? [],
      };
      const pendingSave = savePendingOperation(uid, basePendingOp);
      setPendingOperations(pendingSave.list);

      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new StructuredAppError({
            message: 'Device is offline; Cloud Vault cannot be reached.',
            category: 'network',
            errorCode: 'NETWORK_OFFLINE',
            userExplanation:
              'Your device appears offline, so the trade closure could not be synced to Cloud Vault.',
            recommendedAction:
              'Reconnect to the internet and click Retry Save. Your closing details are preserved.',
            retryable: true,
            operationId: safeOpId,
            cloudStatus: 'pending_retry',
          });
        }

        const commitResult = await commitAtomicTradeClose({
          uid,
          updatedTrade: updated,
          updateFields,
          closeEvent: closeEv,
          operationId: safeOpId,
          expectedSourceUpdatedAt,
        });

        // Clean up local pending queue only after Cloud Vault confirms write
        const remainingPending = removePendingOperation(uid, safeOpId);
        setPendingOperations(remainingPending);

        // Mark matching diagnostics resolved
        setDiagnostics((prev) => {
          const next = prev.map((d) =>
            d.operationId === safeOpId || (d.recordId === trade.id && d.operation === 'closeTrade')
              ? { ...d, resolutionStatus: 'resolved' as const, cloudStatus: 'synced' as const }
              : d
          );
          diagnosticsRef.current = next;
          persistDiagnosticHistory(uid, next);
          return next;
        });
        setActiveError((prev) =>
          prev && (prev.operationId === safeOpId || (prev.recordId === trade.id && prev.operation === 'closeTrade'))
            ? null
            : prev
        );

        // Update local dataset strictly after Cloud Vault confirmation; never touch sessions!
        setDataset((prev) => ({
          ...prev,
          trades: prev.trades.map((t) => (t.id === updated.id ? updated : t)),
          tradeEvents: prev.tradeEvents.some((e) => e.id === closeEv.id)
            ? prev.tradeEvents
            : [closeEv, ...prev.tradeEvents],
        }));
        setActiveTradeId((prev) => (prev === trade.id ? null : prev));

        return commitResult;
      } catch (err) {
        const failAt = new Date().toISOString();
        const diag = reportDiagnostic(
          err,
          {
            module: 'Live Trade Logger',
            operation: 'closeTrade',
            actionSummary: 'Trade closure failed',
            recordType: 'trade',
            recordId: trade.id,
            operationId: safeOpId,
            localStatus: pendingSave.savedLocally ? 'saved_locally' : 'preserved_in_form',
            cloudStatus: 'failed',
          },
          async () => {
            await closeTrade(trade, exit, {
              operationId: safeOpId,
              expectedSourceUpdatedAt,
            });
          }
        );

        if (pendingSave.savedLocally) {
          const nextStatus = pendingStatusForCategory(diag.category);
          const updatedPending = savePendingOperation(uid, {
            ...basePendingOp,
            status: nextStatus,
            lastAttemptAt: failAt,
            lastErrorCode: diag.errorCode,
            lastErrorCategory: diag.category,
            lastCorrelationId: diag.correlationId,
            lastErrorSummary: diag.userExplanation,
            attemptHistory: [
              ...(basePendingOp.attemptHistory || []),
              {
                timestamp: failAt,
                correlationId: diag.correlationId,
                errorCode: diag.errorCode,
                category: diag.category,
                summary: diag.userExplanation,
                status: nextStatus,
              },
            ].slice(-20),
          });
          setPendingOperations(updatedPending.list);
        }

        const errToThrow = err instanceof Error ? err : new Error(String(err));
        (errToThrow as Error & { diagnostic?: DiagnosticRecord }).diagnostic = diag;
        throw errToThrow;
      }
    },
    [user, dataset.profile?.currency, pendingOperations, reportDiagnostic]
  );

  const retryPendingOperation = useCallback(
    async (operationId: string): Promise<boolean> => {
      const uid = requireUid();
      const pending = pendingOperations.find((p) => p.operationId === operationId);
      if (!pending || pending.userId !== uid) return false;
      return executePendingCloseSync(uid, pending);
    },
    [user, pendingOperations, executePendingCloseSync]
  );

  const discardPendingOperation = useCallback(
    (operationId: string) => {
      if (!user) return;
      setPendingOperations(removePendingOperation(user.uid, operationId));
    },
    [user]
  );

  const saveHistoricalTrade = useCallback(
    async (trade: Trade, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Trades Ledger',
          operation: 'saveHistoricalTrade',
          actionSummary: `Failed to save trade (${trade.instrument})`,
          recordType: 'trade',
          recordId: trade.id,
        },
        async () => {
          const calc = computeTradeFinancials({
            grossPnl: trade.grossPnl,
            commission: trade.commission,
            otherCharges: trade.otherCharges,
            plannedRisk: trade.plannedRisk,
            actualProfitPercent: trade.actualProfitPercent,
            riskPercent: trade.riskPercent,
            exitOutcome: trade.exitOutcome,
            explicitResult: trade.result,
          });
          const nowIso = new Date().toISOString();
          const finalTrade: Trade = {
            ...trade,
            userId: uid,
            ...(trade.status === 'closed'
              ? {
                  exitTimestamp: trade.exitTimestamp || `${trade.date}T12:00:00.000Z`,
                  ...(calc.grossPnl !== undefined ? { grossPnl: calc.grossPnl } : {}),
                  ...(calc.commission !== undefined ? { commission: calc.commission } : {}),
                  ...(calc.otherCharges !== undefined ? { otherCharges: calc.otherCharges } : {}),
                  ...(calc.netPnl !== undefined ? { netPnl: calc.netPnl } : {}),
                  ...(calc.realisedR !== undefined ? { realisedR: calc.realisedR } : {}),
                  result: calc.result,
                }
              : {}),
            sourceUpdatedAt: nowIso,
          };
          await upsertEntity(uid, 'trades', finalTrade, existsAlready);

          let updatedParentSession: TradingSession | undefined;
          if (!existsAlready && finalTrade.sessionId && !finalTrade.isOutOfSession) {
            const parentSession = dataset.sessions.find((s) => s.id === finalTrade.sessionId);
            if (parentSession) {
              updatedParentSession = {
                ...parentSession,
                linkedTradeCount: (parentSession.linkedTradeCount || 0) + 1,
                sourceUpdatedAt: nowIso,
              };
              await upsertEntity(uid, 'sessions', updatedParentSession, true, ['linkedTradeCount']);
            }
          }

          setDataset((prev) => {
            const idx = prev.trades.findIndex((t) => t.id === finalTrade.id);
            const nextTrades = [...prev.trades];
            if (idx >= 0) nextTrades[idx] = finalTrade;
            else nextTrades.unshift(finalTrade);
            const nextSessions = updatedParentSession
              ? prev.sessions.map((s) => (s.id === updatedParentSession.id ? updatedParentSession : s))
              : prev.sessions;
            return { ...prev, trades: nextTrades, sessions: nextSessions };
          });
        },
        () => saveHistoricalTrade(trade, existsAlready)
      );
    },
    [user, dataset.sessions, executeSafely]
  );

  const deleteTradeRecord = useCallback(
    async (tradeId: string) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Trades Ledger',
          operation: 'deleteTradeRecord',
          actionSummary: 'Failed to delete trade record',
          recordType: 'trade',
          recordId: tradeId,
        },
        async () => {
          const targetTrade = dataset.trades.find((t) => t.id === tradeId);
          const linkedEventIds = dataset.tradeEvents
            .filter((ev) => ev.tradeId === tradeId)
            .map((ev) => ev.id);
          const linkedAttachmentIds = dataset.attachments
            .filter((att) => att.entityType === 'trade' && att.entityId === tradeId)
            .map((att) => att.id);
          const parentSession =
            targetTrade?.sessionId && !targetTrade.isOutOfSession
              ? dataset.sessions.find((s) => s.id === targetTrade.sessionId)
              : undefined;

          await commitAtomicTradeDelete({
            uid,
            tradeId,
            tradeEventIds: linkedEventIds,
            attachmentIds: linkedAttachmentIds,
            ...(parentSession
              ? {
                  sessionToUpdate: {
                    id: parentSession.id,
                    nextLinkedTradeCount: Math.max(0, (parentSession.linkedTradeCount || 1) - 1),
                  },
                }
              : {}),
          });
          await recordAuditLog(uid, 'delete_record', `Deleted trade ${tradeId}`, 1);
          setDataset((prev) => ({
            ...prev,
            trades: prev.trades.filter((t) => t.id !== tradeId),
            tradeEvents: prev.tradeEvents.filter((ev) => ev.tradeId !== tradeId),
            attachments: prev.attachments.filter(
              (att) => !(att.entityType === 'trade' && att.entityId === tradeId)
            ),
            sessions: parentSession
              ? prev.sessions.map((s) =>
                  s.id === parentSession.id
                    ? { ...s, linkedTradeCount: Math.max(0, (s.linkedTradeCount || 1) - 1) }
                    : s
                )
              : prev.sessions,
          }));
          setActiveTradeId((prev) => (prev === tradeId ? null : prev));
        }
      );
    },
    [user, dataset.trades, dataset.tradeEvents, dataset.attachments, dataset.sessions, executeSafely]
  );

  const addAttachment = useCallback(
    async (input: {
      entityType: AttachmentEntityType;
      entityId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      dataUrl: string;
      caption?: string;
    }) => {
      const uid = requireUid();
      return executeSafely(
        {
          module: 'Attachments',
          operation: 'addAttachment',
          actionSummary: 'Failed to upload chart attachment',
          recordType: input.entityType,
          recordId: input.entityId,
        },
        async () => {
          const nowIso = new Date().toISOString();
          const att: Attachment = {
            id: generateId('att'),
            userId: uid,
            entityType: input.entityType,
            entityId: input.entityId,
            filename: input.filename.slice(0, 180),
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            ...(input.caption ? { caption: input.caption } : {}),
            dataUrl: input.dataUrl,
            sourceApplication: APP_NAME,
            sourceCreatedAt: nowIso,
          };
          await createImmutableRecord(uid, 'attachments', att);

          if (input.entityType === 'trade') {
            const t = dataset.trades.find((x) => x.id === input.entityId);
            if (t) {
              const nextIds = [...(t.attachmentIds ?? []), att.id];
              const nextTrade = { ...t, attachmentIds: nextIds };
              await upsertEntity(uid, 'trades', nextTrade, true, ['attachmentIds']);
              setDataset((prev) => ({
                ...prev,
                trades: prev.trades.map((x) => (x.id === t.id ? nextTrade : x)),
                attachments: [att, ...prev.attachments],
              }));
              return att;
            }
          }

          setDataset((prev) => ({
            ...prev,
            attachments: [att, ...prev.attachments],
          }));
          return att;
        }
      );
    },
    [user, dataset.trades, executeSafely]
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Attachments',
          operation: 'removeAttachment',
          actionSummary: 'Failed to remove attachment',
          recordType: 'attachment',
          recordId: attachmentId,
        },
        async () => {
          await deleteEntity(uid, 'attachments', attachmentId);
          setDataset((prev) => ({
            ...prev,
            attachments: prev.attachments.filter((a) => a.id !== attachmentId),
          }));
        }
      );
    },
    [user, executeSafely]
  );

  const saveReview = useCallback(
    async (review: Review, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Reviews',
          operation: 'saveReview',
          actionSummary: `Failed to save review (${review.title || review.reviewType})`,
          recordType: 'review',
          recordId: review.id,
        },
        async () => {
          const updated = { ...review, userId: uid, sourceUpdatedAt: new Date().toISOString() };
          await upsertEntity(uid, 'reviews', updated, existsAlready);
          setDataset((prev) => {
            const idx = prev.reviews.findIndex((r) => r.id === updated.id);
            const next = [...prev.reviews];
            if (idx >= 0) next[idx] = updated;
            else next.unshift(updated);
            return { ...prev, reviews: next };
          });
        },
        () => saveReview(review, existsAlready)
      );
    },
    [user, executeSafely]
  );

  const removeReview = useCallback(
    async (reviewId: string) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Reviews',
          operation: 'removeReview',
          actionSummary: 'Failed to delete review',
          recordType: 'review',
          recordId: reviewId,
        },
        async () => {
          await deleteEntity(uid, 'reviews', reviewId);
          setDataset((prev) => ({
            ...prev,
            reviews: prev.reviews.filter((r) => r.id !== reviewId),
          }));
        }
      );
    },
    [user, executeSafely]
  );

  const saveAccount = useCallback(
    async (account: TradingAccount, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'saveAccount',
          actionSummary: `Failed to save trading account (${account.name})`,
          recordType: 'account',
          recordId: account.id,
        },
        async () => {
          const updated = { ...account, userId: uid, sourceUpdatedAt: new Date().toISOString() };
          await upsertEntity(uid, 'accounts', updated, existsAlready);
          setDataset((prev) => {
            const idx = prev.accounts.findIndex((a) => a.id === updated.id);
            const next = [...prev.accounts];
            if (idx >= 0) next[idx] = updated;
            else next.push(updated);
            return { ...prev, accounts: next };
          });
        },
        () => saveAccount(account, existsAlready)
      );
    },
    [user, executeSafely]
  );

  const saveInstrument = useCallback(
    async (instrument: Instrument, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'saveInstrument',
          actionSummary: `Failed to save instrument (${instrument.symbol})`,
          recordType: 'instrument',
          recordId: instrument.id,
        },
        async () => {
          const updated = { ...instrument, userId: uid };
          await upsertEntity(uid, 'instruments', updated, existsAlready);
          setDataset((prev) => {
            const idx = prev.instruments.findIndex((i) => i.id === updated.id);
            const next = [...prev.instruments];
            if (idx >= 0) next[idx] = updated;
            else next.push(updated);
            return { ...prev, instruments: next };
          });
        },
        () => saveInstrument(instrument, existsAlready)
      );
    },
    [user, executeSafely]
  );

  const saveSessionTemplate = useCallback(
    async (template: SessionTemplate, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'saveSessionTemplate',
          actionSummary: `Failed to save session template (${template.name})`,
          recordType: 'session_template',
          recordId: template.id,
        },
        async () => {
          const updated = { ...template, userId: uid };
          await upsertEntity(uid, 'session_templates', updated, existsAlready);
          setDataset((prev) => {
            const idx = prev.sessionTemplates.findIndex((t) => t.id === updated.id);
            const next = [...prev.sessionTemplates];
            if (idx >= 0) next[idx] = updated;
            else next.push(updated);
            return { ...prev, sessionTemplates: next };
          });
        },
        () => saveSessionTemplate(template, existsAlready)
      );
    },
    [user, executeSafely]
  );

  const saveChecklist = useCallback(
    async (checklist: ChecklistDefinition, existsAlready: boolean) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'saveChecklist',
          actionSummary: `Failed to save checklist (${checklist.name})`,
          recordType: 'checklist',
          recordId: checklist.id,
        },
        async () => {
          const updated = { ...checklist, userId: uid };
          await upsertEntity(uid, 'checklists', updated, existsAlready);
          setDataset((prev) => {
            const idx = prev.checklists.findIndex((c) => c.id === updated.id);
            const next = [...prev.checklists];
            if (idx >= 0) next[idx] = updated;
            else next.push(updated);
            return { ...prev, checklists: next };
          });
        },
        () => saveChecklist(checklist, existsAlready)
      );
    },
    [user, executeSafely]
  );

  const savePreferences = useCallback(
    async (prefs: UserPreferences) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Settings',
          operation: 'savePreferences',
          actionSummary: 'Failed to save logger preferences',
          recordType: 'preferences',
          recordId: prefs.id,
        },
        async () => {
          const exists = Boolean(dataset.preferences);
          const updated = { ...prefs, userId: uid };
          await upsertEntity(uid, 'preferences', updated, exists);
          setDataset((prev) => ({ ...prev, preferences: updated }));
        },
        () => savePreferences(prefs)
      );
    },
    [user, dataset.preferences, executeSafely]
  );

  const logAudit = useCallback(
    async (action: Parameters<typeof recordAuditLog>[1], details: string, count: number) => {
      const uid = requireUid();
      await executeSafely(
        {
          module: 'Audit Log',
          operation: 'logAudit',
          actionSummary: 'Failed to write audit log entry',
          recordType: 'audit_log',
        },
        async () => {
          const log = await recordAuditLog(uid, action, details, count);
          setDataset((prev) => ({ ...prev, auditLogs: [log, ...prev.auditLogs] }));
        }
      );
    },
    [user, executeSafely]
  );

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        authReady,
        authError,
        loadingData,
        dataset,
        activeRoute,
        setActiveRoute,
        selectedDate,
        setSelectedDate,
        selectedJournalDate: selectedDate,
        setSelectedJournalDate: setSelectedDate,
        openDailyJournalForDate,
        openRecordsForDate,
        openDailySessionsForDate: openDailyJournalForDate,
        theme,
        toggleTheme,
        signInWithGoogle,
        signOutUser,
        reloadWorkspace,
        activeLiveSession,
        activeTrade,
        openTrades,
        setActiveTradeId,
        saveDailyJournal,
        startSession,
        createPlannedSession,
        activatePlannedSession,
        updateSessionFields,
        markSessionOutcome,
        closeLiveSession,
        logSessionEvent,
        createBeforeEntryTrade,
        enterTrade,
        logTradeEvent,
        updateDuringTrade,
        closeTrade,
        saveHistoricalTrade,
        deleteTradeRecord,
        addAttachment,
        removeAttachment,
        saveReview,
        removeReview,
        saveAccount,
        saveInstrument,
        saveSessionTemplate,
        saveChecklist,
        savePreferences,
        saveProfile,
        logAudit,
        diagnostics,
        activeError,
        pendingOperations,
        retryingDiagnostic,
        requestedSettingsTab,
        clearRequestedSettingsTab,
        openDiagnosticsView,
        dismissActiveError,
        markDiagnosticResolved,
        clearResolvedDiagnostics,
        clearAllDiagnostics,
        reportDiagnostic,
        retryActiveError,
        retryPendingOperation,
        discardPendingOperation,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
