// The AI routes (server: handlers_ai.go, handlers_ai_custom.go). A key is
// only ever sent, never read back.

import { api } from './client';

export interface StoredKey {
	provider: string;
	hint: string;
	model: string;
	state: 'ok' | 'undecryptable';
	createdAt: string;
	lastUsedAt?: string;
}

export type Structured = 'json_schema' | 'json_object' | 'prompt';

export interface ModelInfo {
	id: string;
	label: string;
	/** Overrides the provider's photo reading flag for this model. */
	vision?: boolean;
}

/** One provider as GET /api/ai/providers lists it. */
export interface ProviderInfo {
	id: string;
	name: string;
	kind: 'anthropic' | 'openai' | 'gemini';
	custom: boolean;
	keyRequired: boolean;
	keyUrl?: string;
	defaultModel: string;
	models: ModelInfo[];
	structured: Structured;
	vision: boolean;
	maxOutputTokens?: number;
	/** Custom endpoints only: the host for everyone, the full URL for admins. */
	host?: string;
	baseUrl?: string;
}

export interface ProvidersResponse {
	providers: ProviderInfo[];
	canManageCustom: boolean;
	privateAllowed: boolean;
}

export interface ActiveInfo {
	provider: string;
	name: string;
	model: string;
	vision: boolean;
	structured: Structured;
}

export interface AiStatus {
	secret: 'ok' | 'missing' | 'invalid';
	/** "fake" under the test switch, else the active provider id ("" when none). */
	provider: string;
	fake: boolean;
	/** The active provider's key. */
	key: StoredKey | null;
	keys: StoredKey[];
	active: ActiveInfo | null;
	models: { id: string; label: string }[];
	usage: {
		callsLastHour: number;
		limitPerHour: number;
		inputTokens: number;
		outputTokens: number;
	};
	available: boolean;
	reason: string;
	/** Providers with a stored key that the server turned off. */
	disabledProviders?: string[];
}

export interface CustomInput {
	name: string;
	baseUrl: string;
	defaultModel: string;
	vision: boolean;
	keyRequired: boolean;
	structured: Structured;
	maxOutputTokens?: number;
}

export interface CustomPatch {
	defaultModel?: string;
	vision?: boolean;
	structured?: Structured;
	maxOutputTokens?: number;
}

const keyPath = (provider: string): string => `/api/ai/keys/${encodeURIComponent(provider)}`;

export function getAiProviders(): Promise<ProvidersResponse> {
	return api<ProvidersResponse>('/api/ai/providers');
}

export function getAiStatus(): Promise<AiStatus> {
	return api<AiStatus>('/api/ai/status');
}

/** Stores the key (when given) and model for a provider, then returns the fresh status. */
export async function saveAiKey(provider: string, key: string, model: string): Promise<AiStatus> {
	const body: Record<string, string> = { model };
	if (key !== '') body.key = key;
	await api(keyPath(provider), { method: 'PUT', body });
	return getAiStatus();
}

/** Changes only the model of a stored key. */
export async function setAiModel(provider: string, model: string): Promise<AiStatus> {
	await api(keyPath(provider), { method: 'PUT', body: { model } });
	return getAiStatus();
}

/** Re-validates the stored key (one counted AI call). */
export function testAiKey(provider: string): Promise<AiStatus> {
	return api<AiStatus>(`${keyPath(provider)}/test`, { method: 'POST' });
}

export async function deleteAiKey(provider: string): Promise<void> {
	await api(keyPath(provider), { method: 'DELETE' });
}

export function setActiveProvider(provider: string): Promise<AiStatus> {
	return api<AiStatus>('/api/ai/active', { method: 'PUT', body: { provider } });
}

export function createCustomProvider(input: CustomInput): Promise<ProviderInfo> {
	return api<ProviderInfo>('/api/ai/custom-providers', { method: 'POST', body: input });
}

export function updateCustomProvider(id: string, patch: CustomPatch): Promise<ProviderInfo> {
	return api<ProviderInfo>(`/api/ai/custom-providers/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		body: patch
	});
}

export async function deleteCustomProvider(id: string): Promise<void> {
	await api(`/api/ai/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
