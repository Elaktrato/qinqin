// The radical and part lookup's data (#71): GET /api/components (the
// component index of a language) and GET /api/component-packs (credits).
// Contract: docs/contracts/radicals/README.md.
import { onSessionEnd } from '../session/sessionEnd';
import { api } from './client';
import type { ComponentPack, ComponentPart, ComponentsResponse } from './types';

export interface ComponentIndex {
	packs: ComponentsResponse['packs'];
	parts: ComponentPart[];
	chars: Record<string, string[]>;
}

// Like the character universe, the index changes only when packs change:
// it stays in memory for the session, concurrent callers share one
// request, and errors are not cached. The browser revalidates by ETag.
const loaded = new Map<string, ComponentIndex>();
const inFlight = new Map<string, Promise<ComponentIndex>>();
onSessionEnd(() => clearComponentsCache());

/** clearComponentsCache forgets every loaded index (tests, sign-out). */
export function clearComponentsCache(): void {
	loaded.clear();
	inFlight.clear();
}

function decode(body: Partial<ComponentsResponse> | null): ComponentIndex {
	const packs = Array.isArray(body?.packs) ? body.packs : [];
	const parts = Array.isArray(body?.parts) ? body.parts : [];
	const chars = body?.chars && typeof body.chars === 'object' && !Array.isArray(body.chars) ? body.chars : {};
	return { packs, parts, chars };
}

/**
 * fetchComponents loads GET /api/components for a language's primary
 * subtag (`zh-TW` asks for `zh`). Public, no credentials sent.
 */
export function fetchComponents(code: string): Promise<ComponentIndex> {
	const language = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	const cached = loaded.get(language);
	if (cached !== undefined) return Promise.resolve(cached);
	const pending = inFlight.get(language);
	if (pending !== undefined) return pending;
	const params = new URLSearchParams({ language });
	const promise = api<Partial<ComponentsResponse> | null>(`/api/components?${params}`, { auth: false }).then(
		(body) => {
			const index = decode(body);
			if (inFlight.get(language) === promise) {
				inFlight.delete(language);
				loaded.set(language, index);
			}
			return index;
		},
		(error: unknown) => {
			if (inFlight.get(language) === promise) inFlight.delete(language);
			throw error;
		}
	);
	inFlight.set(language, promise);
	return promise;
}

/** getComponentPacks lists the installed components packs (public). */
export function getComponentPacks(): Promise<ComponentPack[]> {
	return api<ComponentPack[]>('/api/component-packs', { auth: false });
}
