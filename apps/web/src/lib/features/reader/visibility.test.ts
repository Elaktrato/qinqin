import { describe, expect, it } from 'vitest';
import { topParagraph } from './visibility';

describe('topParagraph (first paragraph in view)', () => {
	const entry = (p: number, isIntersecting: boolean) => ({
		isIntersecting,
		target: { dataset: { p: String(p) } }
	});

	it('tracks the smallest intersecting paragraph across batches', () => {
		const visible = new Set<number>();
		expect(topParagraph(visible, [entry(3, true), entry(4, true), entry(5, true)])).toBe(3);
		expect(topParagraph(visible, [entry(3, false), entry(6, true)])).toBe(4);
		expect(topParagraph(visible, [entry(2, true)])).toBe(2);
	});

	it('returns null while nothing is in view, keeping the last place to the caller', () => {
		const visible = new Set<number>();
		expect(topParagraph(visible, [entry(1, true)])).toBe(1);
		expect(topParagraph(visible, [entry(1, false)])).toBeNull();
	});

	it('accepts real observer entries (target typed as Element)', () => {
		const visible = new Set<number>();
		const records: { isIntersecting: boolean; target: Element }[] = [];
		expect(topParagraph(visible, records)).toBeNull();
	});

	it('ignores targets without a paragraph index', () => {
		const visible = new Set<number>();
		const stray = { isIntersecting: true, target: { dataset: {} } };
		expect(topParagraph(visible, [stray, entry(7, true)])).toBe(7);
		expect(visible.size).toBe(1);
	});
});
