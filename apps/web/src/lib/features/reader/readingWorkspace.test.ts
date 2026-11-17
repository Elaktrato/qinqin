import { describe, expect, it } from 'vitest';
import { workspaceForBook } from './readingWorkspace';

const ja = { id: 1, language: 'ja' };
const zh = { id: 2, language: 'zh' };
const zh2 = { id: 3, language: 'zh' };

describe('workspaceForBook', () => {
	it('credits the workspace the book belongs to, whatever is selected', () => {
		expect(workspaceForBook({ workspaceId: 3, language: 'zh' }, [ja, zh, zh2], ja)).toBe(3);
		expect(workspaceForBook({ workspaceId: 3, language: 'zh' }, [ja, zh, zh2], zh)).toBe(3);
	});

	it('trusts the book before the workspace list has loaded', () => {
		expect(workspaceForBook({ workspaceId: 3, language: 'zh' }, [], null)).toBe(3);
	});

	describe('a book without a workspace (older server)', () => {
		it('prefers the workspace matching the book language over the selected one', () => {
			expect(workspaceForBook({ language: 'zh' }, [ja, zh], ja)).toBe(2);
			expect(workspaceForBook({ workspaceId: 0, language: 'zh' }, [ja, zh], ja)).toBe(2);
		});

		it('picks the selected one among several same-language workspaces', () => {
			expect(workspaceForBook({ language: 'zh' }, [ja, zh, zh2], zh2)).toBe(3);
		});

		it('falls back to the selected workspace without a match or a language', () => {
			expect(workspaceForBook({ language: 'ko' }, [ja, zh], ja)).toBe(1);
			expect(workspaceForBook({ language: '' }, [ja, zh], zh)).toBe(2);
		});

		it('is null with neither a match nor a selection', () => {
			expect(workspaceForBook({ language: 'zh' }, [ja], null)).toBeNull();
		});
	});
});
