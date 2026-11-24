import { testContext, type TestContext } from '$lib/testing/context';
// Card commands (split from the old store tests, #193).
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


describe("card commands", () => {
  useStudyStoreMocks();

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
      // Another device changed the row since: a new session reads it (the cache would plan from its own write).
      endSession("signOut");
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
      const stop = onStudyChange((id) => seen.push(id));

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
});
