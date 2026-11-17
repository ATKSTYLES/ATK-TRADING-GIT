import assert from 'node:assert/strict';
import {
  ALLOWED_TRADE_UPDATE_KEYS,
  MAX_AUTO_SYNC_ATTEMPTS,
  StructuredAppError,
  inspectAndRepairPendingTradeClose,
  normalizePendingOperation,
  pendingStatusForCategory,
  shouldAutoRetryPendingOp,
  upsertGroupedDiagnostic,
  validateTradeClosureInput,
  type DiagnosticRecord,
  type ErrorCategory,
  type PendingOperationRecord,
} from '../src/domain/diagnostics';
import {
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  computeTradeFinancials,
} from '../src/domain/calculations';
import { sanitizeSchemaPayloadForCollection } from '../src/storage/repository';
import { errorHandler } from '../src/services/ErrorHandler';
import type { DailyJournal, Trade, TradingSession } from '../src/domain/types';

function verifyErrorHandlerAndGrouping() {
  const events: DiagnosticRecord[] = [];
  const unsub = errorHandler.subscribe((rec) => events.push(rec));

  try {
    const val = errorHandler.logValidationError('Exit reason is required.', {
      module: 'Live Trade Logger',
      operation: 'closeTrade',
      actionSummary: 'Trade closure validation failed',
      recordType: 'trade',
      recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
    });
    assert.equal(val.category, 'validation');
    assert.equal(val.localStatus, 'preserved_in_form');

    const net = errorHandler.logNetworkError(new Error('Failed to fetch'), {
      module: 'Live Trade Logger',
      operation: 'closeTrade',
      actionSummary: 'Close Trade',
      recordType: 'trade',
      recordId: 'trd_test_net',
      operationId: 'op_net_1',
    });
    assert.equal(net.category, 'network');
    assert.equal(net.cloudStatus, 'pending_retry');
    assert.equal(net.retryable, true);

    const db = errorHandler.logDatabaseError({ code: 'invalid-argument', message: 'bad arg' }, {
      module: 'Trades Ledger',
      operation: 'saveHistoricalTrade',
      actionSummary: 'Save Historical Trade',
    });
    assert.equal(db.category, 'database');
    assert.equal(db.cloudStatus, 'failed');

    const auth = errorHandler.logAuthenticationError(new Error('Token expired'), {
      module: 'Authentication',
      operation: 'refresh',
      actionSummary: 'Refresh Session',
    });
    assert.equal(auth.category, 'authentication');

    const perm = errorHandler.logPermissionError(
      new Error('7 PERMISSION_DENIED: Missing or insufficient permissions user=trader@secret.com Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig'),
      {
        module: 'Live Trade Logger',
        operation: 'closeTrade',
        actionSummary: 'Trade closure failed',
        recordType: 'trade',
        recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
        operationId: 'op_xau_close',
        localStatus: 'saved_locally',
      }
    );
    assert.equal(perm.category, 'permission');
    assert.equal(perm.cloudStatus, 'failed');
    assert.ok(!perm.safeTechnicalMessage.includes('trader@secret.com'));
    assert.ok(!perm.safeTechnicalMessage.includes('eyJhbGci'));

    const sync = errorHandler.logSynchronisationError('Incomplete batch commit', {
      module: 'Cloud Sync',
      operation: 'retryPendingOperation',
      actionSummary: 'Retry Pending Operation',
    });
    assert.equal(sync.category, 'synchronisation');

    const conflict = errorHandler.logConflictError('Stale record version', {
      module: 'Cloud Sync',
      operation: 'closeTrade',
      actionSummary: 'Close Trade',
    });
    assert.equal(conflict.category, 'conflict');

    const app = errorHandler.logApplicationError(new Error('Unexpected render branch'), {
      module: 'Application',
      operation: 'render',
      actionSummary: 'Render Component',
    });
    assert.equal(app.category, 'application');

    const categories = new Set<ErrorCategory>(events.map((e) => e.category));
    assert.equal(categories.size, 8);

    const inline = errorHandler.formatInlineMessage(perm);
    assert.match(inline, /Saved locally \(pending cloud sync\)/);
    assert.match(inline, /Failed \(not synced\)/);
    assert.match(inline, /Ref: ATK-/);

    const report = errorHandler.formatReport(perm);
    assert.match(report, /Permission \/ Access Error/);
  } finally {
    unsub();
  }

  // Grouped Error History (Part 8)
  let history: DiagnosticRecord[] = [];
  const attempt1 = errorHandler.logPermissionError('First permission failure', {
    module: 'Live Trade Logger',
    operation: 'closeTrade',
    actionSummary: 'Trade closure failed',
    recordType: 'trade',
    recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
    operationId: 'op_xau_grouped',
    localStatus: 'saved_locally',
  }, false);
  history = upsertGroupedDiagnostic(history, attempt1);
  assert.equal(history.length, 1);
  assert.equal(history[0].attemptCount, 1);

  const attempt2 = errorHandler.logPermissionError('Second permission failure', {
    module: 'Cloud Sync',
    operation: 'retryPendingOperation',
    actionSummary: 'Trade closure retry failed',
    recordType: 'trade',
    recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
    operationId: 'op_xau_grouped',
    localStatus: 'saved_locally',
  }, false);
  history = upsertGroupedDiagnostic(history, attempt2);
  assert.equal(history.length, 1, 'Repeated failures for same operationId must group into 1 card');
  assert.equal(history[0].attemptCount, 2);
  assert.equal(history[0].originalError?.userExplanation, attempt1.userExplanation);
  assert.equal(history[0].attemptHistory?.length, 2);
  assert.match(errorHandler.formatReport(history[0]), /Attempts: 2/);

  // Different failure category creates a distinct diagnostic card
  const distinctValidation = errorHandler.logValidationError('Exit reason is required.', {
    module: 'Live Trade Logger',
    operation: 'closeTradeValidation',
    actionSummary: 'Trade closure validation failed',
    recordType: 'trade',
    recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
  }, false);
  history = upsertGroupedDiagnostic(history, distinctValidation);
  assert.equal(history.length, 2);
}

function verifyPendingQueueAndXauusdRecovery() {
  const legacyOp: PendingOperationRecord = {
    operationId: 'op_xau_legacy_1',
    kind: 'close_trade',
    userId: 'uid_abhi_1',
    recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
    createdAt: '2026-11-17T05:50:06.000Z',
    lastAttemptAt: '2026-11-17T05:50:14.000Z',
    attemptCount: 2,
    summary: 'Close LONG XAUUSD (2026-11-17)',
    lastCorrelationId: 'ATK-9WS6Q-R0VG',
    lastErrorSummary: 'Cloud Vault rejected this update because a permission or record-validation check failed on the server.',
    payload: {
      updatedTrade: {
        id: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
        userId: 'uid_abhi_1',
        accountId: 'acc_main',
        sessionId: 'ses_ny_1',
        isOutOfSession: false,
        instrument: 'XAUUSD',
        direction: 'long',
        status: 'closed',
        result: 'win',
        exitTimestamp: '2026-11-17T05:50:05.000Z',
        exitReason: 'Target reached at London high sweep.',
        grossPnl: null,
        sourceCreatedAt: '2026-11-17T05:30:00.000Z',
      },
      updateFields: ['id', 'userId', 'sourceCreatedAt', 'status', 'exitTimestamp', 'exitReason', 'result', 'grossPnl'],
      closeEvent: {
        id: 'te_close_op_xau_legacy_1',
        userId: 'uid_abhi_1',
        tradeId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
        phase: 'exit',
        eventType: 'trade_closed',
        label: 'Closed XAUUSD',
        details: 'Target reached at London high sweep.',
        timestamp: '2026-11-17T05:50:05.000Z',
        date: '2026-11-17', // invalid field for trade_events rule -> must be stripped
      },
    },
  };

  const normalized = normalizePendingOperation(legacyOp);
  assert.equal(normalized.recordType, 'trade');
  assert.equal(normalized.operationType, 'update');
  assert.equal(normalized.workspaceId, 'uid_abhi_1');
  assert.equal(normalized.status, 'requires_attention');
  assert.equal(shouldAutoRetryPendingOp(normalized), false, 'Permission/requires_attention items must NOT infinite-retry');

  const networkOp = normalizePendingOperation({
    ...legacyOp,
    lastErrorSummary: 'Network timeout while saving',
    status: pendingStatusForCategory('network'),
    lastErrorCategory: 'network',
    attemptCount: 1,
  });
  assert.equal(networkOp.status, 'failed');
  assert.equal(shouldAutoRetryPendingOp(networkOp), true);
  assert.equal(
    shouldAutoRetryPendingOp({ ...networkOp, attemptCount: MAX_AUTO_SYNC_ATTEMPTS }),
    false,
    'Max auto-sync attempt cap must stop runaway retries'
  );

  const inspected = inspectAndRepairPendingTradeClose(normalized, 'uid_abhi_1');
  assert.equal(inspected.valid, true);
  assert.equal(inspected.repairedPayload?.closeEvent.date, undefined, 'Stray date field must be stripped from closeEvent');
  assert.equal(inspected.repairedPayload?.closeEvent.sourceApplication, 'ATK Deck');
  assert.equal(inspected.updateFieldKeys.every((k) => ALLOWED_TRADE_UPDATE_KEYS.has(k)), true);
}

function verifySchemaSanitizationAcrossCollections() {
  // Collections that FORBID sourceApplication / sourceCreatedAt / sourceUpdatedAt in firestore.rules
  for (const col of ['session_templates', 'checklists', 'instruments', 'preferences'] as const) {
    const createPayload = sanitizeSchemaPayloadForCollection(
      col,
      {
        id: `${col}_1`,
        userId: 'uid_1',
        name: 'Test',
        symbol: 'NQ',
        sourceApplication: 'ATK Deck',
        sourceCreatedAt: '2026-11-17T00:00:00Z',
        sourceUpdatedAt: '2026-11-17T00:00:00Z',
      },
      'create'
    );
    assert.equal('sourceApplication' in createPayload, false, `${col} must not have sourceApplication`);
    assert.equal('sourceCreatedAt' in createPayload, false, `${col} must not have sourceCreatedAt`);
    assert.equal('sourceUpdatedAt' in createPayload, false, `${col} must not have sourceUpdatedAt`);
  }

  // Collections that ALLOW source metadata on create, but make sourceApplication & sourceCreatedAt immutable on update
  const tradeCreate = sanitizeSchemaPayloadForCollection(
    'trades',
    {
      id: 'trd_1',
      userId: 'uid_1',
      instrument: 'NQ',
      sourceApplication: 'ATK Deck',
      sourceCreatedAt: '2026-11-17T00:00:00Z',
      sourceUpdatedAt: '2026-11-17T00:00:00Z',
    },
    'create'
  );
  assert.equal(tradeCreate.sourceApplication, 'ATK Deck');
  assert.equal(tradeCreate.sourceCreatedAt, '2026-11-17T00:00:00Z');
  assert.ok(tradeCreate.sourceUpdatedAt);

  const tradeUpdate = sanitizeSchemaPayloadForCollection(
    'trades',
    {
      id: 'trd_1',
      userId: 'uid_1',
      instrument: 'NQ',
      sourceApplication: 'ATK Deck',
      sourceCreatedAt: '2026-11-17T00:00:00Z',
      sourceUpdatedAt: '2026-11-17T01:00:00Z',
    },
    'update'
  );
  assert.equal('id' in tradeUpdate, false, 'Update must strip immutable id');
  assert.equal('userId' in tradeUpdate, false, 'Update must strip immutable userId');
  assert.equal('sourceApplication' in tradeUpdate, false, 'Update must strip immutable sourceApplication');
  assert.equal('sourceCreatedAt' in tradeUpdate, false, 'Update must strip immutable sourceCreatedAt');
  assert.equal(tradeUpdate.sourceUpdatedAt, '2026-11-17T01:00:00Z');
}

function verifyLifecycleAndCalculationsIntegrity() {
  // Test B + C + D domain invariants: multiple trades in a session, session ends while 1 stays open, out-of-session trade
  const sessions: TradingSession[] = [
    {
      id: 'ses_ny',
      userId: 'uid_1',
      date: '2026-11-17',
      sessionName: 'New York Open',
      timezone: 'Asia/Kolkata',
      attendanceStatus: 'attended',
      status: 'completed',
      steppedBackCount: 1,
      linkedTradeCount: 2,
      actualStart: '2026-11-17T13:30:00Z',
      actualEnd: '2026-11-17T16:00:00Z',
    },
  ];

  const trades: Trade[] = [
    {
      id: 'trd_1',
      userId: 'uid_1',
      date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      sessionId: 'ses_ny',
      isOutOfSession: false,
      accountId: 'acc_1',
      instrument: 'XAUUSD',
      direction: 'long',
      status: 'closed',
      riskPercent: 1,
      actualProfitPercent: 2.5,
      realisedR: 2.5,
      result: 'win',
      disciplineQuestions: {
        followedPlan: true,
        followedRiskRules: true,
        impulsiveEntry: false,
        exitedPerPlan: true,
      },
    },
    {
      id: 'trd_2_active_after_session_end',
      userId: 'uid_1',
      date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      sessionId: 'ses_ny',
      isOutOfSession: false,
      accountId: 'acc_1',
      instrument: 'NQ',
      direction: 'short',
      status: 'during_trade',
      riskPercent: 1,
      result: 'pending',
    },
    {
      id: 'trd_3_out_of_session',
      userId: 'uid_1',
      date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      isOutOfSession: true,
      accountId: 'acc_1',
      instrument: 'EURUSD',
      direction: 'long',
      status: 'closed',
      exitOutcome: 'stop_loss',
      result: 'loss',
    },
  ];

  const journals: DailyJournal[] = [
    {
      id: 'dj_2026-11-17',
      userId: 'uid_1',
      date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      checklistItems: [
        { id: 'c1', label: 'Levels', completed: true },
        { id: 'c2', label: 'News', completed: false },
      ],
    },
  ];

  const fin = calculateFinancialMetrics(trades);
  assert.equal(fin.totalTrades, 3);
  assert.equal(fin.closedTrades, 2, 'Active trade after session close stays open and excluded from closed count');
  assert.equal(fin.hasMonetaryPnl, false, 'Unrecorded monetary values must NOT fabricate $0');
  assert.equal(fin.totalProfitPercent, 2.5);
  assert.equal(fin.wins, 1);
  assert.equal(fin.losses, 1);
  assert.equal(fin.winRate, 50);

  const act = calculateActivityMetrics(sessions, trades);
  assert.equal(act.inSessionTrades, 2);
  assert.equal(act.outOfSessionTrades, 1);
  assert.equal(act.attendedSessions, 1);
  assert.equal(act.zeroTradeAttendedSessions, 0);

  const disc = calculateDisciplineMetrics(trades, sessions, journals);
  assert.equal(disc.totalSteppedBackCount, 1);
  assert.equal(disc.checklistCompletionRate, 50);

  // Verify closure validation keeps unrecorded fields undefined rather than 0
  const valRes = validateTradeClosureInput({
    exitReason: 'Hit planned structural target',
    actualProfitPercentText: '2.5',
    grossPnlText: '',
    commissionText: '',
    exitPriceText: '',
  });
  assert.equal(valRes.valid, true);
  const computed = computeTradeFinancials({
    grossPnl: valRes.parsed.grossPnl,
    actualProfitPercent: valRes.parsed.actualProfitPercent,
    riskPercent: 1,
    exitOutcome: 'take_profit',
  });
  assert.equal(computed.grossPnl, undefined);
  assert.equal(computed.netPnl, undefined);
  assert.equal(computed.realisedR, 2.5);
  assert.equal(computed.result, 'win');

  const appErr = new StructuredAppError({
    category: 'permission',
    errorCode: 'permission-denied',
    message: 'Simulated permission denied',
    userExplanation: 'Cloud Vault rejected this update because a permission or record-validation check failed on the server.',
    recommendedAction: 'Inspect error details.',
  });
  assert.equal(appErr.category, 'permission');
}

verifyErrorHandlerAndGrouping();
verifyPendingQueueAndXauusdRecovery();
verifySchemaSanitizationAcrossCollections();
verifyLifecycleAndCalculationsIntegrity();
console.log('ALL REBUILD VERIFICATION SUITE CHECKS PASSED.');
