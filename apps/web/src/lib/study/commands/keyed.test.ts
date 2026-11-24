import { testContext, type TestContext } from '$lib/testing/context';
// Keyed-row commands (split from the old store tests, #193).
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
    const off = onStudyChange((w) => seen.push(w as number));
    await saveVacation({ version: 1, id: "A", start: "2026-12-01", end: null, scope: "all", createdDay: "2026-11-15", createdAt: "2026-11-15T08:00:00Z" });
    await deleteVacation("A");
    off();
    expect(putBodies()[0].url).toBe(`/api/plugins/${PLUGIN_ID}/data/vacation:A`);
    const del = calls().find(([, init]) => init?.method === "DELETE");
    expect(String(del?.[0])).toBe(`/api/plugins/${PLUGIN_ID}/data/vacation:A`);
    expect(seen).toEqual([ALL_WORKSPACES, ALL_WORKSPACES]);
  });
});

describe("goal row", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("fetch", vi.fn());
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
    const off = onStudyChange((w) => seen.push(w));
    // The current workspace has moved on: the caller's captured id wins.
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
    const off = onStudyChange((w) => seen.push(w));
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
    const off = onStudyChange((w) => seen.push(w));
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
    const data = await loadStudyData(3);
    expect([...(data.milestoneTombstones ?? new Map())]).toEqual([["reviews:100", "2026-11-17T09:00:00Z"]]);
  });

  it("saveSeenMilestones stamps a row after the tombstone it revives", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ dataAccepted: 1, dataSkipped: 0, dataRefused: 0 }));
    await saveSeenMilestones(3, [{ key: "milestone:reviews:100", data: seen("reviews:100"), knownAt: "2099-01-01T00:00:00Z" }]);
    expect(pushes()[0].pluginData[0].updatedAt).toBe("2099-01-01T00:00:00.001Z");
  });

  it("loadStudyData passes seenMilestones through", async () => {
    respondPull({ pluginData: [pluginRow("milestone:reviews:100", seen("reviews:100"), { workspaceId: 3 })] });
    const data = await loadStudyData(3);
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
    const off = onStudyChange((w) => touched.push(w));
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
