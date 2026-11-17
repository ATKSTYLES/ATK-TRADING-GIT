import type { DailyJournal, ExitOutcome, Trade, TradeResult, TradingSession } from './types';

export interface FinancialMetrics {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null; // null when 0 decided trades
  netPnl: number;
  hasMonetaryPnl: boolean;
  totalProfitPercent: number | null;
  profitPercentSampleSize: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  averageR: number | null;
  rSampleSize: number;
  maxDrawdown: number;
  maxWinStreak: number;
  maxLossStreak: number;
  equityCurve: Array<{ index: number; date: string; tradeId: string; equity: number; pnl: number }>;
}

export interface ActivityMetrics {
  totalSessions: number;
  plannedSessions: number;
  attendedSessions: number;
  missedSessions: number;
  cancelledSessions: number;
  zeroTradeAttendedSessions: number;
  sessionAdherenceRate: number | null; // attended / (attended + missed)
  validSetupRate: number | null; // sessions with a_plus/valid/mixed over known setup sessions
  validSetupSampleSize: number;
  outOfSessionTrades: number;
  inSessionTrades: number;
}

export interface DisciplineMetrics {
  followedPlanRate: number | null;
  followedPlanSampleSize: number;
  followedRiskRate: number | null;
  followedRiskSampleSize: number;
  impulsiveEntryRate: number | null;
  impulsiveEntrySampleSize: number;
  exitedPerPlanRate: number | null;
  exitedPerPlanSampleSize: number;
  totalSteppedBackCount: number;
  checklistCompletionRate: number | null;
  checklistSampleDays: number;
  executionVsOutcome: {
    goodProcessWin: number;
    goodProcessLoss: number;
    poorProcessWin: number;
    poorProcessLoss: number;
    sampleSize: number;
  };
}

export interface PsychologyBucket {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  hasMonetaryPnl: boolean;
  totalProfitPercent: number | null;
  averageR: number | null;
}

export interface PsychologyMetrics {
  focusedVsDistracted: {
    focused: PsychologyBucket;
    distracted: PsychologyBucket;
  };
  calmVsAnxious: {
    calm: PsychologyBucket;
    anxious: PsychologyBucket;
  };
  tradesAfterLoss: PsychologyBucket;
  impulsiveVsPlanned: {
    planned: PsychologyBucket;
    impulsive: PsychologyBucket;
  };
  confidenceBuckets: PsychologyBucket[];
  preEntryEmotions: PsychologyBucket[];
  postExitOnWins: Array<{ emotion: string; count: number }>;
  postExitOnLosses: Array<{ emotion: string; count: number }>;
}

export function computeTradeFinancials(input: {
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  plannedRisk?: number;
  actualProfitPercent?: number;
  riskPercent?: number;
  exitOutcome?: ExitOutcome;
  explicitResult?: TradeResult;
}): {
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  netPnl?: number;
  realisedR?: number;
  result: TradeResult;
} {
  const hasGross = typeof input.grossPnl === 'number' && Number.isFinite(input.grossPnl);
  const grossPnl = hasGross ? input.grossPnl : undefined;
  const commission =
    typeof input.commission === 'number' && Number.isFinite(input.commission)
      ? Math.abs(input.commission)
      : undefined;
  const otherCharges =
    typeof input.otherCharges === 'number' && Number.isFinite(input.otherCharges)
      ? Math.abs(input.otherCharges)
      : undefined;

  const netPnl =
    grossPnl !== undefined
      ? Number((grossPnl - (commission ?? 0) - (otherCharges ?? 0)).toFixed(2))
      : undefined;

  const plannedRisk =
    typeof input.plannedRisk === 'number' && Number.isFinite(input.plannedRisk)
      ? input.plannedRisk
      : undefined;
  const actualPct =
    typeof input.actualProfitPercent === 'number' && Number.isFinite(input.actualProfitPercent)
      ? input.actualProfitPercent
      : undefined;
  const riskPct =
    typeof input.riskPercent === 'number' && Number.isFinite(input.riskPercent)
      ? input.riskPercent
      : undefined;

  let realisedR: number | undefined;
  if (netPnl !== undefined && plannedRisk !== undefined && plannedRisk > 0) {
    realisedR = Number((netPnl / plannedRisk).toFixed(2));
  } else if (actualPct !== undefined && riskPct !== undefined && riskPct > 0) {
    realisedR = Number((actualPct / riskPct).toFixed(2));
  }

  let result: TradeResult = 'pending';
  if (input.explicitResult && input.explicitResult !== 'pending') {
    result = input.explicitResult;
  } else if (netPnl !== undefined) {
    if (netPnl > 0.005) result = 'win';
    else if (netPnl < -0.005) result = 'loss';
    else result = 'breakeven';
  } else if (actualPct !== undefined) {
    if (actualPct > 0.0001) result = 'win';
    else if (actualPct < -0.0001) result = 'loss';
    else result = 'breakeven';
  } else if (input.exitOutcome === 'take_profit') {
    result = 'win';
  } else if (input.exitOutcome === 'stop_loss') {
    result = 'loss';
  } else if (input.exitOutcome === 'breakeven') {
    result = 'breakeven';
  }

  return { grossPnl, commission, otherCharges, netPnl, realisedR, result };
}

export function sortTradesChronologically(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    const ta = a.exitTimestamp || a.entryTimestamp || a.date;
    const tb = b.exitTimestamp || b.entryTimestamp || b.date;
    return ta.localeCompare(tb);
  });
}

export function calculateFinancialMetrics(trades: Trade[]): FinancialMetrics {
  const closed = sortTradesChronologically(trades.filter((t) => t.status === 'closed'));
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let netPnl = 0;
  let monetaryCount = 0;
  let pctSum = 0;
  let pctCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let monetaryWinCount = 0;
  let monetaryLossCount = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;
  let rSum = 0;
  let rCount = 0;

  let runningEquity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let currentWinStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  const equityCurve: FinancialMetrics['equityCurve'] = [];

  closed.forEach((t, idx) => {
    const hasPnl = typeof t.netPnl === 'number' && Number.isFinite(t.netPnl);
    const pnl = hasPnl ? t.netPnl! : null;

    if (pnl !== null) {
      monetaryCount += 1;
      netPnl += pnl;
      runningEquity += pnl;
      if (runningEquity > peakEquity) peakEquity = runningEquity;
      const dd = peakEquity - runningEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      equityCurve.push({
        index: idx + 1,
        date: t.date,
        tradeId: t.id,
        equity: Number(runningEquity.toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
      });
    }

    if (typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)) {
      pctSum += t.actualProfitPercent;
      pctCount += 1;
    }

    const inferredWin =
      t.result === 'win' ||
      (t.result === 'pending' && ((pnl !== null && pnl > 0) || (t.actualProfitPercent ?? 0) > 0));
    const inferredLoss =
      t.result === 'loss' ||
      (t.result === 'pending' && ((pnl !== null && pnl < 0) || (t.actualProfitPercent ?? 0) < 0));

    if (inferredWin) {
      wins += 1;
      if (pnl !== null) {
        monetaryWinCount += 1;
        grossProfit += pnl;
        largestWin = largestWin === null ? pnl : Math.max(largestWin, pnl);
      }
      currentWinStreak += 1;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else if (inferredLoss) {
      losses += 1;
      if (pnl !== null) {
        monetaryLossCount += 1;
        grossLoss += Math.abs(pnl);
        largestLoss = largestLoss === null ? pnl : Math.min(largestLoss, pnl);
      }
      currentLossStreak += 1;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    } else if (t.result === 'breakeven' || pnl === 0 || t.actualProfitPercent === 0) {
      breakeven += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    if (typeof t.realisedR === 'number' && Number.isFinite(t.realisedR)) {
      rSum += t.realisedR;
      rCount += 1;
    }
  });

  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : null;
  const averageWin = monetaryWinCount > 0 ? grossProfit / monetaryWinCount : null;
  const averageLoss = monetaryLossCount > 0 ? grossLoss / monetaryLossCount : null;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;
  const expectancy =
    monetaryCount > 0 ? netPnl / monetaryCount : null;
  const averageR = rCount > 0 ? rSum / rCount : null;

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins,
    losses,
    breakeven,
    winRate,
    netPnl: Number(netPnl.toFixed(2)),
    hasMonetaryPnl: monetaryCount > 0,
    totalProfitPercent: pctCount > 0 ? Number(pctSum.toFixed(2)) : null,
    profitPercentSampleSize: pctCount,
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor,
    expectancy,
    averageWin,
    averageLoss,
    largestWin,
    largestLoss,
    averageR,
    rSampleSize: rCount,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxWinStreak,
    maxLossStreak,
    equityCurve,
  };
}

export function isSessionAttended(s: TradingSession): boolean {
  return (
    s.attendanceStatus === 'attended' ||
    s.attendanceStatus === 'late' ||
    s.attendanceStatus === 'early_exit'
  );
}

export function calculateActivityMetrics(
  sessions: TradingSession[],
  trades: Trade[]
): ActivityMetrics {
  const tradesBySession = new Map<string, number>();
  let outOfSessionTrades = 0;
  let inSessionTrades = 0;

  for (const t of trades) {
    if (t.isOutOfSession || !t.sessionId) {
      outOfSessionTrades += 1;
    } else {
      inSessionTrades += 1;
      tradesBySession.set(t.sessionId, (tradesBySession.get(t.sessionId) ?? 0) + 1);
    }
  }

  let plannedSessions = 0;
  let attendedSessions = 0;
  let missedSessions = 0;
  let cancelledSessions = 0;
  let zeroTradeAttendedSessions = 0;
  let validSetupKnown = 0;
  let validSetupPositive = 0;

  for (const s of sessions) {
    if (s.status === 'planned') plannedSessions += 1;
    if (s.status === 'cancelled' || s.attendanceStatus === 'cancelled') {
      cancelledSessions += 1;
    } else if (s.status === 'missed' || s.attendanceStatus === 'missed') {
      missedSessions += 1;
    } else if (isSessionAttended(s) || s.status === 'live' || s.status === 'completed') {
      attendedSessions += 1;
      const count = tradesBySession.get(s.id) ?? s.linkedTradeCount ?? 0;
      if (count === 0) zeroTradeAttendedSessions += 1;
    }

    if (s.setupAvailability && s.setupAvailability !== 'unknown') {
      validSetupKnown += 1;
      if (
        s.setupAvailability === 'a_plus' ||
        s.setupAvailability === 'valid' ||
        s.setupAvailability === 'mixed'
      ) {
        validSetupPositive += 1;
      }
    }
  }

  const adherenceDenominator = attendedSessions + missedSessions;
  return {
    totalSessions: sessions.length,
    plannedSessions,
    attendedSessions,
    missedSessions,
    cancelledSessions,
    zeroTradeAttendedSessions,
    sessionAdherenceRate:
      adherenceDenominator > 0 ? (attendedSessions / adherenceDenominator) * 100 : null,
    validSetupRate:
      validSetupKnown > 0 ? (validSetupPositive / validSetupKnown) * 100 : null,
    validSetupSampleSize: validSetupKnown,
    outOfSessionTrades,
    inSessionTrades,
  };
}

export function calculateDisciplineMetrics(
  trades: Trade[],
  sessions: TradingSession[],
  journals: DailyJournal[]
): DisciplineMetrics {
  let fpTotal = 0;
  let fpYes = 0;
  let frTotal = 0;
  let frYes = 0;
  let impTotal = 0;
  let impYes = 0;
  let epTotal = 0;
  let epYes = 0;

  let goodProcessWin = 0;
  let goodProcessLoss = 0;
  let poorProcessWin = 0;
  let poorProcessLoss = 0;
  let eoSample = 0;

  for (const t of trades) {
    const dq = t.disciplineQuestions;
    if (!dq) continue;
    if (typeof dq.followedPlan === 'boolean') {
      fpTotal += 1;
      if (dq.followedPlan) fpYes += 1;
    }
    if (typeof dq.followedRiskRules === 'boolean') {
      frTotal += 1;
      if (dq.followedRiskRules) frYes += 1;
    }
    if (typeof dq.impulsiveEntry === 'boolean') {
      impTotal += 1;
      if (dq.impulsiveEntry) impYes += 1;
    }
    if (typeof dq.exitedPerPlan === 'boolean') {
      epTotal += 1;
      if (dq.exitedPerPlan) epYes += 1;
    }

    if (
      t.status === 'closed' &&
      typeof dq.followedPlan === 'boolean' &&
      typeof dq.followedRiskRules === 'boolean' &&
      t.result !== 'pending'
    ) {
      eoSample += 1;
      const goodProcess = dq.followedPlan && dq.followedRiskRules && !dq.impulsiveEntry;
      const isWin = t.result === 'win';
      if (goodProcess && isWin) goodProcessWin += 1;
      else if (goodProcess && !isWin) goodProcessLoss += 1;
      else if (!goodProcess && isWin) poorProcessWin += 1;
      else poorProcessLoss += 1;
    }
  }

  const totalSteppedBackCount = sessions.reduce(
    (sum, s) => sum + (Number(s.steppedBackCount) || 0),
    0
  );

  let totalChecklistItems = 0;
  let completedChecklistItems = 0;
  let checklistSampleDays = 0;
  for (const j of journals) {
    if (j.checklistItems && j.checklistItems.length > 0) {
      checklistSampleDays += 1;
      totalChecklistItems += j.checklistItems.length;
      completedChecklistItems += j.checklistItems.filter((c) => c.completed).length;
    }
  }

  return {
    followedPlanRate: fpTotal > 0 ? (fpYes / fpTotal) * 100 : null,
    followedPlanSampleSize: fpTotal,
    followedRiskRate: frTotal > 0 ? (frYes / frTotal) * 100 : null,
    followedRiskSampleSize: frTotal,
    impulsiveEntryRate: impTotal > 0 ? (impYes / impTotal) * 100 : null,
    impulsiveEntrySampleSize: impTotal,
    exitedPerPlanRate: epTotal > 0 ? (epYes / epTotal) * 100 : null,
    exitedPerPlanSampleSize: epTotal,
    totalSteppedBackCount,
    checklistCompletionRate:
      totalChecklistItems > 0 ? (completedChecklistItems / totalChecklistItems) * 100 : null,
    checklistSampleDays,
    executionVsOutcome: {
      goodProcessWin,
      goodProcessLoss,
      poorProcessWin,
      poorProcessLoss,
      sampleSize: eoSample,
    },
  };
}

function summarizeBucket(label: string, subset: Trade[]): PsychologyBucket {
  const closed = subset.filter((t) => t.status === 'closed');
  let wins = 0;
  let losses = 0;
  let netPnl = 0;
  let monetaryCount = 0;
  let pctSum = 0;
  let pctCount = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of closed) {
    if (t.result === 'win') wins += 1;
    else if (t.result === 'loss') losses += 1;
    if (typeof t.netPnl === 'number' && Number.isFinite(t.netPnl)) {
      netPnl += t.netPnl;
      monetaryCount += 1;
    }
    if (typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)) {
      pctSum += t.actualProfitPercent;
      pctCount += 1;
    }
    if (typeof t.realisedR === 'number' && Number.isFinite(t.realisedR)) {
      rSum += t.realisedR;
      rCount += 1;
    }
  }
  const decided = wins + losses;
  return {
    label,
    trades: closed.length,
    wins,
    losses,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    netPnl: Number(netPnl.toFixed(2)),
    hasMonetaryPnl: monetaryCount > 0,
    totalProfitPercent: pctCount > 0 ? Number(pctSum.toFixed(2)) : null,
    averageR: rCount > 0 ? rSum / rCount : null,
  };
}

export function calculatePsychologyMetrics(trades: Trade[]): PsychologyMetrics {
  const closed = sortTradesChronologically(trades.filter((t) => t.status === 'closed'));

  const focusedLabels = new Set(['Calm & Focused', 'Present', 'Focused']);
  const distractedLabels = new Set(['Fatigued/Distracted', 'Distracted', 'Impatient', 'FOMO']);
  const calmLabels = new Set(['Calm & Focused', 'Present', 'Calm', 'Cautious']);
  const anxiousLabels = new Set(['Anxious', 'FOMO', 'Frustrated', 'Impatient']);

  const focusedTrades = closed.filter(
    (t) => t.preEntryEmotion && focusedLabels.has(t.preEntryEmotion)
  );
  const distractedTrades = closed.filter(
    (t) => t.preEntryEmotion && distractedLabels.has(t.preEntryEmotion)
  );
  const calmTrades = closed.filter(
    (t) => t.preEntryEmotion && calmLabels.has(t.preEntryEmotion)
  );
  const anxiousTrades = closed.filter(
    (t) => t.preEntryEmotion && anxiousLabels.has(t.preEntryEmotion)
  );

  const afterLossTrades: Trade[] = [];
  for (let i = 1; i < closed.length; i++) {
    if (closed[i - 1].result === 'loss') {
      afterLossTrades.push(closed[i]);
    }
  }

  const plannedTrades = closed.filter((t) => t.disciplineQuestions?.impulsiveEntry === false);
  const impulsiveTrades = closed.filter((t) => t.disciplineQuestions?.impulsiveEntry === true);

  const lowConf = closed.filter((t) => typeof t.confidence === 'number' && t.confidence <= 4);
  const midConf = closed.filter(
    (t) => typeof t.confidence === 'number' && t.confidence >= 5 && t.confidence <= 7
  );
  const highConf = closed.filter((t) => typeof t.confidence === 'number' && t.confidence >= 8);

  const byEmotion = new Map<string, Trade[]>();
  const postWinCounts = new Map<string, number>();
  const postLossCounts = new Map<string, number>();

  for (const t of closed) {
    if (t.preEntryEmotion) {
      const list = byEmotion.get(t.preEntryEmotion) ?? [];
      list.push(t);
      byEmotion.set(t.preEntryEmotion, list);
    }
    if (t.postExitEmotions && t.postExitEmotions.length > 0) {
      const target = t.result === 'win' ? postWinCounts : t.result === 'loss' ? postLossCounts : null;
      if (target) {
        for (const em of t.postExitEmotions) {
          target.set(em, (target.get(em) ?? 0) + 1);
        }
      }
    }
  }

  return {
    focusedVsDistracted: {
      focused: summarizeBucket('Focused / Present', focusedTrades),
      distracted: summarizeBucket('Fatigued / Distracted', distractedTrades),
    },
    calmVsAnxious: {
      calm: summarizeBucket('Calm / Cautious', calmTrades),
      anxious: summarizeBucket('Anxious / Impatient / FOMO', anxiousTrades),
    },
    tradesAfterLoss: summarizeBucket('Trades Immediately After a Loss', afterLossTrades),
    impulsiveVsPlanned: {
      planned: summarizeBucket('Planned Entries', plannedTrades),
      impulsive: summarizeBucket('Impulsive Entries', impulsiveTrades),
    },
    confidenceBuckets: [
      summarizeBucket('Low Confidence (1–4)', lowConf),
      summarizeBucket('Moderate Confidence (5–7)', midConf),
      summarizeBucket('High Confidence (8–10)', highConf),
    ],
    preEntryEmotions: Array.from(byEmotion.entries()).map(([em, list]) =>
      summarizeBucket(em, list)
    ),
    postExitOnWins: Array.from(postWinCounts.entries())
      .map(([emotion, count]) => ({ emotion, count }))
      .sort((a, b) => b.count - a.count),
    postExitOnLosses: Array.from(postLossCounts.entries())
      .map(([emotion, count]) => ({ emotion, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function formatCurrency(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs);
    if (amount < 0) return `-${formatted}`;
    if (amount > 0) return `+${formatted}`;
    return formatted;
  } catch {
    return `${amount >= 0 ? '+' : '-'}${currency} ${abs.toFixed(2)}`;
  }
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}
