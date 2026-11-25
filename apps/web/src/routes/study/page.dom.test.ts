import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));

import { testContext } from '$lib/testing/context';
import Page from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('/study', () => {
	it('replaces itself with home and opens the study modal there', async () => {
		const ctx = testContext();
		render(Page, { context: ctx.context });
		expect(goto).toHaveBeenCalledWith('/', { replaceState: true });
		await vi.waitFor(() => expect(ctx.session.studyModal.open).toBe(true));
	});
});
