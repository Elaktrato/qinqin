import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { installedFaces } from '$lib/fonts/hanzi';
import ChapterText from './ChapterText.svelte';
import source from './ChapterText.svelte?raw';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
import { rangeForSpan, selectionSpan } from './dom';
import type { Highlight } from './highlights';
import type { Run } from './paragraphText';
import type { Piece } from './smartReadings';
import type { WordRange } from './wordRanges';
import { createReveal } from './reveal';
import type { LookupController } from './useLookup.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

afterEach(cleanup);

const lookup = { pointermove() {}, pointerleave() {}, pointerdown() {} } as unknown as LookupController;
const dict = (start: number, end: number, rt: string, concealed = false): Piece => ({ start, end, rt, concealed, source: 'dict' });
const display = (over: Partial<ReaderDisplay> = {}): ReaderDisplay => ({ ...DEFAULT_DISPLAY, ...over });

function mount(props: {
	paragraphs: Run[][];
	pieces?: Map<number, Piece[]>;
	display?: ReaderDisplay;
	highlights?: Map<number, Highlight[]>;
	lang?: string;
	reveal?: ReturnType<typeof createReveal>;
	showAll?: boolean;
	words?: Map<number, WordRange[]>;
}) {
	const result = render(ChapterText, { props: { lang: 'zh', lookup, display: display(), ...props } as never, context: ctx.context });
	return { ...result, root: result.container.querySelector('.chapter-text') as HTMLElement };
}

const zh: Run[][] = [[{ text: '你好世界' }]];

describe('ChapterText readings', () => {
	it('shows generated readings in <ruby data-o><rt>', () => {
		const { root } = mount({ paragraphs: zh, pieces: new Map([[0, [dict(0, 2, 'nǐ hǎo'), dict(2, 4, 'shì jiè')]]]), display: display({ readings: 'always' }) });
		const rubies = root.querySelectorAll('ruby[data-o]');
		expect(Array.from(rubies).map((r) => [r.firstChild?.textContent, r.querySelector('rt')?.textContent])).toEqual([
			['你好', 'nǐ hǎo'],
			['世界', 'shì jiè']
		]);
		expect(root.querySelector('[data-r]')?.tagName).toBe('SPAN');
		expect(root.querySelector('rt.concealed')).toBeNull();
	});

	it('marks known words concealed but keeps the reading in the DOM', () => {
		const { root } = mount({ paragraphs: zh, pieces: new Map([[0, [dict(0, 2, 'nǐ hǎo', true), dict(2, 4, 'shì jiè')]]]), display: display({ readings: 'smart' }) });
		const rts = Array.from(root.querySelectorAll('rt'));
		expect(rts.map((r) => [r.textContent, r.classList.contains('concealed')])).toEqual([
			['nǐ hǎo', true],
			['shì jiè', false]
		]);
	});

	it('book ruby with bookRuby off draws no <rt>', () => {
		const paragraphs: Run[][] = [[{ text: '漢字', ruby: 'かんじ' }, { text: 'を' }]];
		expect(mount({ paragraphs, display: display({ bookRuby: false }) }).root.querySelector('rt')).toBeNull();
		cleanup();
		const on = mount({ paragraphs, display: display({ bookRuby: true }) }).root;
		expect(on.querySelector('ruby[data-r] > rt')?.textContent).toBe('かんじ');
	});

	it('a concealed book ruby is marked', () => {
		const paragraphs: Run[][] = [[{ text: '漢字', ruby: 'かんじ' }]];
		const book: Piece = { start: 0, end: 2, rt: 'かんじ', concealed: true, source: 'book' };
		const { root } = mount({ paragraphs, pieces: new Map([[0, [book]]]), display: display({ readings: 'smart' }) });
		expect(root.querySelector('rt')?.classList.contains('concealed')).toBe(true);
	});

	it('a highlight across half a word leaves that word without a reading', () => {
		const h = { id: 1, chapter: 0, paragraph: 0, start: 1, end: 3, text: '好世', note: '', color: 'yellow' } as unknown as Highlight;
		const { root } = mount({
			paragraphs: zh,
			pieces: new Map([[0, [dict(0, 2, 'nǐ hǎo'), dict(2, 4, 'shì jiè')]]]),
			highlights: new Map([[0, [h]]]),
			display: display({ readings: 'always' })
		});
		expect(root.querySelector('rt')).toBeNull();
		expect(root.querySelector('mark[data-h]')?.textContent).toBe('好世');
	});

	it('maps selections identically with and without readings', () => {
		const runs = zh[0];
		const spans = (root: HTMLElement) => {
			const out: unknown[] = [];
			for (let s = 0; s < 4; s++)
				for (let e = s + 1; e <= 4; e++) out.push(selectionSpan(root, rangeForSpan(root, 0, runs, s, e)!, () => runs));
			return out;
		};
		const withReadings = spans(mount({ paragraphs: zh, pieces: new Map([[0, [dict(0, 2, 'nǐ hǎo'), dict(2, 4, 'shì jiè', true)]]]), display: display({ readings: 'smart' }) }).root);
		cleanup();
		const plain = spans(mount({ paragraphs: zh }).root);
		expect(withReadings).toEqual(plain);
	});

	it('keeps the language and sets the display variables', () => {
		const { root } = mount({ paragraphs: zh, lang: 'zh-Hant', display: display({ rubyScale: 0.75, font: 'serif' }) });
		expect(root.getAttribute('lang')).toBe('zh-Hant');
		expect(root.style.getPropertyValue('--reader-rt-size')).toBe('0.75em');
		expect(root.style.getPropertyValue('--reader-font')).toContain('serif');
		// The full study lang picks the script: traditional text gets the TC families.
		expect(root.style.getPropertyValue('--reader-font')).toContain('"Noto Serif CJK TC"');
	});

	it('the default font is the app-wide hanzi font; other languages keep the app font', () => {
		expect(mount({ paragraphs: zh }).root.style.getPropertyValue('--reader-font')).toBe('var(--font-hanzi)');
		cleanup();
		expect(mount({ paragraphs: zh, lang: 'ko' }).root.style.getPropertyValue('--reader-font')).toBe('');
	});

	it('a concrete reader font asks for its pack face and puts it first when installed', async () => {
		const need = vi.spyOn(ctx.app.fonts, 'need');
		const installed = vi.spyOn(ctx.app.fonts, 'installed', 'get').mockReturnValue(installedFaces([{ face: 'kai', script: 'Hant' }]));
		const { root, unmount } = mount({ paragraphs: zh, lang: 'zh-Hant', display: display({ font: 'kai' }) });
		expect(need).toHaveBeenLastCalledWith('reader', ['kai']);
		expect(root.style.getPropertyValue('--reader-font')).toMatch(/^"qq-kai-Hant", /);
		unmount();
		expect(need).toHaveBeenLastCalledWith('reader', []);
		need.mockRestore();
		installed.mockRestore();
	});
});

describe('ChapterText stylesheet', () => {
	it('keeps readings out of copied and selected text', () => {
		expect(source).toMatch(/rt\s*\{[^}]*user-select:\s*none/);
	});
	it('conceals without reflow and without leaving the accessibility tree', () => {
		const rule = source.match(/rt\.concealed\s*\{[^}]*\}/)?.[0] ?? '';
		expect(rule).toContain('color: transparent');
		expect(rule).not.toMatch(/visibility|display/);
	});
});

describe('ChapterText reveal', () => {
	const pieces = new Map([[0, [dict(0, 2, 'nǐ hǎo', true)]]]);
	function pointer(type: string, target: Element, x = 5, y = 5): void {
		const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
		Object.defineProperty(e, 'pointerId', { value: 1 });
		target.dispatchEvent(e);
	}

	it('a tap on a concealed word reveals it and the lookup still gets the events', () => {
		vi.useFakeTimers();
		try {
			const pointerdown = vi.fn();
			const reveal = createReveal();
			const { root } = mount({ paragraphs: zh, pieces, display: display({ readings: 'smart' }), reveal, lookup: { ...lookup, pointerdown } } as never);
			const word = root.querySelector('ruby.gen')!;
			pointer('pointerdown', word);
			pointer('pointerup', word);
			expect(pointerdown).toHaveBeenCalledTimes(1);
			expect(word.classList.contains('revealed')).toBe(true);
			vi.advanceTimersByTime(4000);
			expect(word.classList.contains('revealed')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a drag reveals nothing', () => {
		const reveal = createReveal();
		const { root } = mount({ paragraphs: zh, pieces, display: display({ readings: 'smart' }), reveal });
		const word = root.querySelector('ruby.gen')!;
		pointer('pointerdown', word, 0, 0);
		pointer('pointerup', word, 40, 0);
		expect(word.classList.contains('revealed')).toBe(false);
	});

	it('showAll puts the class on the container', () => {
		const { root } = mount({ paragraphs: zh, pieces, display: display({ readings: 'smart' }), showAll: true });
		expect(root.classList.contains('show-all')).toBe(true);
	});

	it('a chapter change resets the reveals', async () => {
		const reveal = createReveal();
		const view = mount({ paragraphs: zh, pieces, display: display({ readings: 'smart' }), reveal });
		reveal.toggleAll();
		await view.rerender({ paragraphs: [[{ text: '再见' }]] } as never);
		expect(reveal.isAllShown).toBe(false);
	});
});

describe('ChapterText word states', () => {
	const w = (start: number, end: number, state: WordRange['state']): WordRange => ({ start, end, state });
	const classes = (root: HTMLElement) =>
		Array.from(root.querySelectorAll('[data-o]')).map((el) => [
			el.tagName,
			el.firstChild?.textContent,
			['w-new', 'w-learning', 'w-end'].filter((c) => el.classList.contains(c)).join(' ')
		]);

	it('puts the state classes on the pieces of new and learning words only', () => {
		const { root } = mount({ paragraphs: [[{ text: '你好，世界人' }]], words: new Map([[0, [w(0, 2, 'new'), w(3, 5, 'learning')]]]) });
		expect(classes(root)).toEqual([
			['SPAN', '你好', 'w-new w-end'],
			['SPAN', '，', ''],
			['SPAN', '世界', 'w-learning w-end'],
			['SPAN', '人', '']
		]);
	});

	it('a generated ruby piece inside a new word carries the class, the word ends on its last piece', () => {
		const { root } = mount({
			paragraphs: [[{ text: '食べました' }]],
			lang: 'ja',
			display: display({ readings: 'always' }),
			pieces: new Map([[0, [dict(0, 1, 'た')]]]),
			words: new Map([[0, [w(0, 5, 'new')]]])
		});
		expect(classes(root)).toEqual([
			['RUBY', '食', 'w-new'],
			['SPAN', 'べました', 'w-new w-end']
		]);
		// The <rt> is outside the base text node the offsets count.
		expect(root.querySelector('ruby.w-new')?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
		expect(root.querySelector('ruby.w-new > rt')?.textContent).toBe('た');
	});

	it('draws nothing inside a user highlight', () => {
		const h = { id: 1, chapter: 0, paragraph: 0, start: 1, end: 2, text: '好', note: '', color: 'yellow' } as unknown as Highlight;
		const { root } = mount({ paragraphs: zh, highlights: new Map([[0, [h]]]), words: new Map([[0, [w(0, 2, 'new'), w(2, 4, 'new')]]]) });
		expect(root.querySelector('mark[data-h]')?.className).not.toMatch(/w-/);
		expect(classes(root).filter(([, , c]) => c !== '')).toEqual([['SPAN', '世界', 'w-new w-end']]);
	});

	it('no words: the plain markup, no extra pieces', () => {
		const { root } = mount({ paragraphs: zh, words: new Map() });
		expect(root.querySelector('[data-o]')).toBeNull();
		expect(root.querySelector('[data-r]')?.textContent).toBe('你好世界');
	});

	const roundTrip = (root: HTMLElement, runs: Run[]) => {
		const n = Array.from(runs.map((r) => r.text).join('')).length;
		const out: unknown[] = [];
		for (let s = 0; s < n; s++)
			for (let e = s + 1; e <= n; e++) out.push(selectionSpan(root, rangeForSpan(root, 0, runs, s, e)!, () => runs));
		return out;
	};
	const scenes: { name: string; runs: Run[]; pieces?: Piece[]; hl?: Highlight[]; words: WordRange[] }[] = [
		{ name: 'a plain run', runs: [{ text: '你好世界' }], words: [w(0, 2, 'new'), w(2, 4, 'learning')] },
		{ name: 'generated ruby', runs: [{ text: '𠮷你好世界' }], pieces: [dict(1, 3, 'nǐ hǎo')], words: [w(1, 3, 'new'), w(3, 5, 'new')] },
		{ name: 'a book ruby run', runs: [{ text: '漢字', ruby: 'かんじ' }, { text: 'を読む' }], words: [w(0, 2, 'new'), w(3, 5, 'learning')] },
		{
			name: 'next to a highlight',
			runs: [{ text: '你好世界' }],
			hl: [{ id: 1, chapter: 0, paragraph: 0, start: 2, end: 3, text: '世', note: '', color: 'yellow' } as unknown as Highlight],
			words: [w(0, 2, 'new'), w(2, 4, 'new')]
		}
	];
	for (const sc of scenes) {
		it(`maps selections identically with and without word states: ${sc.name}`, () => {
			const base = {
				paragraphs: [sc.runs],
				display: display({ readings: 'always' }),
				pieces: new Map([[0, sc.pieces ?? []]]),
				highlights: new Map([[0, sc.hl ?? []]])
			};
			const withWords = mount({ ...base, words: new Map([[0, sc.words]]) });
			expect(withWords.root.querySelector('.w-new, .w-learning')).not.toBeNull();
			const a = roundTrip(withWords.root, sc.runs);
			cleanup();
			const b = roundTrip(mount(base).root, sc.runs);
			expect(a).toEqual(b);
		});
	}
});

describe('the reading column (#102)', () => {
	const style = source.slice(source.indexOf('<style>'));
	const rule = style.slice(style.indexOf('.chapter-text {'), style.indexOf('}', style.indexOf('.chapter-text {')));
	it('is 40em of the reader text at 1.25rem, line height 2.2 (ruby needs it), centred', () => {
		expect(rule).toMatch(/font-size:\s*1\.25rem/);
		expect(rule).toMatch(/line-height:\s*2\.2;/);
		expect(rule).toMatch(/max-width:\s*40em/);
		expect(rule).toMatch(/margin-inline:\s*auto/);
	});
	it('keeps the bookmarked paragraph marker an --accent pseudo-element', () => {
		expect(style).toMatch(/p\.bookmarked::before\s*{[^}]*background:\s*var\(--accent\)/);
	});
});
