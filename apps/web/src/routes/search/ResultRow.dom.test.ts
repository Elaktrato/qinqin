import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { SearchHit } from '$lib/api/types';
import ResultRow from './ResultRow.svelte';
import source from './ResultRow.svelte?raw';

const hit: SearchHit = {
	id: 7,
	language: 'zh',
	kind: 'word',
	written: '勤奋',
	readings: [{ type: 'pinyin', value: 'qínfèn', plain: 'qin2fen4', ord: 0 }],
	attrs: {},
	radicalId: null,
	source: 'written',
	glosses: [{ dictionaryId: 1, gloss: 'diligent; industrious' }],
	levels: [{ scheme: 'HSK', level: '5' }]
};

afterEach(cleanup);

describe('ResultRow (#104)', () => {
	it('is one link named by the word with reading, gloss and kind as its description', () => {
		render(ResultRow, { hit, href: '/search?q=qin&e=7', selected: false, hidden: new Set() });
		const link = screen.getByRole('link', { name: '勤奋' });
		const description = link.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ');
		expect(description).toContain('qínfèn');
		expect(description).toContain('diligent; industrious');
		expect(description).toContain('Word · HSK 5');
	});

	it('carries the study lang on the word and the reading lang on the reading', () => {
		render(ResultRow, { hit, href: '/search?e=7', selected: false, hidden: new Set() });
		expect(screen.getByRole('link').querySelector('.word')?.getAttribute('lang')).toBe('zh-Hans');
		expect(screen.getByRole('link').querySelector('.reading')?.getAttribute('lang')).toBe('zh-Latn-pinyin');
	});

	it('marks the selected row with aria-current', () => {
		render(ResultRow, { hit, href: '/search?e=7', selected: true, hidden: new Set() });
		expect(screen.getByRole('link').getAttribute('aria-current')).toBe('true');
	});

	it('hides a gloss whose dictionary is hidden', () => {
		render(ResultRow, { hit, href: '/search?e=7', selected: false, hidden: new Set([1]) });
		expect(document.querySelector('.gloss')?.textContent).toBe('');
	});

	it('uses the reading accent, the selected wash and an accent start bar', () => {
		const style = source.slice(source.indexOf('<style'));
		expect(style).toMatch(/\.reading\s*\{[^}]*color:\s*var\(--reading-accent\)/);
		expect(style).toMatch(/\.row\.selected\s*\{[^}]*background:\s*var\(--selected-wash\)/);
		expect(style).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--accent\)/);
		expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
	});
});
