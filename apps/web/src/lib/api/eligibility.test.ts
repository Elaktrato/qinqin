import { describe, expect, it, vi } from 'vitest';
import type { api as apiFn } from './client';
import { fetchEligibility } from './eligibility';

describe('fetchEligibility', () => {
	it('posts the ids and returns the entries', async () => {
		const api = vi.fn(async () => ({ entries: { '1': ['reverse'] } }));
		expect(await fetchEligibility(api as unknown as typeof apiFn, [1, 2])).toEqual({ '1': ['reverse'] });
		expect(api).toHaveBeenCalledWith('/api/study/eligibility', { method: 'POST', body: { ids: [1, 2] } });
	});
});
