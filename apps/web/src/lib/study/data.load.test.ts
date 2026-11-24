import { testContext, type TestContext } from '$lib/testing/context';
// Loading the study state (split from the old store tests, #193).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$app/navigation", () => ({ goto }));

import { setOutboxUser } from "$lib/study/outboxUser";
import { rememberSent } from "$lib/study/recentSent";
import { gradeItem } from "$lib/study/grade";
import type { StudyEvent } from "$lib/events";
import type { Deck, StudyCard } from "$lib/study/types";
import {
  addCard,
  PartialCardsError,
  deleteCards,
  dropSiblingCards,
  skipKind,
  unskipKind,
  moveCards,
  restoreCards
} from '$lib/study/commands/cards';
import { createDeck, deleteDeck, saveDeckCardTypes, saveDeckNewOrder, renameDeck } from '$lib/study/commands/decks';
import { loadStudyData, onStudyChange, loadRawStudyData, ALL_WORKSPACES } from '$lib/study/data';
import {
  saveParamSet,
  setActiveSet,
  deleteParamSet,
  saveWorkspaceLimits,
  saveDeckLimits
} from '$lib/study/commands/settings';
import { pushStudy } from '$lib/study/commands/write';
import { PartialPushError } from '$lib/sync/push';
import { studyRowKey } from '$lib/study/plan';
import {
  saveVacation,
  deleteVacation,
  saveGoals,
  setKnownMark,
  setKnownMarks,
  saveSeenMilestones
} from '$lib/study/commands/keyed';
import { GENERAL_DECK_ID } from '$lib/study/types';
import { cardsInDecks, activeWeights } from '$lib/study/readModel';
import seenMergeFixture from "../../../../../docs/contracts/milestones/seen-merge.json";
import { DEFAULT_W, type ParamSet } from "$lib/study/fsrs/params";
import { legacyFamily, pageOf, pagedPull, toLegacy } from '$lib/testing/legacyCodec';
import { STUDY_COLLECTIONS, cardRow, type StudyCollection } from "$lib/study/rows";
import * as build from '$lib/testing/study';
import { endSession } from "$lib/session/sessionEnd";

// Every test starts a session of its own: the study cache holds nothing.
beforeEach(() => endSession("signOut"));
import {
  PLUGIN_ID,
  WORKSPACE_ID,
  ULID,
  fakeStorage,
  jsonResponse,
  rawResponse,
  type PluginDataRow,
  pluginRow,
  deck,
  card,
  calls,
  putBodies,
  pushBodies,
  type Written,
  itemsOf,
  writes,
  writtenRows,
  deletedKeys,
  pushedRows,
  pushAnswer,
  isPush,
  respondPull,
  reviewEvent,
  expectOneStorage,
  useStudyStoreMocks
} from "$lib/testing/studyFetch";

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});


describe("loading the study state", () => {
  useStudyStoreMocks();

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
});

describe("typed study collections", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
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

describe("queued reviews count in the loaded history", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    setOutboxUser(1);
  });
  afterEach(() => {
    setOutboxUser(null);
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
    setOutboxUser(null);

    const data = await loadStudyData(WORKSPACE_ID);

    expect(data.reviews).toEqual([]);
  });
});
