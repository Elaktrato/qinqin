// What the Settings → AI tab says, derived from the server's status.
import type { AiStatus } from '$lib/api/ai';

export interface AiSettingsView {
	banner: string | null;
	canAddKey: boolean;
	keyLine: string | null;
	usageLine: string;
	testProvider: boolean;
}

const BANNERS: Record<string, string> = {
	no_secret: 'AI features are off on this server: the administrator has not set QINQIN_SECRET.',
	invalid_secret:
		'AI features are off: QINQIN_SECRET is set but invalid (it must be 32 random bytes, base64).',
	key_undecryptable:
		'Your saved key can no longer be read (the server secret changed). Enter it again.',
	no_provider: "AI features are off: the server's AI provider setting is invalid."
};

const NO_KEY_STORE = new Set(['no_secret', 'invalid_secret', 'no_provider']);

function n(value: number): string {
	return value.toLocaleString('en');
}

export function aiSettingsView(status: AiStatus): AiSettingsView {
	const key = status.key;
	const label = key ? (status.models.find((m) => m.id === key.model)?.label ?? key.model) : '';
	const { callsLastHour, limitPerHour, inputTokens, outputTokens } = status.usage;
	return {
		banner: BANNERS[status.reason] ?? null,
		canAddKey: !NO_KEY_STORE.has(status.reason),
		keyLine: key ? `Anthropic key ${key.hint} · ${label}` : null,
		usageLine: `${n(callsLastHour)} of ${n(limitPerHour)} AI calls this hour · ${n(inputTokens)} tokens in, ${n(outputTokens)} out`,
		testProvider: status.provider === 'fake'
	};
}
