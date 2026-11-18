// The study face's context (#101): the session provides one CardFace; the
// card inside it registers its main action ("Show answer", "Check", "Show
// strokes"), which the face docks at the bottom as the one primary button.
// A card is only ever rendered inside a face (tests use testing/CardHarness).

import { getContext, setContext } from 'svelte';

export interface FacePrimary {
	label: string;
	run: () => void;
	disabled?: boolean;
}

export class CardFace {
	primary = $state.raw<FacePrimary | null>(null);
	/** The docked button's element, while it is rendered (keyboard focus fallback). */
	primaryElement = $state.raw<HTMLElement | null>(null);
	#owner: object | null = null;

	/** register: the owner's primary replaces any other; null clears its own. */
	register(owner: object, primary: FacePrimary | null): void {
		this.#owner = primary === null ? null : owner;
		this.primary = primary;
	}

	/** release: clears the primary only while it is still the owner's. */
	release(owner: object): void {
		if (this.#owner !== owner) return;
		this.#owner = null;
		this.primary = null;
	}
}

const KEY = Symbol('qinqin.cardFace');

/** provideCardFace: called by the session (or the test harness) before the face renders. */
export function provideCardFace(): CardFace {
	const face = new CardFace();
	setContext(KEY, face);
	return face;
}

/** useCardFace: the face a card is rendered in; throws outside one. */
export function useCardFace(): CardFace {
	const face = getContext<CardFace | undefined>(KEY);
	if (face === undefined) throw new Error('useCardFace: a card must be rendered inside the study face');
	return face;
}

/**
 * useOptionalCardFace: for a component shared with pages outside the session
 * (WordSaladBoard is also the grammar practice board); null without a face.
 */
export function useOptionalCardFace(): CardFace | null {
	return getContext<CardFace | undefined>(KEY) ?? null;
}

/**
 * usePrimary: from a card's script. `get` is tracked: the docked button
 * follows its label and disabled state; null shows no primary (after the
 * answer, the grade bar takes the dock). Cleared when the card goes.
 */
export function usePrimary(get: () => FacePrimary | null): void {
	const face = useCardFace();
	const owner = {};
	$effect(() => {
		face.register(owner, get());
	});
	$effect(() => () => face.release(owner));
}
