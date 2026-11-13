import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { apiErrorMessage } from './errors';

describe('apiErrorMessage', () => {
	it('maps known statuses', () => {
		expect(apiErrorMessage(new ApiError(409, 'x'), 'import')).toMatch(/already in your library/);
		expect(apiErrorMessage(new ApiError(413, 'x'), 'upload')).toMatch(/too large \(max 20 MB\)/);
		expect(apiErrorMessage(new ApiError(422, 'x'), 'upload')).toMatch(
			/could not be read as an epub, or its language is not Chinese or Japanese/
		);
		expect(apiErrorMessage(new ApiError(429, 'x'), 'import')).toMatch(
			/another import is already running, try again in a moment/i
		);
		expect(apiErrorMessage(new ApiError(502, 'x'), 'search')).toMatch(
			/source is unavailable right now, try again later/
		);
		expect(apiErrorMessage(new ApiError(404, 'x'), 'import')).toMatch(
			/not available from the source/
		);
	});

	it('uses a short plain server message otherwise', () => {
		expect(apiErrorMessage(new ApiError(400, 'bad query'), 'search')).toBe('bad query');
	});

	it('hides long or markup-laden server text', () => {
		expect(apiErrorMessage(new ApiError(500, 'x'.repeat(300)), 'list')).toMatch(/could not/i);
		expect(apiErrorMessage(new ApiError(500, '<html>boom</html>'), 'list')).toMatch(/could not/i);
	});

	it('falls back for network and unknown errors', () => {
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'delete')).toMatch(/could not/i);
		expect(apiErrorMessage('weird', 'upload')).toMatch(/could not/i);
	});

	it('keeps 404 import-only and 409 generic across contexts', () => {
		expect(apiErrorMessage(new ApiError(404, ''), 'list')).toMatch(/could not/i);
		expect(apiErrorMessage(new ApiError(409, ''), 'upload')).toMatch(/already in your library/);
	});

	it('explains a book in another language than the workspace', () => {
		const err = new ApiError(422, 'workspace language is ja, book is zh');
		expect(apiErrorMessage(err, 'upload')).toBe(
			'This book is in Chinese, but this workspace is Japanese. Switch to a Chinese workspace to add it.'
		);
		expect(apiErrorMessage(err, 'import')).toBe(
			'This book is in Chinese, but this workspace is Japanese. Switch to a Chinese workspace to add it.'
		);
	});

	it('has calm messages for browse suggestions', () => {
		expect(apiErrorMessage(new ApiError(501, 'x'), 'browse')).toBe(
			'This source has no suggestions. Search it instead.'
		);
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'browse')).toBe(
			'Could not load suggestions.'
		);
		expect(apiErrorMessage(new ApiError(502, 'x'), 'browse')).toMatch(/unavailable right now/);
	});

	it('only maps 422 specially for upload', () => {
		expect(apiErrorMessage(new ApiError(422, ''), 'import')).not.toMatch(/epub/);
	});

	it('explains missing books and chapters in the reading view', () => {
		expect(apiErrorMessage(new ApiError(404, ''), 'book')).toBe('This book is not in your library.');
		expect(apiErrorMessage(new ApiError(404, ''), 'chapter')).toBe('This chapter does not exist.');
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'book')).toBe('Could not load this book.');
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'chapter')).toBe(
			'Could not load this chapter.'
		);
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'lookup')).toBe(
			'Could not look this up.'
		);
	});

	it('explains the bookmark cap and has bookmark fallbacks', () => {
		expect(apiErrorMessage(new ApiError(409, 'too many bookmarks'), 'bookmark')).toBe(
			'This book already has the most bookmarks allowed (200). Delete one to add another.'
		);
		expect(apiErrorMessage(new ApiError(404, 'x'), 'bookmark')).toMatch(/bookmark no longer exists/);
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'bookmark')).toBe(
			'Could not save the bookmark.'
		);
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'bookmarks')).toBe(
			'Could not load the bookmarks.'
		);
	});

	it('explains the highlight cap and has highlight fallbacks', () => {
		expect(apiErrorMessage(new ApiError(409, 'too many highlights'), 'highlight')).toBe(
			'This book already has the most highlights allowed (2000). Delete one to add another.'
		);
		expect(apiErrorMessage(new ApiError(404, 'x'), 'highlight')).toBe('This highlight no longer exists.');
		// A highlight body over the server cap is not a file upload.
		for (const context of ['highlight', 'highlights'] as const) {
			expect(apiErrorMessage(new ApiError(413, 'highlight too large'), context)).toBe(
				'This highlight or its note is too long to save.'
			);
		}
		expect(apiErrorMessage(new ApiError(413, 'x'), 'upload')).toBe('This file is too large (max 20 MB).');
		expect(apiErrorMessage(new ApiError(422, 'note too long'), 'highlight')).toBe('note too long');
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'highlight')).toBe(
			'Could not save the highlight.'
		);
		expect(apiErrorMessage(new TypeError('Failed to fetch'), 'highlights')).toBe(
			'Could not load the highlights.'
		);
	});
});
