import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { api } from '$lib/api/client';
import type { PluginInfo } from '$lib/api/types';
import { primaryActions } from '$lib/ui/testing/primary';
import FeatureSettings from './FeatureSettings.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

let server: PluginInfo[];

beforeEach(() => {
	server = [
		{ id: 'qinqin-flashcards', manifest: {}, enabled: true, order: 3 },
		{ id: 'qinqin-reader', manifest: {}, enabled: false, order: 0 },
		{ id: 'qinqin-journal', manifest: {}, enabled: true, order: 1 }
	];
	ctx.session.plugins.set({ list: structuredClone(server), status: 'ready' });
	vi.mocked(api).mockImplementation((async (url: string, init?: { method?: string; body?: { enabled: boolean } }) => {
		if (url === '/api/plugins') return structuredClone(server);
		const m = /^\/api\/plugins\/([^/]+)\/state$/.exec(url);
		if (m && init?.method === 'PUT') {
			const row = server.find((s) => s.id === decodeURIComponent(m[1]))!;
			row.enabled = init.body!.enabled;
			return { ...row };
		}
		throw new Error(`unexpected ${url}`);
	}) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.plugins.set({ list: [], status: 'idle' });
});

describe('Settings -> Features', () => {
	it('lists Decks and Reader with the user state, and no plugin', () => {
		render(FeatureSettings, { context: ctx.context });
		const decks = screen.getByRole('checkbox', { name: /Decks/ }) as HTMLInputElement;
		const reader = screen.getByRole('checkbox', { name: /Reader/ }) as HTMLInputElement;
		expect(decks.checked).toBe(true);
		expect(reader.checked).toBe(false);
		expect(screen.queryByText(/Journal/)).toBeNull();
	});

	it('a switch PUTs {enabled, order: 0} for the feature and refreshes the shared states', async () => {
		render(FeatureSettings, { context: ctx.context });
		await fireEvent.click(screen.getByRole('checkbox', { name: /Reader/ }));
		await waitFor(() => expect($state()).toEqual(true));
		expect(vi.mocked(api)).toHaveBeenCalledWith('/api/plugins/qinqin-reader/state', {
			method: 'PUT',
			body: { enabled: true, order: 0 }
		});
		expect(await screen.findByText('Saved')).toBeTruthy();
	});

	it('says what switching off does: hidden for you, nothing deleted', () => {
		render(FeatureSettings, { context: ctx.context });
		expect(screen.getByText(/nothing is deleted/i)).toBeTruthy();
	});

	it('the switches are hairline rows and the view has no primary action (#106)', () => {
		render(FeatureSettings, { context: ctx.context });
		expect(document.querySelectorAll('.features li').length).toBe(2);
		expect(primaryActions(document.body)).toHaveLength(0);
	});

	it('a failed save puts the switch back and says so', async () => {
		vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
		render(FeatureSettings, { context: ctx.context });
		const decks = screen.getByRole('checkbox', { name: /Decks/ }) as HTMLInputElement;
		await fireEvent.click(decks);
		// The thrown text is never shown (#168): the screen's own sentence is.
		expect((await screen.findByRole('alert')).textContent).toContain('Could not save the switch.');
		expect(decks.checked).toBe(true);
	});
});

function $state(): boolean | undefined {
	return ctx.session.plugins.list.find((p) => p.id === 'qinqin-reader')?.enabled;
}
