// TEST-ONLY: the fetch stubs and helpers of the study command tests (#193,
// split from the old store tests): a pull answered as the typed rows a migrated
// server serves for v0.3.0-style plugin rows (legacyCodec typedPull), the pushes
// and plugin-data writes read back as legacy rows, and the one-storage check.
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { StudyEvent } from "../events";
import type { Deck, StudyCard } from "../study/types";
import { legacyFamily, pagedPull, toLegacy } from "./legacyCodec";
import { STUDY_COLLECTIONS, type StudyCollection } from "../study/rows";
import * as build from "./study";

export const PLUGIN_ID = "qinqin-flashcards";
export const WORKSPACE_ID = 7;
export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

/**
 * jsonResponse answers a request. A pull body is described as the v0.3.0
 * plugin rows the study state was; it is served as the migrated server
 * answers it (typed collections, leftovers in pluginData; typedPull).
 */
export function jsonResponse(body: unknown, status = 200): Response {
  const isPull =
    typeof body === "object" && body !== null && Array.isArray((body as { pluginData?: unknown }).pluginData);
  return rawResponse(isPull ? pagedPull(body as Record<string, unknown>) : body, status);
}

/** rawResponse answers exactly `body` (no conversion). */
export function rawResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface PluginDataRow {
  pluginId: string;
  key: string;
  userId: number;
  workspaceId: number | null;
  data: unknown;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

export function pluginRow(
  key: string,
  data: unknown,
  overrides: Partial<PluginDataRow> = {},
): PluginDataRow {
  return {
    pluginId: PLUGIN_ID,
    key,
    userId: 1,
    workspaceId: WORKSPACE_ID,
    data,
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

export function deck(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00Z",
): Deck {
  return { id, name, createdAt };
}

export function card(
  id: string,
  entryId: number,
  deckIds: string[],
  createdAt = "2026-01-02T00:00:00Z",
  written?: string,
): StudyCard {
  return build.card({ id, entryId, deckIds, createdAt, written });
}


export function calls(): Array<[string, RequestInit | undefined]> {
  return vi.mocked(fetch).mock.calls as Array<
    [string, RequestInit | undefined]
  >;
}

/** PUTs to the plugin-data routes: only the keyed rows (goals, known marks, vacations) still use them. */
export function putBodies(): Array<{ url: string; body: unknown }> {
  return calls()
    .filter(([, init]) => init?.method === "PUT")
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)),
    }));
}

export function pushBodies(): Array<Record<string, unknown>> {
  return calls()
    .filter(([url, init]) => String(url) === "/api/sync/push" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

export interface Written {
  collection: StudyCollection;
  key: string;
  workspaceId: number;
  /** The legacy object the typed row stands for (test codec), for content checks. */
  data: Record<string, unknown>;
  /** The typed item as sent. */
  item: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
}

export function itemsOf(body: Record<string, unknown>): Written[] {
  return STUDY_COLLECTIONS.flatMap((collection) =>
    ((body[collection] as Record<string, unknown>[] | undefined) ?? []).map((item) => {
      const { key, data } = toLegacy(collection, item as never);
      return {
        collection,
        key,
        workspaceId: item.workspaceId as number,
        data,
        item,
        updatedAt: item.updatedAt as string,
        deleted: typeof item.deletedAt === "string",
      };
    }),
  );
}

/** Every typed study write sent (POST /api/sync/push), in order. */
export function writes(): Written[] {
  return pushBodies().flatMap(itemsOf);
}

/** The live typed writes, as the legacy rows they stand for. */
export function writtenRows(): Array<{ key: string; workspaceId: number; body: unknown }> {
  return writes()
    .filter((w) => !w.deleted)
    .map(({ key, workspaceId, data }) => ({ key, workspaceId, body: data }));
}

/** The typed rows tombstoned, by legacy key. */
export function deletedKeys(): string[] {
  return writes()
    .filter((w) => w.deleted)
    .map((w) => w.key);
}

/** Every row batch-written through POST /api/sync/push (typed rows as their legacy key and data), in order. */
export function pushedRows(): Array<{ key: string; data: unknown; updatedAt: string }> {
  return pushBodies().flatMap((body) => [
    ...itemsOf(body).map(({ key, data, updatedAt }) => ({ key, data, updatedAt })),
    ...(((body.pluginData as Array<{ key: string; data: unknown; updatedAt: string }>) ?? [])),
  ]);
}

/** A push answer that skipped the items whose legacy key `skip` names. */
export function pushAnswer(init: RequestInit | undefined, skip: (key: string) => boolean = () => false): Response {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const keys = [
    ...itemsOf(body).map((w) => w.key),
    ...((body.pluginData as Array<{ key: string }> | undefined) ?? []).map((r) => r.key),
  ];
  const skipped = keys.filter(skip).length;
  return rawResponse({ dataAccepted: keys.length - skipped, dataSkipped: skipped, dataRefused: 0 });
}

export function isPush(input: unknown, init?: RequestInit): boolean {
  return String(input) === "/api/sync/push" && init?.method === "POST";
}

/**
 * respondPull answers the two reads loadStudyData makes: the sync pull
 * gets `pull`, the event log gets `events` (none by default).
 */
export function respondPull(pull: unknown, events: unknown[] = []): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).startsWith("/api/events")) return jsonResponse(events);
    return rawResponse(pagedPull(pull as Record<string, unknown>));
  });
}

export function reviewEvent(
  id: string,
  cardId: string,
  workspaceId = WORKSPACE_ID,
): StudyEvent {
  return build.review({ id, cardId, workspaceId, ts: "2026-02-01T00:00:00.000Z" }) as StudyEvent;
}

// The one storage rule, checked after every test (each suite's afterEach
// calls it before clearing the mocks): no typed study family ever goes
// through the plugin-data routes or a pluginData push item.
export function expectOneStorage(): void {
  const onRoutes = calls()
    .map(([url]) => /^\/api\/plugins\/qinqin-flashcards\/data\/([^?]+)/.exec(String(url))?.[1])
    .filter((key): key is string => key !== undefined && legacyFamily(decodeURIComponent(key)) !== null);
  expect(onRoutes).toEqual([]);
  const inPluginData = pushBodies()
    .flatMap((b) => (b.pluginData as Array<{ key: string }> | undefined) ?? [])
    .filter((row) => legacyFamily(row.key) !== null);
  expect(inPluginData).toEqual([]);
}

/** useStudyStoreMocks: a fresh storage and fetch stub per test, the one-storage check after it. */
export function useStudyStoreMocks(): void {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
}
