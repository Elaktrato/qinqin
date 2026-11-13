import { api } from './client';
import type { CharactersResponse, CharRow } from './types';

export type { CharRow } from './types';

export interface CharacterList {
	chars: CharRow[];
	count: number;
	/** Set when the database predates the importer that keeps the level fields. */
	stale?: boolean;
}

interface Pending {
	promise: Promise<CharacterList>;
	controller: AbortController;
	waiters: number;
}

// The universe list is large and changes only on a re-seed, so it stays in
// memory for the session. Revalidation across visits is the browser cache's
// job: the server sends an ETag with `max-age=0, must-revalidate`.
const loaded = new Map<string, CharacterList>();
const inFlight = new Map<string, Pending>();

/** clearCharacterCache forgets every loaded list (tests, sign-out). */
export function clearCharacterCache(): void {
	loaded.clear();
	for (const pending of inFlight.values()) pending.controller.abort();
	inFlight.clear();
}

function abortError(): DOMException {
	return new DOMException('The request was aborted.', 'AbortError');
}

function start(language: string): Pending {
	const controller = new AbortController();
	const params = new URLSearchParams({ language });
	const pending: Pending = {
		controller,
		waiters: 0,
		promise: api<Partial<CharactersResponse> | null>(`/api/characters?${params}`, {
			signal: controller.signal
		}).then(
			(body) => {
				const chars = Array.isArray(body?.chars) ? body.chars : [];
				const count = typeof body?.count === 'number' ? body.count : chars.length;
				const list: CharacterList = { chars, count };
				if (body?.stale === true) list.stale = true;
				if (inFlight.get(language) === pending) {
					inFlight.delete(language);
					loaded.set(language, list);
				}
				return list;
			},
			(error: unknown) => {
				if (inFlight.get(language) === pending) inFlight.delete(language);
				throw error;
			}
		)
	};
	inFlight.set(language, pending);
	return pending;
}

/**
 * fetchCharacters loads GET /api/characters for a language (its primary
 * subtag; requests and the cache are keyed by it): every
 * character of the dictionary universe in compact form. A loaded list is
 * kept in memory per language; concurrent callers share one request.
 * Errors are not cached (HTTP errors arrive as ApiError). Aborting
 * `signal` rejects this caller with an AbortError; the shared request is
 * cancelled only once every caller waiting on it has aborted.
 */
export function fetchCharacters(code: string, signal?: AbortSignal): Promise<CharacterList> {
	// The endpoint knows only primary languages: `zh-TW` asks for `zh`.
	const language = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	const cached = loaded.get(language);
	if (cached !== undefined) return Promise.resolve(cached);
	if (signal?.aborted) return Promise.reject(abortError());

	const pending = inFlight.get(language) ?? start(language);
	pending.waiters += 1;
	if (signal === undefined) return pending.promise;

	return new Promise<CharacterList>((resolve, reject) => {
		let done = false;
		const onAbort = () => {
			if (done) return;
			done = true;
			pending.waiters -= 1;
			if (pending.waiters === 0 && inFlight.get(language) === pending) {
				inFlight.delete(language);
				pending.controller.abort();
			}
			reject(abortError());
		};
		signal.addEventListener('abort', onAbort, { once: true });
		pending.promise.then(
			(list) => {
				if (done) return;
				done = true;
				signal.removeEventListener('abort', onAbort);
				resolve(list);
			},
			(error: unknown) => {
				if (done) return;
				done = true;
				signal.removeEventListener('abort', onAbort);
				reject(error);
			}
		);
	});
}
