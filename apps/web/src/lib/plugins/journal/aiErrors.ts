// Turns an AI or journal route error into what the page shows. Messages
// come from the server when present; they never contain the API key.

import { ApiError, apiErrorBody } from '$lib/api/client';

export interface AiErrorView {
	text: string;
	settingsLink: boolean;
	offlineInstead: boolean;
	retryAfterSeconds?: number;
	poll: boolean;
}

const GENERIC = 'Something went wrong. Try again.';

const SETTINGS_CODES = new Set([
	'no_key',
	'key_rejected',
	'key_undecryptable',
	'ai_disabled',
	'quota',
	'model_unavailable'
]);

const FALLBACKS: Record<string, string> = {
	no_key: 'Add an API key in Settings → AI first.',
	key_rejected: 'The provider rejected the API key.',
	key_undecryptable: 'Your key can no longer be read. Enter it again in Settings → AI.',
	ai_disabled: 'AI is not set up on this server.',
	quota: 'Your provider account is out of credit or over its quota.',
	model_unavailable: 'This model is not available for your key.',
	busy: 'The provider is busy. Try again in a moment.',
	refused: 'The AI declined to answer this request.',
	truncated: 'The answer was cut off. Try a shorter text.',
	bad_reply: 'The AI answer could not be read. Try again.',
	bad_request: 'The provider refused the request.',
	in_flight: 'Another AI request is still running.',
	too_long: 'This text is too long for one review.',
	empty: 'There is no text to work with yet.',
	rate_limited: 'You have used all AI calls for this hour. Try again later.',
	photo_too_large: 'This photo is too large.',
	unsupported_image: 'Choose a JPEG, PNG or WebP photo.',
	image_too_large: 'This photo has too many pixels.',
	too_many_photos: 'Too many photo drafts are open. Discard one first.',
	ocr_unavailable: 'Offline reading is not installed on this server.',
	ocr_language_missing: 'Offline reading has no model for this language.',
	ocr_failed: 'Offline reading failed on this photo.'
};

export function aiErrorView(err: unknown, context: 'review' | 'ideas' | 'transcribe'): AiErrorView {
	const pollable = context !== 'transcribe';
	const base = { settingsLink: false, offlineInstead: false, poll: false };

	if (err instanceof TypeError) {
		return { ...base, text: GENERIC, poll: pollable };
	}
	if (!(err instanceof ApiError)) return { ...base, text: GENERIC };
	if (err.status === 502 || err.status === 504) {
		return { ...base, text: GENERIC, poll: pollable };
	}

	const body = apiErrorBody(err);
	if (!body) return { ...base, text: GENERIC };
	const fallback = FALLBACKS[body.error];
	const text = body.message || fallback;
	if (!text) return { ...base, text: GENERIC };

	const retry = err.retryAfterSeconds;
	return {
		...base,
		text: retry ? withRetry(text, retry) : text,
		settingsLink: SETTINGS_CODES.has(body.error),
		offlineInstead: context === 'transcribe',
		...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {})
	};
}

function waitText(seconds: number): string {
	if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
	const minutes = Math.ceil(seconds / 60);
	return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Adds "Try again in …" once: a message that already says when keeps its words. */
function withRetry(text: string, seconds: number): string {
	if (/Try again in \d/.test(text)) return text;
	const hint = `Try again in ${waitText(seconds)}.`;
	return text.includes('Try again in a moment.')
		? text.replace('Try again in a moment.', hint)
		: `${text} ${hint}`;
}
