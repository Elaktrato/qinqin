// The conversation view's logic (#185): the learner messages' corrections as
// the journal's margin list, the default level, who answered, and when a turn
// may be sent.

import { t } from '$lib/i18n';
import { ApiError } from '$lib/api/client';
import { aiErrorView } from '../aiErrors';
import { anchorAnnotations, type Placed } from '../anchor';
import type { Correction, CorrectionState } from '../corrections';
import { annotationKind } from '../review';
import { entryTitle, plainText, type AiGate } from '../editorLogic';
import type { Annotation, JournalEntry } from '../types';
import { formatNumber } from '$lib/i18n/format';
import { pollUntil, sendRetryingInFlight, type PollOptions } from '../reviewPoll';
import { LEVELS, LIMITS } from './conversations';
import type { Conversation, ConversationSummary, Level, Message } from './types';

/**
 * conversationCorrections: one margin list for the whole conversation, message
 * by message (placed by position, then list-only, then missing), and the
 * placed marks of each learner message by its seq. Annotation ids are unique in
 * a conversation (m<seq>a<n>), so marks and notes never collide.
 */
export function conversationCorrections(messages: readonly Message[]): { list: Correction[]; placed: Map<number, Placed[]> } {
	const rows: { annotation: Annotation; state: CorrectionState }[] = [];
	const placed = new Map<number, Placed[]>();
	for (const m of messages) {
		if (m.role !== 'learner' || m.annotations.length === 0) continue;
		const a = anchorAnnotations(m.text, m.annotations);
		const marks = a.placed.slice().sort((x, y) => x.start - y.start);
		placed.set(m.seq, marks);
		rows.push(
			...marks.map((p) => ({ annotation: p.annotation, state: 'placed' as const })),
			...a.listOnly.map((annotation) => ({ annotation, state: 'listOnly' as const })),
			...a.missing.map((annotation) => ({ annotation, state: 'missing' as const }))
		);
	}
	return {
		list: rows.map(({ annotation, state }, index) => ({ annotation, kind: annotationKind(annotation), state, index })),
		placed
	};
}

/** defaultLevel: the level of the most recently updated conversation, else beginner. */
export function defaultLevel(list: readonly ConversationSummary[]): Level {
	const latest = list.reduce<ConversationSummary | null>((best, s) => (best === null || s.updatedAt > best.updatedAt ? s : best), null);
	return latest?.level ?? 'beginner';
}

/** lastAnswer: the model and provider of the latest partner message, for "Answered by". */
export function lastAnswer(messages: readonly Message[]): { model: string; provider?: string } | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === 'partner' && m.model) return m.provider ? { model: m.model, provider: m.provider } : { model: m.model };
	}
	return null;
}

/** Whether the conversation has room for one more turn (two messages). */
export function isFull(messages: readonly Message[]): boolean {
	return messages.length + 2 > LIMITS.messages;
}

/**
 * turnGate: whether Send may be pressed, and why not. `available` is null while
 * the capabilities load; a conversation without messages lets the partner open
 * without text.
 */
export function turnGate(input: {
	available: boolean | null;
	banner: string | null;
	opened: boolean;
	full: boolean;
	busy: boolean;
	text: string;
}): AiGate {
	if (input.available === null) return { enabled: false, hint: null, settingsLink: false };
	if (!input.available) return { enabled: false, hint: input.banner ?? t('journal.gate.noKey'), settingsLink: true };
	if (input.full) return { enabled: false, hint: t('journal.talk.full'), settingsLink: false };
	const text = sendableText(input.text);
	if ([...text].length > LIMITS.messageRunes) {
		return { enabled: false, hint: t('journal.talk.tooLong', { max: formatNumber(LIMITS.messageRunes) }), settingsLink: false };
	}
	if (input.busy || (input.opened && text === '')) return { enabled: false, hint: null, settingsLink: false };
	return { enabled: true, hint: null, settingsLink: false };
}

/** levelLabel: the catalogue name of a level. */
export function levelLabel(level: Level): string {
	switch (level) {
		case 'elementary':
			return t('journal.talk.level.elementary');
		case 'intermediate':
			return t('journal.talk.level.intermediate');
		case 'advanced':
			return t('journal.talk.level.advanced');
		default:
			return t('journal.talk.level.beginner');
	}
}

/**
 * runTurn sends one turn. A 404 means the conversation was saved or
 * discarded elsewhere. When the answer was lost on the way (the network or a
 * proxy cut the request; the server finishes a paid call anyway), the
 * conversation is polled like a review until it holds THIS turn (its turn
 * id); growth from another tab does not count. `in_flight` (another call held
 * the AI slot; this turn never ran) sends the same turn again after a bounded
 * backoff. `onWaiting` is called once when the polling starts.
 */
export async function runTurn(
	io: { send(text: string, turnId: string): Promise<Conversation>; reload(): Promise<Conversation | null> },
	text: string,
	turnId: string,
	opts: PollOptions & { onWaiting?: () => void } = {}
): Promise<{ conversation: Conversation | null; error: unknown; gone: boolean }> {
	try {
		return { conversation: await sendRetryingInFlight(() => io.send(text, turnId), opts), error: null, gone: false };
	} catch (err) {
		if (isGone(err)) return { conversation: null, error: null, gone: true };
		// in_flight left after the backoff: the turn never ran, nothing to poll for (#186 fix wave).
		const inFlight = err instanceof ApiError && err.code === 'in_flight';
		if (inFlight || !aiErrorView(err, 'ideas').poll) return { conversation: null, error: err, gone: false };
		opts.onWaiting?.();
		let gone = false;
		const stop = new AbortController();
		opts.signal?.addEventListener('abort', () => stop.abort(), { once: true });
		const late = await pollUntil(
			async () => {
				const c = await io.reload();
				if (c === null) {
					gone = true;
					stop.abort();
				}
				return c;
			},
			(c) => c.messages.some((m) => m.turnId === turnId),
			{ ...opts, signal: stop.signal }
		);
		if (late) return { conversation: late, error: null, gone: false };
		if (gone) return { conversation: null, error: null, gone: true };
		return { conversation: null, error: err, gone: false };
	}
}

function isGone(err: unknown): boolean {
	return err instanceof ApiError && err.status === 404 && err.code === 'not_found';
}

/** turnErrorText: a failed turn in the conversation's words, else the journal's AI error text. */
export function turnErrorText(err: unknown): string {
	const code = err instanceof ApiError ? err.code : undefined;
	switch (code) {
		case 'too_long':
			return t('journal.talk.tooLong', { max: formatNumber(LIMITS.messageRunes) });
		case 'empty':
			return t('journal.talk.empty');
		case 'conversation_limit':
			return t('journal.talk.limit', { max: LIMITS.conversations });
		case 'conversation_full':
			return t('journal.talk.full');
	}
	return aiErrorView(err, 'ideas').text;
}

/** sendableText: a message as the server takes it (no control characters but line breaks and tabs), trimmed. */
export function sendableText(text: string): string {
	return plainText(text).trim();
}

/** startBody: what a start sends: a plain topic of at most LIMITS.topicRunes code points and a known level. */
export function startBody(topic: string, level: Level): { topic: string; level: Level } {
	return { topic: entryTitle(topic).trim(), level: LEVELS.includes(level) ? level : 'beginner' };
}

/**
 * saveAsEntry: the conversation becomes a journal entry, joins the entries
 * column and counts as a journal day (the study event; its failure never
 * fails the save).
 */
export async function saveAsEntry(io: {
	save(): Promise<JournalEntry | null>;
	upsert(entry: JournalEntry): void;
	record(entryId: string): Promise<void>;
}): Promise<JournalEntry | null> {
	const entry = await io.save();
	if (entry === null) return null;
	io.upsert(entry);
	try {
		await io.record(entry.id);
	} catch {
		// Telemetry only.
	}
	return entry;
}
