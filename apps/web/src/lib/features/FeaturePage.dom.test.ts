import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { primaryActions } from '$lib/ui/testing/primary';
import FeaturePage from './FeaturePage.svelte';
import FeatureStub from './FeatureStub.test.svelte';
import { FLASHCARDS_ID, READER_ID } from './index';
import source from './FeatureGate.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});


afterEach(() => {
	cleanup();
	document.title = '';
	ctx.session.features.set({ list: [], status: 'idle' });
});

const feature = { id: FLASHCARDS_ID, title: 'Decks', verb: 'are' as const, component: FeatureStub };

describe('FeaturePage', () => {
	it('renders the feature with the rest of the path when it is on', async () => {
		ctx.session.features.set({ list: [{ id: FLASHCARDS_ID, enabled: true }], status: 'ready' });
		render(FeaturePage, { props: { feature, rest: 'deck/general' }, context: ctx.context });
		expect((await screen.findByTestId('stub')).textContent).toBe('rest=deck/general');
	});

	it('renders the feature when the user has no state row (on by default)', async () => {
		ctx.session.features.set({ list: [], status: 'ready' });
		render(FeaturePage, { props: { feature, rest: '' }, context: ctx.context });
		expect(await screen.findByTestId('stub')).toBeTruthy();
	});

	it('says the feature is switched off, with a link to Settings -> Features, and renders nothing of it', async () => {
		ctx.session.features.set({ list: [{ id: FLASHCARDS_ID, enabled: false }], status: 'ready' });
		render(FeaturePage, { props: { feature, rest: 'deck/general' }, context: ctx.context });
		expect(screen.getByRole('heading', { name: 'Flashcards are switched off' })).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Settings → Features' });
		expect(link.getAttribute('href')).toBe('/settings?tab=features');
		expect(screen.queryByTestId('stub')).toBeNull();
		// a notice, not an action: no primary button competes with the sentence
		expect(primaryActions(document.body)).toHaveLength(0);
	});

	it('the notice is muted text with a recognisable text link (#106)', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/\.notice\s*\{[^}]*color:\s*var\(--readable-muted\)/);
		expect(css).toMatch(/\.notice a\s*\{[^}]*text-decoration:\s*underline/);
	});

	it('another feature switched off does not hide this one', async () => {
		ctx.session.features.set({ list: [{ id: READER_ID, enabled: false }], status: 'ready' });
		render(FeaturePage, { props: { feature, rest: '' }, context: ctx.context });
		expect(await screen.findByTestId('stub')).toBeTruthy();
	});

	it('waits for the states, and says so when they fail to load', async () => {
		ctx.session.features.set({ list: [], status: 'loading' });
		const { unmount } = render(FeaturePage, { props: { feature, rest: '' }, context: ctx.context });
		expect(screen.getByText('Loading…')).toBeTruthy();
		expect(screen.queryByTestId('stub')).toBeNull();
		unmount();
		ctx.session.features.set({ list: [], status: 'error' });
		render(FeaturePage, { props: { feature, rest: '' }, context: ctx.context });
		expect(screen.getByRole('alert').textContent).toContain('Could not load your settings');
	});
});
