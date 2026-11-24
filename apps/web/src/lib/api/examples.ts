// The AI example sentences of an entry (#186, docs/contracts/examples/):
// the routes and the lenient decoders of their answers (examples.json
// `reads`, `marks`). A kept example comes back as an own sentence marked `ai`.

import { api } from './client';
import type { Sentence, SentenceAi } from './types';

/** The learner levels, easiest first (shared with the conversation partner). */
export const EXAMPLE_LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced'] as const;
export type ExampleLevel = (typeof EXAMPLE_LEVELS)[number];

/** The report reasons, in display order. */
export const REPORT_REASONS = [
	'missing_word',
	'wrong_translation',
	'wrong_reading',
	'unnatural',
	'too_hard',
	'inappropriate',
	'other'
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The server's limits (examples.json `limits`). */
export const EXAMPLE_LIMITS = {
	perGeneration: 5,
	keptPerEntry: 10,
	textRunes: 200,
	readingRunes: 400,
	translationRunes: 400,
	fewExamples: 3,
	reportsPerUser: 500,
	requestIdLength: 64
} as const;

/** One undecided sentence of the latest generation. */
export interface ExampleDraft {
	id: number;
	entryId: number;
	hanzi: string;
	pinyin: string;
	translation: string;
	level: ExampleLevel;
	provider: string;
	model: string;
	/** The client's id of the generation that wrote it. */
	requestId: string;
}

/** The latest stored generation of the entry (a retry of it is answered from this). */
export interface LastRequest {
	requestId: string;
	dropped: number;
	provider: string;
	model: string;
}

export interface ExamplesView {
	drafts: ExampleDraft[];
	defaultLevel: ExampleLevel;
	lastRequest: LastRequest | null;
}

/** A generation's answer: the entry's drafts after it (a generation that kept nothing leaves the earlier ones). */
export interface Generated {
	drafts: ExampleDraft[];
	dropped: number;
	provider: string;
	model: string;
	requestId: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const level = (v: unknown): ExampleLevel => EXAMPLE_LEVELS.find((l) => l === v) ?? 'beginner';

/** aiMark: who wrote a sentence; null for a sentence no AI wrote. Any non-null value marks it. */
export function aiMark(v: unknown): SentenceAi | null {
	if (v === null || v === undefined) return null;
	if (!isRecord(v)) return { provider: '', model: '' };
	return { provider: str(v.provider), model: str(v.model) };
}

/** parseDraft decodes one draft; null for one without a numeric id or a text. */
export function parseDraft(v: unknown): ExampleDraft | null {
	if (!isRecord(v) || typeof v.id !== 'number' || !Number.isInteger(v.id) || str(v.hanzi) === '') return null;
	return {
		id: v.id,
		entryId: typeof v.entryId === 'number' ? v.entryId : 0,
		hanzi: str(v.hanzi),
		pinyin: str(v.pinyin),
		translation: str(v.translation),
		level: level(v.level),
		provider: str(v.provider),
		model: str(v.model),
		requestId: str(v.requestId)
	};
}

function drafts(v: unknown): ExampleDraft[] {
	const out: ExampleDraft[] = [];
	for (const raw of Array.isArray(v) ? v : []) {
		const d = parseDraft(raw);
		if (d) out.push(d);
	}
	return out;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

function lastRequest(v: unknown): LastRequest | null {
	if (!isRecord(v) || str(v.requestId) === '') return null;
	return { requestId: str(v.requestId), dropped: count(v.dropped), provider: str(v.provider), model: str(v.model) };
}

export function parseExamples(v: unknown): ExamplesView {
	const r = isRecord(v) ? v : {};
	return { drafts: drafts(r.drafts), defaultLevel: level(r.defaultLevel), lastRequest: lastRequest(r.lastRequest) };
}

export function parseGenerated(v: unknown): Generated {
	const r = isRecord(v) ? v : {};
	return { drafts: drafts(r.drafts), dropped: count(r.dropped), provider: str(r.provider), model: str(r.model), requestId: str(r.requestId) };
}

const base = (entryId: number) => `/api/entries/${entryId}`;
const withReason = (path: string, reason?: ReportReason) => (reason ? `${path}?reason=${encodeURIComponent(reason)}` : path);

/** getExamples queries GET /api/entries/{id}/examples: the drafts and the default level. */
export async function getExamples(entryId: number): Promise<ExamplesView> {
	return parseExamples(await api<unknown>(`${base(entryId)}/examples`));
}

/** generateExamples asks the learner's AI for examples (one call; idempotent by requestId). */
export async function generateExamples(entryId: number, lvl: ExampleLevel, requestId: string): Promise<Generated> {
	return parseGenerated(await api<unknown>(`${base(entryId)}/examples`, { body: { level: lvl, requestId } }));
}

/** keepExample makes a draft an own sentence of the entry, marked as AI-written. */
export function keepExample(entryId: number, draftId: number): Promise<Sentence> {
	return api<Sentence>(`${base(entryId)}/examples/${draftId}/keep`, { method: 'POST' });
}

/** discardExample deletes a draft; with a reason it is also reported. */
export async function discardExample(entryId: number, draftId: number, reason?: ReportReason): Promise<void> {
	await api<void>(withReason(`${base(entryId)}/examples/${draftId}`, reason), { method: 'DELETE' });
}

/** deleteAiSentence deletes a kept AI example; with a reason it is also reported. */
export async function deleteAiSentence(entryId: number, sentenceId: number, reason?: ReportReason): Promise<void> {
	await api<void>(withReason(`${base(entryId)}/sentences/${sentenceId}`, reason), { method: 'DELETE' });
}
