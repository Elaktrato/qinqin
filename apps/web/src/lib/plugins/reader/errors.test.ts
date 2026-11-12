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

	it('only maps 422 specially for upload', () => {
		expect(apiErrorMessage(new ApiError(422, ''), 'import')).not.toMatch(/epub/);
	});
});
