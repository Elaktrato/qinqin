import { describe, expect, it } from 'vitest';
import { anchorAnnotations, isOutdated, segments } from './anchor';
import { textHash } from './textHash';
import type { Annotation, Review } from './types';

const TEXT = '我昨天去学校。我去学校了。';

function ann(id: string, quote: string, prefix: string, suffix: string): Annotation {
	return { id, quote, prefix, suffix, correction: 'x', explanation: 'e', category: 'c' };
}

// Server-shaped: 8 code points of context on each side (journal.ResolveAnnotations).
const first = ann('a1', '去学校', '我昨天', '。我去学校了。');
const second = ann('a2', '去学校', '我昨天去学校。我', '了。');

describe('anchorAnnotations', () => {
	it('places both occurrences', () => {
		const r = anchorAnnotations(TEXT, [first, second]);
		expect(r.placed.map((p) => [p.annotation.id, p.start, p.end])).toEqual([
			['a1', 3, 6],
			['a2', 8, 11]
		]);
		expect(r.missing).toEqual([]);
		expect(r.listOnly).toEqual([]);
	});

	it('re-anchors after an insertion at the front', () => {
		const r = anchorAnnotations('今天' + TEXT, [first, second]);
		expect(r.placed.map((p) => [p.start, p.end])).toEqual([
			[5, 8],
			[10, 13]
		]);
	});

	it('loses the second but keeps the first after deleting the second sentence', () => {
		const r = anchorAnnotations('我昨天去学校。', [first, second]);
		expect(r.placed.map((p) => [p.annotation.id, p.start])).toEqual([['a1', 3]]);
		expect(r.missing.map((a) => a.id)).toEqual(['a2']);
	});

	it('places a unique quote even when both contexts changed', () => {
		const a = ann('a1', '学校', 'xxxx', 'yyyy');
		const r = anchorAnnotations('我们去学校了', [a]);
		expect(r.placed).toHaveLength(1);
		expect(r.placed[0].start).toBe(3);
	});

	it('never picks one of two duplicated quotes when neither side matches', () => {
		const a = ann('a1', '去学校', 'xxxx', 'yyyy');
		const r = anchorAnnotations(TEXT, [a]);
		expect(r.placed).toEqual([]);
		expect(r.missing).toEqual([a]);
	});

	it('uses a prefix match alone, then a suffix match alone', () => {
		const byPrefix = ann('a1', '去学校', '我昨天', 'changed');
		expect(anchorAnnotations(TEXT, [byPrefix]).placed[0].start).toBe(3);
		const bySuffix = ann('a1', '去学校', 'changed', '了。');
		expect(anchorAnnotations(TEXT, [bySuffix]).placed[0].start).toBe(8);
	});

	it('works at the start and end of the text', () => {
		const a = ann('a1', '我昨', '', '天去学校。我去学校');
		expect(anchorAnnotations(TEXT, [a]).placed[0].start).toBe(0);
		const b = ann('b1', '了。', '去学校', '');
		expect(anchorAnnotations(TEXT, [b]).placed[0].end).toBe(TEXT.length);
	});

	it('lists an overlapping annotation only in the list', () => {
		const a = ann('a1', '去学校', '我昨天', '。我去学校了。');
		const b = ann('b1', '学校。', '我昨天去', '我去学校了。');
		const r = anchorAnnotations(TEXT, [a, b]);
		expect(r.placed.map((p) => p.annotation.id)).toEqual(['a1']);
		expect(r.listOnly.map((x) => x.id)).toEqual(['b1']);
	});

	it('keeps offsets right after an emoji (UTF-16 surrogate pair)', () => {
		const text = '😀我去学校';
		const r = anchorAnnotations(text, [ann('a1', '去学校', '😀我', '')]);
		expect(r.placed[0].start).toBe(3);
		expect(text.slice(r.placed[0].start, r.placed[0].end)).toBe('去学校');
	});

	it('treats an empty quote as missing', () => {
		const a = ann('a1', '', '', '');
		expect(anchorAnnotations(TEXT, [a]).missing).toEqual([a]);
	});
});

describe('segments', () => {
	it('covers the text exactly and carries the ids', () => {
		const r = anchorAnnotations(TEXT, [first, second]);
		const segs = segments(TEXT, r.placed);
		expect(segs.map((s) => s.text).join('')).toBe(TEXT);
		expect(segs.filter((s) => s.annotationId).map((s) => s.annotationId)).toEqual(['a1', 'a2']);
	});

	it('returns the whole text when nothing is placed', () => {
		expect(segments(TEXT, [])).toEqual([{ text: TEXT }]);
		expect(segments('', [])).toEqual([]);
	});
});

describe('isOutdated', () => {
	it('compares the hash', () => {
		const review = { textHash: textHash(TEXT) } as Review;
		expect(isOutdated(TEXT, review)).toBe(false);
		expect(isOutdated(TEXT + '!', review)).toBe(true);
	});
});
