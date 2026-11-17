import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '$lib/app';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { PHONE_MAX_WIDTH, PHONE_MEDIA_QUERY, FRAME_PHONE_BREAKPOINT } from './breakpoint';
import { phoneTitle } from './pageFrame.svelte';
import { currentSection, frameSections } from './sections';
import layout from '../../routes/+layout.svelte?raw';

const sections = frameSections({ list: [{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 }], status: 'ready' });
const at = (path: string, override: string | null = null) =>
	phoneTitle(override, currentSection(path, sections), sections, path);

describe('phoneTitle', () => {
	it('is the section label by path, Home on / only', () => {
		expect(at('/')).toBe('Home');
		expect(at('/study/session')).toBe('Decks');
		expect(at('/stats/week')).toBe('Stats');
		expect(at('/entry/4')).toBe('Search');
	});

	it('pages of no section get their own title, not Home', () => {
		expect(at('/settings')).toBe('Settings');
		expect(at('/settings/')).toBe('Settings');
		expect(at('/sources')).toBe('Sources');
		expect(at('/account/password')).toBe('Choose a new password');
		expect(at('/account/two-factor-setup')).toBe('Set up two-step sign-in');
		expect(at('/reset')).toBe('Reset password');
		// An unknown path (the not-found page) is not Home either.
		expect(at('/nowhere')).toBe(APP_NAME);
	});

	it('every route in the route tree has a title of its own; only / says Home', () => {
		const routes = resolve(__dirname, '../../routes');
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
				d.isDirectory() ? walk(join(dir, d.name)) : d.name === '+page.svelte' ? [dir] : []
			);
		const everything = frameSections({
			list: [
				{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 },
				{ id: READER_ID, manifest: {}, enabled: true, order: 0 },
				{ id: 'qinqin-journal', manifest: {}, enabled: true, order: 0 }
			],
			status: 'ready'
		});
		const paths = walk(routes).map(
			(dir) =>
				'/' +
				relative(routes, dir)
					.replace('[plugin]', 'journal')
					.replace(/\[\.\.\.\w+\]/g, 'x')
					.replace(/\[\w+\]/g, '1')
		);
		expect(paths.length).toBeGreaterThanOrEqual(19);
		for (const path of paths.map((p) => (p === '/' ? p : p.replace(/\/$/, '')))) {
			const title = phoneTitle(null, currentSection(path, everything), everything, path);
			if (path === '/') expect(title).toBe('Home');
			else {
				expect(title, path).not.toBe('Home');
				expect(title, path).not.toBe(APP_NAME);
			}
		}
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
