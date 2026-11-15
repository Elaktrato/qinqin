// Display names of the providers, fetched once and shared by the journal's
// "Answered by" lines. A provider the server no longer lists shows its id.
import { getAiProviders } from '$lib/api/ai';

let cache: Promise<Map<string, string>> | null = null;

export function loadProviderNames(): Promise<Map<string, string>> {
	cache ??= getAiProviders().then(
		(r) => new Map(r.providers.map((p) => [p.id, p.name])),
		() => {
			cache = null; // try again next time
			return new Map<string, string>();
		}
	);
	return cache;
}

/** For tests. */
export function resetProviderNames(): void {
	cache = null;
}
