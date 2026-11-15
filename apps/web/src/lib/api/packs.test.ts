import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { ApiError } from './client';
import { MAX_PACK_UPLOAD, stagePack } from './packs';

describe('stagePack', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('refuses a zip over the server limit without sending it', async () => {
		const xhr = vi.fn();
		vi.stubGlobal('XMLHttpRequest', xhr);
		const big = { name: 'big.zip', size: MAX_PACK_UPLOAD + 1 } as unknown as File;
		const err = (await stagePack(big).catch((e: Error) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(413);
		expect(err.message).toBe('pack zip larger than 128 MiB — use qinqin seed for larger packs');
		expect(xhr).not.toHaveBeenCalled();
	});

	it('limits at exactly 128 MiB', () => {
		expect(MAX_PACK_UPLOAD).toBe(128 * 1024 * 1024);
	});
});
