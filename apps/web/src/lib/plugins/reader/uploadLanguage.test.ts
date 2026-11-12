import { describe, expect, it } from 'vitest';
import { initialUploadLanguage } from './uploadLanguage';

describe('initialUploadLanguage', () => {
	it('follows zh and ja workspaces', () => {
		expect(initialUploadLanguage('zh')).toBe('zh');
		expect(initialUploadLanguage('ja')).toBe('ja');
	});

	it('otherwise detects from the file', () => {
		expect(initialUploadLanguage('en')).toBe('');
		expect(initialUploadLanguage(null)).toBe('');
	});
});
