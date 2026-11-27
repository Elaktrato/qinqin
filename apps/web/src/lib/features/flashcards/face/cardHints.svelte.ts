// The hints of the card on screen (#215): the session provides one CardHints per card (HintScope), the cards
// show them (HintShown) and offer the one Hint control (HintControl). The rules are in lib/features/flashcards/face/hints.ts.

import { getContext, setContext } from 'svelte';
import { EMPTY_PLAN, nextHint, visibleHints, type HintKind, type HintPlan } from './hints';

export class CardHints {
	#plan: () => HintPlan;
	#locked: () => boolean;
	/** How many times the learner pressed Hint on this card. */
	revealed = $state(0);

	constructor(plan: () => HintPlan, locked: () => boolean) {
		this.#plan = plan;
		this.#locked = locked;
	}

	/** Hints on view, in the fixed order. */
	get visible(): HintKind[] {
		return visibleHints(this.#plan(), this.revealed);
	}

	/** Whether the Hint control is offered: a hint is left and the card is not answered yet. */
	get canReveal(): boolean {
		return !this.#locked() && nextHint(this.#plan(), this.revealed) !== null;
	}

	/** Hints asked for with the control (the count the grade rule uses). */
	get used(): number {
		return Math.min(this.revealed, this.#plan().onRequest.length);
	}

	/** reveal shows the next hint and returns its kind (null when none is left or the card is answered). */
	reveal(): HintKind | null {
		if (!this.canReveal) return null;
		const kind = nextHint(this.#plan(), this.revealed);
		this.revealed += 1;
		return kind;
	}
}

const KEY = Symbol('qinqin.cardHints');

export function provideCardHints(hints: CardHints): void {
	setContext(KEY, hints);
}

/** useCardHints: the hints of the card being rendered; inert (no hints) outside a HintScope. */
export function useCardHints(): CardHints {
	return (
		getContext<CardHints | undefined>(KEY) ??
		new CardHints(
			() => EMPTY_PLAN,
			() => true
		)
	);
}
