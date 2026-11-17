import {
  classifyError,
  formatCloudStatusLabel,
  formatDiagnosticReport,
  formatLocalStatusLabel,
  StructuredAppError,
  type ClassifyErrorContext,
  type CloudStatus,
  type DiagnosticRecord,
  type ErrorCategory,
  type LocalStatus,
} from '../domain/diagnostics';

export type ErrorLogContext = Omit<ClassifyErrorContext, 'workspaceId' | 'isOnline' | 'emailVerified'> & {
  workspaceId?: string;
  isOnline?: boolean;
  emailVerified?: boolean | null;
};

type ErrorListener = (record: DiagnosticRecord) => void;

const listeners = new Set<ErrorListener>();

function buildNormalizedError(
  err: unknown,
  forcedCategory?: ErrorCategory,
  defaultCode?: string,
  defaultMessage?: string
): unknown {
  if (err instanceof StructuredAppError) {
    if (!forcedCategory || err.category === forcedCategory) return err;
    return new StructuredAppError({
      message: err.message,
      category: forcedCategory,
      errorCode: err.errorCode || defaultCode || `${forcedCategory.toUpperCase()}_ERROR`,
      userExplanation: err.userExplanation,
      recommendedAction: err.recommendedAction,
      retryable: err.retryable,
      fieldErrors: err.fieldErrors,
      operationId: err.operationId,
      cloudStatus: err.cloudStatus,
    });
  }

  if (typeof err === 'string') {
    const trimmed = err.trim() || defaultMessage || 'Operation could not be completed.';
    if (!forcedCategory) return new Error(trimmed);
    return new StructuredAppError({
      message: trimmed,
      category: forcedCategory,
      errorCode: defaultCode || `${forcedCategory.toUpperCase()}_ERROR`,
      userExplanation: trimmed,
      recommendedAction: defaultRecommendedAction(forcedCategory),
      retryable: isCategoryRetryable(forcedCategory),
      cloudStatus: defaultCloudStatusForCategory(forcedCategory),
    });
  }

  if (forcedCategory && err && typeof err === 'object') {
    const rawMsg =
      err instanceof Error ? err.message : defaultMessage || 'Operation encountered an error.';
    const rawCode =
      'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : defaultCode || `${forcedCategory.toUpperCase()}_ERROR`;
    return new StructuredAppError({
      message: rawMsg,
      category: forcedCategory,
      errorCode: rawCode,
      userExplanation:
        forcedCategory === 'validation' ? rawMsg : defaultExplanationForCategory(forcedCategory, rawMsg),
      recommendedAction: defaultRecommendedAction(forcedCategory),
      retryable: isCategoryRetryable(forcedCategory),
      cloudStatus: defaultCloudStatusForCategory(forcedCategory),
    });
  }

  return err ?? new Error(defaultMessage || 'Unexpected application error.');
}

function isCategoryRetryable(cat: ErrorCategory): boolean {
  return cat === 'network' || cat === 'synchronisation' || cat === 'database' || cat === 'application';
}

function defaultCloudStatusForCategory(cat: ErrorCategory): CloudStatus {
  if (cat === 'validation' || cat === 'authentication' || cat === 'conflict') return 'unverified';
  if (cat === 'network' || cat === 'synchronisation') return 'pending_retry';
  return 'failed';
}

function defaultExplanationForCategory(cat: ErrorCategory, fallback: string): string {
  switch (cat) {
    case 'validation':
      return fallback;
    case 'authentication':
      return 'Your authentication session is missing or expired, so Cloud Vault could not verify your identity.';
    case 'permission':
      return 'Cloud Vault rejected this update because a permission or record-validation check failed on the server.';
    case 'network':
      return 'Network connectivity to Cloud Vault was interrupted or timed out.';
    case 'database':
      return 'Cloud Vault could not persist the database write cleanly.';
    case 'synchronisation':
      return 'Local changes could not finish synchronising with Cloud Vault.';
    case 'conflict':
      return 'This record was modified elsewhere before your update completed.';
    case 'application':
      return 'An unexpected application issue interrupted this operation.';
  }
}

function defaultRecommendedAction(cat: ErrorCategory): string {
  switch (cat) {
    case 'validation':
      return 'Review the highlighted inputs and submit again.';
    case 'authentication':
      return 'Sign in again to refresh your workspace session, then retry.';
    case 'permission':
      return 'Confirm you are signed in with the workspace owner account. Avoid blind automatic retries if the rule check fails; inspect the diagnostic details.';
    case 'network':
      return 'Check your internet connection and retry once connectivity returns.';
    case 'database':
      return 'Review record values and retry saving. If the error repeats, copy diagnostic details.';
    case 'synchronisation':
      return 'Use Retry Sync in the Pending Sync Queue to reconcile local and cloud state.';
    case 'conflict':
      return 'Reload workspace data to inspect the latest cloud record before saving again.';
    case 'application':
      return 'Retry the action or reload the page if the issue persists.';
  }
}

export class ErrorHandlerService {
  subscribe(listener: ErrorListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  capture(
    err: unknown,
    ctx: ErrorLogContext,
    options?: { forcedCategory?: ErrorCategory; notify?: boolean }
  ): DiagnosticRecord {
    const normalized = buildNormalizedError(err, options?.forcedCategory);
    const classified = classifyError(normalized, {
      ...ctx,
      isOnline:
        ctx.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true),
    });

    const record: DiagnosticRecord = options?.forcedCategory
      ? { ...classified, category: options.forcedCategory }
      : classified;

    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error(
        `[ATK ErrorHandler] ${record.correlationId} | ${record.category.toUpperCase()} (${record.errorCode}) | ${record.module}/${record.operation} | local=${record.localStatus} cloud=${record.cloudStatus} | ${record.safeTechnicalMessage}`
      );
    }

    if (options?.notify !== false) {
      for (const listener of listeners) {
        try {
          listener(record);
        } catch {
          // Never allow diagnostic subscribers to throw inside error capture
        }
      }
    }

    return record;
  }

  logValidationError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      localStatus: 'preserved_in_form',
      cloudStatus: 'unverified',
      ...ctx,
    }, { forcedCategory: 'validation', notify });
  }

  logNetworkError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'pending_retry',
      ...ctx,
    }, { forcedCategory: 'network', notify });
  }

  logDatabaseError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'failed',
      ...ctx,
    }, { forcedCategory: 'database', notify });
  }

  logAuthenticationError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'unverified',
      ...ctx,
    }, { forcedCategory: 'authentication', notify });
  }

  logPermissionError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'failed',
      ...ctx,
    }, { forcedCategory: 'permission', notify });
  }

  logSynchronisationError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'pending_retry',
      ...ctx,
    }, { forcedCategory: 'synchronisation', notify });
  }

  logConflictError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'unverified',
      ...ctx,
    }, { forcedCategory: 'conflict', notify });
  }

  logApplicationError(err: unknown, ctx: ErrorLogContext, notify = true): DiagnosticRecord {
    return this.capture(err, {
      cloudStatus: 'failed',
      ...ctx,
    }, { forcedCategory: 'application', notify });
  }

  formatReport(record: DiagnosticRecord): string {
    return formatDiagnosticReport(record);
  }

  formatStatusSummary(record: DiagnosticRecord): { local: string; cloud: string } {
    return {
      local: formatLocalStatusLabel(record.localStatus),
      cloud: formatCloudStatusLabel(record.cloudStatus),
    };
  }

  formatInlineMessage(record: DiagnosticRecord): string {
    const { local, cloud } = this.formatStatusSummary(record);
    return `${record.userExplanation} [Local: ${local} | Cloud: ${cloud} | Ref: ${record.correlationId}]`;
  }
}

export const errorHandler = new ErrorHandlerService();

export type {
  CloudStatus,
  DiagnosticRecord,
  ErrorCategory,
  LocalStatus,
};
export { StructuredAppError };
