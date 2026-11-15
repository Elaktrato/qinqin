import { describe, expect, it } from 'vitest';
import type { AiStatus } from '$lib/api/ai';
import { aiSettingsView } from './aiSettingsView';

const MODELS = [
	{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }
];

function status(over: Partial<AiStatus> = {}, reason = ''): AiStatus {
	return {
		secret: 'ok',
		provider: 'anthropic',
		key: null,
		models: MODELS,
		usage: { callsLastHour: 0, limitPerHour: 30, inputTokens: 0, outputTokens: 0 },
		available: reason === '',
		reason,
		...over
	};
}

describe('aiSettingsView banner', () => {
	it('has no banner when everything works or only the key is missing', () => {
		expect(aiSettingsView(status()).banner).toBeNull();
		expect(aiSettingsView(status({}, 'no_key')).banner).toBeNull();
	});

	it('explains each server-side reason', () => {
		expect(aiSettingsView(status({ secret: 'missing' }, 'no_secret')).banner).toBe(
			'AI features are off on this server: the administrator has not set QINQIN_SECRET.'
		);
		expect(aiSettingsView(status({ secret: 'invalid' }, 'invalid_secret')).banner).toBe(
			'AI features are off: QINQIN_SECRET is set but invalid (it must be 32 random bytes, base64).'
		);
		expect(aiSettingsView(status({}, 'key_undecryptable')).banner).toBe(
			'Your saved key can no longer be read (the server secret changed). Enter it again.'
		);
		expect(aiSettingsView(status({}, 'no_provider')).banner).toBe(
			"AI features are off: the server's AI provider setting is invalid."
		);
	});

	it('shows nothing for an unknown reason rather than guessing', () => {
		expect(aiSettingsView(status({}, 'something_new')).banner).toBeNull();
	});
});

describe('aiSettingsView canAddKey', () => {
	it('is false when the server cannot hold a key', () => {
		for (const reason of ['no_secret', 'invalid_secret', 'no_provider']) {
			expect(aiSettingsView(status({}, reason)).canAddKey).toBe(false);
		}
	});

	it('is true otherwise, also to replace an unreadable key', () => {
		for (const reason of ['', 'no_key', 'key_undecryptable']) {
			expect(aiSettingsView(status({}, reason)).canAddKey).toBe(true);
		}
	});
});

describe('aiSettingsView lines', () => {
	it('formats the key line with the model label', () => {
		const key = {
			provider: 'anthropic',
			hint: '…1234',
			model: 'claude-opus-5-5',
			state: 'ok' as const,
			createdAt: ''
		};
		expect(aiSettingsView(status({ key })).keyLine).toBe('Anthropic key …1234 · Claude Opus 5.5');
	});

	it('falls back to the model id when it is not listed, and has no line without a key', () => {
		const key = {
			provider: 'anthropic',
			hint: '…9',
			model: 'claude-x',
			state: 'ok' as const,
			createdAt: ''
		};
		expect(aiSettingsView(status({ key })).keyLine).toBe('Anthropic key …9 · claude-x');
		expect(aiSettingsView(status()).keyLine).toBeNull();
	});

	it('formats usage with grouped numbers', () => {
		const usage = { callsLastHour: 3, limitPerHour: 30, inputTokens: 12345, outputTokens: 2345 };
		expect(aiSettingsView(status({ usage })).usageLine).toBe(
			'3 of 30 AI calls this hour · 12,345 tokens in, 2,345 out'
		);
	});

	it('flags the fake provider', () => {
		expect(aiSettingsView(status({ provider: 'fake' })).testProvider).toBe(true);
		expect(aiSettingsView(status()).testProvider).toBe(false);
	});
});

describe('aiSettingsView canRemoveKey', () => {
	const key = { hint: '…abcd', model: 'claude-opus-5-5' } as AiStatus['key'];

	it('is offered whenever a key is stored, even when adding is not', () => {
		for (const reason of ['', 'no_secret', 'invalid_secret', 'no_provider', 'key_undecryptable']) {
			expect(aiSettingsView(status({ key }, reason)).canRemoveKey).toBe(true);
		}
		expect(aiSettingsView(status({ key }, 'no_secret')).canAddKey).toBe(false);
	});

	it('is not offered without a key', () => {
		expect(aiSettingsView(status()).canRemoveKey).toBe(false);
	});
});
