// What the Settings → AI tab says, derived from the server's status and the
// provider registry.
import type { AiStatus, ModelInfo, ProviderInfo, ProvidersResponse, Structured } from '$lib/api/ai';

export interface ProviderRow {
	id: string;
	name: string;
	hint: string;
	model: string;
	modelLabel: string;
	active: boolean;
	vision: boolean;
	structuredLabel: string;
	custom: boolean;
	/** "Added by your admin · host" for a custom endpoint. */
	adminLine: string | null;
	state: 'ok' | 'undecryptable' | 'disabled';
	/** Words for a state that is not ok. */
	stateText: string | null;
}

export interface AiSettingsView {
	banner: string | null;
	canAddKey: boolean;
	rows: ProviderRow[];
	addable: { builtin: ProviderInfo[]; custom: ProviderInfo[] };
	usageLine: string;
	testProvider: boolean;
	canManageCustom: boolean;
}

const BANNERS: Record<string, string> = {
	no_secret: 'AI features are off on this server: the administrator has not set QINQIN_SECRET.',
	invalid_secret:
		'AI features are off: QINQIN_SECRET is set but invalid (it must be 32 random bytes, base64).',
	key_undecryptable:
		'Your saved key can no longer be read (the server secret changed). Enter it again.',
	no_provider: "AI features are off: the server's AI provider setting is invalid.",
	no_selection: 'Choose which provider to use.',
	provider_disabled: 'The provider you chose is turned off on this server. Choose another one.'
};

const NO_KEY_STORE = new Set(['no_secret', 'invalid_secret', 'no_provider']);

const STRUCTURED_LABELS: Record<Structured, string> = {
	json_schema: 'Structured replies',
	json_object: 'JSON mode',
	prompt: 'Prompted JSON'
};

// Names for the built-in ids, used when a provider the server turned off no
// longer appears in the registry listing.
const BUILTIN_NAMES: Record<string, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	gemini: 'Google Gemini',
	deepseek: 'DeepSeek',
	mistral: 'Mistral',
	xai: 'xAI',
	groq: 'Groq',
	openrouter: 'OpenRouter'
};

function n(value: number): string {
	return value.toLocaleString('en');
}

/** The sentence shown wherever a key for the provider is typed. */
export function privacyNote(name: string): string {
	return `Your journal text, guidance and the photos you choose to read with AI are sent to ${name} when you press a button. ${name}'s terms apply.`;
}

/** Suggested model ids of a provider (any other id may be typed). */
export function modelSuggestions(provider: ProviderInfo | undefined): ModelInfo[] {
	return provider ? provider.models : [];
}

/** The banner for a status, for pages that have no provider registry. */
export function aiBanner(status: AiStatus): string | null {
	return BANNERS[status.reason] ?? null;
}

export function aiSettingsView(status: AiStatus, providers: ProvidersResponse): AiSettingsView {
	const byId = new Map(providers.providers.map((p) => [p.id, p]));
	const disabled = new Set(status.disabledProviders ?? []);
	const activeId = status.active?.provider ?? null;

	const rows: ProviderRow[] = status.keys.map((k) => {
		const p = byId.get(k.provider);
		const off = disabled.has(k.provider) || p === undefined;
		const model = p?.models.find((m) => m.id === k.model);
		let state: ProviderRow['state'] = 'ok';
		let stateText: string | null = null;
		if (off) {
			state = 'disabled';
			stateText = 'Turned off by the server';
		} else if (k.state === 'undecryptable') {
			state = 'undecryptable';
			stateText = 'Enter the key again';
		}
		return {
			id: k.provider,
			name: p?.name ?? BUILTIN_NAMES[k.provider] ?? k.provider,
			hint: k.hint,
			model: k.model,
			modelLabel: model?.label ?? k.model,
			active: k.provider === activeId && !off,
			vision: p ? (model?.vision ?? p.vision) : false,
			structuredLabel: p ? STRUCTURED_LABELS[p.structured] : '',
			custom: p?.custom ?? k.provider.startsWith('custom-'),
			adminLine: p?.custom && p.host ? `Added by your admin · ${p.host}` : null,
			state,
			stateText
		};
	});
	// Active first; the stored order (oldest first) otherwise.
	rows.sort((a, b) => Number(b.active) - Number(a.active));

	const configured = new Set(status.keys.map((k) => k.provider));
	const free = providers.providers.filter((p) => !configured.has(p.id));
	const { callsLastHour, limitPerHour, inputTokens, outputTokens } = status.usage;
	return {
		banner: aiBanner(status),
		canAddKey: !NO_KEY_STORE.has(status.reason),
		rows,
		addable: { builtin: free.filter((p) => !p.custom), custom: free.filter((p) => p.custom) },
		usageLine: `${n(callsLastHour)} of ${n(limitPerHour)} AI calls this hour · ${n(inputTokens)} tokens in, ${n(outputTokens)} out`,
		testProvider: status.fake,
		canManageCustom: providers.canManageCustom
	};
}
