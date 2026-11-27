import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Sentence } from '$lib/api/types';
import type { FlowItem } from '../session/cardFlow';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from './VocabCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';

// The card renders inside the study face (#101): the harness provides it.
function renderCard(props: Record<string, unknown>) {
	return render(CardHarness, { card: VocabCard, cardProps: props });
}

function kanji(over: Partial<Entry> = {}): Entry {
	return {
		id: 11,
		language: 'ja',
		kind: 'character',
		written: '学',
		readings: [
			{ type: 'on', value: 'ガク', plain: 'gaku', ord: 0 },
			{ type: 'kun', value: 'まな.ぶ', plain: 'manabu', ord: 1 }
		],
		badges: [],
		variants: [],
		sentences: [
			{ id: 1, entryId: 11, sourcePack: 'p', userId: null, hanzi: '学校', pinyin: '', translation: '' }
		],
		senses: [
			{
				dictionaryId: 1,
				dictionaryName: 'KANJIDIC',
				packId: 'k',
				license: 'x',
				attribution: 'x',
				gloss: 'study'
			}
		],
		...over
	} as Entry;
}

const item: FlowItem = { cardId: 'level:11', kind: 'vocab', entryId: 11, virtual: true, card: null };

afterEach(cleanup);

describe('VocabCard for a character', () => {
	it('shows only the glyph before the reveal', () => {
		renderCard({ item, entry: kanji(), revealed: false, onDone: vi.fn() });
		expect(screen.getByText('学')).toBeTruthy();
		expect(screen.queryByLabelText('Readings')).toBeNull();
		expect(screen.queryByText('学校')).toBeNull();
		expect(screen.queryByText('study')).toBeNull();
	});

	it('shows readings and meanings after the reveal', () => {
		renderCard({ item, entry: kanji(), revealed: true, onDone: vi.fn() });
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.getByText('study')).toBeTruthy();
	});

	it('names each reading kind once and joins its readings with " | "', () => {
		const entry = kanji({
			readings: [
				{ type: 'on', value: 'ガク', plain: 'gaku', ord: 0 },
				{ type: 'kun', value: 'まな.ぶ', plain: 'manabu', ord: 1 },
				{ type: 'on', value: 'ガッ', plain: 'ga', ord: 2 }
			]
		});
		renderCard({ item, entry, revealed: true, onDone: vi.fn() });
		const table = screen.getByRole('table', { name: 'Readings' });
		expect(table.textContent).not.toContain('On:');
		expect([...table.querySelectorAll('tr')].map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'On ガク | ガッ',
			'Kun まな.ぶ'
		]);
	});

	it('shows readings only, without an empty gloss block, for a character with no senses', () => {
		renderCard({ item, entry: kanji({ senses: [] }), revealed: true, onDone: vi.fn() });
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.queryByText(/No glosses/)).toBeNull();
		expect(document.querySelector('.dictionary')).toBeNull();
	});

	it('shows only the word before the reveal and its reading in the answer', () => {
		const word = kanji({
			kind: 'word',
			written: '学校',
			readings: [{ type: 'pinyin', value: 'xuéxiào', plain: 'xue2xiao4', ord: 0 }],
			sentences: []
		});
		renderCard({ item, entry: word, revealed: false, onDone: vi.fn() });
		expect(document.querySelector('.face-prompt')?.textContent?.trim()).toBe('学校');
		expect(screen.queryByText('xuéxiào')).toBeNull();
	});

	it('shows a word’s reading and example sentence in the answer', () => {
		const word = kanji({
			kind: 'word',
			written: '学校',
			readings: [{ type: 'pinyin', value: 'xuéxiào', plain: 'xue2xiao4', ord: 0 }],
			senses: []
		});
		renderCard({ item, entry: word, revealed: true, onDone: vi.fn() });
		const answer = document.querySelector('.face-answer')!;
		expect(answer.textContent).toContain('xuéxiào');
		expect(answer.querySelector('.sentence')?.textContent).toBe('____');
		expect(document.querySelector('.face-prompt')?.textContent?.trim()).toBe('学校');
	});

	it('keeps the no-glosses hint for a word with readings but no senses', () => {
		const word = kanji({
			kind: 'word',
			written: '学校',
			senses: [],
			sentences: []
		});
		renderCard({ item, entry: word, revealed: true, onDone: vi.fn() });
		expect(screen.getByText(/No glosses for this word yet/)).toBeTruthy();
	});
});

describe('VocabCard on the open page (#101)', () => {
	it('registers Show answer as the primary before the reveal', async () => {
		const onDone = vi.fn();
		renderCard({ item, entry: kanji(), revealed: false, onDone });
		const button = screen.getByRole('button', { name: 'Show answer' });
		expect(button.closest('.dock')).not.toBeNull();
		expect(button.classList.contains('primary')).toBe(true);
		button.click();
		expect(onDone).toHaveBeenCalledWith({ suggested: null, meta: {} });
	});

	it('the prompt holds the word; the answer sits below the hairline', () => {
		renderCard({ item, entry: kanji(), revealed: true, onDone: vi.fn() });
		expect(document.querySelector('.face-prompt .fp-word')?.textContent).toBe('学');
		expect(document.querySelector('.face-answer')?.textContent).toContain('study');
		expect(document.querySelector('.dock button')).toBeNull();
	});
});

const aiSentence = (ai: Sentence['ai']): Sentence => ({ id: 9, entryId: 1, sourcePack: '', userId: 1, hanzi: '我喜欢学习。', pinyin: '', translation: 't', ai });
const aiEntry = (s: Sentence): Entry =>
	({ id: 1, language: 'zh', kind: 'word', written: '学习', readings: [], senses: [], senseGroups: [], variants: [], sentences: [s], badges: [] }) as unknown as Entry;
const aiItem: FlowItem = { cardId: 'level:1', kind: 'vocab', entryId: 1, virtual: true, card: null };

function setupAi(s: Sentence) {
	render(CardHarness, { card: VocabCard, cardProps: { item: aiItem, entry: aiEntry(s), revealed: true, onDone: vi.fn() }, kindLabel: 'Recognise', done: true });
}

describe('VocabCard and an AI example (#186)', () => {
	it('marks the answer side sentence an AI wrote, and no other', () => {
		setupAi(aiSentence({ provider: 'anthropic', model: 'm' }));
		expect(document.querySelector('.sentence')?.textContent).toMatch(/^我喜欢.+。$/);
		expect(screen.getByText('AI-written')).toBeTruthy();
		cleanup();
		setupAi(aiSentence(null));
		expect(screen.queryByText('AI-written')).toBeNull();
	});
});
