// A highlight under a finger and under a mouse (tap to look up): a tap on a
// highlighted word opens that word's lookup in the phone sheet, which carries
// the highlight actions, and never the highlight editor; a mouse click on the
// highlight still opens the editor and looks nothing up. The chapter text,
// the controller and the sheet are real; the layout (which jsdom does not
// compute) and the server lookup are faked.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

const layout = vi.hoisted(() => ({ caret: null as { node: Node; offset: number } | null }));
vi.mock('./dom', async (orig) => ({
	...(await orig<typeof import('./dom')>()),
	caretFromPoint: () => layout.caret,
	rangeContainsPoint: () => true,
	rangeForSpan: () => ({ getBoundingClientRect: () => new DOMRect(40, 100, 20, 30) }) as unknown as Range
}));
vi.mock('$lib/api/lookup', async (orig) => ({
	...(await orig<typeof import('$lib/api/lookup')>()),
	lookupAt: async (_lang: string, text: string): Promise<LookupResult[]> =>
		text.startsWith('水')
			? [
					{
						entryId: 7, kind: 'word', term: '水', reading: 'みず', forms: [], readings: [], matched: '水', start: 0, end: 1,
						reasons: [], tags: [], frequencies: [], levels: [], pri: 0,
						senses: [{ dictionaryId: 1, dictionaryName: 'Test', pos: [], tags: [], glosses: ['water'], xrefs: [] }]
					} as unknown as LookupResult
				]
			: []
}));
vi.mock('$lib/studycore/data', async (orig) => ({
	...(await orig<typeof import('$lib/studycore/data')>()),
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import ChapterText from './ChapterText.svelte';
import PopupStackView from './PopupStackView.svelte';
import type { Highlight } from './highlights';
import { highlightMark, type HighlightActions } from './highlightUi';
import { LookupController } from './useLookup.svelte';

const TEXT = '私は水を飲みます。';
const mark: Highlight = { id: 4, chapter: 0, paragraph: 0, start: 2, end: 3, text: '水', note: '', color: 'yellow' } as unknown as Highlight;
const stop: Highlight = { id: 5, chapter: 0, paragraph: 0, start: 8, end: 9, text: '。', note: '', color: 'pink' } as unknown as Highlight;
const highlighter: HighlightActions = { color: 'yellow', ready: true, notice: '', pick: vi.fn(), note: vi.fn() };

let ctx: TestContext;
let clock = 0;
let ctl: LookupController;
let detach: () => void;
let onhighlight: ReturnType<typeof vi.fn<(id: number, el: HTMLElement) => void>>;

beforeEach(() => {
	vi.useFakeTimers();
	ctx = testContext();
	clock = 1000;
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }));
	vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
	let root: HTMLElement | null = null;
	ctl = new LookupController({
		container: () => root,
		lang: () => 'ja',
		textLang: () => 'ja',
		runsOf: (p) => (p === 0 ? [{ text: TEXT }] : undefined),
		now: () => clock,
		// As BookView wires it: a tap on no word over a highlight edits it.
		onTapNoWord: (target) => {
			const hit = highlightMark(target);
			if (hit) onhighlight(hit.id, hit.el);
		}
	});
	detach = ctl.attach();
	onhighlight = vi.fn<(id: number, el: HTMLElement) => void>();
	const view = render(ChapterText, {
		props: { paragraphs: [[{ text: TEXT }]], lang: 'ja', lookup: ctl, highlights: new Map([[0, [mark, stop]]]), onhighlight },
		context: ctx.context
	});
	root = view.container.querySelector('.chapter-text');
	render(PopupStackView, { props: { lookup: ctl, studyWorkspaceId: null, highlighter }, context: ctx.context });
});
afterEach(() => {
	detach();
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function markElement(id = 4): HTMLElement {
	const el = document.querySelector<HTMLElement>(`mark[data-h="${id}"]`);
	if (!el) throw new Error('the highlight is not drawn');
	layout.caret = { node: el.firstChild!, offset: 0 };
	return el;
}

/** What a browser sends for a press and release on `el`, then its click. */
function press(el: HTMLElement, pointerType: 'touch' | 'mouse', click: MouseEvent): void {
	const init = { bubbles: true, pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: 50, clientY: 110 };
	el.dispatchEvent(new PointerEvent('pointerdown', init));
	clock += 80;
	el.dispatchEvent(new PointerEvent('pointerup', init));
	el.dispatchEvent(click);
}

describe('a highlighted word', () => {
	it('a tap opens its lookup with the highlight actions, not the editor', async () => {
		// A WebKit-style click without a pointer type: the touch release before it tells.
		press(markElement(), 'touch', new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
		await vi.advanceTimersByTimeAsync(100);
		expect(onhighlight).not.toHaveBeenCalled();
		const sheet = screen.getByRole('dialog', { name: 'Dictionary: 水' });
		expect(within(sheet).getByText('water')).toBeTruthy();
		expect(within(sheet).getByRole('group', { name: 'Highlight the selection' })).toBeTruthy();
		expect(ctl.tapped).toBe(true);
	});

	it('a tap whose click carries pointerType touch does not edit either', async () => {
		press(markElement(), 'touch', new PointerEvent('click', { bubbles: true, button: 0, detail: 1, pointerType: 'touch' }));
		await vi.advanceTimersByTimeAsync(100);
		expect(onhighlight).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Dictionary: 水' })).toBeTruthy();
	});

	it('a mouse click still edits it and looks nothing up', async () => {
		const el = markElement();
		press(el, 'mouse', new PointerEvent('click', { bubbles: true, button: 0, detail: 1, pointerType: 'mouse' }));
		await vi.advanceTimersByTimeAsync(100);
		expect(onhighlight).toHaveBeenCalledExactlyOnceWith(4, el);
		expect(ctl.info).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('a tap on a highlighted character that is no word (punctuation) opens the highlight editor', async () => {
		const el = markElement(5);
		press(el, 'touch', new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
		await vi.advanceTimersByTimeAsync(100);
		expect(onhighlight).toHaveBeenCalledExactlyOnceWith(5, el);
		expect(ctl.info).toBeNull();
	});
});
