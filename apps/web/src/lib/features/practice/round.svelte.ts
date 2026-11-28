// One round of questions (record 0009: a runes class, owned by the view that runs the round). Each entry is asked
// once; its answer is recorded once (the caller writes the event); `next` moves on only after an answer.

import type { ReviewGrade } from '$lib/studycore/types';
import { roundResult, type RoundResult } from './answer';
import type { DrillAnswerInput, RoundEntry } from './types';

/** Records one answer; false when it was not kept (its workspace was deleted). */
export type RecordAnswer = (entry: RoundEntry, answer: DrillAnswerInput) => Promise<boolean>;

export class PracticeRound {
	readonly entries: readonly RoundEntry[];
	#record: RecordAnswer;
	#index = $state(0);
	#answers = $state.raw<{ entry: RoundEntry; grade: ReviewGrade }[]>([]);
	#notSaved = $state(false);

	constructor(entries: readonly RoundEntry[], record: RecordAnswer) {
		this.entries = entries;
		this.#record = record;
	}

	get current(): RoundEntry | null {
		return this.entries[this.#index] ?? null;
	}

	get done(): boolean {
		return this.#index >= this.entries.length;
	}

	/** The 1-based place of the current question. */
	get position(): { n: number; of: number } {
		return { n: Math.min(this.#index + 1, this.entries.length), of: this.entries.length };
	}

	/** Whether the current question is answered. */
	get answered(): boolean {
		return this.#answers.length > this.#index;
	}

	/** An answer was not kept: its workspace was deleted. */
	get notSaved(): boolean {
		return this.#notSaved;
	}

	get result(): RoundResult {
		return roundResult(this.#answers);
	}

	/** answer records the current question's answer; a second answer to the same question is ignored. */
	async answer(answer: DrillAnswerInput): Promise<void> {
		const entry = this.current;
		if (entry === null || this.answered) return;
		this.#answers = [...this.#answers, { entry, grade: answer.grade }];
		const kept = await this.#record(entry, answer);
		if (!kept) this.#notSaved = true;
	}

	/** next moves to the next question once this one is answered. */
	next(): void {
		if (this.answered && !this.done) this.#index += 1;
	}
}
