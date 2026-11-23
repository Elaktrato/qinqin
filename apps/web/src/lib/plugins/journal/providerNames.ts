// Display names of the providers, fetched once and shared by the journal's
// "Answered by" lines. A provider the server no longer lists shows its id.
import { onSessionEnd } from '$lib/session/sessionEnd';
import { getAiProviders } from '$lib/api/ai';

let cache: Promise<Map<string, string>> | null = null;
onSessionEnd(() => resetProviderNames());

export function loadProviderNames(): Promise<Map<string, string>> {
	if (cache !== null) return cache;
	const mine: Promise<Map<string, string>> = getAiProviders().then(
		(r) => new Map(r.providers.map((p) => [p.id, p.name])),
		() => {
			if (cache === mine) cache = null; // try again next time
			return new Map<string, string>();
		}
	);
	cache = mine;
	return mine;
}

/** For tests. */
export function resetProviderNames(): void {
	cache = null;
}
