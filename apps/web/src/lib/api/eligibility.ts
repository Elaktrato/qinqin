import type { api as apiFn } from './client';

type Api = typeof apiFn;

/**
 * fetchEligibility asks POST /api/study/eligibility which companion kinds
 * each entry can make for the caller (docs/contracts/cards/eligibility.json):
 * `{"<id>": ["sentence", "tone", "reverse", "cloze"]}`, 1 to 500 ids.
 */
export async function fetchEligibility(api: Api, ids: readonly number[]): Promise<Record<string, string[]>> {
	const { entries } = await api<{ entries: Record<string, string[]> }>('/api/study/eligibility', {
		method: 'POST',
		body: { ids }
	});
	return entries ?? {};
}
