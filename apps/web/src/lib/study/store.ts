// The study state of a workspace. Cards, decks, deck settings, limits and
// FSRS sets are typed core rows (docs/contracts/study/), read from one sync
// pull; the keyed rows goals:workspace, known:*, vacation:* and milestone:* stay plugin
// data of the study namespace `qinqin-flashcards`. A missing current workspace is an error: study
// data must never fall back to user-global or another workspace's rows.
// The one explicit exception: `vacation:*` rows are user-global (they
// apply to every workspace or a chosen list) and are read from rows with
// no workspace (docs/contracts/scheduler/).
// The daily goal is goals:workspace (docs/contracts/goals/).

import { get } from "svelte/store";
import { ApiError, api } from "../api/client";
import { newUlid } from "../ulid";
import { t } from "../i18n";
import { V2_STUDY_COLLECTIONS, firstPageUrl, pullAll } from "../sync/pager";
import { workspaces } from "../workspaces";
import { fetchFullLog, type StudyEvent } from "../events";
import { canonicalCards, cleanSkipKinds, compareCanonical, newCardId } from "./canonical";
import {
  DEFAULT_W,
  resolveState,
  type ParamSet,
} from "./fsrs/params";
import {
  cleanCardTypes,
  type DeckSettings,
} from "./deckSettings";
import type { NewOrder } from "./newOrder";
import { cardKey, parseReview } from "./reviewParse";
import { liveReviews } from "./replaced";
import {
  STUDY_COLLECTIONS,
  activeOf,
  activeRow,
  bodyOf,
  cardRow,
  deckRow,
  limitsRow,
  sameBody,
  setRow,
  settingsRow,
  studyKey,
  cardOf,
  deckOf,
  identityOf,
  legacyFamily,
  limitsOf,
  parseRow,
  setOf,
  settingsOf,
  type CardRow,
  type DeckRow,
  type DeckSettingsRow,
  type FsrsSetRow,
  type FsrsActiveRow,
  type LimitsRow,
  type StudyCollection,
  type StudyRow,
  type StudyRowBody,
} from "./rows";
import { VACATION_PREFIX, parseVacation, type VacationPeriod } from "./vacation";
import type { LimitPair } from "./limits";
import { GOALS_KEY, parseGoalsRow, type GoalsRow, type ParsedGoals } from "../goals/goals";
import { pendingReviews } from "./events";
import { outboxUser } from "./outboxUser";
import { recentSentReviews } from "./recentSent";
import { KNOWN_PREFIX, knownMarkKey, knownMarkRow, parseKnownMark } from "./knownMarks";
import { MILESTONE_KEY_PREFIX } from "../milestones/catalogue";
import { parseSeenRows, tombstoneStamps } from "../milestones/seen";
import {
  type Deck,
  type OptInKind,
  type ReviewEvent,
  type StudyCard,
  type StudyCardKind,
  type StudyData,
  type StudyHistory,
} from "./types";

export const FLASHCARDS_PLUGIN_ID = "qinqin-flashcards";

// The implicit deck always exists; it is never written to plugin data.
export const GENERAL_DECK_ID = "general";

// Only the fields the study layer reads; the server sends more.
interface PluginDataRow {
  pluginId: string;
  key: string;
  workspaceId: number | null;
  data: unknown;
  deletedAt: unknown;
  updatedAt: unknown;
}

type SyncDelta = { pluginData?: unknown } & Partial<Record<StudyCollection, unknown>>;

/**
 * The study pull is a paged round (docs/contracts/sync/): the keyed plugin rows
 * (goals, known marks, vacations), the feature switches and the six typed study
 * collections of one workspace plus user-global rows, merged in page order.
 */
const pulledPages = new Map<number, number>();

/** How many pages the last study pull of a workspace took (the offline receipt counts them). */
export function studyPullPages(workspaceId: number): number {
  return pulledPages.get(workspaceId) ?? 0;
}

async function pullStudy(workspaceId: number): Promise<SyncDelta> {
  // tombstones=1: the stamps in knownAt must include the server's
  // tombstones, or a re-add from a slower clock loses to them (stampOf).
  const first = firstPageUrl({ collections: V2_STUDY_COLLECTIONS, workspace: workspaceId, tombstones: true });
  const round = await pullAll((path) => api<unknown>(path), first, V2_STUDY_COLLECTIONS);
  pulledPages.set(workspaceId, round.pages);
  return round.collections as SyncDelta;
}

/**
 * requireWorkspaceId returns the selected workspace id. Study data is
 * workspace-scoped, so there is nothing sensible to read or write
 * without one; callers get a plain Error instead of silently writing
 * user-global rows.
 */
function requireWorkspaceId(): number {
  const workspace = get(workspaces).current;
  if (workspace === null) {
    throw new Error("no workspace selected: study data is workspace-scoped");
  }
  return workspace.id;
}

function dataPath(key: string, workspaceId: number): string {
  return `/api/plugins/${FLASHCARDS_PLUGIN_ID}/data/${key}?workspace=${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * decodeData unwraps a plugin data payload. The API serves it as JSON,
 * but a row may still carry it as a string when a caller constructed
 * the fixture (or an older client wrote one); unparsable data is
 * treated as absent.
 */
function decodeData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function asPluginDataRow(value: unknown): PluginDataRow | null {
  if (!isRecord(value)) return null;
  const { pluginId, key, workspaceId, data, deletedAt, updatedAt } = value;
  if (typeof pluginId !== "string" || typeof key !== "string") return null;
  const workspace = workspaceId === undefined ? null : workspaceId;
  if (workspace !== null && typeof workspace !== "number") return null;
  return { pluginId, key, workspaceId: workspace, data, deletedAt, updatedAt };
}

/** The newest time the server holds for a row, live or tombstoned. */
function newestOf(times: readonly unknown[]): string | undefined {
  return times
    .filter((t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

/**
 * What the server holds for the rows of one workspace, read with the study
 * data, so a write can be planned against it (studyWrite): `knownAt` is the
 * newest time per row (`<collection>:<identity>` for typed rows, the plugin
 * key for keyed rows), `stored` every typed row, tombstones included.
 */
export interface StudySnapshot {
  knownAt: Map<string, string>;
  stored: Map<string, StudyRow>;
}

function newSnapshot(): StudySnapshot {
  return { knownAt: new Map(), stored: new Map() };
}

/**
 * fetchStudyData pulls every synced row and keeps the live flashcard rows
 * of one workspace. Rows of other plugins, other (or no) workspaces,
 * tombstones, and keys outside `deck:`/`card:` are ignored; a malformed
 * payload is skipped rather than failing the whole page.
 */
async function fetchStudyData(
  workspaceId: number,
  snap?: StudySnapshot,
): Promise<StudyData> {
  const knownAt = snap?.knownAt;
  const delta = await pullStudy(workspaceId);
  const rows = Array.isArray(delta?.pluginData) ? delta.pluginData : [];
  const decks: Deck[] = [];
  const cards: StudyCard[] = [];
  const sets: ParamSet[] = [];
  const deckSettings: Record<string, DeckSettings> = {};
  const vacations: VacationPeriod[] = [];
  let limitsWorkspace: Partial<LimitPair> | null = null;
  const limitsDecks: Record<string, Partial<LimitPair>> = {};
  let activeRaw: unknown = null;
  let goals: ParsedGoals = null;
  const known: number[] = [];
  const milestoneRows: { key: string; data: unknown; deletedAt: string | null; updatedAt?: string }[] = [];

  for (const collection of STUDY_COLLECTIONS) {
    const list = delta?.[collection];
    for (const raw of Array.isArray(list) ? list : []) {
      // A row the strict parse refuses is skipped rather than failing the page.
      const row = parseRow(collection, raw);
      if (row === null || row.workspaceId !== workspaceId) continue;
      if (knownAt !== undefined) {
        const newest = newestOf([row.updatedAt, row.deletedAt]);
        if (newest !== undefined) knownAt.set(studyKey(collection, identityOf(collection, row)), newest);
      }
      snap?.stored.set(studyKey(collection, identityOf(collection, row)), row);
      if (row.deletedAt !== null) continue;
      switch (collection) {
        case "cards":
          cards.push(cardOf(row as CardRow));
          break;
        case "decks":
          decks.push(deckOf(row as DeckRow));
          break;
        case "deckSettings": {
          const settings = settingsOf(row as DeckSettingsRow);
          deckSettings[settings.deckId] = settings;
          break;
        }
        case "limits": {
          const limits = row as LimitsRow;
          if (limits.deckId === null) limitsWorkspace = limitsOf(limits);
          else limitsDecks[limits.deckId] = limitsOf(limits);
          break;
        }
        case "fsrsSets": {
          const set = setOf(row as FsrsSetRow);
          if (set !== null) sets.push(set);
          break;
        }
        case "fsrsActive":
          activeRaw = activeOf(row as FsrsActiveRow);
          break;
      }
    }
  }

  for (const value of rows) {
    const row = asPluginDataRow(value);
    if (row === null) continue;
    if (row.pluginId !== FLASHCARDS_PLUGIN_ID) continue;
    // A typed-family key in pluginData is a leftover the server could not
    // read (or an old server's legacy view): never study state.
    if (legacyFamily(row.key) !== null) continue;
    if (row.workspaceId === null && row.key.startsWith(VACATION_PREFIX)) {
      if (row.deletedAt != null) continue;
      const period = parseVacation(row.key, decodeData(row.data));
      if (period !== null) vacations.push(period);
      continue;
    }
    if (row.workspaceId !== workspaceId) continue;
    if (knownAt !== undefined) {
      const newest = newestOf([row.updatedAt, row.deletedAt]);
      if (newest !== undefined) knownAt.set(row.key, newest);
    }
    if (row.key.startsWith(MILESTONE_KEY_PREFIX)) {
      // Seen milestones: tombstones too (a tombstone reads as not seen).
      milestoneRows.push({
        key: row.key,
        data: row.deletedAt != null ? null : decodeData(row.data),
        deletedAt: row.deletedAt == null ? null : String(row.deletedAt),
        ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
      });
      continue;
    }
    if (row.deletedAt != null) continue;

    const data = decodeData(row.data);
    if (row.key === GOALS_KEY) {
      goals = parseGoalsRow(data);
    } else if (row.key.startsWith(KNOWN_PREFIX)) {
      const entryId = parseKnownMark(row.key, data);
      if (entryId !== null) known.push(entryId);
    }
  }

  const seenMilestones = parseSeenRows(milestoneRows);
  const milestoneTombstones = tombstoneStamps(milestoneRows);
  // Absent (not empty) without any deckcfg row: workspaces that never
  // configured a deck read exactly as before.
  return {
    decks,
    cards,
    fsrs: resolveState(sets, activeRaw),
    ...(Object.keys(deckSettings).length > 0 ? { deckSettings } : {}),
    ...(vacations.length > 0 ? { vacations } : {}),
    ...(limitsWorkspace !== null || Object.keys(limitsDecks).length > 0
      ? { limits: { workspace: limitsWorkspace, decks: limitsDecks } }
      : {}),
    ...(goals === null ? {} : { goals }),
    ...(known.length > 0 ? { known } : {}),
    ...(seenMilestones.size > 0 ? { seenMilestones } : {}),
    ...(milestoneTombstones.size > 0 ? { milestoneTombstones } : {}),
  };
}

/** The keys of typed rows in `knownAt` and `stored`: `<collection>:<identity>`. */
export const studyRowKey = {
  deck: (id: string): string => studyKey("decks", id),
  card: (id: string): string => studyKey("cards", id),
  settings: (deckId: string): string => studyKey("deckSettings", deckId),
};

/**
 * loadRawStudyData reads the live decks and cards of a workspace as stored:
 * duplicate cards are NOT merged, so a writer sees every row it must keep
 * consistent (the decks view's add-to-deck plan). `knownAt` and `stored`
 * are what the server holds (StudySnapshot), for planning a write with
 * studyWrite. Pages that show or schedule cards use loadStudyData instead.
 */
export async function loadRawStudyData(
  workspaceId: number,
): Promise<{
  decks: Deck[];
  cards: StudyCard[];
  knownAt: Map<string, string>;
  /** Every typed row of the workspace, tombstones included. */
  stored: Map<string, StudyRow>;
  /** The live deck settings rows, by deck id (always set by the store). */
  deckSettings?: Record<string, DeckSettings>;
}> {
  const snap = newSnapshot();
  const { decks, cards, deckSettings } = await fetchStudyData(workspaceId, snap);
  return { decks, cards, knownAt: snap.knownAt, stored: snap.stored, deckSettings: deckSettings ?? {} };
}

// Called after every write with the workspace it touched, so caches of
// study data (studyData.ts) can drop what is now stale.
const writeListeners = new Set<(workspaceId: number) => void>();

/** onStudyWrite registers a listener for study-data writes; returns the unsubscribe. */
export function onStudyWrite(
  listener: (workspaceId: number) => void,
): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/** The write touched rows every workspace reads (user-global vacations). */
export const ALL_WORKSPACES = 0;

function notifyWrite(workspaceId: number): void {
  for (const listener of writeListeners) listener(workspaceId);
}

/** Only the keyed rows (goals, known marks) still use the plugin-data routes. */
function assertKeyedRow(key: string): void {
  if (legacyFamily(key) !== null) {
    throw new Error(`${key}: a typed study row is written through the typed push`);
  }
}

async function putData(
  workspaceId: number,
  key: string,
  value: unknown,
): Promise<void> {
  assertKeyedRow(key);
  try {
    await api(dataPath(key, workspaceId), { method: "PUT", body: value });
  } finally {
    // A failed write may still have landed: stale caches are dropped either way.
    notifyWrite(workspaceId);
  }
}

/**
 * PartialPushError: a batch write stopped. `done` rows were written; `skipped`
 * is how many the server did not apply because it holds a newer row for the key
 * (e.g. a later tombstone) or refused them. Re-planning and trying again writes
 * only what is still missing.
 */
export class PartialPushError extends Error {
  done: number;
  skipped: number;

  constructor(message: string, done: number, skipped = 0) {
    super(message);
    this.name = "PartialPushError";
    this.done = done;
    this.skipped = skipped;
  }
}

/** The earliest stamp that beats a row last written at `knownAt`: one millisecond later. */
function stampAfter(knownAt: string | undefined): number {
  const ms = knownAt === undefined ? NaN : Date.parse(knownAt);
  return Number.isNaN(ms) ? 0 : ms + 1;
}

interface PushResult {
  dataAccepted?: number;
  dataSkipped?: number;
  dataRefused?: number;
}

/** One typed study write: the row's typed body (no meta), its stored time, and whether it is a tombstone. */
export interface StudyWrite {
  collection: StudyCollection;
  row: StudyRowBody;
  /** The newest time the server holds for the row (StudySnapshot.knownAt). */
  knownAt?: string;
  deleted?: true;
}

type Snap = Partial<StudySnapshot> | undefined;

/** extraOf: the stored row's `extra` (a tombstone's too), echoed back on a write. */
export function extraOf(snap: Snap, collection: StudyCollection, identity: string): Record<string, unknown> {
  return { ...(snap?.stored?.get(studyKey(collection, identity))?.extra ?? {}) };
}

/**
 * studyWrite plans one typed write against what the server holds: null
 * when it would change nothing (the live row is equal, or a tombstone of a
 * row that is absent or already deleted) - the server would skip it, and a
 * skipped item reads as "the server holds newer data". A tombstone carries
 * the stored row's last data.
 */
export function studyWrite(
  snap: Snap,
  collection: StudyCollection,
  row: StudyRowBody,
  opts: { deleted?: boolean } = {},
): StudyWrite | null {
  const key = studyKey(collection, identityOf(collection, row));
  const stored = snap?.stored?.get(key);
  const live = stored !== undefined && stored.deletedAt === null;
  const knownAt = snap?.knownAt?.get(key);
  const at = knownAt === undefined ? {} : { knownAt };
  if (opts.deleted === true) {
    if (!live) return null;
    return { collection, row: bodyOf(stored), ...at, deleted: true };
  }
  if (live && sameBody(stored, row)) return null;
  return { collection, row, ...at };
}

/** studyDelete: the tombstone of a stored row, or null when it is not live. */
function studyDelete(snap: Snap, collection: StudyCollection, identity: string): StudyWrite | null {
  const stored = snap?.stored?.get(studyKey(collection, identity));
  return stored === undefined ? null : studyWrite(snap, collection, bodyOf(stored), { deleted: true });
}

function stampOf(nowMs: number, knownAt: string | undefined): string {
  // Last write wins on this stamp: never earlier than what the server
  // already holds for the row (a client clock behind the server's would
  // lose to a fresh tombstone for ever).
  return new Date(Math.max(nowMs, stampAfter(knownAt))).toISOString();
}

async function sendPush(body: Record<string, unknown>): Promise<PushResult> {
  return api<PushResult>("/api/sync/push", { method: "POST", body });
}

function typedBody(workspaceId: number, writes: readonly StudyWrite[], nowMs: number): Record<string, unknown[]> {
  const body: Record<string, unknown[]> = {};
  for (const write of writes) {
    const stamp = stampOf(nowMs, write.knownAt);
    (body[write.collection] ??= []).push({
      ...write.row,
      workspaceId,
      updatedAt: stamp,
      // A tombstone: the server skips it when it holds no live row.
      ...(write.deleted ? { deletedAt: stamp } : {}),
    });
  }
  return body;
}

/**
 * pushStudy writes typed study rows through POST /api/sync/push in
 * sequential chunks (last write wins on `updatedAt`, see stampOf). A chunk
 * the server only partly applied (a newer row won, or it refused one) is a
 * PartialPushError: callers must never report success for it. Listeners are
 * notified after each chunk.
 */
export async function pushStudy(
  workspaceId: number,
  writes: readonly StudyWrite[],
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  await pushChunks(workspaceId, writes.length, opts, (from, to, nowMs) =>
    typedBody(workspaceId, writes.slice(from, to), nowMs),
  );
}

/**
 * pushOptional writes one typed row whose loss is fine (a tombstone another
 * tab may have written already): false when the server skipped it.
 */
async function pushOptional(workspaceId: number, write: StudyWrite): Promise<boolean> {
  let result: PushResult;
  try {
    result = await sendPush(typedBody(workspaceId, [write], Date.now()));
  } finally {
    notifyWrite(workspaceId);
  }
  return (result?.dataSkipped ?? 0) + (result?.dataRefused ?? 0) === 0;
}

async function pushChunks(
  workspaceId: number,
  total: number,
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void },
  bodyOf: (from: number, to: number, nowMs: number) => Record<string, unknown>,
): Promise<void> {
  const size = Math.max(1, opts.chunk ?? 200);
  let done = 0;
  for (let i = 0; i < total; i += size) {
    const count = Math.min(size, total - i);
    let result: PushResult;
    try {
      result = await sendPush(bodyOf(i, i + count, Date.now()));
    } catch (err) {
      throw new PartialPushError(errorMessage(err, t("study.store.writeFailed")), done);
    } finally {
      // A failed write may still have landed: stale caches are dropped either way.
      notifyWrite(workspaceId);
    }
    const skipped = (result?.dataSkipped ?? 0) + (result?.dataRefused ?? 0);
    done += result?.dataAccepted ?? count - skipped;
    if (skipped > 0) {
      throw new PartialPushError(
        t("study.store.partialPush", { count: skipped }),
        done,
        skipped,
      );
    }
    opts.onProgress?.(done, total);
  }
}

/**
 * pushKeyedRows writes keyed plugin-data rows of the study namespace
 * (known marks) through POST /api/sync/push, like pushStudy.
 */
async function pushKeyedRows(
  workspaceId: number,
  rows: readonly { key: string; data: unknown; knownAt?: string; deleted?: true }[],
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  for (const row of rows) assertKeyedRow(row.key);
  await pushChunks(workspaceId, rows.length, opts, (from, to, nowMs) => ({
    pluginData: rows.slice(from, to).map((row) => {
      const stamp = stampOf(nowMs, row.knownAt);
      return {
        pluginId: FLASHCARDS_PLUGIN_ID,
        key: row.key,
        workspaceId,
        data: row.data,
        updatedAt: stamp,
        ...(row.deleted ? { deletedAt: stamp } : {}),
      };
    }),
  }));
}

async function deleteData(workspaceId: number, key: string): Promise<void> {
  assertKeyedRow(key);
  try {
    await api(dataPath(key, workspaceId), { method: "DELETE" });
  } finally {
    notifyWrite(workspaceId);
  }
}

/** fetchEvents reads the workspace's whole event log, uncached. */
function fetchEvents(workspaceId: number): Promise<StudyEvent[]> {
  return fetchFullLog(workspaceId);
}

/**
 * reviewsOf keeps the workspace's review events of an event log, without
 * the replaced ones (a changed grade, #131: `liveReviews`), on the stored
 * card ids, before the duplicate-card merge.
 */
function reviewsOf(
  workspaceId: number,
  events: readonly StudyEvent[],
): ReviewEvent[] {
  return liveReviews(
    events
      .map((event) =>
        event.workspaceId === workspaceId ? parseReview(event) : null,
      )
      .filter((event): event is ReviewEvent => event !== null),
  );
}

/**
 * withQueued adds the signed-in user's reviews that wait in the outbox (or were
 * sent since the log was read) to the log (deduplicated by id), so a card reviewed offline - or just before a
 * reload - is not shown as due again before the review has been sent. Another
 * user's queue, or any queue while no user is known, is never read.
 */
function withQueued(
  workspaceId: number,
  events: readonly StudyEvent[],
): readonly StudyEvent[] {
  const user = outboxUser();
  if (user === null) return events;
  // Unsent reviews, and reviews sent since the (possibly cached) log was read.
  const queued = [
    ...pendingReviews(user, workspaceId),
    ...recentSentReviews(user, workspaceId),
  ];
  if (queued.length === 0) return events;
  const known = new Set(events.map((event) => event.id));
  const extra: StudyEvent[] = [];
  for (const event of queued) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    extra.push(event);
  }
  return [...events, ...extra];
}

/**
 * loadStudyData is THE read of a workspace's study state for anything
 * that shows, counts or schedules cards: decks, cards and the review
 * history, with duplicate cards (one word added on two devices before
 * card ids were deterministic) merged by `canonicalCards` and their
 * reviews re-pointed to the surviving card. Every page and widget goes
 * through it (widgets through the cached loadStudyHistory, history.ts),
 * so no call site can forget the merge. The selected workspace is the
 * default; pass the id the caller captured so cards and reviews come
 * from the same workspace. Writes (addCard, deleteDeck) read the raw
 * rows instead, so they see and rewrite every stored duplicate.
 */
export async function loadStudyData(
  workspaceId?: number,
): Promise<StudyHistory> {
  return loadStudyDataWith(workspaceId ?? requireWorkspaceId(), fetchEvents);
}

/**
 * loadStudyDataWith is loadStudyData of one given workspace with the
 * event log read by `readEvents` (history.ts passes the cached log).
 */
export async function loadStudyDataWith(
  workspaceId: number,
  readEvents: (workspaceId: number) => Promise<readonly StudyEvent[]>,
): Promise<StudyHistory> {
  const [data, events] = await Promise.all([
    fetchStudyData(workspaceId),
    readEvents(workspaceId),
  ]);
  const { cards, reviews, merged } = canonicalCards(
    data.cards,
    reviewsOf(workspaceId, withQueued(workspaceId, events)),
  );
  return {
    decks: data.decks,
    cards,
    fsrs: data.fsrs,
    ...(data.deckSettings === undefined ? {} : { deckSettings: data.deckSettings }),
    ...(data.vacations === undefined ? {} : { vacations: data.vacations }),
    ...(data.limits === undefined ? {} : { limits: data.limits }),
    ...(data.goals === undefined ? {} : { goals: data.goals }),
    ...(data.known === undefined ? {} : { known: data.known }),
    ...(data.seenMilestones === undefined ? {} : { seenMilestones: data.seenMilestones }),
    ...(data.milestoneTombstones === undefined ? {} : { milestoneTombstones: data.milestoneTombstones }),
    reviews,
    merged,
  };
}

/**
 * loadStudyDataFor reads the raw flashcard rows of one given workspace
 * (one sync pull, duplicates included). studyData.ts caches it for
 * "is this word studied" checks; anything that counts or schedules cards
 * uses loadStudyData.
 */
export function loadStudyDataFor(workspaceId: number): Promise<StudyData> {
  return fetchStudyData(workspaceId);
}

/** activeWeights is the workspace's FSRS weights; the defaults without a set. */
export function activeWeights(data: Pick<StudyData, "fsrs">): readonly number[] {
  return data.fsrs?.w ?? DEFAULT_W;
}

/** saveParamSet stores a new ULID-keyed parameter set; it never makes it active. */
export async function saveParamSet(
  workspaceId: number,
  set: Omit<ParamSet, "id" | "createdAt">,
): Promise<ParamSet> {
  const saved: ParamSet = {
    ...set,
    id: newUlid(),
    createdAt: new Date().toISOString(),
  };
  await pushStudy(workspaceId, [{ collection: "fsrsSets", row: setRow(saved) }]);
  return saved;
}

/** setActiveSet points the workspace at a set; null means the defaults. */
export async function setActiveSet(
  workspaceId: number,
  setId: string | null,
): Promise<void> {
  const snap = newSnapshot();
  await fetchStudyData(workspaceId, snap);
  // Already in use: no write (a new changedAt would be a change of nothing).
  const stored = snap.stored.get(studyKey("fsrsActive", ""));
  const current = stored === undefined || stored.deletedAt !== null ? null : (stored as FsrsActiveRow).setId;
  if (current === setId) return;
  const write = studyWrite(
    snap,
    "fsrsActive",
    activeRow(setId, new Date().toISOString(), extraOf(snap, "fsrsActive", "")),
  );
  if (write !== null) await pushStudy(workspaceId, [write]);
}

/** deleteParamSet tombstones a set; the active one cannot be deleted. */
export async function deleteParamSet(
  workspaceId: number,
  id: string,
): Promise<void> {
  const snap = newSnapshot();
  const { fsrs } = await fetchStudyData(workspaceId, snap);
  if (fsrs?.active?.id === id) {
    throw new Error("Cannot delete the active parameters.");
  }
  // A set that is not stored (another tab deleted it) is already gone.
  const write = studyDelete(snap, "fsrsSets", id);
  if (write !== null) await pushStudy(workspaceId, [write]);
}

/** createDeck stores a new ULID-keyed deck and returns it. */
export async function createDeck(name: string): Promise<Deck> {
  const workspaceId = requireWorkspaceId();
  const deck: Deck = {
    id: newUlid(),
    name,
    createdAt: new Date().toISOString(),
  };
  await pushStudy(workspaceId, [{ collection: "decks", row: deckRow(deck) }]);
  return deck;
}

/**
 * renameDeck rewrites the deck under the same id and creation time.
 * Renaming a deck that is no longer stored is an error.
 */
export async function renameDeck(id: string, name: string): Promise<Deck> {
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { decks } = await fetchStudyData(workspaceId, snap);
  const existing = decks.find((deck) => deck.id === id);
  if (existing === undefined) {
    throw new Error(`deck "${id}" not found`);
  }
  const renamed: Deck = { ...existing, name };
  const write = studyWrite(snap, "decks", deckRow(renamed, extraOf(snap, "decks", id)));
  if (write !== null) await pushStudy(workspaceId, [write]);
  return renamed;
}

/**
 * deleteDeck tombstones the deck and strips it from every card that
 * references it, so a later delete cannot leave a card pointing only
 * at dead decks. A card left with no deck moves to `general`. Cards are
 * rewritten before the tombstone so a failed write cannot orphan them
 * behind a deleted deck.
 */
export async function deleteDeck(id: string): Promise<void> {
  const workspaceId = requireWorkspaceId();
  if (id === GENERAL_DECK_ID) {
    // The implicit deck has no stored row to tombstone and must survive.
    throw new Error("the general deck cannot be deleted");
  }
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  // One batch (chunks of 200) instead of a request per card: a big copied
  // deck is a handful of requests. A failure throws before the tombstone.
  const rows = cards
    .filter((card) => card.deckIds.includes(id))
    .map((card) => {
      const remaining = card.deckIds.filter((deckId) => deckId !== id);
      const deckIds = remaining.length === 0 ? [GENERAL_DECK_ID] : remaining;
      return studyWrite(snap, "cards", cardRow({ ...card, deckIds }, extraOf(snap, "cards", card.id)));
    })
    .filter((write): write is StudyWrite => write !== null);
  await pushStudy(workspaceId, rows);
  const tombstone = studyDelete(snap, "decks", id);
  if (tombstone !== null) await pushStudy(workspaceId, [tombstone]);
  // The deck's card type switches and its daily limits go with it; another
  // tab may have removed those rows already (a skipped tombstone is fine).
  for (const write of [studyDelete(snap, "deckSettings", id), studyDelete(snap, "limits", id)]) {
    if (write !== null) await pushOptional(workspaceId, write);
  }
}

/**
 * saveDeckCardTypes switches the opt-in card kinds of one deck (General
 * included) by rewriting its `deckcfg:` row. The stored row is re-read so
 * fields this version does not know survive.
 */
export async function saveDeckCardTypes(
  deckId: string,
  cardTypes: readonly OptInKind[],
): Promise<DeckSettings> {
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { deckSettings } = await fetchStudyData(workspaceId, snap);
  const stored = deckSettings?.[deckId];
  const next: DeckSettings = {
    deckId,
    cardTypes: cleanCardTypes(cardTypes),
    ...(stored?.newOrder ? { newOrder: stored.newOrder } : {}),
    extra: stored?.extra ?? extraOf(snap, "deckSettings", deckId),
  };
  const write = studyWrite(snap, "deckSettings", settingsRow(next));
  if (write !== null) await pushStudy(workspaceId, [write]);
  return next;
}

/**
 * saveDeckCardTypesForDecks toggles one opt-in kind on every named deck in
 * one pull/push: the global card-type checkboxes on the setup page use it so
 * the decks agree before a session starts. Rows whose kinds are unchanged
 * are not written.
 */
export async function saveDeckCardTypesForDecks(
  deckIds: readonly string[],
  kind: OptInKind,
  on: boolean,
): Promise<Record<string, DeckSettings>> {
  if (deckIds.length === 0) return {};
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { deckSettings } = await fetchStudyData(workspaceId, snap);
  const out: Record<string, DeckSettings> = {};
  const writes: StudyWrite[] = [];
  for (const deckId of deckIds) {
    const stored = deckSettings?.[deckId];
    const current = cleanCardTypes(stored?.cardTypes ?? []);
    const nextTypes = on
      ? cleanCardTypes([...current, kind])
      : current.filter((value) => value !== kind);
    const next: DeckSettings = {
      deckId,
      cardTypes: nextTypes,
      ...(stored?.newOrder ? { newOrder: stored.newOrder } : {}),
      extra: stored?.extra ?? extraOf(snap, "deckSettings", deckId),
    };
    out[deckId] = next;
    const write = studyWrite(snap, "deckSettings", settingsRow(next));
    if (write !== null) writes.push(write);
  }
  if (writes.length > 0) await pushStudy(workspaceId, writes);
  return out;
}

function withoutNewOrder(extra: Record<string, unknown>): Record<string, unknown> {
  const { newOrder: _dropped, ...rest } = extra;
  void _dropped;
  return rest;
}

/**
 * saveDeckNewOrder sets the order of new cards of one deck (#75) by
 * rewriting its `deckcfg:` row; card types and unknown fields survive.
 * `added` is stored as no field (the default).
 */
export async function saveDeckNewOrder(
  deckId: string,
  order: NewOrder,
): Promise<DeckSettings> {
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { deckSettings } = await fetchStudyData(workspaceId, snap);
  const stored = deckSettings?.[deckId];
  const next: DeckSettings = {
    deckId,
    cardTypes: stored?.cardTypes ?? [],
    ...(order.by === "added" ? {} : { newOrder: order }),
    // Choosing an order replaces an unreadable stored one too.
    extra: withoutNewOrder(stored?.extra ?? extraOf(snap, "deckSettings", deckId)),
  };
  const write = studyWrite(snap, "deckSettings", settingsRow(next));
  if (write !== null) await pushStudy(workspaceId, [write]);
  return next;
}

/**
 * addCard stores a new card (vocab unless `kind` says otherwise) and
 * returns it. Cards dedupe by `cardKey`: kind, entry and, for sentence
 * cards, the sentence. `written` snapshots the
 * entry's written form, which per-character mastery reads without another
 * entry fetch; `sentenceId` keeps the example sentence shown on the review
 * front; `deckIds` names the decks the card belongs to (General by
 * default; unknown ids are the caller's choice — the setup page only
 * offers decks that exist). Adding an entry that already has a card is a
 * no-op: the entry page can race a slow pull, and a second card would
 * split its reviews and EXP. A new card's id is derived from its kind and
 * entry (`newCardId`), so two devices that both miss each other's card
 * write the same key and sync keeps one row (the later write's fields:
 * decks, snapshot, createdAt; reviews point at the shared id either way).
 * Older duplicates are merged at read time (loadStudyData). `workspaceId` names the
 * workspace explicitly (the reader adds to the book's workspace); the
 * selected one is the default.
 */
export async function addCard(
  entryId: number,
  opts: {
    kind?: StudyCardKind;
    written?: string;
    entryKind?: "character";
    sentenceId?: number;
    deckIds?: string[];
    workspaceId?: number;
  } = {},
): Promise<StudyCard> {
  const workspaceId = opts.workspaceId ?? requireWorkspaceId();
  const kind = opts.kind ?? "vocab";
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  const wanted = cardKey(kind, entryId, opts.sentenceId);
  // Several stored duplicates: answer with the one loadStudyData keeps.
  const existing = cards
    .filter(
      (card) => cardKey(card.kind, card.entryId, card.sentenceId) === wanted,
    )
    .sort(compareCanonical)[0];
  if (existing !== undefined) return existing;
  const deckIds = opts.deckIds ?? [GENERAL_DECK_ID];
  const chosen = [...new Set(deckIds.filter((id) => id !== ""))];
  const card: StudyCard = {
    id: freshCardId(cards, kind, entryId, opts.sentenceId),
    kind,
    entryId,
    deckIds: chosen.length === 0 ? [GENERAL_DECK_ID] : chosen,
    createdAt: new Date().toISOString(),
  };
  if (typeof opts.written === "string") {
    card.written = opts.written;
  }
  if (opts.entryKind === "character") {
    card.entryKind = "character";
  }
  if (opts.sentenceId !== undefined) {
    card.sentenceId = opts.sentenceId;
  }
  // The id of a deleted card revives its tombstone (and its extra).
  const write = studyWrite(snap, "cards", cardRow(card, extraOf(snap, "cards", card.id)));
  if (write !== null) await pushStudy(workspaceId, [write]);
  return card;
}

/**
 * freshCardId picks the id of a new card. The derived id (`newCardId`)
 * makes two devices adding the same card at once write one key. It can
 * only be taken by a card with another cardKey for sentence cards (one
 * per sentence once existed); then the sentence joins the id, and a ULID
 * is the last resort, so an existing card is never overwritten.
 */
function freshCardId(
  cards: readonly StudyCard[],
  kind: StudyCardKind,
  entryId: number,
  sentenceId?: number,
): string {
  const taken = new Set(cards.map((card) => card.id));
  const base = newCardId(kind, entryId);
  if (!taken.has(base)) return base;
  if (kind === "sentence" && sentenceId !== undefined) {
    const withSentence = `${base}-${sentenceId}`;
    if (!taken.has(withSentence)) return withSentence;
  }
  return newUlid();
}

/**
 * rowsOfCards expands card ids to every stored row they stand for: the
 * unmerged duplicates of the card (same `cardKey`) and, for a vocab card,
 * its stored companion cards (sentence, writing, tone of the same word).
 * Deleting or moving only the merged survivor would let a duplicate or a
 * companion resurface in the old place.
 */
function rowsOfCards(
  all: readonly StudyCard[],
  ids: readonly string[],
): StudyCard[] {
  const wanted = new Set(ids);
  const picked = all.filter((card) => wanted.has(card.id));
  const keys = new Set(
    picked.map((card) => cardKey(card.kind, card.entryId, card.sentenceId)),
  );
  const vocabEntries = new Set(
    picked.filter((card) => card.kind === "vocab").map((card) => card.entryId),
  );
  return all.filter(
    (card) =>
      wanted.has(card.id) ||
      keys.has(cardKey(card.kind, card.entryId, card.sentenceId)) ||
      (card.kind !== "vocab" && vocabEntries.has(card.entryId)),
  );
}

/**
 * PartialCardsError is thrown when a multi-row write stops half way.
 * `rows` are what the caller needs to carry on: after deleteCards and
 * moveCards the rows that DID change (their previous state, for undo);
 * after restoreCards the rows still NOT written (for a retry).
 */
export class PartialCardsError extends Error {
  rows: StudyCard[];
  cause: unknown;

  constructor(message: string, rows: StudyCard[], cause: unknown) {
    super(message);
    this.name = "PartialCardsError";
    this.rows = rows;
    this.cause = cause;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * deleteCards tombstones the given cards (see rowsOfCards for what that
 * includes) and returns the removed rows, which restoreCards takes to
 * undo it. Companions and duplicates go first and the requested rows
 * last, so a failure half way leaves the card the user sees still
 * listed instead of hiding it behind live leftovers. A 404 means the row
 * is already gone (another tab): it is skipped and not reported as
 * removed. A failure throws PartialCardsError with the rows that did
 * land. Review events are not touched: reviews of a missing card are
 * ignored by scheduling and mastery, while EXP and streaks keep counting.
 */
export async function deleteCards(
  ids: readonly string[],
): Promise<StudyCard[]> {
  const workspaceId = requireWorkspaceId();
  if (ids.length === 0) return [];
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  const asked = new Set(ids);
  const rows = rowsOfCards(cards, ids);
  const ordered = [
    ...rows.filter((row) => !asked.has(row.id)),
    ...rows.filter((row) => asked.has(row.id)),
  ];
  const removed: StudyCard[] = [];
  for (const row of ordered) {
    const write = studyDelete(snap, "cards", row.id);
    if (write === null) continue;
    try {
      // Skipped: another tab deleted (or rewrote) the row since the read.
      if (await pushOptional(workspaceId, write)) removed.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, t("study.store.deleteFailed")),
        removed,
        err,
      );
    }
  }
  return removed;
}

/**
 * restoreCards writes removed (or moved) rows back; the server revives a
 * tombstoned key on PUT, so the card, its id and its reviews are all
 * back. Rows go in reverse of deletion order (the word before its
 * companions). With `onlyLive` a row whose card is no longer stored
 * (another tab deleted it since) is skipped instead of revived: undoing
 * a move must not resurrect a card deleted afterwards. A failure throws
 * PartialCardsError whose `rows` are the ones still to restore.
 */
export async function restoreCards(
  rows: readonly StudyCard[],
  opts: { onlyLive?: boolean } = {},
): Promise<void> {
  const workspaceId = requireWorkspaceId();
  let todo = [...rows].reverse();
  const snap = newSnapshot();
  try {
    // Read first: a restore is stamped after the tombstone the server holds.
    const { cards } = await fetchStudyData(workspaceId, snap);
    if (opts.onlyLive === true) {
      const live = new Set(cards.map((card) => card.id));
      todo = todo.filter((row) => live.has(row.id));
    }
  } catch (err) {
    throw new PartialCardsError(
      errorMessage(err, t("study.store.undoFailed")),
      [...rows],
      err,
    );
  }
  for (let i = 0; i < todo.length; i++) {
    try {
      const write = studyWrite(snap, "cards", cardRow(todo[i], extraOf(snap, "cards", todo[i].id)));
      if (write !== null) await pushStudy(workspaceId, [write]);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, t("study.store.undoFailed")),
        todo.slice(i).reverse(),
        err,
      );
    }
  }
}

/**
 * moveCards makes `deckId` the only deck of the given cards (their
 * duplicates and companions follow). Rows already only in that deck are
 * not rewritten. Returns the rows as they were before, for undo through
 * restoreCards (with `onlyLive`); a failure throws PartialCardsError with
 * the rows already moved. The deck must be General or a stored deck.
 */
export async function moveCards(
  ids: readonly string[],
  deckId: string,
): Promise<StudyCard[]> {
  const workspaceId = requireWorkspaceId();
  if (deckId === "") throw new Error("choose a deck to move the cards to");
  if (ids.length === 0) return [];
  const snap = newSnapshot();
  const { cards, decks } = await fetchStudyData(workspaceId, snap);
  if (deckId !== GENERAL_DECK_ID && !decks.some((deck) => deck.id === deckId)) {
    // Only the general deck is implicit: any other target must exist.
    throw new Error(`deck "${deckId}" not found`);
  }
  const changed = rowsOfCards(cards, ids).filter(
    (row) => row.deckIds.length !== 1 || row.deckIds[0] !== deckId,
  );
  const moved: StudyCard[] = [];
  for (const row of changed) {
    try {
      const write = studyWrite(
        snap,
        "cards",
        cardRow({ ...row, deckIds: [deckId] }, extraOf(snap, "cards", row.id)),
      );
      if (write !== null) await pushStudy(workspaceId, [write]);
      moved.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, t("study.store.moveFailed")),
        moved,
        err,
      );
    }
  }
  return moved;
}

/**
 * vocabRowsOf: every stored vocab row (duplicates included) of an entry.
 * skipKinds lives on them, so all of them are rewritten together.
 */
function vocabRowsOf(all: readonly StudyCard[], entryId: number): StudyCard[] {
  return all.filter((card) => card.kind === "vocab" && card.entryId === entryId);
}

function withSkip(row: StudyCard, skipKinds: readonly StudyCardKind[]): StudyCard {
  const { skipKinds: _old, ...rest } = row;
  void _old;
  const clean = cleanSkipKinds(skipKinds);
  return clean.length === 0 ? rest : { ...rest, skipKinds: clean };
}

/** Writes new skipKinds to the entry's vocab rows; returns their previous state. */
async function rewriteSkips(
  workspaceId: number,
  snap: StudySnapshot,
  rows: readonly StudyCard[],
  next: (row: StudyCard) => StudyCardKind[],
): Promise<StudyCard[]> {
  const changed: StudyCard[] = [];
  for (const row of rows) {
    const updated = withSkip(row, next(row));
    if (JSON.stringify(updated.skipKinds ?? []) === JSON.stringify(row.skipKinds ?? [])) continue;
    try {
      const write = studyWrite(snap, "cards", cardRow(updated, extraOf(snap, "cards", row.id)));
      if (write !== null) await pushStudy(workspaceId, [write]);
      changed.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, t("study.store.updateFailed")),
        changed,
        err,
      );
    }
  }
  return changed;
}

function assertSkippable(kind: StudyCardKind): void {
  if (kind === "vocab") throw new Error("the vocab card of a word cannot be skipped");
}

/**
 * skipKind switches one non-vocab kind off for a word (even before its
 * card exists): the kind joins `skipKinds` on the word's vocab row(s), so
 * lazy creation does not bring the card back. Returns the previous vocab
 * rows for undo through restoreCards. A word without a vocab card has
 * nowhere to keep the switch: that is an error.
 */
export async function skipKind(
  entryId: number,
  kind: StudyCardKind,
): Promise<StudyCard[]> {
  assertSkippable(kind);
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  const rows = vocabRowsOf(cards, entryId);
  if (rows.length === 0) throw new Error("this word has no vocab card to hold the setting");
  return rewriteSkips(workspaceId, snap, rows, (row) => [...(row.skipKinds ?? []), kind]);
}

/** unskipKind removes a kind from the word's `skipKinds`; returns the previous rows for undo. */
export async function unskipKind(
  entryId: number,
  kind: StudyCardKind,
): Promise<StudyCard[]> {
  assertSkippable(kind);
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  const rows = vocabRowsOf(cards, entryId);
  if (rows.length === 0) throw new Error("this word has no vocab card to hold the setting");
  return rewriteSkips(workspaceId, snap, rows, (row) =>
    (row.skipKinds ?? []).filter((skipped) => skipped !== kind),
  );
}

/**
 * dropSiblingCards removes one non-vocab card (and its stored duplicates)
 * of a word without removing the word: the kinds join the word's vocab
 * `skipKinds` first, then the rows are tombstoned. Returns the previous
 * rows (vocab rows and siblings) for restoreCards, which brings both
 * back; a sibling with no vocab row is just tombstoned (nothing would
 * recreate it). A vocab id is an error (use deleteCards). A failure
 * throws PartialCardsError with the rows that did change.
 */
export async function dropSiblingCards(
  ids: readonly string[],
): Promise<StudyCard[]> {
  const workspaceId = requireWorkspaceId();
  if (ids.length === 0) return [];
  const snap = newSnapshot();
  const { cards } = await fetchStudyData(workspaceId, snap);
  const asked = cards.filter((card) => ids.includes(card.id));
  if (asked.some((card) => card.kind === "vocab")) {
    throw new Error("only the other cards of a word can be removed on their own");
  }
  const keys = new Set(
    asked.map((card) => cardKey(card.kind, card.entryId, card.sentenceId)),
  );
  const siblings = cards.filter(
    (card) =>
      card.kind !== "vocab" &&
      keys.has(cardKey(card.kind, card.entryId, card.sentenceId)),
  );
  const kindsByEntry = new Map<number, StudyCardKind[]>();
  for (const sibling of siblings) {
    kindsByEntry.set(sibling.entryId, [
      ...(kindsByEntry.get(sibling.entryId) ?? []),
      sibling.kind,
    ]);
  }
  const previous: StudyCard[] = [];
  for (const [entryId, kinds] of kindsByEntry) {
    const rows = vocabRowsOf(cards, entryId);
    try {
      previous.push(
        ...(await rewriteSkips(workspaceId, snap, rows, (row) => [
          ...(row.skipKinds ?? []),
          ...kinds,
        ])),
      );
    } catch (err) {
      if (err instanceof PartialCardsError) {
        throw new PartialCardsError(err.message, [...previous, ...err.rows], err.cause);
      }
      throw err;
    }
  }
  for (const row of siblings) {
    const write = studyDelete(snap, "cards", row.id);
    if (write === null) continue;
    try {
      if (await pushOptional(workspaceId, write)) previous.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, t("study.store.removeFailed")),
        previous,
        err,
      );
    }
  }
  return previous;
}

/** cardsInDecks keeps the cards that belong to at least one of `deckIds`. */
export function cardsInDecks(
  cards: readonly StudyCard[],
  deckIds: readonly string[],
): StudyCard[] {
  const wanted = new Set(deckIds);
  return cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
}

/** saveVacation stores one vacation period (user-global: no workspace). */
export async function saveVacation(period: VacationPeriod): Promise<void> {
  try {
    await api(`/api/plugins/${FLASHCARDS_PLUGIN_ID}/data/${VACATION_PREFIX}${period.id}`, {
      method: "PUT",
      body: period,
    });
  } finally {
    notifyWrite(ALL_WORKSPACES);
  }
}

/** deleteVacation tombstones one vacation period. */
export async function deleteVacation(id: string): Promise<void> {
  try {
    await api(`/api/plugins/${FLASHCARDS_PLUGIN_ID}/data/${VACATION_PREFIX}${id}`, {
      method: "DELETE",
    });
  } finally {
    notifyWrite(ALL_WORKSPACES);
  }
}

/** saveWorkspaceLimits stores the workspace's daily limits (`null` = unlimited). */
export async function saveWorkspaceLimits(limits: Partial<LimitPair>): Promise<void> {
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  await fetchStudyData(workspaceId, snap);
  const write = studyWrite(snap, "limits", limitsRow(null, limits, extraOf(snap, "limits", "")));
  if (write !== null) await pushStudy(workspaceId, [write]);
}

/**
 * saveGoals stores one workspace's daily goal row as given (unknown keys
 * included); the caller plans it with planGoalEdit (goals/goals.ts) and
 * passes the workspace the row was read from, never "whatever is current
 * now", so a workspace switch mid-save cannot write another workspace.
 */
export async function saveGoals(workspaceId: number, row: GoalsRow): Promise<void> {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("saveGoals: not a workspace id: study data is workspace-scoped");
  }
  await putData(workspaceId, GOALS_KEY, row);
}

/**
 * saveDeckLimits stores one deck's overrides (General included). A field
 * left out follows the workspace; an empty object removes the row.
 */
export async function saveDeckLimits(deckId: string, limits: Partial<LimitPair>): Promise<void> {
  const workspaceId = requireWorkspaceId();
  const snap = newSnapshot();
  await fetchStudyData(workspaceId, snap);
  if (Object.keys(limits).length === 0) {
    // Nothing left to say: the row goes (another tab may have removed it).
    const write = studyDelete(snap, "limits", deckId);
    if (write !== null) await pushOptional(workspaceId, write);
    return;
  }
  const write = studyWrite(snap, "limits", limitsRow(deckId, limits, extraOf(snap, "limits", deckId)));
  if (write !== null) await pushStudy(workspaceId, [write]);
}

function requireWorkspaceArg(workspaceId: number, fn: string): void {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error(`${fn}: not a workspace id: study data is workspace-scoped`);
  }
}

/**
 * setKnownMark marks (PUT) or unmarks (DELETE = tombstone) one entry as
 * known in the given workspace (the book's, never "whatever is current").
 * Unmarking a mark the server does not hold is not an error.
 */
export async function setKnownMark(workspaceId: number, entryId: number, on: boolean): Promise<void> {
  requireWorkspaceArg(workspaceId, "setKnownMark");
  if (on) {
    const row = knownMarkRow(entryId, new Date());
    await putData(workspaceId, row.key, row.data);
    return;
  }
  try {
    await deleteData(workspaceId, knownMarkKey(entryId));
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
}

/**
 * setKnownMarks marks or unmarks many entries through pushKeyedRows (200
 * rows per request). A skipped row is a PartialPushError; unmark only
 * entries whose mark is live (a tombstone for a missing row is skipped).
 */
export async function setKnownMarks(
  workspaceId: number,
  entryIds: readonly number[],
  on: boolean,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  requireWorkspaceArg(workspaceId, "setKnownMarks");
  // Each row is stamped after the time the server holds for its key (a
  // client clock behind the server's would otherwise lose every write).
  const { knownAt } = await loadRawStudyData(workspaceId);
  const now = new Date();
  const rows = [...new Set(entryIds)].map((id) => {
    const row = knownMarkRow(id, now);
    const at = knownAt.get(row.key);
    const stamp = at === undefined ? {} : { knownAt: at };
    return on ? { ...row, ...stamp } : { key: row.key, data: {}, deleted: true as const, ...stamp };
  });
  await pushKeyedRows(workspaceId, rows, opts);
}

/**
 * saveSeenMilestones writes `milestone:<id>` rows (docs/contracts/milestones/)
 * in one push: never a tombstone, the caller passes only keys that are not
 * live (seenWritePlan); a row reviving a tombstone carries its `knownAt` and
 * is stamped after it. 'done': every row was written. 'pending': the server
 * skipped a row (it holds a newer one for the key: a tombstone this client
 * has not pulled, or a clock behind the server's) or refused one; the
 * caller keeps those ids pending until the row is live in a pull. A failed
 * request rejects (also pending). Listeners are notified either way.
 */
export async function saveSeenMilestones(
  workspaceId: number,
  rows: readonly { key: string; data: unknown; knownAt?: string }[],
): Promise<"done" | "pending"> {
  requireWorkspaceArg(workspaceId, "saveSeenMilestones");
  for (const row of rows) {
    if (!row.key.startsWith(MILESTONE_KEY_PREFIX)) throw new Error(`${row.key}: not a milestone row`);
  }
  if (rows.length === 0) return "done";
  try {
    await pushKeyedRows(
      workspaceId,
      rows.map((row) => ({ key: row.key, data: row.data, ...(row.knownAt === undefined ? {} : { knownAt: row.knownAt }) })),
      { chunk: rows.length },
    );
  } catch (err) {
    if (err instanceof PartialPushError && err.skipped > 0) return "pending";
    throw err;
  }
  return "done";
}
