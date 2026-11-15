import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review } from './types';

vi.mock('$lib/api/ai', () => ({ getAiProviders: vi.fn() }));

import { getAiProviders } from '$lib/api/ai';
import { resetProviderNames } from './providerNames';
import OverallReview from './OverallReview.svelte';

const review = (over: Partial<Review> = {}): Review => ({
	entryId: 'e1', textHash: 'h', annotations: [],
	overall: { summary: 'Fine.', strengths: [], focus: [] },
	model: 'gpt-6-luna', provider: 'openai', dropped: {} as never, createdAt: 't', ...over
});

beforeEach(() => {
	resetProviderNames();
	vi.mocked(getAiProviders).mockResolvedValue({
		providers: [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }] as never,
		canManageCustom: false, privateAllowed: false
	});
});
afterEach(cleanup);

describe('OverallReview provenance', () => {
	it('shows the provider name next to the model', async () => {
		render(OverallReview, { review: review() });
		await waitFor(() => expect(screen.getByText('Answered by gpt-6-luna · OpenAI')).toBeTruthy());
	});

	it('shows the fallback label for an Anthropic fallback', async () => {
		render(OverallReview, { review: review({ model: 'claude-opus-5', provider: 'anthropic', fallbackFrom: 'claude-opus-5-5' }) });
		await waitFor(() => expect(screen.getByText('Answered by claude-opus-5 · Anthropic (fallback)')).toBeTruthy());
	});

	it('shows the id of a provider that no longer exists', async () => {
		render(OverallReview, { review: review({ provider: 'custom-abcdefghij' }) });
		await waitFor(() => expect(screen.getByText('Answered by gpt-6-luna · custom-abcdefghij')).toBeTruthy());
	});

	it('shows the model alone while the names load or when they cannot', async () => {
		vi.mocked(getAiProviders).mockRejectedValue(new Error('offline'));
		render(OverallReview, { review: review({ provider: undefined }) });
		expect(screen.getByText('Answered by gpt-6-luna')).toBeTruthy();
	});
});
