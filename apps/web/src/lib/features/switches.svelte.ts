// The caller's feature switches (GET /api/features, docs/contracts/features/),
// one per session (record 0009): one fetch feeds the shell nav, the feature
// pages, the widgets and Settings → Features.

import type { Api } from '$lib/context/deps';

/** One user's switch of one core feature; updatedAt is null while never set (on). */
export interface FeatureSwitch {
	id: string;
	enabled: boolean;
	updatedAt?: string | null;
}

export interface FeatureSwitchesValue {
	list: FeatureSwitch[];
	status: 'idle' | 'loading' | 'ready' | 'error';
}

export interface FeatureSwitchesDeps {
	api: Api;
	/** False once the session ended: a late answer then sets nothing. */
	alive(): boolean;
}

function parse(raw: unknown): FeatureSwitch[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((r) => {
		if (typeof r !== 'object' || r === null) return [];
		const { id, enabled, updatedAt } = r as Record<string, unknown>;
		if (typeof id !== 'string' || typeof enabled !== 'boolean') return [];
		return [{ id, enabled, updatedAt: typeof updatedAt === 'string' ? updatedAt : null }];
	});
}

export class FeatureSwitches implements FeatureSwitchesValue {
	readonly #deps: FeatureSwitchesDeps;
	#value = $state.raw<FeatureSwitchesValue>({ list: [], status: 'idle' });

	constructor(deps: FeatureSwitchesDeps) {
		this.#deps = deps;
	}

	get list(): FeatureSwitch[] {
		return this.#value.list;
	}

	get status(): FeatureSwitchesValue['status'] {
		return this.#value.status;
	}

	/** set replaces the switches (a test, or the answer of a load). */
	set(value: FeatureSwitchesValue): void {
		this.#value = value;
	}

	/** load fetches the caller's switches; never throws. */
	async load(): Promise<void> {
		this.#value = { list: [], status: 'loading' };
		try {
			const list = parse(await this.#deps.api<unknown>('/api/features'));
			// An answer for a session that has ended belongs to someone else (#173).
			if (!this.#deps.alive()) return;
			this.set({ list, status: 'ready' });
		} catch {
			if (!this.#deps.alive()) return;
			this.#value = { list: [], status: 'error' };
		}
	}

	/** save stores one switch, then reloads the list (nav, widgets, pages); a failed write throws. */
	async save(id: string, enabled: boolean): Promise<void> {
		await this.#deps.api(`/api/features/${encodeURIComponent(id)}`, { method: 'PUT', body: { enabled } });
		await this.load();
	}
}
