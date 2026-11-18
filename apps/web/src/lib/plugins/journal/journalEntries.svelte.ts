// The entries column's list, per workspace (#103): loaded once, then kept
// in step with saves, deletes and reviews without reloading. Reviews are
// read only for the reviewed dot, at most 40 newest entries, four at a time.

import { t } from '$lib/i18n';
import { getReview, listEntries } from './store';
import type { JournalEntry, Review } from './types';

export interface JournalEntriesApi {
	list(workspaceId: number): Promise<JournalEntry[]>;
	review(workspaceId: number, entryId: string): Promise<Review | null>;
}

const BADGE_LIMIT = 40;
const PARALLEL = 4;

function sortEntries(entries: JournalEntry[]): JournalEntry[] {
	return [...entries].sort(
		(a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
	);
}

export class JournalEntries {
	items = $state<JournalEntry[]>([]);
	reviewed = $state<ReadonlySet<string>>(new Set());
	loading = $state(false);
	error = $state('');
	#api: JournalEntriesApi;
	#workspaceId: number;
	#loaded = false;
	#seq = 0;
	#version = 0;

	constructor(api: JournalEntriesApi, workspaceId: number) {
		this.#api = api;
		this.#workspaceId = workspaceId;
	}

	/** load: the list, once unless `force`; a failure keeps the last list. */
	async load(force = false): Promise<void> {
		if (this.#loaded && !force) return;
		const seq = ++this.#seq;
		const version = this.#version;
		this.loading = true;
		this.error = '';
		try {
			const list = await this.#api.list(this.#workspaceId);
			if (seq !== this.#seq) return;
			if (this.#version === version) this.items = sortEntries(list);
			else {
				// A save landed while the list was in flight: keep it.
				const current = new Set(this.items.map((e) => e.id));
				this.items = sortEntries([...this.items, ...list.filter((e) => !current.has(e.id))]);
			}
			this.#loaded = true;
			void this.loadBadges(seq);
		} catch {
			if (seq === this.#seq) this.error = t('journal.list.loadFailed');
		} finally {
			if (seq === this.#seq) this.loading = false;
		}
	}

	async loadBadges(seq: number): Promise<void> {
		const queue = this.items.slice(0, BADGE_LIMIT);
		const found: string[] = [];
		const api = this.#api;
		const workspaceId = this.#workspaceId;
		async function worker(): Promise<void> {
			for (let entry = queue.shift(); entry; entry = queue.shift()) {
				try {
					if (await api.review(workspaceId, entry.id)) found.push(entry.id);
				} catch {
					// no badge
				}
			}
		}
		await Promise.all(Array.from({ length: PARALLEL }, worker));
		if (seq !== this.#seq) return;
		this.reviewed = new Set([...this.reviewed, ...found]);
	}

	/** upsert: after a save, the entry replaces or joins the list (newest first). */
	upsert(entry: JournalEntry): void {
		this.#version += 1;
		this.items = sortEntries([entry, ...this.items.filter((e) => e.id !== entry.id)]);
	}

	remove(id: string): void {
		this.#version += 1;
		this.items = this.items.filter((e) => e.id !== id);
	}

	markReviewed(id: string): void {
		this.#version += 1;
		this.reviewed = new Set([...this.reviewed, id]);
	}
}

const cache = new Map<number, JournalEntries>();

/** journalEntriesFor: one store per workspace for the app's column. */
export function journalEntriesFor(workspaceId: number): JournalEntries {
	let store = cache.get(workspaceId);
	if (store === undefined) {
		store = new JournalEntries({ list: listEntries, review: getReview }, workspaceId);
		cache.set(workspaceId, store);
	}
	return store;
}

/** clearJournalEntriesCache: sign-out and tests. */
export function clearJournalEntriesCache(): void {
	cache.clear();
}
