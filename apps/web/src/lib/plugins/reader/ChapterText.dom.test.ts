import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChapterText from './ChapterText.svelte';
import source from './ChapterText.svelte?raw';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
import { rangeForSpan, selectionSpan } from './dom';
import type { Highlight } from './highlights';
import type { Run } from './paragraphText';
import type { Piece } from './smartReadings';
import { createReveal } from './reveal';
import type { LookupController } from './useLookup.svelte';

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
}) {
	const result = render(ChapterText, { lang: 'zh', lookup, display: display(), ...props } as never);
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
	});

	it('the default font sets no font variable', () => {
		expect(mount({ paragraphs: zh }).root.style.getPropertyValue('--reader-font')).toBe('');
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
