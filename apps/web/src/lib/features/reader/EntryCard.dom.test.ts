import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import EntryCard from './EntryCard.svelte';

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
