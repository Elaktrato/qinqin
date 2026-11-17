import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Avatar from './Avatar.svelte';

const initial = (name: string) => {
	const { container } = render(Avatar, { name });
	return container.querySelector('.avatar')?.textContent;
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('Avatar', () => {
	it('is the first letter, upper-cased; ? for an empty name', () => {
		expect(initial('mei')).toBe('M');
		expect(initial('  li')).toBe('L');
		expect(initial('')).toBe('?');
		expect(initial('学习')).toBe('学');
	});

	it('takes a whole grapheme: combining marks, flags, ZWJ emoji', () => {
		expect(initial('émile')).toBe('É');
		expect(initial('\u{1F1EF}\u{1F1F5}tokyo')).toBe('\u{1F1EF}\u{1F1F5}');
		expect(initial('\u{1F469}‍\u{1F4BB}dev')).toBe('\u{1F469}‍\u{1F4BB}');
		expect(initial('\u{1F44B}\u{1F3FD}hi')).toBe('\u{1F44B}\u{1F3FD}');
	});

	it('keeps a letter whose upper case is longer (ß stays ß, not SS)', () => {
		expect(initial('ßtraße')).toBe('ß');
		expect(initial('ǉubica')).toBe('Ǉ');
	});

	it('falls back to code points without Intl.Segmenter', () => {
		vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
		expect(initial('mei')).toBe('M');
		expect(initial('ßa')).toBe('ß');
	});
});
