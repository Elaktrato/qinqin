import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { pluginStates } from '$lib/plugins/states';
import FeaturePage from './FeaturePage.svelte';
import FeatureStub from './FeatureStub.test.svelte';
import { FLASHCARDS_ID, READER_ID } from './index';


afterEach(() => {
	cleanup();
	document.title = '';
	pluginStates.set({ list: [], status: 'idle' });
});

const feature = { id: FLASHCARDS_ID, title: 'Decks', label: 'Flashcards', verb: 'are' as const, component: FeatureStub };

describe('FeaturePage', () => {
	it('renders the feature with the rest of the path when it is on', async () => {
		pluginStates.set({ list: [{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 }], status: 'ready' });
		render(FeaturePage, { feature, rest: 'deck/general' });
		expect((await screen.findByTestId('stub')).textContent).toBe('rest=deck/general');
	});

	it('renders the feature when the user has no state row (on by default)', async () => {
		pluginStates.set({ list: [], status: 'ready' });
		render(FeaturePage, { feature, rest: '' });
		expect(await screen.findByTestId('stub')).toBeTruthy();
	});

	it('says the feature is switched off, with a link to Settings -> Features, and renders nothing of it', async () => {
		pluginStates.set({ list: [{ id: FLASHCARDS_ID, manifest: {}, enabled: false, order: 0 }], status: 'ready' });
		render(FeaturePage, { feature, rest: 'deck/general' });
		expect(screen.getByRole('heading', { name: 'Flashcards are switched off' })).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Settings → Features' });
		expect(link.getAttribute('href')).toBe('/settings?tab=features');
		expect(screen.queryByTestId('stub')).toBeNull();
	});

	it('another feature switched off does not hide this one', async () => {
		pluginStates.set({ list: [{ id: READER_ID, manifest: {}, enabled: false, order: 0 }], status: 'ready' });
		render(FeaturePage, { feature, rest: '' });
		expect(await screen.findByTestId('stub')).toBeTruthy();
	});

	it('waits for the states, and says so when they fail to load', async () => {
		pluginStates.set({ list: [], status: 'loading' });
		const { unmount } = render(FeaturePage, { feature, rest: '' });
		expect(screen.getByText('Loading…')).toBeTruthy();
		expect(screen.queryByTestId('stub')).toBeNull();
		unmount();
		pluginStates.set({ list: [], status: 'error' });
		render(FeaturePage, { feature, rest: '' });
		expect(screen.getByRole('alert').textContent).toContain('Could not load your settings');
	});
});
