// One pass through a lesson's steps (#222): the current step, the answer chosen to a question, the first-try
// results, and a wrong question asked once more at the end of a lesson (Ruling 15; tests ask once). A placement exam
// stops as soon as its result is decided (#224, `stopWhen`). A runes class
// the player creates for the lesson's lifetime (record 0009).

import type { Answer, Step } from './flow';

export class FlowRun {
	#steps = $state<Step[]>([]);
	#retries = $state<boolean[]>([]);
	#index = $state(0);
	#chosen = $state<string | null>(null);
	#results = $state<Answer[]>([]);
	#stopped = $state(false);
	readonly #retry: boolean;
	readonly #stopWhen: ((results: readonly Answer[]) => boolean) | null;

	constructor(steps: readonly Step[], opts: { retry: boolean; stopWhen?: (results: readonly Answer[]) => boolean }) {
		this.#steps = [...steps];
		this.#retries = steps.map(() => false);
		this.#retry = opts.retry;
		this.#stopWhen = opts.stopWhen ?? null;
	}

	get step(): Step | null {
		return this.#stopped ? null : (this.#steps[this.#index] ?? null);
	}

	get done(): boolean {
		return this.#stopped || this.#index >= this.#steps.length;
	}

	/** The question shown is one asked again. */
	get retrying(): boolean {
		return this.#retries[this.#index] ?? false;
	}

	/** The answer chosen to the current question, null while open. */
	get chosen(): string | null {
		return this.#chosen;
	}

	get canContinue(): boolean {
		return this.step !== null && (this.step.kind !== 'question' || this.#chosen !== null);
	}

	get results(): Answer[] {
		return [...this.#results];
	}

	/** The share of the steps passed, 0 to 1. */
	get progress(): number {
		return this.#steps.length === 0 || this.#stopped ? 1 : Math.min(1, this.#index / this.#steps.length);
	}

	/** answer chooses an answer to the current question; true when right. A second answer changes nothing. */
	answer(choice: string): boolean {
		const step = this.step;
		if (step?.kind !== 'question') return false;
		if (this.#chosen !== null) return this.#chosen === step.question.answer;
		this.#chosen = choice;
		const right = choice === step.question.answer;
		const retry = this.retrying;
		this.#results = [...this.#results, { id: step.question.id, word: step.question.word, right, retry }];
		if (!right && !retry && this.#retry) {
			this.#steps = [...this.#steps, step];
			this.#retries = [...this.#retries, true];
		}
		return right;
	}

	/** next moves on, when the current step allows it. */
	next(): void {
		if (!this.canContinue) return;
		this.#index += 1;
		this.#chosen = null;
		if (this.#stopWhen !== null && this.#stopWhen(this.#results)) this.#stopped = true;
	}
}
