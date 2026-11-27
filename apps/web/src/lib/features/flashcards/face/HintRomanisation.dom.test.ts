import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Workspace } from '$lib/api/types';
import type { FlowItem } from '../session/cardFlow';
import { testContext, updateWorkspaces } from '$lib/testing/context';
import { readRomanisation } from '$lib/languages/romanisation';
import { hintsForEntry, readHintSettings, resolveHints } from './hints';
import type { CardHints } from './cardHints.svelte';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from '../cards/VocabCard.svelte';
import ReverseCard from '../cards/ReverseCard.svelte';
import CardHarness from './testing/CardHarness.svelte';

// Hidden romanisation on flashcards (#284, owner decision): the reading hint uses kana (or the readings that show),
// the romanisation is the last hint step and counts as a hint; neither face shows it unasked.
const entry = {
	id: 1,
	language: 'ja',
	kind: 'word',
	written: '猫',
	readings: [
		{ type: 'kana', value: 'ねこ', plain: 'ねこ', ord: 0 },
		{ type: 'romaji', value: 'neko', plain: 'neko', ord: 1 }
	],
	badges: [],
	variants: [],
	sentences: [],
	senses: [{ dictionaryId: 1, dictionaryName: 'JMdict', packId: 'j', license: 'x', attribution: 'x', gloss: 'cat', glosses: ['cat'] }],
	senseGroups: []
} as unknown as Entry;
const settings = { romanisation: { romaji: 'never' } };

afterEach(cleanup);

function setup(card: typeof VocabCard | typeof ReverseCard, kind: 'vocab' | 'reverse', done = false) {
	const ctx = testContext();
	const ws: Workspace = { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	const plan = resolveHints({
		cardKind: kind,
		settings: readHintSettings(settings),
		entry: hintsForEntry(entry, { romanisation: readRomanisation(settings) })
	});
	const holder: { hints: CardHints | null } = { hints: null };
	const item: FlowItem = { cardId: `c-${kind}-1`, kind, entryId: 1, virtual: false, card: null };
	const view = render(CardHarness, {
		props: {
			card,
			cardProps: kind === 'vocab' ? { item, entry, revealed: done, onDone: vi.fn() } : { item, entry, done, onDone: vi.fn() },
			hintPlan: plan,
			done,
			onhints: (hints: CardHints) => (holder.hints = hints)
		},
		context: ctx.context
	});
	return { view, holder, plan };
}

describe('flashcards with romaji hidden (#284)', () => {
	it('plans kana first and the romaji as the last hint', () => {
		expect(setup(VocabCard, 'vocab').plan).toEqual({ always: [], onRequest: ['reading', 'romanisation'] });
	});

	it('the first hint shows the kana only, the second the romaji, and both count', async () => {
		const { view, holder } = setup(VocabCard, 'vocab');
		expect(view.container.textContent).not.toContain('neko');
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		expect(screen.getByText('ねこ')).toBeTruthy();
		expect(view.container.textContent).not.toContain('neko');
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		expect(view.container.querySelector('[data-hint="romanisation"]')?.textContent).toContain('neko');
		expect(screen.getByTestId('hint-note').textContent).toBe('Hint shown: the romanisation.');
		expect(holder.hints?.used).toBe(2);
	});

	it('the answer of a vocab card shows the kana and no romaji', () => {
		const { view } = setup(VocabCard, 'vocab', true);
		const table = screen.getByRole('table', { name: 'Readings' });
		expect(table.textContent).toContain('ねこ');
		expect(view.container.textContent).not.toContain('neko');
	});

	it('the answer of a reverse card shows no romaji', () => {
		const { view } = setup(ReverseCard, 'reverse', true);
		expect(view.container.textContent).not.toContain('neko');
	});
});
