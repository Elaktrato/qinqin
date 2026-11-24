import { testContext, type TestContext } from '$lib/testing/context';
// Deck commands (split from the old store tests, #193).
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
import seenMergeFixture from "../../../../../../docs/contracts/milestones/seen-merge.json";
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


describe("deck commands", () => {
  useStudyStoreMocks();

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
      const off = onStudyChange((id) => written.push(id));
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
