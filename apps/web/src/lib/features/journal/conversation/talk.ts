// The conversation view's logic (#185): the learner messages' corrections as
// the journal's margin list, the default level, who answered, and when a turn
// may be sent.

import { t } from '$lib/i18n';
import { ApiError } from '$lib/api/client';
import { aiErrorView } from '../aiErrors';
import { anchorAnnotations, type Placed } from '../anchor';
import type { Correction, CorrectionState } from '../corrections';
import { annotationKind } from '../review';
import type { AiGate } from '../editorLogic';
import type { Annotation, JournalEntry } from '../types';
import { LIMITS } from './conversations';
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
	if ([...input.text.trim()].length > LIMITS.messageRunes) {
		return { enabled: false, hint: t('journal.talk.tooLong', { max: LIMITS.messageRunes }), settingsLink: false };
	}
	if (input.busy || (input.opened && input.text.trim() === '')) return { enabled: false, hint: null, settingsLink: false };
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
 * runTurn sends one turn. A 404 means the conversation was saved or discarded
 * elsewhere. When the answer was lost on the way (the network or a proxy cut
 * the request) the server may still have stored the turn: one reload decides.
 */
export async function runTurn(
	io: { send(text: string): Promise<Conversation>; reload(): Promise<Conversation | null> },
	before: Conversation,
	text: string
): Promise<{ conversation: Conversation | null; error: unknown; gone: boolean }> {
	try {
		return { conversation: await io.send(text), error: null, gone: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && err.code === 'not_found') return { conversation: null, error: null, gone: true };
		if (aiErrorView(err, 'ideas').poll) {
			try {
				const late = await io.reload();
				if (late === null) return { conversation: null, error: null, gone: true };
				if (late.messages.length > before.messages.length) return { conversation: late, error: null, gone: false };
			} catch {
				// keep the first error
			}
		}
		return { conversation: null, error: err, gone: false };
	}
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
