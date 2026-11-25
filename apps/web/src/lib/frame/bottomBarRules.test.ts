// The bottom bar's layout rules (#188; this replaces the old noBottomBar
// guard of #99): one --bottom-bar-height token, the page's bottom padding and
// scroll padding only while the bar shows and only on the phone frame, fixed
// toasts kept clear of it, and nothing of it at 720px and wider.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHONE_MEDIA_QUERY } from './breakpoint';

const src = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(src, path), 'utf8');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.(svelte|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

/** The bodies of every `@media <query> { … }` block in a stylesheet (braces matched). */
function mediaBlocks(css: string, query: string): string[] {
	const out: string[] = [];
	let at = css.indexOf(`@media ${query}`);
	while (at >= 0) {
		const open = css.indexOf('{', at);
		let depth = 0;
		let end = open;
		for (; end < css.length; end++) {
			if (css[end] === '{') depth++;
			else if (css[end] === '}' && --depth === 0) break;
		}
		out.push(css.slice(open + 1, end));
		at = css.indexOf(`@media ${query}`, end);
	}
	return out;
}

/** The stylesheet with every phone media block taken out: what desktop and tablet see. */
function outsidePhone(css: string): string {
	let rest = css;
	for (const block of mediaBlocks(css, PHONE_MEDIA_QUERY)) rest = rest.replace(block, '');
	return rest;
}

const appCss = read('app.css');
const layout = read('routes/+layout.svelte');
const layoutCss = layout.slice(layout.indexOf('<style>'));

describe('the bottom bar token', () => {
	it('--bottom-bar-height is defined once, in app.css; --bottom-bar-space is 0 unless the bar shows', () => {
		const defined = files(src).filter((path) => /--bottom-bar-height\s*:/.test(readFileSync(path, 'utf8')));
		expect(defined.map((path) => path.slice(src.length + 1))).toEqual(['app.css']);
		expect(outsidePhone(appCss)).toMatch(/--bottom-bar-space:\s*0px;/);
		const phone = mediaBlocks(appCss, PHONE_MEDIA_QUERY).join('\n');
		expect(phone).toMatch(
			/:root\[data-bottom-bar\]:not\(\[data-keyboard\]\)\s*\{[^}]*--bottom-bar-space:\s*calc\(var\(--bottom-bar-height\) \+ env\(safe-area-inset-bottom, 0px\)\)/
		);
	});
});

describe('pages keep clear of the bar (phone frame, bar showing)', () => {
	it('scroll-padding-bottom is set once: on :root[data-bottom-bar] inside the phone media query', () => {
		const hits = files(src).filter((path) => /scroll-padding-bottom/.test(readFileSync(path, 'utf8')));
		expect(hits.map((path) => path.slice(src.length + 1))).toEqual(['app.css']);
		expect(outsidePhone(appCss)).not.toContain('scroll-padding-bottom');
		expect(mediaBlocks(appCss, PHONE_MEDIA_QUERY).join('\n')).toMatch(
			/:root\[data-bottom-bar\]:not\(\[data-keyboard\]\)\s*\{[^}]*scroll-padding-bottom:\s*var\(--bottom-bar-space\)/
		);
	});

	it('the page panel gets the bar space as bottom padding, on the phone frame only', () => {
		const phone = mediaBlocks(layoutCss, PHONE_MEDIA_QUERY).join('\n');
		expect(phone).toMatch(/\.framed \.panel\s*\{\s*padding-bottom:\s*var\(--bottom-bar-space\);/);
		expect(outsidePhone(layoutCss)).not.toContain('bottom-bar');
	});

	it('the root layout sets data-bottom-bar from whether the bar shows', () => {
		expect(layout).toContain("document.documentElement.toggleAttribute('data-bottom-bar', bottomBar)");
	});

	it('fixed toasts at the bottom of a page rise above the bar', () => {
		for (const path of ['lib/features/flashcards/decks/CardManager.svelte', 'routes/study/scheduling/+page.svelte']) {
			expect(read(path)).toContain('max(var(--bottom-bar-space, 0px), env(safe-area-inset-bottom, 0px))');
		}
	});
});

describe('desktop and tablet (720px and up) do not change', () => {
	it('the bar renders only inside the phone-only wrapper, which is display: none outside the phone frame', () => {
		expect(layout).toMatch(/<div class="phone" data-frame="phone-nav">\s*<BottomBar /);
		expect(outsidePhone(layoutCss)).toMatch(/\.phone\s*\{\s*display:\s*none;\s*\}/);
		expect(mediaBlocks(layoutCss, PHONE_MEDIA_QUERY).join('\n')).toMatch(/\.phone\s*\{\s*display:\s*block;\s*\}/);
	});

	it('the desktop top bar takes no navigation mode (TopBar has no mode prop)', () => {
		expect(layout).toContain('<TopBar {sections} {current} />');
		expect(read('lib/frame/TopBar.svelte')).not.toMatch(/mode|navLayout/);
	});

	it('the safe-area padding of the frame is env() only (0 on desktop browsers)', () => {
		expect(layoutCss).toContain(
			'padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);'
		);
	});
});
