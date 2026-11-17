import { describe, expect, it } from 'vitest';
import { FLASHCARDS_ID } from '$lib/features';
import { PHONE_MAX_WIDTH, PHONE_MEDIA_QUERY, FRAME_PHONE_BREAKPOINT } from './breakpoint';
import { phoneTitle } from './pageFrame.svelte';
import { currentSection, frameSections } from './sections';
import layout from '../../routes/+layout.svelte?raw';

const sections = frameSections({ list: [{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 }], status: 'ready' });
const at = (path: string, override: string | null = null) => phoneTitle(override, currentSection(path, sections), sections);

describe('phoneTitle', () => {
	it('is the section label by path, Home on / and on pages of no section', () => {
		expect(at('/')).toBe('Home');
		expect(at('/study/session')).toBe('Decks');
		expect(at('/stats/week')).toBe('Stats');
		expect(at('/entry/4')).toBe('Search');
		expect(at('/settings')).toBe('Home');
	});

	it('an override a page sets wins', () => {
		expect(at('/entry/4', '学习')).toBe('学习');
		expect(at('/entry/4', '')).toBe('Search');
	});
});

describe('the phone breakpoint', () => {
	it('is 720px: phone below, desktop at and above', () => {
		expect(FRAME_PHONE_BREAKPOINT).toBe(720);
		expect(PHONE_MAX_WIDTH).toBe(719.98);
		expect(PHONE_MEDIA_QUERY).toBe('(max-width: 719.98px)');
	});

	it('is the width the layout switches the bars at', () => {
		expect(layout).toContain(`@media ${PHONE_MEDIA_QUERY}`);
	});
});
