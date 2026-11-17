import { afterEach, describe, expect, it } from 'vitest';
import { rangeForSpan, runPointAt, selectionSpan } from './dom';
import type { Run } from './paragraphText';

// The markup ChapterText emits: a run element whose pieces (data-o = UTF-16
// start in the run) may be <ruby> with a generated <rt>.
function mount(html: string): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = html;
	document.body.append(container);
	return container;
}

afterEach(() => {
	document.body.innerHTML = '';
});

const plainRuns: Run[] = [{ text: '你好世界' }];
const withRuby =
	'<p data-p="0"><span data-r="0"><ruby data-o="0">你好<rt>nǐ hǎo</rt></ruby><span data-o="2">世界</span></span></p>';
const plain = '<p data-p="0"><span data-r="0">你好世界</span></p>';

function everySpan(container: HTMLElement, runs: Run[]): { p: number; start: number; end: number }[] {
	const n = Array.from(runs.map((r) => r.text).join('')).length;
	const out: { p: number; start: number; end: number }[] = [];
	for (let start = 0; start < n; start++) {
		for (let end = start + 1; end <= n; end++) {
			const range = rangeForSpan(container, 0, runs, start, end);
			expect(range, `range ${start}-${end}`).not.toBeNull();
			const got = selectionSpan(container, range!, () => runs);
			out.push({ p: 0, start: got?.start ?? -1, end: got?.end ?? -1 });
			expect(got).toEqual({ p: 0, start, end });
		}
	}
	return out;
}

describe('dom mapping with readings inside pieces', () => {
	it('round-trips every span with dictionary ruby pieces', () => {
		everySpan(mount(withRuby), plainRuns);
	});

	it('maps the same as the plain markup', () => {
		const a = everySpan(mount(withRuby), plainRuns);
		document.body.innerHTML = '';
		const b = everySpan(mount(plain), plainRuns);
		expect(a).toEqual(b);
	});

	it('round-trips with ruby pieces, highlights and astral characters together', () => {
		const runs: Run[] = [{ text: '𠮷你好世界' }];
		const container = mount(
			'<p data-p="0"><span data-r="0"><span data-o="0">𠮷</span><ruby data-o="2">你好<rt>nǐ hǎo</rt></ruby><mark data-o="4" data-h="1">世</mark><span data-o="5">界</span></span></p>'
		);
		everySpan(container, runs);
	});

	it('round-trips book ruby runs next to generated ones', () => {
		const runs: Run[] = [{ text: '漢字', ruby: 'かんじ' }, { text: '你好' }];
		const container = mount(
			'<p data-p="0"><ruby data-r="0">漢字<rt>かんじ</rt></ruby><span data-r="1"><ruby data-o="0">你好<rt>nǐ hǎo</rt></ruby></span></p>'
		);
		everySpan(container, runs);
	});

	it('round-trips with word state classes on the pieces', () => {
		const container = mount(
			'<p data-p="0"><span data-r="0"><ruby data-o="0" class="gen w-new">你<rt>nǐ</rt></ruby><span data-o="1" class="w-new w-end">好</span><span data-o="2" class="w-learning w-end">世界</span></span></p>'
		);
		expect(everySpan(container, plainRuns)).toEqual(everySpan(mount(plain), plainRuns));
	});

	it('reports a caret inside a generated <rt> as inRt, at its piece', () => {
		const container = mount(withRuby);
		const rtText = container.querySelector('rt')!.firstChild!;
		expect(runPointAt(rtText, 1, 'start')).toEqual({ p: 0, r: 0, utf16: 0, inRt: true });
		expect(runPointAt(rtText, 1, 'end')).toEqual({ p: 0, r: 0, utf16: 2, inRt: true });
	});

	it('a selection that starts inside a reading starts at the start of its word', () => {
		const container = mount(withRuby);
		const range = document.createRange();
		range.setStart(container.querySelector('rt')!.firstChild!, 1);
		range.setEnd(container.querySelector('[data-o="2"]')!.firstChild!, 1);
		expect(selectionSpan(container, range, () => plainRuns)).toEqual({ p: 0, start: 0, end: 3 });
	});
});
