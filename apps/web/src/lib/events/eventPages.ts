// Paged reader of GET /api/events (docs/contracts/events/, page.json; #110).
// A walk is a first page (limit, since, workspace) followed by `next` pages,
// each repeating the workspace, until `more` is false. Decoding is strict: a
// page that does not match the contract is refused whole. Pure: the caller
// passes the request function.
import type { StudyEvent } from "$lib/events";

/** The largest page the server allows (the pull's budget): fewest requests. */
export const EVENTS_PAGE_LIMIT = 2000;
/** A walk longer than this is refused (2 000 000 events at the default limit). */
export const EVENTS_MAX_PAGES = 1000;

export interface EventsPage {
  events: StudyEvent[];
  more: boolean;
  next: string | null;
}

const PATH = "/api/events";
const ITEM_KEYS = [
  "id",
  "userId",
  "workspaceId",
  "device",
  "ts",
  "type",
  "payload",
];
const WHOLE_SECOND = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function itemOk(raw: unknown): raw is StudyEvent {
  if (!isRecord(raw)) return false;
  const keys = Object.keys(raw);
  if (keys.length !== ITEM_KEYS.length || !ITEM_KEYS.every((k) => k in raw))
    return false;
  return (
    typeof raw.id === "string" &&
    raw.id !== "" &&
    Number.isInteger(raw.userId) &&
    Number.isInteger(raw.workspaceId) &&
    typeof raw.device === "string" &&
    typeof raw.ts === "string" &&
    WHOLE_SECOND.test(raw.ts) &&
    !Number.isNaN(Date.parse(raw.ts)) &&
    typeof raw.type === "string"
  );
}

/** parseEventsPage decodes one paged answer, or null if anything is off. */
export function parseEventsPage(raw: unknown): EventsPage | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (
    keys.length !== 3 ||
    !("events" in raw) ||
    !("more" in raw) ||
    !("next" in raw)
  )
    return null;
  const { events, more, next } = raw;
  if (!Array.isArray(events) || typeof more !== "boolean") return null;
  if (
    more ? typeof next !== "string" || !next.startsWith("e1.") : next !== null
  )
    return null;
  // No "at least one row while more" check: a page saved by the service
  // worker loses its lookup events and can be empty (page.json readerAccepts).
  let prevTs = "";
  let prevId = "";
  for (const e of events) {
    if (!itemOk(e)) return null;
    // ts is fixed-width whole-second UTC text, so text order is time order.
    if (e.ts < prevTs || (e.ts === prevTs && e.id <= prevId)) return null;
    prevTs = e.ts;
    prevId = e.id;
  }
  return raw as unknown as EventsPage;
}

function build(pairs: [string, string][]): string {
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // as normalizeUrl sorts: a stable worker cache key
  return `${PATH}?${new URLSearchParams(pairs).toString()}`;
}

/** firstEventsPageUrl: the request that opens a walk (no workspace: every workspace). */
export function firstEventsPageUrl(opts: {
  since?: string;
  workspace?: number;
  limit?: number;
}): string {
  const pairs: [string, string][] = [
    ["limit", String(opts.limit ?? EVENTS_PAGE_LIMIT)],
  ];
  if (opts.since !== undefined) pairs.push(["since", opts.since]);
  if (opts.workspace !== undefined)
    pairs.push(["workspace", String(opts.workspace)]);
  return build(pairs);
}

/** nextEventsPageUrl: a continuation carries the token and the first page's workspace, nothing else. */
export function nextEventsPageUrl(
  next: string,
  workspace: number | undefined,
): string {
  const pairs: [string, string][] = [["page", next]];
  if (workspace !== undefined) pairs.push(["workspace", String(workspace)]);
  return build(pairs);
}

/**
 * readEventLog follows a walk like readAllEvents, but a continuation that
 * cannot be reached at all (a network error: no server and no saved copy —
 * an offline walk whose page boundaries moved since its pages were saved)
 * ends the walk with the events read so far and `complete: false`. A failed
 * first page, an HTTP error or a page off the contract still throws.
 * `isUnreachable` tells a network error apart (fetch rejects with a TypeError).
 */
export async function readEventLog(
  get: (path: string) => Promise<unknown>,
  opts: { since?: string; workspace?: number; limit?: number },
  limits: {
    maxPages?: number;
    isUnreachable?: (err: unknown) => boolean;
  } = {},
): Promise<{ events: StudyEvent[]; complete: boolean }> {
  const unreachable =
    limits.isUnreachable ?? ((err: unknown) => err instanceof TypeError);
  const out: StudyEvent[] = [];
  let cut = false;
  await walkEvents(
    async (path, n) => {
      try {
        return await get(path);
      } catch (err) {
        if (n > 1 && unreachable(err)) {
          cut = true;
          return CUT;
        }
        throw err;
      }
    },
    opts,
    limits.maxPages,
    out,
  );
  return { events: out, complete: !cut };
}

/**
 * readAllEvents follows a walk to its last page and returns the events in
 * page order ((ts, id)). A bare array answer is the whole log: a server
 * without paging ignores `limit`. Any failure throws (as the keyed-row layer).
 */
export async function readAllEvents(
  get: (path: string) => Promise<unknown>,
  opts: { since?: string; workspace?: number; limit?: number },
  limits: { maxPages?: number } = {},
): Promise<StudyEvent[]> {
  const out: StudyEvent[] = [];
  await walkEvents((path) => get(path), opts, limits.maxPages, out);
  return out;
}

/** The answer of a get that could not reach a continuation: the walk ends there. */
const CUT: unique symbol = Symbol("cut");

/** walkEvents appends every page's events to out; a get answering CUT ends the walk. */
async function walkEvents(
  get: (path: string, n: number) => Promise<unknown>,
  opts: { since?: string; workspace?: number; limit?: number },
  maxPagesOpt: number | undefined,
  out: StudyEvent[],
): Promise<void> {
  const maxPages = maxPagesOpt ?? EVENTS_MAX_PAGES;
  let path = firstEventsPageUrl(opts);
  for (let n = 1; ; n++) {
    if (n > maxPages)
      throw new Error(`event log: more than ${maxPages} pages (maxPages)`);
    const raw = await get(path, n);
    if (raw === CUT) return;
    if (n === 1 && Array.isArray(raw)) {
      for (const e of raw as StudyEvent[]) out.push(e);
      return;
    }
    const page = parseEventsPage(raw);
    if (page === null)
      throw new Error("event log: a page does not match the contract");
    for (const e of page.events) out.push(e);
    if (!page.more) return;
    path = nextEventsPageUrl(page.next as string, opts.workspace);
  }
}
