import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  APP_NAME,
  DEFAULT_TIMEZONE,
  buildInitialAccount,
  buildInitialChecklists,
  buildInitialInstruments,
  buildInitialPreferences,
  buildInitialSessionTemplates,
  generateId,
} from '../domain/defaults';
import type {
  Attachment,
  AuditAction,
  AuditLog,
  ChecklistDefinition,
  DailyJournal,
  Instrument,
  Review,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradeEvent,
  TradeGroup,
  TradingAccount,
  TradingSession,
  UserPreferences,
  UserProfile,
  WorkspaceDataset,
} from '../domain/types';
import type { ConflictResolution, ParsedImportBundle } from '../domain/utds';
import {
  ALLOWED_TRADE_UPDATE_KEYS,
  StructuredAppError,
  isValidDocId,
} from '../domain/diagnostics';
import { OperationType, auth, db, handleFirestoreError } from './firebase';

const FIELD_MAX_LENGTHS: Record<string, number> = {
  tradeGroupId: 128,
  sessionId: 128,
  date: 16,
  timezone: 80,
  market: 40,
  timeframe: 24,
  entryType: 60,
  preEntryEmotion: 80,
  emotion: 80,
  eventType: 80,
  sourceApplication: 80,
  sourceCreatedAt: 64,
  sourceUpdatedAt: 64,
  timestamp: 64,
  entryTimestamp: 64,
  exitTimestamp: 64,
  label: 200,
  details: 2000,
  notes: 2000,
  exitReason: 2000,
  actualOutcome: 2000,
  expectedOutcome: 2000,
  entryReason: 4000,
  lessons: 4000,
  closingReflection: 8000,
  sessionSummary: 4000,
  sessionNotes: 8000,
  observations: 8000,
  preSessionPreparation: 4000,
  morningNotes: 8000,
  dailyReflection: 8000,
  plannedActivities: 4000,
  sessionBias: 200,
  bias: 120,
  setupLabel: 120,
  instrument: 40,
  sessionName: 140,
};

function sanitizeFieldValue(key: string, val: unknown): unknown {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : undefined;
  }
  if (typeof val === 'string') {
    const maxLen = FIELD_MAX_LENGTHS[key];
    return maxLen && val.length > maxLen ? val.slice(0, maxLen) : val;
  }
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined && item !== null)
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return cleanPayload(item as Record<string, unknown>);
        }
        return item;
      });
  }
  if (typeof val === 'object') {
    // Preserve Firestore FieldValue sentinels or Date objects untouched
    if ('_methodName' in (val as Record<string, unknown>) || val instanceof Date) {
      return val;
    }
    return cleanPayload(val as Record<string, unknown>);
  }
  return val;
}

export function cleanPayload<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = sanitizeFieldValue(k, v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out;
}

function userCol(uid: string, col: string) {
  return collection(db, 'users', uid, col);
}

function userDoc(uid: string, col: string, docId: string) {
  return doc(db, 'users', uid, col, docId);
}

export async function ensureUserWorkspace(params: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<UserProfile> {
  const { uid, email, displayName } = params;
  const profileRef = doc(db, 'users', uid);
  const path = `users/${uid}`;

  try {
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const nowIso = new Date().toISOString();
    const timezone = DEFAULT_TIMEZONE;
    const profile: UserProfile = {
      id: uid,
      userId: uid,
      email,
      displayName: displayName || email.split('@')[0] || 'Trader',
      timezone,
      currency: 'USD',
      theme: 'light',
      sourceApplication: APP_NAME,
      sourceCreatedAt: nowIso,
      sourceUpdatedAt: nowIso,
    };

    await setDoc(profileRef, {
      ...cleanPayload(profile as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Initialize baseline personal configuration (not fake trade history!)
    const defaultAccount = buildInitialAccount(uid, 'USD');
    const prefs = buildInitialPreferences(uid, defaultAccount.id);
    const checklists = buildInitialChecklists(uid);
    const templates = buildInitialSessionTemplates(uid, timezone);
    const instruments = buildInitialInstruments(uid);

    const batch = writeBatch(db);
    batch.set(userDoc(uid, 'accounts', defaultAccount.id), {
      ...cleanPayload(defaultAccount as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(userDoc(uid, 'preferences', prefs.id), {
      ...cleanPayload(prefs as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (const c of checklists) {
      batch.set(userDoc(uid, 'checklists', c.id), {
        ...cleanPayload(c as unknown as Record<string, unknown>),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const t of templates) {
      batch.set(userDoc(uid, 'session_templates', t.id), {
        ...cleanPayload(t as unknown as Record<string, unknown>),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const i of instruments) {
      batch.set(userDoc(uid, 'instruments', i.id), {
        ...cleanPayload(i as unknown as Record<string, unknown>),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function listUserSubcollection<T>(uid: string, subcol: string): Promise<T[]> {
  const path = `users/${uid}/${subcol}`;
  try {
    const q = query(userCol(uid, subcol), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as T);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function loadFullWorkspace(uid: string): Promise<WorkspaceDataset> {
  const profileRef = doc(db, 'users', uid);
  let profile: UserProfile | null = null;
  try {
    const pSnap = await getDoc(profileRef);
    profile = pSnap.exists() ? (pSnap.data() as UserProfile) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  const [
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    tradeEvents,
    tradeGroups,
    attachments,
    sessionTemplates,
    checklists,
    instruments,
    prefsList,
    reviews,
    auditLogs,
  ] = await Promise.all([
    listUserSubcollection<TradingAccount>(uid, 'accounts'),
    listUserSubcollection<DailyJournal>(uid, 'daily_journals'),
    listUserSubcollection<TradingSession>(uid, 'sessions'),
    listUserSubcollection<SessionEvent>(uid, 'session_events'),
    listUserSubcollection<Trade>(uid, 'trades'),
    listUserSubcollection<TradeEvent>(uid, 'trade_events'),
    listUserSubcollection<TradeGroup>(uid, 'trade_groups'),
    listUserSubcollection<Attachment>(uid, 'attachments'),
    listUserSubcollection<SessionTemplate>(uid, 'session_templates'),
    listUserSubcollection<ChecklistDefinition>(uid, 'checklists'),
    listUserSubcollection<Instrument>(uid, 'instruments'),
    listUserSubcollection<UserPreferences>(uid, 'preferences'),
    listUserSubcollection<Review>(uid, 'reviews'),
    listUserSubcollection<AuditLog>(uid, 'audit_logs'),
  ]);

  return {
    profile,
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    tradeEvents,
    tradeGroups,
    attachments,
    sessionTemplates,
    checklists,
    instruments,
    preferences: prefsList[0] ?? null,
    reviews,
    auditLogs: auditLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  };
}

export async function saveProfileUpdates(
  uid: string,
  updates: Partial<Pick<UserProfile, 'displayName' | 'timezone' | 'currency' | 'theme'>>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...cleanPayload(updates as Record<string, unknown>),
      sourceUpdatedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

const COLLECTIONS_WITH_SOURCE_META = new Set([
  'accounts',
  'daily_journals',
  'sessions',
  'trades',
  'trade_groups',
  'reviews',
  'users',
]);

const COLLECTIONS_IMMUTABLE_SOURCE_META = new Set([
  'session_events',
  'trade_events',
  'attachments',
]);

export function sanitizeSchemaPayloadForCollection(
  col: string,
  obj: Record<string, unknown>,
  mode: 'create' | 'update'
): Record<string, unknown> {
  const cleaned = cleanPayload(obj);
  if (mode === 'update') {
    delete cleaned.id;
    delete cleaned.userId;
    delete cleaned.createdAt;
    delete cleaned.sourceApplication;
    delete cleaned.sourceCreatedAt;
  }
  if (!COLLECTIONS_WITH_SOURCE_META.has(col)) {
    delete cleaned.sourceUpdatedAt;
    if (!COLLECTIONS_IMMUTABLE_SOURCE_META.has(col)) {
      delete cleaned.sourceApplication;
      delete cleaned.sourceCreatedAt;
    }
  }
  return cleaned;
}

export async function upsertEntity<T extends { id: string; userId: string }>(
  uid: string,
  col: string,
  entity: T,
  existsAlready: boolean,
  updateFields?: string[]
): Promise<void> {
  const path = `users/${uid}/${col}/${entity.id}`;
  const ref = userDoc(uid, col, entity.id);
  const nowIso = new Date().toISOString();
  const supportsSourceMeta = COLLECTIONS_WITH_SOURCE_META.has(col);

  try {
    if (!existsAlready) {
      const base: Record<string, unknown> = { ...entity };
      if (supportsSourceMeta) {
        base.sourceApplication = base.sourceApplication ?? APP_NAME;
        base.sourceCreatedAt = base.sourceCreatedAt ?? nowIso;
        base.sourceUpdatedAt = nowIso;
      }
      await setDoc(ref, {
        ...sanitizeSchemaPayloadForCollection(col, base, 'create'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const payload: Record<string, unknown> = {};
      if (updateFields && updateFields.length > 0) {
        const subset: Record<string, unknown> = {};
        for (const f of updateFields) {
          const val = (entity as Record<string, unknown>)[f];
          if (val !== undefined && val !== null) subset[f] = val;
        }
        Object.assign(payload, sanitizeSchemaPayloadForCollection(col, subset, 'update'));
      } else {
        Object.assign(
          payload,
          sanitizeSchemaPayloadForCollection(col, entity as Record<string, unknown>, 'update')
        );
      }
      if (supportsSourceMeta) {
        payload.sourceUpdatedAt = nowIso;
      }
      payload.updatedAt = serverTimestamp();
      await updateDoc(ref, payload);
    }
  } catch (err) {
    handleFirestoreError(
      err,
      existsAlready ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function createImmutableRecord<T extends { id: string; userId: string }>(
  uid: string,
  col: string,
  entity: T
): Promise<void> {
  const path = `users/${uid}/${col}/${entity.id}`;
  try {
    await setDoc(userDoc(uid, col, entity.id), {
      ...sanitizeSchemaPayloadForCollection(col, entity as Record<string, unknown>, 'create'),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function commitAtomicTradeClose(params: {
  uid: string;
  updatedTrade: Trade;
  updateFields: string[];
  closeEvent: TradeEvent;
  operationId: string;
  expectedSourceUpdatedAt?: string;
}): Promise<{ outcome: 'closed' | 'already_closed_by_this_op' }> {
  const { uid, updatedTrade, updateFields, closeEvent, operationId, expectedSourceUpdatedAt } = params;
  const tradePath = `users/${uid}/trades/${updatedTrade.id}`;
  const eventPath = `users/${uid}/trade_events/${closeEvent.id}`;
  const userRef = doc(db, 'users', uid);
  const tradeRef = userDoc(uid, 'trades', updatedTrade.id);
  const eventRef = userDoc(uid, 'trade_events', closeEvent.id);

  // Stage A: Client-side Authentication & Ownership separation
  const currentAuth = auth.currentUser;
  if (!currentAuth) {
    throw new StructuredAppError({
      message: 'Authentication session is missing before committing trade closure.',
      category: 'authentication',
      errorCode: 'AUTH_REQUIRED',
      userExplanation: 'Your session is not signed in. Sign in again to save this trade closure.',
      recommendedAction: 'Sign in with your Google workspace account and retry sync.',
      retryable: true,
      operationId,
    });
  }
  if (currentAuth.uid !== uid || updatedTrade.userId !== uid || closeEvent.userId !== uid) {
    throw new StructuredAppError({
      message: 'Workspace user ID mismatch prevented trade closure commit.',
      category: 'permission',
      errorCode: 'WORKSPACE_OWNER_MISMATCH',
      userExplanation: 'Signed-in account does not match the workspace owner for this trade.',
      recommendedAction: 'Sign in with the workspace owner account that created this trade.',
      retryable: false,
      operationId,
    });
  }
  if (currentAuth.emailVerified === false) {
    throw new StructuredAppError({
      message: 'Account email is not marked as verified on the authentication token.',
      category: 'permission',
      errorCode: 'EMAIL_NOT_VERIFIED',
      userExplanation:
        'Your Google account email is not marked as verified, so Cloud Vault rejected the write.',
      recommendedAction: 'Sign in with a verified Google account, then retry sync.',
      retryable: false,
      operationId,
    });
  }

  // Stage B: Document path, ID format & closure validation separation
  if (
    !isValidDocId(uid) ||
    !isValidDocId(updatedTrade.id) ||
    !isValidDocId(updatedTrade.accountId) ||
    !isValidDocId(closeEvent.id) ||
    (updatedTrade.sessionId && !isValidDocId(updatedTrade.sessionId))
  ) {
    throw new StructuredAppError({
      message: `Invalid document identifier format for trade close (${updatedTrade.id}).`,
      category: 'validation',
      errorCode: 'INVALID_DOCUMENT_ID',
      userExplanation: 'This trade record or event has an invalid document identifier format.',
      recommendedAction: 'Copy diagnostics and review the pending record identifier.',
      retryable: false,
      operationId,
    });
  }

  const trimmedReason = (updatedTrade.exitReason ?? '').trim();
  if (!trimmedReason) {
    throw new StructuredAppError({
      message: 'Trade could not be closed because an exit reason is required.',
      category: 'validation',
      errorCode: 'EXIT_REASON_REQUIRED',
      userExplanation: 'Trade could not be closed because an exit reason is required.',
      recommendedAction: 'Provide an exit reason before completing trade closure.',
      retryable: false,
      fieldErrors: { exitReason: 'Trade could not be closed because an exit reason is required.' },
      operationId,
      cloudStatus: 'unverified',
    });
  }
  if (updatedTrade.status !== 'closed' || !updatedTrade.exitTimestamp) {
    throw new StructuredAppError({
      message: 'Pending trade closure payload is missing status="closed" or exitTimestamp.',
      category: 'validation',
      errorCode: 'INCOMPLETE_CLOSE_PAYLOAD',
      userExplanation: 'The trade closure payload is incomplete (missing closed status or exit time).',
      recommendedAction: 'Open the trade and submit the Close Trade form again.',
      retryable: false,
      operationId,
      cloudStatus: 'unverified',
    });
  }
  if (
    !['pending', 'win', 'loss', 'breakeven'].includes(updatedTrade.result) ||
    (updatedTrade.tpOutcome &&
      !['pending', 'hit', 'partial', 'missed', 'not_used'].includes(updatedTrade.tpOutcome)) ||
    (updatedTrade.slOutcome &&
      !['pending', 'hit', 'trailed_be', 'moved', 'not_used'].includes(updatedTrade.slOutcome)) ||
    (updatedTrade.exitOutcome &&
      !['take_profit', 'stop_loss', 'manual_exit', 'breakeven'].includes(updatedTrade.exitOutcome))
  ) {
    throw new StructuredAppError({
      message: 'Pending trade closure contains an unsupported outcome or result value.',
      category: 'validation',
      errorCode: 'INVALID_TRADE_OUTCOME_ENUM',
      userExplanation: 'One or more outcome fields contain unsupported values.',
      recommendedAction: 'Review TP, SL, and Exit Outcome selections and retry.',
      retryable: false,
      operationId,
      cloudStatus: 'unverified',
    });
  }
  if (
    (updatedTrade.postExitEmotions && updatedTrade.postExitEmotions.length > 20) ||
    (updatedTrade.mistakes && updatedTrade.mistakes.length > 20) ||
    (updatedTrade.disciplineQuestions && Object.keys(updatedTrade.disciplineQuestions).length > 15)
  ) {
    throw new StructuredAppError({
      message: 'Trade closure exceeded blueprint array or map field limits.',
      category: 'validation',
      errorCode: 'FIELD_LIMIT_EXCEEDED',
      userExplanation: 'Too many tags or discipline keys were attached to this trade closure.',
      recommendedAction: 'Reduce selected emotion/mistake tags to 20 or fewer and retry.',
      retryable: false,
      operationId,
      cloudStatus: 'unverified',
    });
  }

  let batchKeys: string[] = [];
  let serverStatusBefore = 'unknown';
  let eventExistsBefore = false;
  let batchTargetsUsed: string[] = [tradePath];
  let serverMissingKeys: string[] = [];
  let serverExtraKeys: string[] = [];

  const REQUIRED_SERVER_TRADE_KEYS = [
    'id', 'userId', 'date', 'timezone', 'isOutOfSession', 'accountId',
    'instrument', 'direction', 'status', 'result', 'createdAt', 'updatedAt',
  ];
  const ALLOWED_SERVER_TRADE_KEYS = new Set<string>([
    ...ALLOWED_TRADE_UPDATE_KEYS,
    'id', 'userId', 'sourceApplication', 'sourceCreatedAt', 'createdAt', 'updatedAt',
  ]);

  try {
    // Stage C: Server state, parent user existence & staleness check
    const [userSnap, serverSnap, eventSnap] = await Promise.all([
      getDoc(userRef),
      getDoc(tradeRef),
      getDoc(eventRef),
    ]);
    eventExistsBefore = eventSnap.exists();

    if (!userSnap.exists()) {
      throw new StructuredAppError({
        message: `Workspace root profile users/${uid} was not found in Cloud Vault.`,
        category: 'database',
        errorCode: 'USER_PROFILE_MISSING',
        userExplanation:
          'Your workspace root profile is missing in Cloud Vault, preventing linked event creation.',
        recommendedAction: 'Reload your workspace so profile initialization runs, then retry sync.',
        retryable: true,
        operationId,
      });
    }

    if (!serverSnap.exists()) {
      throw new StructuredAppError({
        message: `Trade document ${updatedTrade.id} was not found in Cloud Vault.`,
        category: 'database',
        errorCode: 'TRADE_NOT_FOUND',
        userExplanation: 'This trade record could not be found in Cloud Vault.',
        recommendedAction: 'Reload your workspace to confirm whether this trade still exists.',
        retryable: false,
        operationId,
      });
    }

    const serverData = serverSnap.data() as Record<string, unknown>;
    serverStatusBefore = typeof serverData.status === 'string' ? serverData.status : 'unknown';
    const serverKeys = Object.keys(serverData);
    serverMissingKeys = REQUIRED_SERVER_TRADE_KEYS.filter((k) => !(k in serverData));
    serverExtraKeys = serverKeys.filter((k) => !ALLOWED_SERVER_TRADE_KEYS.has(k));

    if (serverData.userId && serverData.userId !== uid) {
      throw new StructuredAppError({
        message: `Trade ${updatedTrade.id} ownership mismatch.`,
        category: 'permission',
        errorCode: 'TRADE_OWNER_MISMATCH',
        userExplanation: 'This trade belongs to a different account and cannot be updated here.',
        recommendedAction: 'Verify you are signed in with the account that created this trade.',
        retryable: false,
        operationId,
      });
    }

    if (!serverData.createdAt) {
      throw new StructuredAppError({
        message: `Trade document ${updatedTrade.id} in Cloud Vault is missing server createdAt.`,
        category: 'database',
        errorCode: 'LEGACY_DOCUMENT_MISSING_TIMESTAMP',
        userExplanation:
          'The stored trade record is missing its creation timestamp required by Cloud Vault update rules.',
        recommendedAction: 'Copy diagnostics for support or re-import this record via UTDS backup.',
        retryable: false,
        operationId,
      });
    }

    if (serverData.status === 'closed') {
      if (eventSnap.exists() || serverData.exitTimestamp === updatedTrade.exitTimestamp) {
        return { outcome: 'already_closed_by_this_op' };
      }
      throw new StructuredAppError({
        message: `Trade ${updatedTrade.id} was already closed elsewhere in Cloud Vault.`,
        category: 'conflict',
        errorCode: 'TRADE_ALREADY_CLOSED_CONFLICT',
        userExplanation:
          'This record was already closed elsewhere. Please review the latest version before saving.',
        recommendedAction: 'Reload your workspace data and check this trade in the Trades ledger.',
        retryable: false,
        operationId,
      });
    }

    if (
      expectedSourceUpdatedAt &&
      typeof serverData.sourceUpdatedAt === 'string' &&
      serverData.sourceUpdatedAt > expectedSourceUpdatedAt
    ) {
      throw new StructuredAppError({
        message: `Trade ${updatedTrade.id} was modified more recently on Cloud Vault.`,
        category: 'conflict',
        errorCode: 'TRADE_STALE_CONFLICT',
        userExplanation:
          'This trade was updated more recently on another session or device. Reload before closing so newer edits are not overwritten.',
        recommendedAction: 'Reload your workspace data and confirm the latest trade state.',
        retryable: false,
        operationId,
      });
    }

    const subset: Record<string, unknown> = {};
    for (const f of updateFields) {
      if (!ALLOWED_TRADE_UPDATE_KEYS.has(f)) continue;
      const val = (updatedTrade as unknown as Record<string, unknown>)[f];
      if (val === undefined || val === null) continue;
      if (
        ['tpOutcome', 'slOutcome', 'exitOutcome', 'sessionId', 'tradeGroupId', 'market'].includes(f) &&
        typeof val === 'string' &&
        val.trim() === ''
      ) {
        continue;
      }
      if (
        (f === 'postExitEmotions' || f === 'mistakes') &&
        Array.isArray(val) &&
        val.length === 0 &&
        !(f in serverData)
      ) {
        continue;
      }
      if (f === 'lessons' && typeof val === 'string' && val.trim() === '' && !(f in serverData)) {
        continue;
      }
      subset[f] = val;
    }

    // Repair any corrupt empty-string enum values already sitting on the server document (within allowed update keys)
    const serverRepairs: Record<string, unknown> = {};
    for (const enumKey of ['tpOutcome', 'slOutcome', 'exitOutcome'] as const) {
      if (enumKey in serverData && typeof serverData[enumKey] === 'string' && serverData[enumKey].trim() === '' && !(enumKey in subset)) {
        serverRepairs[enumKey] = deleteField();
      }
    }
    for (const strKey of ['sessionId', 'tradeGroupId'] as const) {
      if (strKey in serverData && typeof serverData[strKey] === 'string' && !isValidDocId(serverData[strKey]) && !(strKey in subset)) {
        serverRepairs[strKey] = deleteField();
      }
    }

    const updatePayload: Record<string, unknown> = {
      ...cleanPayload({
        ...subset,
        exitReason: trimmedReason,
        sourceUpdatedAt: updatedTrade.exitTimestamp,
      }),
      ...serverRepairs,
      updatedAt: serverTimestamp(),
    };
    batchKeys = Object.keys(updatePayload);

    const ALLOWED_TRADE_EVENT_KEYS = new Set([
      'id',
      'userId',
      'tradeId',
      'phase',
      'eventType',
      'label',
      'details',
      'price',
      'quantity',
      'emotion',
      'timestamp',
      'timezone',
      'sourceApplication',
      'sourceCreatedAt',
      'unknownFields',
    ]);
    const filteredEvent: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(closeEvent as unknown as Record<string, unknown>)) {
      if (ALLOWED_TRADE_EVENT_KEYS.has(k) && v !== undefined && v !== null) {
        if (typeof v === 'string' && v.trim() === '' && k !== 'details') continue;
        filteredEvent[k] = v;
      }
    }
    const sanitizedEvent = cleanPayload({
      ...filteredEvent,
      id: closeEvent.id,
      userId: uid,
      tradeId: updatedTrade.id,
      phase: 'exit',
      eventType: closeEvent.eventType || 'trade_closed',
      label: closeEvent.label || `Closed ${updatedTrade.instrument || 'Trade'}`,
      details: trimmedReason,
      timestamp: closeEvent.timestamp || updatedTrade.exitTimestamp,
      sourceApplication: closeEvent.sourceApplication ?? APP_NAME,
      sourceCreatedAt: closeEvent.sourceCreatedAt ?? (closeEvent.timestamp || updatedTrade.exitTimestamp),
    });

    const summarizeShape = (obj: Record<string, unknown>): string =>
      Object.entries(obj)
        .map(([k, v]) => {
          if (v === null) return `${k}=null`;
          if (Array.isArray(v)) return `${k}=arr(${v.length}:${v.length > 0 ? typeof v[0] : 'empty'})`;
          if (typeof v === 'string') return `${k}=str(${v.length})`;
          if (typeof v === 'object') {
            const rec = v as Record<string, unknown>;
            if ('seconds' in rec && 'nanoseconds' in rec) return `${k}=ts`;
            if ('_methodName' in rec) return `${k}=sentinel`;
            return `${k}=map(${Object.keys(rec).length})`;
          }
          return `${k}=${typeof v}`;
        })
        .join(',');

    // Audit merged incoming document against exact firestore.rules predicates before/on failure
    const mergedTradeForAudit: Record<string, unknown> = { ...serverData, ...updatePayload };
    for (const [k, v] of Object.entries(serverRepairs)) {
      if (v) delete mergedTradeForAudit[k];
    }
    const REQUIRED_TRADE_KEYS = [
      'id', 'userId', 'date', 'timezone', 'isOutOfSession', 'accountId',
      'instrument', 'direction', 'status', 'result', 'createdAt', 'updatedAt',
    ];
    const ALLOWED_TRADE_DOC_KEYS = new Set([
      'id', 'tradeGroupId', 'userId', 'date', 'timezone', 'sessionId',
      'isOutOfSession', 'accountId', 'instrument', 'market', 'direction',
      'status', 'bias', 'timeframe', 'entryType', 'setupLabel',
      'entryTimestamp', 'entryPrice', 'stopLoss', 'takeProfit',
      'positionSize', 'plannedRisk', 'riskPercent',
      'expectedProfitPercent', 'actualProfitPercent', 'tpOutcome', 'slOutcome', 'exitOutcome',
      'entryReason', 'expectedOutcome', 'preEntryEmotion', 'confidence',
      'antiBiasPauseCompleted', 'duringTradeDurationSeconds',
      'exitTimestamp', 'exitPrice', 'exitReason', 'actualOutcome',
      'grossPnl', 'commission', 'otherCharges', 'netPnl', 'realisedR',
      'result', 'postExitEmotions', 'mistakes', 'lessons',
      'disciplineQuestions', 'attachmentIds', 'sourceApplication',
      'sourceCreatedAt', 'sourceUpdatedAt', 'unknownFields',
      'createdAt', 'updatedAt',
    ]);
    const auditTradeViolations = (docObj: Record<string, unknown>): string[] => {
      const v: string[] = [];
      for (const reqKey of REQUIRED_TRADE_KEYS) {
        if (!(reqKey in docObj)) v.push(`missing:${reqKey}`);
      }
      for (const docKey of Object.keys(docObj)) {
        if (!ALLOWED_TRADE_DOC_KEYS.has(docKey)) v.push(`extraKey:${docKey}`);
      }
      for (const upKey of Object.keys(updatePayload)) {
        if (upKey !== 'updatedAt' && !ALLOWED_TRADE_UPDATE_KEYS.has(upKey)) {
          v.push(`disallowedUpdate:${upKey}`);
        }
      }
      if (!isValidDocId(docObj.id) || docObj.id !== updatedTrade.id) v.push(`id:${typeof docObj.id}`);
      if (docObj.userId !== uid) v.push(`userId:${typeof docObj.userId}`);
      if (typeof docObj.date !== 'string' || docObj.date.length > 16) v.push(`date:${typeof docObj.date}`);
      if (typeof docObj.timezone !== 'string' || docObj.timezone.length > 80) v.push(`timezone:${typeof docObj.timezone}`);
      if (typeof docObj.isOutOfSession !== 'boolean') v.push(`isOutOfSession:${typeof docObj.isOutOfSession}`);
      if (!isValidDocId(docObj.accountId)) v.push(`accountId:${typeof docObj.accountId}`);
      if (typeof docObj.instrument !== 'string' || docObj.instrument.length < 1 || docObj.instrument.length > 40) v.push(`instrument:${typeof docObj.instrument}`);
      if (!['long', 'short'].includes(String(docObj.direction))) v.push(`direction:${String(docObj.direction)}`);
      if (!['before_entry', 'during_trade', 'closed'].includes(String(docObj.status))) v.push(`status:${String(docObj.status)}`);
      if (!['pending', 'win', 'loss', 'breakeven'].includes(String(docObj.result))) v.push(`result:${String(docObj.result)}`);
      const optStrLimits: Array<[string, number]> = [
        ['tradeGroupId', 128], ['sessionId', 128], ['market', 40], ['bias', 120],
        ['timeframe', 24], ['entryType', 60], ['setupLabel', 120], ['entryTimestamp', 64],
        ['entryReason', 4000], ['expectedOutcome', 2000], ['preEntryEmotion', 80],
        ['exitTimestamp', 64], ['exitReason', 2000], ['actualOutcome', 2000],
        ['lessons', 4000], ['sourceApplication', 80], ['sourceCreatedAt', 64], ['sourceUpdatedAt', 64],
      ];
      for (const [k, max] of optStrLimits) {
        const val = docObj[k];
        if (val !== undefined && val !== null && (typeof val !== 'string' || val.length > max)) {
          v.push(`${k}:${typeof val}(len=${typeof val === 'string' ? val.length : 'na'})`);
        }
      }
      const optNums = [
        'entryPrice', 'stopLoss', 'takeProfit', 'positionSize', 'plannedRisk',
        'riskPercent', 'expectedProfitPercent', 'actualProfitPercent', 'confidence',
        'duringTradeDurationSeconds', 'exitPrice', 'grossPnl', 'commission',
        'otherCharges', 'netPnl', 'realisedR',
      ];
      for (const k of optNums) {
        const val = docObj[k];
        if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val))) {
          v.push(`${k}:${typeof val}`);
        }
      }
      if (docObj.antiBiasPauseCompleted !== undefined && docObj.antiBiasPauseCompleted !== null && typeof docObj.antiBiasPauseCompleted !== 'boolean') {
        v.push(`antiBiasPauseCompleted:${typeof docObj.antiBiasPauseCompleted}`);
      }
      if (docObj.tpOutcome !== undefined && docObj.tpOutcome !== null && !['pending', 'hit', 'partial', 'missed', 'not_used'].includes(String(docObj.tpOutcome))) {
        v.push(`tpOutcome:${String(docObj.tpOutcome)}`);
      }
      if (docObj.slOutcome !== undefined && docObj.slOutcome !== null && !['pending', 'hit', 'trailed_be', 'moved', 'not_used'].includes(String(docObj.slOutcome))) {
        v.push(`slOutcome:${String(docObj.slOutcome)}`);
      }
      if (docObj.exitOutcome !== undefined && docObj.exitOutcome !== null && !['take_profit', 'stop_loss', 'manual_exit', 'breakeven'].includes(String(docObj.exitOutcome))) {
        v.push(`exitOutcome:${String(docObj.exitOutcome)}`);
      }
      for (const arrKey of ['postExitEmotions', 'mistakes', 'attachmentIds']) {
        const val = docObj[arrKey];
        if (val !== undefined && val !== null) {
          if (!Array.isArray(val) || val.length > 20 || (val.length > 0 && typeof val[0] !== 'string')) {
            v.push(`${arrKey}:invalidList`);
          }
        }
      }
      for (const [mapKey, maxKeys] of [['disciplineQuestions', 15], ['unknownFields', 30]] as const) {
        const val = docObj[mapKey];
        if (val !== undefined && val !== null) {
          if (typeof val !== 'object' || Array.isArray(val) || Object.keys(val as Record<string, unknown>).length > maxKeys) {
            v.push(`${mapKey}:invalidMap`);
          }
        }
      }
      return v;
    };

    const auditEventViolations = (evObj: Record<string, unknown>): string[] => {
      const v: string[] = [];
      if (!isValidDocId(evObj.id) || evObj.id !== closeEvent.id) v.push(`id:${typeof evObj.id}`);
      if (evObj.userId !== uid) v.push(`userId:${typeof evObj.userId}`);
      if (!isValidDocId(evObj.tradeId)) v.push(`tradeId:${typeof evObj.tradeId}`);
      if (!['before_entry', 'during_trade', 'exit'].includes(String(evObj.phase))) v.push(`phase:${String(evObj.phase)}`);
      if (typeof evObj.eventType !== 'string' || evObj.eventType.length > 80) v.push(`eventType:${typeof evObj.eventType}`);
      if (typeof evObj.label !== 'string' || evObj.label.length < 1 || evObj.label.length > 200) {
        v.push(`label:${typeof evObj.label}(len=${typeof evObj.label === 'string' ? evObj.label.length : 'na'})`);
      }
      if (typeof evObj.timestamp !== 'string' || evObj.timestamp.length > 64) {
        v.push(`timestamp:${typeof evObj.timestamp}`);
      }
      const optStrLimits: Array<[string, number]> = [
        ['details', 2000], ['emotion', 80], ['timezone', 80], ['sourceApplication', 80], ['sourceCreatedAt', 64],
      ];
      for (const [k, max] of optStrLimits) {
        const val = evObj[k];
        if (val !== undefined && val !== null && (typeof val !== 'string' || val.length > max)) {
          v.push(`${k}:${typeof val}`);
        }
      }
      for (const numKey of ['price', 'quantity']) {
        const val = evObj[numKey];
        if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val))) {
          v.push(`${numKey}:${typeof val}`);
        }
      }
      if (evObj.unknownFields !== undefined && evObj.unknownFields !== null) {
        if (typeof evObj.unknownFields !== 'object' || Array.isArray(evObj.unknownFields) || Object.keys(evObj.unknownFields as Record<string, unknown>).length > 30) {
          v.push('unknownFields:invalidMap');
        }
      }
      return v;
    };

    const tradeViolations = auditTradeViolations(mergedTradeForAudit);
    const eventPayloadWithServerTs = {
      ...sanitizedEvent,
      createdAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.update(tradeRef, updatePayload);
    if (!eventSnap.exists()) {
      batch.set(eventRef, eventPayloadWithServerTs);
      batchTargetsUsed = [tradePath, eventPath];
    } else {
      batchTargetsUsed = [tradePath];
    }
    try {
      await batch.commit();
      return { outcome: 'closed' };
    } catch (batchErr) {
      const batchCode =
        batchErr && typeof batchErr === 'object' && 'code' in batchErr
          ? String((batchErr as { code?: unknown }).code)
          : '';
      const eventViolations = auditEventViolations(sanitizedEvent);
      let failedTarget = 'batch';
      let targetErrDetail: string | null = null;

      // Isolate whether trade_update or trade_event_create is blocked (and complete both sequentially if batch semantics caused the rejection)
      let baseUpdateProbe: string | null = null;
      if (batchCode === 'permission-denied') {
        try {
          await updateDoc(tradeRef, updatePayload);
          if (!eventSnap.exists()) {
            try {
              await setDoc(eventRef, eventPayloadWithServerTs);
              return { outcome: 'closed' };
            } catch (evErr) {
              failedTarget = 'trade_event_create';
              const evCode = evErr && typeof evErr === 'object' && 'code' in evErr ? String((evErr as { code?: unknown }).code) : 'unknown';
              targetErrDetail = `${evCode}:${evErr instanceof Error ? evErr.message : String(evErr)}`;
            }
          } else {
            return { outcome: 'closed' };
          }
        } catch (upErr) {
          failedTarget = 'trade_update';
          const upCode = upErr && typeof upErr === 'object' && 'code' in upErr ? String((upErr as { code?: unknown }).code) : 'unknown';
          targetErrDetail = `${upCode}:${upErr instanceof Error ? upErr.message : String(upErr)}`;
          // Non-destructive probe: test whether minimal updatedAt-only update passes allow update on this existing trade
          try {
            await updateDoc(tradeRef, { updatedAt: serverTimestamp() });
            baseUpdateProbe = 'ok';
          } catch (probeErr) {
            const pCode = probeErr && typeof probeErr === 'object' && 'code' in probeErr ? String((probeErr as { code?: unknown }).code) : 'unknown';
            baseUpdateProbe = `denied:${pCode}`;
          }
        }
      }

      const extraMeta = [
        `failedTarget=${failedTarget}`,
        targetErrDetail ? `targetErr=${targetErrDetail}` : null,
        baseUpdateProbe ? `baseUpdateProbe=${baseUpdateProbe}` : null,
        tradeViolations.length > 0 ? `tradeRuleViolations=${tradeViolations.join('|')}` : null,
        eventViolations.length > 0 ? `eventRuleViolations=${eventViolations.join('|')}` : null,
        `serverShape=${summarizeShape(serverData)}`,
        `updateShape=${summarizeShape(updatePayload)}`,
      ].filter(Boolean);
      const baseMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      const enrichedBatchErr = new Error(`${baseMsg} (${extraMeta.join(' ')})`);
      if (batchErr && typeof batchErr === 'object' && 'code' in batchErr) {
        (enrichedBatchErr as Error & { code?: unknown }).code = (batchErr as { code?: unknown }).code;
      }
      throw enrichedBatchErr;
    }
  } catch (err) {
    if (err instanceof StructuredAppError) {
      throw err;
    }
    const baseMsg = err instanceof Error ? err.message : String(err);
    const metaParts = [
      `batchCount=${batchTargetsUsed.length}`,
      `batchTargets=${batchTargetsUsed.join(',')}`,
      `eventExists=${eventExistsBefore}`,
      `serverStatus=${serverStatusBefore}`,
      `updateKeys=${batchKeys.join(',')}`,
      serverMissingKeys.length > 0 ? `serverMissingKeys=${serverMissingKeys.join(',')}` : null,
      serverExtraKeys.length > 0 ? `serverExtraKeys=${serverExtraKeys.join(',')}` : null,
    ].filter(Boolean);
    const enrichedErr = new Error(`${baseMsg} [${metaParts.join(' ')}]`);
    if (err && typeof err === 'object' && 'code' in err) {
      (enrichedErr as Error & { code?: unknown }).code = (err as { code?: unknown }).code;
    }
    handleFirestoreError(enrichedErr, OperationType.UPDATE, tradePath);
  }
}

export async function commitAtomicTradeCreate(params: {
  uid: string;
  trade: Trade;
  event: TradeEvent;
  sessionToUpdate?: TradingSession;
}): Promise<void> {
  const { uid, trade, event, sessionToUpdate } = params;
  const path = `users/${uid}/trades/${trade.id}`;
  const nowIso = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.set(userDoc(uid, 'trades', trade.id), {
      ...cleanPayload({
        ...trade,
        sourceApplication: trade.sourceApplication ?? APP_NAME,
        sourceCreatedAt: trade.sourceCreatedAt ?? nowIso,
        sourceUpdatedAt: nowIso,
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(userDoc(uid, 'trade_events', event.id), {
      ...cleanPayload(event as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
    });
    if (sessionToUpdate) {
      batch.update(userDoc(uid, 'sessions', sessionToUpdate.id), {
        linkedTradeCount: sessionToUpdate.linkedTradeCount,
        sourceUpdatedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function commitAtomicTradeEnter(params: {
  uid: string;
  updatedTrade: Trade;
  updateFields: string[];
  event: TradeEvent;
}): Promise<void> {
  const { uid, updatedTrade, updateFields, event } = params;
  const path = `users/${uid}/trades/${updatedTrade.id}`;
  const nowIso = new Date().toISOString();
  try {
    const subset: Record<string, unknown> = {};
    for (const f of updateFields) {
      const val = (updatedTrade as unknown as Record<string, unknown>)[f];
      if (val !== undefined && val !== null) subset[f] = val;
    }
    const batch = writeBatch(db);
    batch.update(userDoc(uid, 'trades', updatedTrade.id), {
      ...cleanPayload(subset),
      sourceUpdatedAt: nowIso,
      updatedAt: serverTimestamp(),
    });
    batch.set(userDoc(uid, 'trade_events', event.id), {
      ...cleanPayload(event as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function commitAtomicSessionStart(params: {
  uid: string;
  session: TradingSession;
  startEvent: SessionEvent;
  newDailyJournal?: DailyJournal;
}): Promise<void> {
  const { uid, session, startEvent, newDailyJournal } = params;
  const path = `users/${uid}/sessions/${session.id}`;
  const nowIso = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.set(userDoc(uid, 'sessions', session.id), {
      ...cleanPayload({
        ...session,
        sourceApplication: session.sourceApplication ?? APP_NAME,
        sourceCreatedAt: session.sourceCreatedAt ?? nowIso,
        sourceUpdatedAt: nowIso,
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(userDoc(uid, 'session_events', startEvent.id), {
      ...cleanPayload(startEvent as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
    });
    if (newDailyJournal) {
      batch.set(userDoc(uid, 'daily_journals', newDailyJournal.id), {
        ...cleanPayload({
          ...newDailyJournal,
          sourceApplication: newDailyJournal.sourceApplication ?? APP_NAME,
          sourceCreatedAt: newDailyJournal.sourceCreatedAt ?? nowIso,
          sourceUpdatedAt: nowIso,
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function commitAtomicSessionClose(params: {
  uid: string;
  updatedSession: TradingSession;
  updateFields: string[];
  closeEvent: SessionEvent;
}): Promise<void> {
  const { uid, updatedSession, updateFields, closeEvent } = params;
  const path = `users/${uid}/sessions/${updatedSession.id}`;
  const nowIso = new Date().toISOString();
  try {
    const subset: Record<string, unknown> = {};
    for (const f of updateFields) {
      const val = (updatedSession as unknown as Record<string, unknown>)[f];
      if (val !== undefined && val !== null) subset[f] = val;
    }
    const batch = writeBatch(db);
    batch.update(userDoc(uid, 'sessions', updatedSession.id), {
      ...cleanPayload(subset),
      sourceUpdatedAt: nowIso,
      updatedAt: serverTimestamp(),
    });
    batch.set(userDoc(uid, 'session_events', closeEvent.id), {
      ...cleanPayload(closeEvent as unknown as Record<string, unknown>),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteEntity(
  uid: string,
  col: string,
  id: string
): Promise<void> {
  const path = `users/${uid}/${col}/${id}`;
  try {
    await deleteDoc(userDoc(uid, col, id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function commitAtomicTradeDelete(params: {
  uid: string;
  tradeId: string;
  tradeEventIds: string[];
  attachmentIds: string[];
  sessionToUpdate?: { id: string; nextLinkedTradeCount: number };
}): Promise<void> {
  const { uid, tradeId, tradeEventIds, attachmentIds, sessionToUpdate } = params;
  const path = `users/${uid}/trades/${tradeId}`;
  const nowIso = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.delete(userDoc(uid, 'trades', tradeId));
    for (const evId of tradeEventIds) {
      batch.delete(userDoc(uid, 'trade_events', evId));
    }
    for (const attId of attachmentIds) {
      batch.delete(userDoc(uid, 'attachments', attId));
    }
    if (sessionToUpdate) {
      batch.update(userDoc(uid, 'sessions', sessionToUpdate.id), {
        linkedTradeCount: Math.max(0, sessionToUpdate.nextLinkedTradeCount),
        sourceUpdatedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function recordAuditLog(
  uid: string,
  action: AuditAction,
  details: string,
  recordCount: number
): Promise<AuditLog> {
  const log: AuditLog = {
    id: generateId('audit'),
    userId: uid,
    action,
    details: details.slice(0, 1900),
    recordCount,
    timestamp: new Date().toISOString(),
  };
  await createImmutableRecord(uid, 'audit_logs', log);
  return log;
}

export interface ImportCommitSummary {
  totalDetected: number;
  importedCount: number;
  skippedCount: number;
  replacedCount: number;
  copiedCount: number;
  attachmentsImported: number;
  errors: string[];
}

export async function executeSafeUtdsImport(
  uid: string,
  bundle: ParsedImportBundle,
  existing: WorkspaceDataset,
  resolutions: Record<string, ConflictResolution>
): Promise<ImportCommitSummary> {
  const summary: ImportCommitSummary = {
    totalDetected: bundle.totalDetected,
    importedCount: 0,
    skippedCount: 0,
    replacedCount: 0,
    copiedCount: 0,
    attachmentsImported: 0,
    errors: [],
  };

  // Maps oldId -> newId when user selects 'copy'
  const idRemap = new Map<string, string>();
  const conflictLookup = new Map(
    bundle.conflicts.map((c) => [`${c.entityType}:${c.id}`, resolutions[`${c.entityType}:${c.id}`] ?? c.resolution])
  );

  // Track created document paths for rollback if any batch fails
  const createdRefs: Array<{ col: string; id: string }> = [];

  type WriteOp = {
    col: string;
    id: string;
    data: Record<string, unknown>;
    mode: 'create' | 'update';
    isAttachment?: boolean;
  };

  const parentOps: WriteOp[] = [];
  const childOps: WriteOp[] = [];

  const planEntity = <T extends { id: string }>(
    entityType: string,
    col: string,
    list: T[],
    existingList: T[],
    hasUpdatedAt: boolean,
    rewriteRefs?: (item: T, resolvedId: string) => T
  ) => {
    const existingSet = new Set(existingList.map((e) => e.id));
    for (const rawItem of list) {
      const key = `${entityType}:${rawItem.id}`;
      const isDup = existingSet.has(rawItem.id);
      if (isDup) {
        const res = conflictLookup.get(key) ?? 'skip';
        if (res === 'skip') {
          summary.skippedCount += 1;
          continue;
        }
        if (res === 'copy') {
          const newId = generateId(entityType.slice(0, 3));
          idRemap.set(`${entityType}:${rawItem.id}`, newId);
          const remapped = rewriteRefs ? rewriteRefs(rawItem, newId) : { ...rawItem, id: newId };
          const payload: Record<string, unknown> = {
            ...sanitizeSchemaPayloadForCollection(col, remapped as unknown as Record<string, unknown>, 'create'),
            userId: uid,
            createdAt: serverTimestamp(),
            ...(hasUpdatedAt ? { updatedAt: serverTimestamp() } : {}),
          };
          const targetList = col === 'session_events' || col === 'trade_events' || col === 'attachments' ? childOps : parentOps;
          targetList.push({ col, id: newId, data: payload, mode: 'create', isAttachment: col === 'attachments' });
          summary.copiedCount += 1;
          continue;
        }
        // res === 'replace'
        if (col === 'session_events' || col === 'trade_events' || col === 'attachments') {
          // Immutable collections cannot be updated in-place; skip
          summary.skippedCount += 1;
        } else {
          const updatedItem = rewriteRefs ? rewriteRefs(rawItem, rawItem.id) : rawItem;
          const payload = sanitizeSchemaPayloadForCollection(
            col,
            updatedItem as unknown as Record<string, unknown>,
            'update'
          );
          payload.updatedAt = serverTimestamp();
          parentOps.push({ col, id: rawItem.id, data: payload, mode: 'update' });
          summary.replacedCount += 1;
        }
        continue;
      }

      const item = rewriteRefs ? rewriteRefs(rawItem, rawItem.id) : rawItem;
      const payload: Record<string, unknown> = {
        ...sanitizeSchemaPayloadForCollection(col, item as unknown as Record<string, unknown>, 'create'),
        userId: uid,
        createdAt: serverTimestamp(),
        ...(hasUpdatedAt ? { updatedAt: serverTimestamp() } : {}),
      };
      const targetList = col === 'session_events' || col === 'trade_events' || col === 'attachments' ? childOps : parentOps;
      targetList.push({ col, id: rawItem.id, data: payload, mode: 'create', isAttachment: col === 'attachments' });
    }
  };

  // 1. Independent & Parent Entities
  planEntity('account', 'accounts', bundle.dataset.accounts, existing.accounts, true);
  planEntity('daily_journal', 'daily_journals', bundle.dataset.dailyJournals, existing.dailyJournals, true);
  planEntity('session_template', 'session_templates', bundle.dataset.sessionTemplates, existing.sessionTemplates, true);
  planEntity('checklist', 'checklists', bundle.dataset.checklists, existing.checklists, true);
  planEntity('instrument', 'instruments', bundle.dataset.instruments, existing.instruments, true);
  planEntity('trade_group', 'trade_groups', bundle.dataset.tradeGroups, existing.tradeGroups, true);
  planEntity('review', 'reviews', bundle.dataset.reviews, existing.reviews, true);
  planEntity('session', 'sessions', bundle.dataset.sessions, existing.sessions, true, (s, newId) => ({
    ...s,
    id: newId,
    sessionTemplateId: s.sessionTemplateId
      ? idRemap.get(`session_template:${s.sessionTemplateId}`) ?? s.sessionTemplateId
      : undefined,
  }));

  planEntity('trade', 'trades', bundle.dataset.trades, existing.trades, true, (t, newId) => ({
    ...t,
    id: newId,
    accountId: idRemap.get(`account:${t.accountId}`) ?? t.accountId,
    sessionId: t.sessionId ? idRemap.get(`session:${t.sessionId}`) ?? t.sessionId : undefined,
    tradeGroupId: t.tradeGroupId
      ? idRemap.get(`trade_group:${t.tradeGroupId}`) ?? t.tradeGroupId
      : undefined,
  }));

  // 2. Child Entities (Events & Attachments) with remapped parent IDs
  planEntity('session_event', 'session_events', bundle.dataset.sessionEvents, existing.sessionEvents, false, (ev, newId) => ({
    ...ev,
    id: newId,
    sessionId: idRemap.get(`session:${ev.sessionId}`) ?? ev.sessionId,
  }));

  planEntity('trade_event', 'trade_events', bundle.dataset.tradeEvents, existing.tradeEvents, false, (ev, newId) => ({
    ...ev,
    id: newId,
    tradeId: idRemap.get(`trade:${ev.tradeId}`) ?? ev.tradeId,
  }));

  planEntity('attachment', 'attachments', bundle.dataset.attachments, existing.attachments, false, (att, newId) => {
    const parentType = att.entityType;
    const mappedEntityId = idRemap.get(`${parentType}:${att.entityId}`) ?? att.entityId;
    return {
      ...att,
      id: newId,
      entityId: mappedEntityId,
    };
  });

  const commitChunked = async (ops: WriteOp[]) => {
    const CHUNK = 350;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const slice = ops.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const op of slice) {
        const ref = userDoc(uid, op.col, op.id);
        if (op.mode === 'create') {
          batch.set(ref, op.data);
          createdRefs.push({ col: op.col, id: op.id });
        } else {
          batch.update(ref, op.data);
        }
      }
      await batch.commit();
      for (const op of slice) {
        if (op.isAttachment) summary.attachmentsImported += 1;
        summary.importedCount += 1;
      }
    }
  };

  try {
    await commitChunked(parentOps);
    await commitChunked(childOps);

    if (bundle.dataset.preferences && !existing.preferences) {
      await upsertEntity(uid, 'preferences', bundle.dataset.preferences, false);
      summary.importedCount += 1;
    }

    await recordAuditLog(
      uid,
      'import_commit',
      `Imported ${summary.importedCount} record(s) from ${bundle.manifest.source_application} (${bundle.manifest.format} v${bundle.manifest.format_version}). Skipped: ${summary.skippedCount}, Copied: ${summary.copiedCount}, Replaced: ${summary.replacedCount}.`,
      summary.importedCount
    );
  } catch (err) {
    // Recoverable rollback: remove newly created documents from failed import without touching pre-existing data
    const errMsg = err instanceof Error ? err.message : String(err);
    summary.errors.push(errMsg);
    try {
      const CHUNK = 350;
      for (let i = 0; i < createdRefs.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const item of createdRefs.slice(i, i + CHUNK)) {
          batch.delete(userDoc(uid, item.col, item.id));
        }
        await batch.commit();
      }
      await recordAuditLog(
        uid,
        'import_rollback',
        `Rolled back ${createdRefs.length} staged records after import error: ${errMsg}`,
        createdRefs.length
      );
    } catch (rbErr) {
      summary.errors.push(
        `Rollback warning: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`
      );
    }
    throw new Error(`Import failed and was rolled back safely: ${errMsg}`);
  }

  return summary;
}
