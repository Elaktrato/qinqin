import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$app/navigation", () => ({ goto }));

import { workspaces } from "../workspaces";
import { setOutboxUser } from "./outboxUser";
import { rememberSent } from "./recentSent";
import { gradeItem } from "./grade";
import type { StudyEvent } from "../events";
import type { Deck, StudyCard } from "./types";
import {
  GENERAL_DECK_ID,
  addCard,
  cardsInDecks,
  createDeck,
  PartialCardsError,
  deleteCards,
  deleteDeck,
  saveDeckCardTypes,
  saveDeckNewOrder,
  dropSiblingCards,
  skipKind,
  unskipKind,
  loadStudyData,
  moveCards,
  restoreCards,
  onStudyWrite,
  renameDeck,
  saveParamSet,
  setActiveSet,
  deleteParamSet,
  activeWeights,
  loadRawStudyData,
  pushStudy,
  PartialPushError,
  studyRowKey,
  saveVacation,
  deleteVacation,
  saveWorkspaceLimits,
  saveDeckLimits,
  saveGoals,
  setKnownMark,
  setKnownMarks,
  saveSeenMilestones,
  loadStudyDataWith,
  ALL_WORKSPACES,
} from "./store";
import seenMergeFixture from "../../../../../docs/contracts/milestones/seen-merge.json";
import { DEFAULT_W, type ParamSet } from "./fsrs/params";
import { legacyFamily, pageOf, pagedPull, toLegacy } from '$lib/testing/legacyCodec';
import { STUDY_COLLECTIONS, cardRow, type StudyCollection } from "./rows";
import * as build from '$lib/testing/study';

const PLUGIN_ID = "qinqin-flashcards";
const WORKSPACE_ID = 7;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function fakeStorage(): Storage {
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
function jsonResponse(body: unknown, status = 200): Response {
  const isPull =
    typeof body === "object" && body !== null && Array.isArray((body as { pluginData?: unknown }).pluginData);
  return rawResponse(isPull ? pagedPull(body as Record<string, unknown>) : body, status);
}

/** rawResponse answers exactly `body` (no conversion). */
function rawResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface PluginDataRow {
  pluginId: string;
  key: string;
  userId: number;
  workspaceId: number | null;
  data: unknown;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

function pluginRow(
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

function deck(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00Z",
): Deck {
  return { id, name, createdAt };
}

function card(
  id: string,
  entryId: number,
  deckIds: string[],
  createdAt = "2026-01-02T00:00:00Z",
  written?: string,
): StudyCard {
  return build.card({ id, entryId, deckIds, createdAt, written });
}

function selectWorkspace(id: number | null): void {
  workspaces.set({
    list: [],
    current:
      id === null
        ? null
        : {
            id,
            language: "zh",
            name: "",
            settings: {},
            updatedAt: "2026-01-01T00:00:00Z",
          },
  });
}

function calls(): Array<[string, RequestInit | undefined]> {
  return vi.mocked(fetch).mock.calls as Array<
    [string, RequestInit | undefined]
  >;
}

/** PUTs to the plugin-data routes: only the keyed rows (goals, known marks, vacations) still use them. */
function putBodies(): Array<{ url: string; body: unknown }> {
  return calls()
    .filter(([, init]) => init?.method === "PUT")
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)),
    }));
}

function pushBodies(): Array<Record<string, unknown>> {
  return calls()
    .filter(([url, init]) => String(url) === "/api/sync/push" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

interface Written {
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

function itemsOf(body: Record<string, unknown>): Written[] {
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
function writes(): Written[] {
  return pushBodies().flatMap(itemsOf);
}

/** The live typed writes, as the legacy rows they stand for. */
function writtenRows(): Array<{ key: string; workspaceId: number; body: unknown }> {
  return writes()
    .filter((w) => !w.deleted)
    .map(({ key, workspaceId, data }) => ({ key, workspaceId, body: data }));
}

/** The typed rows tombstoned, by legacy key. */
function deletedKeys(): string[] {
  return writes()
    .filter((w) => w.deleted)
    .map((w) => w.key);
}

/** Every row batch-written through POST /api/sync/push (typed rows as their legacy key and data), in order. */
function pushedRows(): Array<{ key: string; data: unknown; updatedAt: string }> {
  return pushBodies().flatMap((body) => [
    ...itemsOf(body).map(({ key, data, updatedAt }) => ({ key, data, updatedAt })),
    ...(((body.pluginData as Array<{ key: string; data: unknown; updatedAt: string }>) ?? [])),
  ]);
}

/** A push answer that skipped the items whose legacy key `skip` names. */
function pushAnswer(init: RequestInit | undefined, skip: (key: string) => boolean = () => false): Response {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const keys = [
    ...itemsOf(body).map((w) => w.key),
    ...((body.pluginData as Array<{ key: string }> | undefined) ?? []).map((r) => r.key),
  ];
  const skipped = keys.filter(skip).length;
  return rawResponse({ dataAccepted: keys.length - skipped, dataSkipped: skipped, dataRefused: 0 });
}

function isPush(input: unknown, init?: RequestInit): boolean {
  return String(input) === "/api/sync/push" && init?.method === "POST";
}

/**
 * respondPull answers the two reads loadStudyData makes: the sync pull
 * gets `pull`, the event log gets `events` (none by default).
 */
function respondPull(pull: unknown, events: unknown[] = []): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).startsWith("/api/events")) return jsonResponse(events);
    return rawResponse(pagedPull(pull as Record<string, unknown>));
  });
}

function reviewEvent(
  id: string,
  cardId: string,
  workspaceId = WORKSPACE_ID,
): StudyEvent {
  return build.review({ id, cardId, workspaceId, ts: "2026-02-01T00:00:00.000Z" }) as StudyEvent;
}

// The one storage rule, checked after every test (each suite's afterEach
// calls it before clearing the mocks): no typed study family ever goes
// through the plugin-data routes or a pluginData push item.
function expectOneStorage(): void {
  const onRoutes = calls()
    .map(([url]) => /^\/api\/plugins\/qinqin-flashcards\/data\/([^?]+)/.exec(String(url))?.[1])
    .filter((key): key is string => key !== undefined && legacyFamily(decodeURIComponent(key)) !== null);
  expect(onRoutes).toEqual([]);
  const inPluginData = pushBodies()
    .flatMap((b) => (b.pluginData as Array<{ key: string }> | undefined) ?? [])
    .filter((row) => legacyFamily(row.key) !== null);
  expect(inPluginData).toEqual([]);
}

describe("study store", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
  });

  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("loadStudyData over pull v2 pages", () => {
    it("follows `next` and merges a split across two pages in the middle of cards", async () => {
      const c1 = card("card-1", 41, ["general"]);
      const c2 = card("card-2", 42, ["general"]);
      const page1 = pagedPull({ pluginData: [pluginRow("card:card-1", c1)] });
      const page2 = pagedPull({ pluginData: [pluginRow("card:card-2", c2)] });
      Object.assign(page1, { more: true, next: "p2.abc", cursor: null });
      const urls: string[] = [];
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.startsWith("/api/events")) return jsonResponse([]);
        return rawResponse(url.includes("page=") ? page2 : page1);
      });
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.cards.map((c) => c.id)).toEqual(["card-1", "card-2"]);
      expect(urls.filter((u) => u.startsWith("/api/sync/pull"))[1]).toBe("/api/sync/pull?page=p2.abc&v=2");
    });

    it("refuses a page that does not match the contract", async () => {
      vi.mocked(fetch).mockImplementation(async () => rawResponse({ pluginData: [] }));
      await expect(loadStudyData(WORKSPACE_ID)).rejects.toThrow(/contract/);
    });

    it("keeps the pre-v2 pull path out of the sources", () => {
      const here = fileURLToPath(new URL("../../", import.meta.url));
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(ts|svelte)$/.test(e.name) && !e.name.endsWith(".test.ts") && readFileSync(p, "utf8").includes("SYNC_PULL_PATH")) hits.push(p);
        }
      };
      walk(here);
      expect(hits).toEqual([]);
    });
  });

  describe("loadStudyData", () => {
    it("parses only active flashcard rows of the current workspace", async () => {
      const general = deck("general", "General");
      const custom = deck("deck-1", "HSK 2");
      const word = card(
        "card-1",
        42,
        ["general"],
        "2026-01-02T00:00:00Z",
        "猫",
      );
      const sentenceCard = {
        ...card("card-2", 43, ["general", "deck-1"]),
        sentenceId: 9,
      };
      // A written snapshot of the wrong type is dropped instead of
      // poisoning the card.
      const badWritten = { ...card("card-3", 44, ["general"]), written: 42 };
      respondPull({
        pluginData: [
          pluginRow("deck:general", general),
          pluginRow("deck:deck-1", custom),
          pluginRow("card:card-1", word),
          pluginRow("card:card-2", sentenceCard),
          pluginRow("card:card-3", badWritten),
          // Another plugin's data is not study data.
          pluginRow("deck:other-plugin", deck("other-plugin", "Other"), {
            pluginId: "qinqin-heatmap",
          }),
          // Another workspace's data never leaks in.
          pluginRow(
            "deck:other-workspace",
            deck("other-workspace", "Elsewhere"),
            {
              workspaceId: 8,
            },
          ),
          // User-global (workspace-less) rows are not study data.
          pluginRow("deck:global", deck("global", "Global"), {
            workspaceId: null,
          }),
          // Tombstones are deleted rows.
          pluginRow("deck:gone", deck("gone", "Gone"), {
            deletedAt: "2026-01-03T00:00:00Z",
          }),
          // qinqin-core rows (personal notes, even one keyed like a card) are not study data.
          pluginRow(
            "note:42",
            { version: 1, entryId: 42, text: "mnemonic" },
            { pluginId: "qinqin-core" },
          ),
          pluginRow("card:core-card", card("core-card", 45, ["general"]), {
            pluginId: "qinqin-core",
          }),
          // Keys the study layer does not own are ignored.
          pluginRow("settings:study", { newLimit: 20 }),
          // A malformed payload is skipped rather than crashing.
          pluginRow("deck:broken", { name: "No id" }),
        ],
      });

      const data = await loadStudyData(WORKSPACE_ID);

      expect(data.decks).toEqual([general, custom]);
      expect(data.cards).toEqual([
        word,
        sentenceCard,
        card("card-3", 44, ["general"]),
      ]);
      expect("written" in data.cards[2]!).toBe(false);
      expect(calls().map(([url]) => String(url))).toEqual([
        `/api/sync/pull?collections=pluginStates%2CpluginData%2Ccards%2Cdecks%2CdeckSettings%2Climits%2CfsrsSets%2CfsrsActive&tombstones=1&v=2&workspace=${WORKSPACE_ID}`,
        `/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=${WORKSPACE_ID}`,
      ]);
    });

    it("accepts all four card kinds and rejects unknown kinds", async () => {
      const kinds = ["vocab", "sentence", "writing", "tone"] as const;
      const good = kinds.map((kind, i) => ({
        ...card(`card-${kind}`, 40 + i, ["general"]),
        kind,
      }));
      const bad = { ...card("card-bad", 50, ["general"]), kind: "bogus" };
      respondPull({
        pluginData: [
          ...good.map((row) => pluginRow(`card:${row.id}`, row)),
          pluginRow("card:card-bad", bad),
        ],
      });

      const data = await loadStudyData(WORKSPACE_ID);

      expect(data.cards).toEqual(good);
    });

    it("keeps a clean skipKinds list on a vocab row and drops bad entries", async () => {
      const row = {
        ...card("c-vocab-1", 1, ["general"]),
        skipKinds: ["reverse", "reverse", "bogus", "vocab"],
      };
      const plain = card("c-vocab-2", 2, ["general"]);
      const empty = { ...card("c-vocab-3", 3, ["general"]), skipKinds: ["bogus"] };
      respondPull({
        pluginData: [
          pluginRow("card:c-vocab-1", row),
          pluginRow("card:c-vocab-2", plain),
          pluginRow("card:c-vocab-3", empty),
        ],
      });

      const data = await loadStudyData(WORKSPACE_ID);

      expect(data.cards[0]!.skipKinds).toEqual(["reverse"]);
      expect("skipKinds" in data.cards[1]!).toBe(false);
      expect("skipKinds" in data.cards[2]!).toBe(false);
    });

    it("returns empty arrays when the pull has no plugin data", async () => {
      respondPull({ cursor: "2026-01-01T00:00:00Z" });

      await expect(loadStudyData(WORKSPACE_ID)).resolves.toEqual({
        decks: [],
        cards: [],
        fsrs: { sets: [], active: null, w: DEFAULT_W, pointer: null },
        reviews: [],
        merged: 0,
      });
    });

    it("returns empty arrays when matching rows only hold other keys", async () => {
      respondPull({
        pluginData: [pluginRow("settings:study", { newLimit: 20 })],
      });

      await expect(loadStudyData(WORKSPACE_ID)).resolves.toEqual({
        decks: [],
        cards: [],
        fsrs: { sets: [], active: null, w: DEFAULT_W, pointer: null },
        reviews: [],
        merged: 0,
      });
    });

    it("fails without a workspace id (the selected one is never read, #174)", async () => {
      selectWorkspace(null);

      await expect(loadStudyData(0)).rejects.toThrow(/workspace/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reads an explicitly given workspace for both the cards and the reviews", async () => {
      respondPull(
        {
          pluginData: [
            pluginRow("card:card-1", card("card-1", 42, ["general"]), {
              workspaceId: 9,
            }),
          ],
        },
        [reviewEvent("r1", "card-1", 9), reviewEvent("r2", "card-1", 7)],
      );

      const data = await loadStudyData(9);

      expect(data.cards.map((c) => c.id)).toEqual(["card-1"]);
      expect(data.reviews.map((r) => r.id)).toEqual(["r1"]);
      expect(calls().map(([url]) => String(url))).toContain(
        "/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=9",
      );
    });

    it("reads every page of the event log (#110)", async () => {
      const ev = (id: string) => ({
        ...reviewEvent(id, "card-1", 9),
        userId: 1,
        ts: "2026-02-01T00:00:00Z",
      });
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url === "/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=9")
          return jsonResponse({ events: [ev("r1")], more: true, next: "e1.k" });
        if (url === "/api/events?page=e1.k&workspace=9")
          return jsonResponse({ events: [ev("r2")], more: false, next: null });
        if (url.startsWith("/api/events")) return jsonResponse({ error: "unexpected" }, 500);
        return rawResponse(pagedPull({ pluginData: [] }));
      });

      const data = await loadStudyData(9);

      expect(data.reviews.map((r) => r.id)).toEqual(["r1", "r2"]);
    });

    it("keeps only well-formed reviews of the workspace", async () => {
      respondPull({ pluginData: [] }, [
        reviewEvent("r1", "card-1"),
        { ...reviewEvent("r2", "card-1"), type: "view" },
        {
          ...reviewEvent("r3", "card-1"),
          payload: { cardId: "card-1", grade: 9 },
        },
      ]);

      const data = await loadStudyData(WORKSPACE_ID);

      expect(data.reviews.map((r) => r.id)).toEqual(["r1"]);
    });

    it("merges duplicate cards and re-points their reviews", async () => {
      // Two older (ULID) cards for one word, created on two devices,
      // each with its own review history.
      const early = card(
        "01JAAAAAAAAAAAAAAAAAAAAAAA",
        42,
        ["general"],
        "2026-01-01T00:00:00Z",
      );
      const late = card(
        "01JBBBBBBBBBBBBBBBBBBBBBBB",
        42,
        ["deck-1"],
        "2026-01-02T00:00:00Z",
        "猫",
      );
      respondPull(
        {
          pluginData: [
            pluginRow(`card:${late.id}`, late),
            pluginRow(`card:${early.id}`, early),
          ],
        },
        [reviewEvent("r1", early.id), reviewEvent("r2", late.id)],
      );

      const data = await loadStudyData(WORKSPACE_ID);

      expect(data.merged).toBe(1);
      expect(data.cards).toEqual([
        { ...early, deckIds: ["general", "deck-1"], written: "猫" },
      ]);
      expect(data.reviews.map((r) => [r.id, r.payload.cardId])).toEqual([
        ["r1", early.id],
        ["r2", early.id],
      ]);
    });
  });

  describe("createDeck", () => {
    it("writes a ULID-keyed deck scoped to the current workspace", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));

      const created = await createDeck(WORKSPACE_ID, "  HSK 3  ");

      expect(created.id).toMatch(ULID);
      expect(created.name).toBe("  HSK 3  ");
      expect(created.createdAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
      // A new deck needs no read: one push of the typed row.
      expect(calls().map(([url]) => String(url))).toEqual(["/api/sync/push"]);
      expect(writes().map((w) => w.item)).toEqual([
        {
          id: created.id,
          name: "  HSK 3  ",
          createdAt: created.createdAt,
          source: null,
          extra: {},
          workspaceId: WORKSPACE_ID,
          updatedAt: expect.any(String),
        },
      ]);
    });

    it("fails without writing when no workspace id is given (#174)", async () => {
      selectWorkspace(null);

      await expect(createDeck(0, "HSK 3")).rejects.toThrow(/workspace/i);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("renameDeck", () => {
    it("rewrites the deck under the same id and creation time", async () => {
      const existing = deck("deck-1", "Old name", "2026-01-01T00:00:00Z");
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [pluginRow("deck:deck-1", existing)],
        });
      });

      const renamed = await renameDeck(WORKSPACE_ID, "deck-1", "New name");

      expect(renamed).toEqual(
        deck("deck-1", "New name", "2026-01-01T00:00:00Z"),
      );
      expect(writtenRows()).toEqual([
        {
          key: `deck:deck-1`, workspaceId: WORKSPACE_ID,
          body: renamed,
        },
      ]);
    });

    it("refuses to rename a deck that does not exist", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ pluginData: [] }));

      await expect(renameDeck(WORKSPACE_ID, "missing", "New name")).rejects.toThrow(/deck/i);
      expect(writtenRows()).toEqual([]);
    });
  });

  describe("deck card type settings", () => {

    it("loads deckcfg rows into deckSettings", async () => {
      respondPull({
        pluginData: [
          pluginRow("deckcfg:general", {
            deckId: "general",
            cardTypes: ["reverse"],
            updatedAt: "2026-01-01T00:00:00Z",
          }),
          pluginRow("deckcfg:bad", { deckId: "other", cardTypes: ["cloze"] }),
        ],
      });
      const data = await loadStudyData(WORKSPACE_ID);
      expect(Object.keys(data.deckSettings ?? {})).toEqual(["general"]);
      expect(data.deckSettings?.general?.cardTypes).toEqual(["reverse"]);
    });

    it("saveDeckCardTypes keeps unknown fields of the stored row", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deckcfg:general", {
              deckId: "general",
              cardTypes: [],
              updatedAt: "2026-01-01T00:00:00Z",
              limits: { new: 5 },
            }),
          ],
        });
      });
      const saved = await saveDeckCardTypes(WORKSPACE_ID, "general", ["cloze", "reverse"]);
      expect(saved.cardTypes).toEqual(["reverse", "cloze"]);
      expect(writtenRows()).toHaveLength(1);
      expect(writtenRows()[0]!.key).toBe("deckcfg:general");
      // Unknown members travel in the typed row's extra, echoed back as stored.
      expect(writes()[0]!.item).toMatchObject({ deckId: "general", cardTypes: ["reverse", "cloze"], newOrder: null, extra: { limits: { new: 5 } } });
      expect(writtenRows()[0]!.body).toMatchObject({
        deckId: "general",
        cardTypes: ["reverse", "cloze"],
        limits: { new: 5 },
      });
    });

    it("saveDeckCardTypes keeps the deck's new-card order", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deckcfg:d1", {
              deckId: "d1",
              cardTypes: [],
              newOrder: { by: "frequency" },
              updatedAt: "2026-01-01T00:00:00Z",
            }),
          ],
        });
      });
      await saveDeckCardTypes(WORKSPACE_ID, "d1", ["reverse"]);
      expect(writtenRows()[0]!.body).toMatchObject({
        deckId: "d1",
        cardTypes: ["reverse"],
        newOrder: { by: "frequency" },
      });
    });

    it("saveDeckNewOrder keeps card types and unknown fields", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deckcfg:d1", {
              deckId: "d1",
              cardTypes: ["cloze"],
              updatedAt: "2026-01-01T00:00:00Z",
              goal: { n: 5 },
            }),
          ],
        });
      });
      const saved = await saveDeckNewOrder(WORKSPACE_ID, "d1", { by: "level", packId: "hsk-words" });
      expect(saved.newOrder).toEqual({ by: "level", packId: "hsk-words" });
      expect(writtenRows()[0]!.key).toBe("deckcfg:d1");
      expect(writtenRows()[0]!.body).toMatchObject({
        deckId: "d1",
        cardTypes: ["cloze"],
        newOrder: { by: "level", packId: "hsk-words" },
        goal: { n: 5 },
      });
    });

    it("saveDeckNewOrder with added removes the field", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deckcfg:d1", {
              deckId: "d1",
              cardTypes: [],
              newOrder: { by: "frequency" },
              updatedAt: "2026-01-01T00:00:00Z",
            }),
          ],
        });
      });
      await saveDeckNewOrder(WORKSPACE_ID, "d1", { by: "added" });
      expect(writtenRows()[0]!.body).not.toHaveProperty("newOrder");
    });

    it("saveDeckNewOrder with added also drops an unreadable stored order", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deckcfg:d1", { deckId: "d1", cardTypes: [], newOrder: { by: "popular" } }),
          ],
        });
      });
      await saveDeckNewOrder(WORKSPACE_ID, "d1", { by: "added" });
      expect(writtenRows()[0]!.body).not.toHaveProperty("newOrder");
    });

    it("saveDeckCardTypes creates the row when none exists", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 1 });
        return jsonResponse({ pluginData: [] });
      });
      await saveDeckCardTypes(WORKSPACE_ID, "d9", ["reverse"]);
      expect(writtenRows()[0]!.body).toMatchObject({ deckId: "d9", cardTypes: ["reverse"] });
    });

    it("deleteDeck tombstones the deck's deckcfg row after the deck row; a skipped tombstone is fine", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        // Another tab removed the settings row already: the server skips its tombstone.
        if (isPush(input, init)) return pushAnswer(init, (key) => key.startsWith("deckcfg:"));
        return jsonResponse({
          pluginData: [
            pluginRow("deck:d1", deck("d1", "Doomed")),
            pluginRow("deckcfg:d1", { deckId: "d1", cardTypes: ["reverse"] }),
          ],
        });
      });
      await deleteDeck(WORKSPACE_ID, "d1");
      expect(deletedKeys()).toEqual(["deck:d1", "deckcfg:d1"]);
      // Each tombstone is its own push, the deck's first.
      expect(pushBodies().map((b) => Object.keys(b).filter((k) => (b[k] as unknown[]).length > 0))).toEqual([
        ["decks"],
        ["deckSettings"],
      ]);
    });
  });

  describe("sibling kinds of a word", () => {
    const rowUrl = (id: string) => `card:${id}`;
    const typed = (id: string, kind: string, entryId: number): StudyCard => ({
      ...card(id, entryId, ["general"]),
      kind,
    }) as StudyCard;

    function stub(rows: StudyCard[]): void {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: rows.map((row) => pluginRow(`card:${row.id}`, row)),
        });
      });
    }
    const deletes = () => deletedKeys();

    it("dropSiblingCards tombstones the sibling and adds its kind to the vocab row", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      const reverse = typed("c-reverse-7", "reverse", 7);
      const cloze = typed("c-cloze-7", "cloze", 7);
      stub([vocab, reverse, cloze]);

      const previous = await dropSiblingCards(WORKSPACE_ID, ["c-reverse-7"]);

      expect(deletes()).toEqual([rowUrl("c-reverse-7")]);
      expect(writtenRows()).toEqual([
        { key: rowUrl("c-vocab-7"), workspaceId: WORKSPACE_ID, body: { ...vocab, skipKinds: ["reverse"] } },
      ]);
      expect(previous.map((row) => row.id).sort()).toEqual(["c-reverse-7", "c-vocab-7"]);
    });

    it("undo through restoreCards brings back the vocab row and the sibling", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      const reverse = typed("c-reverse-7", "reverse", 7);
      stub([vocab, reverse]);
      const previous = await dropSiblingCards(WORKSPACE_ID, ["c-reverse-7"]);
      vi.mocked(fetch).mockClear();
      // The server holds what the drop wrote: the skip on the vocab row, the sibling gone.
      stub([{ ...vocab, skipKinds: ["reverse"] }]);
      await restoreCards(WORKSPACE_ID, previous);
      const bodies = writtenRows();
      expect(bodies.map((b) => b.key).sort()).toEqual(
        [rowUrl("c-reverse-7"), rowUrl("c-vocab-7")].sort(),
      );
      const restoredVocab = bodies.find((b) => b.key === rowUrl("c-vocab-7"))!.body as StudyCard;
      expect("skipKinds" in restoredVocab).toBe(false);
    });

    it("a stray sibling without a vocab row is only tombstoned", async () => {
      stub([typed("c-cloze-9", "cloze", 9)]);
      await dropSiblingCards(WORKSPACE_ID, ["c-cloze-9"]);
      expect(deletes()).toEqual([rowUrl("c-cloze-9")]);
      expect(writtenRows()).toEqual([]);
    });

    it("refuses a vocab id", async () => {
      stub([typed("c-vocab-7", "vocab", 7)]);
      await expect(dropSiblingCards(WORKSPACE_ID, ["c-vocab-7"])).rejects.toThrow();
      expect(deletes()).toEqual([]);
    });

    it("skipKind and unskipKind write only the vocab rows", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      stub([vocab]);
      const before = await skipKind(WORKSPACE_ID, 7, "cloze");
      expect(before).toEqual([vocab]);
      expect(writtenRows()[0]!.body).toEqual({ ...vocab, skipKinds: ["cloze"] });

      vi.mocked(fetch).mockClear();
      const skipped = { ...vocab, skipKinds: ["reverse", "cloze"] } as StudyCard;
      stub([skipped]);
      const prev = await unskipKind(WORKSPACE_ID, 7, "cloze");
      expect(prev).toEqual([skipped]);
      expect(writtenRows()[0]!.body).toEqual({ ...vocab, skipKinds: ["reverse"] });
    });

    it("unskipKind drops the field when the list empties; no vocab row is an error", async () => {
      const skipped = { ...typed("c-vocab-7", "vocab", 7), skipKinds: ["reverse"] } as StudyCard;
      stub([skipped]);
      await unskipKind(WORKSPACE_ID, 7, "reverse");
      expect("skipKinds" in (writtenRows()[0]!.body as object)).toBe(false);
      stub([]);
      await expect(skipKind(WORKSPACE_ID, 8, "reverse")).rejects.toThrow();
    });

    it("deleting the word also tombstones its reverse and cloze cards", async () => {
      stub([
        typed("c-vocab-7", "vocab", 7),
        typed("c-reverse-7", "reverse", 7),
        typed("c-cloze-7", "cloze", 7),
      ]);
      await deleteCards(WORKSPACE_ID, ["c-vocab-7"]);
      expect(deletes().sort()).toEqual(
        [rowUrl("c-vocab-7"), rowUrl("c-reverse-7"), rowUrl("c-cloze-7")].sort(),
      );
    });

    it("moving the word moves its reverse and cloze cards", async () => {
      vi.mocked(fetch).mockImplementation(async (_i, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:d2", deck("d2", "Two")),
            ...["c-vocab-7:vocab", "c-reverse-7:reverse", "c-cloze-7:cloze"].map((spec) => {
              const [id, kind] = spec.split(":");
              return pluginRow(`card:${id}`, typed(id!, kind!, 7));
            }),
          ],
        });
      });
      await moveCards(WORKSPACE_ID, ["c-vocab-7"], "d2");
      expect(writtenRows().map((b) => b.key).sort()).toEqual(
        [rowUrl("c-vocab-7"), rowUrl("c-reverse-7"), rowUrl("c-cloze-7")].sort(),
      );
    });
  });

  describe("deleteDeck", () => {
    it("deletes the deck and moves cards that only lived there to general", async () => {
      const orphan = card(
        "card-orphan",
        42,
        ["deck-1"],
        "2026-01-02T00:00:00Z",
      );
      const shared = card("card-shared", 43, ["deck-1", "deck-2"]);
      const elsewhere = card("card-elsewhere", 44, ["deck-2"]);
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Doomed")),
            pluginRow("deck:deck-2", deck("deck-2", "Kept")),
            pluginRow("card:card-orphan", orphan),
            pluginRow("card:card-shared", shared),
            pluginRow("card:card-elsewhere", elsewhere),
          ],
        });
      });

      await deleteDeck(WORKSPACE_ID, "deck-1");

      expect(deletedKeys()).toEqual(["deck:deck-1"]);
      // The cards go out as one batch, before the tombstone.
      expect(pushBodies()).toHaveLength(2);
      expect(itemsOf(pushBodies()[0]!).map(({ key, data }) => ({ key, data }))).toEqual([
        { key: "card:card-orphan", data: { ...orphan, deckIds: [GENERAL_DECK_ID] } },
        { key: "card:card-shared", data: { ...shared, deckIds: ["deck-2"] } },
      ]);
      expect(itemsOf(pushBodies()[1]!).map((w) => [w.key, w.deleted])).toEqual([["deck:deck-1", true]]);
    });

    it("rewrites every stored duplicate of a card, not only the merged one", async () => {
      const early = card("card-early", 42, ["deck-1"], "2026-01-01T00:00:00Z");
      const late = card("card-late", 42, ["deck-1"], "2026-01-02T00:00:00Z");
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Doomed")),
            pluginRow("card:card-early", early),
            pluginRow("card:card-late", late),
          ],
        });
      });

      await deleteDeck(WORKSPACE_ID, "deck-1");

      expect(writes().filter((w) => !w.deleted).map((row) => row.key)).toEqual(["card:card-early", "card:card-late"]);
    });

    it("refuses to delete the implicit general deck without touching the server", async () => {
      await expect(deleteDeck(WORKSPACE_ID, GENERAL_DECK_ID)).rejects.toThrow(/general/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("keeps a card in its other decks when one deck is deleted", async () => {
      const shared = card("card-shared", 43, ["deck-1", "deck-2"]);
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Doomed")),
            pluginRow("deck:deck-2", deck("deck-2", "Kept")),
            pluginRow("card:card-shared", shared),
          ],
        });
      });

      await deleteDeck(WORKSPACE_ID, "deck-1");

      expect(writtenRows().map(({ key, body }) => ({ key, data: body }))).toEqual([
        { key: "card:card-shared", data: { ...shared, deckIds: ["deck-2"] } },
      ]);
      expect(deletedKeys()).toEqual(["deck:deck-1"]);
    });

    it("lands a multi-deck card in general after sequential deck deletions", async () => {
      const decks = new Map<string, Deck>([
        ["deck:deck-1", deck("deck-1", "One")],
        ["deck:deck-2", deck("deck-2", "Two")],
      ]);
      const cards = new Map<string, StudyCard>([
        ["card:card-1", card("card-1", 42, ["deck-1", "deck-2"])],
      ]);
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) {
          const items = itemsOf(JSON.parse(String(init?.body)));
          for (const w of items) {
            if (w.deleted) decks.delete(w.key);
            else cards.set(w.key, w.data as unknown as StudyCard);
          }
          return rawResponse({ dataAccepted: items.length, dataSkipped: 0, dataRefused: 0 });
        }
        return jsonResponse({
          pluginData: [
            ...[...decks].map(([key, data]) => pluginRow(key, data)),
            ...[...cards].map(([key, data]) => pluginRow(key, data)),
          ],
        });
      });

      await deleteDeck(WORKSPACE_ID, "deck-1");
      await deleteDeck(WORKSPACE_ID, "deck-2");

      expect(cards.get("card:card-1")?.deckIds).toEqual([GENERAL_DECK_ID]);
      expect(writtenRows().map((row) => (row.body as StudyCard).deckIds)).toEqual([
        ["deck-2"],
        [GENERAL_DECK_ID],
      ]);
    });
  });

  describe("addCard", () => {
    // addCard reads the workspace's cards before writing so a repeat
    // add returns the existing card; the pull must be answered too.
    function respondWith(rows: unknown[]): void {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 1 });
        if (String(input).startsWith("/api/events")) return jsonResponse([]);
        return jsonResponse({ pluginData: rows });
      });
    }

    it("writes into an explicitly given workspace instead of the selected one", async () => {
      respondWith([]);

      const added = await addCard(9, 42);

      expect(writtenRows().map(({ key, workspaceId }) => [key, workspaceId])).toEqual([[`card:${added.id}`, 9]]);
    });

    it("reads the explicit workspace for its dedupe", async () => {
      // The selected workspace (7) has the card; workspace 9 does not.
      respondWith([pluginRow("card:card-1", card("card-1", 42, ["general"]))]);

      const added = await addCard(9, 42);

      expect(added.id).not.toBe("card-1");
    });

    it("tells write listeners which workspace changed", async () => {
      respondWith([]);
      const seen: number[] = [];
      const stop = onStudyWrite((id) => seen.push(id));

      await addCard(WORKSPACE_ID, 42);
      await addCard(9, 43);
      await createDeck(WORKSPACE_ID, "HSK 1");
      stop();
      await addCard(WORKSPACE_ID, 44);

      expect(seen).toEqual([WORKSPACE_ID, 9, WORKSPACE_ID]);
    });

    it("writes a vocab card in the general deck", async () => {
      respondWith([]);

      const added = await addCard(WORKSPACE_ID, 42);

      expect(added.id).toBe("c-vocab-42");
      expect(added.kind).toBe("vocab");
      expect(added.entryId).toBe(42);
      expect(added.deckIds).toEqual([GENERAL_DECK_ID]);
      expect(added.createdAt).toEqual(expect.any(String));
      expect("sentenceId" in added).toBe(false);
      expect("written" in added).toBe(false);
      expect(writtenRows()).toEqual([{ key: `card:${added.id}`, workspaceId: WORKSPACE_ID, body: added }]);
      expect(writes()[0]!.item).toEqual({
        id: "c-vocab-42",
        kind: "vocab",
        entryId: 42,
        written: null,
        entryKind: null,
        sentenceId: null,
        skipKinds: [],
        deckIds: [GENERAL_DECK_ID],
        createdAt: added.createdAt,
        extra: {},
        workspaceId: WORKSPACE_ID,
        updatedAt: expect.any(String),
      });
    });

    it("keeps the entry kind snapshot of a character card across a round trip", async () => {
      respondWith([]);
      const added = await addCard(WORKSPACE_ID, 11, {
        kind: "writing",
        written: "学",
        entryKind: "character",
      });
      expect(added.entryKind).toBe("character");
      const body = writtenRows()[0]!.body as StudyCard;
      expect(body.entryKind).toBe("character");
      respondWith([pluginRow(`card:${added.id}`, body)]);
      const { cards } = await loadStudyData(WORKSPACE_ID);
      expect(cards[0].entryKind).toBe("character");
    });

    it("writes the requested kind and does not collide with the vocab card", async () => {
      const vocab = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", vocab)]);

      const added = await addCard(WORKSPACE_ID, 42, { kind: "sentence", sentenceId: 9 });

      expect(added.id).not.toBe("card-1");
      expect(added.kind).toBe("sentence");
      expect(added.sentenceId).toBe(9);
      expect(writtenRows()).toHaveLength(
        1,
      );
    });

    it("creates one sentence card per sentence and dedupes a repeat", async () => {
      const first = {
        ...card("card-s9", 42, ["general"]),
        kind: "sentence",
        sentenceId: 9,
      };
      respondWith([pluginRow("card:card-s9", first)]);

      const same = await addCard(WORKSPACE_ID, 42, { kind: "sentence", sentenceId: 9 });
      expect(same.id).toBe("card-s9");
      expect(writtenRows()).toHaveLength(
        0,
      );

      const other = await addCard(WORKSPACE_ID, 42, { kind: "sentence", sentenceId: 10 });
      expect(other.id).not.toBe("card-s9");
      expect(other.sentenceId).toBe(10);
    });

    it("derives the id of a new card from its kind and entry", async () => {
      respondWith([]);

      await expect(addCard(WORKSPACE_ID, 42, { kind: "writing" })).resolves.toMatchObject({
        id: "c-writing-42",
      });
      await expect(addCard(WORKSPACE_ID, 42, { kind: "tone" })).resolves.toMatchObject({
        id: "c-tone-42",
      });
      await expect(
        addCard(WORKSPACE_ID, 42, { kind: "sentence", sentenceId: 9 }),
      ).resolves.toMatchObject({
        id: "c-sentence-42",
      });
      expect(writtenRows().map((entry) => entry.key)).toEqual([
        "card:c-writing-42",
        "card:c-tone-42",
        "card:c-sentence-42",
      ]);
    });

    it("never overwrites another sentence card that holds the derived id", async () => {
      const s9 = {
        ...card("c-sentence-42", 42, ["general"]),
        kind: "sentence",
        sentenceId: 9,
      };
      respondWith([pluginRow("card:c-sentence-42", s9)]);

      const s10 = await addCard(WORKSPACE_ID, 42, { kind: "sentence", sentenceId: 10 });

      expect(s10.id).toBe("c-sentence-42-10");
      expect(writtenRows().map((entry) => entry.key)).toEqual(["card:c-sentence-42-10"]);
    });

    it("falls back to a ULID when every derived id is taken", async () => {
      const s9 = {
        ...card("c-sentence-42", 42, ["general"]),
        kind: "sentence",
        sentenceId: 9,
      };
      respondWith([pluginRow("card:c-sentence-42", s9)]);

      const bare = await addCard(WORKSPACE_ID, 42, { kind: "sentence" });

      expect(bare.id).toMatch(ULID);
    });

    it("returns the earliest of several stored duplicates", async () => {
      const late = card("card-late", 42, ["general"], "2026-01-03T00:00:00Z");
      const early = card("card-early", 42, ["general"], "2026-01-01T00:00:00Z");
      respondWith([
        pluginRow("card:card-late", late),
        pluginRow("card:card-early", early),
      ]);

      await expect(addCard(WORKSPACE_ID, 42)).resolves.toEqual(early);
      expect(writtenRows()).toEqual([]);
    });

    it("lets two devices that add the same word at once converge on one card", async () => {
      // One server, last write wins per key. Both devices pull before
      // either writes, so neither sees the other's card.
      const server = new Map<string, unknown>();
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (isPush(input, init)) {
          const items = itemsOf(JSON.parse(String(init?.body)));
          for (const w of items) server.set(w.key, w.data);
          return rawResponse({ dataAccepted: items.length, dataSkipped: 0, dataRefused: 0 });
        }
        if (url.startsWith("/api/events")) {
          return jsonResponse([
            reviewEvent("r-a", "c-vocab-42"),
            reviewEvent("r-b", "c-vocab-42"),
          ]);
        }
        const snapshot = [...server].map(([key, data]) => pluginRow(key, data));
        return jsonResponse({ pluginData: snapshot });
      });

      const [deviceA, deviceB] = await Promise.all([
        addCard(WORKSPACE_ID, 42, { written: "猫" }),
        addCard(WORKSPACE_ID, 42, { written: "猫", deckIds: ["deck-1"] }),
      ]);

      expect(writtenRows()).toHaveLength(2);
      expect(deviceA.id).toBe(deviceB.id);
      expect([...server.keys()]).toEqual(["card:c-vocab-42"]);
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.cards).toHaveLength(1);
      expect(data.merged).toBe(0);
      expect(data.reviews.map((r) => r.payload.cardId)).toEqual([
        "c-vocab-42",
        "c-vocab-42",
      ]);
    });

    it("gives a graded companion the derived id and never rewrites an existing card", async () => {
      const existing = {
        ...card("c-writing-42", 42, ["general"], "2026-01-01T00:00:00Z", "貓"),
        kind: "writing",
      };
      respondWith([pluginRow("card:c-writing-42", existing)]);
      const recordReview = vi.fn(async () => {});
      const item = {
        cardId: "companion:writing:42",
        entryId: 42,
        virtual: true,
        card: null,
        kind: "writing" as const,
      };

      const kept = await gradeItem({
        item,
        grade: 3,
        workspaceId: WORKSPACE_ID,
        entry: { written: "猫" },
        addCard,
        recordReview,
      });
      expect(kept).toMatchObject({ ok: true, card: existing });
      expect(writtenRows()).toEqual([]);

      respondWith([]);
      const created = await gradeItem({
        item: { ...item, cardId: "companion:tone:42", kind: "tone" as const },
        grade: 3,
        workspaceId: WORKSPACE_ID,
        entry: { written: "猫" },
        addCard,
        recordReview,
      });
      expect(created).toMatchObject({
        ok: true,
        card: { id: "c-tone-42", written: "猫" },
      });
      expect(
        recordReview.mock.calls.map((call) => (call as unknown[])[1]),
      ).toEqual(["c-writing-42", "c-tone-42"]);
    });

    it("stores the entry written form and the sentence id", async () => {
      respondWith([]);

      const added = await addCard(WORKSPACE_ID, 42, { written: "猫", sentenceId: 9 });

      expect(added.written).toBe("猫");
      expect(added.sentenceId).toBe(9);
      expect(writtenRows()[0]!.body).toEqual(added);
    });

    it("stores the card in explicitly requested decks", async () => {
      respondWith([]);

      const added = await addCard(WORKSPACE_ID, 42, {
        deckIds: ["deck-a", "deck-b", "deck-a"],
      });

      expect(added.deckIds).toEqual(["deck-a", "deck-b"]);
      expect(writtenRows()[0]!.body).toEqual(added);
    });

    it("falls back to general when no deck is given", async () => {
      respondWith([]);

      const added = await addCard(WORKSPACE_ID, 42, { deckIds: [] });

      expect(added.deckIds).toEqual([GENERAL_DECK_ID]);
    });

    it("returns the existing card instead of writing a duplicate", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(WORKSPACE_ID, 42)).resolves.toEqual(existing);
      expect(writtenRows()).toEqual([]);
    });

    it("dedupes a legacy vocab card that stored a sentenceId by entry", async () => {
      const legacy = { ...card("card-1", 42, ["general"]), sentenceId: 9 };
      respondWith([pluginRow("card:card-1", legacy)]);

      await expect(addCard(WORKSPACE_ID, 42)).resolves.toEqual(legacy);
      await expect(addCard(WORKSPACE_ID, 42, { sentenceId: 10 })).resolves.toEqual(legacy);
      expect(writtenRows()).toEqual([]);
    });

    it("leaves an existing card unchanged even when another deck is requested", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(WORKSPACE_ID, 42, { deckIds: ["deck-a"] })).resolves.toEqual(
        existing,
      );
      expect(writtenRows()).toEqual([]);
    });

    it("leaves an existing legacy card without a written snapshot unchanged", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(WORKSPACE_ID, 42, { written: "猫" })).resolves.toEqual(existing);
      expect(writtenRows()).toEqual([]);
    });
  });

  describe("card management", () => {
    const vocab = card(
      "c-vocab-42",
      42,
      ["deck-1"],
      "2026-01-01T00:00:00Z",
      "你好",
    );
    const companion: StudyCard = {
      id: "c-writing-42",
      kind: "writing",
      entryId: 42,
      deckIds: ["deck-1"],
      createdAt: "2026-01-03T00:00:00Z",
    };
    const dupe = card("01DUPE", 42, ["deck-2"], "2026-01-02T00:00:00Z");
    const other = card("c-vocab-43", 43, ["deck-1"]);

    function serve(rows: StudyCard[]): void {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (init?.method === "PUT") return jsonResponse({ version: 2 });
        return jsonResponse({
          pluginData: [
            ...["deck-1", "deck-2", "deck-3"].map((id) =>
              pluginRow(`deck:${id}`, deck(id, id)),
            ),
            ...rows.map((row) => pluginRow(`card:${row.id}`, row)),
          ],
        });
      });
    }

    it("tombstones the card, its stored duplicates and its companion cards", async () => {
      serve([vocab, companion, dupe, other]);
      const removed = await deleteCards(WORKSPACE_ID, ["c-vocab-42"]);
      expect(deletedKeys().sort()).toEqual(
        ["card:01DUPE", "card:c-vocab-42", "card:c-writing-42"].sort(),
      );
      expect(removed.map((row) => row.id).sort()).toEqual([
        "01DUPE",
        "c-vocab-42",
        "c-writing-42",
      ]);
    });

    it("tombstones companions and duplicates before the vocab row it was asked for", async () => {
      serve([vocab, companion, dupe]);
      await deleteCards(WORKSPACE_ID, ["c-vocab-42"]);
      const order = deletedKeys();
      expect(order[order.length - 1]).toBe("card:c-vocab-42");
      expect(order.indexOf("card:c-writing-42")).toBeLessThan(
        order.indexOf("card:c-vocab-42"),
      );
    });

    it("treats a skipped tombstone as already gone and does not report it as removed", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        // Another tab deleted the companion: the server skips its tombstone.
        if (isPush(input, init)) return pushAnswer(init, (key) => key === "card:c-writing-42");
        return jsonResponse({
          pluginData: [vocab, companion].map((row) =>
            pluginRow(`card:${row.id}`, row),
          ),
        });
      });
      const removed = await deleteCards(WORKSPACE_ID, ["c-vocab-42"]);
      expect(removed.map((row) => row.id)).toEqual(["c-vocab-42"]);
    });

    it("a failed delete reports the rows that did land so they can be undone", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) {
          return itemsOf(JSON.parse(String(init?.body))).some((w) => w.key === "card:c-vocab-42")
            ? rawResponse({ error: "boom" }, 500)
            : pushAnswer(init);
        }
        return jsonResponse({
          pluginData: [vocab, companion].map((row) =>
            pluginRow(`card:${row.id}`, row),
          ),
        });
      });
      const err = await deleteCards(WORKSPACE_ID, ["c-vocab-42"]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PartialCardsError);
      expect((err as PartialCardsError).rows.map((row) => row.id)).toEqual([
        "c-writing-42",
      ]);
    });

    it("a failed restore keeps the rows that were not written", async () => {
      let puts = 0;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) {
          puts += 1;
          return puts === 2 ? rawResponse({ error: "boom" }, 500) : pushAnswer(init);
        }
        return jsonResponse({ pluginData: [] });
      });
      const err = await restoreCards(WORKSPACE_ID, [vocab, companion, other]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(PartialCardsError);
      expect((err as PartialCardsError).rows.map((row) => row.id)).toEqual([
        "c-vocab-42",
        "c-writing-42",
      ]);
    });

    it("restore with onlyLive skips cards another tab deleted since", async () => {
      // `other` was moved since (so the undo rewrites it); `vocab` was deleted.
      serve([{ ...other, deckIds: ["deck-3"] }]);
      await restoreCards(WORKSPACE_ID, [vocab, other], { onlyLive: true });
      expect(writtenRows().map((entry) => (entry.body as StudyCard).id)).toEqual([
        "c-vocab-43",
      ]);
    });

    it("undoing a move puts every row back into its old decks", async () => {
      serve([vocab, companion, dupe]);
      const before = await moveCards(WORKSPACE_ID, ["c-vocab-42"], "deck-3");
      vi.mocked(fetch).mockClear();
      // The server now holds the moved rows.
      serve([vocab, companion, dupe].map((row) => ({ ...row, deckIds: ["deck-3"] })));
      await restoreCards(WORKSPACE_ID, before, { onlyLive: true });
      const byId = new Map(
        writtenRows().map((entry) => [(entry.body as StudyCard).id, entry.body]),
      );
      expect(byId.get("c-vocab-42")).toEqual(vocab);
      expect(byId.get("c-writing-42")).toEqual(companion);
      expect(byId.get("01DUPE")).toEqual(dupe);
    });

    it("deleting a non-vocab card leaves the vocab card alone", async () => {
      serve([vocab, companion]);
      await deleteCards(WORKSPACE_ID, ["c-writing-42"]);
      expect(deletedKeys()).toEqual(["card:c-writing-42"]);
    });

    it("ignores unknown ids and writes nothing for an empty list", async () => {
      serve([vocab]);
      expect(await deleteCards(WORKSPACE_ID, ["nope"])).toEqual([]);
      expect(await deleteCards(WORKSPACE_ID, [])).toEqual([]);
      expect(deletedKeys()).toEqual([]);
    });

    it("restoreCards puts the removed rows back unchanged", async () => {
      serve([]);
      // Deletion order is companions first, so undo writes the word first.
      await restoreCards(WORKSPACE_ID, [companion, vocab]);
      expect(writtenRows()).toEqual([
        {
          key: `card:c-vocab-42`, workspaceId: WORKSPACE_ID,
          body: vocab,
        },
        {
          key: `card:c-writing-42`, workspaceId: WORKSPACE_ID,
          body: companion,
        },
      ]);
    });

    it("moves cards (and their duplicates and companions) into the target deck", async () => {
      serve([vocab, companion, dupe, other]);
      await moveCards(WORKSPACE_ID, ["c-vocab-42"], "deck-3");
      const bodies = writtenRows();
      expect(
        bodies
          .map((entry) => entry.key)
          .sort(),
      ).toEqual(["card:01DUPE", "card:c-vocab-42", "card:c-writing-42"]);
      for (const entry of bodies)
        expect((entry.body as StudyCard).deckIds).toEqual(["deck-3"]);
    });

    it("skips rows already only in the target deck", async () => {
      serve([vocab, other]);
      await moveCards(WORKSPACE_ID, ["c-vocab-42", "c-vocab-43"], "deck-1");
      expect(writtenRows()).toEqual([]);
    });

    it("rejects a deck that does not exist", async () => {
      serve([vocab]);
      await expect(moveCards(WORKSPACE_ID, ["c-vocab-42"], "ghost")).rejects.toThrow(
        /not found/,
      );
      expect(writtenRows()).toEqual([]);
    });

    it("moves into the implicit general deck", async () => {
      serve([vocab]);
      await moveCards(WORKSPACE_ID, ["c-vocab-42"], GENERAL_DECK_ID);
      expect(writtenRows()).toHaveLength(1);
    });

    it("rejects an empty target and the move leaves the store untouched", async () => {
      serve([vocab]);
      await expect(moveCards(WORKSPACE_ID, ["c-vocab-42"], "")).rejects.toThrow(/deck/i);
      expect(writtenRows()).toEqual([]);
    });

    it("a tombstoned card no longer loads", async () => {
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).startsWith("/api/events") ? jsonResponse([]) : jsonResponse({
          pluginData: [
            pluginRow("card:c-vocab-42", vocab, {
              deletedAt: "2026-02-01T00:00:00Z",
            }),
            pluginRow("card:c-vocab-43", other),
          ],
          events: [],
        }),
      );
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.cards.map((c) => c.id)).toEqual(["c-vocab-43"]);
    });
  });

  describe("cardsInDecks", () => {
    it("keeps cards in any of the requested decks", () => {
      const general = card("card-1", 1, ["general"]);
      const custom = card("card-2", 2, ["deck-1"]);
      const both = card("card-3", 3, ["deck-1", "deck-2"]);

      expect(cardsInDecks([general, custom, both], ["general"])).toEqual([
        general,
      ]);
      expect(cardsInDecks([general, custom, both], ["deck-1"])).toEqual([
        custom,
        both,
      ]);
      expect(
        cardsInDecks([general, custom, both], ["deck-1", "deck-2"]),
      ).toEqual([custom, both]);
      expect(cardsInDecks([general, custom, both], [])).toEqual([]);
    });
  });

  describe("FSRS parameter sets", () => {
    function wWith(i: number, v: number): number[] {
      const w = [...DEFAULT_W];
      w[i] = v;
      return w;
    }
    function setRow(id: string, w: number[], overrides = {}) {
      const data: ParamSet = {
        id,
        w,
        createdAt: id === "A" ? "2026-01-01T00:00:00Z" : "2026-02-01T00:00:00Z",
        source: "optimized",
      };
      return pluginRow(`fsrs:set:${id}`, data, overrides);
    }

    it("resolves the active pointer from the pull", async () => {
      respondPull({
        pluginData: [
          setRow("A", wWith(8, 1.5)),
          setRow("B", wWith(8, 2.5)),
          pluginRow("fsrs:active", { setId: "B", changedAt: "x" }),
        ],
      });
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.fsrs?.active?.id).toBe("B");
      expect(data.fsrs?.w).toEqual(wWith(8, 2.5));
      expect(data.fsrs?.sets.map((s) => s.id)).toEqual(["B", "A"]);
      expect(activeWeights(data)).toEqual(wWith(8, 2.5));
    });

    it("uses the defaults for a tombstoned active row and without fsrs", async () => {
      respondPull({
        pluginData: [
          setRow("A", wWith(8, 1.5)),
          pluginRow("fsrs:active", { setId: "A", changedAt: "x" }, {
            deletedAt: "2026-03-01T00:00:00Z",
          }),
        ],
      });
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.fsrs?.active).toBeNull();
      expect(activeWeights(data)).toEqual(DEFAULT_W);
      expect(activeWeights({})).toEqual(DEFAULT_W);
    });

    it("ignores rows of another workspace and invalid sets", async () => {
      respondPull({
        pluginData: [
          setRow("A", wWith(8, 1.5), { workspaceId: 8 }),
          setRow("B", wWith(4, 11)),
          pluginRow("fsrs:active", { setId: "A", changedAt: "x" }, { workspaceId: 8 }),
        ],
      });
      const data = await loadStudyData(WORKSPACE_ID);
      expect(data.fsrs?.sets).toEqual([]);
      expect(data.fsrs?.w).toEqual(DEFAULT_W);
    });

    it("saves a set under a ULID key and notifies listeners", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));
      const listener = vi.fn();
      onStudyWrite(listener);
      const saved = await saveParamSet(WORKSPACE_ID, {
        w: [...DEFAULT_W],
        source: "imported",
      });
      expect(saved.id).toMatch(ULID);
      expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
      const [put] = writtenRows();
      expect(put.key).toBe(`fsrs:set:${saved.id}`);
      expect(put.workspaceId).toBe(WORKSPACE_ID);
      expect(put.body).toEqual(saved);
      expect(writes()[0]!.item).toMatchObject({ labelled: null, logLoss: null, baselineLogLoss: null, extra: {} });
      expect(listener).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it("writes the active pointer, null meaning the defaults", async () => {
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).startsWith("/api/sync/pull") ? jsonResponse(pagedPull({ pluginData: [] })) : jsonResponse({ version: 1 }),
      );
      await setActiveSet(WORKSPACE_ID, "A");
      // The server now holds A: switching back to the defaults writes setId null.
      respondPull({ pluginData: [pluginRow("fsrs:active", { setId: "A", changedAt: "2026-01-06T00:00:00Z" })] });
      await setActiveSet(WORKSPACE_ID, null);
      const [first, second] = writtenRows();
      expect(first.key).toBe("fsrs:active");
      expect(first.body).toEqual({ setId: "A", changedAt: expect.any(String) });
      expect(second.body).toEqual({ setId: null, changedAt: expect.any(String) });
    });

    it("refuses to delete the active set and deletes another", async () => {
      respondPull({
        pluginData: [
          setRow("A", wWith(8, 1.5)),
          setRow("B", wWith(8, 2.5)),
          pluginRow("fsrs:active", { setId: "B", changedAt: "x" }),
        ],
      });
      await expect(deleteParamSet(WORKSPACE_ID, "B")).rejects.toThrow(
        "Cannot delete the active parameters.",
      );
      expect(writes()).toEqual([]);
      await deleteParamSet(WORKSPACE_ID, "A");
      expect(deletedKeys()).toEqual(["fsrs:set:A"]);
      expect(writes()).toHaveLength(1);
    });
  });

  describe("deleting a big deck and clock skew", () => {
    it("deleteDeck rewrites 450 cards in 3 requests, then tombstones the deck", async () => {
      const cards = Array.from({ length: 450 }, (_, i) => card(`card-${i}`, i + 1, ["deck-1"]));
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) return pushAnswer(init);
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Big")),
            ...cards.map((c) => pluginRow(`card:${c.id}`, c)),
          ],
        });
      });
      await deleteDeck(WORKSPACE_ID, "deck-1");
      const pushes = pushBodies().map((b) => itemsOf(b));
      expect(pushes.map((items) => items.length)).toEqual([200, 200, 50, 1]);
      expect(pushes.slice(0, 3).flat().every((w) => w.collection === "cards" && !w.deleted)).toBe(true);
      expect(pushes[3]!.map((w) => [w.key, w.deleted])).toEqual([["deck:deck-1", true]]);
    });

    it("deleteDeck stops before the tombstone when a chunk fails", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) return new Response("boom", { status: 500 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Doomed")),
            pluginRow("card:card-1", card("card-1", 1, ["deck-1"])),
          ],
        });
      });
      await expect(deleteDeck(WORKSPACE_ID, "deck-1")).rejects.toThrow();
      expect(deletedKeys()).toEqual([]);
    });

    it("stamps a row after the newest time the client knows of it, even with a clock behind the server", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
      try {
        vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 2, dataSkipped: 0, dataRefused: 0 }));
        await pushStudy(WORKSPACE_ID, [
          { collection: "cards", row: cardRow(card("a", 1, ["general"])), knownAt: "2026-03-10T12:00:05.250Z" }, // server tombstone is ahead
          { collection: "cards", row: cardRow(card("b", 2, ["general"])), knownAt: "2026-03-09T00:00:00.000Z" }, // known time is older: now wins
          { collection: "cards", row: cardRow(card("c", 3, ["general"])) },
        ]);
        const stamps = pushedRows().map((r) => [r.key, r.updatedAt]);
        expect(stamps).toEqual([
          ["card:a", "2026-03-10T12:00:05.251Z"],
          ["card:b", "2026-03-10T12:00:00.000Z"],
          ["card:c", "2026-03-10T12:00:00.000Z"],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("loadRawStudyData reports the newest known time of every row, tombstones included", async () => {
      respondPull({
        pluginData: [
          pluginRow("card:live", { id: "live", kind: "vocab", entryId: 1, deckIds: ["general"], createdAt: "2026-01-01T00:00:00Z" }, { updatedAt: "2026-02-01T00:00:00Z" }),
          // A tombstone keeps its last data (migrated tombstones are typed rows too).
          pluginRow("card:gone", { id: "gone", kind: "vocab", entryId: 2, deckIds: ["general"], createdAt: "2026-01-01T00:00:00Z" }, { updatedAt: "2026-02-02T00:00:00Z", deletedAt: "2026-02-03T00:00:00Z" }),
        ],
      });
      const raw = await loadRawStudyData(WORKSPACE_ID);
      // Keyed `<collection>:<identity>` (studyRowKey).
      expect(raw.knownAt.get("cards:live")).toBe("2026-02-01T00:00:00Z");
      expect(raw.knownAt.get("cards:gone")).toBe("2026-02-03T00:00:00Z");
      expect(raw.knownAt.get("card:live")).toBeUndefined();
      expect(raw.cards.map((c) => c.id)).toEqual(["live"]);
    });
  });

  describe("copied decks and batch writes", () => {
    it("keeps the source of a copied deck", async () => {
      respondPull({
        pluginData: [
          pluginRow("deck:d-lvl-hsk-words-b06fd2ac", {
            id: "d-lvl-hsk-words-b06fd2ac",
            name: "HSK words · HSK 1",
            createdAt: "2026-01-01T00:00:00Z",
            source: { type: "level", packId: "hsk-words", level: "HSK 1" },
          }),
          pluginRow("deck:plain", { id: "plain", name: "Plain", createdAt: "2026-01-01T00:00:00Z", source: { type: 7 } }),
        ],
      });
      const { decks } = await loadStudyData(WORKSPACE_ID);
      expect(decks.find((d) => d.id === "d-lvl-hsk-words-b06fd2ac")?.source).toEqual({
        type: "level",
        packId: "hsk-words",
        level: "HSK 1",
      });
      // An unknown source shape is dropped, the deck stays.
      expect(decks.find((d) => d.id === "plain")?.source).toBeUndefined();
    });

    it("keeps a frequency source and drops a malformed one", async () => {
      respondPull({
        pluginData: [
          pluginRow("deck:d-frq-jiten-frequency-d4514a31", {
            id: "d-frq-jiten-frequency-d4514a31",
            name: "Jiten · Top 500",
            createdAt: "2026-01-01T00:00:00Z",
            source: { type: "frequency", packId: "jiten-frequency", size: 500 },
          }),
          pluginRow("deck:bad", {
            id: "bad",
            name: "Bad",
            createdAt: "2026-01-01T00:00:00Z",
            source: { type: "frequency", packId: "jiten-frequency", size: "500" },
          }),
        ],
      });
      const { decks } = await loadStudyData(WORKSPACE_ID);
      expect(decks.find((d) => d.id === "d-frq-jiten-frequency-d4514a31")?.source).toEqual({
        type: "frequency",
        packId: "jiten-frequency",
        size: 500,
      });
      expect(decks.find((d) => d.id === "bad")?.source).toBeUndefined();
    });

    it("loadRawStudyData returns the live deck settings", async () => {
      respondPull({
        pluginData: [
          pluginRow("deckcfg:d1", { deckId: "d1", cardTypes: [], newOrder: { by: "frequency" } }),
        ],
      });
      const raw = await loadRawStudyData(WORKSPACE_ID);
      expect(raw.deckSettings?.d1?.newOrder).toEqual({ by: "frequency" });
    });

    it("loadRawStudyData keeps stored duplicates the merged read folds away", async () => {
      respondPull({
        pluginData: [
          pluginRow("card:c-vocab-1", { id: "c-vocab-1", kind: "vocab", entryId: 1, deckIds: ["general"], createdAt: "2026-01-01T00:00:00Z" }),
          pluginRow("card:01JDUP", { id: "01JDUP", kind: "vocab", entryId: 1, deckIds: ["general"], createdAt: "2026-01-02T00:00:00Z" }),
        ],
      });
      const raw = await loadRawStudyData(WORKSPACE_ID);
      expect(raw.cards.map((c) => c.id).sort()).toEqual(["01JDUP", "c-vocab-1"]);
    });

    function pushRows(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        collection: "cards" as const,
        row: cardRow(card(`c-vocab-${i}`, i + 1, ["general"])),
      }));
    }

    it("pushes typed rows in sequential chunks of 200 with the workspace and an updatedAt", async () => {
      vi.mocked(fetch).mockImplementation(async (_url, init) => pushAnswer(init));
      const progress: Array<[number, number]> = [];
      const written: number[] = [];
      const off = onStudyWrite((id) => written.push(id));
      await pushStudy(WORKSPACE_ID, pushRows(450), { onProgress: (d, t) => progress.push([d, t]) });
      off();
      const bodies = pushBodies();
      expect(bodies.map((b) => (b.cards as unknown[]).length)).toEqual([200, 200, 50]);
      // Only the typed collection: never pluginData for a typed family.
      expect(bodies.every((b) => b.pluginData === undefined)).toBe(true);
      const first = (bodies[0]!.cards as Array<Record<string, unknown>>)[0]!;
      expect(first).toMatchObject({ id: "c-vocab-0", workspaceId: WORKSPACE_ID, extra: {} });
      expect("version" in first).toBe(false);
      expect("deletedAt" in first).toBe(false);
      expect(Number.isNaN(Date.parse(String(first.updatedAt)))).toBe(false);
      expect(progress).toEqual([[200, 450], [400, 450], [450, 450]]);
      expect(written).toEqual([WORKSPACE_ID, WORKSPACE_ID, WORKSPACE_ID]);
    });

    it("a tombstone carries deletedAt = updatedAt", async () => {
      vi.mocked(fetch).mockImplementation(async (_url, init) => pushAnswer(init));
      await pushStudy(WORKSPACE_ID, [{ ...pushRows(1)[0]!, deleted: true }]);
      const [item] = writes();
      expect(item!.deleted).toBe(true);
      expect(item!.item.deletedAt).toBe(item!.item.updatedAt);
    });

    it("pushes nothing for no rows", async () => {
      await pushStudy(WORKSPACE_ID, []);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports how many rows landed when a later chunk fails", async () => {
      let n = 0;
      vi.mocked(fetch).mockImplementation(async () =>
        ++n === 1
          ? rawResponse({ dataAccepted: 200, dataSkipped: 0, dataRefused: 0 })
          : new Response("boom", { status: 500 }),
      );
      const error = await pushStudy(WORKSPACE_ID, pushRows(450)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).done).toBe(200);
      expect((error as PartialPushError).skipped).toBe(0);
    });

    it("a chunk with skipped or refused rows is an error, never a silent success", async () => {
      vi.mocked(fetch).mockImplementation(async () =>
        rawResponse({ dataAccepted: 198, dataSkipped: 1, dataRefused: 1 }),
      );
      const error = await pushStudy(WORKSPACE_ID, pushRows(200)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).done).toBe(198);
      expect((error as PartialPushError).skipped).toBe(2);
      expect((error as PartialPushError).message).toMatch(/2 rows/);
    });

    it("exposes the row keys the planner needs: <collection>:<identity>", () => {
      expect(studyRowKey.deck("d1")).toBe("decks:d1");
      expect(studyRowKey.card("c-vocab-1")).toBe("cards:c-vocab-1");
      expect(studyRowKey.settings("d1")).toBe("deckSettings:d1");
    });
  });
});

describe("typed study collections", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
  });

  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const meta = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: WORKSPACE_ID,
    version: 2,
    updatedAt: "2026-02-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  });
  const cardBody = (id: string, entryId: number, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "vocab",
    entryId,
    written: null,
    entryKind: null,
    sentenceId: null,
    skipKinds: [],
    deckIds: ["general"],
    createdAt: "2026-01-02T00:00:00Z",
    extra,
  });
  const empty = {
    cards: [],
    decks: [],
    deckSettings: [],
    limits: [],
    fsrsSets: [],
    fsrsActive: [],
  };
  const set = (id: string) => ({
    id,
    w: [...DEFAULT_W],
    createdAt: "2026-01-05T00:00:00Z",
    source: "optimized",
    labelled: 120,
    logLoss: null,
    baselineLogLoss: null,
    extra: {},
  });

  function serve(pull: Record<string, unknown>): void {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("/api/events")) return rawResponse([]);
      return rawResponse(pageOf({ ...empty, pluginData: [], ...pull }));
    });
  }

  it("builds the study state from the typed rows of the workspace", async () => {
    serve({
      cards: [
        { ...cardBody("c-vocab-1", 1), ...meta() },
        {
          ...cardBody("c-sentence-2", 2),
          kind: "sentence",
          sentenceId: 9,
          written: "猫",
          ...meta(),
        },
        // Tombstones and other workspaces are not study state.
        { ...cardBody("c-vocab-3", 3), ...meta({ deletedAt: "2026-02-02T00:00:00Z" }) },
        { ...cardBody("c-vocab-4", 4), ...meta({ workspaceId: 8 }) },
      ],
      decks: [
        {
          id: "d1",
          name: "HSK 1",
          createdAt: "2026-01-01T00:00:00Z",
          source: { type: "level", packId: "hsk", level: "1" },
          extra: {},
          ...meta(),
        },
      ],
      deckSettings: [
        { deckId: "d1", cardTypes: ["cloze"], newOrder: { by: "level", packId: "hsk" }, extra: { x: 1 }, ...meta() },
      ],
      limits: [
        { deckId: null, new: { limit: 5 }, reviews: null, extra: {}, ...meta() },
        { deckId: "d1", new: null, reviews: { limit: null }, extra: {}, ...meta() },
      ],
      fsrsSets: [{ ...set("S1"), ...meta() }],
      fsrsActive: [{ setId: "S1", changedAt: "2026-01-06T00:00:00Z", extra: {}, ...meta() }],
    });

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.cards).toEqual([
      card("c-vocab-1", 1, ["general"]),
      { id: "c-sentence-2", kind: "sentence", entryId: 2, written: "猫", sentenceId: 9, deckIds: ["general"], createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(data.decks).toEqual([
      { id: "d1", name: "HSK 1", createdAt: "2026-01-01T00:00:00Z", source: { type: "level", packId: "hsk", level: "1" } },
    ]);
    expect(data.deckSettings).toEqual({
      d1: { deckId: "d1", cardTypes: ["cloze"], newOrder: { by: "level", packId: "hsk" }, extra: { x: 1 } },
    });
    expect(data.limits).toEqual({ workspace: { new: 5 }, decks: { d1: { reviews: null } } });
    expect(data.fsrs?.active?.id).toBe("S1");
    expect(data.fsrs?.pointer).toBe("S1");
    expect(data.fsrs?.sets.map((s) => s.id)).toEqual(["S1"]);
  });

  it("skips a typed row that fails the strict parse and keeps the others (sync README, Reading rows)", async () => {
    serve({
      cards: [
        { ...cardBody("c-vocab-5", 5), kind: "flash", ...meta() },
        { ...cardBody("c-vocab-6", 6), ...meta() },
      ],
    });
    const data = await loadStudyData(WORKSPACE_ID);
    expect(data.cards.map((c) => c.id)).toEqual(["c-vocab-6"]);
  });

  it("ignores typed-family keys left in pluginData and keeps reading the keyed rows", async () => {
    serve({
      pluginData: [
        // A leftover the migration could not read: never study state.
        pluginRow("card:c-vocab-9", card("c-vocab-9", 9, ["general"])),
        pluginRow("deck:d9", deck("d9", "Leftover")),
        pluginRow("limits:workspace", { version: 1, new: 3 }),
        pluginRow("fsrs:active", { setId: "S9" }),
        // The keyed rows stay plugin data.
        pluginRow("known:42", { version: 1, entryId: 42, createdAt: "2026-01-01T00:00:00Z" }),
        pluginRow("goals:workspace", { version: 1, kind: "minutes", target: 10 }),
      ],
    });

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.cards).toEqual([]);
    expect(data.decks).toEqual([]);
    expect(data.limits).toBeUndefined();
    expect(data.fsrs?.pointer).toBeNull();
    expect(data.known).toEqual([42]);
    expect(data.goals).toBeDefined();
  });

  it("writes echo the stored row's extra and never touch plugin data", async () => {
    serve({
      cards: [{ ...cardBody("c-vocab-1", 1, { color: "red" }), ...meta() }],
      decks: [{ id: "d2", name: "Two", createdAt: "2026-01-01T00:00:00Z", source: null, extra: { pinned: true }, ...meta() }],
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (isPush(input, init)) return pushAnswer(init);
      if (String(input).startsWith("/api/events")) return rawResponse([]);
      return rawResponse(pageOf({
        ...empty,
        pluginData: [],
        cards: [{ ...cardBody("c-vocab-1", 1, { color: "red" }), ...meta() }],
        decks: [{ id: "d2", name: "Two", createdAt: "2026-01-01T00:00:00Z", source: null, extra: { pinned: true }, ...meta() }],
      }));
    });
    await moveCards(WORKSPACE_ID, ["c-vocab-1"], "d2");
    await renameDeck(WORKSPACE_ID, "d2", "Zwei");
    expect(writes().map((w) => [w.collection, w.item.extra])).toEqual([
      ["cards", { color: "red" }],
      ["decks", { pinned: true }],
    ]);
    expect(writes()[0]!.item.deckIds).toEqual(["d2"]);
  });

  it("stamps a write after the time the server holds for the row (clock behind the server)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    try {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (isPush(input, init)) return pushAnswer(init);
        return rawResponse(pageOf({
          ...empty,
          pluginData: [],
          decks: [{ id: "d2", name: "Two", createdAt: "2026-01-01T00:00:00Z", source: null, extra: {}, ...meta({ updatedAt: "2026-02-01T00:00:09Z" }) }],
        }));
      });
      await renameDeck(WORKSPACE_ID, "d2", "Zwei");
      expect(writes()[0]!.updatedAt).toBe("2026-02-01T00:00:09.001Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("setActiveSet writes nothing when that set is already active (no new changedAt)", async () => {
    serve({ fsrsActive: [{ setId: "S1", changedAt: "2026-01-06T00:00:00Z", extra: {}, ...meta() }] });
    await setActiveSet(WORKSPACE_ID, "S1");
    expect(writes()).toEqual([]);
    await setActiveSet(WORKSPACE_ID, "S2");
    expect(writes().map((w) => w.item.setId)).toEqual(["S2"]);
  });

  it("setActiveSet(null) writes nothing while the defaults are in use (no row, or setId null)", async () => {
    serve({});
    await setActiveSet(WORKSPACE_ID, null);
    serve({ fsrsActive: [{ setId: null, changedAt: "2026-01-06T00:00:00Z", extra: {}, ...meta() }] });
    await setActiveSet(WORKSPACE_ID, null);
    expect(writes()).toEqual([]);
  });

  it("a row stored only as a tombstone gets no second tombstone (deleteParamSet, deleteDeck)", async () => {
    const gone = meta({ deletedAt: "2026-02-02T00:00:00Z" });
    serve({
      decks: [{ id: "d1", name: "Old", createdAt: "2026-01-01T00:00:00Z", source: null, extra: {}, ...gone }],
      deckSettings: [{ deckId: "d1", cardTypes: [], newOrder: null, extra: {}, ...gone }],
      limits: [{ deckId: "d1", new: { limit: 1 }, reviews: null, extra: {}, ...gone }],
      fsrsSets: [{ ...set("S9"), ...gone }],
    });
    await deleteParamSet(WORKSPACE_ID, "S9");
    await deleteDeck(WORKSPACE_ID, "d1");
    expect(writes()).toEqual([]);
    expect(pushBodies()).toEqual([]);
  });

  it("an unchanged row is not written (the server would skip it as equal content)", async () => {
    serve({
      deckSettings: [{ deckId: "d1", cardTypes: ["cloze"], newOrder: { by: "frequency" }, extra: {}, ...meta() }],
      limits: [{ deckId: null, new: { limit: 5 }, reviews: null, extra: {}, ...meta() }],
      fsrsActive: [{ setId: "S1", changedAt: "2026-01-06T00:00:00Z", extra: {}, ...meta() }],
    });
    await saveDeckCardTypes(WORKSPACE_ID, "d1", ["cloze"]);
    await saveDeckNewOrder(WORKSPACE_ID, "d1", { by: "frequency" });
    await saveWorkspaceLimits(WORKSPACE_ID, { new: 5 });
    await renameDeck(WORKSPACE_ID, "d1", "x").catch(() => undefined);
    expect(writes()).toEqual([]);
  });

  it("an empty pull without typed collections reads as no study state", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).startsWith("/api/events") ? rawResponse([]) : rawResponse(pagedPull({ cursor: "x" })),
    );
    const data = await loadStudyData(WORKSPACE_ID);
    expect(data.cards).toEqual([]);
    expect(data.fsrs).toEqual({ sets: [], active: null, w: DEFAULT_W, pointer: null });
  });
});

describe("vacation rows", () => {
  const vacRow = (id: string, over: Record<string, unknown> = {}, rowOver = {}) =>
    pluginRow(
      `vacation:${id}`,
      { version: 1, id, start: "2026-12-01", end: "2026-12-05", scope: "all", createdDay: "2026-11-01", createdAt: "2026-11-01T08:00:00Z", ...over },
      { workspaceId: null, ...rowOver },
    );

  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
  });
  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reads user-global vacation rows, ignoring tombstones, other plugins and workspace-scoped copies", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("/api/events")) return jsonResponse([]);
      return jsonResponse({
        pluginData: [
          vacRow("A"),
          vacRow("B", {}, { deletedAt: "2026-11-02T00:00:00Z" }),
          vacRow("C", {}, { pluginId: "other" }),
          vacRow("D", {}, { workspaceId: 99 }),
          vacRow("E", { version: 2 }),
        ],
      });
    });
    const data = await loadStudyData(WORKSPACE_ID);
    expect(data.vacations?.map((v) => v.id)).toEqual(["A"]);
  });

  it("saveVacation PUTs without a workspace and deleteVacation tombstones", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ version: 1 }));
    const seen: number[] = [];
    const off = onStudyWrite((w) => seen.push(w as number));
    await saveVacation({ version: 1, id: "A", start: "2026-12-01", end: null, scope: "all", createdDay: "2026-11-15", createdAt: "2026-11-15T08:00:00Z" });
    await deleteVacation("A");
    off();
    expect(putBodies()[0].url).toBe(`/api/plugins/${PLUGIN_ID}/data/vacation:A`);
    const del = calls().find(([, init]) => init?.method === "DELETE");
    expect(String(del?.[0])).toBe(`/api/plugins/${PLUGIN_ID}/data/vacation:A`);
    expect(seen).toEqual([ALL_WORKSPACES, ALL_WORKSPACES]);
  });
});

describe("limit rows", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
  });
  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("reads limits:workspace and limits:deck rows of the workspace only", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("/api/events")) return jsonResponse([]);
      return jsonResponse({
        pluginData: [
          pluginRow("limits:workspace", { version: 1, new: 10, reviews: null }),
          pluginRow("limits:deck:d1", { version: 1, new: 0 }),
          pluginRow("limits:deck:d2", { version: 2, new: 5 }),
          pluginRow("limits:deck:d3", { version: 1, new: 5 }, { workspaceId: 99 }),
          pluginRow("limits:deck:d4", { version: 1, new: 5 }, { deletedAt: "2026-01-02T00:00:00Z" }),
        ],
      });
    });
    const data = await loadStudyData(WORKSPACE_ID);
    expect(data.limits).toEqual({ workspace: { new: 10, reviews: null }, decks: { d1: { new: 0 } } });
  });

  it("saves the workspace row and a deck row, and deletes a deck row when nothing is left to say", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (isPush(input, init)) return pushAnswer(init);
      return jsonResponse({ pluginData: [pluginRow("limits:deck:d2", { version: 1, new: 3 })] });
    });
    await saveWorkspaceLimits(WORKSPACE_ID, { new: 15, reviews: null });
    await saveDeckLimits(WORKSPACE_ID, "d1", { reviews: null });
    await saveDeckLimits(WORKSPACE_ID, "d2", {});
    // A deck without a row has nothing to remove.
    await saveDeckLimits(WORKSPACE_ID, "d3", {});
    expect(writtenRows()).toEqual([
      { key: "limits:workspace", workspaceId: WORKSPACE_ID, body: { version: 1, new: 15, reviews: null } },
      { key: "limits:deck:d1", workspaceId: WORKSPACE_ID, body: { version: 1, reviews: null } },
    ]);
    expect(writes().map((w) => w.item)).toMatchObject([
      { deckId: null, new: { limit: 15 }, reviews: { limit: null }, extra: {} },
      { deckId: "d1", new: null, reviews: { limit: null }, extra: {} },
      { deckId: "d2", new: { limit: 3 }, reviews: null, deletedAt: expect.any(String) },
    ]);
    expect(deletedKeys()).toEqual(["limits:deck:d2"]);
  });

  it("deleteDeck tombstones the deck's limits row; a skipped tombstone is fine", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      // Another tab removed the limits row already: its tombstone is skipped.
      if (isPush(input, init)) return pushAnswer(init, (key) => key.startsWith("limits:"));
      return jsonResponse({
        pluginData: [pluginRow("deck:d1", deck("d1", "Doomed")), pluginRow("limits:deck:d1", { version: 1, new: 1 })],
      });
    });
    await deleteDeck(WORKSPACE_ID, "d1");
    expect(deletedKeys()).toEqual(["deck:d1", "limits:deck:d1"]);
  });
});

describe("queued reviews count in the loaded history", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
    setOutboxUser(1, 't');
  });
  afterEach(() => {
    setOutboxUser(null, null);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function queue(userId: number, event: StudyEvent): void {
    const raw = localStorage.getItem("qinqin.study.pending.v2");
    const items = raw === null ? [] : JSON.parse(raw);
    items.push({ userId, queuedAt: new Date().toISOString(), event });
    localStorage.setItem("qinqin.study.pending.v2", JSON.stringify(items));
  }

  const word = card("card-1", 42, ["general"], "2026-01-02T00:00:00Z", "猫");
  const pull = { pluginData: [pluginRow("card:card-1", word)] };

  it("a queued review is part of the history before it is sent", async () => {
    respondPull(pull, []);
    queue(1, reviewEvent("Q1", "card-1"));

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["Q1"]);
  });

  it("a queued review already on the server appears once", async () => {
    respondPull(pull, [reviewEvent("Q1", "card-1")]);
    queue(1, reviewEvent("Q1", "card-1"));

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["Q1"]);
  });

  it("another user's queued review is ignored", async () => {
    respondPull(pull, []);
    queue(2, reviewEvent("Q2", "card-1"));

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews).toEqual([]);
  });

  it("another workspace's queued review is ignored", async () => {
    respondPull(pull, []);
    queue(1, reviewEvent("Q3", "card-1", WORKSPACE_ID + 1));

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews).toEqual([]);
  });

  it("a review sent minutes ago counts although the cached log predates it", async () => {
    respondPull(pull, []);
    rememberSent(1, [reviewEvent("S1", "card-1")]);

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["S1"]);
  });

  it("a sent review that is also in the log appears once", async () => {
    respondPull(pull, [reviewEvent("S1", "card-1")]);
    rememberSent(1, [reviewEvent("S1", "card-1")]);

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["S1"]);
  });

  // #131: a changed grade replaces the misclick everywhere the history is read.
  function replacing(id: string, target: string): StudyEvent {
    const base = reviewEvent(id, "card-1");
    return { ...base, payload: { ...(base.payload as object), grade: 3, replaces: target } };
  }

  it("a replaced review is dropped from the history (#131)", async () => {
    const misclick = { ...reviewEvent("R1", "card-1"), payload: { cardId: "card-1", mode: "vocab", grade: 1 } };
    respondPull(pull, [misclick, replacing("R2", "R1")]);

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["R2"]);
    expect(data.reviews[0].payload.replaces).toBe("R1");
  });

  it("a queued replacement replaces a stored review (#131)", async () => {
    respondPull(pull, [reviewEvent("R1", "card-1")]);
    queue(1, replacing("R2", "R1"));

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews.map((r) => r.id)).toEqual(["R2"]);
  });

  it("nothing is merged while no user is known", async () => {
    respondPull(pull, []);
    queue(1, reviewEvent("Q1", "card-1"));
    setOutboxUser(null, null);

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews).toEqual([]);
  });
});

describe("goal row", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(3);
  });
  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const goal = {
    version: 1,
    showStreak: true,
    note: "kept",
    history: [{ from: "2026-11-16", metric: "activity:review", target: 50, by: "android" }],
  };
  function pull(rows: PluginDataRow[]) {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("/api/events")) return jsonResponse([]);
      return jsonResponse({ pluginData: rows });
    });
  }

  it("reads the goals:workspace row of the workspace only", async () => {
    pull([
      pluginRow("goals:workspace", goal, { workspaceId: 3 }),
      pluginRow("goals:workspace", { ...goal, showStreak: false }, { workspaceId: null }),
    ]);
    expect((await loadStudyData(3)).goals).toEqual(goal);
    expect((await loadStudyData(4)).goals).toBeUndefined();
  });

  it("ignores a user-global row with the key", async () => {
    pull([pluginRow("goals:workspace", goal, { workspaceId: null })]);
    expect((await loadStudyData(3)).goals).toBeUndefined();
  });

  it("ignores a tombstoned row", async () => {
    pull([pluginRow("goals:workspace", goal, { workspaceId: 3, deletedAt: "2026-11-16T00:00:00Z" })]);
    expect((await loadStudyData(3)).goals).toBeUndefined();
  });

  it("reads a newer row as 'newer'", async () => {
    pull([pluginRow("goals:workspace", { version: 2 }, { workspaceId: 3 })]);
    expect((await loadStudyData(3)).goals).toBe("newer");
  });

  it("saveGoals PUTs the row verbatim to the workspace it was given and drops caches", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ version: 1 }));
    const seen: number[] = [];
    const off = onStudyWrite((w) => seen.push(w));
    // The current workspace has moved on: the caller's captured id wins.
    selectWorkspace(4);
    await saveGoals(3, goal as never);
    off();
    expect(putBodies()).toEqual([
      { url: `/api/plugins/${PLUGIN_ID}/data/goals:workspace?workspace=3`, body: goal },
    ]);
    expect(seen).toEqual([3]);
  });

  it("saveGoals refuses an id that is not a workspace", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ version: 1 }));
    await expect(saveGoals(0, goal as never)).rejects.toThrow(/workspace/);
    await expect(saveGoals(1.5, goal as never)).rejects.toThrow(/workspace/);
    expect(calls()).toHaveLength(0);
  });
});

describe("known marks", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(3);
  });
  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const mark = (id: number) => ({ version: 1, entryId: id, createdAt: "2026-11-16T00:00:00.000Z" });

  it("reads the live marks of the workspace only", async () => {
    respondPull({
      pluginData: [
        pluginRow("known:5", mark(5), { workspaceId: 3 }),
        pluginRow("known:6", mark(6), { workspaceId: 4 }),
        pluginRow("known:7", mark(7), { workspaceId: 3, pluginId: "other" }),
        pluginRow("known:8", mark(8), { workspaceId: 3, deletedAt: "2026-11-16T00:00:00Z" }),
        pluginRow("known:9", mark(10), { workspaceId: 3 }),
        pluginRow("known:11", JSON.stringify(mark(11)), { workspaceId: 3 }),
      ],
    });
    expect((await loadStudyData(3)).known).toEqual([5, 11]);
  });

  it("leaves known absent without live marks", async () => {
    respondPull({ pluginData: [pluginRow("known:8", mark(8), { workspaceId: 3, deletedAt: "2026-11-16T00:00:00Z" })] });
    const data = await loadStudyData(3);
    expect("known" in data).toBe(false);
  });

  it("setKnownMark PUTs the row in the given workspace and notifies", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ version: 1 }));
    const seen: number[] = [];
    const off = onStudyWrite((w) => seen.push(w));
    selectWorkspace(4); // the current workspace is not the book's
    await setKnownMark(3, 41, true);
    off();
    const [put] = putBodies();
    expect(put.url).toBe(`/api/plugins/${PLUGIN_ID}/data/known:41?workspace=3`);
    expect(put.body).toMatchObject({ version: 1, entryId: 41 });
    expect(Number.isNaN(Date.parse((put.body as { createdAt: string }).createdAt))).toBe(false);
    expect(seen).toEqual([3]);
  });

  it("setKnownMark off DELETEs (tombstones) the row", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 204 }));
    const seen: number[] = [];
    const off = onStudyWrite((w) => seen.push(w));
    await setKnownMark(3, 41, false);
    off();
    expect(calls().map(([url, init]) => [String(url), init?.method])).toEqual([
      [`/api/plugins/${PLUGIN_ID}/data/known:41?workspace=3`, "DELETE"],
    ]);
    expect(seen).toEqual([3]);
  });

  it("setKnownMark off of a mark the server does not hold is not an error", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: "not_found" }, 404));
    await expect(setKnownMark(3, 41, false)).resolves.toBeUndefined();
  });

  it("setKnownMark refuses an id that is not a workspace", async () => {
    await expect(setKnownMark(0, 41, true)).rejects.toThrow(/workspace/);
    expect(calls()).toHaveLength(0);
  });

  function pushBodies(): Array<{ pluginData: Array<Record<string, unknown>> }> {
    return calls()
      .filter(([url]) => String(url) === "/api/sync/push")
      .map(([, init]) => JSON.parse(String(init?.body)));
  }
  // setKnownMarks reads the stored rows first (for their stamps), then pushes.
  const accept = () =>
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url).startsWith("/api/sync/pull")
        ? jsonResponse({ pluginData: [] })
        : jsonResponse({ dataAccepted: JSON.parse(String(init?.body)).pluginData.length, dataSkipped: 0, dataRefused: 0 }),
    );

  it("setKnownMarks pushes 450 marks as 200/200/50", async () => {
    accept();
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    await setKnownMarks(3, ids, true);
    const bodies = pushBodies();
    expect(bodies.map((b) => b.pluginData.length)).toEqual([200, 200, 50]);
    expect(bodies[0].pluginData[0]).toMatchObject({ key: "known:1", workspaceId: 3, data: { version: 1, entryId: 1 } });
    expect(bodies[0].pluginData[0].deletedAt).toBeUndefined();
  });

  it("setKnownMarks off sends tombstones with deletedAt", async () => {
    accept();
    await setKnownMarks(3, [4, 5, 4], false);
    const rows = pushBodies().flatMap((b) => b.pluginData);
    expect(rows.map((r) => r.key)).toEqual(["known:4", "known:5"]);
    for (const r of rows) {
      expect(typeof r.deletedAt).toBe("string");
      expect(r.deletedAt).toBe(r.updatedAt);
    }
  });

  it("stamps each mark after the time the server holds for its key (clock skew)", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/sync/pull")) {
        return jsonResponse({
          pluginData: [
            pluginRow("known:4", mark(4), { workspaceId: 3, updatedAt: "2099-01-01T00:00:00Z", deletedAt: "2099-01-01T00:00:05Z" }),
            pluginRow("known:5", mark(5), { workspaceId: 4, updatedAt: "2099-06-01T00:00:00Z" }),
          ],
        });
      }
      return jsonResponse({ dataAccepted: JSON.parse(String(init?.body)).pluginData.length, dataSkipped: 0, dataRefused: 0 });
    });
    await setKnownMarks(3, [4, 5], true);
    const rows = pushBodies().flatMap((b) => b.pluginData);
    expect(rows.find((r) => r.key === "known:4")?.updatedAt).toBe("2099-01-01T00:00:05.001Z");
    // known:5 of another workspace does not count: stamped now.
    expect(Date.parse(String(rows.find((r) => r.key === "known:5")?.updatedAt))).toBeLessThan(Date.parse("2099-01-01T00:00:00Z"));
  });

  it("a re-mark after a newer server tombstone is stamped after it: the from-scratch study pull asks for tombstones", async () => {
    // The server ships tombstones in a round from no since only for tombstones=1.
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/sync/pull")) {
        const tombs = new URL(url, "https://x.invalid").searchParams.get("tombstones") === "1";
        const dead = pluginRow("known:4", mark(4), { workspaceId: 3, updatedAt: "2099-01-01T00:00:05Z", deletedAt: "2099-01-01T00:00:05Z" });
        return jsonResponse({ pluginData: tombs ? [dead] : [] });
      }
      return jsonResponse({ dataAccepted: JSON.parse(String(init?.body)).pluginData.length, dataSkipped: 0, dataRefused: 0 });
    });
    await setKnownMarks(3, [4], true);
    const pulls = calls().map(([url]) => String(url)).filter((u) => u.startsWith("/api/sync/pull"));
    expect(pulls[0]).toBe(
      "/api/sync/pull?collections=pluginStates%2CpluginData%2Ccards%2Cdecks%2CdeckSettings%2Climits%2CfsrsSets%2CfsrsActive&tombstones=1&v=2&workspace=3",
    );
    const rows = pushBodies().flatMap((b) => b.pluginData);
    expect(rows.find((r) => r.key === "known:4")?.updatedAt).toBe("2099-01-01T00:00:05.001Z");
  });

  it("a skipped mark is an error", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).startsWith("/api/sync/pull")
        ? jsonResponse(pagedPull({ pluginData: [] }))
        : jsonResponse({ dataAccepted: 1, dataSkipped: 1, dataRefused: 0 }),
    );
    await expect(setKnownMarks(3, [1, 2], true)).rejects.toBeInstanceOf(PartialPushError);
  });

  it("setKnownMarks refuses an id that is not a workspace", async () => {
    await expect(setKnownMarks(1.5, [1], true)).rejects.toThrow(/workspace/);
  });
});

describe("seen milestone rows", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(3);
  });
  afterEach(() => {
    expectOneStorage();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const seen = (id: string, day = "2026-11-03") => ({ version: 1, id, seenAt: "2026-11-17T08:00:00.000Z", reachedDay: day });

  it("parses the live milestone: rows of the workspace only", async () => {
    respondPull({
      pluginData: [
        pluginRow("milestone:reviews:100", seen("reviews:100"), { workspaceId: 3 }),
        pluginRow("milestone:streak:7", seen("streak:7"), { workspaceId: 4 }),
        pluginRow("milestone:streak:3", seen("streak:3"), { workspaceId: null }),
        pluginRow("milestone:streak:14", seen("streak:14"), { workspaceId: 3, pluginId: "qinqin-core" }),
        pluginRow("milestone:days-active:10", seen("days-active:10"), { workspaceId: 3, deletedAt: "2026-11-17T09:00:00Z" }),
        pluginRow("milestone:journal-entries:1", JSON.stringify(seen("journal-entries:1", "2026-11-05")), { workspaceId: 3 }),
        pluginRow("milestone:quiz:5", { version: 2 }, { workspaceId: 3 }),
      ],
    });
    const data = await loadStudyData(3);
    expect([...(data.seenMilestones ?? new Map()).entries()]).toEqual([
      ["reviews:100", { id: "reviews:100", seenAt: "2026-11-17T08:00:00.000Z", reachedDay: "2026-11-03" }],
      ["journal-entries:1", { id: "journal-entries:1", seenAt: "2026-11-17T08:00:00.000Z", reachedDay: "2026-11-05" }],
      ["quiz:5", { id: "quiz:5", seenAt: null, reachedDay: null }],
    ]);
  });

  it("leaves seenMilestones absent without live rows; a milestone row is never a deck or a card", async () => {
    respondPull({ pluginData: [pluginRow("milestone:reviews:100", seen("reviews:100"), { workspaceId: 3, deletedAt: "2026-11-17T09:00:00Z" })] });
    const data = await loadStudyData(3);
    expect("seenMilestones" in data).toBe(false);
    expect(data.cards).toEqual([]);
    expect(data.decks).toEqual([]);
  });

  it("a typed-family key in pluginData is still never study state", async () => {
    respondPull({ pluginData: [pluginRow("card:milestone:reviews:100", seen("reviews:100"), { workspaceId: 3 })] });
    const data = await loadStudyData(3);
    expect("seenMilestones" in data).toBe(false);
  });

  it("keeps the stamps of tombstoned milestone rows (a re-dismiss must be stamped after them)", async () => {
    respondPull({
      pluginData: [
        pluginRow("milestone:reviews:100", seen("reviews:100"), { workspaceId: 3, updatedAt: "2026-11-17T09:00:00Z", deletedAt: "2026-11-17T09:00:00Z" }),
        pluginRow("milestone:streak:7", seen("streak:7"), { workspaceId: 3 }),
      ],
    });
    const data = await loadStudyDataWith(3, async () => []);
    expect([...(data.milestoneTombstones ?? new Map())]).toEqual([["reviews:100", "2026-11-17T09:00:00Z"]]);
  });

  it("saveSeenMilestones stamps a row after the tombstone it revives", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 1, dataSkipped: 0, dataRefused: 0 }));
    await saveSeenMilestones(3, [{ key: "milestone:reviews:100", data: seen("reviews:100"), knownAt: "2099-01-01T00:00:00Z" }]);
    expect(pushes()[0].pluginData[0].updatedAt).toBe("2099-01-01T00:00:00.001Z");
  });

  it("loadStudyDataWith passes seenMilestones through", async () => {
    respondPull({ pluginData: [pluginRow("milestone:reviews:100", seen("reviews:100"), { workspaceId: 3 })] });
    const data = await loadStudyDataWith(3, async () => []);
    expect([...(data.seenMilestones?.keys() ?? [])]).toEqual(["reviews:100"]);
  });

  function pushes(): Array<{ pluginData: Array<Record<string, unknown>> }> {
    return calls()
      .filter(([url]) => String(url) === "/api/sync/push")
      .map(([, init]) => JSON.parse(String(init?.body)));
  }
  const rows = [
    { key: "milestone:reviews:100", data: seen("reviews:100") },
    { key: "milestone:streak:7", data: seen("streak:7") },
  ];

  it("saveSeenMilestones sends one push with every row, no tombstone, and notifies", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 2, dataSkipped: 0, dataRefused: 0 }));
    const touched: number[] = [];
    const off = onStudyWrite((w) => touched.push(w));
    await saveSeenMilestones(3, rows);
    off();
    const bodies = pushes();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].pluginData).toHaveLength(2);
    for (const item of bodies[0].pluginData) {
      expect(item).toMatchObject({ pluginId: PLUGIN_ID, workspaceId: 3 });
      expect(typeof item.updatedAt).toBe("string");
      expect(item).not.toHaveProperty("deletedAt");
    }
    expect(bodies[0].pluginData.map((i) => i.key)).toEqual(rows.map((r) => r.key));
    expect(touched).toEqual([3]);
  });

  it("saveSeenMilestones sends 80 rows in one request", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 80, dataSkipped: 0, dataRefused: 0 }));
    const many = Array.from({ length: 80 }, (_, i) => ({ key: `milestone:level-complete:d-lvl-x-${String(i).padStart(8, "0")}`, data: {} }));
    await saveSeenMilestones(3, many);
    expect(pushes()).toHaveLength(1);
  });

  it("saveSeenMilestones with nothing to write sends nothing", async () => {
    await saveSeenMilestones(3, []);
    expect(calls()).toHaveLength(0);
  });

  it("saveSeenMilestones refuses another row family and a missing workspace", async () => {
    await expect(saveSeenMilestones(3, [{ key: "known:5", data: {} }])).rejects.toThrow(/milestone/);
    await expect(saveSeenMilestones(0, rows)).rejects.toThrow(/workspace/);
    expect(calls()).toHaveLength(0);
  });

  const push = seenMergeFixture.cases.filter((c) => c.op === "push") as Array<{ name: string; answer: unknown; expect: string }>;
  it.each(push)("milestones/seen-merge.json push: $name", async (c) => {
    vi.mocked(fetch).mockImplementation(async () => {
      if (c.answer === "network") throw new TypeError("Failed to fetch");
      return jsonResponse(c.answer);
    });
    const outcome = await saveSeenMilestones(3, rows).then(
      (result) => result,
      () => "pending",
    );
    expect(outcome).toBe(c.expect);
  });

  it("a server error keeps the ids pending (the push rejects)", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: "boom" }, 500));
    await expect(saveSeenMilestones(3, rows)).rejects.toBeInstanceOf(PartialPushError);
  });
});
