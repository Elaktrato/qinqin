// The conversation partner's routes (docs/contracts/journal/README.md#conversations):
// every answer is decoded leniently here (conversations.json `reads`).

import { ApiError, api } from '$lib/api/client';
import { parseEntry } from '../store';
import { parseAnnotation } from '../review';
import type { Annotation, JournalEntry } from '../types';
import type { Conversation, ConversationSummary, Level, Message } from './types';

/** The levels, easiest first. */
export const LEVELS: readonly Level[] = ['beginner', 'elementary', 'intermediate', 'advanced'];

/** The server's limits (conversations.json `limits`). */
export const LIMITS = {
	topicRunes: 200,
	messageRunes: 1000,
	replyRunes: 800,
	messages: 50,
	conversations: 20,
	contextMessages: 12,
	wordSample: 40
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function level(value: unknown): Level {
	return LEVELS.find((l) => l === value) ?? 'beginner';
}

function parseMessage(value: unknown): Message | null {
	if (!isRecord(value) || (value.role !== 'learner' && value.role !== 'partner') || typeof value.text !== 'string') return null;
	const annotations: Annotation[] = [];
	for (const raw of Array.isArray(value.annotations) ? value.annotations : []) {
		const a = parseAnnotation(raw);
		if (a) annotations.push(a);
	}
	const m: Message = {
		seq: typeof value.seq === 'number' ? value.seq : 0,
		role: value.role,
		text: value.text,
		annotations,
		createdAt: str(value.createdAt)
	};
	if (typeof value.model === 'string' && value.model !== '') m.model = value.model;
	if (typeof value.provider === 'string' && value.provider !== '') m.provider = value.provider;
	return m;
}

/** parseConversation decodes a conversation of the server; null when it is not one. */
export function parseConversation(v: unknown): Conversation | null {
	if (!isRecord(v) || typeof v.id !== 'string' || v.id === '') return null;
	const messages: Message[] = [];
	for (const raw of Array.isArray(v.messages) ? v.messages : []) {
		const m = parseMessage(raw);
		if (m) messages.push(m);
	}
	return { id: v.id, topic: str(v.topic), level: level(v.level), createdAt: str(v.createdAt), updatedAt: str(v.updatedAt), messages };
}

function parseSummary(v: unknown): ConversationSummary | null {
	if (!isRecord(v) || typeof v.id !== 'string' || v.id === '') return null;
	return {
		id: v.id,
		topic: str(v.topic),
		level: level(v.level),
		messageCount: typeof v.messageCount === 'number' ? v.messageCount : 0,
		createdAt: str(v.createdAt),
		updatedAt: str(v.updatedAt)
	};
}

const q = (workspaceId: number) => `?workspace=${workspaceId}`;
const path = (workspaceId: number, id: string, tail = '') =>
	`/api/journal/conversations/${encodeURIComponent(id)}${tail}${q(workspaceId)}`;

function conversationOf(answer: unknown): Conversation {
	const c = parseConversation(answer);
	if (c === null) throw new Error('journal: the answer is not a conversation');
	return c;
}

const notFound = (err: unknown) => err instanceof ApiError && err.status === 404 && err.code === 'not_found';

/** The workspace's conversations, most recently updated first. */
export async function listConversations(workspaceId: number): Promise<ConversationSummary[]> {
	const rows = await api<unknown>(`/api/journal/conversations${q(workspaceId)}`);
	const out: ConversationSummary[] = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const s = parseSummary(row);
		if (s) out.push(s);
	}
	return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function startConversation(workspaceId: number, topic: string, lvl: Level): Promise<Conversation> {
	return conversationOf(await api<unknown>(`/api/journal/conversations${q(workspaceId)}`, { body: { topic, level: lvl } }));
}

/** One conversation, or null when it is gone. */
export async function getConversation(workspaceId: number, id: string): Promise<Conversation | null> {
	try {
		return conversationOf(await api<unknown>(path(workspaceId, id)));
	} catch (err) {
		if (notFound(err)) return null;
		throw err;
	}
}

/** One AI turn; an empty text lets the partner open. Answers the stored conversation. */
export async function sendTurn(workspaceId: number, id: string, text: string, signal?: AbortSignal): Promise<Conversation> {
	return conversationOf(await api<unknown>(path(workspaceId, id, '/turn'), { body: { text }, signal }));
}

/** Saves the conversation as a journal entry (it is removed); answers the entry. */
export async function saveConversation(workspaceId: number, id: string, entryId: string, date: string): Promise<JournalEntry | null> {
	return parseEntry(await api<unknown>(path(workspaceId, id, '/save'), { body: { entryId, date } }));
}

/** Discards the conversation; one that is already gone counts as done. */
export async function discardConversation(workspaceId: number, id: string): Promise<void> {
	try {
		await api(path(workspaceId, id), { method: 'DELETE' });
	} catch (err) {
		if (notFound(err)) return;
		throw err;
	}
}
