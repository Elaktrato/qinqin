import { describe, expect, it } from 'vitest';
import { workspaceForBook } from './readingWorkspace';

const ja = { id: 1, language: 'ja' };
const zh = { id: 2, language: 'zh' };
const zh2 = { id: 3, language: 'zh' };

describe('workspaceForBook', () => {
	it('prefers the workspace matching the book language over the selected one', () => {
		expect(workspaceForBook([ja, zh], ja, 'zh')).toBe(2);
	});

	it('falls back to the selected workspace without a match', () => {
		expect(workspaceForBook([ja, zh], ja, 'ko')).toBe(1);
	});

	it('falls back to the selected workspace for a book without a language', () => {
		expect(workspaceForBook([ja, zh], zh, '')).toBe(2);
		expect(workspaceForBook([ja, zh], zh, undefined)).toBe(2);
	});

	it('is null with neither a match nor a selection', () => {
		expect(workspaceForBook([ja], null, 'zh')).toBeNull();
		expect(workspaceForBook([], null, 'zh')).toBeNull();
	});

	it('picks the selected one among several same-language workspaces', () => {
		expect(workspaceForBook([ja, zh, zh2], zh2, 'zh')).toBe(3);
	});

	it('picks the first same-language workspace when the selection does not match', () => {
		expect(workspaceForBook([ja, zh, zh2], ja, 'zh')).toBe(2);
	});
});
