import { testContext, type TestContext } from '$lib/testing/context';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import type { Entry, Workspace } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';
import type { StudyCard } from '$lib/study/types';
import CardManager from '$lib/components/CardManager.svelte';
import ToneCard from '$lib/features/flashcards/cards/ToneCard.svelte';
import CardHarness from '$lib/features/flashcards/face/testing/CardHarness.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

// Study text carries the study language, interface text the document's (spec "lang and dir attributes"): the
// closest [lang] of a written form is the workspace's; interface text has none of its own.

const src = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(src, rel), 'utf8');

function workspace(language: string): Workspace {
	return { id: 1, language, name: '', createdAt: 't' } as unknown as Workspace;
}

afterEach(() => {
	cleanup();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('CardManager (the lang="zh" bug)', () => {
	it('a Japanese workspace tags its words ja, and the interface text has no lang of its own', async () => {
		ctx.session.workspaces.set({ list: [workspace('ja')], current: workspace('ja') });
		const cards: StudyCard[] = [
			{ id: 'c-vocab-1', kind: 'vocab', entryId: 1, written: '食べる', deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' }
		];
		render(CardManager, { props: { workspaceId: 1, cards, decks: [], onchanged: async () => {} }, context: ctx.context });
		const word = screen.getByText('食べる');
		expect(word.closest('[lang]')?.getAttribute('lang')).toBe('ja');
		expect(screen.getByText(/Manage cards/).closest('[lang]')).toBeNull();
	});
});

describe('ToneCard', () => {
	const entry = {
		id: 1,
		language: 'zh',
		kind: 'word',
		written: '你好',
		readings: [{ type: 'pinyin', value: 'nǐ hǎo', plain: 'ni3hao3', ord: 0 }],
		attrs: {},
		radicalId: null
	} as unknown as Entry;
	const item = { cardId: 'c', entryId: 1, kind: 'tone', virtual: true } as unknown as FlowItem;

	it('follows a traditional-script workspace (zh-Hant), not a fixed zh', () => {
		ctx.session.workspaces.set({ list: [workspace('zh-Hant')], current: workspace('zh-Hant') });
		// A card renders inside the study face (#101).
		render(CardHarness, { props: { card: ToneCard, cardProps: { item, entry, done: false, onDone: () => {} } }, context: ctx.context });
		expect(screen.getByText('你好').closest('[lang]')?.getAttribute('lang')).toBe('zh-Hant');
	});

	it('a simplified workspace reads zh-Hans', () => {
		ctx.session.workspaces.set({ list: [workspace('zh')], current: workspace('zh') });
		// A card renders inside the study face (#101).
		render(CardHarness, { props: { card: ToneCard, cardProps: { item, entry, done: false, onDone: () => {} } }, context: ctx.context });
		expect(screen.getByText('你好').closest('[lang]')?.getAttribute('lang')).toBe('zh-Hans');
	});
});

// Every audited component of study text takes its `lang` from lib/i18n/lang.ts (no third source).
const AUDITED = [
	'lib/components/CardManager.svelte',
	'lib/features/flashcards/cards/ToneCard.svelte',
	'lib/features/flashcards/cards/VocabCard.svelte',
	'lib/features/flashcards/cards/ReverseCard.svelte',
	'lib/features/flashcards/cards/WritingCard.svelte',
	'lib/components/Readings.svelte',
	'lib/components/Senses.svelte',
	'lib/components/Sentences.svelte',
	'lib/components/ReadingText.svelte',
	'lib/entry/EntryView.svelte',
	'routes/stats/characters/+page.svelte',
	'lib/components/map/CellTip.svelte',
	'lib/features/flashcards/decks/DeckDetail.svelte',
	'lib/features/flashcards/decks/StarterDeckDetail.svelte',
	'lib/features/flashcards/decks/SystemDeckDetail.svelte',
	'routes/lookups/+page.svelte',
	'routes/search/ResultRow.svelte',
	'lib/features/reader/BookView.svelte',
	'lib/features/grammar/lessonData.ts'
];

describe('the audited components', () => {
	it.each(AUDITED)('%s uses studyLang/readingLang', (rel) => {
		expect(read(rel)).toMatch(/\b(studyLang|readingLang|glossLang)\(/);
	});
});

describe('the shell', () => {
	// The footer and its brand hanzi line went with the frame (#99); the bar's
	// logo links carry no lang (interface text).
	it('the bar brand links carry no lang (interface text)', () => {
		for (const file of ['routes/+layout.svelte', 'lib/frame/TopBar.svelte']) {
			const src = read(file);
			const brand = src.slice(src.indexOf('class="brand'), src.indexOf('>', src.indexOf('class="brand')));
			expect(brand, file).not.toMatch(/\slang=/);
			expect(src, file).not.toMatch(/\slang="(?!ts")/);
		}
	});
});
