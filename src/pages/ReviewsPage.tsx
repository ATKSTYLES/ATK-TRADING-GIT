import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { APP_NAME, DEFAULT_TIMEZONE, generateId, getLocalDateString } from '../domain/defaults';
import { StructuredAppError } from '../domain/diagnostics';
import type { Review, ReviewType } from '../domain/types';

export function ReviewsPage() {
  const { user, dataset, saveReview, removeReview, reportDiagnostic } = useWorkspace();
  const timezone = dataset.profile?.timezone || DEFAULT_TIMEZONE;
  const [typeFilter, setTypeFilter] = useState<'all' | ReviewType>('all');
  const [editing, setEditing] = useState<Review | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [formError, setFormError] = useState('');

  const filtered = useMemo(() => {
    const list =
      typeFilter === 'all'
        ? dataset.reviews
        : dataset.reviews.filter((r) => r.reviewType === typeFilter);
    return [...list].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  }, [dataset.reviews, typeFilter]);

  const openNew = () => {
    if (!user) return;
    const today = getLocalDateString(new Date(), timezone);
    setFormError('');
    setEditing({
      id: generateId('rev'),
      userId: user.uid,
      reviewType: 'weekly',
      title: '',
      periodStart: today,
      periodEnd: today,
      strategyName: '',
      summary: '',
      tradingMistakes: '',
      lessonsLearned: '',
      behaviouralPatterns: '',
      improvementGoals: '',
      rating: 7,
      sourceApplication: APP_NAME,
    });
  };

  const handleSave = async () => {
    if (!editing || savingReview) return;
    const reportInvalid = (message: string) => {
      setFormError(message);
      reportDiagnostic(
        new StructuredAppError({
          category: 'validation',
          errorCode: 'REVIEW_VALIDATION_FAILED',
          message,
          userExplanation: message,
          recommendedAction: 'Update the review fields and click Save Review again.',
        }),
        {
          module: 'Reviews',
          operation: 'validateReview',
          actionSummary: 'Review validation failed',
          recordType: 'review',
          recordId: editing.id,
          localStatus: 'preserved_in_form',
          cloudStatus: 'unverified',
        }
      );
    };

    if (!editing.title.trim()) {
      reportInvalid('Review title is required before saving.');
      return;
    }
    if (!editing.periodStart || !editing.periodEnd || editing.periodEnd < editing.periodStart) {
      reportInvalid('Period End date must be on or after Period Start date.');
      return;
    }
    if (
      editing.rating !== undefined &&
      (!Number.isFinite(editing.rating) || editing.rating < 1 || editing.rating > 10)
    ) {
      reportInvalid('Review rating must be a number between 1 and 10.');
      return;
    }

    setFormError('');
    setSavingReview(true);
    try {
      const exists = dataset.reviews.some((r) => r.id === editing.id);
      await saveReview({ ...editing, title: editing.title.trim() }, exists);
      setEditing(null);
    } catch {
      // Surfaced via global diagnostic card; keep modal open with form values intact
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Daily, Weekly, Monthly &amp; Strategy Reviews · Portable in ATK-UTDS Exports
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
            Structured Reviews
          </h2>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" /> New Review
        </button>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit">
        {(['all', 'daily', 'weekly', 'monthly', 'strategy'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
              typeFilter === t
                ? 'bg-white dark:bg-[#111622] text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-10 text-center text-sm text-neutral-500">
          No reviews created yet for this scope.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filtered.map((rev) => (
            <div
              key={rev.id}
              onClick={() => {
                setFormError('');
                setEditing(rev);
              }}
              className="bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-neutral-500 capitalize">
                    {rev.reviewType} Review · {rev.periodStart} to {rev.periodEnd}
                    {rev.rating ? ` · Rating ${rev.rating}/10` : ''}
                  </p>
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">
                    {rev.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeReview(rev.id).catch(() => {});
                  }}
                  className="p-1.5 text-neutral-400 hover:text-red-600 cursor-pointer"
                  aria-label="Delete review"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {rev.summary && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-3">
                  {rev.summary}
                </p>
              )}
              {rev.improvementGoals && (
                <p className="text-xs text-neutral-700 dark:text-neutral-300 border-t border-neutral-100 dark:border-neutral-800 pt-2">
                  <span className="font-medium">Focus Goal:</span> {rev.improvementGoals}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111622] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Structured Review</h3>
              <button type="button" onClick={() => setEditing(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Review Type</label>
                <select
                  value={editing.reviewType}
                  onChange={(e) =>
                    setEditing({ ...editing, reviewType: e.target.value as ReviewType })
                  }
                  className="w-full px-2.5 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="strategy">Strategy</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Period Start</label>
                <input
                  type="date"
                  value={editing.periodStart}
                  onChange={(e) => setEditing({ ...editing, periodStart: e.target.value })}
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Period End</label>
                <input
                  type="date"
                  value={editing.periodEnd}
                  onChange={(e) => setEditing({ ...editing, periodEnd: e.target.value })}
                  className="w-full px-2.5 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Review Title</label>
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="e.g. Week 46 Execution & Discipline Review"
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Rating (1–10)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={editing.rating ?? 7}
                  onChange={(e) => setEditing({ ...editing, rating: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>

            {editing.reviewType === 'strategy' && (
              <div className="text-xs">
                <label className="block font-medium mb-1">Strategy Name</label>
                <input
                  type="text"
                  value={editing.strategyName || ''}
                  onChange={(e) => setEditing({ ...editing, strategyName: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Summary</label>
                <textarea
                  rows={3}
                  value={editing.summary || ''}
                  onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Trading Mistakes</label>
                <textarea
                  rows={2}
                  value={editing.tradingMistakes || ''}
                  onChange={(e) => setEditing({ ...editing, tradingMistakes: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Lessons Learned</label>
                <textarea
                  rows={2}
                  value={editing.lessonsLearned || ''}
                  onChange={(e) => setEditing({ ...editing, lessonsLearned: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Behavioural Patterns</label>
                <textarea
                  rows={2}
                  value={editing.behaviouralPatterns || ''}
                  onChange={(e) => setEditing({ ...editing, behaviouralPatterns: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Improvement Goals</label>
                <textarea
                  rows={2}
                  value={editing.improvementGoals || ''}
                  onChange={(e) => setEditing({ ...editing, improvementGoals: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B0E14]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3.5 py-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingReview}
                onClick={() => void handleSave()}
                className="px-4 py-2 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 cursor-pointer"
              >
                {savingReview ? 'Saving Review...' : 'Save Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
