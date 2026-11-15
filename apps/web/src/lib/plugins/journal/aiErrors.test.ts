import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { aiErrorView } from './aiErrors';

function err(status: number, error: string, message = '', retry?: number): ApiError {
	return new ApiError(status, JSON.stringify({ error, message }), retry);
}

describe('aiErrorView with several providers', () => {
	it('no_vision offers offline reading and does not send the learner to settings', () => {
		const v = aiErrorView(err(409, 'no_vision', 'deepseek-v4-pro on DeepSeek can\'t read photos. Read it offline instead.'), 'transcribe');
		expect(v.offlineInstead).toBe(true);
		expect(v.settingsLink).toBe(false);
		expect(v.text).toContain("can't read photos");
	});

	it.each(['no_selection', 'provider_disabled'])('%s links to settings', (code) => {
		const v = aiErrorView(err(409, code), 'review');
		expect(v.settingsLink).toBe(true);
		expect(v.text.length).toBeGreaterThan(10);
	});

	it.each(['no_vision', 'unknown_provider', 'endpoint_blocked', 'forbidden', 'invalid_endpoint'])(
		'%s has a fallback text when the server sends none',
		(code) => {
			expect(aiErrorView(err(422, code), 'review').text).not.toBe('Something went wrong. Try again.');
		}
	);

	it('no_selection reads as the choose-a-provider message', () => {
		expect(aiErrorView(err(409, 'no_selection'), 'ideas').text).toBe('Choose which provider to use in Settings → AI.');
	});
});

describe('aiErrorView', () => {
	it.each(['no_key', 'key_rejected', 'key_undecryptable', 'ai_disabled', 'quota', 'model_unavailable'])(
		'%s links to settings',
		(code) => {
			const v = aiErrorView(err(409, code, 'Server says so.'), 'review');
			expect(v.settingsLink).toBe(true);
			expect(v.text).toBe('Server says so.');
			expect(v.poll).toBe(false);
		}
	);

	it.each(['busy', 'refused', 'truncated', 'bad_reply', 'bad_request', 'in_flight', 'too_long', 'empty', 'rate_limited'])(
		'%s has no settings link and a fallback text',
		(code) => {
			const v = aiErrorView(err(422, code), 'review');
			expect(v.settingsLink).toBe(false);
			expect(v.text.length).toBeGreaterThan(5);
		}
	);

	it('passes Retry-After through', () => {
		expect(aiErrorView(err(429, 'rate_limited', 'Wait.', 120), 'ideas').retryAfterSeconds).toBe(120);
	});

	it('offers offline reading only when transcribing', () => {
		expect(aiErrorView(err(409, 'no_key'), 'transcribe').offlineInstead).toBe(true);
		expect(aiErrorView(err(409, 'no_key'), 'review').offlineInstead).toBe(false);
	});

	it('polls after a network error or a gateway timeout on review and ideas', () => {
		expect(aiErrorView(new TypeError('Failed to fetch'), 'review').poll).toBe(true);
		expect(aiErrorView(new ApiError(504, 'gateway timeout'), 'ideas').poll).toBe(true);
		expect(aiErrorView(new ApiError(502, 'bad gateway'), 'review').poll).toBe(true);
		expect(aiErrorView(new TypeError('Failed to fetch'), 'transcribe').poll).toBe(false);
	});

	it('maps a 401 and unknown errors to the generic text', () => {
		expect(aiErrorView(new ApiError(401, 'unauthorized'), 'review').text).toBe('Something went wrong. Try again.');
		expect(aiErrorView(new Error('boom'), 'review').text).toBe('Something went wrong. Try again.');
		expect(aiErrorView(err(500, 'weird_code'), 'review').text).toBe('Something went wrong. Try again.');
	});

	it('says how long to wait once, in a unit a person reads', () => {
		const busy = aiErrorView(err(503, 'busy', 'The provider is busy. Try again in a moment.', 30), 'review');
		expect(busy.text).toBe('The provider is busy. Try again in 30 s.');
		const limited = aiErrorView(
			err(429, 'rate_limited', 'You have used 30 AI calls this hour. Try again in 53 minutes.', 3138),
			'review'
		);
		expect(limited.text).toBe('You have used 30 AI calls this hour. Try again in 53 minutes.');
		const plain = aiErrorView(err(429, 'rate_limited', 'Wait.', 120), 'ideas');
		expect(plain.text).toBe('Wait. Try again in 2 minutes.');
	});
});

describe('plain-text 404', () => {
	const plain = new ApiError(404, 'not found');

	it('names the entry for a review', () => {
		expect(aiErrorView(plain, 'review').text).toBe('This entry was deleted.');
	});

	it('names the photo draft for a transcription', () => {
		const v = aiErrorView(plain, 'transcribe');
		expect(v.text).toBe('This photo draft expired. Choose the photo again.');
		expect(v.offlineInstead).toBe(false);
	});

	it('stays generic for ideas', () => {
		expect(aiErrorView(plain, 'ideas').text).toBe('Something went wrong. Try again.');
	});

	it('says the workspace is gone for the workspace 404', () => {
		expect(aiErrorView(new ApiError(404, 'workspace not found'), 'review').text).toBe(
			'This workspace no longer exists.'
		);
	});
});
