// The saved pages of the paged event log (GET /api/events, #110) in the
// worker's partition. A walk's page boundaries move when its events change
// (a late offline review, a lookup Clear), and each walk saves its pages under
// their own continuation URLs, so the partition gathers continuations no saved
// first page leads to any more. After a complete walk the page drops those of
// the workspace: a continuation is kept exactly when the chain of `next`
// tokens from a saved first page reaches it.

import { ownPartition } from './partitions';

export interface PageCacheLike {
	keys(): Promise<readonly Request[]>;
	match(request: Request | string): Promise<Response | undefined>;
	delete(request: Request | string): Promise<boolean>;
}

export interface PageCachesLike {
	has(name: string): Promise<boolean>;
	open(name: string): Promise<PageCacheLike>;
}

const PATH = '/api/events';

async function nextOf(cache: PageCacheLike, key: string): Promise<string | null> {
	try {
		const saved = await cache.match(key);
		if (!saved) return null;
		const body = (await saved.json()) as { more?: unknown; next?: unknown } | null;
		return body?.more === true && typeof body.next === 'string' ? body.next : null;
	} catch {
		return null;
	}
}

/**
 * pruneEventPages deletes the saved continuations of `workspaceId` that no
 * saved first page of that workspace leads to, and returns how many. Other
 * workspaces, the legacy array copy and every other path are left alone.
 */
export async function pruneEventPages(cache: PageCacheLike, workspaceId: number): Promise<number> {
	const ws = String(workspaceId);
	const firsts: string[] = [];
	const continuations = new Map<string, string>(); // token -> cache key
	for (const req of await cache.keys()) {
		const url = new URL(req.url);
		if (url.pathname !== PATH || url.searchParams.get('workspace') !== ws) continue;
		const page = url.searchParams.get('page');
		if (page !== null) continuations.set(page, req.url);
		else if (url.searchParams.has('limit')) firsts.push(req.url);
	}
	const reached = new Set<string>();
	for (const first of firsts) {
		let token = await nextOf(cache, first);
		while (token !== null && !reached.has(token)) {
			reached.add(token);
			const key = continuations.get(token);
			if (key === undefined) break;
			token = await nextOf(cache, key);
		}
	}
	let deleted = 0;
	for (const [token, key] of continuations) {
		if (!reached.has(token) && (await cache.delete(key))) deleted++;
	}
	return deleted;
}

/**
 * pruneSavedEventPages runs pruneEventPages in the current credential's
 * partition. Best effort: without Cache Storage, a token or the partition it
 * does nothing, and it never throws.
 */
export async function pruneSavedEventPages(
	workspaceId: number,
	env: { caches: PageCachesLike | undefined; token: string | null }
): Promise<void> {
	if (env.caches === undefined || env.token === null) return;
	try {
		const name = await ownPartition(env.token);
		if (!(await env.caches.has(name))) return;
		await pruneEventPages(await env.caches.open(name), workspaceId);
	} catch {
		// A closed or denied cache: the stale pages only cost space.
	}
}

