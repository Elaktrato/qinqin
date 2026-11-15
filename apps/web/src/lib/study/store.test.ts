import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$app/navigation", () => ({ goto }));

import { workspaces } from "../workspaces";
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
  pushStudyRows,
  PartialPushError,
  studyRowKey,
  saveVacation,
  deleteVacation,
  saveWorkspaceLimits,
  saveDeckLimits,
  ALL_WORKSPACES,
} from "./store";
import { DEFAULT_W, type ParamSet } from "./fsrs/params";

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

function jsonResponse(body: unknown, status = 200): Response {
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
  const result: StudyCard = { id, kind: "vocab", entryId, deckIds, createdAt };
  if (written !== undefined) result.written = written;
  return result;
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

function putBodies(): Array<{ url: string; body: unknown }> {
  return calls()
    .filter(([, init]) => init?.method === "PUT")
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)),
    }));
}

/** The rows batch-written through POST /api/sync/push, in order. */
function pushedRows(): Array<{ key: string; data: unknown; updatedAt: string }> {
  return calls()
    .filter(([url]) => String(url) === "/api/sync/push")
    .flatMap(([, init]) => JSON.parse(String(init?.body)).pluginData);
}

/**
 * respondPull answers the two reads loadStudyData makes: the sync pull
 * gets `pull`, the event log gets `events` (none by default).
 */
function respondPull(pull: unknown, events: unknown[] = []): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).startsWith("/api/events")) return jsonResponse(events);
    return jsonResponse(pull);
  });
}

function reviewEvent(
  id: string,
  cardId: string,
  workspaceId = WORKSPACE_ID,
): StudyEvent {
  return {
    id,
    workspaceId,
    device: "web",
    ts: "2026-02-01T00:00:00.000Z",
    type: "review",
    payload: { cardId, mode: "vocab", grade: 3 },
  } as StudyEvent;
}

describe("study store", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
    selectWorkspace(WORKSPACE_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
          // Keys the study layer does not own are ignored.
          pluginRow("settings:study", { newLimit: 20 }),
          // A malformed payload is skipped rather than crashing.
          pluginRow("deck:broken", { name: "No id" }),
        ],
      });

      const data = await loadStudyData();

      expect(data.decks).toEqual([general, custom]);
      expect(data.cards).toEqual([
        word,
        sentenceCard,
        card("card-3", 44, ["general"]),
      ]);
      expect("written" in data.cards[2]!).toBe(false);
      expect(calls().map(([url]) => String(url))).toEqual([
        "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates",
        `/api/events?since=1970-01-01T00:00:00Z&workspace=${WORKSPACE_ID}`,
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

      const data = await loadStudyData();

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

      const data = await loadStudyData();

      expect(data.cards[0]!.skipKinds).toEqual(["reverse"]);
      expect("skipKinds" in data.cards[1]!).toBe(false);
      expect("skipKinds" in data.cards[2]!).toBe(false);
    });

    it("returns empty arrays when the pull has no plugin data", async () => {
      respondPull({ cursor: "2026-01-01T00:00:00Z" });

      await expect(loadStudyData()).resolves.toEqual({
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

      await expect(loadStudyData()).resolves.toEqual({
        decks: [],
        cards: [],
        fsrs: { sets: [], active: null, w: DEFAULT_W, pointer: null },
        reviews: [],
        merged: 0,
      });
    });

    it("fails when no workspace is selected", async () => {
      selectWorkspace(null);

      await expect(loadStudyData()).rejects.toThrow(/workspace/i);
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
        "/api/events?since=1970-01-01T00:00:00Z&workspace=9",
      );
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

      const data = await loadStudyData();

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

      const data = await loadStudyData();

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

      const created = await createDeck("  HSK 3  ");

      expect(created.id).toMatch(ULID);
      expect(created.name).toBe("  HSK 3  ");
      expect(created.createdAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
      const [call] = calls();
      expect(String(call[0])).toBe(
        `/api/plugins/${PLUGIN_ID}/data/deck:${created.id}?workspace=${WORKSPACE_ID}`,
      );
      expect(call[1]?.method).toBe("PUT");
      expect(JSON.parse(String(call[1]?.body))).toEqual(created);
    });

    it("fails without writing when no workspace is selected", async () => {
      selectWorkspace(null);

      await expect(createDeck("HSK 3")).rejects.toThrow(/workspace/i);
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

      const renamed = await renameDeck("deck-1", "New name");

      expect(renamed).toEqual(
        deck("deck-1", "New name", "2026-01-01T00:00:00Z"),
      );
      expect(putBodies()).toEqual([
        {
          url: `/api/plugins/${PLUGIN_ID}/data/deck:deck-1?workspace=${WORKSPACE_ID}`,
          body: renamed,
        },
      ]);
    });

    it("refuses to rename a deck that does not exist", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ pluginData: [] }));

      await expect(renameDeck("missing", "New name")).rejects.toThrow(/deck/i);
      expect(putBodies()).toEqual([]);
    });
  });

  describe("deck card type settings", () => {
    const cfgUrl = (id: string) =>
      `/api/plugins/${PLUGIN_ID}/data/deckcfg:${id}?workspace=${WORKSPACE_ID}`;

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
      const data = await loadStudyData();
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
      const saved = await saveDeckCardTypes("general", ["cloze", "reverse"]);
      expect(saved.cardTypes).toEqual(["reverse", "cloze"]);
      expect(putBodies()).toHaveLength(1);
      expect(putBodies()[0]!.url).toBe(cfgUrl("general"));
      expect(putBodies()[0]!.body).toMatchObject({
        deckId: "general",
        cardTypes: ["reverse", "cloze"],
        limits: { new: 5 },
      });
    });

    it("saveDeckCardTypes creates the row when none exists", async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 1 });
        return jsonResponse({ pluginData: [] });
      });
      await saveDeckCardTypes("d9", ["reverse"]);
      expect(putBodies()[0]!.body).toMatchObject({ deckId: "d9", cardTypes: ["reverse"] });
    });

    it("deleteDeck tombstones the deck's deckcfg row after the deck row; a 404 is fine", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (init?.method === "DELETE") {
          return String(input).includes("deckcfg:")
            ? new Response(null, { status: 404 })
            : new Response(null, { status: 204 });
        }
        return jsonResponse({
          pluginData: [
            pluginRow("deck:d1", deck("d1", "Doomed")),
            pluginRow("deckcfg:d1", { deckId: "d1", cardTypes: ["reverse"] }),
          ],
        });
      });
      await deleteDeck("d1");
      expect(
        calls()
          .filter(([, init]) => init?.method === "DELETE")
          .map(([url]) => String(url)),
      ).toEqual([
        `/api/plugins/${PLUGIN_ID}/data/deck:d1?workspace=${WORKSPACE_ID}`,
        cfgUrl("d1"),
      ]);
    });
  });

  describe("sibling kinds of a word", () => {
    const rowUrl = (id: string) =>
      `/api/plugins/${PLUGIN_ID}/data/card:${id}?workspace=${WORKSPACE_ID}`;
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
    const deletes = () =>
      calls()
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => String(url));

    it("dropSiblingCards tombstones the sibling and adds its kind to the vocab row", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      const reverse = typed("c-reverse-7", "reverse", 7);
      const cloze = typed("c-cloze-7", "cloze", 7);
      stub([vocab, reverse, cloze]);

      const previous = await dropSiblingCards(["c-reverse-7"]);

      expect(deletes()).toEqual([rowUrl("c-reverse-7")]);
      expect(putBodies()).toEqual([
        { url: rowUrl("c-vocab-7"), body: { ...vocab, skipKinds: ["reverse"] } },
      ]);
      expect(previous.map((row) => row.id).sort()).toEqual(["c-reverse-7", "c-vocab-7"]);
    });

    it("undo through restoreCards brings back the vocab row and the sibling", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      const reverse = typed("c-reverse-7", "reverse", 7);
      stub([vocab, reverse]);
      const previous = await dropSiblingCards(["c-reverse-7"]);
      vi.mocked(fetch).mockClear();
      stub([vocab]);
      await restoreCards(previous);
      const bodies = putBodies();
      expect(bodies.map((b) => b.url).sort()).toEqual(
        [rowUrl("c-reverse-7"), rowUrl("c-vocab-7")].sort(),
      );
      const restoredVocab = bodies.find((b) => b.url === rowUrl("c-vocab-7"))!.body as StudyCard;
      expect("skipKinds" in restoredVocab).toBe(false);
    });

    it("a stray sibling without a vocab row is only tombstoned", async () => {
      stub([typed("c-cloze-9", "cloze", 9)]);
      await dropSiblingCards(["c-cloze-9"]);
      expect(deletes()).toEqual([rowUrl("c-cloze-9")]);
      expect(putBodies()).toEqual([]);
    });

    it("refuses a vocab id", async () => {
      stub([typed("c-vocab-7", "vocab", 7)]);
      await expect(dropSiblingCards(["c-vocab-7"])).rejects.toThrow();
      expect(deletes()).toEqual([]);
    });

    it("skipKind and unskipKind write only the vocab rows", async () => {
      const vocab = typed("c-vocab-7", "vocab", 7);
      stub([vocab]);
      const before = await skipKind(7, "cloze");
      expect(before).toEqual([vocab]);
      expect(putBodies()[0]!.body).toEqual({ ...vocab, skipKinds: ["cloze"] });

      vi.mocked(fetch).mockClear();
      const skipped = { ...vocab, skipKinds: ["reverse", "cloze"] } as StudyCard;
      stub([skipped]);
      const prev = await unskipKind(7, "cloze");
      expect(prev).toEqual([skipped]);
      expect(putBodies()[0]!.body).toEqual({ ...vocab, skipKinds: ["reverse"] });
    });

    it("unskipKind drops the field when the list empties; no vocab row is an error", async () => {
      const skipped = { ...typed("c-vocab-7", "vocab", 7), skipKinds: ["reverse"] } as StudyCard;
      stub([skipped]);
      await unskipKind(7, "reverse");
      expect("skipKinds" in (putBodies()[0]!.body as object)).toBe(false);
      stub([]);
      await expect(skipKind(8, "reverse")).rejects.toThrow();
    });

    it("deleting the word also tombstones its reverse and cloze cards", async () => {
      stub([
        typed("c-vocab-7", "vocab", 7),
        typed("c-reverse-7", "reverse", 7),
        typed("c-cloze-7", "cloze", 7),
      ]);
      await deleteCards(["c-vocab-7"]);
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
      await moveCards(["c-vocab-7"], "d2");
      expect(putBodies().map((b) => b.url).sort()).toEqual(
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

      await deleteDeck("deck-1");

      expect(calls().filter(([, init]) => init?.method === "DELETE")).toEqual([
        [
          `/api/plugins/${PLUGIN_ID}/data/deck:deck-1?workspace=${WORKSPACE_ID}`,
          expect.objectContaining({ method: "DELETE" }),
        ],
      ]);
      // The cards go out as one batch, before the tombstone.
      expect(putBodies()).toEqual([]);
      expect(pushedRows().map(({ key, data }) => ({ key, data }))).toEqual([
        { key: "card:card-orphan", data: { ...orphan, deckIds: [GENERAL_DECK_ID] } },
        { key: "card:card-shared", data: { ...shared, deckIds: ["deck-2"] } },
      ]);
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

      await deleteDeck("deck-1");

      expect(pushedRows().map((row) => row.key)).toEqual(["card:card-early", "card:card-late"]);
    });

    it("refuses to delete the implicit general deck without touching the server", async () => {
      await expect(deleteDeck(GENERAL_DECK_ID)).rejects.toThrow(/general/i);
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

      await deleteDeck("deck-1");

      expect(pushedRows().map(({ key, data }) => ({ key, data }))).toEqual([
        { key: "card:card-shared", data: { ...shared, deckIds: ["deck-2"] } },
      ]);
      expect(calls().some(([, init]) => init?.method === "DELETE")).toBe(true);
    });

    it("lands a multi-deck card in general after sequential deck deletions", async () => {
      const decks = new Map<string, Deck>([
        ["deck:deck-1", deck("deck-1", "One")],
        ["deck:deck-2", deck("deck-2", "Two")],
      ]);
      const cards = new Map<string, StudyCard>([
        ["card:card-1", card("card-1", 42, ["deck-1", "deck-2"])],
      ]);
      const keyOf = (input: unknown): string => {
        const path = String(input).split("/data/")[1] ?? "";
        return path.split("?")[0];
      };
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (String(input) === "/api/sync/push") {
          const rows = JSON.parse(String(init?.body)).pluginData as Array<{ key: string; data: StudyCard }>;
          for (const row of rows) cards.set(row.key, row.data);
          return jsonResponse({ dataAccepted: rows.length, dataSkipped: 0, dataRefused: 0 });
        }
        if (init?.method === "DELETE") {
          decks.delete(keyOf(input));
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          pluginData: [
            ...[...decks].map(([key, data]) => pluginRow(key, data)),
            ...[...cards].map(([key, data]) => pluginRow(key, data)),
          ],
        });
      });

      await deleteDeck("deck-1");
      await deleteDeck("deck-2");

      expect(cards.get("card:card-1")?.deckIds).toEqual([GENERAL_DECK_ID]);
      expect(pushedRows().map((row) => (row.data as StudyCard).deckIds)).toEqual([
        ["deck-2"],
        [GENERAL_DECK_ID],
      ]);
    });
  });

  describe("addCard", () => {
    // addCard reads the workspace's cards before writing so a repeat
    // add returns the existing card; the pull must be answered too.
    function respondWith(rows: unknown[]): void {
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return jsonResponse({ version: 1 });
        return jsonResponse({ pluginData: rows });
      });
    }

    it("writes into an explicitly given workspace instead of the selected one", async () => {
      respondWith([]);

      const added = await addCard(42, { workspaceId: 9 });

      const [call] = calls().filter(([, init]) => init?.method === "PUT");
      expect(String(call[0])).toBe(
        `/api/plugins/${PLUGIN_ID}/data/card:${added.id}?workspace=9`,
      );
    });

    it("reads the explicit workspace for its dedupe", async () => {
      // The selected workspace (7) has the card; workspace 9 does not.
      respondWith([pluginRow("card:card-1", card("card-1", 42, ["general"]))]);

      const added = await addCard(42, { workspaceId: 9 });

      expect(added.id).not.toBe("card-1");
    });

    it("tells write listeners which workspace changed", async () => {
      respondWith([]);
      const seen: number[] = [];
      const stop = onStudyWrite((id) => seen.push(id));

      await addCard(42);
      await addCard(43, { workspaceId: 9 });
      await createDeck("HSK 1");
      stop();
      await addCard(44);

      expect(seen).toEqual([WORKSPACE_ID, 9, WORKSPACE_ID]);
    });

    it("writes a vocab card in the general deck", async () => {
      respondWith([]);

      const added = await addCard(42);

      expect(added.id).toBe("c-vocab-42");
      expect(added.kind).toBe("vocab");
      expect(added.entryId).toBe(42);
      expect(added.deckIds).toEqual([GENERAL_DECK_ID]);
      expect(added.createdAt).toEqual(expect.any(String));
      expect("sentenceId" in added).toBe(false);
      expect("written" in added).toBe(false);
      const [call] = calls().filter(([, init]) => init?.method === "PUT");
      expect(String(call[0])).toBe(
        `/api/plugins/${PLUGIN_ID}/data/card:${added.id}?workspace=${WORKSPACE_ID}`,
      );
      expect(call[1]?.method).toBe("PUT");
      expect(JSON.parse(String(call[1]?.body))).toEqual(added);
    });

    it("keeps the entry kind snapshot of a character card across a round trip", async () => {
      respondWith([]);
      const added = await addCard(11, {
        kind: "writing",
        written: "学",
        entryKind: "character",
      });
      expect(added.entryKind).toBe("character");
      const [put] = calls().filter(([, init]) => init?.method === "PUT");
      const body = JSON.parse(String(put[1]?.body));
      expect(body.entryKind).toBe("character");
      respondWith([pluginRow(`card:${added.id}`, body)]);
      const { cards } = await loadStudyData();
      expect(cards[0].entryKind).toBe("character");
    });

    it("writes the requested kind and does not collide with the vocab card", async () => {
      const vocab = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", vocab)]);

      const added = await addCard(42, { kind: "sentence", sentenceId: 9 });

      expect(added.id).not.toBe("card-1");
      expect(added.kind).toBe("sentence");
      expect(added.sentenceId).toBe(9);
      expect(calls().filter(([, init]) => init?.method === "PUT")).toHaveLength(
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

      const same = await addCard(42, { kind: "sentence", sentenceId: 9 });
      expect(same.id).toBe("card-s9");
      expect(calls().filter(([, init]) => init?.method === "PUT")).toHaveLength(
        0,
      );

      const other = await addCard(42, { kind: "sentence", sentenceId: 10 });
      expect(other.id).not.toBe("card-s9");
      expect(other.sentenceId).toBe(10);
    });

    it("derives the id of a new card from its kind and entry", async () => {
      respondWith([]);

      await expect(addCard(42, { kind: "writing" })).resolves.toMatchObject({
        id: "c-writing-42",
      });
      await expect(addCard(42, { kind: "tone" })).resolves.toMatchObject({
        id: "c-tone-42",
      });
      await expect(
        addCard(42, { kind: "sentence", sentenceId: 9 }),
      ).resolves.toMatchObject({
        id: "c-sentence-42",
      });
      expect(putBodies().map((entry) => entry.url)).toEqual([
        `/api/plugins/${PLUGIN_ID}/data/card:c-writing-42?workspace=${WORKSPACE_ID}`,
        `/api/plugins/${PLUGIN_ID}/data/card:c-tone-42?workspace=${WORKSPACE_ID}`,
        `/api/plugins/${PLUGIN_ID}/data/card:c-sentence-42?workspace=${WORKSPACE_ID}`,
      ]);
    });

    it("never overwrites another sentence card that holds the derived id", async () => {
      const s9 = {
        ...card("c-sentence-42", 42, ["general"]),
        kind: "sentence",
        sentenceId: 9,
      };
      respondWith([pluginRow("card:c-sentence-42", s9)]);

      const s10 = await addCard(42, { kind: "sentence", sentenceId: 10 });

      expect(s10.id).toBe("c-sentence-42-10");
      expect(putBodies().map((entry) => entry.url)).toEqual([
        `/api/plugins/${PLUGIN_ID}/data/card:c-sentence-42-10?workspace=${WORKSPACE_ID}`,
      ]);
    });

    it("falls back to a ULID when every derived id is taken", async () => {
      const s9 = {
        ...card("c-sentence-42", 42, ["general"]),
        kind: "sentence",
        sentenceId: 9,
      };
      respondWith([pluginRow("card:c-sentence-42", s9)]);

      const bare = await addCard(42, { kind: "sentence" });

      expect(bare.id).toMatch(ULID);
    });

    it("returns the earliest of several stored duplicates", async () => {
      const late = card("card-late", 42, ["general"], "2026-01-03T00:00:00Z");
      const early = card("card-early", 42, ["general"], "2026-01-01T00:00:00Z");
      respondWith([
        pluginRow("card:card-late", late),
        pluginRow("card:card-early", early),
      ]);

      await expect(addCard(42)).resolves.toEqual(early);
      expect(putBodies()).toEqual([]);
    });

    it("lets two devices that add the same word at once converge on one card", async () => {
      // One server, last write wins per key. Both devices pull before
      // either writes, so neither sees the other's card.
      const server = new Map<string, unknown>();
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === "PUT") {
          const key = url.split("/data/")[1]!.split("?")[0]!;
          server.set(key, JSON.parse(String(init.body)));
          return jsonResponse({ version: 1 });
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
        addCard(42, { written: "猫" }),
        addCard(42, { written: "猫", deckIds: ["deck-1"] }),
      ]);

      expect(putBodies()).toHaveLength(2);
      expect(deviceA.id).toBe(deviceB.id);
      expect([...server.keys()]).toEqual(["card:c-vocab-42"]);
      const data = await loadStudyData();
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
      expect(putBodies()).toEqual([]);

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

      const added = await addCard(42, { written: "猫", sentenceId: 9 });

      expect(added.written).toBe("猫");
      expect(added.sentenceId).toBe(9);
      const [call] = calls().filter(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(call[1]?.body))).toEqual(added);
    });

    it("stores the card in explicitly requested decks", async () => {
      respondWith([]);

      const added = await addCard(42, {
        deckIds: ["deck-a", "deck-b", "deck-a"],
      });

      expect(added.deckIds).toEqual(["deck-a", "deck-b"]);
      const [call] = calls().filter(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(call[1]?.body))).toEqual(added);
    });

    it("falls back to general when no deck is given", async () => {
      respondWith([]);

      const added = await addCard(42, { deckIds: [] });

      expect(added.deckIds).toEqual([GENERAL_DECK_ID]);
    });

    it("returns the existing card instead of writing a duplicate", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(42)).resolves.toEqual(existing);
      expect(putBodies()).toEqual([]);
    });

    it("dedupes a legacy vocab card that stored a sentenceId by entry", async () => {
      const legacy = { ...card("card-1", 42, ["general"]), sentenceId: 9 };
      respondWith([pluginRow("card:card-1", legacy)]);

      await expect(addCard(42)).resolves.toEqual(legacy);
      await expect(addCard(42, { sentenceId: 10 })).resolves.toEqual(legacy);
      expect(putBodies()).toEqual([]);
    });

    it("leaves an existing card unchanged even when another deck is requested", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(42, { deckIds: ["deck-a"] })).resolves.toEqual(
        existing,
      );
      expect(putBodies()).toEqual([]);
    });

    it("leaves an existing legacy card without a written snapshot unchanged", async () => {
      const existing = card("card-1", 42, ["general"]);
      respondWith([pluginRow("card:card-1", existing)]);

      await expect(addCard(42, { written: "猫" })).resolves.toEqual(existing);
      expect(putBodies()).toEqual([]);
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

    function deletedKeys(): string[] {
      return calls()
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => String(url).split("/data/")[1].split("?")[0]);
    }

    it("tombstones the card, its stored duplicates and its companion cards", async () => {
      serve([vocab, companion, dupe, other]);
      const removed = await deleteCards(["c-vocab-42"]);
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
      await deleteCards(["c-vocab-42"]);
      const order = deletedKeys();
      expect(order[order.length - 1]).toBe("card:c-vocab-42");
      expect(order.indexOf("card:c-writing-42")).toBeLessThan(
        order.indexOf("card:c-vocab-42"),
      );
    });

    it("treats a 404 as already gone and does not report it as removed", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (init?.method === "DELETE") {
          return String(input).includes("c-writing-42")
            ? jsonResponse({ error: "not found" }, 404)
            : new Response(null, { status: 204 });
        }
        return jsonResponse({
          pluginData: [vocab, companion].map((row) =>
            pluginRow(`card:${row.id}`, row),
          ),
        });
      });
      const removed = await deleteCards(["c-vocab-42"]);
      expect(removed.map((row) => row.id)).toEqual(["c-vocab-42"]);
    });

    it("a failed delete reports the rows that did land so they can be undone", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (init?.method === "DELETE") {
          return String(input).includes("c-vocab-42")
            ? jsonResponse({ error: "boom" }, 500)
            : new Response(null, { status: 204 });
        }
        return jsonResponse({
          pluginData: [vocab, companion].map((row) =>
            pluginRow(`card:${row.id}`, row),
          ),
        });
      });
      const err = await deleteCards(["c-vocab-42"]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PartialCardsError);
      expect((err as PartialCardsError).rows.map((row) => row.id)).toEqual([
        "c-writing-42",
      ]);
    });

    it("a failed restore keeps the rows that were not written", async () => {
      let puts = 0;
      vi.mocked(fetch).mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") {
          puts += 1;
          return puts === 2
            ? jsonResponse({ error: "boom" }, 500)
            : jsonResponse({ version: 2 });
        }
        return jsonResponse({ pluginData: [] });
      });
      const err = await restoreCards([vocab, companion, other]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(PartialCardsError);
      expect((err as PartialCardsError).rows.map((row) => row.id)).toEqual([
        "c-vocab-42",
        "c-writing-42",
      ]);
    });

    it("restore with onlyLive skips cards another tab deleted since", async () => {
      serve([other]);
      await restoreCards([vocab, other], { onlyLive: true });
      expect(putBodies().map((entry) => (entry.body as StudyCard).id)).toEqual([
        "c-vocab-43",
      ]);
    });

    it("undoing a move puts every row back into its old decks", async () => {
      serve([vocab, companion, dupe]);
      const before = await moveCards(["c-vocab-42"], "deck-3");
      vi.mocked(fetch).mockClear();
      serve([vocab, companion, dupe]);
      await restoreCards(before, { onlyLive: true });
      const byId = new Map(
        putBodies().map((entry) => [(entry.body as StudyCard).id, entry.body]),
      );
      expect(byId.get("c-vocab-42")).toEqual(vocab);
      expect(byId.get("c-writing-42")).toEqual(companion);
      expect(byId.get("01DUPE")).toEqual(dupe);
    });

    it("deleting a non-vocab card leaves the vocab card alone", async () => {
      serve([vocab, companion]);
      await deleteCards(["c-writing-42"]);
      expect(deletedKeys()).toEqual(["card:c-writing-42"]);
    });

    it("ignores unknown ids and writes nothing for an empty list", async () => {
      serve([vocab]);
      expect(await deleteCards(["nope"])).toEqual([]);
      expect(await deleteCards([])).toEqual([]);
      expect(deletedKeys()).toEqual([]);
    });

    it("restoreCards puts the removed rows back unchanged", async () => {
      serve([]);
      // Deletion order is companions first, so undo writes the word first.
      await restoreCards([companion, vocab]);
      expect(putBodies()).toEqual([
        {
          url: `/api/plugins/${PLUGIN_ID}/data/card:c-vocab-42?workspace=${WORKSPACE_ID}`,
          body: vocab,
        },
        {
          url: `/api/plugins/${PLUGIN_ID}/data/card:c-writing-42?workspace=${WORKSPACE_ID}`,
          body: companion,
        },
      ]);
    });

    it("moves cards (and their duplicates and companions) into the target deck", async () => {
      serve([vocab, companion, dupe, other]);
      await moveCards(["c-vocab-42"], "deck-3");
      const bodies = putBodies();
      expect(
        bodies
          .map((entry) => entry.url.split("/data/")[1].split("?")[0])
          .sort(),
      ).toEqual(["card:01DUPE", "card:c-vocab-42", "card:c-writing-42"]);
      for (const entry of bodies)
        expect((entry.body as StudyCard).deckIds).toEqual(["deck-3"]);
    });

    it("skips rows already only in the target deck", async () => {
      serve([vocab, other]);
      await moveCards(["c-vocab-42", "c-vocab-43"], "deck-1");
      expect(putBodies()).toEqual([]);
    });

    it("rejects a deck that does not exist", async () => {
      serve([vocab]);
      await expect(moveCards(["c-vocab-42"], "ghost")).rejects.toThrow(
        /not found/,
      );
      expect(putBodies()).toEqual([]);
    });

    it("moves into the implicit general deck", async () => {
      serve([vocab]);
      await moveCards(["c-vocab-42"], GENERAL_DECK_ID);
      expect(putBodies()).toHaveLength(1);
    });

    it("rejects an empty target and the move leaves the store untouched", async () => {
      serve([vocab]);
      await expect(moveCards(["c-vocab-42"], "")).rejects.toThrow(/deck/i);
      expect(putBodies()).toEqual([]);
    });

    it("a tombstoned card no longer loads", async () => {
      vi.mocked(fetch).mockImplementation(async () =>
        jsonResponse({
          pluginData: [
            pluginRow("card:c-vocab-42", vocab, {
              deletedAt: "2026-02-01T00:00:00Z",
            }),
            pluginRow("card:c-vocab-43", other),
          ],
          events: [],
        }),
      );
      const data = await loadStudyData();
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
      const data = await loadStudyData();
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
      const data = await loadStudyData();
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
      const data = await loadStudyData();
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
      const [put] = putBodies();
      expect(put.url).toBe(
        `/api/plugins/${PLUGIN_ID}/data/fsrs:set:${saved.id}?workspace=${WORKSPACE_ID}`,
      );
      expect(put.body).toEqual(saved);
      expect(listener).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it("writes the active pointer, null meaning the defaults", async () => {
      vi.mocked(fetch).mockImplementation(async () =>
        jsonResponse({ version: 1 }),
      );
      await setActiveSet(WORKSPACE_ID, null);
      await setActiveSet(WORKSPACE_ID, "A");
      const [first, second] = putBodies();
      expect(first.url).toBe(
        `/api/plugins/${PLUGIN_ID}/data/fsrs:active?workspace=${WORKSPACE_ID}`,
      );
      expect(first.body).toEqual({ setId: null, changedAt: expect.any(String) });
      expect(second.body).toEqual({ setId: "A", changedAt: expect.any(String) });
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
      expect(calls().some(([, init]) => init?.method === "DELETE")).toBe(false);
      await deleteParamSet(WORKSPACE_ID, "A");
      const deletes = calls().filter(([, init]) => init?.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(String(deletes[0][0])).toBe(
        `/api/plugins/${PLUGIN_ID}/data/fsrs:set:A?workspace=${WORKSPACE_ID}`,
      );
    });
  });

  describe("deleting a big deck and clock skew", () => {
    it("deleteDeck rewrites 450 cards in 3 requests, then tombstones the deck", async () => {
      const cards = Array.from({ length: 450 }, (_, i) => card(`card-${i}`, i, ["deck-1"]));
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (String(input) === "/api/sync/push") {
          const n = JSON.parse(String(init?.body)).pluginData.length;
          return jsonResponse({ dataAccepted: n, dataSkipped: 0, dataRefused: 0 });
        }
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Big")),
            ...cards.map((c) => pluginRow(`card:${c.id}`, c)),
          ],
        });
      });
      await deleteDeck("deck-1");
      const order = calls().map(([url, init]) => (String(url) === "/api/sync/push" ? "push" : String(init?.method ?? "GET")));
      expect(order.filter((o) => o === "push")).toHaveLength(3);
      expect(order.indexOf("DELETE")).toBeGreaterThan(order.lastIndexOf("push"));
      expect(putBodies()).toEqual([]);
    });

    it("deleteDeck stops before the tombstone when a chunk fails", async () => {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (String(input) === "/api/sync/push") return new Response("boom", { status: 500 });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse({
          pluginData: [
            pluginRow("deck:deck-1", deck("deck-1", "Doomed")),
            pluginRow("card:card-1", card("card-1", 1, ["deck-1"])),
          ],
        });
      });
      await expect(deleteDeck("deck-1")).rejects.toThrow();
      expect(calls().some(([, init]) => init?.method === "DELETE")).toBe(false);
    });

    it("stamps a row after the newest time the client knows of it, even with a clock behind the server", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
      try {
        vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 2, dataSkipped: 0, dataRefused: 0 }));
        await pushStudyRows(WORKSPACE_ID, [
          { key: "card:a", data: {}, knownAt: "2026-03-10T12:00:05.250Z" }, // server tombstone is ahead
          { key: "card:b", data: {}, knownAt: "2026-03-09T00:00:00.000Z" }, // known time is older: now wins
          { key: "card:c", data: {} },
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
          pluginRow("card:gone", { id: "gone" }, { updatedAt: "2026-02-02T00:00:00Z", deletedAt: "2026-02-03T00:00:00Z" }),
        ],
      });
      const raw = await loadRawStudyData(WORKSPACE_ID);
      expect(raw.knownAt.get("card:live")).toBe("2026-02-01T00:00:00Z");
      expect(raw.knownAt.get("card:gone")).toBe("2026-02-03T00:00:00Z");
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
      return Array.from({ length: n }, (_, i) => ({ key: `card:c-vocab-${i}`, data: { id: `c-vocab-${i}` } }));
    }
    function pushBodies(): Array<{ pluginData: Array<Record<string, unknown>> }> {
      return calls()
        .filter(([url]) => String(url) === "/api/sync/push")
        .map(([, init]) => JSON.parse(String(init?.body)));
    }

    it("pushes rows in sequential chunks of 200 with the workspace and an updatedAt", async () => {
      vi.mocked(fetch).mockImplementation(async (_url, init) =>
        jsonResponse({
          eventsAccepted: 0,
          eventDuplicates: 0,
          dataAccepted: JSON.parse(String(init?.body)).pluginData.length,
          dataSkipped: 0,
          dataRefused: 0,
        }),
      );
      const progress: Array<[number, number]> = [];
      const written: number[] = [];
      const off = onStudyWrite((id) => written.push(id));
      await pushStudyRows(WORKSPACE_ID, pushRows(450), { onProgress: (d, t) => progress.push([d, t]) });
      off();
      const bodies = pushBodies();
      expect(bodies.map((b) => b.pluginData.length)).toEqual([200, 200, 50]);
      expect(bodies[0].pluginData[0]).toMatchObject({
        pluginId: PLUGIN_ID,
        key: "card:c-vocab-0",
        workspaceId: WORKSPACE_ID,
        data: { id: "c-vocab-0" },
      });
      expect(Number.isNaN(Date.parse(String(bodies[0].pluginData[0].updatedAt)))).toBe(false);
      expect(progress).toEqual([[200, 450], [400, 450], [450, 450]]);
      expect(written).toEqual([WORKSPACE_ID, WORKSPACE_ID, WORKSPACE_ID]);
    });

    it("pushes nothing for no rows", async () => {
      await pushStudyRows(WORKSPACE_ID, []);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports how many rows landed when a later chunk fails", async () => {
      let n = 0;
      vi.mocked(fetch).mockImplementation(async () =>
        ++n === 1
          ? jsonResponse({ dataAccepted: 200, dataSkipped: 0, dataRefused: 0 })
          : new Response("boom", { status: 500 }),
      );
      const error = await pushStudyRows(WORKSPACE_ID, pushRows(450)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).done).toBe(200);
      expect((error as PartialPushError).skipped).toBe(0);
    });

    it("a chunk with skipped or refused rows is an error, never a silent success", async () => {
      vi.mocked(fetch).mockImplementation(async () =>
        jsonResponse({ dataAccepted: 198, dataSkipped: 1, dataRefused: 1 }),
      );
      const error = await pushStudyRows(WORKSPACE_ID, pushRows(200)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).done).toBe(198);
      expect((error as PartialPushError).skipped).toBe(2);
      expect((error as PartialPushError).message).toMatch(/2 rows/);
    });

    it("exposes the row keys the planner needs", () => {
      expect(studyRowKey.deck("d1")).toBe("deck:d1");
      expect(studyRowKey.card("c-vocab-1")).toBe("card:c-vocab-1");
    });
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const url = (key: string) => `/api/plugins/${PLUGIN_ID}/data/${key}?workspace=${WORKSPACE_ID}`;

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
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ version: 1 }));
    await saveWorkspaceLimits({ new: 15, reviews: null });
    await saveDeckLimits("d1", { reviews: null });
    await saveDeckLimits("d2", {});
    expect(putBodies()).toEqual([
      { url: url("limits:workspace"), body: { version: 1, new: 15, reviews: null } },
      { url: url("limits:deck:d1"), body: { version: 1, reviews: null } },
    ]);
    const del = calls().filter(([, init]) => init?.method === "DELETE");
    expect(del.map(([u]) => String(u))).toEqual([url("limits:deck:d2")]);
  });

  it("deleteDeck tombstones the deck's limits row; a 404 is fine", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "DELETE") {
        return String(input).includes("limits:") ? new Response(null, { status: 404 }) : new Response(null, { status: 204 });
      }
      return jsonResponse({
        pluginData: [pluginRow("deck:d1", deck("d1", "Doomed")), pluginRow("limits:deck:d1", { version: 1, new: 1 })],
      });
    });
    await deleteDeck("d1");
    expect(calls().filter(([, init]) => init?.method === "DELETE").map(([u]) => String(u))).toEqual([
      url("deck:d1"),
      url("limits:deck:d1"),
    ]);
  });
});
