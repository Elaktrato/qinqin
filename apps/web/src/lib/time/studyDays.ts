// The learner's zone history and the StudyDay every "day" consumer uses, one
// per session (record 0009). It loads the server's copy (mirrored in
// localStorage per user for offline starts) once the session's user is known.
// Lookup order for day(): the loaded history, the cached copy of this user, the
// browser's own zone (provisional, until the load finishes), UTC. The end of
// the session forgets the memory and this user's stored copy.

import type { TimeZoneResponse } from '../api/timeZone';
import { getTimeZone, putTimeZone } from '../api/timeZone';
import { studyDay, type StudyDay, type ZoneChange } from './studyDay';
import { browserZone, forgetZoneCache, readZoneCache, writeZoneCache } from './zone';

export interface StudyDaysDeps {
	local(): Storage | null;
	/** The server's zone routes (lib/api/timeZone.ts). */
	get?: () => Promise<TimeZoneResponse>;
	put?: (zone: string, ifUnset?: boolean) => Promise<TimeZoneResponse>;
}

export class StudyDays {
	readonly #deps: StudyDaysDeps;
	#user: number | null = null;
	// Bumped whenever the user changes or is cleared: a response requested
	// under an older epoch belongs to someone else.
	#epoch = 0;
	#pending: Promise<StudyDay> | null = null;
	#history: ZoneChange[] | null = null;
	#current: StudyDay | null = null;
	readonly #listeners = new Set<(day: StudyDay) => void>();

	constructor(deps: StudyDaysDeps) {
		this.#deps = deps;
	}

	/** day: the loaded history > this user's cached copy > the browser zone > UTC. */
	day(): StudyDay {
		this.#current ??= studyDay(this.effectiveHistory());
		return this.#current;
	}

	/** The zone history behind day() (serialisable, for workers). */
	effectiveHistory(): ZoneChange[] {
		let source: ZoneChange[] | null = this.#history;
		if (!source && this.#user !== null) source = readZoneCache(this.#deps.local(), this.#user);
		if (!source) {
			const zone = browserZone();
			source = zone ? [{ zone, from: null }] : [];
		}
		return source;
	}

	/** The history in effect, `[]` until one is known (the Settings page reads it). */
	known(): readonly ZoneChange[] {
		if (this.#history) return this.#history;
		return this.#user !== null ? (readZoneCache(this.#deps.local(), this.#user) ?? []) : [];
	}

	onChange(listener: (day: StudyDay) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * load fetches the history of `forUser`. An empty server history plus a
	 * usable browser zone sends the browser zone once with `ifUnset` (a second
	 * device never turns that into a change). It never rejects: offline, the
	 * cached copy (or the provisional browser zone) stays in effect. A response
	 * that arrives after the user changed is dropped.
	 */
	async load(forUser: number): Promise<StudyDay> {
		if (this.#user !== forUser) this.#resetUser(forUser);
		const mine = this.#epoch;
		const cached = this.#history ?? readZoneCache(this.#deps.local(), forUser);
		if (cached && !this.#history) this.#set(cached);
		const get = this.#deps.get ?? getTimeZone;
		const put = this.#deps.put ?? putTimeZone;
		const run = (async (): Promise<StudyDay> => {
			try {
				let body = await get();
				if (mine !== this.#epoch) return this.day();
				if (body.history.length === 0) {
					const zone = browserZone();
					if (zone) {
						body = await put(zone, true);
						if (mine !== this.#epoch) return this.day();
					}
				}
				return this.#adopt(forUser, body);
			} catch {
				return this.day();
			}
		})();
		this.#pending = run;
		void run.finally(() => {
			if (this.#pending === run) this.#pending = null;
		});
		return run;
	}

	/**
	 * follow tracks the user the shell may load for: null (signed out, or a
	 * restricted session) forgets the in-memory history; a new or returning user
	 * loads theirs once.
	 */
	follow(id: number | null): Promise<StudyDay> | null {
		if (id === null) {
			this.#resetUser(null);
			return null;
		}
		if (id === this.#user && (this.#history !== null || this.#pending !== null)) {
			return this.#pending ?? Promise.resolve(this.day());
		}
		return this.load(id);
	}

	/** settled resolves once the load in flight (if any) has finished. */
	async settled(): Promise<void> {
		while (this.#pending) await this.#pending.catch(() => undefined);
	}

	/** change makes `zone` the learner's zone from now on and returns the new rule. */
	async change(zone: string): Promise<StudyDay> {
		const mine = this.#epoch;
		const forUser = this.#user;
		const body = await (this.#deps.put ?? putTimeZone)(zone);
		if (mine !== this.#epoch) return this.day();
		if (forUser !== null) return this.#adopt(forUser, body);
		return this.#set(body.history.length > 0 ? body.history : null);
	}

	/** dispose (the session end): the memory and this user's stored copy go. */
	dispose(): void {
		if (this.#user !== null) forgetZoneCache(this.#deps.local(), this.#user);
		this.#resetUser(null);
		this.#listeners.clear();
	}

	#set(next: ZoneChange[] | null): StudyDay {
		this.#history = next;
		this.#current = null;
		const day = this.day();
		for (const listener of [...this.#listeners]) listener(day);
		return day;
	}

	#adopt(id: number, body: TimeZoneResponse): StudyDay {
		if (body.history.length > 0) writeZoneCache(this.#deps.local(), id, body.history);
		return this.#set(body.history.length > 0 ? body.history : null);
	}

	#resetUser(next: number | null): void {
		this.#epoch++;
		this.#user = next;
		this.#history = null;
		this.#current = null;
	}
}
