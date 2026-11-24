import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import {
	DEFAULT_LAYOUT,
	LAYOUT_KEY,
	loadLayout,
	parseLayout,
	placeWidgets,
	resolveLayout,
	saveLayout,
	serializeLayout,
	homeEmptyReason
} from './layout';
import type { WidgetDef, WidgetSurface } from './types';
import { allWidgets } from './registry';
import { webPlugins } from '$lib/plugins';
import { coreFeatures } from '$lib/features';
import coreRowsFixture from '../../../../../docs/contracts/settings/core-rows.json';
import { dataRow } from '../testing/keyed';

const component = null as unknown as Component;

function widget(id: string, extra: Partial<WidgetDef> = {}): WidgetDef {
	return {
		id,
		title: id,
		description: id,
		owner: 'core',
		size: 'normal',
		surfaces: ['stats', 'home'],
		component,
		...extra
	};
}

const ids = (list: WidgetDef[]) => list.map((w) => w.id);

describe('DEFAULT_LAYOUT', () => {
	it('is today’s home: the heatmap, the flashcards summary, the daily goal, then this week', () => {
		expect(DEFAULT_LAYOUT).toEqual(['activity-heatmap', 'flashcards-summary', 'daily-goal', 'weekly-summary']);
	});

	it('a stored layout without this week stays without it', () => {
		const available = [widget('activity-heatmap'), widget('daily-goal'), widget('weekly-summary')];
		expect(ids(resolveLayout(['daily-goal', 'activity-heatmap'], available, 'home'))).toEqual([
			'daily-goal',
			'activity-heatmap'
		]);
		expect(ids(resolveLayout(null, available, 'home'))).toEqual([
			'activity-heatmap',
			'daily-goal',
			'weekly-summary'
		]);
	});

	it('a stored layout without the daily goal stays without it', () => {
		const available = [widget('activity-heatmap'), widget('flashcards-summary'), widget('daily-goal')];
		expect(ids(resolveLayout(['flashcards-summary', 'activity-heatmap'], available, 'home'))).toEqual([
			'flashcards-summary',
			'activity-heatmap'
		]);
		expect(ids(resolveLayout(null, available, 'home'))).toEqual([
			'activity-heatmap',
			'flashcards-summary',
			'daily-goal'
		]);
	});
});

describe('resolveLayout', () => {
	const available = [
		widget('activity-heatmap', { size: 'wide' }),
		widget('flashcards-summary'),
		widget('stats-only', { surfaces: ['stats'] })
	];

	it('uses the default layout when nothing is stored', () => {
		expect(ids(resolveLayout(null, available, 'home'))).toEqual([
			'activity-heatmap',
			'flashcards-summary'
		]);
	});

	it('keeps the stored order', () => {
		expect(
			ids(resolveLayout(['flashcards-summary', 'activity-heatmap'], available, 'home'))
		).toEqual(['flashcards-summary', 'activity-heatmap']);
	});

	it('drops unknown and unavailable ids and keeps the rest', () => {
		expect(
			ids(resolveLayout(['gone', 'flashcards-summary', 'also-gone'], available, 'home'))
		).toEqual(['flashcards-summary']);
	});

	it('drops widgets that cannot render on the surface', () => {
		expect(ids(resolveLayout(['stats-only', 'activity-heatmap'], available, 'home'))).toEqual([
			'activity-heatmap'
		]);
	});

	it('removes duplicates, keeping the first position', () => {
		expect(
			ids(
				resolveLayout(
					['flashcards-summary', 'activity-heatmap', 'flashcards-summary'],
					available,
					'home'
				)
			)
		).toEqual(['flashcards-summary', 'activity-heatmap']);
	});

	it('keeps an empty stored layout empty', () => {
		expect(resolveLayout([], available, 'home')).toEqual([]);
	});

	it('drops a default widget that is not available (plugin disabled)', () => {
		expect(ids(resolveLayout(null, [available[0]], 'home'))).toEqual(['activity-heatmap']);
	});
});

describe('parseLayout', () => {
	it('reads a version 1 value', () => {
		expect(parseLayout({ version: 1, widgets: ['a', 'b'] })).toEqual(['a', 'b']);
		expect(parseLayout({ version: 1, widgets: [] })).toEqual([]);
	});

	it('drops entries that are not non-empty strings', () => {
		expect(parseLayout({ version: 1, widgets: ['a', 3, null, '', { id: 'x' }, 'b'] })).toEqual([
			'a',
			'b'
		]);
	});

	it('treats a corrupt or unknown value as no layout', () => {
		for (const value of [
			null,
			undefined,
			'a,b',
			42,
			['a'],
			{},
			{ version: 1 },
			{ version: 1, widgets: 'a' },
			{ version: 0, widgets: ['a'] },
			{ version: 1.5, widgets: ['a'] },
			{ version: '1', widgets: ['a'] },
			{ version: 2, widgets: 'a' },
			{ widgets: ['a'] }
		]) {
			expect(parseLayout(value)).toBeNull();
		}
	});

	it('reads the widgets of a newer version leniently', () => {
		expect(parseLayout({ version: 2, widgets: ['a', { id: 'b' }, 'c'], columns: 3 })).toEqual([
			'a',
			'c'
		]);
	});

	it('round-trips through serializeLayout', () => {
		const value = serializeLayout(['b', 'a']);

		expect(value).toEqual({ version: 1, widgets: ['b', 'a'] });
		expect(parseLayout(JSON.parse(JSON.stringify(value)))).toEqual(['b', 'a']);
	});
});

describe('placeWidgets', () => {
	const wide = (id: string) => widget(id, { size: 'wide' });
	const normal = (id: string) => widget(id);
	const spans = (list: WidgetDef[]) => placeWidgets(list).map((p) => [p.widget.id, p.span]);

	it('spans wide widgets across the row', () => {
		expect(spans([wide('w')])).toEqual([['w', true]]);
	});

	it('pairs two normal widgets in one row', () => {
		expect(spans([normal('a'), normal('b')])).toEqual([
			['a', false],
			['b', false]
		]);
	});

	it('lets a normal widget with no partner fill its row', () => {
		expect(spans([wide('w'), normal('a')])).toEqual([
			['w', true],
			['a', true]
		]);
		expect(spans([normal('a'), wide('w'), normal('b'), normal('c'), normal('d')])).toEqual([
			['a', true],
			['w', true],
			['b', false],
			['c', false],
			['d', true]
		]);
	});

	it('places nothing for an empty layout', () => {
		expect(placeWidgets([])).toEqual([]);
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('layout store', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads the user-global qinqin-core home-layout row through the list route', async () => {
		expect(LAYOUT_KEY).toBe('home-layout');
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse([
				dataRow({ key: 'home-layout-old', data: { version: 1, widgets: ['nope'] }, version: 1 }),
				dataRow({ key: 'home-layout', data: { version: 1, widgets: ['flashcards-summary'] }, version: 2 })
			])
		);

		expect(await loadLayout()).toEqual(['flashcards-summary']);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
			'/api/rows?prefix=home-layout'
		);
	});

	it('loads no layout, without a 404 request, when the row is missing', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]));
		expect(await loadLayout()).toBeNull();
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});

	it('loads no layout when the row is corrupt', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			jsonResponse([dataRow({ key: 'home-layout', data: { widgets: 'nope' }, version: 1 })])
		);
		expect(await loadLayout()).toBeNull();
	});

	it('rejects when the server fails, so the caller can fall back', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(loadLayout()).rejects.toThrow();
	});

	it('saves the ids as a version 1 value', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

		await saveLayout(['activity-heatmap']);

		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(String(url)).toBe('/api/rows/home-layout');
		expect((init as RequestInit).method).toBe('PUT');
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			version: 1,
			widgets: ['activity-heatmap']
		});
	});
});

describe('homeEmptyReason', () => {
	it('is null while a widget is shown', () => {
		expect(homeEmptyReason(['a'], 1)).toBeNull();
		expect(homeEmptyReason(null, 2)).toBeNull();
	});

	it('says no widgets are chosen for an empty stored layout', () => {
		expect(homeEmptyReason([], 0)).toBe('none-chosen');
	});

	it('says none is available when chosen widgets cannot be shown here', () => {
		expect(homeEmptyReason(['character-map-summary'], 0)).toBe('none-available');
		expect(homeEmptyReason(null, 0)).toBe('none-available');
	});
});

describe('docs/contracts/settings/core-rows.json: home-layout', () => {
	const fixture = coreRowsFixture as unknown as {
		rule: string;
		pluginId: string;
		widgets: string[];
		defaultLayout: string[];
		layout: { name: string; value: unknown; expect: string[] | null }[];
		resolve: { name: string; stored: string[] | null; available: { id: string; surfaces: WidgetSurface[] }[]; surface: WidgetSurface; expect: string[] }[];
		serialize: { ids: string[]; expect: unknown }[];
	};
	it('names the row, the default and the widget catalogue', () => {
		expect(fixture.rule).toBe('settings/core-rows');
		expect(LAYOUT_KEY).toBe('home-layout');
		expect([...DEFAULT_LAYOUT]).toEqual(fixture.defaultLayout);
		const ids = [...coreFeatures.map((f) => f.id), ...webPlugins.map((p) => p.manifest.id)];
		const states = ids.map((id) => ({ id, manifest: {}, enabled: true, order: 0 }));
		expect(allWidgets(webPlugins, states, null).map((w) => w.id)).toEqual(fixture.widgets);
	});
	for (const c of fixture.layout) {
		it(`parseLayout: ${c.name}`, () => expect(parseLayout(c.value)).toEqual(c.expect));
	}
	for (const c of fixture.resolve) {
		it(`resolveLayout: ${c.name}`, () => {
			const available = c.available.map((a) => ({ id: a.id, surfaces: a.surfaces }) as unknown as WidgetDef);
			expect(resolveLayout(c.stored, available, c.surface).map((w) => w.id)).toEqual(c.expect);
		});
	}
	it('serializeLayout writes version 1', () => {
		for (const c of fixture.serialize) expect(serializeLayout(c.ids)).toEqual(c.expect);
	});
});
