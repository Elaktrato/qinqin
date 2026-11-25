import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryPicture } from '$lib/api/images';
import type { Entry, Workspace } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';
import type { HintPlan } from '$lib/study/hints';

const { entryPicture } = vi.hoisted(() => ({ entryPicture: vi.fn() }));
vi.mock('$lib/api/images', async (original) => ({ ...(await original<typeof import('$lib/api/images')>()), entryPicture }));
vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from '../cards/VocabCard.svelte';
import CardHarness from './testing/CardHarness.svelte';

const picture: EntryPicture = {
	packId: 'p',
	concept: 'c',
	label: 'cat',
	credit: 'OpenMoji',
	license: 'CC BY-SA 4.0',
	attribution: '',
	basis: 'gloss',
	sense: 0,
	score: 90,
	svg: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'
};
const entry = {
	id: 1,
	language: 'ja',
	kind: 'word',
	written: '猫',
	readings: [{ type: 'kana', value: 'ねこ', plain: 'neko', ord: 0 }],
	badges: [],
	variants: [],
	sentences: [],
	senses: [{ dictionaryId: 1, dictionaryName: 'JMdict', packId: 'j', license: 'x', attribution: 'x', gloss: 'cat' }]
} as unknown as Entry;
const item: FlowItem = { cardId: 'c-vocab-1', kind: 'vocab', entryId: 1, virtual: false, card: null };

let ctx: TestContext;
function setup(plan: HintPlan, revealed: boolean, settings: Record<string, unknown> = {}) {
	ctx = testContext();
	const ws: Workspace = { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(CardHarness, {
		context: ctx.context,
		props: {
			card: VocabCard,
			cardProps: { item, entry, revealed, onDone: vi.fn() },
			hintPlan: plan,
			done: revealed,
			onhints: () => {}
		}
	});
}

beforeEach(() => entryPicture.mockReset().mockResolvedValue(picture));
afterEach(cleanup);

describe('pictures on a card (#212)', () => {
	it('shows the picture on the answer when it was not shown as a hint', async () => {
		setup({ always: [], onRequest: [] }, true);
		await screen.findByTestId('entry-picture');
		expect(document.querySelectorAll('[data-testid="entry-picture"]')).toHaveLength(1);
	});

	it('shows no picture on the front without the hint, and the Picture hint reveals it', async () => {
		setup({ always: [], onRequest: ['picture'] }, false);
		expect(screen.queryByTestId('entry-picture')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		await screen.findByTestId('entry-picture');
		expect(document.querySelector('[data-hint="picture"]')).not.toBeNull();
	});

	it('does not repeat a picture the hint already shows when the answer opens', async () => {
		setup({ always: ['picture'], onRequest: [] }, true);
		await screen.findByTestId('entry-picture');
		await waitFor(() => expect(entryPicture).toHaveBeenCalled());
		expect(document.querySelectorAll('[data-testid="entry-picture"]')).toHaveLength(1);
	});

	it('still reveals the reading hint inside a session (the picture may arrive meanwhile)', async () => {
		setup({ always: [], onRequest: ['reading', 'picture'] }, false);
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		expect(await screen.findByText('ねこ')).toBeTruthy();
		expect(document.querySelector('[data-hint="picture"]')).toBeNull();
	});

	it('shows nothing when the Pictures aid is off', async () => {
		setup({ always: ['picture'], onRequest: [] }, true, { visualAids: { pictures: false } });
		await Promise.resolve();
		expect(screen.queryByTestId('entry-picture')).toBeNull();
		expect(entryPicture).not.toHaveBeenCalled();
	});
});
