import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ATK Deck ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let parsedError: string | null = null;
      try {
        const obj = JSON.parse(this.state.message);
        if (obj && typeof obj.error === 'string') {
          parsedError = `${obj.error} (${obj.operationType || 'operation'} on ${obj.path || 'unknown path'})`;
        }
      } catch {
        parsedError = null;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] dark:bg-[#0B0E14] p-6">
          <div className="max-w-lg w-full bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
              <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Workspace Recovery Required
              </h1>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed mb-4">
              {parsedError || this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 rounded-md hover:opacity-90 transition-opacity cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
