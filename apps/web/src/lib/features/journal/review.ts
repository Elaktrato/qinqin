// The stored journal review as a client shows it (#103): model and legacy
// text is untrusted plain text, every annotation carries the closed kind,
// and a document that is not an object with an entry id is no review.
// Rule and cases: docs/contracts/journal/review-docs.json.

import type { Annotation, DropCounts, Review } from './types';

export type AnnotationKind = 'mistake' | 'suggestion';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * annotationKind: only the exact "suggestion" survives; absent, unknown and
 * non-string kinds are mistakes. The server has already trimmed and folded
 * the model's answer; the client deliberately does not trim (the fixture
 * pins that).
 */
export function annotationKind(value: unknown): AnnotationKind {
	return isRecord(value) && value.kind === 'suggestion' ? 'suggestion' : 'mistake';
}

/** parseAnnotation: one stored annotation; null without a string quote and id (review-docs.json). */
export function parseAnnotation(value: unknown): Annotation | null {
	if (!isRecord(value) || typeof value.quote !== 'string' || typeof value.id !== 'string' || value.id === '') return null;
	return {
		id: str(value.id),
		quote: value.quote,
		prefix: str(value.prefix),
		suffix: str(value.suffix),
		correction: str(value.correction),
		explanation: str(value.explanation),
		category: str(value.category),
		kind: annotationKind(value)
	};
}

function parseDropped(value: unknown): DropCounts {
	const v = isRecord(value) ? value : {};
	const n = (key: keyof DropCounts): number =>
		typeof v[key] === 'number' && Number.isFinite(v[key]) ? (v[key] as number) : 0;
	return {
		notFound: n('notFound'),
		wrongScript: n('wrongScript'),
		noChange: n('noChange'),
		overlap: n('overlap'),
		empty: n('empty'),
		tooMany: n('tooMany')
	};
}

function parseOverall(value: unknown): Review['overall'] {
	const v = isRecord(value) ? value : {};
	return { summary: str(v.summary), strengths: strings(v.strengths), focus: strings(v.focus) };
}

/** parseReview: a stored review document, or null when it is not one. */
export function parseReview(value: unknown): Review | null {
	if (!isRecord(value) || typeof value.entryId !== 'string') return null;
	return {
		entryId: value.entryId,
		textHash: str(value.textHash),
		annotations: (() => {
			const seen = new Set<string>();
			const out: Annotation[] = [];
			for (const raw of Array.isArray(value.annotations) ? value.annotations : []) {
				const a = parseAnnotation(raw);
				if (a === null || seen.has(a.id)) continue;
				seen.add(a.id);
				out.push(a);
			}
			return out;
		})(),
		overall: parseOverall(value.overall),
		model: str(value.model),
		provider: str(value.provider),
		fallbackFrom: str(value.fallbackFrom),
		dropped: parseDropped(value.dropped),
		createdAt: str(value.createdAt)
	};
}
