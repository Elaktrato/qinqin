import { describe, expect, it } from 'vitest';
import { entryLabel } from './entryLabel';

const base = { id: 'x', date: '2026-01-01', source: 'typed' as const, createdAt: '', updatedAt: '' };

describe('entryLabel', () => {
	it('prefers the title', () => {
		expect(entryLabel({ ...base, title: ' My day ', text: 'abc' })).toBe('My day');
	});

	it('falls back to the first non-empty line, cut at 60 code points', () => {
		expect(entryLabel({ ...base, title: '', text: '\n\n今日は天気です\nsecond' })).toBe('今日は天気です');
		expect(entryLabel({ ...base, title: '', text: '😀'.repeat(70) })).toBe('😀'.repeat(60) + '…');
	});

	it('names an empty entry', () => {
		expect(entryLabel({ ...base, title: '', text: '  ' })).toBe('Untitled entry');
	});
});
