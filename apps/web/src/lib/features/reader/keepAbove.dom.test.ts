import { afterEach, describe, expect, it } from 'vitest';
import { scrollParent } from './keepAbove';

afterEach(() => {
	document.body.innerHTML = '';
});

function sized(el: HTMLElement, scrollHeight: number, clientHeight: number): HTMLElement {
	Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
	Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
	return el;
}

describe('scrollParent', () => {
	it('is the window (null) when no ancestor scrolls', () => {
		document.body.innerHTML = '<main><div><p id="w">字</p></div></main>';
		expect(scrollParent(document.getElementById('w')!)).toBeNull();
	});

	it('is the nearest ancestor that scrolls and has more content than room', () => {
		document.body.innerHTML = '<div id="outer" style="overflow-y: auto"><div id="inner" style="overflow-y: scroll"><p id="w">字</p></div></div>';
		sized(document.getElementById('outer')!, 2000, 500);
		const inner = sized(document.getElementById('inner')!, 300, 300);
		const w = document.getElementById('w')!;
		// The inner one has nothing to scroll: the outer one moves.
		expect(scrollParent(w)?.id).toBe('outer');
		sized(inner, 900, 300);
		expect(scrollParent(w)?.id).toBe('inner');
	});

	it('an ancestor that hides its overflow is not a scroller', () => {
		document.body.innerHTML = '<div id="clip" style="overflow: hidden"><p id="w">字</p></div>';
		sized(document.getElementById('clip')!, 2000, 500);
		expect(scrollParent(document.getElementById('w')!)).toBeNull();
	});
});
