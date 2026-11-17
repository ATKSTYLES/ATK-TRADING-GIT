import { generateId } from './defaults';

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'permission'
  | 'database'
  | 'network'
  | 'synchronisation'
  | 'conflict'
  | 'application';

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  validation: 'Validation Error',
  authentication: 'Authentication Error',
  permission: 'Permission / Access Error',
  database: 'Database Error',
  network: 'Network / Connectivity Error',
  synchronisation: 'Synchronisation Error',
  conflict: 'Conflict Error',
  application: 'Application Error',
};

export type LocalStatus =
  | 'saved_locally'
  | 'preserved_in_form'
  | 'not_modified'
  | 'unavailable';

export type CloudStatus =
  | 'synced'
  | 'failed'
  | 'pending_retry'
  | 'unverified';

export type ResolutionStatus =
  | 'unresolved'
  | 'retried'
  | 'resolved'
  | 'dismissed';

export type PendingOperationStatus =
  | 'pending'
  | 'processing'
  | 'synced'
  | 'failed'
  | 'conflict'
  | 'requires_attention';

export interface DiagnosticAttemptEntry {
  correlationId: string;
  timestamp: string;
  errorCode: string;
  category: ErrorCategory;
  userExplanation: string;
  safeTechnicalMessage: string;
  cloudStatus: CloudStatus;
}

export interface DiagnosticErrorSnapshot {
  correlationId: string;
  timestamp: string;
  errorCode: string;
  category: ErrorCategory;
  userExplanation: string;
  safeTechnicalMessage: string;
}

export interface DiagnosticRecord {
  id: string;
  correlationId: string;
  timestamp: string;
  module: string;
  operation: string;
  actionSummary: string;
  recordType?: string;
  recordId?: string;
  workspaceId?: string;
  category: ErrorCategory;
  errorCode: string;
  safeTechnicalMessage: string;
  userExplanation: string;
  recommendedAction: string;
  retryable: boolean;
  localStatus: LocalStatus;
  cloudStatus: CloudStatus;
  resolutionStatus: ResolutionStatus;
  operationId?: string;
  fieldErrors?: Record<string, string>;
  // Grouped attempt history metadata (Part 8)
  attemptCount?: number;
  originalError?: DiagnosticErrorSnapshot;
  latestError?: DiagnosticErrorSnapshot;
  attemptHistory?: DiagnosticAttemptEntry[];
}

export interface PendingTradeClosePayload {
  updatedTrade: Record<string, unknown>;
  updateFields: string[];
  closeEvent: Record<string, unknown>;
  expectedSourceUpdatedAt?: string;
}

export interface PendingTradeCloseInspection {
  valid: boolean;
  validationErrors: string[];
  tradeId: string;
  userIdMatch: boolean;
  sessionId?: string;
  isOutOfSession: boolean;
  intendedStatus: string;
  intendedResult: string;
  exitTimestamp?: string;
  hasExitReason: boolean;
  updateFieldKeys: string[];
  closeEventId?: string;
  batchTargets: string[];
  expectedSourceUpdatedAt?: string;
  closeEventPhase?: string;
  closeEventType?: string;
  repairedPayload?: PendingTradeClosePayload;
}

export interface PendingAttemptEntry {
  timestamp: string;
  correlationId?: string;
  errorCode?: string;
  category?: ErrorCategory;
  summary: string;
  status: PendingOperationStatus;
}

export interface PendingOperationRecord {
  operationId: string;
  kind: 'close_trade';
  userId: string;
  workspaceId?: string;
  recordId: string;
  recordType?: 'trade' | 'session' | 'daily_journal' | 'review';
  operationType?: 'create' | 'update' | 'delete';
  status?: PendingOperationStatus;
  createdAt: string;
  lastAttemptAt: string;
  attemptCount: number;
  summary: string;
  payload: unknown;
  lastErrorCode?: string;
  lastErrorCategory?: ErrorCategory;
  lastCorrelationId?: string;
  lastErrorSummary?: string;
  attemptHistory?: PendingAttemptEntry[];
  syncedAt?: string;
}

export class StructuredAppError extends Error {
  readonly category: ErrorCategory;
  readonly errorCode: string;
  readonly userExplanation: string;
  readonly recommendedAction: string;
  readonly retryable: boolean;
  readonly fieldErrors?: Record<string, string>;
  readonly operationId?: string;
  readonly cloudStatus?: CloudStatus;

  constructor(params: {
    message: string;
    category: ErrorCategory;
    errorCode: string;
    userExplanation: string;
    recommendedAction: string;
    retryable?: boolean;
    fieldErrors?: Record<string, string>;
    operationId?: string;
    cloudStatus?: CloudStatus;
  }) {
    super(params.message);
    this.name = 'StructuredAppError';
    this.category = params.category;
    this.errorCode = params.errorCode;
    this.userExplanation = params.userExplanation;
    this.recommendedAction = params.recommendedAction;
    this.retryable = params.retryable ?? false;
    this.fieldErrors = params.fieldErrors;
    this.operationId = params.operationId;
    this.cloudStatus = params.cloudStatus;
  }
}

export interface TradeClosureValidationInput {
  exitReason: string;
  actualOutcome?: string;
  lessons?: string;
  actualProfitPercentText?: string;
  grossPnlText?: string;
  commissionText?: string;
  otherChargesText?: string;
  exitPriceText?: string;
}

export interface TradeClosureValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  summaryMessage?: string;
  parsed: {
    exitReason: string;
    actualOutcome?: string;
    lessons: string;
    actualProfitPercent?: number;
    grossPnl?: number;
    commission?: number;
    otherCharges?: number;
    exitPrice?: number;
  };
}

function parseOptionalFiniteNumber(
  raw: string | undefined,
  fieldKey: string,
  label: string,
  errors: Record<string, string>
): number | undefined {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    errors[fieldKey] = `${label} must be a valid number, or leave it blank if unrecorded.`;
    return undefined;
  }
  return num;
}

export function validateTradeClosureInput(
  input: TradeClosureValidationInput
): TradeClosureValidationResult {
  const fieldErrors: Record<string, string> = {};
  const trimmedReason = input.exitReason.trim();
  const trimmedOutcome = (input.actualOutcome ?? '').trim();
  const trimmedLessons = (input.lessons ?? '').trim();

  if (!trimmedReason) {
    fieldErrors.exitReason = 'Trade could not be closed because an exit reason is required.';
  } else if (trimmedReason.length > 2000) {
    fieldErrors.exitReason = 'Exit reason must be 2000 characters or fewer.';
  }

  if (trimmedOutcome.length > 2000) {
    fieldErrors.actualOutcome = 'Actual outcome notes must be 2000 characters or fewer.';
  }

  if (trimmedLessons.length > 4000) {
    fieldErrors.lessons = 'Lessons learned must be 4000 characters or fewer.';
  }

  const actualProfitPercent = parseOptionalFiniteNumber(
    input.actualProfitPercentText,
    'actualProfitPercent',
    'Actual Profit %',
    fieldErrors
  );
  const grossPnl = parseOptionalFiniteNumber(
    input.grossPnlText,
    'grossPnl',
    'Gross P&L',
    fieldErrors
  );
  const commission = parseOptionalFiniteNumber(
    input.commissionText,
    'commission',
    'Commission',
    fieldErrors
  );
  const otherCharges = parseOptionalFiniteNumber(
    input.otherChargesText,
    'otherCharges',
    'Other Charges',
    fieldErrors
  );
  const exitPrice = parseOptionalFiniteNumber(
    input.exitPriceText,
    'exitPrice',
    'Exit Price',
    fieldErrors
  );

  const errorKeys = Object.keys(fieldErrors);
  const valid = errorKeys.length === 0;

  return {
    valid,
    fieldErrors,
    summaryMessage: valid
      ? undefined
      : fieldErrors.exitReason ||
        fieldErrors[errorKeys[0]] ||
        'Please review the highlighted fields before closing the trade.',
    parsed: {
      exitReason: trimmedReason,
      actualOutcome: trimmedOutcome || undefined,
      lessons: trimmedLessons,
      actualProfitPercent,
      grossPnl,
      commission,
      otherCharges,
      exitPrice,
    },
  };
}

export function createCorrelationId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  return `ATK-${stamp}-${rand}`;
}

export function sanitizeTechnicalMessage(raw: string): string {
  if (!raw) return 'No technical details provided.';
  let cleaned = raw;

  // Remove Bearer / JWT tokens
  cleaned = cleaned.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  cleaned = cleaned.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
    '[REDACTED_TOKEN]'
  );

  // Remove API keys and secret assignments
  cleaned = cleaned.replace(/\bAIza[0-9A-Za-z\-_]{16,}\b/g, '[REDACTED_API_KEY]');
  cleaned = cleaned.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|authorization)\s*[:=]\s*["']?[^\s"',;}]+["']?/gi,
    '$1=[REDACTED]'
  );

  // Redact email addresses
  cleaned = cleaned.replace(
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    '[redacted-email]'
  );

  // Redact sensitive user-journal/financial payload fragments if ever serialized
  cleaned = cleaned.replace(
    /"(exitReason|entryReason|lessons|morningNotes|closingReflection|grossPnl|netPnl|commission|otherCharges|exitPrice|entryPrice)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/gi,
    '"$1":"[REDACTED_USER_DATA]"'
  );

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 2000) {
    cleaned = `${cleaned.slice(0, 1997)}...`;
  }
  return cleaned;
}

interface ParsedFirestoreErrorJson {
  error?: string;
  code?: string;
  operationType?: string;
  path?: string | null;
  authInfo?: {
    userId?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

function tryParseFirestoreJson(raw: string): ParsedFirestoreErrorJson | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as ParsedFirestoreErrorJson;
    if (parsed && typeof parsed.error === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractRawCodeAndMessage(err: unknown): {
  code: string;
  rawMessage: string;
  firestoreInfo: ParsedFirestoreErrorJson | null;
} {
  let code = '';
  let rawMessage = '';

  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
    code = (err as { code: string }).code;
  }

  if (err instanceof Error) {
    rawMessage = err.message || err.name;
  } else if (typeof err === 'string') {
    rawMessage = err;
  } else {
    try {
      rawMessage = JSON.stringify(err);
    } catch {
      rawMessage = String(err);
    }
  }

  const firestoreInfo = tryParseFirestoreJson(rawMessage);
  if (firestoreInfo?.code && !code) {
    code = firestoreInfo.code;
  }
  if (firestoreInfo?.error) {
    rawMessage = firestoreInfo.error;
  }

  return { code: code.toLowerCase(), rawMessage, firestoreInfo };
}

export interface ClassifyErrorContext {
  module: string;
  operation: string;
  actionSummary: string;
  recordType?: string;
  recordId?: string;
  workspaceId?: string;
  operationId?: string;
  localStatus?: LocalStatus;
  cloudStatus?: CloudStatus;
  isOnline?: boolean;
  emailVerified?: boolean | null;
}

export function classifyError(err: unknown, ctx: ClassifyErrorContext): DiagnosticRecord {
  const correlationId = createCorrelationId();
  const timestamp = new Date().toISOString();
  const localStatus: LocalStatus = ctx.localStatus ?? 'preserved_in_form';

  if (err instanceof StructuredAppError) {
    return {
      id: generateId('diag'),
      correlationId,
      timestamp,
      module: ctx.module,
      operation: ctx.operation,
      actionSummary: ctx.actionSummary,
      recordType: ctx.recordType,
      recordId: ctx.recordId,
      workspaceId: ctx.workspaceId,
      category: err.category,
      errorCode: err.errorCode,
      safeTechnicalMessage: sanitizeTechnicalMessage(err.message),
      userExplanation: err.userExplanation,
      recommendedAction: err.recommendedAction,
      retryable: err.retryable,
      localStatus,
      cloudStatus: err.cloudStatus ?? ctx.cloudStatus ?? (err.category === 'validation' ? 'unverified' : 'failed'),
      resolutionStatus: 'unresolved',
      operationId: err.operationId ?? ctx.operationId,
      fieldErrors: err.fieldErrors,
    };
  }

  const { code, rawMessage, firestoreInfo } = extractRawCodeAndMessage(err);
  const lower = rawMessage.toLowerCase();
  const browserOffline =
    ctx.isOnline === false ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);

  const pathSnippet = firestoreInfo?.path ? ` (${firestoreInfo.path})` : '';
  const opSnippet = firestoreInfo?.operationType ? `${firestoreInfo.operationType}` : ctx.operation;

  let category: ErrorCategory = 'application';
  let errorCode = code || 'APP_UNKNOWN_ERROR';
  let userExplanation = 'An unexpected issue interrupted this action.';
  let recommendedAction = 'Review your entered details and click Retry Save, or copy diagnostics if this persists.';
  let retryable = true;
  let cloudStatus: CloudStatus = ctx.cloudStatus ?? 'failed';

  const unverifiedEmail =
    ctx.emailVerified === false || firestoreInfo?.authInfo?.emailVerified === false;

  if (
    code.startsWith('auth/') ||
    code === 'unauthenticated' ||
    lower.includes('not authenticated') ||
    lower.includes('unauthenticated') ||
    lower.includes('requires-recent-login') ||
    lower.includes('popup-closed-by-user') ||
    lower.includes('popup-blocked')
  ) {
    category = 'authentication';
    errorCode = code || 'AUTH_SESSION_INVALID';
    userExplanation =
      lower.includes('popup')
        ? 'Google sign-in popup was closed or blocked by the browser before authentication completed.'
        : 'Your authentication session is missing or expired, so Cloud Vault could not verify your identity.';
    recommendedAction =
      lower.includes('popup')
        ? 'Allow popups for this site and try signing in again.'
        : 'Sign in again to refresh your session, then retry saving.';
    retryable = !lower.includes('popup');
    cloudStatus = 'unverified';
  } else if (
    browserOffline ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'network-request-failed' ||
    lower.includes('client is offline') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  ) {
    category = 'network';
    errorCode = code || (browserOffline ? 'NETWORK_OFFLINE' : 'NETWORK_UNAVAILABLE');
    userExplanation = browserOffline
      ? 'Your device appears offline, so Cloud Vault could not be reached.'
      : 'Network connection to Cloud Vault timed out or was interrupted.';
    recommendedAction =
      'Check your internet connection and click Retry Save. Your form details remain intact.';
    retryable = true;
    cloudStatus = 'pending_retry';
  } else if (
    code === 'permission-denied' ||
    lower.includes('missing or insufficient permissions') ||
    lower.includes('permission_denied') ||
    lower.includes('insufficient permissions')
  ) {
    category = 'permission';
    errorCode = code || 'PERMISSION_DENIED';
    if (unverifiedEmail) {
      userExplanation =
        'Your Google account email is not marked as verified, so Cloud Vault rejected the write.';
      recommendedAction =
        'Verify your account email or sign in with a verified Google account, then retry.';
    } else {
      userExplanation =
        'Cloud Vault rejected this update because a permission or record-validation check failed on the server.';
      recommendedAction =
        'Verify you are signed in to the same workspace owner account and click Retry Save. If it repeats, copy diagnostics.';
    }
    retryable = true;
    cloudStatus = ctx.cloudStatus ?? 'failed';
  } else if (
    code === 'aborted' ||
    lower.includes('conflict') ||
    lower.includes('modified elsewhere') ||
    lower.includes('stale')
  ) {
    category = 'conflict';
    errorCode = code || 'RECORD_CONFLICT';
    userExplanation = 'This record was modified elsewhere before your save completed.';
    recommendedAction = 'Reload workspace data to inspect the latest cloud record before saving again.';
    retryable = false;
    cloudStatus = 'unverified';
  } else if (
    lower.includes('synchronisation') ||
    lower.includes('synchronization') ||
    lower.includes('partial sync') ||
    lower.includes('sync')
  ) {
    category = 'synchronisation';
    errorCode = code || 'SYNC_INCOMPLETE';
    userExplanation = 'Local data could not finish synchronising cleanly with Cloud Vault.';
    recommendedAction = 'Retry synchronisation to reconcile local and cloud state.';
    retryable = true;
    cloudStatus = 'pending_retry';
  } else if (
    lower.includes('validation') ||
    lower.includes('required') ||
    lower.includes('must be')
  ) {
    category = 'validation';
    errorCode = code || 'VALIDATION_ERROR';
    userExplanation = sanitizeTechnicalMessage(rawMessage);
    recommendedAction = 'Fix the highlighted input fields and try again.';
    retryable = false;
    cloudStatus = 'unverified';
  } else if (
    firestoreInfo !== null ||
    [
      'not-found',
      'already-exists',
      'invalid-argument',
      'failed-precondition',
      'resource-exhausted',
      'data-loss',
      'internal',
    ].includes(code) ||
    lower.includes('firestore') ||
    lower.includes('document')
  ) {
    category = 'database';
    errorCode = code || 'FIRESTORE_WRITE_FAILED';
    if (code === 'not-found' || lower.includes('no document to update')) {
      userExplanation = 'The target record could not be found in Cloud Vault.';
      recommendedAction = 'Reload workspace data to verify whether the record still exists.';
      retryable = false;
    } else if (code === 'invalid-argument') {
      userExplanation = 'One or more fields contain unsupported formatting or exceed Cloud Vault limits.';
      recommendedAction = 'Review numeric values and note lengths, then retry saving.';
      retryable = true;
    } else {
      userExplanation = `Cloud Vault could not complete the database ${opSnippet}${pathSnippet ? ' operation' : ''}.`;
      recommendedAction = 'Click Retry Save. Your entered values remain preserved.';
      retryable = true;
    }
    cloudStatus = ctx.cloudStatus ?? 'failed';
  } else {
    category = 'application';
    errorCode = code || (err instanceof Error ? err.name.toUpperCase() : 'APP_RUNTIME_ERROR');
    userExplanation = 'An unexpected application error prevented this action from completing.';
    recommendedAction = 'Retry the action or reload the page if the issue persists.';
    retryable = true;
    cloudStatus = ctx.cloudStatus ?? 'failed';
  }

  const techParts = [
    code ? `code=${code}` : null,
    firestoreInfo?.operationType ? `op=${firestoreInfo.operationType}` : null,
    firestoreInfo?.path ? `path=${firestoreInfo.path}` : null,
    rawMessage ? `detail=${rawMessage}` : null,
  ].filter(Boolean);

  const initialSnapshot: DiagnosticErrorSnapshot = {
    correlationId,
    timestamp,
    errorCode,
    category,
    userExplanation,
    safeTechnicalMessage: sanitizeTechnicalMessage(techParts.join(' | ')),
  };

  return {
    id: generateId('diag'),
    correlationId,
    timestamp,
    module: ctx.module,
    operation: ctx.operation,
    actionSummary: ctx.actionSummary,
    recordType: ctx.recordType,
    recordId: ctx.recordId,
    workspaceId: ctx.workspaceId,
    category,
    errorCode,
    safeTechnicalMessage: initialSnapshot.safeTechnicalMessage,
    userExplanation,
    recommendedAction,
    retryable,
    localStatus,
    cloudStatus,
    resolutionStatus: 'unresolved',
    operationId: ctx.operationId,
    attemptCount: 1,
    originalError: initialSnapshot,
    latestError: initialSnapshot,
    attemptHistory: [
      {
        ...initialSnapshot,
        cloudStatus,
      },
    ],
  };
}

export function formatLocalStatusLabel(status: LocalStatus): string {
  switch (status) {
    case 'saved_locally':
      return 'Saved locally (pending cloud sync)';
    case 'preserved_in_form':
      return 'Preserved in active form';
    case 'not_modified':
      return 'Not modified';
    case 'unavailable':
      return 'Local persistence unavailable';
  }
}

export function formatCloudStatusLabel(status: CloudStatus): string {
  switch (status) {
    case 'synced':
      return 'Synced to Cloud Vault';
    case 'pending_retry':
      return 'Pending Retry';
    case 'failed':
      return 'Failed (not synced)';
    case 'unverified':
      return 'Unverified';
  }
}

export function formatPendingStatusLabel(status?: PendingOperationStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'processing':
      return 'Processing';
    case 'synced':
      return 'Synced';
    case 'failed':
      return 'Failed';
    case 'conflict':
      return 'Conflict';
    case 'requires_attention':
      return 'Requires Attention';
    default:
      return 'Pending';
  }
}

export function pendingStatusForCategory(cat: ErrorCategory): PendingOperationStatus {
  if (cat === 'conflict') return 'conflict';
  if (cat === 'permission' || cat === 'validation' || cat === 'authentication') {
    return 'requires_attention';
  }
  return 'failed';
}

export const MAX_AUTO_SYNC_ATTEMPTS = 5;

export function shouldAutoRetryPendingOp(op: PendingOperationRecord): boolean {
  const status = op.status ?? 'pending';
  if (status === 'synced' || status === 'processing' || status === 'conflict' || status === 'requires_attention') {
    return false;
  }
  const cat = op.lastErrorCategory;
  if (cat === 'permission' || cat === 'validation' || cat === 'authentication' || cat === 'conflict') {
    return false;
  }
  if (status === 'failed' && op.attemptCount >= MAX_AUTO_SYNC_ATTEMPTS) {
    return false;
  }
  return true;
}

export function normalizePendingOperation(raw: PendingOperationRecord): PendingOperationRecord {
  const inferredStatus: PendingOperationStatus =
    raw.status ??
    (raw.lastErrorCategory
      ? pendingStatusForCategory(raw.lastErrorCategory)
      : raw.lastErrorSummary && /permission|access error|validation/i.test(raw.lastErrorSummary)
      ? 'requires_attention'
      : raw.lastErrorSummary && /conflict/i.test(raw.lastErrorSummary)
      ? 'conflict'
      : raw.attemptCount > 0 && raw.lastErrorSummary
      ? 'failed'
      : 'pending');

  const inferredCategory: ErrorCategory | undefined =
    raw.lastErrorCategory ??
    (raw.lastErrorSummary && /permission|access error/i.test(raw.lastErrorSummary)
      ? 'permission'
      : raw.lastErrorSummary && /validation|required/i.test(raw.lastErrorSummary)
      ? 'validation'
      : raw.lastErrorSummary && /conflict/i.test(raw.lastErrorSummary)
      ? 'conflict'
      : raw.lastErrorSummary && /offline|network|timed out/i.test(raw.lastErrorSummary)
      ? 'network'
      : undefined);

  return {
    ...raw,
    workspaceId: raw.workspaceId || raw.userId,
    recordType: raw.recordType || 'trade',
    operationType: raw.operationType || 'update',
    status: inferredStatus,
    ...(inferredCategory ? { lastErrorCategory: inferredCategory } : {}),
    attemptHistory: Array.isArray(raw.attemptHistory)
      ? raw.attemptHistory
      : raw.attemptCount > 0 && raw.lastErrorSummary
      ? [
          {
            timestamp: raw.lastAttemptAt || raw.createdAt,
            correlationId: raw.lastCorrelationId,
            errorCode: raw.lastErrorCode,
            category: inferredCategory,
            summary: raw.lastErrorSummary,
            status: inferredStatus,
          },
        ]
      : [],
  };
}

export function upsertGroupedDiagnostic(
  history: DiagnosticRecord[],
  incoming: DiagnosticRecord
): DiagnosticRecord[] {
  const existingIdx = history.findIndex((item) => {
    if (item.resolutionStatus === 'resolved' || item.resolutionStatus === 'dismissed') {
      return false;
    }
    if (incoming.operationId && item.operationId && item.operationId === incoming.operationId) {
      // Group repeated attempts for the same operation unless failure shifted to a materially different error code & category
      return (
        item.category === incoming.category &&
        (item.errorCode === incoming.errorCode || item.operation === 'retryPendingOperation' || incoming.operation === 'retryPendingOperation')
      );
    }
    if (incoming.recordId && item.recordId === incoming.recordId) {
      return (
        item.module === incoming.module &&
        item.operation === incoming.operation &&
        item.category === incoming.category &&
        item.errorCode === incoming.errorCode
      );
    }
    return false;
  });

  if (existingIdx < 0) {
    const snap: DiagnosticErrorSnapshot = incoming.originalError ?? {
      correlationId: incoming.correlationId,
      timestamp: incoming.timestamp,
      errorCode: incoming.errorCode,
      category: incoming.category,
      userExplanation: incoming.userExplanation,
      safeTechnicalMessage: incoming.safeTechnicalMessage,
    };
    const prepared: DiagnosticRecord = {
      ...incoming,
      attemptCount: incoming.attemptCount ?? 1,
      originalError: snap,
      latestError: incoming.latestError ?? snap,
      attemptHistory:
        incoming.attemptHistory && incoming.attemptHistory.length > 0
          ? incoming.attemptHistory
          : [{ ...snap, cloudStatus: incoming.cloudStatus }],
    };
    return [prepared, ...history].slice(0, 60);
  }

  const prev = history[existingIdx];
  const firstSnapshot: DiagnosticErrorSnapshot = prev.originalError ?? {
    correlationId: prev.correlationId,
    timestamp: prev.timestamp,
    errorCode: prev.errorCode,
    category: prev.category,
    userExplanation: prev.userExplanation,
    safeTechnicalMessage: prev.safeTechnicalMessage,
  };
  const latestSnapshot: DiagnosticErrorSnapshot = {
    correlationId: incoming.correlationId,
    timestamp: incoming.timestamp,
    errorCode: incoming.errorCode,
    category: incoming.category,
    userExplanation: incoming.userExplanation,
    safeTechnicalMessage: incoming.safeTechnicalMessage,
  };
  const prevHistory: DiagnosticAttemptEntry[] =
    prev.attemptHistory && prev.attemptHistory.length > 0
      ? prev.attemptHistory
      : [{ ...firstSnapshot, cloudStatus: prev.cloudStatus }];

  const grouped: DiagnosticRecord = {
    ...prev,
    ...incoming,
    id: prev.id,
    attemptCount: (prev.attemptCount ?? prevHistory.length ?? 1) + 1,
    originalError: firstSnapshot,
    latestError: latestSnapshot,
    attemptHistory: [
      ...prevHistory,
      { ...latestSnapshot, cloudStatus: incoming.cloudStatus },
    ].slice(-20),
  };

  const remaining = history.filter((_, idx) => idx !== existingIdx);
  return [grouped, ...remaining].slice(0, 60);
}

export function formatDiagnosticReport(record: DiagnosticRecord): string {
  const attemptCount = record.attemptCount ?? 1;
  return [
    `ATK Deck Diagnostic Report`,
    `Correlation ID: ${record.correlationId}`,
    `Timestamp: ${record.timestamp}`,
    `Category: ${ERROR_CATEGORY_LABELS[record.category]} (${record.category})`,
    `Error Code: ${record.errorCode}`,
    `Module / Operation: ${record.module} / ${record.operation}`,
    `Action: ${record.actionSummary}`,
    record.recordType || record.recordId
      ? `Record: ${record.recordType || 'unknown'} (${record.recordId || 'n/a'})`
      : null,
    record.operationId ? `Operation ID: ${record.operationId}` : null,
    attemptCount > 1 ? `Attempts: ${attemptCount}` : null,
    record.originalError && attemptCount > 1
      ? `Original Error (${record.originalError.timestamp}): ${record.originalError.errorCode} — ${record.originalError.userExplanation}`
      : null,
    `Local Status: ${formatLocalStatusLabel(record.localStatus)}`,
    `Cloud Status: ${formatCloudStatusLabel(record.cloudStatus)}`,
    `Resolution: ${record.resolutionStatus}`,
    `Explanation: ${record.userExplanation}`,
    `Recommended Action: ${record.recommendedAction}`,
    `Technical Detail (Sanitized): ${record.safeTechnicalMessage}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatPendingOperationDiagnosticReport(
  op: PendingOperationRecord,
  inspection: PendingTradeCloseInspection,
  matchingDiag?: DiagnosticRecord | null,
  originalTradeStatus?: string
): string {
  const lines = [
    `ATK Deck Pending Sync Diagnostic Report`,
    `Operation ID: ${op.operationId}`,
    `Workspace ID: ${op.workspaceId || op.userId}`,
    `User ID: ${op.userId}`,
    `Record Type / Operation Type: ${op.recordType || 'trade'} / ${op.operationType || 'update'}`,
    `Record ID: ${inspection.tradeId || op.recordId}`,
    `Summary: ${op.summary}`,
    `Queue Status: ${formatPendingStatusLabel(op.status)}`,
    `Attempts: ${op.attemptCount}`,
    `Last Attempt: ${op.lastAttemptAt}`,
    `Last Error Code: ${op.lastErrorCode || matchingDiag?.errorCode || 'n/a'}`,
    `Last Error Category: ${op.lastErrorCategory || matchingDiag?.category || 'n/a'}`,
    `Last Correlation ID: ${op.lastCorrelationId || matchingDiag?.correlationId || 'n/a'}`,
    `User / Owner Match: ${inspection.userIdMatch ? 'Matched' : 'Mismatch'}`,
    `Original Trade Status -> Intended Status: ${originalTradeStatus || 'unknown'} -> ${inspection.intendedStatus} (${inspection.intendedResult})`,
    `Session Linkage: ${inspection.isOutOfSession ? 'Out-of-Session' : inspection.sessionId || 'Out-of-Session'}`,
    `Batch Targets (${inspection.batchTargets.length}): ${inspection.batchTargets.join(' , ')}`,
    `Update Keys (${inspection.updateFieldKeys.length}): ${inspection.updateFieldKeys.join(', ') || 'none'}`,
    `Close Event: ${inspection.closeEventId || 'n/a'} (${inspection.closeEventPhase || 'exit'} / ${inspection.closeEventType || 'trade_closed'})`,
    `Expected Source Updated At: ${inspection.expectedSourceUpdatedAt || 'none'}`,
    `Payload Validation: ${inspection.valid ? 'Valid' : `Invalid (${inspection.validationErrors.join('; ')})`}`,
    `Local Status: Saved locally (pending cloud sync)`,
    `Cloud Status: Failed (not synced)`,
    op.lastErrorSummary ? `Last Error Summary: ${op.lastErrorSummary}` : null,
    matchingDiag?.safeTechnicalMessage
      ? `Sanitized Technical Detail: ${matchingDiag.safeTechnicalMessage}`
      : null,
    op.attemptHistory && op.attemptHistory.length > 0
      ? `Attempt History:\n${op.attemptHistory
          .map(
            (h, idx) =>
              `  #${idx + 1} [${h.timestamp}] [${formatPendingStatusLabel(h.status)}] ${h.errorCode || ''} (${h.correlationId || 'no-ref'}) — ${h.summary}`
          )
          .join('\n')}`
      : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function diagStorageKey(userId: string): string {
  return `atk_deck_diagnostics_v1_${userId}`;
}

function pendingOpsStorageKey(userId: string): string {
  return `atk_deck_pending_ops_v1_${userId}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadDiagnosticHistory(userId: string): DiagnosticRecord[] {
  if (!userId || !hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(diagStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagnosticRecord[]) : [];
  } catch {
    return [];
  }
}

export function persistDiagnosticHistory(userId: string, records: DiagnosticRecord[]): boolean {
  if (!userId || !hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(diagStorageKey(userId), JSON.stringify(records.slice(0, 60)));
    return true;
  } catch {
    return false;
  }
}

export function loadPendingOperations(userId: string): PendingOperationRecord[] {
  if (!userId || !hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(pendingOpsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as PendingOperationRecord[]).map((item) => normalizePendingOperation(item));
  } catch {
    return [];
  }
}

export function savePendingOperation(
  userId: string,
  op: PendingOperationRecord
): { savedLocally: boolean; list: PendingOperationRecord[] } {
  const existing = loadPendingOperations(userId);
  const normalized = normalizePendingOperation(op);
  const idx = existing.findIndex((item) => item.operationId === normalized.operationId);
  const next = [...existing];
  if (idx >= 0) {
    next[idx] = normalized;
  } else {
    next.unshift(normalized);
  }
  const trimmed = next.slice(0, 25);
  if (!userId || !hasLocalStorage()) {
    return { savedLocally: false, list: trimmed };
  }
  try {
    window.localStorage.setItem(pendingOpsStorageKey(userId), JSON.stringify(trimmed));
    return { savedLocally: true, list: trimmed };
  } catch {
    return { savedLocally: false, list: trimmed };
  }
}

export function removePendingOperation(
  userId: string,
  operationId: string
): PendingOperationRecord[] {
  const existing = loadPendingOperations(userId);
  const next = existing.filter((item) => item.operationId !== operationId);
  if (userId && hasLocalStorage()) {
    try {
      window.localStorage.setItem(pendingOpsStorageKey(userId), JSON.stringify(next));
    } catch {
      // Ignore storage quota/access errors during cleanup
    }
  }
  return next;
}

const DOC_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidDocId(id: unknown): id is string {
  return typeof id === 'string' && DOC_ID_PATTERN.test(id);
}

export const ALLOWED_TRADE_UPDATE_KEYS = new Set<string>([
  'tradeGroupId',
  'date',
  'timezone',
  'sessionId',
  'isOutOfSession',
  'accountId',
  'instrument',
  'market',
  'direction',
  'status',
  'bias',
  'timeframe',
  'entryType',
  'setupLabel',
  'entryTimestamp',
  'entryPrice',
  'stopLoss',
  'takeProfit',
  'positionSize',
  'plannedRisk',
  'riskPercent',
  'expectedProfitPercent',
  'actualProfitPercent',
  'tpOutcome',
  'slOutcome',
  'exitOutcome',
  'entryReason',
  'expectedOutcome',
  'preEntryEmotion',
  'confidence',
  'antiBiasPauseCompleted',
  'duringTradeDurationSeconds',
  'exitTimestamp',
  'exitPrice',
  'exitReason',
  'actualOutcome',
  'grossPnl',
  'commission',
  'otherCharges',
  'netPnl',
  'realisedR',
  'result',
  'postExitEmotions',
  'mistakes',
  'lessons',
  'disciplineQuestions',
  'attachmentIds',
  'sourceUpdatedAt',
  'unknownFields',
]);

function stripInvalidOptionalValues(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (Array.isArray(v)) {
      out[k] = v.filter((item) => typeof item === 'string' && item.trim() !== '');
      continue;
    }
    if (typeof v === 'object') {
      out[k] = stripInvalidOptionalValues(v as Record<string, unknown>);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function inspectAndRepairPendingTradeClose(
  op: PendingOperationRecord,
  currentUid?: string | null
): PendingTradeCloseInspection {
  const validationErrors: string[] = [];
  const rawPayload = (op.payload && typeof op.payload === 'object' ? op.payload : {}) as Partial<PendingTradeClosePayload>;
  const rawTrade =
    rawPayload.updatedTrade && typeof rawPayload.updatedTrade === 'object'
      ? (rawPayload.updatedTrade as Record<string, unknown>)
      : {};
  const rawEvent =
    rawPayload.closeEvent && typeof rawPayload.closeEvent === 'object'
      ? (rawPayload.closeEvent as Record<string, unknown>)
      : {};

  const tradeId = typeof rawTrade.id === 'string' ? rawTrade.id : op.recordId;
  const userIdMatch =
    (!currentUid || (op.userId === currentUid && (!rawTrade.userId || rawTrade.userId === currentUid))) &&
    Boolean(op.userId);

  if (!isValidDocId(tradeId)) {
    validationErrors.push('Trade ID is missing or contains unsupported characters.');
  }
  if (!userIdMatch) {
    validationErrors.push('Pending operation belongs to a different workspace account.');
  }

  const exitReason = typeof rawTrade.exitReason === 'string' ? rawTrade.exitReason.trim() : '';
  const hasExitReason = exitReason.length > 0;
  if (!hasExitReason) {
    validationErrors.push('Exit reason is missing.');
  } else if (exitReason.length > 2000) {
    validationErrors.push('Exit reason exceeds 2000 characters.');
  }

  const exitTimestamp =
    typeof rawTrade.exitTimestamp === 'string' && rawTrade.exitTimestamp.trim()
      ? rawTrade.exitTimestamp.trim()
      : undefined;
  if (!exitTimestamp) {
    validationErrors.push('Exit timestamp is missing.');
  }

  const intendedStatus = typeof rawTrade.status === 'string' ? rawTrade.status : 'unknown';
  if (intendedStatus !== 'closed') {
    validationErrors.push(`Intended status must be "closed" (found "${intendedStatus}").`);
  }

  const intendedResult = typeof rawTrade.result === 'string' ? rawTrade.result : 'pending';
  if (!['pending', 'win', 'loss', 'breakeven'].includes(intendedResult)) {
    validationErrors.push(`Unsupported trade result "${intendedResult}".`);
  }

  const sanitizedTrade = stripInvalidOptionalValues({
    ...rawTrade,
    id: tradeId,
    userId: currentUid || op.userId,
    exitReason,
  });

  for (const enumOrIdKey of ['tpOutcome', 'slOutcome', 'exitOutcome', 'sessionId', 'tradeGroupId', 'market']) {
    if (typeof sanitizedTrade[enumOrIdKey] === 'string' && sanitizedTrade[enumOrIdKey].trim() === '') {
      delete sanitizedTrade[enumOrIdKey];
    }
  }

  if (typeof sanitizedTrade.lessons === 'string' && sanitizedTrade.lessons.length > 4000) {
    sanitizedTrade.lessons = sanitizedTrade.lessons.slice(0, 4000);
  }
  if (typeof sanitizedTrade.actualOutcome === 'string' && sanitizedTrade.actualOutcome.length > 2000) {
    sanitizedTrade.actualOutcome = sanitizedTrade.actualOutcome.slice(0, 2000);
  }

  const rawFields = Array.isArray(rawPayload.updateFields) ? rawPayload.updateFields : [];
  const candidateFields =
    rawFields.length > 0
      ? rawFields
      : Object.keys(sanitizedTrade).filter((k) => k !== 'unknownFields' && ALLOWED_TRADE_UPDATE_KEYS.has(k));

  const filteredFields = Array.from(
    new Set(
      candidateFields.filter(
        (f): f is string =>
          typeof f === 'string' &&
          ALLOWED_TRADE_UPDATE_KEYS.has(f) &&
          sanitizedTrade[f] !== undefined
      )
    )
  );

  for (const requiredKey of ['status', 'exitTimestamp', 'exitReason', 'result']) {
    if (sanitizedTrade[requiredKey] !== undefined && !filteredFields.includes(requiredKey)) {
      filteredFields.push(requiredKey);
    }
  }

  const closeEventId =
    typeof rawEvent.id === 'string' && isValidDocId(rawEvent.id)
      ? rawEvent.id
      : `te_close_${op.operationId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

  const eventTimestamp =
    typeof rawEvent.timestamp === 'string' && rawEvent.timestamp
      ? rawEvent.timestamp
      : exitTimestamp || new Date().toISOString();

  const sanitizedEvent = stripInvalidOptionalValues({
    id: closeEventId,
    userId: currentUid || op.userId,
    tradeId,
    phase: 'exit',
    eventType: typeof rawEvent.eventType === 'string' && rawEvent.eventType ? rawEvent.eventType : 'trade_closed',
    label:
      typeof rawEvent.label === 'string' && rawEvent.label.trim()
        ? rawEvent.label.trim().slice(0, 200)
        : `Closed ${typeof sanitizedTrade.instrument === 'string' ? sanitizedTrade.instrument : 'Trade'}`,
    details: exitReason.slice(0, 2000),
    ...(typeof rawEvent.price === 'number' && Number.isFinite(rawEvent.price) ? { price: rawEvent.price } : {}),
    ...(typeof rawEvent.quantity === 'number' && Number.isFinite(rawEvent.quantity)
      ? { quantity: rawEvent.quantity }
      : {}),
    ...(typeof rawEvent.emotion === 'string' && rawEvent.emotion.trim()
      ? { emotion: rawEvent.emotion.trim().slice(0, 80) }
      : {}),
    timestamp: eventTimestamp,
    ...(typeof rawEvent.timezone === 'string' && rawEvent.timezone.trim()
      ? { timezone: rawEvent.timezone.trim().slice(0, 80) }
      : {}),
    sourceApplication:
      typeof rawEvent.sourceApplication === 'string' && rawEvent.sourceApplication.trim()
        ? rawEvent.sourceApplication.trim().slice(0, 80)
        : 'ATK Deck',
    sourceCreatedAt:
      typeof rawEvent.sourceCreatedAt === 'string' && rawEvent.sourceCreatedAt.trim()
        ? rawEvent.sourceCreatedAt.trim().slice(0, 64)
        : eventTimestamp,
  });

  const effectiveUid = currentUid || op.userId;
  const batchTargets = [
    `users/${effectiveUid}/trades/${tradeId}`,
    `users/${effectiveUid}/trade_events/${closeEventId}`,
  ];
  const expectedSourceUpdatedAt =
    typeof rawPayload.expectedSourceUpdatedAt === 'string'
      ? rawPayload.expectedSourceUpdatedAt
      : undefined;

  const valid = validationErrors.length === 0;
  return {
    valid,
    validationErrors,
    tradeId,
    userIdMatch,
    sessionId: typeof sanitizedTrade.sessionId === 'string' ? sanitizedTrade.sessionId : undefined,
    isOutOfSession: Boolean(sanitizedTrade.isOutOfSession),
    intendedStatus,
    intendedResult,
    exitTimestamp,
    hasExitReason,
    updateFieldKeys: filteredFields,
    closeEventId,
    batchTargets,
    expectedSourceUpdatedAt,
    closeEventPhase: 'exit',
    closeEventType: String(sanitizedEvent.eventType || 'trade_closed'),
    repairedPayload: valid
      ? {
          updatedTrade: sanitizedTrade,
          updateFields: filteredFields,
          closeEvent: sanitizedEvent,
          expectedSourceUpdatedAt,
        }
      : undefined,
  };
}

