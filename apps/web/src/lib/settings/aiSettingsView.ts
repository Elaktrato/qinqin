// What the Settings → AI tab says, derived from the server's status and the
// provider registry.
import type { AiStatus, ModelInfo, ProviderInfo, ProvidersResponse, Structured } from '$lib/api/ai';
import { t, type MessageKey } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';

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

const BANNERS: Record<string, MessageKey> = {
	no_secret: 'settings.ai.banner.noSecret',
	invalid_secret: 'settings.ai.banner.invalidSecret',
	key_undecryptable: 'settings.ai.banner.keyUndecryptable',
	no_provider: 'settings.ai.banner.noProvider',
	no_selection: 'settings.ai.banner.noSelection',
	provider_disabled: 'settings.ai.banner.providerDisabled'
};

const NO_KEY_STORE = new Set(['no_secret', 'invalid_secret', 'no_provider']);

const STRUCTURED_LABELS: Record<Structured, MessageKey> = {
	json_schema: 'settings.ai.structured.jsonSchema',
	json_object: 'settings.ai.structured.jsonObject',
	prompt: 'settings.ai.structured.prompt'
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

/** The sentence shown wherever a key for the provider is typed. */
export function privacyNote(name: string): string {
	return t('settings.ai.privacy', { name });
}

/** Suggested model ids of a provider (any other id may be typed). */
export function modelSuggestions(provider: ProviderInfo | undefined): ModelInfo[] {
	return provider ? provider.models : [];
}

/** The banner for a status, for pages that have no provider registry. */
export function aiBanner(status: AiStatus): string | null {
	return Object.hasOwn(BANNERS, status.reason) ? t(BANNERS[status.reason]) : null;
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
			stateText = t('settings.ai.state.disabled');
		} else if (k.state === 'undecryptable') {
			state = 'undecryptable';
			stateText = t('settings.ai.state.undecryptable');
		}
		return {
			id: k.provider,
			name: p?.name ?? BUILTIN_NAMES[k.provider] ?? k.provider,
			hint: k.hint,
			model: k.model,
			modelLabel: model?.label ?? k.model,
			active: k.provider === activeId && !off,
			vision: p ? (model?.vision ?? p.vision) : false,
			structuredLabel: p ? t(STRUCTURED_LABELS[p.structured]) : '',
			custom: p?.custom ?? k.provider.startsWith('custom-'),
			adminLine: p?.custom && p.host ? t('settings.ai.adminLine', { host: p.host }) : null,
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
		usageLine: t('settings.ai.usage', {
			calls: formatNumber(callsLastHour),
			limit: formatNumber(limitPerHour),
			tokensIn: formatNumber(inputTokens),
			tokensOut: formatNumber(outputTokens)
		}),
		testProvider: status.fake,
		canManageCustom: providers.canManageCustom
	};
}
