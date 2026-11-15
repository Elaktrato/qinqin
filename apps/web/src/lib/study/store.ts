// Deck and card definitions as workspace-scoped plugin data. Reads come
// from one sync pull; writes are single-key PUTs and a delete is a
// tombstoning DELETE. A missing current workspace is an error: study
// data must never fall back to user-global or another workspace's rows.

import { get } from "svelte/store";
import { ApiError, api } from "../api/client";
import { newUlid } from "../ulid";
import { workspaces } from "../workspaces";
import type { StudyEvent } from "../events";
import { canonicalCards, cleanSkipKinds, compareCanonical, newCardId } from "./canonical";
import {
  ACTIVE_KEY,
  DEFAULT_W,
  SET_PREFIX,
  parseParamSet,
  resolveState,
  type ParamSet,
} from "./fsrs/params";
import {
  DECKCFG_PREFIX,
  deckSettingsKey,
  parseDeckSettings,
  serializeDeckSettings,
  cleanCardTypes,
  type DeckSettings,
} from "./deckSettings";
import { cardKey, parseReview } from "./reviewParse";
import {
  CARD_KINDS,
  type Deck,
  type DeckSource,
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

const DECK_PREFIX = "deck:";
const CARD_PREFIX = "card:";
const SYNC_PULL_PATH =
  "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates";

// Only the fields the study layer reads; the server sends more.
interface PluginDataRow {
  pluginId: string;
  key: string;
  workspaceId: number | null;
  data: unknown;
  deletedAt: unknown;
  updatedAt: unknown;
}

interface SyncDelta {
  pluginData?: unknown;
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

function deckKey(id: string): string {
  return `${DECK_PREFIX}${id}`;
}

function cardRowKey(id: string): string {
  return `${CARD_PREFIX}${id}`;
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

function parseDeck(key: string, raw: unknown): Deck | null {
  if (!isRecord(raw)) return null;
  const { id, name, createdAt } = raw;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  // The key and the payload must agree: a write updates `deck:<id>`
  // and a mismatched row would make renames target the wrong key.
  if (key !== deckKey(id)) return null;
  const result: Deck = { id, name, createdAt };
  const source = parseSource(raw.source);
  if (source !== undefined) result.source = source;
  return result;
}

function parseSource(raw: unknown): DeckSource | undefined {
  if (!isRecord(raw)) return undefined;
  if (
    raw.type === "level" &&
    typeof raw.packId === "string" &&
    typeof raw.level === "string"
  ) {
    return { type: "level", packId: raw.packId, level: raw.level };
  }
  if (
    raw.type === "plugin" &&
    typeof raw.pluginId === "string" &&
    typeof raw.key === "string"
  ) {
    return { type: "plugin", pluginId: raw.pluginId, key: raw.key };
  }
  return undefined;
}

function parseCard(key: string, raw: unknown): StudyCard | null {
  if (!isRecord(raw)) return null;
  const { id, kind, entryId, sentenceId, deckIds, createdAt, written, entryKind, skipKinds } = raw;
  if (typeof id !== "string" || typeof entryId !== "number") return null;
  if (!CARD_KINDS.includes(kind as StudyCardKind)) return null;
  if (typeof createdAt !== "string") return null;
  if (key !== cardRowKey(id)) return null;
  if (!Array.isArray(deckIds)) return null;
  const decks = [
    ...new Set(
      deckIds.filter((deckId): deckId is string => typeof deckId === "string"),
    ),
  ];
  const card: StudyCard = {
    id,
    kind: kind as StudyCardKind,
    entryId,
    deckIds: decks,
    createdAt,
  };
  if (typeof written === "string") {
    card.written = written;
  }
  if (entryKind === "character") {
    card.entryKind = "character";
  }
  if (typeof sentenceId === "number") {
    card.sentenceId = sentenceId;
  }
  if (kind === "vocab" && Array.isArray(skipKinds)) {
    const skipped = cleanSkipKinds(skipKinds);
    if (skipped.length > 0) card.skipKinds = skipped;
  }
  return card;
}

/**
 * fetchStudyData pulls every synced row and keeps the live flashcard rows
 * of one workspace. Rows of other plugins, other (or no) workspaces,
 * tombstones, and keys outside `deck:`/`card:` are ignored; a malformed
 * payload is skipped rather than failing the whole page.
 */
async function fetchStudyData(
  workspaceId: number,
  knownAt?: Map<string, string>,
): Promise<StudyData> {
  const delta = await api<SyncDelta>(SYNC_PULL_PATH);
  const rows = Array.isArray(delta?.pluginData) ? delta.pluginData : [];
  const decks: Deck[] = [];
  const cards: StudyCard[] = [];
  const sets: ParamSet[] = [];
  const deckSettings: Record<string, DeckSettings> = {};
  let activeRaw: unknown = null;

  for (const value of rows) {
    const row = asPluginDataRow(value);
    if (row === null) continue;
    if (row.pluginId !== FLASHCARDS_PLUGIN_ID) continue;
    if (row.workspaceId !== workspaceId) continue;
    if (knownAt !== undefined) {
      // The newest time the server holds for the key, live or tombstoned.
      const times = [row.updatedAt, row.deletedAt].filter(
        (t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)),
      );
      const newest = times.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      if (newest !== undefined) knownAt.set(row.key, newest);
    }
    if (row.deletedAt != null) continue;

    const data = decodeData(row.data);
    if (row.key.startsWith(DECK_PREFIX)) {
      const deck = parseDeck(row.key, data);
      if (deck !== null) decks.push(deck);
    } else if (row.key.startsWith(CARD_PREFIX)) {
      const card = parseCard(row.key, data);
      if (card !== null) cards.push(card);
    } else if (row.key.startsWith(DECKCFG_PREFIX)) {
      const settings = parseDeckSettings(row.key, data);
      if (settings !== null) deckSettings[settings.deckId] = settings;
    } else if (row.key.startsWith(SET_PREFIX)) {
      const set = parseParamSet(row.key, data);
      if (set !== null) sets.push(set);
    } else if (row.key === ACTIVE_KEY) {
      activeRaw = data;
    }
  }

  // Absent (not empty) without any deckcfg row: workspaces that never
  // configured a deck read exactly as before.
  return {
    decks,
    cards,
    fsrs: resolveState(sets, activeRaw),
    ...(Object.keys(deckSettings).length > 0 ? { deckSettings } : {}),
  };
}

/** The row keys of the study data, for callers that write rows in batches. */
export const studyRowKey = {
  deck: (id: string): string => deckKey(id),
  card: (id: string): string => cardRowKey(id),
};

/**
 * loadRawStudyData reads the live decks and cards of a workspace as stored:
 * duplicate cards are NOT merged, so a writer sees every row it must keep
 * consistent (the decks view's add-to-deck plan). `knownAt` is the newest
 * time the server holds per row key (updatedAt or tombstone), for stamping
 * a later write after it. Pages that show or
 * schedule cards use loadStudyData instead.
 */
export async function loadRawStudyData(
  workspaceId: number,
): Promise<{ decks: Deck[]; cards: StudyCard[]; knownAt: Map<string, string> }> {
  const knownAt = new Map<string, string>();
  const { decks, cards } = await fetchStudyData(workspaceId, knownAt);
  return { decks, cards, knownAt };
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

function notifyWrite(workspaceId: number): void {
  for (const listener of writeListeners) listener(workspaceId);
}

async function putData(
  workspaceId: number,
  key: string,
  value: unknown,
): Promise<void> {
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

/**
 * pushStudyRows writes plugin-data rows through POST /api/sync/push in
 * sequential chunks (last write wins on `updatedAt` = now). One request
 * replaces hundreds of single PUTs. A chunk the server only partly applied
 * (a newer row won, or the plugin may not own data) is an error: callers
 * must never report success for it. Listeners are notified after each chunk.
 */
export async function pushStudyRows(
  workspaceId: number,
  rows: readonly { key: string; data: unknown; knownAt?: string }[],
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const size = Math.max(1, opts.chunk ?? 200);
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const nowMs = Date.now();
    let result: PushResult;
    try {
      result = await api<PushResult>("/api/sync/push", {
        method: "POST",
        body: {
          pluginData: part.map((row) => ({
            pluginId: FLASHCARDS_PLUGIN_ID,
            key: row.key,
            workspaceId,
            data: row.data,
            // Last write wins on this stamp: never earlier than what the server
            // already holds for the row (a client clock behind the server's would
            // lose to a fresh tombstone for ever).
            updatedAt: new Date(
              Math.max(nowMs, stampAfter(row.knownAt)),
            ).toISOString(),
          })),
        },
      });
    } catch (err) {
      throw new PartialPushError(errorMessage(err, "Could not write the cards."), done);
    } finally {
      // A failed write may still have landed: stale caches are dropped either way.
      notifyWrite(workspaceId);
    }
    const skipped = (result?.dataSkipped ?? 0) + (result?.dataRefused ?? 0);
    done += result?.dataAccepted ?? part.length - skipped;
    if (skipped > 0) {
      throw new PartialPushError(
        `${skipped} ${skipped === 1 ? "row was" : "rows were"} not written because the server holds newer data for ${skipped === 1 ? "it" : "them"}. Try again.`,
        done,
        skipped,
      );
    }
    opts.onProgress?.(done, rows.length);
  }
}

async function deleteData(workspaceId: number, key: string): Promise<void> {
  try {
    await api(dataPath(key, workspaceId), { method: "DELETE" });
  } finally {
    notifyWrite(workspaceId);
  }
}

function eventsPath(workspaceId: number): string {
  return `/api/events?since=1970-01-01T00:00:00Z&workspace=${workspaceId}`;
}

/** fetchEvents reads the workspace's whole event log, uncached. */
async function fetchEvents(workspaceId: number): Promise<StudyEvent[]> {
  const events = await api<StudyEvent[]>(eventsPath(workspaceId));
  return Array.isArray(events) ? events : [];
}

/** reviewsOf keeps the workspace's review events of an event log. */
function reviewsOf(
  workspaceId: number,
  events: readonly StudyEvent[],
): ReviewEvent[] {
  return events
    .map((event) =>
      event.workspaceId === workspaceId ? parseReview(event) : null,
    )
    .filter((event): event is ReviewEvent => event !== null);
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
    reviewsOf(workspaceId, events),
  );
  return {
    decks: data.decks,
    cards,
    fsrs: data.fsrs,
    ...(data.deckSettings === undefined ? {} : { deckSettings: data.deckSettings }),
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
  await putData(workspaceId, `${SET_PREFIX}${saved.id}`, saved);
  return saved;
}

/** setActiveSet points the workspace at a set; null means the defaults. */
export async function setActiveSet(
  workspaceId: number,
  setId: string | null,
): Promise<void> {
  await putData(workspaceId, ACTIVE_KEY, {
    setId,
    changedAt: new Date().toISOString(),
  });
}

/** deleteParamSet tombstones a set; the active one cannot be deleted. */
export async function deleteParamSet(
  workspaceId: number,
  id: string,
): Promise<void> {
  const { fsrs } = await fetchStudyData(workspaceId);
  if (fsrs?.active?.id === id) {
    throw new Error("Cannot delete the active parameters.");
  }
  await deleteData(workspaceId, `${SET_PREFIX}${id}`);
}

/** createDeck stores a new ULID-keyed deck and returns it. */
export async function createDeck(name: string): Promise<Deck> {
  const workspaceId = requireWorkspaceId();
  const deck: Deck = {
    id: newUlid(),
    name,
    createdAt: new Date().toISOString(),
  };
  await putData(workspaceId, deckKey(deck.id), deck);
  return deck;
}

/**
 * renameDeck rewrites the deck under the same id and creation time.
 * Renaming a deck that is no longer stored is an error.
 */
export async function renameDeck(id: string, name: string): Promise<Deck> {
  const workspaceId = requireWorkspaceId();
  const { decks } = await fetchStudyData(workspaceId);
  const existing = decks.find((deck) => deck.id === id);
  if (existing === undefined) {
    throw new Error(`deck "${id}" not found`);
  }
  const renamed: Deck = { ...existing, name };
  await putData(workspaceId, deckKey(id), renamed);
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
  const knownAt = new Map<string, string>();
  const { cards, deckSettings } = await fetchStudyData(workspaceId, knownAt);
  // One batch (chunks of 200) instead of a request per card: a big copied
  // deck is a handful of requests. A failure throws before the tombstone.
  const rows = cards
    .filter((card) => card.deckIds.includes(id))
    .map((card) => {
      const remaining = card.deckIds.filter((deckId) => deckId !== id);
      const deckIds = remaining.length === 0 ? [GENERAL_DECK_ID] : remaining;
      return {
        key: cardRowKey(card.id),
        data: { ...card, deckIds },
        knownAt: knownAt.get(cardRowKey(card.id)),
      };
    });
  await pushStudyRows(workspaceId, rows);
  await deleteData(workspaceId, deckKey(id));
  // The deck's card type switches go with it; another tab may have
  // removed the row already.
  if (deckSettings?.[id] !== undefined) {
    try {
      await deleteData(workspaceId, deckSettingsKey(id));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
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
  const { deckSettings } = await fetchStudyData(workspaceId);
  const next: DeckSettings = {
    deckId,
    cardTypes: cleanCardTypes(cardTypes),
    extra: deckSettings?.[deckId]?.extra ?? {},
  };
  await putData(
    workspaceId,
    deckSettingsKey(deckId),
    serializeDeckSettings(next, new Date().toISOString()),
  );
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
  const { cards } = await fetchStudyData(workspaceId);
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
  await putData(workspaceId, cardRowKey(card.id), card);
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
  const { cards } = await fetchStudyData(workspaceId);
  const asked = new Set(ids);
  const rows = rowsOfCards(cards, ids);
  const ordered = [
    ...rows.filter((row) => !asked.has(row.id)),
    ...rows.filter((row) => asked.has(row.id)),
  ];
  const removed: StudyCard[] = [];
  for (const row of ordered) {
    try {
      await deleteData(workspaceId, cardRowKey(row.id));
      removed.push(row);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) continue;
      throw new PartialCardsError(
        errorMessage(err, "Could not delete the cards."),
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
  try {
    if (opts.onlyLive === true) {
      const live = new Set(
        (await fetchStudyData(workspaceId)).cards.map((card) => card.id),
      );
      todo = todo.filter((row) => live.has(row.id));
    }
  } catch (err) {
    throw new PartialCardsError(
      errorMessage(err, "Could not undo."),
      [...rows],
      err,
    );
  }
  for (let i = 0; i < todo.length; i++) {
    try {
      await putData(workspaceId, cardRowKey(todo[i].id), todo[i]);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, "Could not undo."),
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
  const { cards, decks } = await fetchStudyData(workspaceId);
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
      await putData(workspaceId, cardRowKey(row.id), {
        ...row,
        deckIds: [deckId],
      });
      moved.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, "Could not move the cards."),
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
  rows: readonly StudyCard[],
  next: (row: StudyCard) => StudyCardKind[],
): Promise<StudyCard[]> {
  const changed: StudyCard[] = [];
  for (const row of rows) {
    const updated = withSkip(row, next(row));
    if (JSON.stringify(updated.skipKinds ?? []) === JSON.stringify(row.skipKinds ?? [])) continue;
    try {
      await putData(workspaceId, cardRowKey(row.id), updated);
      changed.push(row);
    } catch (err) {
      throw new PartialCardsError(
        errorMessage(err, "Could not update the word."),
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
  const { cards } = await fetchStudyData(workspaceId);
  const rows = vocabRowsOf(cards, entryId);
  if (rows.length === 0) throw new Error("this word has no vocab card to hold the setting");
  return rewriteSkips(workspaceId, rows, (row) => [...(row.skipKinds ?? []), kind]);
}

/** unskipKind removes a kind from the word's `skipKinds`; returns the previous rows for undo. */
export async function unskipKind(
  entryId: number,
  kind: StudyCardKind,
): Promise<StudyCard[]> {
  assertSkippable(kind);
  const workspaceId = requireWorkspaceId();
  const { cards } = await fetchStudyData(workspaceId);
  const rows = vocabRowsOf(cards, entryId);
  if (rows.length === 0) throw new Error("this word has no vocab card to hold the setting");
  return rewriteSkips(workspaceId, rows, (row) =>
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
  const { cards } = await fetchStudyData(workspaceId);
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
        ...(await rewriteSkips(workspaceId, rows, (row) => [
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
    try {
      await deleteData(workspaceId, cardRowKey(row.id));
      previous.push(row);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) continue;
      throw new PartialCardsError(
        errorMessage(err, "Could not remove the cards."),
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
