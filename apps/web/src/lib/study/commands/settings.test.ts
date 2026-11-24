import { newSession, studyContext, type TestContext } from '$lib/testing/context';
// Settings commands (split from the old store tests, #193).
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

// Every test starts a session of its own: the study cache holds nothing.
beforeEach(() => newSession(ctx));
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

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});


describe("settings commands", () => {
  useStudyStoreMocks();

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
      const data = await loadStudyData(ctx.session.study, WORKSPACE_ID);
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
      const data = await loadStudyData(ctx.session.study, WORKSPACE_ID);
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
      const data = await loadStudyData(ctx.session.study, WORKSPACE_ID);
      expect(data.fsrs?.sets).toEqual([]);
      expect(data.fsrs?.w).toEqual(DEFAULT_W);
    });

    it("saves a set under a ULID key and notifies listeners", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));
      const listener = vi.fn();
      onStudyChange(ctx.session.study, listener);
      const saved = await saveParamSet(ctx.session.study, WORKSPACE_ID, {
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
      await setActiveSet(ctx.session.study, WORKSPACE_ID, "A");
      // The server now holds A: switching back to the defaults writes setId null.
      respondPull({ pluginData: [pluginRow("fsrs:active", { setId: "A", changedAt: "2026-01-06T00:00:00Z" })] });
      await setActiveSet(ctx.session.study, WORKSPACE_ID, null);
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
      await expect(deleteParamSet(ctx.session.study, WORKSPACE_ID, "B")).rejects.toThrow(
        "Cannot delete the active parameters.",
      );
      expect(writes()).toEqual([]);
      await deleteParamSet(ctx.session.study, WORKSPACE_ID, "A");
      expect(deletedKeys()).toEqual(["fsrs:set:A"]);
      expect(writes()).toHaveLength(1);
    });
  });
});

describe("limit rows", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
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
    const data = await loadStudyData(ctx.session.study, WORKSPACE_ID);
    expect(data.limits).toEqual({ workspace: { new: 10, reviews: null }, decks: { d1: { new: 0 } } });
  });

  it("saves the workspace row and a deck row, and deletes a deck row when nothing is left to say", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (isPush(input, init)) return pushAnswer(init);
      return jsonResponse({ pluginData: [pluginRow("limits:deck:d2", { version: 1, new: 3 })] });
    });
    await saveWorkspaceLimits(ctx.session.study, WORKSPACE_ID, { new: 15, reviews: null });
    await saveDeckLimits(ctx.session.study, WORKSPACE_ID, "d1", { reviews: null });
    await saveDeckLimits(ctx.session.study, WORKSPACE_ID, "d2", {});
    // A deck without a row has nothing to remove.
    await saveDeckLimits(ctx.session.study, WORKSPACE_ID, "d3", {});
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
    await deleteDeck(ctx.session.study, WORKSPACE_ID, "d1");
    expect(deletedKeys()).toEqual(["deck:d1", "limits:deck:d1"]);
  });
});
