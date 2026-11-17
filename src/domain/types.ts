export type ThemeMode = 'light' | 'dark';

export type AccountType = 'personal' | 'funded' | 'demo' | 'paper';

export type SessionLifecycleStatus =
  | 'planned'
  | 'live'
  | 'completed'
  | 'missed'
  | 'cancelled';

export type SessionAttendanceStatus =
  | 'pending'
  | 'attended'
  | 'late'
  | 'early_exit'
  | 'missed'
  | 'cancelled';

export type SetupAvailability =
  | 'unknown'
  | 'a_plus'
  | 'valid'
  | 'mixed'
  | 'no_valid_setup';

export type PlanAdherence = 'pending' | 'followed' | 'partial' | 'deviated';

export type SessionCategory = 'standard' | 'custom';

export type SittingLocation =
  | 'Home'
  | 'Office'
  | 'Trading Desk'
  | 'Travelling'
  | 'Other';

export type TpOutcome = 'pending' | 'hit' | 'partial' | 'missed' | 'not_used';
export type SlOutcome = 'pending' | 'hit' | 'trailed_be' | 'moved' | 'not_used';
export type ExitOutcome = 'take_profit' | 'stop_loss' | 'manual_exit' | 'breakeven';

export type TradeDirection = 'long' | 'short';
export type TradeLifecycleStatus = 'before_entry' | 'during_trade' | 'closed';
export type TradeResult = 'pending' | 'win' | 'loss' | 'breakeven';
export type TradePhase = 'before_entry' | 'during_trade' | 'exit';

export type InstrumentMarket =
  | 'Forex'
  | 'Futures'
  | 'Indices'
  | 'Equities'
  | 'Crypto'
  | 'Commodities'
  | 'Options';

export type ReviewType = 'daily' | 'weekly' | 'monthly' | 'strategy';

export type AttachmentEntityType = 'trade' | 'session' | 'daily_journal' | 'review';

export type AuditAction =
  | 'export_backup'
  | 'export_json'
  | 'export_csv'
  | 'export_xlsx'
  | 'import_preview'
  | 'import_commit'
  | 'import_rollback'
  | 'delete_record';

export interface ChecklistItemState {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  timezone: string;
  currency: string;
  theme: ThemeMode;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TradingAccount {
  id: string;
  userId: string;
  name: string;
  broker?: string;
  accountType: AccountType;
  currency: string;
  initialBalance: number;
  defaultRiskPercent: number;
  isActive: boolean;
  notes?: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DailyJournal {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  timezone: string;
  plannedActivities?: string;
  morningNotes?: string;
  dailyEmotionalState?: string;
  disciplineRating?: number;
  checklistItems: ChecklistItemState[];
  dailyReflection?: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TradingSession {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  sessionName: string;
  sessionCategory?: SessionCategory;
  sessionTemplateId?: string;
  timezone: string;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  attendanceStatus: SessionAttendanceStatus;
  arrivalDelayMinutes?: number;
  earlyDepartureMinutes?: number;
  setupAvailability?: SetupAvailability;
  sittingLocation?: string;
  sittingLocationOther?: string;
  preSessionEmotion?: string;
  preSessionEmotionNote?: string;
  preSessionPreparation?: string;
  sessionBias?: string;
  sessionEmotions?: string[];
  postSessionEmotions?: string[];
  sessionChecklist?: ChecklistItemState[];
  sessionNotes?: string;
  observations?: string;
  steppedBackCount: number;
  linkedTradeCount: number;
  sessionSummary?: string;
  planAdherence?: PlanAdherence;
  closingReflection?: string;
  status: SessionLifecycleStatus;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SessionEvent {
  id: string;
  userId: string;
  sessionId: string;
  eventType: string;
  label: string;
  notes?: string;
  emotion?: string;
  timestamp: string;
  timezone?: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
}

export interface DisciplineQuestions {
  followedPlan?: boolean;
  followedRiskRules?: boolean;
  impulsiveEntry?: boolean;
  exitedPerPlan?: boolean;
}

export interface Trade {
  id: string;
  tradeGroupId?: string;
  userId: string;
  date: string; // YYYY-MM-DD
  timezone: string;
  sessionId?: string;
  isOutOfSession: boolean;
  accountId: string;
  instrument: string;
  market?: string;
  direction: TradeDirection;
  status: TradeLifecycleStatus;
  bias?: string;
  timeframe?: string;
  entryType?: string;
  setupLabel?: string;
  entryTimestamp?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionSize?: number;
  plannedRisk?: number;
  riskPercent?: number;
  expectedProfitPercent?: number;
  actualProfitPercent?: number;
  tpOutcome?: TpOutcome;
  slOutcome?: SlOutcome;
  exitOutcome?: ExitOutcome;
  entryReason?: string;
  expectedOutcome?: string;
  preEntryEmotion?: string;
  confidence?: number;
  antiBiasPauseCompleted?: boolean;
  duringTradeDurationSeconds?: number;
  exitTimestamp?: string;
  exitPrice?: number;
  exitReason?: string;
  actualOutcome?: string;
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  netPnl?: number;
  realisedR?: number;
  result: TradeResult;
  postExitEmotions?: string[];
  mistakes?: string[];
  lessons?: string;
  disciplineQuestions?: DisciplineQuestions;
  attachmentIds?: string[];
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TradeEvent {
  id: string;
  userId: string;
  tradeId: string;
  phase: TradePhase;
  eventType: string;
  label: string;
  details?: string;
  price?: number;
  quantity?: number;
  emotion?: string;
  timestamp: string;
  timezone?: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
}

export interface TradeGroup {
  id: string;
  userId: string;
  name: string;
  description?: string;
  date?: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Attachment {
  id: string;
  userId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  caption?: string;
  dataUrl: string;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
}

export interface SessionTemplate {
  id: string;
  userId: string;
  name: string;
  market?: string;
  plannedStartTime: string; // HH:mm
  plannedEndTime: string; // HH:mm
  timezone: string;
  defaultChecklist: string[];
  notes?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChecklistDefinition {
  id: string;
  userId: string;
  name: string;
  scope: 'daily' | 'session' | 'pre_trade';
  items: string[];
  isDefault: boolean;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Instrument {
  id: string;
  userId: string;
  symbol: string;
  name?: string;
  market: InstrumentMarket;
  tickSize?: number;
  pointValue?: number;
  defaultCommission?: number;
  isActive: boolean;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPreferences {
  id: string;
  userId: string;
  timeframes: string[];
  setupLabels: string[];
  entryTypes: string[];
  sessionQuickActions: string[];
  antiBiasPauseSeconds: number;
  defaultAccountId?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Review {
  id: string;
  userId: string;
  reviewType: ReviewType;
  title: string;
  periodStart: string;
  periodEnd: string;
  strategyName?: string;
  summary?: string;
  tradingMistakes?: string;
  lessonsLearned?: string;
  behaviouralPatterns?: string;
  improvementGoals?: string;
  rating?: number;
  sourceApplication?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  unknownFields?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: AuditAction;
  details: string;
  recordCount: number;
  timestamp: string;
  createdAt?: unknown;
}

export interface ExportManifest {
  format: 'ATK-UTDS';
  format_version: string;
  export_timestamp: string;
  source_application: string;
  source_application_version: string;
  export_scope: 'complete_backup' | 'trading_records' | 'date_range';
  date_range?: { start: string; end: string };
  record_counts: Record<string, number>;
  attachment_count: number;
  checksum_sha256: string;
}

export interface WorkspaceDataset {
  profile: UserProfile | null;
  accounts: TradingAccount[];
  dailyJournals: DailyJournal[];
  sessions: TradingSession[];
  sessionEvents: SessionEvent[];
  trades: Trade[];
  tradeEvents: TradeEvent[];
  tradeGroups: TradeGroup[];
  attachments: Attachment[];
  sessionTemplates: SessionTemplate[];
  checklists: ChecklistDefinition[];
  instruments: Instrument[];
  preferences: UserPreferences | null;
  reviews: Review[];
  auditLogs: AuditLog[];
}
