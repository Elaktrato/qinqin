// The caller's plugin and feature states (GET /api/plugins), one per session
// (record 0009): one fetch feeds the shell nav, the feature pages and the
// generic plugin page route, and the manifests decide which event types
// change the event log (plugins/contract.ts logChangingTypes).

import type { PluginInfo } from '$lib/api/types';
import type { Api } from '$lib/context/deps';

export interface PluginStatesValue {
	list: PluginInfo[];
	status: 'idle' | 'loading' | 'ready' | 'error';
}

export interface PluginStatesDeps {
	api: Api;
	/** False once the session ended: a late answer then sets nothing. */
	alive(): boolean;
}

export class PluginStates implements PluginStatesValue {
	readonly #deps: PluginStatesDeps;
	#value = $state.raw<PluginStatesValue>({ list: [], status: 'idle' });
	#manifests: unknown[] | null = null;

	constructor(deps: PluginStatesDeps) {
		this.#deps = deps;
	}

	get list(): PluginInfo[] {
		return this.#value.list;
	}

	get status(): PluginStatesValue['status'] {
		return this.#value.status;
	}

	/**
	 * The manifests of every plugin the server listed at the last load (enabled
	 * or not, since a disabled plugin's history still counts); null before one.
	 */
	get manifests(): unknown[] | null {
		return this.#manifests;
	}

	/** set replaces the states (a test, or the answer of a load). */
	set(value: PluginStatesValue): void {
		this.#value = value;
		if (value.status === 'ready') this.#manifests = value.list.map((p) => p.manifest);
	}

	/** load fetches the caller's plugin states; never throws. */
	async load(): Promise<void> {
		this.#value = { list: [], status: 'loading' };
		try {
			const list = await this.#deps.api<PluginInfo[]>('/api/plugins');
			// An answer for a session that has ended belongs to someone else (#173).
			if (!this.#deps.alive()) return;
			this.set({ list, status: 'ready' });
		} catch {
			if (!this.#deps.alive()) return;
			this.#value = { list: [], status: 'error' };
		}
	}
}
