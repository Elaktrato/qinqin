import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { API_ERROR_KEYS, apiErrorText } from './apiErrors';
import { authErrorMessage } from './authErrors';
import en from '$lib/i18n/messages/en.json';

// API errors are shown by code from the catalogue (spec "Server-side text"): the server's `message` stays an
// English sentence for developers and logs; the client never shows it. The code list is the contract's
// (docs/contracts/auth/errors.json, which also carries the area codes: study, sync, packages), read here, not
// counted.

const errors: Record<string, unknown> = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/auth/errors.json'), 'utf8')
);
const codes = Object.keys(errors).filter((k) => !k.startsWith('_'));
const json = (error: string, message: string) => JSON.stringify({ error, message });

/** `rate_limited` → `rateLimited`: the key segment of a code. */
const camel = (code: string) => code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

describe('apiError catalogue', () => {
	it('reads a non-empty code list', () => {
		expect(codes.length).toBeGreaterThan(0);
		expect(codes).toContain('download_busy');
	});

	it.each(codes)('%s has an apiError key with text', (code) => {
		expect(API_ERROR_KEYS[code]).toBe(`apiError.${camel(code)}`);
		expect(Object.hasOwn(en, `apiError.${camel(code)}`)).toBe(true);
		expect(apiErrorText(code).trim()).not.toBe('');
		expect(apiErrorText(code)).not.toContain('Something went wrong');
	});

	it('maps nothing that is not a contract code', () => {
		expect(Object.keys(API_ERROR_KEYS).filter((c) => !codes.includes(c))).toEqual([]);
	});

	it('shows the generic text with the code for a code it does not know, never the English message', () => {
		expect(apiErrorText('brand_new')).toBe('Something went wrong (brand_new).');
		expect(authErrorMessage(new ApiError(400, json('brand_new', 'A newer server explains it.')), 'f')).toBe(
			'Something went wrong (brand_new).'
		);
		expect(apiErrorText('constructor')).toBe('Something went wrong (constructor).');
	});

	it('never shows the message of a known code', () => {
		expect(authErrorMessage(new ApiError(503, json('busy', 'server English')), 'f')).toBe(apiErrorText('busy'));
		expect(authErrorMessage(new ApiError(422, json('weak_password', 'server English')), 'f')).toBe(
			apiErrorText('weak_password')
		);
	});

	it('words rate_limited from the caller context, not from the message', () => {
		const err = (message: string) => new ApiError(429, json('rate_limited', message), 6);
		expect(authErrorMessage(err('Too many attempts. Try again in 6 seconds.'), 'f')).toBe(
			'Too many sign-in attempts. Try again in 6 seconds.'
		);
		expect(authErrorMessage(err('Too many sign-in attempts.'), 'f', 'register')).toBe(
			'Too many attempts. Try again in 6 seconds.'
		);
		expect(authErrorMessage(new ApiError(429, json('rate_limited', 'Try later.')), 'f')).toBe(
			apiErrorText('rate_limited')
		);
	});
});
