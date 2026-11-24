import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import PopupStackView from './PopupStackView.svelte';
import sheetSource from './LookupSheet.svelte?raw';
import { inPopup } from './popupPointer.svelte';
import type { HighlightActions } from './highlightUi';
import type { PopupFrame } from './popupStackCore';
import type { LookupController } from './useLookup.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const result = {
	entryId: 5, kind: 'word', term: '故乡', reading: 'gù xiāng', forms: [], readings: [], matched: '故乡', start: 0, end: 2,
	reasons: [], tags: [], frequencies: [], levels: [{ scheme: 'HSK', level: '5' }],
	senses: [{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', pos: [], tags: [], glosses: ['hometown'], xrefs: [] }], pri: 0
} as unknown as LookupResult;

function stubPhone(matches: boolean): void {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches,
		media: query,
		addEventListener() {},
		removeEventListener() {}
	}));
}

function fakeLookup(mode: 'hover' | 'selection', frames: PopupFrame[]) {
	const lookup = {
		info: { mode, lang: 'zh', textLang: 'zh-Hans', note: '', paragraph: '故乡' },
		stack: { frames },
		popups: { shiftHeld: false, enter: vi.fn(), leave: vi.fn(), move: vi.fn() },
		hold: vi.fn(),
		close: vi.fn(),
		closeFrame: vi.fn(),
		closeNested: vi.fn(),
		wordParagraph: vi.fn(() => null)
	};
	return lookup;
}

const root: PopupFrame = { id: 1, depth: 1, anchor: { x: 10, y: 10, w: 20, h: 20 }, text: '故乡', offset: 0, results: [result] };
const highlighter: HighlightActions = { color: 'yellow', ready: true, notice: '', pick: vi.fn(), note: vi.fn() };

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function mount(mode: 'hover' | 'selection' = 'selection', frames: PopupFrame[] = [root]) {
	const lookup = fakeLookup(mode, frames);
	render(PopupStackView, { props: { lookup: lookup as unknown as LookupController, studyWorkspaceId: 7, highlighter }, context: ctx.context });
	return lookup;
}

describe('the lookup on the phone (#102)', () => {
	it('below the phone breakpoint the root frame renders inside a dialog named "Dictionary: <text>"', () => {
		stubPhone(true);
		mount();
		const sheet = screen.getByRole('dialog', { name: 'Dictionary: 故乡' });
		expect(sheet.tagName).toBe('DIALOG');
		expect(sheet.classList.contains('sheet')).toBe(true);
	});

	it('the entries, actions and the highlight bar (selection mode) are inside the sheet', async () => {
		stubPhone(true);
		mount('selection');
		const sheet = screen.getByRole('dialog', { name: 'Dictionary: 故乡' });
		expect(within(sheet).getByText('hometown')).toBeTruthy();
		expect(within(sheet).getByText('HSK 5')).toBeTruthy();
		expect(await within(sheet).findByRole('button', { name: 'Add to deck: 故乡' })).toBeTruthy();
		expect(within(sheet).getByRole('group', { name: /Highlight/ })).toBeTruthy();
	});

	it('closing the sheet (close button, Escape) closes the lookup', async () => {
		stubPhone(true);
		let lookup = mount();
		const close = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' });
		// One close control: the sheet's own (the popup's is not drawn in the sheet).
		expect(close).toHaveLength(1);
		await fireEvent.click(close[0]);
		expect(lookup.close).toHaveBeenCalledTimes(1);
		cleanup();
		lookup = mount();
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(lookup.close).toHaveBeenCalledTimes(1);
	});

	it('a pointer leaving the sheet does not hide it, and the sheet pins the lookup while open', async () => {
		stubPhone(true);
		const lookup = mount('hover');
		const sheet = screen.getByRole('dialog');
		await fireEvent.pointerLeave(sheet);
		expect(lookup.popups.leave).not.toHaveBeenCalled();
		expect(lookup.hold).toHaveBeenCalledWith(true);
		// Taps and scrolls inside the sheet are the popup's, the backdrop is not.
		expect(inPopup(within(sheet).getByText('hometown'))).toBe(true);
		// The sheet's own scrolling body and handle (around the content) count too.
		expect(inPopup(sheet.querySelector('.body'))).toBe(true);
		expect(inPopup(sheet)).toBe(false);
	});

	it('inside the sheet the highlight result is a status region (the page live regions are inert)', () => {
		stubPhone(true);
		const actions = { ...highlighter, notice: 'Highlight added: 故乡' };
		render(PopupStackView, { props: {
			lookup: fakeLookup('selection', [root]) as unknown as LookupController,
			studyWorkspaceId: 7,
			highlighter: actions
		}, context: ctx.context });
		const sheet = screen.getByRole('dialog', { name: 'Dictionary: 故乡' });
		expect(within(sheet).getByRole('status').textContent).toBe('Highlight added: 故乡');
	});

	it('a replaced lookup sheet does not close the lookup that replaced it', async () => {
		stubPhone(true);
		const lookup = fakeLookup('hover', [root]);
		const view = render(PopupStackView, { props: {
			lookup: lookup as unknown as LookupController,
			studyWorkspaceId: 7,
			highlighter
		}, context: ctx.context });
		const old = screen.getByRole('dialog', { name: 'Dictionary: 故乡' });
		// A new root frame (a rotation, a replaced hover root): the old sheet unmounts.
		await view.rerender({
			lookup: {
				...lookup,
				stack: { frames: [{ ...root, id: 2, text: '乡' }] }
			} as unknown as LookupController,
			studyWorkspaceId: 7,
			highlighter
		});
		expect(screen.getByRole('dialog', { name: 'Dictionary: 乡' })).toBeTruthy();
		// The browser queues the detached dialog's native close event after teardown.
		old.dispatchEvent(new Event('close'));
		expect(lookup.close).not.toHaveBeenCalled();
	});

	it('above the breakpoint the popup path is unchanged', () => {
		stubPhone(false);
		mount();
		const popup = screen.getByRole('dialog', { name: 'Dictionary: 故乡' });
		expect(popup.tagName).toBe('DIV');
		expect(popup.hasAttribute('data-lookup-popup')).toBe(true);
	});

	it('narrowing below the phone breakpoint closes a nested frame, leaving only the root sheet', async () => {
		let change: ((e: { matches: boolean }) => void) | null = null;
		vi.stubGlobal('matchMedia', (query: string) => ({
			matches: false,
			media: query,
			addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => (change = cb),
			removeEventListener() {}
		}));
		const lookup = fakeLookup('hover', [root, { ...root, id: 2, depth: 2, text: '乡' }]);
		render(PopupStackView, { props: {
			lookup: lookup as unknown as LookupController,
			studyWorkspaceId: 7,
			highlighter
		}, context: ctx.context });
		// A narrow desktop window with a mouse: the root and its Shift+hover child.
		expect(screen.getAllByRole('dialog')).toHaveLength(2);
		change!({ matches: true });
		await tick();
		expect(lookup.closeNested).toHaveBeenCalled();
		// The page is modal now: only the root frame, as a sheet.
		const dialogs = screen.getAllByRole('dialog');
		expect(dialogs).toHaveLength(1);
		expect(dialogs[0].tagName).toBe('DIALOG');
	});

	it('the Sheet is lib/ui/Sheet (the journal reuses it)', () => {
		expect(sheetSource).toMatch(/import \{[^}]*\bSheet\b[^}]*\} from '\$lib\/ui'/);
	});
});
