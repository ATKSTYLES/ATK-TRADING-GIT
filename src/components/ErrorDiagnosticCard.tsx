import { useState } from 'react';
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react';
import {
  ERROR_CATEGORY_LABELS,
  formatCloudStatusLabel,
  formatDiagnosticReport,
  formatLocalStatusLabel,
  type DiagnosticRecord,
} from '../domain/diagnostics';

interface ErrorDiagnosticCardProps {
  record: DiagnosticRecord;
  onRetry?: () => void | Promise<void>;
  retrying?: boolean;
  onDismiss?: () => void;
  onOpenDiagnostics?: () => void;
  compact?: boolean;
}

export function ErrorDiagnosticCard({
  record,
  onRetry,
  retrying = false,
  onDismiss,
  onOpenDiagnostics,
  compact = false,
}: ErrorDiagnosticCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatDiagnosticReport(record));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might be unavailable in restricted contexts
    }
  };

  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-300 dark:border-red-900/70 bg-red-50/75 dark:bg-red-950/30 text-xs text-neutral-900 dark:text-neutral-100 ${
        compact ? 'p-3.5 space-y-2.5' : 'p-4 space-y-3'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-red-800 dark:text-red-300">
                {record.actionSummary}
              </span>
              <span className="px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-white/80 dark:bg-[#0B0E14] font-medium text-[11px] text-red-700 dark:text-red-300">
                {ERROR_CATEGORY_LABELS[record.category]}
              </span>
              {(record.attemptCount ?? 1) > 1 && (
                <span className="px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-white/80 dark:bg-[#0B0E14] font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                  Attempts: {record.attemptCount}
                </span>
              )}
              <span className="font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                Ref: {record.correlationId}
              </span>
              {record.operationId && (
                <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                  Op: {record.operationId}
                </span>
              )}
            </div>
            <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed">
              {record.userExplanation}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-red-200/80 dark:border-red-900/50 text-[11px]">
        <div>
          <span className="text-neutral-500 dark:text-neutral-400">Local Status: </span>
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {formatLocalStatusLabel(record.localStatus)}
          </span>
        </div>
        <div>
          <span className="text-neutral-500 dark:text-neutral-400">Cloud Status: </span>
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {formatCloudStatusLabel(record.cloudStatus)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-neutral-700 dark:text-neutral-300">
        <span className="font-medium">Next step: </span>
        {record.recommendedAction}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {record.retryable && onRetry && (
          <button
            type="button"
            disabled={retrying}
            onClick={() => void onRetry()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying...' : 'Retry Save'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 dark:border-red-800 bg-white dark:bg-[#111622] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied Diagnostics' : 'Copy Diagnostic Details'}
        </button>
        {onOpenDiagnostics && (
          <button
            type="button"
            onClick={onOpenDiagnostics}
            className="px-2.5 py-1.5 rounded-md text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 underline cursor-pointer"
          >
            View Error History
          </button>
        )}
      </div>
    </div>
  );
}
