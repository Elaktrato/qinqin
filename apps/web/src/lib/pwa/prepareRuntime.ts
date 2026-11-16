// The real dependencies of offline preparation, and the one call the app
// shell makes. Kept out of prepareOffline.ts so that module stays pure.

import { get } from 'svelte/store';
import { api } from '../api/client';
import { getEntry } from '../api/entries';
import { user } from '../auth';
import { contextForData } from '../study/currentContext';
import { loadStudyHistory } from '../study/history';
import { loadConfig } from '../study/session';
import { activeWeights } from '../study/store';
import { fetchStrokeData } from '../study/strokeData';
import { workspaces } from '../workspaces';
import { setPrepared } from './offlineState';
import { prepareOffline } from './prepareOffline';

function controlled(): boolean {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	if (navigator.serviceWorker.controller === null) return false;
	if (navigator.onLine === false) return false;
	const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
	return connection?.saveData !== true;
}

/** prepareActiveWorkspace: best effort, never throws, never blocks the page. */
export async function prepareActiveWorkspace(): Promise<void> {
	const me = get(user);
	const ws = get(workspaces).current;
	if (me === null || ws === null || ws === undefined) return;
	await prepareOffline(ws.id, {
		userId: me.id,
		loadHistory: (id) => loadStudyHistory(id),
		config: loadConfig,
		language: ws.language,
		contextFor: (data, id, now) => contextForData(data, id, now),
		weights: (data) => activeWeights(data),
		fetchEntry: (id) => getEntry(id),
		fetchStroke: (ch) => fetchStrokeData(ch),
		fetchApi: (path) => api(path),
		storage: typeof localStorage === 'undefined' ? null : localStorage,
		now: () => Date.now(),
		canPrepare: controlled,
		onPrepared: setPrepared
	});
}
