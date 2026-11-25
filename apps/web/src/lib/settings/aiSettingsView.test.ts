import { describe, expect, it } from 'vitest';
import type { AiStatus, ProviderInfo, ProvidersResponse, StoredKey } from '$lib/api/ai';
import { aiBanner, aiSettingsView, modelSuggestions, privacyNote } from './aiSettingsView';

const provider = (over: Partial<ProviderInfo> & { id: string }): ProviderInfo => ({
	name: over.id,
	kind: 'openai',
	custom: false,
	keyRequired: true,
	defaultModel: 'm',
	models: [{ id: 'm', label: 'M' }],
	structured: 'json_schema',
	vision: true,
	...over
});

const ANTHROPIC = provider({
	id: 'anthropic', name: 'Anthropic', kind: 'anthropic', defaultModel: 'claude-opus-5-5',
	models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }]
});
const DEEPSEEK = provider({
	id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-flash', structured: 'json_object',
	models: [
		{ id: 'deepseek-flash', label: 'DeepSeek Flash', vision: true },
		{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', vision: false }
	]
});
const OPENAI = provider({ id: 'openai', name: 'OpenAI' });
const CUSTOM = provider({ id: 'custom-abcdefghij', name: 'Company gateway', custom: true, host: 'llm.example.com', keyRequired: false, structured: 'json_object' });

const PROVIDERS: ProvidersResponse = {
	providers: [ANTHROPIC, OPENAI, DEEPSEEK, CUSTOM],
	canManageCustom: false,
	privateAllowed: false
};

const key = (id: string, model: string, over: Partial<StoredKey> = {}): StoredKey => ({
	provider: id, hint: '…1234', model, state: 'ok', createdAt: '', ...over
});

function status(over: Partial<AiStatus> = {}, reason = ''): AiStatus {
	return {
		secret: 'ok', provider: '', fake: false, key: null, keys: [], active: null, models: [],
		usage: { callsLastHour: 0, limitPerHour: 30, inputTokens: 0, outputTokens: 0 },
		available: reason === '', reason, ...over
	};
}

describe('banner', () => {
	it('has none when everything works or only a key is missing', () => {
		expect(aiSettingsView(status(), PROVIDERS).banner).toBeNull();
		expect(aiSettingsView(status({}, 'no_key'), PROVIDERS).banner).toBeNull();
	});

	it('keeps the server-side texts', () => {
		expect(aiSettingsView(status({ secret: 'missing' }, 'no_secret'), PROVIDERS).banner).toBe(
			'AI features are off on this server: the administrator has not set QINQIN_SECRET.'
		);
		expect(aiSettingsView(status({ secret: 'invalid' }, 'invalid_secret'), PROVIDERS).banner).toBe(
			'AI features are off: QINQIN_SECRET is set but invalid (it must be 32 random bytes, base64).'
		);
		expect(aiSettingsView(status({}, 'key_undecryptable'), PROVIDERS).banner).toBe(
			'Your saved key can no longer be read (the server secret changed). Enter it again.'
		);
		expect(aiSettingsView(status({}, 'no_provider'), PROVIDERS).banner).toBe(
			"AI features are off: the server's AI provider setting is invalid."
		);
	});

	it('asks to choose a provider when keys exist but none is active', () => {
		expect(aiSettingsView(status({}, 'no_selection'), PROVIDERS).banner).toBe('Choose which provider to use.');
		expect(aiSettingsView(status({}, 'provider_disabled'), PROVIDERS).banner).toBe(
			'The provider you chose is turned off on this server. Choose another one.'
		);
	});

	it('shows nothing for an unknown reason rather than guessing', () => {
		expect(aiSettingsView(status({}, 'something_new'), PROVIDERS).banner).toBeNull();
	});
});

describe('canAddKey', () => {
	it('is false when the server cannot hold a key', () => {
		for (const reason of ['no_secret', 'invalid_secret', 'no_provider']) {
			expect(aiSettingsView(status({}, reason), PROVIDERS).canAddKey).toBe(false);
		}
	});

	it('is true otherwise, also to replace an unreadable key', () => {
		for (const reason of ['', 'no_key', 'no_selection', 'key_undecryptable', 'provider_disabled']) {
			expect(aiSettingsView(status({}, reason), PROVIDERS).canAddKey).toBe(true);
		}
	});
});

describe('rows', () => {
	it('orders the active provider first and keeps the rest in stored order', () => {
		const keys = [key('anthropic', 'claude-opus-5-5'), key('openai', 'm'), key('deepseek', 'deepseek-v4-pro')];
		const rows = aiSettingsView(status({ keys, active: { provider: 'deepseek', name: 'DeepSeek', model: 'deepseek-v4-pro', vision: false, structured: 'json_object' } }), PROVIDERS).rows;
		expect(rows.map((r) => r.id)).toEqual(['deepseek', 'anthropic', 'openai']);
		expect(rows.map((r) => r.active)).toEqual([true, false, false]);
	});

	it('fills name, model label, vision (model override) and structured label', () => {
		const keys = [key('deepseek', 'deepseek-v4-pro'), key('anthropic', 'claude-sonnet-5-5'), key('openai', 'my-own-model')];
		const rows = aiSettingsView(status({ keys }), PROVIDERS).rows;
		const by = Object.fromEntries(rows.map((r) => [r.id, r]));
		expect(by.deepseek).toMatchObject({ name: 'DeepSeek', modelLabel: 'DeepSeek V4 Pro', vision: false, structuredLabel: 'JSON mode', hint: '…1234' });
		expect(by.anthropic).toMatchObject({ modelLabel: 'Claude Sonnet 5.5', vision: true, structuredLabel: 'Structured replies' });
		expect(by.openai).toMatchObject({ modelLabel: 'my-own-model', vision: true });
	});

	it('marks an unreadable key', () => {
		const rows = aiSettingsView(status({ keys: [key('openai', 'm', { state: 'undecryptable' })] }), PROVIDERS).rows;
		expect(rows[0].state).toBe('undecryptable');
		expect(rows[0].stateText).toBe('Enter the key again');
	});

	it('lists a key of a turned-off provider as disabled, Remove only', () => {
		const rows = aiSettingsView(
			status({ keys: [key('gemini', 'gemini-3.8-flash')], disabledProviders: ['gemini'] }),
			PROVIDERS
		).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: 'gemini', name: 'Google Gemini', state: 'disabled', stateText: 'Turned off by the server' });
	});

	it('shows the admin host for a custom endpoint', () => {
		const rows = aiSettingsView(status({ keys: [key('custom-abcdefghij', 'llama')] }), PROVIDERS).rows;
		expect(rows[0]).toMatchObject({ custom: true, adminLine: 'Added by your admin · llm.example.com' });
	});
});

describe('addable', () => {
	it('excludes configured providers and groups built-in and custom', () => {
		const v = aiSettingsView(status({ keys: [key('anthropic', 'claude-opus-5-5')] }), PROVIDERS);
		expect(v.addable.builtin.map((p) => p.id)).toEqual(['openai', 'deepseek']);
		expect(v.addable.custom.map((p) => p.id)).toEqual(['custom-abcdefghij']);
		const all = aiSettingsView(status({ keys: [key('anthropic', 'm'), key('openai', 'm'), key('deepseek', 'm'), key('custom-abcdefghij', 'm')] }), PROVIDERS);
		expect(all.addable.builtin).toEqual([]);
		expect(all.addable.custom).toEqual([]);
	});

	it('reports canManageCustom from the providers response', () => {
		expect(aiSettingsView(status(), PROVIDERS).canManageCustom).toBe(false);
		expect(aiSettingsView(status(), { ...PROVIDERS, canManageCustom: true }).canManageCustom).toBe(true);
	});
});

describe('lines and helpers', () => {
	it('formats usage with grouped numbers', () => {
		const usage = { callsLastHour: 3, limitPerHour: 30, inputTokens: 12345, outputTokens: 2345 };
		expect(aiSettingsView(status({ usage }), PROVIDERS).usageLine).toBe('3 of 30 AI calls this hour · 12,345 tokens in, 2,345 out');
	});

	it('flags the fake provider', () => {
		expect(aiSettingsView(status({ fake: true }), PROVIDERS).testProvider).toBe(true);
		expect(aiSettingsView(status(), PROVIDERS).testProvider).toBe(false);
	});

	it('words the privacy note with the provider name', () => {
		expect(privacyNote('DeepSeek')).toBe(
			"Your journal text, conversation messages, guidance, the photos you choose to read with AI and the words you ask examples for, with their examples (your own saved sentences among them), are sent to DeepSeek when you press a button. DeepSeek's terms apply."
		);
	});

	it('suggests the provider models', () => {
		expect(modelSuggestions(DEEPSEEK).map((m) => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
		expect(modelSuggestions(undefined)).toEqual([]);
	});
});

describe('aiBanner', () => {
	it('is the banner of a status alone (the journal page has no registry)', () => {
		expect(aiBanner(status({}, 'no_selection'))).toBe('Choose which provider to use.');
		expect(aiBanner(status())).toBeNull();
	});
});
