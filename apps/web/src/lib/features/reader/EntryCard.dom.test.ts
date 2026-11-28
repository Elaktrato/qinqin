import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import source from './EntryCard.svelte?raw';
import EntryCard from './EntryCard.svelte';
import { testContext, updateWorkspaces } from '$lib/testing/context';
import type { Workspace } from '$lib/api/types';

function sense(dictionaryId: number, gloss: string) {
	return { dictionaryId, dictionaryName: `d${dictionaryId}`, pos: [], tags: [], glosses: [gloss], xrefs: [] };
}

const result = {
	entryId: 5,
	kind: 'word',
	term: '你好',
	reading: 'nǐ hǎo',
	forms: [],
	readings: [],
	matched: '你好',
	start: 0,
	end: 2,
	reasons: [],
	tags: [],
	frequencies: [],
	levels: [],
	senses: [sense(1, 'hello'), sense(2, 'greeting')],
	pri: 0
} as unknown as LookupResult;

afterEach(cleanup);

describe('EntryCard hidden dictionaries', () => {
	it('hides senses of hidden dictionaries until revealed by button', async () => {
		render(EntryCard, { result, lang: 'zh', textLang: 'zh', hidden: new Set([2]) });
		expect(screen.queryByText(/greeting/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Show 1 from hidden dictionaries' }));
		expect(screen.getByText(/greeting/)).toBeTruthy();
	});

	it('shows senses with a note when every dictionary is hidden', () => {
		render(EntryCard, { result, lang: 'zh', textLang: 'zh', hidden: new Set([1, 2]) });
		expect(screen.getByText(/hello/)).toBeTruthy();
		expect(screen.getByText('Shown although its dictionaries are hidden in this workspace')).toBeTruthy();
	});

	it('shows everything by default', () => {
		render(EntryCard, { result, lang: 'zh', textLang: 'zh' });
		expect(screen.getByText(/greeting/)).toBeTruthy();
	});
});

describe('EntryCard in the lighter style (#102)', () => {
	const rich = {
		...result,
		levels: [{ scheme: 'HSK', level: '3' }],
		frequencies: [{ packId: 1, packName: 'SUBTLEX', rank: 1200 }]
	} as unknown as LookupResult;

	it('shows the term, the reading in the accent class, level chips before frequency chips, numbered glosses and the source line', () => {
		const { container } = render(EntryCard, { result: rich, lang: 'zh', textLang: 'zh-Hans' });
		const term = container.querySelector('.term')!;
		expect(term.textContent?.trim()).toBe('你好');
		expect(term.getAttribute('lang')).toBe('zh-Hans');
		expect(container.querySelector('.reading')?.classList.contains('accent')).toBe(true);
		const chips = [...container.querySelectorAll('.chips > li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
		expect(chips[0]).toBe('HSK 3');
		expect(chips[1]).toContain('1,200');
		expect(container.querySelectorAll('.chips .ui-chip, .chips .chip').length).toBeGreaterThan(0);
		expect(container.querySelector('ol.senses')).toBeTruthy();
		expect(container.querySelectorAll('ol.senses > li')).toHaveLength(2);
		expect(container.querySelector('.source')?.textContent).toContain('d1, d2');
	});

	it('the source line comes after the glosses', () => {
		const { container } = render(EntryCard, { result: rich, lang: 'zh', textLang: 'zh-Hans' });
		const senses = container.querySelector('ol.senses')!;
		const source = container.querySelector('.source')!;
		expect(senses.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('EntryCard Japanese word (#102)', () => {
	it('shows the reading as ruby in the reading accent and weight 500', () => {
		const word = { ...result, term: '食べる', reading: 'たべる', readings: [], levels: [] } as unknown as LookupResult;
		const { container } = render(EntryCard, { result: word, lang: 'ja', textLang: 'ja' });
		const rt = container.querySelector('rt')!;
		expect(rt.textContent).toBe('たべる');
		// A Japanese word has no separate reading line: the ruby is the reading.
		expect(container.querySelector('.reading')).toBeNull();
		const style = source.slice(source.indexOf('<style>'));
		expect(style).toMatch(/rt\s*\{[^}]*color:\s*var\(--reading-accent\)/);
		expect(style).toMatch(/rt\s*\{[^}]*font-weight:\s*var\(--weight-medium\)/);
	});
});

describe('EntryCard and hidden romanisation (#284)', () => {
	function withWorkspace(language: string, settings: Record<string, unknown>) {
		const ctx = testContext();
		const ws: Workspace = { id: 4, language, name: '', settings, updatedAt: 't' };
		updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
		return ctx.context;
	}

	it('shows no pinyin in the popup while pinyin is hidden', () => {
		const { container } = render(EntryCard, {
			props: { result, lang: 'zh', textLang: 'zh' },
			context: withWorkspace('zh', { romanisation: { pinyin: 'never' } })
		});
		expect(container.querySelector('.reading')).toBeNull();
		expect(container.textContent).not.toContain('nǐ hǎo');
		expect(screen.getByText(/hello/)).toBeTruthy();
	});

	it('shows the pinyin when the switch is Always', () => {
		const { container } = render(EntryCard, { props: { result, lang: 'zh', textLang: 'zh' }, context: withWorkspace('zh', {}) });
		expect(container.querySelector('.reading')?.textContent).toBe('nǐ hǎo');
	});
});

// #345: 鸡's slang gloss is listed last and only after "Show 1 more sense", marked.
describe('EntryCard folds slang and vulgar senses', () => {
	const ji = {
		...result,
		term: '鸡',
		senses: [
			{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', pos: [], tags: [], glosses: ['fowl', 'chicken', '(slang) prostitute'], xrefs: [] },
			{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', pos: [], tags: [], glosses: ['variant of 雞|鸡[ji1]'], xrefs: [] }
		]
	} as unknown as LookupResult;

	it('shows the everyday senses first and the slang one behind the button', async () => {
		const { container } = render(EntryCard, { result: ji, lang: 'zh', textLang: 'zh' });
		const items = () => [...container.querySelectorAll('ol.senses > li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
		expect(items()).toEqual(['fowl; chicken', 'variant of 雞|鸡[ji1]']);
		await fireEvent.click(screen.getByRole('button', { name: 'Show 1 more sense' }));
		expect(items()).toEqual(['fowl; chicken', 'variant of 雞|鸡[ji1]', 'vulgar (slang) prostitute']);
	});
});
