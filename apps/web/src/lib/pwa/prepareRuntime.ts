// The real dependencies of offline preparation, and the one call the app
// shell makes. Kept out of prepareOffline.ts so that module stays pure.

import { api, getToken } from '../api/client';
import { getEntry } from '../api/entries';
import type { AppContext } from '../context/app.svelte';
import { contextForData } from '../study/currentContext';
import { loadConfig } from '../study/session';
import { hasTabSetup, loadExtraChoices, loadRememberedTypes } from '../study/cardTypesMemory';
import { studyPullPages, loadStudyHistory } from '../study/data';
import { activeWeights } from '../study/readModel';
import { fetchStrokeData } from '../study/strokeData';
import { ownPartition } from './partitions';
import { normalizeUrl } from './sw/classify';
import { prepareOffline } from './prepareOffline';

function controlled(): boolean {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	if (navigator.serviceWorker.controller === null) return false;
	if (navigator.onLine === false) return false;
	const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
	return connection?.saveData !== true;
}

async function currentPartition(): Promise<string | null> {
	const token = getToken();
	return token === null ? null : ownPartition(token);
}

/** True when the worker's partition of this credential already holds `path`. */
async function cachedInPartition(path: string): Promise<boolean> {
	try {
		const name = await currentPartition();
		if (name === null || typeof caches === 'undefined' || !(await caches.has(name))) return false;
		const cache = await caches.open(name);
		return (await cache.match(new URL(normalizeUrl(path), location.origin).href)) !== undefined;
	} catch {
		return false;
	}
}

/** prepareActiveWorkspace: best effort, never throws, never blocks the page. */
export async function prepareActiveWorkspace(app: AppContext): Promise<void> {
	const me = app.auth.user;
	const session = app.session;
	const ws = session?.workspaces.current ?? null;
	if (me === null || session === null || ws === null) return;
	await prepareOffline(ws.id, {
		userId: me.id,
		// A full round: the worker saves full rounds for offline study, never a delta (#193).
		loadHistory: (id) => loadStudyHistory(session.study, id, { full: true }),
		config: loadConfig,
		tabTypes: () => (hasTabSetup() ? loadConfig().cardTypes : null),
		remembered: () => loadRememberedTypes(ws.id),
		choices: () => loadExtraChoices(ws.id),
		language: ws.language,
		contextFor: (data, id, now) => contextForData(data, id, now),
		weights: (data) => activeWeights(data),
		fetchEntry: (id) => getEntry(id),
		fetchStroke: (ch) => fetchStrokeData(session.caches.strokes, ch),
		fetchApi: (path) => api(path),
		pullPages: (id) => studyPullPages(session.study, id),
		storage: typeof localStorage === 'undefined' ? null : localStorage,
		now: () => Date.now(),
		canPrepare: controlled,
		partition: currentPartition,
		isCached: cachedInPartition,
		onPrepared: (prepared) => app.offline.setPrepared(prepared)
	});
}
