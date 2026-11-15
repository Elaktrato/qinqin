// The AI key and status routes (server: handlers_ai.go). The key itself
// is only ever sent, never read back.

import { api } from './client';

export interface StoredKey {
	provider: string;
	hint: string;
	model: string;
	state: 'ok' | 'undecryptable';
	createdAt: string;
	lastUsedAt?: string;
}

export interface AiStatus {
	secret: 'ok' | 'missing' | 'invalid';
	provider: 'anthropic' | 'fake';
	key: StoredKey | null;
	models: { id: string; label: string }[];
	usage: {
		callsLastHour: number;
		limitPerHour: number;
		inputTokens: number;
		outputTokens: number;
	};
	available: boolean;
	reason: string;
}

export function getAiStatus(): Promise<AiStatus> {
	return api<AiStatus>('/api/ai/status');
}

/** Stores the key and model, then returns the fresh status. */
export async function saveAiKey(key: string, model: string): Promise<AiStatus> {
	await api('/api/ai/key', { method: 'PUT', body: { provider: 'anthropic', key, model } });
	return getAiStatus();
}

/** Changes only the model of the stored key. */
export async function setAiModel(model: string): Promise<AiStatus> {
	await api('/api/ai/key', { method: 'PUT', body: { provider: 'anthropic', model } });
	return getAiStatus();
}

export async function deleteAiKey(): Promise<void> {
	await api('/api/ai/key', { method: 'DELETE' });
}
