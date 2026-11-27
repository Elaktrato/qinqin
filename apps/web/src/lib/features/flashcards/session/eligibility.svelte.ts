// The session's eligibility index (#288, docs/contracts/cards/eligibility.json):
// per entry, the companion kinds the server says a study session can make of it
// (POST /api/study/eligibility). Planning reads it as `skip` — the
// `kind:entryId` keys it rules out — so a count never promises a word salad,
// writing, tone, reverse or cloze card the session would drop when shown. An entry it
// does not know (not asked yet, or the request failed) is ruled out of nothing:
// it is planned as before and checked when shown. A drop when shown rules the
// kind out for the rest of the session (it replaces the per-tab memory of
// ineligible words). Owned by the session (record 0009): a sign-out forgets it.

import type { StudyCardKind } from '$lib/studycore/types';

/** The kinds the server decides, in kind order. */
export const SERVER_KINDS = ['sentence', 'writing', 'tone', 'reverse', 'cloze'] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

/** Entries are asked again after this long (a pack or a sentence may have arrived). */
export const ELIGIBILITY_TTL_MS = 10 * 60_000;
/** Ids per request (the route's cap). */
export const ELIGIBILITY_BATCH = 500;
/** Requests in flight at once. */
const PARALLEL = 2;

export interface EligibilityDeps {
	/** One request: the kinds of each asked id (an absent id has none). */
	fetch(ids: number[]): Promise<Record<string, readonly string[]>>;
	now(): number;
}

interface Row {
	kinds: ReadonlySet<string>;
	at: number;
}

export class EligibilityIndex {
	readonly #deps: EligibilityDeps;
	readonly #rows = new Map<number, Row>();
	/** Kinds found unusable when shown, `kind:entryId`. */
	readonly #ruledOut = new Set<string>();
	readonly #pending = new Map<number, Promise<void>>();
	#version = $state(0);
	#skip: { version: number; set: Set<string> } | null = null;

	constructor(deps: EligibilityDeps) {
		this.#deps = deps;
	}

	/** Changes whenever an answer lands or a kind is ruled out: read it to recompute a plan. */
	get version(): number {
		return this.#version;
	}

	/** Whether the server answered for the entry. */
	knows(entryId: number): boolean {
		void this.#version;
		return this.#rows.has(entryId);
	}

	/** Whether the entry can make `kind`: undefined while unknown (vocab: always undefined unless ruled out). */
	allows(kind: StudyCardKind, entryId: number): boolean | undefined {
		void this.#version;
		if (this.#ruledOut.has(`${kind}:${entryId}`)) return false;
		if (!(SERVER_KINDS as readonly string[]).includes(kind)) return undefined;
		const row = this.#rows.get(entryId);
		return row === undefined ? undefined : row.kinds.has(kind);
	}

	/**
	 * ensure asks for the ids it does not know or knows for longer than the
	 * time to live, and resolves when every request settled. A failed request
	 * leaves its ids unknown (asked again next time); it never rejects.
	 */
	async ensure(ids: Iterable<number>): Promise<void> {
		const now = this.#deps.now();
		const wait: Promise<void>[] = [];
		const ask: number[] = [];
		for (const id of new Set(ids)) {
			if (!Number.isInteger(id) || id <= 0) continue;
			const pending = this.#pending.get(id);
			if (pending !== undefined) {
				wait.push(pending);
				continue;
			}
			const row = this.#rows.get(id);
			if (row === undefined || now - row.at >= ELIGIBILITY_TTL_MS) ask.push(id);
		}
		const batches: number[][] = [];
		for (let at = 0; at < ask.length; at += ELIGIBILITY_BATCH) batches.push(ask.slice(at, at + ELIGIBILITY_BATCH));
		let next = 0;
		const lanes: Promise<void>[] = [];
		const lane = async (): Promise<void> => {
			while (next < batches.length) await this.#request(batches[next++]);
		};
		// Every id of a batch is pending until its lane reaches it.
		const all = (async () => {
			for (let i = 0; i < Math.min(PARALLEL, batches.length); i++) lanes.push(lane());
			await Promise.all(lanes);
		})();
		for (const id of ask) this.#pending.set(id, all);
		try {
			await Promise.all([all, ...wait]);
		} finally {
			for (const id of ask) if (this.#pending.get(id) === all) this.#pending.delete(id);
		}
	}

	async #request(ids: number[]): Promise<void> {
		let answer: Record<string, readonly string[]>;
		try {
			answer = await this.#deps.fetch(ids);
		} catch {
			return;
		}
		const at = this.#deps.now();
		for (const id of ids) {
			const kinds = answer?.[String(id)];
			this.#rows.set(id, { kinds: new Set(Array.isArray(kinds) ? kinds : []), at });
		}
		this.#version++;
	}

	/** The `kind:entryId` keys planning leaves out: kinds the server did not list for a known entry, and drops. */
	skip(): Set<string> {
		const version = this.#version;
		if (this.#skip !== null && this.#skip.version === version) return this.#skip.set;
		const set = new Set(this.#ruledOut);
		for (const [id, row] of this.#rows) {
			for (const kind of SERVER_KINDS) if (!row.kinds.has(kind)) set.add(`${kind}:${id}`);
		}
		this.#skip = { version, set };
		return set;
	}

	/** A card of `kind` for the entry proved unusable when shown: never planned again this session. */
	ruleOut(kind: StudyCardKind, entryId: number): void {
		const key = `${kind}:${entryId}`;
		if (this.#ruledOut.has(key)) return;
		this.#ruledOut.add(key);
		this.#version++;
	}

	/** The entry changed (a sentence added): ask again. */
	forget(entryId: number): void {
		this.#rows.delete(entryId);
		for (const key of [...this.#ruledOut]) if (key.endsWith(`:${entryId}`)) this.#ruledOut.delete(key);
		this.#version++;
	}

	/** clear forgets everything (the session end). */
	clear(): void {
		this.#rows.clear();
		this.#ruledOut.clear();
		this.#pending.clear();
		this.#skip = null;
		this.#version++;
	}
}
