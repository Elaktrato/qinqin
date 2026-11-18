// The sentence-case check (#106): label-like catalogue values are sentence case; proper names are allowed by a
// reviewed list; the English value changes, never the key. The ratchet (sentenceCasePending.json) may only shrink:
// a listed key that is clean now fails.
import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import names from './sentenceCaseNames.json';
import pending from './sentenceCasePending.json';
import { isLabelKey, sentenceCaseFindings } from './sentenceCase';

const catalogue = (value: string): Record<string, string> => ({ 'example.title': value });
const finds = (value: string): boolean => sentenceCaseFindings(catalogue(value)).length > 0;

describe('sentence case for label-like values', () => {
	it('accepts sentence case and rejects a capitalised inner word', () => {
		expect(finds('Add deck')).toBe(false);
		expect(finds('Add Deck')).toBe(true);
		expect(finds('Create account')).toBe(false);
		expect(finds('Send reset link')).toBe(false);
	});

	it('accepts proper names from the reviewed list', () => {
		expect(finds('Catppuccin Latte')).toBe(false);
		expect(finds('HSK level')).toBe(false);
		expect(finds('AI provider')).toBe(false);
		expect(finds('Add Deck to HSK')).toBe(true);
	});

	it('accepts a capital after a colon, a full stop or an arrow', () => {
		expect(finds('Settings → Features')).toBe(false);
		expect(finds('Your data: Everything in one file')).toBe(false);
		expect(finds('No packs. Upload one above.')).toBe(false);
	});

	it('rejects an all-caps value unless every word is a proper name', () => {
		expect(finds('ADD DECK')).toBe(true);
		expect(finds('AI')).toBe(false);
		expect(finds('AI API')).toBe(false);
	});

	it('scans the label-like namespaces only', () => {
		for (const key of ['a.title', 'a.label', 'a.heading', 'a.action.save', 'a.tabs.one', 'a.col.name', 'a.submit']) {
			expect(isLabelKey(key), key).toBe(true);
		}
		for (const key of ['a.hint', 'a.failed', 'auth.signIn.failed', 'settings.plugins.hint']) {
			expect(isLabelKey(key), key).toBe(false);
		}
		expect(sentenceCaseFindings({ 'auth.signIn.failed': 'Add Deck' })).toEqual([]);
	});
});

describe('the catalogue walk', () => {
	it('every label-like value is sentence case, outside the (empty) pending list', () => {
		const findings = sentenceCaseFindings(en as Record<string, string>);
		const bad = findings
			.filter((finding) => !(pending as string[]).includes(finding.key))
			.map((finding) => `${finding.key}: ${finding.value} (${finding.word})`);
		expect(bad).toEqual([]);
	});

	it('the pending list only shrinks: no clean key stays listed', () => {
		const keys = new Set(sentenceCaseFindings(en as Record<string, string>).map((finding) => finding.key));
		const stale = (pending as string[]).filter((key) => !keys.has(key));
		expect(stale, 'clean now: remove from sentenceCasePending.json').toEqual([]);
		expect([...(pending as string[])].sort()).toEqual(pending as string[]);
		expect(pending as string[]).toHaveLength(0);
	});

	it('the names list is reviewed: no duplicates, no blanks', () => {
		const list = names as string[];
		expect(list.length).toBeGreaterThan(20);
		expect(new Set(list).size).toBe(list.length);
		for (const name of list) expect(name.trim()).toBe(name);
		expect(list.every((name) => name.length > 0)).toBe(true);
	});
});
