import { Lock, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { ErrorDiagnosticCard } from './ErrorDiagnosticCard';

export function LoginScreen() {
  const { signInWithGoogle, authError, activeError, dismissActiveError } = useWorkspace();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] dark:bg-[#0B0E14] px-6 py-12">
      <div className="w-full max-w-md bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-8">
        <div className="mb-6">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
            Personal Trading Journal · Version 2
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            ATK Deck
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 leading-relaxed">
            Sign in to access your private trading ledger, live session &amp; trade engagement engine, psychology analytics, and portable ATK-UTDS archive.
          </p>
        </div>

        <div className="space-y-3 py-4 border-y border-neutral-200 dark:border-neutral-800 mb-6 text-xs text-neutral-600 dark:text-neutral-400">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
            <span>Owner-isolated cloud storage independent of frontend builds or hosting changes.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
            <span>Full ATK-UTDS v1.0.0 export and conflict-safe import with attachment preservation.</span>
          </div>
        </div>

        {activeError ? (
          <div className="mb-4">
            <ErrorDiagnosticCard
              record={activeError}
              onRetry={() => signInWithGoogle()}
              onDismiss={dismissActiveError}
              compact
            />
          </div>
        ) : (
          authError && (
            <div className="mb-4 p-3 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {authError}
            </div>
          )
        )}

        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium rounded-md bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors cursor-pointer whitespace-nowrap"
        >
          Sign In with Google
        </button>
      </div>
    </div>
  );
}
