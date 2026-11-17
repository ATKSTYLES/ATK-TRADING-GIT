import assert from 'node:assert/strict';
import {
  ALLOWED_TRADE_UPDATE_KEYS,
  classifyError,
  formatDiagnosticReport,
  formatPendingOperationDiagnosticReport,
  inspectAndRepairPendingTradeClose,
  isValidDocId,
  sanitizeTechnicalMessage,
  StructuredAppError,
  validateTradeClosureInput,
  type ErrorCategory,
  type PendingOperationRecord,
} from '../src/domain/diagnostics';
import { computeTradeFinancials } from '../src/domain/calculations';
import { cleanPayload } from '../src/storage/repository';

function runTests() {
  // 1. Trade Closure Validation
  {
    const missingReason = validateTradeClosureInput({
      exitReason: '   ',
      actualProfitPercentText: '1.5',
    });
    assert.equal(missingReason.valid, false);
    assert.equal(
      missingReason.fieldErrors.exitReason,
      'Trade could not be closed because an exit reason is required.'
    );
    assert.equal(
      missingReason.summaryMessage,
      'Trade could not be closed because an exit reason is required.'
    );

    const optionalOmitted = validateTradeClosureInput({
      exitReason: 'Hit planned 2R target at London high.',
      actualOutcome: '',
      lessons: '',
      actualProfitPercentText: '',
      grossPnlText: '',
      commissionText: '',
      otherChargesText: '',
      exitPriceText: '',
    });
    assert.equal(optionalOmitted.valid, true);
    assert.equal(optionalOmitted.parsed.grossPnl, undefined);
    assert.equal(optionalOmitted.parsed.exitPrice, undefined);
    assert.equal(optionalOmitted.parsed.actualProfitPercent, undefined);

    const badNumber = validateTradeClosureInput({
      exitReason: 'Stopped out cleanly',
      grossPnlText: 'abc',
      exitPriceText: 'NaN',
    });
    assert.equal(badNumber.valid, false);
    assert.ok(badNumber.fieldErrors.grossPnl);
    assert.ok(badNumber.fieldErrors.exitPrice);

    const tooLong = validateTradeClosureInput({
      exitReason: 'x'.repeat(2005),
      lessons: 'y'.repeat(4005),
    });
    assert.equal(tooLong.valid, false);
    assert.ok(tooLong.fieldErrors.exitReason);
    assert.ok(tooLong.fieldErrors.lessons);
  }

  // 2. Error Classification across all 8 required categories
  {
    const seenCategories = new Set<ErrorCategory>();

    const validationDiag = classifyError(
      new StructuredAppError({
        message: 'Validation failed',
        category: 'validation',
        errorCode: 'EXIT_REASON_REQUIRED',
        userExplanation: 'Trade could not be closed because an exit reason is required.',
        recommendedAction: 'Provide an exit reason.',
      }),
      { module: 'Live Trade Logger', operation: 'close_trade', actionSummary: 'Close Trade' }
    );
    assert.equal(validationDiag.category, 'validation');
    seenCategories.add(validationDiag.category);

    const authDiag = classifyError(
      { code: 'auth/requires-recent-login', message: 'User session expired' },
      { module: 'Authentication', operation: 'sign_in', actionSummary: 'Verify Identity' }
    );
    assert.equal(authDiag.category, 'authentication');
    seenCategories.add(authDiag.category);

    const permJson = JSON.stringify({
      error: '7 PERMISSION_DENIED: Missing or insufficient permissions.',
      code: 'permission-denied',
      operationType: 'update',
      path: 'users/uid_123/trades/trd_abc',
      authInfo: { userId: 'uid_123', emailVerified: true, isAnonymous: false },
    });
    const permDiag = classifyError(new Error(permJson), {
      module: 'Live Trade Logger',
      operation: 'close_trade',
      actionSummary: 'Complete & Save Trade',
      recordType: 'trade',
      recordId: 'trd_abc',
    });
    assert.equal(permDiag.category, 'permission');
    assert.equal(permDiag.errorCode, 'permission-denied');
    seenCategories.add(permDiag.category);

    const unverifiedPermDiag = classifyError(
      new Error(
        JSON.stringify({
          error: 'Missing or insufficient permissions.',
          code: 'permission-denied',
          operationType: 'write',
          path: 'users/uid_123/trades/trd_abc',
          authInfo: { userId: 'uid_123', emailVerified: false },
        })
      ),
      {
        module: 'Live Trade Logger',
        operation: 'close_trade',
        actionSummary: 'Complete & Save Trade',
        emailVerified: false,
      }
    );
    assert.equal(unverifiedPermDiag.category, 'permission');
    assert.match(unverifiedPermDiag.userExplanation, /email is not marked as verified/i);

    const dbDiag = classifyError(
      { code: 'invalid-argument', message: 'Document field exceeds limit' },
      { module: 'Trades Ledger', operation: 'save_trade', actionSummary: 'Save Trade' }
    );
    assert.equal(dbDiag.category, 'database');
    seenCategories.add(dbDiag.category);

    const netDiag = classifyError(new Error('Request timed out'), {
      module: 'Live Trade Logger',
      operation: 'close_trade',
      actionSummary: 'Complete & Save Trade',
      isOnline: false,
    });
    assert.equal(netDiag.category, 'network');
    assert.equal(netDiag.cloudStatus, 'pending_retry');
    seenCategories.add(netDiag.category);

    const syncDiag = classifyError(new Error('Partial sync detected while updating cloud state'), {
      module: 'Workspace Sync',
      operation: 'sync_workspace',
      actionSummary: 'Synchronise Workspace',
    });
    assert.equal(syncDiag.category, 'synchronisation');
    seenCategories.add(syncDiag.category);

    const conflictDiag = classifyError(
      { code: 'aborted', message: 'Record modified elsewhere' },
      { module: 'Live Trade Logger', operation: 'close_trade', actionSummary: 'Close Trade' }
    );
    assert.equal(conflictDiag.category, 'conflict');
    seenCategories.add(conflictDiag.category);

    const appDiag = classifyError(new TypeError('Unexpected state null reference'), {
      module: 'Application',
      operation: 'render',
      actionSummary: 'Process Action',
    });
    assert.equal(appDiag.category, 'application');
    seenCategories.add(appDiag.category);

    assert.equal(seenCategories.size, 8, 'All 8 required error categories must be exercised');
  }

  // 3. Sanitization & Diagnostic Report Privacy
  {
    const dirty =
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig_value user=trader@example.com apiKey=AIzaSyDummyKey123456789012345 password=MySecretPassword! {"exitReason":"FOMO entry at high","netPnl":450.25,"lessons":"Wait for retest"}';
    const sanitized = sanitizeTechnicalMessage(dirty);
    assert.ok(!sanitized.includes('trader@example.com'));
    assert.ok(!sanitized.includes('eyJhbGci'));
    assert.ok(!sanitized.includes('AIzaSyDummyKey'));
    assert.ok(!sanitized.includes('MySecretPassword'));
    assert.ok(!sanitized.includes('FOMO entry at high'));
    assert.ok(!sanitized.includes('450.25'));
    assert.ok(!sanitized.includes('Wait for retest'));

    const diag = classifyError(new Error(dirty), {
      module: 'Live Trade Logger',
      operation: 'close_trade',
      actionSummary: 'Complete & Save Trade',
      recordType: 'trade',
      recordId: 'trd_999',
      operationId: 'op_close_1',
      localStatus: 'saved_locally',
      cloudStatus: 'pending_retry',
    });
    const report = formatDiagnosticReport(diag);
    assert.match(report, /Correlation ID: ATK-/);
    assert.match(report, /Local Status: Saved locally \(pending cloud sync\)/);
    assert.match(report, /Cloud Status: Pending Retry/);
    assert.ok(!report.includes('trader@example.com'));
    assert.ok(!report.includes('MySecretPassword'));
  }

  // 4. Repository Payload Cleaning
  {
    const sentinel = { _methodName: 'serverTimestamp' };
    const cleaned = cleanPayload({
      id: 'trd_1',
      nullField: null,
      undefinedField: undefined,
      nanField: Number.NaN,
      infField: Number.POSITIVE_INFINITY,
      exitReason: 'a'.repeat(2500),
      lessons: 'b'.repeat(4500),
      nested: { keep: 'ok', drop: null, dropUndef: undefined },
      list: ['one', null, undefined, { x: 1, y: null }],
      updatedAt: sentinel,
    });
    assert.equal('nullField' in cleaned, false);
    assert.equal('undefinedField' in cleaned, false);
    assert.equal('nanField' in cleaned, false);
    assert.equal('infField' in cleaned, false);
    assert.equal((cleaned.exitReason as string).length, 2000);
    assert.equal((cleaned.lessons as string).length, 4000);
    assert.deepEqual(cleaned.nested, { keep: 'ok' });
    assert.deepEqual(cleaned.list, ['one', { x: 1 }]);
    assert.equal(cleaned.updatedAt, sentinel);
  }

  // 5. Financial Calculation Independence from Monetary P&L
  {
    const pctOnly = computeTradeFinancials({
      actualProfitPercent: 2.1,
      riskPercent: 1.0,
      exitOutcome: 'take_profit',
    });
    assert.equal(pctOnly.grossPnl, undefined);
    assert.equal(pctOnly.netPnl, undefined);
    assert.equal(pctOnly.realisedR, 2.1);
    assert.equal(pctOnly.result, 'win');

    const outcomeOnly = computeTradeFinancials({
      exitOutcome: 'stop_loss',
    });
    assert.equal(outcomeOnly.grossPnl, undefined);
    assert.equal(outcomeOnly.netPnl, undefined);
    assert.equal(outcomeOnly.result, 'loss');
  }

  // 6. Pending Trade Closure Inspection & Repair (exact queued record format)
  {
    assert.equal(isValidDocId('trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca'), true);
    assert.equal(isValidDocId('bad/id/with/slashes'), false);
    assert.equal(ALLOWED_TRADE_UPDATE_KEYS.has('exitReason'), true);
    assert.equal(ALLOWED_TRADE_UPDATE_KEYS.has('createdAt'), false);
    assert.equal(ALLOWED_TRADE_UPDATE_KEYS.has('sourceCreatedAt'), false);
    assert.equal(ALLOWED_TRADE_UPDATE_KEYS.has('userId'), false);

    const queuedOp: PendingOperationRecord = {
      operationId: 'op_close_xauusd_01',
      kind: 'close_trade',
      userId: 'uid_owner_1',
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
          userId: 'uid_owner_1',
          accountId: 'acc_main',
          instrument: 'XAUUSD',
          direction: 'long',
          status: 'closed',
          result: 'win',
          exitTimestamp: '2026-11-17T05:50:05.000Z',
          exitReason: 'Hit planned NY Open TP target.',
          actualOutcome: 'Clean continuation through London high.',
          grossPnl: null,
          exitPrice: Number.NaN,
          sourceUpdatedAt: '2026-11-17T05:50:05.000Z',
        },
        updateFields: [
          'id', // immutable — must be stripped
          'userId', // immutable — must be stripped
          'createdAt', // immutable — must be stripped
          'sourceCreatedAt', // immutable — must be stripped
          'status',
          'exitTimestamp',
          'exitReason',
          'actualOutcome',
          'grossPnl', // null — must be stripped without turning into 0
          'exitPrice', // NaN — must be stripped without turning into 0
          'result',
        ],
        closeEvent: {
          id: 'te_close_op_close_xauusd_01',
          userId: 'uid_owner_1',
          tradeId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
          phase: 'exit',
          eventType: 'trade_closed',
          label: 'Closed XAUUSD (WIN)',
          details: 'Hit planned NY Open TP target.',
          timestamp: '2026-11-17T05:50:05.000Z',
        },
        expectedSourceUpdatedAt: '2026-11-17T05:40:00.000Z',
      },
    };

    const inspected = inspectAndRepairPendingTradeClose(queuedOp, 'uid_owner_1');
    assert.equal(inspected.valid, true);
    assert.equal(inspected.userIdMatch, true);
    assert.equal(inspected.tradeId, 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca');
    assert.equal(inspected.isOutOfSession, false);
    assert.ok(inspected.repairedPayload);
    assert.equal('grossPnl' in inspected.repairedPayload.updatedTrade, false);
    assert.equal('exitPrice' in inspected.repairedPayload.updatedTrade, false);
    assert.equal(inspected.updateFieldKeys.includes('id'), false);
    assert.equal(inspected.updateFieldKeys.includes('userId'), false);
    assert.equal(inspected.updateFieldKeys.includes('createdAt'), false);
    assert.equal(inspected.updateFieldKeys.includes('sourceCreatedAt'), false);
    assert.equal(inspected.updateFieldKeys.includes('grossPnl'), false);
    assert.equal(inspected.updateFieldKeys.includes('exitPrice'), false);
    assert.equal(inspected.updateFieldKeys.includes('exitReason'), true);
    assert.equal(inspected.updateFieldKeys.includes('status'), true);

    const mismatchedUser = inspectAndRepairPendingTradeClose(queuedOp, 'uid_other');
    assert.equal(mismatchedUser.valid, false);
    assert.equal(mismatchedUser.userIdMatch, false);
    assert.ok(mismatchedUser.validationErrors.some((e) => /different workspace account/i.test(e)));

    const missingExitReason = inspectAndRepairPendingTradeClose(
      {
        ...queuedOp,
        payload: {
          ...(queuedOp.payload as Record<string, unknown>),
          updatedTrade: {
            ...((queuedOp.payload as { updatedTrade: Record<string, unknown> }).updatedTrade),
            exitReason: '   ',
          },
        },
      },
      'uid_owner_1'
    );
    assert.equal(missingExitReason.valid, false);
    assert.equal(missingExitReason.hasExitReason, false);
    assert.ok(missingExitReason.validationErrors.some((e) => /Exit reason is missing/i.test(e)));

    // 7. Full Firestore batch diagnostic suffix must NOT be truncated past 360 chars
    const longBatchJson = JSON.stringify({
      code: 'permission-denied',
      operationType: 'update',
      path: 'users/uid_owner_1234567890abcdef/trades/trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
      error:
        '7 PERMISSION_DENIED: Missing or insufficient permissions. [batchCount=2 batchTargets=users/uid_owner_1234567890abcdef/trades/trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca,users/uid_owner_1234567890abcdef/trade_events/te_close_op_xauusd_01 eventExists=false serverStatus=during_trade updateKeys=status,exitTimestamp,exitReason,result,postExitEmotions,mistakes,lessons,disciplineQuestions,sourceUpdatedAt,updatedAt]',
      authInfo: { userId: 'uid_owner_1234567890abcdef', emailVerified: true },
    });
    const longDiag = classifyError(new Error(longBatchJson), {
      module: 'Cloud Vault Sync',
      operation: 'retryPendingOperation',
      actionSummary: 'Pending sync failed (Close LONG XAUUSD)',
      recordType: 'trade',
      recordId: 'trd_4df17b20-eb77-47cf-a1e3-6afacc8549ca',
      operationId: 'op_close_xauusd_01',
      localStatus: 'saved_locally',
      cloudStatus: 'failed',
    });
    assert.match(longDiag.safeTechnicalMessage, /batchTargets=/);
    assert.match(longDiag.safeTechnicalMessage, /serverStatus=during_trade/);
    assert.match(longDiag.safeTechnicalMessage, /updateKeys=status,exitTimestamp,exitReason/);

    const queueReport = formatPendingOperationDiagnosticReport(
      queuedOp,
      inspected,
      longDiag,
      'during_trade'
    );
    assert.match(queueReport, /Batch Targets \(2\):/);
    assert.match(queueReport, /Original Trade Status -> Intended Status: during_trade -> closed/);
    assert.match(queueReport, /Update Keys \(/);

    // 8. Legacy queued operation missing updateFields array still includes closed fields
    const noFieldsOp: PendingOperationRecord = {
      ...queuedOp,
      payload: {
        updatedTrade: (queuedOp.payload as { updatedTrade: Record<string, unknown> }).updatedTrade,
        closeEvent: (queuedOp.payload as { closeEvent: Record<string, unknown> }).closeEvent,
      },
    };
    const noFieldsInspected = inspectAndRepairPendingTradeClose(noFieldsOp, 'uid_owner_1');
    assert.equal(noFieldsInspected.valid, true);
    assert.equal(noFieldsInspected.updateFieldKeys.includes('actualOutcome'), true);
    assert.equal(noFieldsInspected.updateFieldKeys.includes('exitReason'), true);

    // 9. Empty strings in optional enum/ID fields must be stripped before Firestore rules evaluation
    const emptyEnumOp: PendingOperationRecord = {
      ...queuedOp,
      payload: {
        updatedTrade: {
          ...(queuedOp.payload as { updatedTrade: Record<string, unknown> }).updatedTrade,
          tpOutcome: '',
          slOutcome: '',
          exitOutcome: '',
        },
        updateFields: ['status', 'exitTimestamp', 'exitReason', 'result', 'tpOutcome', 'slOutcome', 'exitOutcome'],
        closeEvent: (queuedOp.payload as { closeEvent: Record<string, unknown> }).closeEvent,
      },
    };
    const emptyEnumInspected = inspectAndRepairPendingTradeClose(emptyEnumOp, 'uid_owner_1');
    assert.equal(emptyEnumInspected.valid, true);
    assert.equal('tpOutcome' in (emptyEnumInspected.repairedPayload?.updatedTrade || {}), false);
    assert.equal('slOutcome' in (emptyEnumInspected.repairedPayload?.updatedTrade || {}), false);
    assert.equal('exitOutcome' in (emptyEnumInspected.repairedPayload?.updatedTrade || {}), false);
  }

  console.log('ALL TRADE CLOSURE & DIAGNOSTICS VERIFICATION CHECKS PASSED.');
}

runTests();
