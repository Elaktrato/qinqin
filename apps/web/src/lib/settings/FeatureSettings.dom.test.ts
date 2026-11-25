import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { api } from '$lib/api/client';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import { primaryActions } from '$lib/ui/testing/primary';
import FeatureSettings from './FeatureSettings.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

let server: FeatureSwitch[];

beforeEach(() => {
	server = [
		{ id: 'flashcards', enabled: true },
		{ id: 'reader', enabled: false },
		{ id: 'journal', enabled: true },
		{ id: 'grammar', enabled: false }
	];
	ctx.session.features.set({ list: structuredClone(server), status: 'ready' });
	vi.mocked(api).mockImplementation((async (url: string, init?: { method?: string; body?: { enabled: boolean } }) => {
		if (url === '/api/features') return structuredClone(server);
		const m = /^\/api\/features\/([^/]+)$/.exec(url);
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
	ctx.session.features.set({ list: [], status: 'idle' });
});

describe('Settings -> Features', () => {
	it('lists the four core features with the user switch', () => {
		render(FeatureSettings, { context: ctx.context });
		const checked = (name: RegExp) => (screen.getByRole('checkbox', { name }) as HTMLInputElement).checked;
		expect(checked(/Decks/)).toBe(true);
		expect(checked(/Reader/)).toBe(false);
		expect(checked(/Journal/)).toBe(true);
		expect(checked(/Grammar/)).toBe(false);
	});

	it('a switch PUTs {enabled} for the feature and refreshes the shared switches', async () => {
		render(FeatureSettings, { context: ctx.context });
		await fireEvent.click(screen.getByRole('checkbox', { name: /Reader/ }));
		await waitFor(() => expect($state()).toEqual(true));
		expect(vi.mocked(api)).toHaveBeenCalledWith('/api/features/reader', {
			method: 'PUT',
			body: { enabled: true }
		});
		expect(await screen.findByText('Saved')).toBeTruthy();
	});

	it('says what switching off does: hidden for you, nothing deleted', () => {
		render(FeatureSettings, { context: ctx.context });
		expect(screen.getByText(/nothing is deleted/i)).toBeTruthy();
	});

	it('the switches are hairline rows and the view has no primary action (#106)', () => {
		render(FeatureSettings, { context: ctx.context });
		expect(document.querySelectorAll('.features li').length).toBe(4);
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
	return ctx.session.features.list.find((p) => p.id === 'reader')?.enabled;
}
