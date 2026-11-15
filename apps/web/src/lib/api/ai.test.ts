import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ api: vi.fn() }));

import { api } from './client';
import {
	createCustomProvider,
	deleteAiKey,
	deleteCustomProvider,
	getAiProviders,
	getAiStatus,
	saveAiKey,
	setActiveProvider,
	setAiModel,
	testAiKey,
	updateCustomProvider
} from './ai';

const mocked = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

describe('ai api client', () => {
	it('lists providers and status', async () => {
		mocked.mockResolvedValue({ providers: [] });
		await getAiProviders();
		expect(mocked).toHaveBeenCalledWith('/api/ai/providers');
		await getAiStatus();
		expect(mocked).toHaveBeenLastCalledWith('/api/ai/status');
	});

	it('stores a key per provider, escaping the id, and returns the fresh status', async () => {
		mocked.mockResolvedValue({ reason: '' });
		await saveAiKey('open ai/x', 'sk-1', 'gpt-6-astra');
		expect(mocked).toHaveBeenNthCalledWith(1, '/api/ai/keys/open%20ai%2Fx', {
			method: 'PUT',
			body: { key: 'sk-1', model: 'gpt-6-astra' }
		});
		expect(mocked).toHaveBeenNthCalledWith(2, '/api/ai/status');
	});

	it('omits an empty key (keyless endpoints and model-only changes)', async () => {
		mocked.mockResolvedValue({});
		await saveAiKey('custom-abcdefghij', '', 'm');
		expect(mocked.mock.calls[0][1]).toEqual({ method: 'PUT', body: { model: 'm' } });
		await setAiModel('openai', 'gpt-6-luna');
		expect(mocked).toHaveBeenCalledWith('/api/ai/keys/openai', {
			method: 'PUT',
			body: { model: 'gpt-6-luna' }
		});
	});

	it('tests a key, activates a provider and deletes a key', async () => {
		mocked.mockResolvedValue({ reason: '' });
		await testAiKey('gemini');
		expect(mocked).toHaveBeenCalledWith('/api/ai/keys/gemini/test', { method: 'POST' });
		await setActiveProvider('gemini');
		expect(mocked).toHaveBeenCalledWith('/api/ai/active', { method: 'PUT', body: { provider: 'gemini' } });
		mocked.mockResolvedValue(undefined);
		await deleteAiKey('gemini');
		expect(mocked).toHaveBeenLastCalledWith('/api/ai/keys/gemini', { method: 'DELETE' });
	});

	it('manages custom endpoints', async () => {
		mocked.mockResolvedValue({});
		const input = {
			name: 'Local', baseUrl: 'https://x.example/v1', defaultModel: 'm', vision: true,
			keyRequired: true, structured: 'json_schema' as const
		};
		await createCustomProvider(input);
		expect(mocked).toHaveBeenCalledWith('/api/ai/custom-providers', { method: 'POST', body: input });
		await updateCustomProvider('custom-abc', { vision: false });
		expect(mocked).toHaveBeenCalledWith('/api/ai/custom-providers/custom-abc', {
			method: 'PATCH',
			body: { vision: false }
		});
		await deleteCustomProvider('custom-abc');
		expect(mocked).toHaveBeenLastCalledWith('/api/ai/custom-providers/custom-abc', { method: 'DELETE' });
	});
});
