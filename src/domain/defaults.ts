import type {
  ChecklistDefinition,
  ChecklistItemState,
  Instrument,
  SessionTemplate,
  SittingLocation,
  TradingAccount,
  UserPreferences,
} from './types';

export const APP_NAME = 'ATK Deck V2';
export const APP_VERSION = '2.0.0';
export const UTDS_FORMAT = 'ATK-UTDS' as const;
export const UTDS_VERSION = '1.0.0';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const DEFAULT_DAILY_CHECKLIST_ITEMS: string[] = [
  'Meditation',
  'Exercise',
  'Visualization',
  'Oxygenation',
  'Reading',
];

export const DEFAULT_SITTING_LOCATIONS: SittingLocation[] = [
  'Home',
  'Office',
  'Trading Desk',
  'Travelling',
  'Other',
];

export const DEFAULT_PRE_SESSION_EMOTIONS: string[] = [
  'Calm',
  'Focused',
  'Confident',
  'Neutral',
  'Excited',
  'Anxious',
  'Frustrated',
  'Impatient',
  'Tired',
  'Distracted',
];

export const DEFAULT_SESSION_QUICK_ACTIONS: string[] = [
  'Levels Marked Cleanly',
  'Waiting for Setup',
  'No Valid Setup',
  'Choppy Market',
  'FOMO Resisted',
  'Calm & Present',
  'Fatigued/Distracted',
  'Impatient',
  'Changed Bias',
  'Stepped Back',
  'Custom Observation',
];

export const DEFAULT_EMOTION_OPTIONS: string[] = [
  'Calm & Focused',
  'Present',
  'Confident',
  'Neutral',
  'Cautious',
  'Anxious',
  'Impatient',
  'FOMO',
  'Frustrated',
  'Overconfident',
  'Tired',
  'Fatigued/Distracted',
];

export const DEFAULT_MISTAKE_OPTIONS: string[] = [
  'Chased Entry',
  'Moved Stop Loss Wider',
  'Oversized Position',
  'Entered Without Setup',
  'Cut Winner Early',
  'Revenge Trade',
  'Ignored HTF Levels',
  'No Anti-Bias Pause',
];

export const DEFAULT_TIMEFRAMES: string[] = ['1m', '3m', '5m', '15m', '1H', '4H', '1D'];

export const DEFAULT_SETUP_LABELS: string[] = [
  'Break & Retest',
  'Liquidity Sweep Reversal',
  'Opening Range Breakout',
  'Trend Continuation Pullback',
  'Range Mean Reversion',
  'VWAP Reclaim',
];

export const DEFAULT_ENTRY_TYPES: string[] = [
  'Limit Order',
  'Market Execution',
  'Stop Entry',
  'Confirmation Candle',
];

export const STANDARD_SESSION_WINDOWS = [
  {
    id: 'tpl_asian',
    name: 'Asian',
    market: 'FX / Crypto / Asia',
    plannedStartTime: '05:30',
    plannedEndTime: '11:30',
    defaultChecklist: ['Prior day close marked', 'Asia range levels marked', 'Spread conditions checked'],
  },
  {
    id: 'tpl_london',
    name: 'London',
    market: 'Forex / Indices',
    plannedStartTime: '11:30',
    plannedEndTime: '17:30',
    defaultChecklist: ['Asia high/low marked', 'Economic calendar reviewed', 'Risk budget verified'],
  },
  {
    id: 'tpl_new_york',
    name: 'New York',
    market: 'Futures / Equities / FX',
    plannedStartTime: '17:30',
    plannedEndTime: '22:30',
    defaultChecklist: ['London high/low marked', 'Key HTF levels plotted', 'Emotional readiness confirmed'],
  },
] as const;

export function generateId(prefix?: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

export function getLocalDateString(date = new Date(), timezone?: string): string {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback to local clock below
    }
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDateString(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function getCurrentTimeMinutesInTimezone(timezone: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);
    const hhRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const hh = hhRaw === 24 ? 0 : hhRaw;
    return hh * 60 + mm;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

export function formatTimeInTimezone(isoOrDate: string | Date, timezone?: string): string {
  const dt = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(dt.getTime())) return '—';
  try {
    return dt.toLocaleTimeString([], {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

export function formatTimestampWithSeconds(isoOrDate: string | Date, timezone?: string): string {
  const dt = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(dt.getTime())) return '—';
  try {
    return dt.toLocaleTimeString([], {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
}

export function getEffectiveStandardTemplates(
  templates: SessionTemplate[],
  timezone = DEFAULT_TIMEZONE
): SessionTemplate[] {
  if (!templates || templates.length === 0) {
    return STANDARD_SESSION_WINDOWS.map((w) => ({
      id: w.id,
      userId: 'default',
      name: w.name,
      market: w.market,
      plannedStartTime: w.plannedStartTime,
      plannedEndTime: w.plannedEndTime,
      timezone,
      defaultChecklist: [...w.defaultChecklist],
    }));
  }
  return [...templates].sort((a, b) => {
    const am = parseTimeToMinutes(a.plannedStartTime) ?? 9999;
    const bm = parseTimeToMinutes(b.plannedStartTime) ?? 9999;
    return am - bm;
  });
}

/**
 * Selects the single active standard session matching current local time in `timezone`.
 * Uses half-open [start, end) intervals so boundary minutes (e.g. 11:30, 17:30)
 * switch cleanly to the next session without overlapping or selecting two sessions.
 */
export function detectActiveStandardSession(
  templates: SessionTemplate[],
  timezone = DEFAULT_TIMEZONE,
  now = new Date()
): SessionTemplate | null {
  const list = getEffectiveStandardTemplates(templates, timezone);
  const nowMinutes = getCurrentTimeMinutesInTimezone(timezone, now);

  for (const tpl of list) {
    const startMin = parseTimeToMinutes(tpl.plannedStartTime);
    const endMin = parseTimeToMinutes(tpl.plannedEndTime);
    if (startMin === null || endMin === null || startMin === endMin) continue;

    if (startMin < endMin) {
      if (nowMinutes >= startMin && nowMinutes < endMin) {
        return tpl;
      }
    } else {
      // Crosses midnight (e.g. 22:00 -> 04:00)
      if (nowMinutes >= startMin || nowMinutes < endMin) {
        return tpl;
      }
    }
  }
  return null;
}

export function createChecklistStates(items: string[]): ChecklistItemState[] {
  return items.map((label, idx) => ({
    id: `chk_${idx}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label,
    completed: false,
  }));
}

export function buildInitialAccount(userId: string, currency: string): TradingAccount {
  const now = new Date().toISOString();
  return {
    id: `acc_primary_${userId.slice(0, 8)}`,
    userId,
    name: 'Primary Personal Account',
    broker: 'Self-Directed',
    accountType: 'personal',
    currency,
    initialBalance: 10000,
    defaultRiskPercent: 1,
    isActive: true,
    notes: 'Default personal trading ledger account.',
    sourceApplication: APP_NAME,
    sourceCreatedAt: now,
    sourceUpdatedAt: now,
  };
}

export function buildInitialPreferences(
  userId: string,
  defaultAccountId: string
): UserPreferences {
  return {
    id: 'pref_default',
    userId,
    timeframes: [...DEFAULT_TIMEFRAMES],
    setupLabels: [...DEFAULT_SETUP_LABELS],
    entryTypes: [...DEFAULT_ENTRY_TYPES],
    sessionQuickActions: [...DEFAULT_SESSION_QUICK_ACTIONS],
    antiBiasPauseSeconds: 10,
    defaultAccountId,
  };
}

export function buildInitialChecklists(userId: string): ChecklistDefinition[] {
  return [
    {
      id: 'chk_def_daily',
      userId,
      name: 'Daily Foundation Protocol',
      scope: 'daily',
      items: [...DEFAULT_DAILY_CHECKLIST_ITEMS],
      isDefault: true,
    },
    {
      id: 'chk_def_session',
      userId,
      name: 'Pre-Session Readiness',
      scope: 'session',
      items: [
        'Economic calendar checked',
        'Key HTF levels marked',
        'Daily bias & invalidation defined',
        'Max daily risk verified',
      ],
      isDefault: true,
    },
  ];
}

export function buildInitialSessionTemplates(
  userId: string,
  timezone = DEFAULT_TIMEZONE
): SessionTemplate[] {
  return STANDARD_SESSION_WINDOWS.map((w) => ({
    id: w.id,
    userId,
    name: w.name,
    market: w.market,
    plannedStartTime: w.plannedStartTime,
    plannedEndTime: w.plannedEndTime,
    timezone,
    defaultChecklist: [...w.defaultChecklist],
  }));
}

export function buildInitialInstruments(userId: string): Instrument[] {
  const presets: Array<Omit<Instrument, 'userId' | 'isActive'>> = [
    { id: 'inst_nq', symbol: 'NQ', name: 'E-mini Nasdaq 100', market: 'Futures', tickSize: 0.25, pointValue: 20, defaultCommission: 4.5 },
    { id: 'inst_es', symbol: 'ES', name: 'E-mini S&P 500', market: 'Futures', tickSize: 0.25, pointValue: 50, defaultCommission: 4.5 },
    { id: 'inst_eurusd', symbol: 'EURUSD', name: 'Euro / US Dollar', market: 'Forex', tickSize: 0.0001, pointValue: 10, defaultCommission: 7 },
    { id: 'inst_xauusd', symbol: 'XAUUSD', name: 'Gold Spot', market: 'Commodities', tickSize: 0.01, pointValue: 100, defaultCommission: 6 },
    { id: 'inst_btcusd', symbol: 'BTCUSD', name: 'Bitcoin / USD', market: 'Crypto', tickSize: 1, pointValue: 1, defaultCommission: 0 },
  ];
  return presets.map((p) => ({
    ...p,
    userId,
    isActive: true,
  }));
}
