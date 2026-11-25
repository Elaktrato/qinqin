// The Android back button against the real LookupController: back offers an Escape key press to the page, and the
// open lookup popup must claim it (preventDefault), or the press would close the popup AND go back in history.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import type { HoverDeps, HoverShown } from './hoverLookup';
import { onBack, pressEscape } from '$lib/native/back';

const hover = vi.hoisted(() => ({ deps: null as HoverDeps | null }));
vi.mock('./hoverLookup', async (orig) => {
	const real = await orig<typeof import('./hoverLookup')>();
	return {
		...real,
		HoverLookup: class extends real.HoverLookup {
			constructor(deps: HoverDeps) {
				super(deps);
				hover.deps = deps;
			}
		}
	};
});
vi.mock('./dom', async (orig) => ({
	...(await orig<typeof import('./dom')>()),
	rangeForSpan: () => ({ getBoundingClientRect: () => new DOMRect(0, 0, 10, 10) }) as unknown as Range,
	highlightSpan: () => ({ p: 0, start: 0, end: 1 })
}));

import { LookupController } from './useLookup.svelte';

const shown: HoverShown = {
	span: { p: 0, start: 0, end: 1 },
	text: '马',
	offset: 0,
	results: [{ entryId: 1, term: 'x', matched: 'x', start: 0, end: 1 } as unknown as LookupResult],
	error: ''
};

let ctl: LookupController;
let detach: () => void;
beforeEach(() => {
	const container = document.createElement('div');
	document.body.append(container);
	ctl = new LookupController({ container: () => container, lang: () => 'zh', textLang: () => 'zh-Hans', runsOf: () => [{ text: '马上' }] });
	detach = ctl.attach();
});
afterEach(() => {
	detach();
	document.body.innerHTML = '';
});

describe('back button and the reader lookup popup', () => {
	it('an open popup takes the Escape press: it closes and the press is reported handled', () => {
		hover.deps!.show(shown);
		expect(ctl.info).not.toBeNull();
		expect(pressEscape(document)).toBe(true);
		expect(ctl.info).toBeNull();
	});

	it('with no popup open the press is not handled, so back goes on to the history', () => {
		expect(pressEscape(document)).toBe(false);
		const goBack = vi.fn();
		const result = onBack(true, { dismiss: () => false, escape: () => pressEscape(document), goBack, leave: vi.fn() });
		expect(result).toBe('history');
		expect(goBack).toHaveBeenCalledOnce();
	});

	it('back with a popup open closes it and does not navigate', () => {
		hover.deps!.show(shown);
		const goBack = vi.fn();
		const result = onBack(true, { dismiss: () => false, escape: () => pressEscape(document), goBack, leave: vi.fn() });
		expect(result).toBe('escape');
		expect(goBack).not.toHaveBeenCalled();
		expect(ctl.info).toBeNull();
	});
});
