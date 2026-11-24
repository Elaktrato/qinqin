// The entry page's AI examples (#186, docs/contracts/examples/): when to offer
// a generation, how an AI-written sentence is labelled, the report reasons'
// words, what a generation's answer says, and the generate flow with its poll
// after a lost answer (the server finishes a paid call even when the client
// is gone, and the request id makes the retry free).

import { t } from '$lib/i18n';
import { ApiError } from '$lib/api/client';
import { EXAMPLE_LIMITS, type ExampleLevel, type ExamplesView, type Generated, type ReportReason } from '$lib/api/examples';
import type { SentenceAi } from '$lib/api/types';
import { aiErrorView } from '$lib/features/journal/aiErrors';
import { pollUntil, type PollOptions } from '$lib/features/journal/reviewPoll';

/** needsExamples: the panel is offered while the entry has few sentences with text, or drafts wait. */
export function needsExamples(sentences: readonly { hanzi: string }[], drafts: readonly unknown[]): boolean {
	return drafts.length > 0 || sentences.filter((s) => s.hanzi.trim() !== '').length < EXAMPLE_LIMITS.fewExamples;
}

/** aiLabel: "AI-written · model · Provider" (the provider by its display name when known). */
export function aiLabel(mark: SentenceAi, names: ReadonlyMap<string, string>): string {
	const who = [mark.model, mark.provider ? (names.get(mark.provider) ?? mark.provider) : ''].filter((s) => s !== '').join(' · ');
	return who === '' ? t('entry.examples.aiWritten') : t('entry.examples.aiWrittenBy', { who });
}

/** reasonLabel: the words of a report reason. */
export function reasonLabel(reason: ReportReason): string {
	switch (reason) {
		case 'missing_word':
			return t('entry.examples.reason.missingWord');
		case 'wrong_translation':
			return t('entry.examples.reason.wrongTranslation');
		case 'wrong_reading':
			return t('entry.examples.reason.wrongReading');
		case 'unnatural':
			return t('entry.examples.reason.unnatural');
		case 'too_hard':
			return t('entry.examples.reason.tooHard');
		case 'inappropriate':
			return t('entry.examples.reason.inappropriate');
		default:
			return t('entry.examples.reason.other');
	}
}

/** levelLabel: the conversation partner's names of the shared levels. */
export function levelLabel(level: ExampleLevel): string {
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

/** generatedText: what the live region says after a generation. */
export function generatedText(g: Generated): string {
	if (g.drafts.length === 0) return t('entry.examples.noneKept');
	const head = t('entry.examples.arrived', { count: g.drafts.length });
	return g.dropped > 0 ? `${head} ${t('entry.examples.dropped', { count: g.dropped })}` : head;
}

/** generateErrorText: a failed generation, keep or delete in the examples' words, else the AI texts. */
export function generateErrorText(err: unknown): string {
	if (err instanceof ApiError && err.code === 'examples_full') {
		return t('apiError.examplesFull');
	}
	return aiErrorView(err, 'ideas').text;
}

/**
 * runGenerate asks for examples. When the answer was lost on the way (the
 * network or a proxy) or a call is still in flight, the drafts are polled
 * until drafts of THIS request id appear (another tab's generation does not
 * count). `onWaiting` is called once when the polling starts.
 */
export async function runGenerate(
	io: { send(level: ExampleLevel, requestId: string): Promise<Generated>; reload(): Promise<ExamplesView | null> },
	level: ExampleLevel,
	requestId: string,
	opts: PollOptions & { onWaiting?: () => void } = {}
): Promise<{ generated: Generated | null; error: unknown }> {
	try {
		return { generated: await io.send(level, requestId), error: null };
	} catch (err) {
		const inFlight = err instanceof ApiError && err.code === 'in_flight';
		if (!inFlight && !aiErrorView(err, 'ideas').poll) return { generated: null, error: err };
		opts.onWaiting?.();
		const late = await pollUntil(
			() => io.reload(),
			(v) => v.drafts.some((d) => d.requestId === requestId),
			opts
		);
		if (late === null) return { generated: null, error: err };
		const drafts = late.drafts.filter((d) => d.requestId === requestId);
		return { generated: { drafts, dropped: 0, provider: drafts[0].provider, model: drafts[0].model }, error: null };
	}
}
