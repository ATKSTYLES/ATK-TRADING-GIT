import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Play,
  Plus,
  Save,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { ErrorDiagnosticCard } from '../components/ErrorDiagnosticCard';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  calculateFinancialMetrics,
  computeTradeFinancials,
  formatCurrency,
  formatDurationSeconds,
  formatSignedPercent,
  sortTradesChronologically,
} from '../domain/calculations';
import {
  APP_NAME,
  DEFAULT_DAILY_CHECKLIST_ITEMS,
  DEFAULT_EMOTION_OPTIONS,
  DEFAULT_MISTAKE_OPTIONS,
  DEFAULT_PRE_SESSION_EMOTIONS,
  DEFAULT_SESSION_QUICK_ACTIONS,
  DEFAULT_SITTING_LOCATIONS,
  DEFAULT_TIMEZONE,
  createChecklistStates,
  detectActiveStandardSession,
  formatTimeInTimezone,
  formatTimestampWithSeconds,
  generateId,
  getEffectiveStandardTemplates,
  getLocalDateString,
  shiftDateString,
} from '../domain/defaults';
import {
  StructuredAppError,
  validateTradeClosureInput,
  type DiagnosticRecord,
} from '../domain/diagnostics';
import type {
  ChecklistItemState,
  DailyJournal,
  ExitOutcome,
  PlanAdherence,
  SessionAttendanceStatus,
  SessionCategory,
  SetupAvailability,
  SittingLocation,
  SlOutcome,
  TpOutcome,
} from '../domain/types';

const TP_OUTCOME_OPTIONS: Array<{ value: TpOutcome; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'hit', label: 'Hit' },
  { value: 'partial', label: 'Partial' },
  { value: 'missed', label: 'Missed' },
  { value: 'not_used', label: 'Not Used' },
];

const SL_OUTCOME_OPTIONS: Array<{ value: SlOutcome; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'hit', label: 'Hit' },
  { value: 'trailed_be', label: 'Trailed to BE' },
  { value: 'moved', label: 'Moved' },
  { value: 'not_used', label: 'Not Used' },
];

const EXIT_OUTCOME_OPTIONS: Array<{ value: ExitOutcome; label: string }> = [
  { value: 'take_profit', label: 'Take Profit' },
  { value: 'stop_loss', label: 'Stop Loss' },
  { value: 'manual_exit', label: 'Manual Exit' },
  { value: 'breakeven', label: 'Breakeven' },
];

export function DailyJournalPage() {
  const {
    user,
    dataset,
    selectedDate,
    setSelectedDate,
    openRecordsForDate,
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
    addAttachment,
    pendingOperations,
    retryPendingOperation,
    reportDiagnostic,
    openDiagnosticsView,
  } = useWorkspace();

  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const currency = dataset.profile?.currency || 'USD';
  const prefs = dataset.preferences;
  const quickActions = prefs?.sessionQuickActions ?? DEFAULT_SESSION_QUICK_ACTIONS;
  const pauseDuration = prefs?.antiBiasPauseSeconds ?? 10;
  const todayInTz = getLocalDateString(new Date(), timezone);

  // Live Clock (ticks every second for live timers and IST window detection)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);

  // Manual Recording Context Toggle ('session' | 'trade') — both panels remain visible
  const [activeLoggerContext, setActiveLoggerContext] = useState<'session' | 'trade'>(
    activeTrade ? 'trade' : 'session'
  );

  // =========================================================================
  // DAILY PREPARATION (persists per selectedDate independently of sessions)
  // =========================================================================
  const existingJournal = useMemo(
    () => dataset.dailyJournals.find((j) => j.date === selectedDate),
    [dataset.dailyJournals, selectedDate]
  );

  const defaultDailyChecklistLabels = useMemo(() => {
    const def = dataset.checklists.find((c) => c.scope === 'daily' && c.isDefault);
    return def?.items ?? DEFAULT_DAILY_CHECKLIST_ITEMS;
  }, [dataset.checklists]);

  const [prepExpanded, setPrepExpanded] = useState(true);
  const [plannedActivities, setPlannedActivities] = useState('');
  const [morningNotes, setMorningNotes] = useState('');
  const [dailyEmotionalState, setDailyEmotionalState] = useState('');
  const [disciplineRating, setDisciplineRating] = useState<number>(7);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemState[]>([]);
  const [dailyReflection, setDailyReflection] = useState('');
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepSavedNotice, setPrepSavedNotice] = useState('');

  useEffect(() => {
    if (existingJournal) {
      setPlannedActivities(existingJournal.plannedActivities || '');
      setMorningNotes(existingJournal.morningNotes || '');
      setDailyEmotionalState(existingJournal.dailyEmotionalState || '');
      setDisciplineRating(existingJournal.disciplineRating ?? 7);
      setChecklistItems(
        existingJournal.checklistItems && existingJournal.checklistItems.length > 0
          ? existingJournal.checklistItems
          : createChecklistStates(defaultDailyChecklistLabels)
      );
      setDailyReflection(existingJournal.dailyReflection || '');
    } else {
      setPlannedActivities('');
      setMorningNotes('');
      setDailyEmotionalState('');
      setDisciplineRating(7);
      setChecklistItems(createChecklistStates(defaultDailyChecklistLabels));
      setDailyReflection('');
    }
    setPrepSavedNotice('');
  }, [existingJournal, selectedDate, defaultDailyChecklistLabels]);

  const persistDailyPrep = async (nextChecklist?: ChecklistItemState[]) => {
    if (!user) return;
    setSavingPrep(true);
    setPrepSavedNotice('');
    try {
      const nowIso = new Date().toISOString();
      const journal: DailyJournal = {
        id: existingJournal?.id || selectedDate,
        userId: user.uid,
        date: selectedDate,
        timezone: existingJournal?.timezone || timezone,
        plannedActivities,
        morningNotes,
        dailyEmotionalState,
        disciplineRating,
        checklistItems: nextChecklist ?? checklistItems,
        dailyReflection,
        sourceApplication: existingJournal?.sourceApplication || APP_NAME,
        sourceCreatedAt: existingJournal?.sourceCreatedAt || nowIso,
        sourceUpdatedAt: nowIso,
      };
      await saveDailyJournal(journal);
      setPrepSavedNotice('Daily journal saved.');
    } catch {
      // Diagnostic reported centrally via WorkspaceContext
    } finally {
      setSavingPrep(false);
    }
  };

  const toggleDailyChecklistItem = async (id: string) => {
    const next = checklistItems.map((item) =>
      item.id === id
        ? {
            ...item,
            completed: !item.completed,
            completedAt: !item.completed ? new Date().toISOString() : undefined,
          }
        : item
    );
    setChecklistItems(next);
    await persistDailyPrep(next);
  };

  const addDailyChecklistItem = async () => {
    const label = newChecklistLabel.trim();
    if (!label) return;
    const next: ChecklistItemState[] = [
      ...checklistItems,
      { id: `chk_custom_${Date.now()}`, label, completed: false },
    ];
    setChecklistItems(next);
    setNewChecklistLabel('');
    await persistDailyPrep(next);
  };

  const checklistDoneCount = checklistItems.filter((c) => c.completed).length;

  // =========================================================================
  // DAY SUMMARY METRICS
  // =========================================================================
  const daySessions = useMemo(
    () =>
      dataset.sessions
        .filter((s) => s.date === selectedDate)
        .sort((a, b) =>
          (a.actualStart || a.plannedStart || '').localeCompare(b.actualStart || b.plannedStart || '')
        ),
    [dataset.sessions, selectedDate]
  );

  const plannedDaySessions = useMemo(
    () => daySessions.filter((s) => s.status === 'planned'),
    [daySessions]
  );

  const dayTrades = useMemo(
    () => sortTradesChronologically(dataset.trades.filter((t) => t.date === selectedDate)),
    [dataset.trades, selectedDate]
  );

  const dayFin = useMemo(() => calculateFinancialMetrics(dayTrades), [dayTrades]);

  // =========================================================================
  // UPPER PANEL: SESSION LOGGER (Pre-Session Check-In & Live Controls)
  // =========================================================================
  const standardTemplates = useMemo(
    () => getEffectiveStandardTemplates(dataset.sessionTemplates, timezone),
    [dataset.sessionTemplates, timezone]
  );
  const autoDetectedTemplate = useMemo(
    () => detectActiveStandardSession(dataset.sessionTemplates, timezone, nowDate),
    [dataset.sessionTemplates, timezone, nowDate]
  );

  const [sessionCategory, setSessionCategory] = useState<SessionCategory>('standard');
  const [manualTemplateId, setManualTemplateId] = useState<string>('');
  const [customSessionName, setCustomSessionName] = useState('');
  const [customStartTime, setCustomStartTime] = useState('');
  const [customEndTime, setCustomEndTime] = useState('');

  // Required Pre-Session Check-In
  const [sittingLocation, setSittingLocation] = useState<SittingLocation | ''>('');
  const [sittingLocationOther, setSittingLocationOther] = useState('');
  const [preSessionEmotion, setPreSessionEmotion] = useState('');
  const [preSessionEmotionNote, setPreSessionEmotionNote] = useState('');
  const [preSessionBias, setPreSessionBias] = useState('');
  const [preSessionPrepNotes, setPreSessionPrepNotes] = useState('');
  const [sessionStartError, setSessionStartError] = useState('');

  // Live session controls
  const [customSessionObs, setCustomSessionObs] = useState('');
  const [showCloseSessionModal, setShowCloseSessionModal] = useState(false);
  const [closingAttendance, setClosingAttendance] = useState<SessionAttendanceStatus>('attended');
  const [closingSetupAvail, setClosingSetupAvail] = useState<SetupAvailability>('valid');
  const [closingAdherence, setClosingAdherence] = useState<PlanAdherence>('followed');
  const [closingEmotions, setClosingEmotions] = useState<string[]>([]);
  const [closingReflection, setClosingReflection] = useState('');
  const [closingSummary, setClosingSummary] = useState('');

  // Planned session creation modal
  const [showPlanSessionModal, setShowPlanSessionModal] = useState(false);
  const [planSessionName, setPlanSessionName] = useState('London');
  const [planStart, setPlanStart] = useState('11:30');
  const [planEnd, setPlanEnd] = useState('17:30');
  const [planBias, setPlanBias] = useState('');

  const selectedStandardTemplate = useMemo(() => {
    if (manualTemplateId) {
      return standardTemplates.find((t) => t.id === manualTemplateId) ?? autoDetectedTemplate;
    }
    return autoDetectedTemplate;
  }, [manualTemplateId, standardTemplates, autoDetectedTemplate]);

  const sessionElapsedSec = useMemo(() => {
    if (!activeLiveSession?.actualStart) return 0;
    return Math.max(0, Math.floor((nowMs - new Date(activeLiveSession.actualStart).getTime()) / 1000));
  }, [activeLiveSession?.actualStart, nowMs]);

  const activeSessionTimeline = useMemo(() => {
    if (!activeLiveSession) return [];
    return dataset.sessionEvents
      .filter((e) => e.sessionId === activeLiveSession.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [activeLiveSession, dataset.sessionEvents]);

  const canStartSession = useMemo(() => {
    if (!sittingLocation) return false;
    if (sittingLocation === 'Other' && !sittingLocationOther.trim()) return false;
    if (!preSessionEmotion) return false;
    if (sessionCategory === 'standard' && !selectedStandardTemplate) return false;
    if (sessionCategory === 'custom' && !customSessionName.trim()) return false;
    return true;
  }, [
    sittingLocation,
    sittingLocationOther,
    preSessionEmotion,
    sessionCategory,
    selectedStandardTemplate,
    customSessionName,
  ]);

  const handleStartSession = async () => {
    setSessionStartError('');
    if (!sittingLocation) {
      setSessionStartError('Select where you are sitting before starting the session.');
      return;
    }
    if (sittingLocation === 'Other' && !sittingLocationOther.trim()) {
      setSessionStartError('Enter your sitting location when Other is selected.');
      return;
    }
    if (!preSessionEmotion) {
      setSessionStartError('Select how you are feeling before starting the session.');
      return;
    }
    if (sessionCategory === 'standard' && !selectedStandardTemplate) {
      setSessionStartError('Select a standard session window or switch to Custom Session.');
      return;
    }
    if (sessionCategory === 'custom' && !customSessionName.trim()) {
      setSessionStartError('Enter a name for your Custom Session.');
      return;
    }

    const name =
      sessionCategory === 'standard'
        ? selectedStandardTemplate!.name
        : customSessionName.trim();

    try {
      await startSession({
        date: selectedDate,
        sessionName: name,
        sessionCategory,
        templateId: sessionCategory === 'standard' ? selectedStandardTemplate?.id : undefined,
        plannedStart:
          sessionCategory === 'standard'
            ? selectedStandardTemplate?.plannedStartTime
            : customStartTime || undefined,
        plannedEnd:
          sessionCategory === 'standard'
            ? selectedStandardTemplate?.plannedEndTime
            : customEndTime || undefined,
        sittingLocation,
        sittingLocationOther: sittingLocation === 'Other' ? sittingLocationOther.trim() : undefined,
        preSessionEmotion,
        preSessionEmotionNote: preSessionEmotionNote.trim() || undefined,
        sessionBias: preSessionBias.trim() || undefined,
        preSessionPreparation: preSessionPrepNotes.trim() || undefined,
        sessionChecklistLabels:
          sessionCategory === 'standard'
            ? selectedStandardTemplate?.defaultChecklist
            : ['Levels marked', 'Risk rules verified'],
      });
      setActiveLoggerContext('session');
      setCustomSessionName('');
      setCustomStartTime('');
      setCustomEndTime('');
      setPreSessionEmotionNote('');
      setPreSessionPrepNotes('');
    } catch {
      // Diagnostic reported centrally; form values preserved
    }
  };

  const handleQuickSessionAction = async (label: string) => {
    if (!activeLiveSession) return;
    setActiveLoggerContext('session');
    try {
      if (label === 'Custom Observation') {
        const txt = customSessionObs.trim();
        if (!txt) return;
        await logSessionEvent({
          sessionId: activeLiveSession.id,
          eventType: 'custom_observation',
          label: txt,
        });
        setCustomSessionObs('');
        return;
      }
      await logSessionEvent({
        sessionId: activeLiveSession.id,
        eventType: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label,
        isSteppedBack: label === 'Stepped Back',
      });
    } catch {
      // Diagnostic reported centrally
    }
  };

  const [closingSessionBusy, setClosingSessionBusy] = useState(false);

  const handleCompleteLiveSession = async () => {
    if (!activeLiveSession || closingSessionBusy) return;
    setClosingSessionBusy(true);
    try {
      await closeLiveSession(activeLiveSession, {
        actualEnd: new Date().toISOString(),
        attendanceStatus: closingAttendance,
        setupAvailability: closingSetupAvail,
        planAdherence: closingAdherence,
        postSessionEmotions: closingEmotions,
        closingReflection,
        sessionSummary: closingSummary.trim() || undefined,
      });
      setShowCloseSessionModal(false);
      setClosingReflection('');
      setClosingSummary('');
      setClosingEmotions([]);
    } catch {
      // Diagnostic reported centrally; keep modal open with entered fields
    } finally {
      setClosingSessionBusy(false);
    }
  };

  // =========================================================================
  // LOWER PANEL: LIVE TRADE LOGGER (Same Page, Below Session Logger)
  // =========================================================================
  const [outOfSessionMode, setOutOfSessionMode] = useState(false);
  const [accountId, setAccountId] = useState(
    prefs?.defaultAccountId || dataset.accounts[0]?.id || ''
  );
  const [instrument, setInstrument] = useState(dataset.instruments[0]?.symbol || 'NQ');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entryType, setEntryType] = useState(prefs?.entryTypes[0] || 'Limit Order');
  const [setupLabel, setSetupLabel] = useState(prefs?.setupLabels[0] || 'Break & Retest');
  const [timeframe, setTimeframe] = useState(prefs?.timeframes[2] || '5m');
  const [riskPercent, setRiskPercent] = useState('1');
  const [expectedProfitPercent, setExpectedProfitPercent] = useState('');
  const [tpOutcome, setTpOutcome] = useState<TpOutcome>('pending');
  const [slOutcome, setSlOutcome] = useState<SlOutcome>('pending');
  const [entryReason, setEntryReason] = useState('');
  const [preEntryEmotion, setPreEntryEmotion] = useState('Calm & Focused');
  const [confidence, setConfidence] = useState(7);
  const [pauseRemaining, setPauseRemaining] = useState<number>(0);
  const [pauseCompleted, setPauseCompleted] = useState(false);

  useEffect(() => {
    if (!accountId && dataset.accounts.length > 0) {
      setAccountId(prefs?.defaultAccountId || dataset.accounts[0].id);
    }
  }, [accountId, dataset.accounts, prefs?.defaultAccountId]);

  useEffect(() => {
    if (pauseRemaining <= 0) return;
    const t = setTimeout(() => {
      if (pauseRemaining <= 1) {
        setPauseRemaining(0);
        setPauseCompleted(true);
      } else {
        setPauseRemaining((p) => p - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [pauseRemaining]);

  const tradeElapsedSec = useMemo(() => {
    if (!activeTrade?.entryTimestamp) return 0;
    return Math.max(0, Math.floor((nowMs - new Date(activeTrade.entryTimestamp).getTime()) / 1000));
  }, [activeTrade?.entryTimestamp, nowMs]);

  const activeTradeTimeline = useMemo(() => {
    if (!activeTrade) return [];
    return dataset.tradeEvents
      .filter((e) => e.tradeId === activeTrade.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [activeTrade, dataset.tradeEvents]);

  const activeTradeParentSession = useMemo(() => {
    if (!activeTrade?.sessionId) return null;
    return dataset.sessions.find((s) => s.id === activeTrade.sessionId) ?? null;
  }, [activeTrade?.sessionId, dataset.sessions]);

  const activeTradeNumber = useMemo(() => {
    if (!activeTrade) return dayTrades.length + 1;
    const tradesOnTradeDate = sortTradesChronologically(
      dataset.trades.filter((t) => t.date === activeTrade.date)
    );
    const idx = tradesOnTradeDate.findIndex((t) => t.id === activeTrade.id);
    return idx >= 0 ? idx + 1 : 1;
  }, [activeTrade, dataset.trades, dayTrades.length]);

  // During-trade event & live status inputs
  const [duringNote, setDuringNote] = useState('');
  const [duringQty, setDuringQty] = useState('');
  const [duringEmotion, setDuringEmotion] = useState('Calm & Focused');
  const [duringActualPctText, setDuringActualPctText] = useState('');
  const [duringValidationError, setDuringValidationError] = useState('');

  useEffect(() => {
    setDuringActualPctText(
      typeof activeTrade?.actualProfitPercent === 'number'
        ? String(activeTrade.actualProfitPercent)
        : ''
    );
    setDuringValidationError('');
  }, [activeTrade?.id, activeTrade?.actualProfitPercent]);

  // Close Trade Modal state (no mandatory price inputs; missing profit distinct from 0)
  const [showCloseTradeModal, setShowCloseTradeModal] = useState(false);
  const [exitOutcome, setExitOutcome] = useState<ExitOutcome>('take_profit');
  const [closeTpOutcome, setCloseTpOutcome] = useState<TpOutcome>('hit');
  const [closeSlOutcome, setCloseSlOutcome] = useState<SlOutcome>('not_used');
  const [closeActualProfitPct, setCloseActualProfitPct] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [actualOutcome, setActualOutcome] = useState('');
  const [closeGrossPnl, setCloseGrossPnl] = useState('');
  const [closeCommission, setCloseCommission] = useState('');
  const [closeOtherCharges, setCloseOtherCharges] = useState('');
  const [closeExitPrice, setCloseExitPrice] = useState('');
  const [postExitEmotions, setPostExitEmotions] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [lessons, setLessons] = useState('');
  const [followedPlan, setFollowedPlan] = useState(true);
  const [followedRiskRules, setFollowedRiskRules] = useState(true);
  const [impulsiveEntry, setImpulsiveEntry] = useState(false);
  const [exitedPerPlan, setExitedPerPlan] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [creatingTradeBusy, setCreatingTradeBusy] = useState(false);
  const [closingTradeBusy, setClosingTradeBusy] = useState(false);
  const [closeOpId, setCloseOpId] = useState<string>('');
  const [closeAttemptTimestamp, setCloseAttemptTimestamp] = useState<string>('');
  const [closeAttemptDurationSec, setCloseAttemptDurationSec] = useState<number | undefined>(
    undefined
  );
  const [closeTradeFieldErrors, setCloseTradeFieldErrors] = useState<Record<string, string>>({});
  const [closeTradeValidationMsg, setCloseTradeValidationMsg] = useState('');
  const [closeTradeModalError, setCloseTradeModalError] = useState<DiagnosticRecord | null>(null);
  const [tradeClosedSuccessBanner, setTradeClosedSuccessBanner] = useState('');
  const [syncingPendingTradeClose, setSyncingPendingTradeClose] = useState(false);

  const pendingActiveTradeCloseOp = useMemo(() => {
    if (!activeTrade) return undefined;
    return pendingOperations.find(
      (op) => op.kind === 'close_trade' && op.recordId === activeTrade.id
    );
  }, [activeTrade, pendingOperations]);

  const openCloseTradeModal = () => {
    if (!activeTrade) return;
    setCloseTpOutcome(activeTrade.tpOutcome || 'pending');
    setCloseSlOutcome(activeTrade.slOutcome || 'pending');
    setCloseActualProfitPct(
      typeof activeTrade.actualProfitPercent === 'number'
        ? String(activeTrade.actualProfitPercent)
        : ''
    );
    setCloseGrossPnl('');
    setCloseCommission('');
    setCloseOtherCharges('');
    setCloseExitPrice('');
    setExitReason('');
    setActualOutcome('');
    setPostExitEmotions([]);
    setMistakes([]);
    setLessons('');
    setFollowedPlan(true);
    setFollowedRiskRules(true);
    setImpulsiveEntry(false);
    setExitedPerPlan(true);
    setUploadError('');
    setCloseOpId(generateId('op'));
    setCloseAttemptTimestamp('');
    setCloseAttemptDurationSec(undefined);
    setCloseTradeFieldErrors({});
    setCloseTradeValidationMsg('');
    setCloseTradeModalError(null);
    setTradeClosedSuccessBanner('');
    setShowCloseTradeModal(true);
  };

  const closeTradePreview = useMemo(() => {
    const gross = closeGrossPnl.trim() !== '' ? Number(closeGrossPnl) : undefined;
    const comm = closeCommission.trim() !== '' ? Number(closeCommission) : undefined;
    const other = closeOtherCharges.trim() !== '' ? Number(closeOtherCharges) : undefined;
    const pct = closeActualProfitPct.trim() !== '' ? Number(closeActualProfitPct) : undefined;
    return computeTradeFinancials({
      grossPnl: Number.isFinite(gross) ? gross : undefined,
      commission: Number.isFinite(comm) ? comm : undefined,
      otherCharges: Number.isFinite(other) ? other : undefined,
      plannedRisk: activeTrade?.plannedRisk,
      actualProfitPercent: Number.isFinite(pct) ? pct : undefined,
      riskPercent: activeTrade?.riskPercent,
      exitOutcome,
    });
  }, [
    closeGrossPnl,
    closeCommission,
    closeOtherCharges,
    closeActualProfitPct,
    activeTrade?.plannedRisk,
    activeTrade?.riskPercent,
    exitOutcome,
  ]);

  const handleStartOrPrepareTrade = async (statusMode: 'before_entry' | 'during_trade') => {
    if (!accountId || creatingTradeBusy) return;
    setCreatingTradeBusy(true);
    setTradeClosedSuccessBanner('');
    setActiveLoggerContext('trade');
    const selectedInst = dataset.instruments.find((i) => i.symbol === instrument);
    const parsedRiskPct = riskPercent.trim() !== '' ? Number(riskPercent) : undefined;
    const parsedExpPct =
      expectedProfitPercent.trim() !== '' ? Number(expectedProfitPercent) : undefined;

    try {
      const created = await createBeforeEntryTrade({
        date: selectedDate,
        statusMode,
        sessionId: outOfSessionMode ? undefined : activeLiveSession?.id,
        isOutOfSession: outOfSessionMode || !activeLiveSession,
        accountId,
        instrument,
        market: selectedInst?.market,
        direction,
        timeframe,
        entryType,
        setupLabel,
        riskPercent: Number.isFinite(parsedRiskPct) ? parsedRiskPct : undefined,
        expectedProfitPercent: Number.isFinite(parsedExpPct) ? parsedExpPct : undefined,
        tpOutcome,
        slOutcome,
        entryReason: entryReason.trim() || undefined,
        preEntryEmotion,
        confidence,
        antiBiasPauseCompleted: pauseCompleted,
      });
      setPauseCompleted(false);
      setEntryReason('');
      setExpectedProfitPercent('');
      setActiveTradeId(created.id);
    } catch {
      // Diagnostic reported centrally; inputs preserved
    } finally {
      setCreatingTradeBusy(false);
    }
  };

  const handleConfirmCloseTrade = async () => {
    if (!activeTrade || closingTradeBusy) return;
    setCloseTradeFieldErrors({});
    setCloseTradeValidationMsg('');
    setCloseTradeModalError(null);

    const validation = validateTradeClosureInput({
      exitReason,
      actualOutcome,
      lessons,
      actualProfitPercentText: closeActualProfitPct,
      grossPnlText: closeGrossPnl,
      commissionText: closeCommission,
      otherChargesText: closeOtherCharges,
      exitPriceText: closeExitPrice,
    });

    if (!validation.valid) {
      setCloseTradeFieldErrors(validation.fieldErrors);
      setCloseTradeValidationMsg(
        validation.summaryMessage || 'Trade could not be closed because required fields are invalid.'
      );
      const valErr = new StructuredAppError({
        message: validation.summaryMessage || 'Trade closure validation failed.',
        category: 'validation',
        errorCode: 'TRADE_CLOSURE_VALIDATION_FAILED',
        userExplanation:
          validation.summaryMessage || 'Please complete the highlighted required fields.',
        recommendedAction: 'Fill in the required fields highlighted in red and click Complete & Save Trade.',
        retryable: false,
        fieldErrors: validation.fieldErrors,
        cloudStatus: 'unverified',
      });
      const diag = reportDiagnostic(valErr, {
        module: 'Live Trade Logger',
        operation: 'closeTradeValidation',
        actionSummary: 'Trade closure validation failed',
        recordType: 'trade',
        recordId: activeTrade.id,
        operationId: closeOpId || undefined,
        localStatus: 'preserved_in_form',
        cloudStatus: 'unverified',
      });
      setCloseTradeModalError(diag);
      return;
    }

    const opId = closeOpId || generateId('op');
    if (!closeOpId) setCloseOpId(opId);

    const exitTs = closeAttemptTimestamp || new Date().toISOString();
    if (!closeAttemptTimestamp) setCloseAttemptTimestamp(exitTs);

    const durationSec =
      closeAttemptDurationSec !== undefined ? closeAttemptDurationSec : tradeElapsedSec;
    if (closeAttemptDurationSec === undefined) setCloseAttemptDurationSec(durationSec);

    setClosingTradeBusy(true);
    try {
      await closeTrade(
        activeTrade,
        {
          exitTimestamp: exitTs,
          exitPrice: validation.parsed.exitPrice,
          exitReason: validation.parsed.exitReason,
          actualOutcome: validation.parsed.actualOutcome,
          exitOutcome,
          tpOutcome: closeTpOutcome,
          slOutcome: closeSlOutcome,
          actualProfitPercent: validation.parsed.actualProfitPercent,
          grossPnl: validation.parsed.grossPnl,
          commission: validation.parsed.commission,
          otherCharges: validation.parsed.otherCharges,
          postExitEmotions,
          mistakes,
          lessons: validation.parsed.lessons,
          disciplineQuestions: {
            followedPlan,
            followedRiskRules,
            impulsiveEntry,
            exitedPerPlan,
          },
          duringTradeDurationSeconds: durationSec,
        },
        {
          operationId: opId,
          expectedSourceUpdatedAt: activeTrade.sourceUpdatedAt,
        }
      );
      setShowCloseTradeModal(false);
      setCloseTradeModalError(null);
      setCloseOpId('');
      setCloseAttemptTimestamp('');
      setCloseAttemptDurationSec(undefined);
      setOutOfSessionMode(false);
      setTradeClosedSuccessBanner('Trade successfully closed and saved.');
      if (activeLiveSession) {
        setActiveLoggerContext('session');
      }
    } catch (err) {
      const attachedDiag =
        err && typeof err === 'object' && 'diagnostic' in err
          ? ((err as { diagnostic?: DiagnosticRecord }).diagnostic ?? null)
          : null;
      if (attachedDiag) {
        setCloseTradeModalError(attachedDiag);
      }
    } finally {
      setClosingTradeBusy(false);
    }
  };

  const handleUploadScreenshotToTrade = async (targetTradeId: string, file: File) => {
    setUploadError('');
    if (file.size > 650 * 1024) {
      setUploadError('Keep screenshots under 650 KB for portable archive compatibility.');
      return;
    }
    setUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
      });
      await addAttachment({
        entityType: 'trade',
        entityId: targetTradeId,
        filename: file.name,
        mimeType: file.type || 'image/png',
        sizeBytes: file.size,
        dataUrl,
      });
    } catch {
      setUploadError('Failed to upload screenshot. See error banner for details.');
    } finally {
      setUploadingImage(false);
    }
  };

  const accountMap = useMemo(
    () => new Map(dataset.accounts.map((a) => [a.id, a.name])),
    [dataset.accounts]
  );

  const toggleArr = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  return (
    <div className="space-y-6">
      {/* ===================================================================== */}
      {/* HEADER — LIVE INPUT WORKSPACE                                         */}
      {/* ===================================================================== */}
      <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Live Input Workspace · {timezone}
              {selectedDate === todayInTz ? ' · Today' : ''}
            </p>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
              Daily Journal
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
              onClick={() => setShowPlanSessionModal(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              Schedule Session
            </button>
            <button
              type="button"
              onClick={() => openRecordsForDate(selectedDate)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              View Records
            </button>
          </div>
        </div>

        {/* Daily Trading & Prep Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-xs">
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block">
              Sessions ({selectedDate})
            </span>
            <span className="font-mono tabular-nums font-semibold text-sm text-neutral-900 dark:text-neutral-100">
              {daySessions.length}
              {activeLiveSession && activeLiveSession.date === selectedDate ? ' · 1 Live' : ''}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block">
              Trades &amp; Outcomes
            </span>
            <span className="font-mono tabular-nums font-semibold text-sm text-neutral-900 dark:text-neutral-100">
              {dayTrades.length} ({dayFin.wins}W · {dayFin.losses}L · {dayFin.breakeven}BE)
            </span>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block">Daily Return</span>
            <span
              className={`font-mono tabular-nums font-semibold text-sm ${
                (dayFin.totalProfitPercent ?? (dayFin.hasMonetaryPnl ? dayFin.netPnl : 0)) > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : (dayFin.totalProfitPercent ?? (dayFin.hasMonetaryPnl ? dayFin.netPnl : 0)) < 0
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-neutral-900 dark:text-neutral-100'
              }`}
            >
              {dayFin.totalProfitPercent !== null
                ? formatSignedPercent(dayFin.totalProfitPercent)
                : dayFin.hasMonetaryPnl
                ? formatCurrency(dayFin.netPnl, currency)
                : '—'}
              {dayFin.totalProfitPercent !== null && dayFin.hasMonetaryPnl
                ? ` (${formatCurrency(dayFin.netPnl, currency)})`
                : ''}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block">Daily Preparation</span>
            <span className="font-mono tabular-nums font-semibold text-sm text-neutral-900 dark:text-neutral-100">
              Checklist {checklistDoneCount}/{checklistItems.length}
              {dailyEmotionalState ? ` · ${dailyEmotionalState}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* DAILY PREPARATION & EMOTIONAL CHECK-IN                                */}
      {/* ===================================================================== */}
      <section className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg">
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Daily Preparation — {selectedDate}
            </h3>
            <span className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
              {checklistDoneCount}/{checklistItems.length} checklist · Discipline {disciplineRating}/10
            </span>
            {prepSavedNotice && (
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                {prepSavedNotice}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void persistDailyPrep()}
              disabled={savingPrep}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {savingPrep ? 'Saving...' : 'Save Journal'}
            </button>
            <button
              type="button"
              onClick={() => setPrepExpanded((v) => !v)}
              className="p-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              aria-label={prepExpanded ? 'Collapse daily preparation' : 'Expand daily preparation'}
            >
              {prepExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {prepExpanded && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
            {/* Persistent Daily Checklist */}
            <div className="lg:col-span-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Daily Checklist (persists all day)
                </span>
                <span className="font-mono tabular-nums text-neutral-500">
                  {checklistDoneCount}/{checklistItems.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {checklistItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void toggleDailyChecklistItem(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                      item.completed
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-neutral-500'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 text-neutral-800 dark:text-neutral-200'
                    }`}
                  >
                    <span className={item.completed ? 'line-through' : ''}>{item.label}</span>
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                        item.completed
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-neutral-300 dark:border-neutral-600'
                      }`}
                    >
                      {item.completed && <Check className="w-3 h-3" />}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  value={newChecklistLabel}
                  onChange={(e) => setNewChecklistLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addDailyChecklistItem();
                  }}
                  placeholder="Add daily checklist item..."
                  className="flex-1 px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
                <button
                  type="button"
                  onClick={() => void addDailyChecklistItem()}
                  className="p-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                  aria-label="Add checklist item"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Daily Plan, Notes & Emotional Baseline */}
            <div className="lg:col-span-8 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Daily Emotional State
                  </label>
                  <select
                    value={dailyEmotionalState}
                    onChange={(e) => setDailyEmotionalState(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  >
                    <option value="">Select state...</option>
                    {DEFAULT_EMOTION_OPTIONS.map((em) => (
                      <option key={em} value={em}>
                        {em}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-neutral-600 dark:text-neutral-400">
                      Discipline Rating (1–10)
                    </label>
                    <span className="font-mono tabular-nums font-semibold">
                      {disciplineRating}/10
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={disciplineRating}
                    onChange={(e) => setDisciplineRating(Number(e.target.value))}
                    className="w-full mt-1.5 accent-neutral-900 dark:accent-neutral-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Daily Plan
                  </label>
                  <textarea
                    rows={3}
                    value={plannedActivities}
                    onChange={(e) => setPlannedActivities(e.target.value)}
                    placeholder="Planned sessions, key news events, non-negotiable rules..."
                    className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Daily Notes
                  </label>
                  <textarea
                    rows={3}
                    value={morningNotes}
                    onChange={(e) => setMorningNotes(e.target.value)}
                    placeholder="Sleep, mental clarity, key HTF levels..."
                    className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    End-of-Day Reflection
                  </label>
                  <textarea
                    rows={3}
                    value={dailyReflection}
                    onChange={(e) => setDailyReflection(e.target.value)}
                    placeholder="Review today's patience, risk discipline, and takeaways..."
                    className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* MANUAL CONTEXT TOGGLE (SESSION | TRADE)                               */}
      {/* ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Active Event-Logging Context:
          </span>
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-md">
            <button
              type="button"
              onClick={() => setActiveLoggerContext('session')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                activeLoggerContext === 'session'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              SESSION LOGGER {activeLiveSession ? '· LIVE' : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveLoggerContext('trade')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                activeLoggerContext === 'trade'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              TRADE LOGGER {activeTrade ? `· ${activeTrade.instrument}` : ''}
            </button>
          </div>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {activeLoggerContext === 'session'
            ? 'Session events write strictly to session_events.'
            : 'Trade events write strictly to trade_events.'}
        </p>
      </div>

      {/* ===================================================================== */}
      {/* UPPER PANEL — SESSION LOGGER                                          */}
      {/* ===================================================================== */}
      <section
        onClick={() => setActiveLoggerContext('session')}
        className={`bg-white dark:bg-[#111622] border rounded-lg p-5 space-y-5 transition-colors ${
          activeLoggerContext === 'session'
            ? 'border-neutral-900 dark:border-neutral-300'
            : 'border-neutral-200 dark:border-neutral-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Session Logger
                </h3>
                {activeLoggerContext === 'session' && (
                  <span className="text-[11px] font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                    · ACTIVE CONTEXT
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {activeLiveSession
                  ? `${activeLiveSession.sessionName} · ${
                      activeLiveSession.sessionCategory === 'custom' ? 'Custom' : 'Standard'
                    } · Started ${formatTimeInTimezone(
                      activeLiveSession.actualStart || activeLiveSession.sourceCreatedAt || nowDate,
                      activeLiveSession.timezone
                    )} (${activeLiveSession.timezone})`
                  : `Session Window Detection (${timezone}) · Current time ${formatTimeInTimezone(
                      nowDate,
                      timezone
                    )}`}
              </p>
            </div>
          </div>

          {activeLiveSession ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-[11px] text-neutral-500 block">Live Duration</span>
                <span className="font-mono tabular-nums text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatDurationSeconds(sessionElapsedSec)}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCloseSessionModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
              >
                <Square className="w-3 h-3" /> End Session
              </button>
            </div>
          ) : (
            <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
              No session running
            </span>
          )}
        </div>

        {!activeLiveSession ? (
          /* PRE-SESSION CHECK-IN & START FORM */
          <div className="space-y-4 text-xs">
            {/* Scheduled / Planned Sessions for selectedDate */}
            {plannedDaySessions.length > 0 && (
              <div className="p-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 space-y-2">
                <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Planned Sessions for {selectedDate}
                </p>
                <div className="flex flex-wrap gap-2">
                  {plannedDaySessions.map((ps) => (
                    <div
                      key={ps.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#111622]"
                    >
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {ps.sessionName}
                      </span>
                      {ps.plannedStart && (
                        <span className="font-mono text-neutral-500">
                          {ps.plannedStart}–{ps.plannedEnd || '?'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void activatePlannedSession(ps, {
                            ...(sittingLocation ? { sittingLocation } : {}),
                            ...(sittingLocation === 'Other' && sittingLocationOther.trim()
                              ? { sittingLocationOther: sittingLocationOther.trim() }
                              : {}),
                            ...(preSessionEmotion ? { preSessionEmotion } : {}),
                            ...(preSessionEmotionNote.trim()
                              ? { preSessionEmotionNote: preSessionEmotionNote.trim() }
                              : {}),
                            ...(preSessionBias.trim()
                              ? { sessionBias: preSessionBias.trim() }
                              : {}),
                            ...(preSessionPrepNotes.trim()
                              ? { preSessionPreparation: preSessionPrepNotes.trim() }
                              : {}),
                          }).catch(() => undefined)
                        }
                        className="px-2 py-0.5 rounded bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium cursor-pointer"
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        onClick={() => void markSessionOutcome(ps, 'missed').catch(() => undefined)}
                        className="px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-500 cursor-pointer"
                      >
                        Missed
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Session Type / Window Selection */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-md">
                <button
                  type="button"
                  onClick={() => setSessionCategory('standard')}
                  className={`px-3 py-1.5 font-medium rounded cursor-pointer ${
                    sessionCategory === 'standard'
                      ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  Standard Session
                </button>
                <button
                  type="button"
                  onClick={() => setSessionCategory('custom')}
                  className={`px-3 py-1.5 font-medium rounded cursor-pointer ${
                    sessionCategory === 'custom'
                      ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  Custom Session
                </button>
              </div>

              {sessionCategory === 'standard' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {standardTemplates.map((tpl) => {
                    const isSelected = selectedStandardTemplate?.id === tpl.id;
                    const isAuto = autoDetectedTemplate?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setManualTemplateId(tpl.id)}
                        className={`px-3 py-1.5 rounded-md border font-medium cursor-pointer ${
                          isSelected
                            ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100'
                            : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {tpl.name} ({tpl.plannedStartTime}–{tpl.plannedEndTime})
                        {isAuto ? ' · Now' : ''}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {sessionCategory === 'standard' && !autoDetectedTemplate && !manualTemplateId && (
              <div className="p-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400">
                No standard session window is active at {formatTimeInTimezone(nowDate, timezone)} (
                {timezone}). Select Asian, London, or New York above, or switch to Custom Session.
              </div>
            )}

            {sessionCategory === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Custom Session Name *
                  </label>
                  <input
                    type="text"
                    value={customSessionName}
                    onChange={(e) => setCustomSessionName(e.target.value)}
                    placeholder="e.g. FOMC Volatility / Weekend Crypto"
                    className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Planned Start (Optional)
                  </label>
                  <input
                    type="time"
                    value={customStartTime}
                    onChange={(e) => setCustomStartTime(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Planned End (Optional)
                  </label>
                  <input
                    type="time"
                    value={customEndTime}
                    onChange={(e) => setCustomEndTime(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>
            )}

            {/* Pre-Session Check-In (Required) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <div className="space-y-3">
                <div>
                  <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                    1. Where are you sitting? *
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_SITTING_LOCATIONS.map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => setSittingLocation(loc)}
                        className={`px-3 py-1.5 rounded-md border cursor-pointer ${
                          sittingLocation === loc
                            ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                            : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                  {sittingLocation === 'Other' && (
                    <input
                      type="text"
                      value={sittingLocationOther}
                      onChange={(e) => setSittingLocationOther(e.target.value)}
                      placeholder="Specify sitting location..."
                      className="mt-2 w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  )}
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                    2. How are you feeling? *
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_PRE_SESSION_EMOTIONS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setPreSessionEmotion(em)}
                        className={`px-2.5 py-1.5 rounded-md border cursor-pointer ${
                          preSessionEmotion === em
                            ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                            : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={preSessionEmotionNote}
                    onChange={(e) => setPreSessionEmotionNote(e.target.value)}
                    placeholder="Optional short note on mental/physical state..."
                    className="mt-2 w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-neutral-700 dark:text-neutral-300">
                      Pre-Session Bias
                    </label>
                    <button
                      type="button"
                      onClick={() => setPreSessionBias('Neutral')}
                      className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                    >
                      Set Neutral
                    </button>
                  </div>
                  <input
                    type="text"
                    value={preSessionBias}
                    onChange={(e) => setPreSessionBias(e.target.value)}
                    placeholder="Bullish above prior high / Bearish / Neutral..."
                    className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                    Session Preparation Notes
                  </label>
                  <textarea
                    rows={3}
                    value={preSessionPrepNotes}
                    onChange={(e) => setPreSessionPrepNotes(e.target.value)}
                    placeholder="Key levels, catalyst schedule, max trades or loss limit for this session..."
                    className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>
            </div>

            {sessionStartError && (
              <p className="text-red-600 dark:text-red-400 font-medium">{sessionStartError}</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <p className="text-neutral-500 dark:text-neutral-400">
                {canStartSession
                  ? `Ready to start ${
                      sessionCategory === 'standard'
                        ? `${selectedStandardTemplate?.name} (${selectedStandardTemplate?.plannedStartTime}–${selectedStandardTemplate?.plannedEndTime})`
                        : customSessionName.trim()
                    } for ${selectedDate}.`
                  : 'Complete where you are sitting and how you are feeling to unlock Start Session.'}
              </p>
              <button
                type="button"
                onClick={() => void handleStartSession()}
                className={`inline-flex items-center gap-2 px-4 py-2 font-medium rounded-md cursor-pointer ${
                  canStartSession
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90'
                    : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500'
                }`}
              >
                <Play className="w-3.5 h-3.5" /> Start Session
              </button>
            </div>
          </div>
        ) : (
          /* LIVE SESSION INTERFACE */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
            <div className="lg:col-span-7 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Attendance</span>
                  <span className="font-medium capitalize text-neutral-900 dark:text-neutral-100">
                    {activeLiveSession.attendanceStatus.replace('_', ' ')}
                    {activeLiveSession.arrivalDelayMinutes
                      ? ` (+${activeLiveSession.arrivalDelayMinutes}m)`
                      : ''}
                  </span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Sitting At</span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {activeLiveSession.sittingLocation === 'Other' &&
                    activeLiveSession.sittingLocationOther
                      ? activeLiveSession.sittingLocationOther
                      : activeLiveSession.sittingLocation || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Pre-Session Emotion</span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {activeLiveSession.preSessionEmotion || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
                  <span className="text-neutral-500 block">Stepped Back</span>
                  <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                    {activeLiveSession.steppedBackCount}
                  </span>
                </div>
              </div>

              {(activeLiveSession.sessionBias ||
                activeLiveSession.preSessionPreparation ||
                activeLiveSession.preSessionEmotionNote) && (
                <div className="p-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30 space-y-1">
                  {activeLiveSession.sessionBias && (
                    <p>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        Bias:
                      </span>{' '}
                      {activeLiveSession.sessionBias}
                    </p>
                  )}
                  {activeLiveSession.preSessionEmotionNote && (
                    <p>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        State Note:
                      </span>{' '}
                      {activeLiveSession.preSessionEmotionNote}
                    </p>
                  )}
                  {activeLiveSession.preSessionPreparation && (
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        Preparation Notes:
                      </span>{' '}
                      {activeLiveSession.preSessionPreparation}
                    </p>
                  )}
                </div>
              )}

              {activeLiveSession.sessionChecklist && activeLiveSession.sessionChecklist.length > 0 && (
                <div>
                  <p className="font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    Session Checklist
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {activeLiveSession.sessionChecklist.map((chk) => (
                      <button
                        key={chk.id}
                        type="button"
                        onClick={() => {
                          const next = activeLiveSession.sessionChecklist!.map((c) =>
                            c.id === chk.id ? { ...c, completed: !c.completed } : c
                          );
                          void updateSessionFields({
                            ...activeLiveSession,
                            sessionChecklist: next,
                          }).catch(() => undefined);
                        }}
                        className={`px-2.5 py-1.5 rounded border text-left cursor-pointer ${
                          chk.completed
                            ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 line-through text-neutral-500'
                            : 'border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200'
                        }`}
                      >
                        {chk.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2.5 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Session Event Logger
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quickActions
                    .filter((a) => a !== 'Custom Observation')
                    .map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => void handleQuickSessionAction(action)}
                        className="px-2.5 py-2 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 cursor-pointer"
                      >
                        {action}
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customSessionObs}
                    onChange={(e) => setCustomSessionObs(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleQuickSessionAction('Custom Observation');
                    }}
                    placeholder="Log custom session observation..."
                    className="flex-1 px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleQuickSessionAction('Custom Observation')}
                    className="px-3.5 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer whitespace-nowrap"
                  >
                    Log Session Note
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Independent Session Event Timeline */}
            <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-neutral-800 pt-4 lg:pt-0 lg:pl-5 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Session Event Timeline ({activeSessionTimeline.length})
                </h4>
                <span className="font-mono text-[11px] text-neutral-500">session_events</span>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {activeSessionTimeline.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 rounded border border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/60 dark:bg-neutral-900/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {ev.label}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                        {formatTimestampWithSeconds(ev.timestamp, ev.timezone || timezone)}
                      </span>
                    </div>
                    {ev.notes && (
                      <p className="text-neutral-600 dark:text-neutral-400 mt-1">{ev.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* LOWER PANEL — LIVE TRADE LOGGER (SAME PAGE)                           */}
      {/* ===================================================================== */}
      <section
        onClick={() => setActiveLoggerContext('trade')}
        className={`bg-white dark:bg-[#111622] border rounded-lg p-5 space-y-5 transition-colors ${
          activeLoggerContext === 'trade'
            ? 'border-neutral-900 dark:border-neutral-300'
            : 'border-neutral-200 dark:border-neutral-800'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Live Trade Logger
              </h3>
              {activeLoggerContext === 'trade' && (
                <span className="text-[11px] font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                  · ACTIVE CONTEXT
                </span>
              )}
            </div>
            {activeTrade ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100">
                  Trade #{activeTradeNumber}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {activeTrade.instrument}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold uppercase ${
                    activeTrade.direction === 'long'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                      : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
                  }`}
                >
                  {activeTrade.direction}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeTrade.isOutOfSession
                    ? 'Out-of-Session'
                    : activeTradeParentSession
                    ? `Linked Session: ${activeTradeParentSession.sessionName}`
                    : 'Linked to Session'}
                </span>
              </div>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Trade #{dayTrades.length + 1} for {selectedDate} · Quick behavioural &amp; percentage logger
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {openTrades.length > 1 && (
              <select
                value={activeTrade?.id || ''}
                onChange={(e) => setActiveTradeId(e.target.value)}
                aria-label="Select active open trade"
                className="h-9 px-2.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              >
                {openTrades.map((ot) => (
                  <option key={ot.id} value={ot.id}>
                    {ot.instrument} ({ot.direction.toUpperCase()}) · {ot.status.replace('_', ' ')}
                  </option>
                ))}
              </select>
            )}
            {activeTrade && (
              <>
                <div className="text-left md:text-right pr-1">
                  <span className="text-[11px] text-neutral-500 block leading-tight">
                    Status · Duration
                  </span>
                  <span className="font-mono tabular-nums text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    {activeTrade.status === 'during_trade'
                      ? `During Trade · ${formatDurationSeconds(tradeElapsedSec)}`
                      : 'Before Entry · 00:00:00'}
                  </span>
                </div>
                {activeTrade.status === 'before_entry' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void enterTrade(activeTrade).catch(() => undefined);
                    }}
                    className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-medium rounded-md bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" /> Enter Trade
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openCloseTradeModal();
                  }}
                  className="h-9 px-4 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 cursor-pointer whitespace-nowrap"
                >
                  Close Trade
                </button>
              </>
            )}
          </div>
        </div>

        {tradeClosedSuccessBanner && (
          <div className="p-3 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/25 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
            <span className="font-medium">{tradeClosedSuccessBanner}</span>
            <button
              type="button"
              onClick={() => setTradeClosedSuccessBanner('')}
              className="text-emerald-700 dark:text-emerald-300 hover:opacity-80 cursor-pointer"
              aria-label="Dismiss confirmation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Notice when parent session completed while trade stays open */}
        {activeTrade &&
          activeTradeParentSession &&
          activeTradeParentSession.status === 'completed' && (
            <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
              Session completed — {openTrades.length} trade{openTrades.length > 1 ? 's' : ''} still
              active. Continue logging events and close this trade when ready.
            </div>
          )}

        {/* Notice when this active trade already has a locally queued pending closure */}
        {activeTrade && pendingActiveTradeCloseOp && (
          <div className="p-3.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Pending cloud sync for trade closure · Attempts: {pendingActiveTradeCloseOp.attemptCount}
                {pendingActiveTradeCloseOp.lastCorrelationId
                  ? ` · Ref: ${pendingActiveTradeCloseOp.lastCorrelationId}`
                  : ''}
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                {pendingActiveTradeCloseOp.lastErrorSummary ||
                  'Closing details are saved locally and awaiting Cloud Vault confirmation.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={syncingPendingTradeClose}
                onClick={async () => {
                  setSyncingPendingTradeClose(true);
                  try {
                    const ok = await retryPendingOperation(pendingActiveTradeCloseOp.operationId);
                    if (ok) {
                      setShowCloseTradeModal(false);
                      setCloseTradeModalError(null);
                      setTradeClosedSuccessBanner(
                        'Pending trade closure synchronised and saved to Cloud Vault.'
                      );
                      if (activeLiveSession) {
                        setActiveLoggerContext('session');
                      }
                    }
                  } finally {
                    setSyncingPendingTradeClose(false);
                  }
                }}
                className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium cursor-pointer disabled:opacity-50"
              >
                {syncingPendingTradeClose ? 'Syncing...' : 'Sync Pending Closure'}
              </button>
              <button
                type="button"
                onClick={openDiagnosticsView}
                className="px-2.5 py-1.5 rounded-md border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 cursor-pointer"
              >
                Diagnostics
              </button>
            </div>
          </div>
        )}

        {!activeTrade ? (
          /* NEW LIVE TRADE FORM (NO MANDATORY PRICE INPUTS) */
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-neutral-600 dark:text-neutral-400">
                Context:{' '}
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {outOfSessionMode || !activeLiveSession
                    ? 'Out-of-Session Trade'
                    : `In-Session (${activeLiveSession.sessionName})`}
                </span>
              </div>
              <label className="inline-flex items-center gap-2 text-neutral-600 dark:text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={outOfSessionMode || !activeLiveSession}
                  disabled={!activeLiveSession}
                  onChange={(e) => setOutOfSessionMode(e.target.checked)}
                />
                Out-of-Session Trade
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Instrument
                </label>
                <select
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {dataset.instruments.map((inst) => (
                    <option key={inst.id} value={inst.symbol}>
                      {inst.symbol} · {inst.market}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Direction
                </label>
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
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Trading Account
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {dataset.accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Entry Type
                </label>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {(prefs?.entryTypes ?? ['Limit Order']).map((et) => (
                    <option key={et} value={et}>
                      {et}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Setup
                </label>
                <select
                  value={setupLabel}
                  onChange={(e) => setSetupLabel(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {(prefs?.setupLabels ?? ['Break & Retest']).map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Timeframe
                </label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {(prefs?.timeframes ?? ['5m', '15m', '1H']).map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Planned Risk %
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Expected Profit %
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={expectedProfitPercent}
                  onChange={(e) => setExpectedProfitPercent(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Take Profit Status
                </label>
                <select
                  value={tpOutcome}
                  onChange={(e) => setTpOutcome(e.target.value as TpOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {TP_OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Stop Loss Status
                </label>
                <select
                  value={slOutcome}
                  onChange={(e) => setSlOutcome(e.target.value as SlOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {SL_OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Pre-Trade Emotion
                </label>
                <select
                  value={preEntryEmotion}
                  onChange={(e) => setPreEntryEmotion(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {DEFAULT_EMOTION_OPTIONS.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex justify-between font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  <span>Confidence (1–10)</span>
                  <span className="font-mono">{confidence}/10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="w-full mt-2 accent-neutral-900 dark:accent-neutral-100"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                Entry Reasoning
              </label>
              <textarea
                rows={2}
                value={entryReason}
                onChange={(e) => setEntryReason(e.target.value)}
                placeholder="Confluence, trigger, invalidation rule..."
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => {
                  setPauseCompleted(false);
                  setPauseRemaining(pauseDuration);
                }}
                disabled={pauseRemaining > 0}
                className="px-3 py-1.5 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {pauseRemaining > 0
                  ? `Anti-Bias Pause (${pauseRemaining}s)`
                  : pauseCompleted
                  ? 'Anti-Bias Pause Completed'
                  : `Run ${pauseDuration}s Anti-Bias Pause`}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleStartOrPrepareTrade('before_entry')}
                  disabled={!accountId || creatingTradeBusy}
                  className="px-3.5 py-2 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
                >
                  {creatingTradeBusy ? 'Saving...' : 'Prepare (Before Entry)'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartOrPrepareTrade('during_trade')}
                  disabled={!accountId || creatingTradeBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" /> {creatingTradeBusy ? 'Starting...' : 'Start Live Trade'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ACTIVE TRADE MANAGEMENT & INDEPENDENT TIMELINE */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
            <div className="lg:col-span-7 min-w-0 space-y-4">
              {/* 8 Compact Trade Information Cards (Part 6) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Account
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {accountMap.get(activeTrade.accountId) || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Setup
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.setupLabel || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Entry Type
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.entryType || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Timeframe
                  </span>
                  <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.timeframe || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Risk %
                  </span>
                  <span className="font-mono tabular-nums font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.riskPercent !== undefined ? `${activeTrade.riskPercent}%` : '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Expected Profit %
                  </span>
                  <span className="font-mono tabular-nums font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.expectedProfitPercent !== undefined
                      ? `+${activeTrade.expectedProfitPercent}%`
                      : '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Pre-Trade Emotion
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.preEntryEmotion || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 min-w-0">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    Confidence
                  </span>
                  <span className="font-mono tabular-nums font-medium text-neutral-900 dark:text-neutral-100 block truncate mt-0.5">
                    {activeTrade.confidence !== undefined ? `${activeTrade.confidence}/10` : '—'}
                  </span>
                </div>
              </div>

              {/* Trade Status Fields (Equal Height Aligned Row) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                <div className="min-w-0">
                  <label
                    htmlFor="live-tp-status"
                    className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                  >
                    Take Profit Status
                  </label>
                  <select
                    id="live-tp-status"
                    value={activeTrade.tpOutcome || 'pending'}
                    onChange={(e) =>
                      void updateDuringTrade(activeTrade, {
                        tpOutcome: e.target.value as TpOutcome,
                      }).catch(() => undefined)
                    }
                    className="w-full h-9 px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  >
                    {TP_OUTCOME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="live-sl-status"
                    className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                  >
                    Stop Loss Status
                  </label>
                  <select
                    id="live-sl-status"
                    value={activeTrade.slOutcome || 'pending'}
                    onChange={(e) =>
                      void updateDuringTrade(activeTrade, {
                        slOutcome: e.target.value as SlOutcome,
                      }).catch(() => undefined)
                    }
                    className="w-full h-9 px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  >
                    {SL_OUTCOME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="live-actual-profit-pct"
                    className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                  >
                    Actual Profit % (Optional)
                  </label>
                  <input
                    id="live-actual-profit-pct"
                    type="text"
                    inputMode="decimal"
                    value={duringActualPctText}
                    onChange={(e) => {
                      setDuringActualPctText(e.target.value);
                      if (duringValidationError) setDuringValidationError('');
                    }}
                    onBlur={() => {
                      const raw = duringActualPctText.trim();
                      if (raw === '') return;
                      const num = Number(raw);
                      if (!Number.isFinite(num)) {
                        setDuringValidationError(
                          'Actual Profit % must be a valid number, or leave it blank.'
                        );
                        return;
                      }
                      setDuringValidationError('');
                      void updateDuringTrade(activeTrade, { actualProfitPercent: num }).catch(
                        () => undefined
                      );
                    }}
                    placeholder="Unrecorded"
                    className="w-full h-9 px-2.5 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>

              {activeTrade.entryReason && (
                <div className="p-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    Entry Reasoning:{' '}
                  </span>
                  <span className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                    {activeTrade.entryReason}
                  </span>
                </div>
              )}

              {/* Trade Event Logger (Responsive Grid, Zero Overlap, Equal Input Heights, Uniform Button Widths) */}
              <div className="space-y-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                    Trade Event Logger
                  </p>
                  <span className="text-[11px] text-neutral-500">
                    Logs to independent trade timeline
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6 min-w-0">
                    <label
                      htmlFor="live-trade-note"
                      className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                    >
                      Market Observation / Note
                    </label>
                    <input
                      id="live-trade-note"
                      type="text"
                      value={duringNote}
                      onChange={(e) => setDuringNote(e.target.value)}
                      placeholder="Price reaction, structure note, or reason..."
                      className="w-full h-9 px-3 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  </div>
                  <div className="sm:col-span-3 min-w-0">
                    <label
                      htmlFor="live-trade-partial-pct"
                      className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                    >
                      Partial-Close %
                    </label>
                    <input
                      id="live-trade-partial-pct"
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={duringQty}
                      onChange={(e) => {
                        setDuringQty(e.target.value);
                        if (duringValidationError) setDuringValidationError('');
                      }}
                      placeholder="e.g. 50"
                      className="w-full h-9 px-2.5 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    />
                  </div>
                  <div className="sm:col-span-3 min-w-0">
                    <label
                      htmlFor="live-trade-emotion"
                      className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                    >
                      Emotion
                    </label>
                    <select
                      id="live-trade-emotion"
                      value={duringEmotion}
                      onChange={(e) => setDuringEmotion(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                    >
                      {DEFAULT_EMOTION_OPTIONS.map((em) => (
                        <option key={em} value={em}>
                          {em}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {duringValidationError && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {duringValidationError}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {[
                    { type: 'sl_adjusted', label: 'Stop-Loss Adjusted' },
                    { type: 'tp_adjusted', label: 'Take-Profit Adjusted' },
                    { type: 'partial_close', label: 'Partial Close' },
                    { type: 'position_added', label: 'Added to Position' },
                    { type: 'emotion_change', label: 'Emotion Event' },
                    { type: 'market_observation', label: 'Market Observation' },
                  ].map((act) => (
                    <button
                      key={act.type}
                      type="button"
                      onClick={async () => {
                        setActiveLoggerContext('trade');
                        setDuringValidationError('');
                        const rawQty = duringQty.trim();
                        let parsedQty: number | undefined;
                        if (rawQty !== '') {
                          const candidate = Number(rawQty);
                          if (!Number.isFinite(candidate)) {
                            setDuringValidationError('Partial-Close % must be a valid number.');
                            return;
                          }
                          parsedQty = candidate;
                        }
                        if (act.type === 'market_observation' && !duringNote.trim()) {
                          setDuringValidationError(
                            'Enter a market observation note before logging a Market Observation.'
                          );
                          return;
                        }
                        const eventLabel =
                          act.type === 'emotion_change'
                            ? `Emotion Event: ${duringEmotion}`
                            : act.label;
                        try {
                          await logTradeEvent({
                            tradeId: activeTrade.id,
                            phase:
                              activeTrade.status === 'before_entry'
                                ? 'before_entry'
                                : 'during_trade',
                            eventType: act.type,
                            label: eventLabel,
                            details: duringNote.trim() || undefined,
                            quantity: parsedQty,
                            emotion: duringEmotion,
                          });
                          setDuringNote('');
                          setDuringQty('');
                        } catch {
                          // Diagnostic reported centrally
                        }
                      }}
                      className="w-full min-h-[38px] px-3 py-2 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 text-center sm:text-left truncate hover:bg-neutral-50 dark:hover:bg-neutral-800/60 cursor-pointer transition-colors"
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Independent Trade Event Timeline */}
            <div className="lg:col-span-5 min-w-0 border-t lg:border-t-0 lg:border-l border-neutral-200 dark:border-neutral-800 pt-4 lg:pt-0 lg:pl-5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Trade Event Timeline ({activeTradeTimeline.length})
                </h4>
                <span className="font-mono text-[11px] text-neutral-500">trade_events</span>
              </div>
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {activeTradeTimeline.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 rounded border border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/60 dark:bg-neutral-900/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {ev.label}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                        {formatTimestampWithSeconds(ev.timestamp, ev.timezone || timezone)}
                      </span>
                    </div>
                    {ev.details && (
                      <p className="text-neutral-600 dark:text-neutral-400 mt-1">{ev.details}</p>
                    )}
                    {(ev.quantity !== undefined || ev.emotion) && (
                      <p className="font-mono text-[11px] text-neutral-500 mt-0.5">
                        {ev.quantity !== undefined ? `Size / %: ${ev.quantity}` : ''}
                        {ev.quantity !== undefined && ev.emotion ? ' · ' : ''}
                        {ev.emotion ? `Emotion: ${ev.emotion}` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* MODAL: END LIVE SESSION                                               */}
      {/* ===================================================================== */}
      {showCloseSessionModal && activeLiveSession && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                End Session — {activeLiveSession.sessionName}
              </h3>
              <button
                type="button"
                onClick={() => setShowCloseSessionModal(false)}
                className="p-1 text-neutral-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {openTrades.length > 0 && (
              <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 font-medium">
                You still have an active trade. Ending this session will not close your trade.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Attendance
                </label>
                <select
                  value={closingAttendance}
                  onChange={(e) => setClosingAttendance(e.target.value as SessionAttendanceStatus)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="attended">Attended</option>
                  <option value="late">Late Arrival</option>
                  <option value="early_exit">Early Departure</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Setup Availability
                </label>
                <select
                  value={closingSetupAvail}
                  onChange={(e) => setClosingSetupAvail(e.target.value as SetupAvailability)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="a_plus">A+ Setups Available</option>
                  <option value="valid">Valid Setups</option>
                  <option value="mixed">Mixed / Choppy</option>
                  <option value="no_valid_setup">No Valid Setup</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Plan Adherence
                </label>
                <select
                  value={closingAdherence}
                  onChange={(e) => setClosingAdherence(e.target.value as PlanAdherence)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="followed">Followed Plan</option>
                  <option value="partial">Partial Adherence</option>
                  <option value="deviated">Deviated</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                Post-Session Emotions
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_EMOTION_OPTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => toggleArr(closingEmotions, em, setClosingEmotions)}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      closingEmotions.includes(em)
                        ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                Session Summary
              </label>
              <input
                type="text"
                value={closingSummary}
                onChange={(e) => setClosingSummary(e.target.value)}
                placeholder="One-line summary of conditions and execution..."
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                Closing Reflection
              </label>
              <textarea
                rows={3}
                value={closingReflection}
                onChange={(e) => setClosingReflection(e.target.value)}
                placeholder="What went well, what needs adjustment?"
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={closingSessionBusy}
                onClick={() => setShowCloseSessionModal(false)}
                className="px-3.5 py-2 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 disabled:opacity-50 cursor-pointer"
              >
                Keep Running
              </button>
              <button
                type="button"
                disabled={closingSessionBusy}
                onClick={() => void handleCompleteLiveSession()}
                className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 cursor-pointer"
              >
                {closingSessionBusy ? 'Saving Session...' : 'Complete & Save Session'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CLOSE LIVE TRADE                                               */}
      {/* ===================================================================== */}
      {showCloseTradeModal && activeTrade && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Close Trade — {activeTrade.instrument} ({activeTrade.direction.toUpperCase()})
                </h3>
                <p className="text-neutral-500 font-mono">
                  Result Preview:{' '}
                  <span className="uppercase font-semibold">{closeTradePreview.result}</span>
                  {closeActualProfitPct.trim() !== '' &&
                  Number.isFinite(Number(closeActualProfitPct))
                    ? ` · ${formatSignedPercent(Number(closeActualProfitPct))}`
                    : ''}
                  {closeTradePreview.netPnl !== undefined
                    ? ` · ${formatCurrency(closeTradePreview.netPnl, currency)}`
                    : ''}
                  {closeTradePreview.realisedR !== undefined
                    ? ` (${closeTradePreview.realisedR >= 0 ? '+' : ''}${closeTradePreview.realisedR}R)`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={closingTradeBusy}
                onClick={() => setShowCloseTradeModal(false)}
                className="p-1 text-neutral-500 disabled:opacity-50 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {closeTradeModalError && (
              <ErrorDiagnosticCard
                record={closeTradeModalError}
                onRetry={
                  closeTradeModalError.retryable ? () => handleConfirmCloseTrade() : undefined
                }
                retrying={closingTradeBusy}
                onDismiss={() => setCloseTradeModalError(null)}
                onOpenDiagnostics={() => {
                  setShowCloseTradeModal(false);
                  openDiagnosticsView();
                }}
                compact
              />
            )}

            {closeTradeValidationMsg && !closeTradeModalError && (
              <div
                role="alert"
                className="p-3 rounded-md border border-red-300 dark:border-red-900 bg-red-50/75 dark:bg-red-950/30 text-red-700 dark:text-red-300 font-medium"
              >
                {closeTradeValidationMsg}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Exit Outcome
                </label>
                <select
                  value={exitOutcome}
                  onChange={(e) => setExitOutcome(e.target.value as ExitOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {EXIT_OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Take Profit Status
                </label>
                <select
                  value={closeTpOutcome}
                  onChange={(e) => setCloseTpOutcome(e.target.value as TpOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {TP_OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Stop Loss Status
                </label>
                <select
                  value={closeSlOutcome}
                  onChange={(e) => setCloseSlOutcome(e.target.value as SlOutcome)}
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  {SL_OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Actual Profit % (Optional)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={closeActualProfitPct}
                  onChange={(e) => setCloseActualProfitPct(e.target.value)}
                  placeholder="Leave blank if unknown"
                  className={`w-full px-2.5 py-2 font-mono rounded-md border bg-white dark:bg-[#0B0E14] ${
                    closeTradeFieldErrors.actualProfitPercent
                      ? 'border-red-500 dark:border-red-500'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                />
                {closeTradeFieldErrors.actualProfitPercent && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                    {closeTradeFieldErrors.actualProfitPercent}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Exit Reason *
                </label>
                <input
                  type="text"
                  value={exitReason}
                  onChange={(e) => {
                    setExitReason(e.target.value);
                    if (closeTradeFieldErrors.exitReason) {
                      setCloseTradeFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.exitReason;
                        return next;
                      });
                    }
                  }}
                  placeholder="Hit TP / Stopped out / Manual exit..."
                  className={`w-full px-3 py-2 rounded-md border bg-white dark:bg-[#0B0E14] ${
                    closeTradeFieldErrors.exitReason
                      ? 'border-red-500 dark:border-red-500'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                />
                {closeTradeFieldErrors.exitReason && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                    {closeTradeFieldErrors.exitReason}
                  </p>
                )}
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Actual Outcome Notes
                </label>
                <input
                  type="text"
                  value={actualOutcome}
                  onChange={(e) => setActualOutcome(e.target.value)}
                  placeholder="How price played out..."
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>

            {/* Optional Monetary / Price Details (never required) */}
            <details className="border border-neutral-200 dark:border-neutral-800 rounded-md p-3">
              <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">
                Optional Monetary P&amp;L &amp; Price Details (leave blank if unrecorded)
              </summary>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="block font-medium text-neutral-500 mb-1">
                    Gross P&amp;L ({currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={closeGrossPnl}
                    onChange={(e) => setCloseGrossPnl(e.target.value)}
                    placeholder="Unrecorded"
                    className={`w-full px-2.5 py-1.5 font-mono rounded border bg-white dark:bg-[#0B0E14] ${
                      closeTradeFieldErrors.grossPnl
                        ? 'border-red-500'
                        : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-500 mb-1">Commission</label>
                  <input
                    type="number"
                    step="any"
                    value={closeCommission}
                    onChange={(e) => setCloseCommission(e.target.value)}
                    placeholder="Unrecorded"
                    className={`w-full px-2.5 py-1.5 font-mono rounded border bg-white dark:bg-[#0B0E14] ${
                      closeTradeFieldErrors.commission
                        ? 'border-red-500'
                        : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-500 mb-1">Other Charges</label>
                  <input
                    type="number"
                    step="any"
                    value={closeOtherCharges}
                    onChange={(e) => setCloseOtherCharges(e.target.value)}
                    placeholder="Unrecorded"
                    className={`w-full px-2.5 py-1.5 font-mono rounded border bg-white dark:bg-[#0B0E14] ${
                      closeTradeFieldErrors.otherCharges
                        ? 'border-red-500'
                        : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-500 mb-1">Exit Price</label>
                  <input
                    type="number"
                    step="any"
                    value={closeExitPrice}
                    onChange={(e) => setCloseExitPrice(e.target.value)}
                    placeholder="Optional"
                    className={`w-full px-2.5 py-1.5 font-mono rounded border bg-white dark:bg-[#0B0E14] ${
                      closeTradeFieldErrors.exitPrice
                        ? 'border-red-500'
                        : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  />
                </div>
              </div>
            </details>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={followedPlan}
                  onChange={(e) => setFollowedPlan(e.target.checked)}
                />
                Followed Plan
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={followedRiskRules}
                  onChange={(e) => setFollowedRiskRules(e.target.checked)}
                />
                Followed Risk Rules
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={impulsiveEntry}
                  onChange={(e) => setImpulsiveEntry(e.target.checked)}
                />
                Impulsive Entry
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exitedPerPlan}
                  onChange={(e) => setExitedPerPlan(e.target.checked)}
                />
                Exited Per Plan
              </label>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                Post-Trade Emotions
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_EMOTION_OPTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => toggleArr(postExitEmotions, em, setPostExitEmotions)}
                    className={`px-2 py-1 rounded border cursor-pointer ${
                      postExitEmotions.includes(em)
                        ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                Mistakes (If Any)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_MISTAKE_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleArr(mistakes, m, setMistakes)}
                    className={`px-2 py-1 rounded border cursor-pointer ${
                      mistakes.includes(m)
                        ? 'bg-red-700 text-white border-red-700'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                Lessons Learned
              </label>
              <textarea
                rows={2}
                value={lessons}
                onChange={(e) => setLessons(e.target.value)}
                placeholder="Key takeaway from this trade..."
                className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
              />
            </div>

            {uploadError && <p className="text-red-600 dark:text-red-400">{uploadError}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <Upload className="w-3.5 h-3.5" />
                {uploadingImage ? 'Uploading...' : 'Attach Chart Screenshot'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadScreenshotToTrade(activeTrade.id, f);
                  }}
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={closingTradeBusy}
                  onClick={() => setShowCloseTradeModal(false)}
                  className="px-3.5 py-2 font-medium rounded-md border border-neutral-200 dark:border-neutral-700 disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={closingTradeBusy}
                  onClick={() => void handleConfirmCloseTrade()}
                  className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 cursor-pointer"
                >
                  {closingTradeBusy ? 'Saving Trade...' : 'Complete & Save Trade'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: SCHEDULE PLANNED SESSION                                       */}
      {/* ===================================================================== */}
      {showPlanSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Schedule Planned Session ({selectedDate})</h3>
              <button
                type="button"
                onClick={() => setShowPlanSessionModal(false)}
                className="cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-medium mb-1">Session Name</label>
                <input
                  type="text"
                  value={planSessionName}
                  onChange={(e) => setPlanSessionName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Planned Start</label>
                  <input
                    type="time"
                    value={planStart}
                    onChange={(e) => setPlanStart(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Planned End</label>
                  <input
                    type="time"
                    value={planEnd}
                    onChange={(e) => setPlanEnd(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Session Bias</label>
                <input
                  type="text"
                  value={planBias}
                  onChange={(e) => setPlanBias(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPlanSessionModal(false)}
                className="px-3.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await createPlannedSession({
                      date: selectedDate,
                      sessionName: planSessionName,
                      plannedStart: planStart,
                      plannedEnd: planEnd,
                      sessionBias: planBias,
                    });
                    setShowPlanSessionModal(false);
                  } catch {
                    // Diagnostic reported centrally
                  }
                }}
                className="px-4 py-2 font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
              >
                Save Planned Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
