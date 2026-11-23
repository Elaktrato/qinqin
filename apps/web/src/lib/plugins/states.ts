// Shared server-side plugin state: one fetch feeds the shell nav and the
// generic plugin page route.

import { onSessionEnd, sessionEpoch } from '$lib/session/sessionEnd';
import { writable } from 'svelte/store';
import { api } from '$lib/api/client';
import type { PluginInfo } from '$lib/api/types';
import { setRegisteredManifests } from './contract';

export interface PluginStatesValue {
	list: PluginInfo[];
	status: 'idle' | 'loading' | 'ready' | 'error';
}

export const pluginStates = writable<PluginStatesValue>({ list: [], status: 'idle' });

/** loadPluginStates fetches the caller's plugin states; never throws. */
export async function loadPluginStates(): Promise<void> {
	pluginStates.set({ list: [], status: 'loading' });
	const epoch = sessionEpoch();
	try {
		const list = await api<PluginInfo[]>('/api/plugins');
		// An answer for a session that has ended belongs to someone else (#173).
		if (epoch !== sessionEpoch()) return;
		setRegisteredManifests(list.map((p) => p.manifest));
		pluginStates.set({ list, status: 'ready' });
	} catch {
		if (epoch !== sessionEpoch()) return;
		pluginStates.set({ list: [], status: 'error' });
	}
}

export function resetPluginStates(): void {
	setRegisteredManifests(null);
	pluginStates.set({ list: [], status: 'idle' });
}

onSessionEnd(() => resetPluginStates());
