import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { errorText } from './apiErrors';
import { UserError } from './userError';

// A screen shows an error through errorText: the catalogue text of a known API code, the translated text of a
// UserError, else its own fallback — never an English message (#168).
describe('errorText', () => {
	it('shows a UserError by its catalogue key and arguments', () => {
		const err = new UserError('study.fsrs.previewFailed');
		expect(err).toBeInstanceOf(Error);
		expect(errorText(err, 'fallback')).toBe(errorText(new UserError('study.fsrs.previewFailed'), 'other'));
		expect(errorText(err, 'fallback')).not.toBe('fallback');
	});

	it('shows a known API code by its catalogue text and nothing else by the server message', () => {
		const known = new ApiError(404, JSON.stringify({ error: 'workspace_not_found', message: 'English.' }));
		expect(errorText(known, 'f')).toBe('This workspace no longer exists.');
		expect(errorText(new ApiError(400, 'plain server text'), 'f')).toBe('f');
		expect(errorText(new Error('developer English'), 'f')).toBe('f');
		expect(errorText(new TypeError('Failed to fetch'), 'f')).toBe('f');
		expect(errorText('a string', 'f')).toBe('f');
	});
});

describe('packErrorDetail', () => {
	it("is the pack validator's English reason of a pack_invalid answer, and nothing for anything else", async () => {
		const { packErrorDetail } = await import('./apiErrors');
		const invalid = new ApiError(400, JSON.stringify({ error: 'pack_invalid', message: 'invalid pack: license is required' }));
		expect(packErrorDetail(invalid)).toBe('invalid pack: license is required');
		expect(packErrorDetail(new ApiError(500, JSON.stringify({ error: 'internal', message: 'Internal server error.' })))).toBe('');
		expect(packErrorDetail(new ApiError(400, 'invalid pack: x'))).toBe('');
		expect(packErrorDetail(new Error('x'))).toBe('');
	});
});
