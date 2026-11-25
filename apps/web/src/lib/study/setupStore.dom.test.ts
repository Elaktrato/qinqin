import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '$lib/testing/context';
import { StudySetups } from './setupStore.svelte';
import SetupRefresh from './SetupRefresh.test.svelte';

afterEach(cleanup);

describe('StudySetups in an effect', () => {
	it('a refresh from an effect reads once and shows the answer, never looping on its own write', async () => {
		const load = vi.fn(async () => ({ version: 1, newLimit: 12 }));
		const store = new StudySetups({ load, save: async () => {}, local: () => memoryStorage(), user: () => 1, alive: () => true });
		render(SetupRefresh, { store });
		expect(await screen.findByText('12')).toBeTruthy();
		await new Promise((r) => setTimeout(r, 20));
		expect(load).toHaveBeenCalledTimes(1);
	});
});
