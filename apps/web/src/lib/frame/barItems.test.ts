import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { barHiddenOn, barItems, MORE } from './barItems';
import { DEFAULT_BAR } from './navLayout';
import type { FrameSection } from './sections';

// docs/contracts/settings/nav-layout.json, `items`: (visible sections, bar) → the bar.
const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/settings/nav-layout.json'), 'utf8')
) as {
	items: {
		name: string;
		visible: string[];
		bar: string[] | null;
		current: string | null;
		expect: { items: string[]; more: string[]; current: string | null };
	}[];
};

function section(id: string): FrameSection {
	return { id, label: id, href: `/${id}`, icon: 'plugin', match: [`/${id}`] };
}

function ids(visible: string[], bar: readonly string[], current: string | null) {
	const result = barItems(visible.map(section), bar, current);
	return {
		items: result.items.map((item) => (item === MORE ? 'more' : item.id)),
		more: result.more.map((s) => s.id),
		current: result.current
	};
}

describe('barItems: the contract cases', () => {
	it.each(fixture.items.map((c) => [c.name, c] as const))('%s', (_, c) => {
		expect(ids(c.visible, c.bar ?? DEFAULT_BAR, c.current)).toEqual(c.expect);
	});
});

describe('barItems: rules', () => {
	const all = ['home', 'search', 'flashcards', 'reader', 'journal', 'grammar', 'cards-plus', 'stats'];

	it('never more than five items, and More only when the sections do not fit', () => {
		for (let n = 1; n <= all.length; n++) {
			const visible = all.slice(0, n);
			for (const bar of [DEFAULT_BAR, [], [...visible].reverse(), ['stats', 'home', 'stats']]) {
				const r = ids(visible, bar, null);
				expect(r.items.length).toBeLessThanOrEqual(5);
				expect(r.items.includes('more')).toBe(n > 5);
				if (n > 5) expect(r.items.at(-1)).toBe('more');
				// Every visible section is reachable exactly once: in the bar or under More.
				const reach = [...r.items.filter((id) => id !== 'more'), ...r.more];
				expect([...reach].sort()).toEqual([...visible].sort());
			}
		}
	});

	it('when everything fits, all are shown: pins first in their order, the rest in frame order', () => {
		expect(ids(['home', 'search', 'reader', 'stats'], ['stats', 'reader'], null).items).toEqual([
			'stats',
			'reader',
			'home',
			'search'
		]);
	});

	it('a section is current only where it is; More for one of its rows; none for other pages', () => {
		const visible = all.slice(0, 7);
		expect(ids(visible, DEFAULT_BAR, 'search').current).toBe('search');
		expect(ids(visible, DEFAULT_BAR, 'journal').current).toBe('more');
		expect(ids(visible, DEFAULT_BAR, null).current).toBeNull();
		// A current id that is not visible (a stale path) marks nothing.
		expect(ids(visible, DEFAULT_BAR, 'stats-of-a-removed-plugin').current).toBeNull();
	});

	it('keeps the section objects (label, href, icon) for rendering', () => {
		const visible = ['home', 'search', 'reader'].map(section);
		const r = barItems(visible, DEFAULT_BAR, 'home');
		expect(r.items[0]).toBe(visible[0]);
	});
});

describe('barHiddenOn', () => {
	it('hides the bar in the study session and the course lesson player, not on the roadmap (#222)', () => {
		expect(barHiddenOn('/study/session')).toBe(true);
		expect(barHiddenOn('/courses/play/zh-course/hello/words-1')).toBe(true);
		expect(barHiddenOn('/courses')).toBe(false);
		expect(barHiddenOn('/courses/zh-course')).toBe(false);
		expect(barHiddenOn('/courses/player')).toBe(false);
	});
});
