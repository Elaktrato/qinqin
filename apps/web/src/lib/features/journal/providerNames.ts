// Display names of the providers, fetched once per session and shared by the
// journal's "Answered by" lines. A provider the server no longer lists shows
// its id.
import { getAiProviders } from '$lib/api/ai';
import type { ProviderNamesCache } from '../../context/caches';


export function loadProviderNames(cache: ProviderNamesCache): Promise<Map<string, string>> {
	if (cache.names !== null) return cache.names;
	const mine: Promise<Map<string, string>> = getAiProviders().then(
		(r) => new Map(r.providers.map((p) => [p.id, p.name])),
		() => {
			if (cache.names === mine) cache.names = null; // try again next time
			return new Map<string, string>();
		}
	);
	cache.names = mine;
	return mine;
}
