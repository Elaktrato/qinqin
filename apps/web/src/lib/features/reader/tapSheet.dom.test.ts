// A tap while the phone's lookup sheet is open (tap to look up): the sheet
// is modal, so the finger lands on its backdrop. Lifting it closes the sheet;
// a tap there then looks up the word under the finger behind it, found by
// the same word finding as any tap. A tap on no word only closes, and the
// click the browser sends after the tap never activates a control that was
// under the backdrop. The chapter text, the controller and the sheet are
// real; the layout (which jsdom does not compute) and the server are faked.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

const layout = vi.hoisted(() => ({ caret: null as { node: Node; offset: number } | null, under: null as Element | null }));
vi.mock('./dom', async (orig) => ({
	...(await orig<typeof import('./dom')>()),
	caretFromPoint: () => layout.caret,
	rangeContainsPoint: () => true,
	rangeForSpan: () => ({ getBoundingClientRect: () => new DOMRect(40, 100, 20, 30) }) as unknown as Range
}));
const entry = (entryId: number, matched: string): LookupResult =>
	({
		entryId, kind: 'word', term: matched, reading: '', forms: [], readings: [], matched, start: 0, end: matched.length,
		reasons: [], tags: [], frequencies: [], levels: [], pri: 0,
		senses: [{ dictionaryId: 1, dictionaryName: 'Test', pos: [], tags: [], glosses: [`gloss ${matched}`], xrefs: [] }]
	}) as unknown as LookupResult;
vi.mock('$lib/api/lookup', async (orig) => ({
	...(await orig<typeof import('$lib/api/lookup')>()),
	lookupAt: async (_lang: string, text: string): Promise<LookupResult[]> =>
		text.startsWith('水') ? [entry(7, '水')] : text.startsWith('飲') ? [entry(8, '飲み')] : []
}));
vi.mock('$lib/study/data', async (orig) => ({
	...(await orig<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import ChapterText from './ChapterText.svelte';
import PopupStackView from './PopupStackView.svelte';
import { LookupController } from './useLookup.svelte';

const TEXT = '私は水を飲みます。';
let ctx: TestContext;
let clock = 0;
let ctl: LookupController;
let detach: () => void;
let run: HTMLElement;
let link: HTMLAnchorElement;
let followed: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	ctx = testContext();
	clock = 1000;
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }));
	vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
	// jsdom has no hit testing: the element under the finger once the sheet is gone.
	Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => layout.under });
	let root: HTMLElement | null = null;
	ctl = new LookupController({
		container: () => root,
		lang: () => 'ja',
		textLang: () => 'ja',
		runsOf: (p) => (p === 0 ? [{ text: TEXT }] : undefined),
		now: () => clock
	});
	detach = ctl.attach();
	const view = render(ChapterText, { props: { paragraphs: [[{ text: TEXT }]], lang: 'ja', lookup: ctl }, context: ctx.context });
	root = view.container.querySelector('.chapter-text');
	run = root!.querySelector('[data-r]')!;
	render(PopupStackView, { props: { lookup: ctl, studyWorkspaceId: null }, context: ctx.context });
	link = document.createElement('a');
	link.href = '#elsewhere';
	link.textContent = 'Next chapter';
	document.body.append(link);
	followed = vi.fn();
	link.addEventListener('click', followed);
});
afterEach(() => {
	detach();
	cleanup();
	link.remove();
	delete (document as { elementFromPoint?: unknown }).elementFromPoint;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** A touch press and release on `el`, then the click the browser sends, at `under`. */
async function tapOn(el: Element, under: Element | null, caret: number): Promise<MouseEvent> {
	layout.caret = { node: run.firstChild!, offset: caret };
	layout.under = under;
	const init = { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 50, clientY: 110 };
	el.dispatchEvent(new PointerEvent('pointerdown', init));
	clock += 80;
	el.dispatchEvent(new PointerEvent('pointerup', init));
	await vi.advanceTimersByTimeAsync(0);
	// The browser hit-tests the click afresh: the sheet is gone by now.
	const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 });
	(under ?? document.body).dispatchEvent(click);
	await vi.advanceTimersByTimeAsync(100);
	return click;
}

function sheet(): HTMLElement {
	return screen.getByRole('dialog');
}

describe('a tap behind the open sheet', () => {
	it('on another word closes the sheet and looks that word up', async () => {
		await tapOn(run, run, 2);
		expect(sheet().getAttribute('aria-label')).toBe('Dictionary: 水');
		await tapOn(sheet(), run, 4);
		expect(sheet().getAttribute('aria-label')).toBe('Dictionary: 飲み');
		expect(ctl.stack.frames).toHaveLength(1);
	});

	it('the sheet stays modal until the finger lifts', async () => {
		await tapOn(run, run, 2);
		const dialog = sheet();
		dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }));
		await vi.advanceTimersByTimeAsync(0);
		expect(dialog.isConnected).toBe(true);
		expect(dialog.getAttribute('aria-modal')).toBe('true');
	});

	it('on a gap or on punctuation only closes the sheet', async () => {
		await tapOn(run, run, 2);
		await tapOn(sheet(), run, 8);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(ctl.info).toBeNull();
	});

	it('over a link never follows it: its click is swallowed', async () => {
		await tapOn(run, run, 2);
		const click = await tapOn(sheet(), link, 2);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(followed).not.toHaveBeenCalled();
		expect(click.defaultPrevented).toBe(true);
		// The next click on the link is the learner's own again.
		link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0 }));
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
		expect(followed).toHaveBeenCalledTimes(1);
	});
});
