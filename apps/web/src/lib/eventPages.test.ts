import { describe, expect, it, vi } from "vitest";

import fixture from "../../../../docs/contracts/events/page.json";
import { normalizeUrl } from "./pwa/sw/classify";
import {
  EVENTS_PAGE_LIMIT,
  firstEventsPageUrl,
  nextEventsPageUrl,
  parseEventsPage,
  readAllEvents,
  readEventLog,
} from "./eventPages";

describe("docs/contracts/events/page.json", () => {
  it("reads with the largest page the server allows", () => {
    expect(EVENTS_PAGE_LIMIT).toBe(fixture.budget.maxLimit);
  });
  for (const v of fixture.valid) {
    it(`decodes the valid page: ${v.name}`, () => {
      expect(parseEventsPage(v.page)).not.toBeNull();
    });
  }
  for (const v of fixture.invalid as {
    name: string;
    page: unknown;
    reason: string;
    readerAccepts?: boolean;
  }[]) {
    if (v.readerAccepts) {
      it(`follows what a saved copy can hold: ${v.name}`, () => {
        expect(parseEventsPage(v.page)).not.toBeNull();
      });
      continue;
    }
    it(`refuses the invalid page: ${v.name} (${v.reason})`, () => {
      expect(parseEventsPage(v.page)).toBeNull();
    });
  }
});

describe("page URLs", () => {
  it("builds a first page with sorted keys, as the worker keys its cache", () => {
    const url = firstEventsPageUrl({
      since: "1970-01-01T00:00:00Z",
      workspace: 7,
    });
    expect(url).toBe(
      "/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7",
    );
    expect(normalizeUrl(url)).toBe(url);
    expect(firstEventsPageUrl({})).toBe("/api/events?limit=2000");
    expect(
      firstEventsPageUrl({ limit: 5, since: "2026-11-15T10:00:00+01:00" }),
    ).toBe("/api/events?limit=5&since=2026-11-15T10%3A00%3A00%2B01%3A00");
  });
  it("repeats the workspace on a continuation, and nothing else", () => {
    expect(nextEventsPageUrl("e1.abc_-", 7)).toBe(
      "/api/events?page=e1.abc_-&workspace=7",
    );
    expect(nextEventsPageUrl("e1.abc", undefined)).toBe(
      "/api/events?page=e1.abc",
    );
  });
});

const item = (n: number, ts = "2026-11-01T09:00:00Z") => ({
  id: `01JC0000000000000000000${String(n).padStart(3, "0")}`,
  userId: 3,
  workspaceId: 7,
  device: "web",
  ts,
  type: "review",
  payload: null,
});

describe("readAllEvents", () => {
  it("follows every page in order and repeats the workspace", async () => {
    const pages: Record<string, unknown> = {
      "/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7": {
        events: [item(1), item(2)],
        more: true,
        next: "e1.a",
      },
      "/api/events?page=e1.a&workspace=7": {
        events: [item(3)],
        more: true,
        next: "e1.b",
      },
      "/api/events?page=e1.b&workspace=7": {
        events: [item(4)],
        more: false,
        next: null,
      },
    };
    const get = vi.fn(async (path: string) => {
      if (!(path in pages)) throw new Error(`unexpected ${path}`);
      return pages[path];
    });
    const events = await readAllEvents(get, {
      since: "1970-01-01T00:00:00Z",
      workspace: 7,
    });
    expect(events.map((e) => e.id)).toEqual(
      [1, 2, 3, 4].map((n) => item(n).id),
    );
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("takes a bare array as the whole log (a server without paging)", async () => {
    const get = vi.fn(async () => [item(1)]);
    expect(await readAllEvents(get, { workspace: 7 })).toEqual([item(1)]);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("refuses a bare array after the first page", async () => {
    const get = vi.fn(async (path: string) =>
      path.includes("limit=") ? { events: [item(1)], more: true, next: "e1.a" } : [item(2)],
    );
    await expect(readAllEvents(get, { workspace: 7 })).rejects.toThrow(/contract/);
    await expect(readEventLog(get, { workspace: 7 })).rejects.toThrow(/contract/);
  });
  it("refuses a page that does not match the contract", async () => {
    const get = vi.fn(async () => ({
      events: [item(1)],
      more: true,
      next: null,
    }));
    await expect(readAllEvents(get, { workspace: 7 })).rejects.toThrow(
      /contract/,
    );
  });
  it("stops after maxPages", async () => {
    let n = 0;
    const get = vi.fn(async () => ({
      events: [item(++n)],
      more: true,
      next: `e1.p${n}`,
    }));
    await expect(
      readAllEvents(get, { workspace: 7 }, { maxPages: 3 }),
    ).rejects.toThrow(/more than 3 pages/);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("propagates a failed request", async () => {
    const get = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(readAllEvents(get, {})).rejects.toThrow("offline");
  });
});

describe("readEventLog (a walk that may be cut offline)", () => {
  const first = "/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7";
  it("is complete when every page answers", async () => {
    const get = vi.fn(async (path: string) =>
      path === first
        ? { events: [item(1)], more: true, next: "e1.a" }
        : { events: [item(2)], more: false, next: null },
    );
    expect(await readEventLog(get, { since: "1970-01-01T00:00:00Z", workspace: 7 })).toEqual({
      events: [item(1), item(2)],
      complete: true,
    });
  });
  it("returns the events read so far when a continuation cannot be reached (no server, no saved copy)", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === first) return { events: [item(1)], more: true, next: "e1.a" };
      throw new TypeError("Failed to fetch");
    });
    expect(await readEventLog(get, { since: "1970-01-01T00:00:00Z", workspace: 7 })).toEqual({
      events: [item(1)],
      complete: false,
    });
  });
  it("still throws when the first page cannot be read", async () => {
    const get = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(readEventLog(get, { workspace: 7 })).rejects.toThrow("Failed to fetch");
  });
  it("still throws on a server error or a bad page in a continuation", async () => {
    class HttpError extends Error {}
    const failing = vi.fn(async (path: string) => {
      if (path.includes("limit=")) return { events: [item(1)], more: true, next: "e1.a" };
      throw new HttpError("HTTP 500");
    });
    await expect(readEventLog(failing, { workspace: 7 })).rejects.toThrow("HTTP 500");
    const bad = vi.fn(async (path: string) =>
      path.includes("limit=") ? { events: [item(1)], more: true, next: "e1.a" } : { events: "x" },
    );
    await expect(readEventLog(bad, { workspace: 7 })).rejects.toThrow(/contract/);
  });
  it("the strict readAllEvents keeps throwing on a cut walk", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("limit=")) return { events: [item(1)], more: true, next: "e1.a" };
      throw new TypeError("Failed to fetch");
    });
    await expect(readAllEvents(get, { workspace: 7 })).rejects.toThrow("Failed to fetch");
  });
});
