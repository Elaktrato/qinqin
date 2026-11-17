// Turns an AI or journal route error into what the page shows: the catalogue text of the error code
// (docs/contracts/auth/errors.json; apiError.*, with the AI routes' own wording for codes the auth routes word
// differently), never the server's English message. Messages never contain the API key.

import { API_ERROR_KEYS } from '$lib/api/apiErrors';
import { ApiError, apiErrorBody, isWorkspaceGoneResponse } from '$lib/api/client';
import { t, type MessageKey } from '$lib/i18n';

export interface AiErrorView {
	text: string;
	settingsLink: boolean;
	offlineInstead: boolean;
	retryAfterSeconds?: number;
	poll: boolean;
}

const generic = (): string => t('journal.ai.generic');

const SETTINGS_CODES = new Set([
	'no_key',
	'key_rejected',
	'key_undecryptable',
	'ai_disabled',
	'quota',
	'model_unavailable',
	'no_selection',
	'provider_disabled'
]);

/** Codes the AI routes use with another meaning than the auth routes (errors.json says both). */
const AI_TEXT: Record<string, MessageKey> = {
	forbidden: 'journal.ai.forbidden',
	busy: 'journal.ai.busy',
	bad_request: 'journal.ai.badRequest',
	rate_limited: 'journal.ai.rateLimited'
};

/** The same, with the wait the server asked for (Retry-After). */
const AI_TEXT_WAIT: Record<string, MessageKey> = {
	busy: 'journal.ai.busyWait',
	rate_limited: 'journal.ai.rateLimitedWait'
};

function codeText(code: string, retry: number | undefined): string | null {
	if (retry !== undefined && retry > 0) {
		const wait = waitText(retry);
		if (Object.hasOwn(AI_TEXT_WAIT, code)) return t(AI_TEXT_WAIT[code], { wait });
		const plain = codeText(code, undefined);
		return plain === null ? null : t('journal.ai.withRetry', { text: plain, wait });
	}
	if (Object.hasOwn(AI_TEXT, code)) return t(AI_TEXT[code]);
	return Object.hasOwn(API_ERROR_KEYS, code) ? t(API_ERROR_KEYS[code]) : null;
}

export function aiErrorView(err: unknown, context: 'review' | 'ideas' | 'transcribe'): AiErrorView {
	const pollable = context !== 'transcribe';
	const base = { settingsLink: false, offlineInstead: false, poll: false };

	if (err instanceof TypeError) {
		return { ...base, text: generic(), poll: pollable };
	}
	if (!(err instanceof ApiError)) return { ...base, text: generic() };
	if (err.status === 502 || err.status === 504) {
		return { ...base, text: generic(), poll: pollable };
	}

	const body = apiErrorBody(err);
	if (!body && err.status === 404) return { ...base, text: notFoundText(err, context) };
	if (!body) return { ...base, text: generic() };
	const text = codeText(body.error, err.retryAfterSeconds);
	if (text === null) return { ...base, text: generic() };

	return {
		...base,
		text,
		settingsLink: SETTINGS_CODES.has(body.error),
		offlineInstead: context === 'transcribe',
		...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {})
	};
}

function notFoundText(err: ApiError, context: 'review' | 'ideas' | 'transcribe'): string {
	if (isWorkspaceGoneResponse(err.status, err.message)) return t('journal.ai.workspaceGone');
	if (context === 'review') return t('journal.ai.entryGone');
	if (context === 'transcribe') return t('journal.ai.draftExpired');
	return generic();
}

function waitText(seconds: number): string {
	if (seconds < 90) return t('journal.ai.waitSeconds', { count: Math.max(1, Math.round(seconds)) });
	return t('journal.ai.waitMinutes', { count: Math.ceil(seconds / 60) });
}
