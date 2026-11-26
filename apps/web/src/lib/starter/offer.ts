// When Home offers Starter mode (#214): to a brand-new learner, next to the placement offer (#74) and without
// repeating it. The placement offer is for people who already know some of the language; this one is for people who
// know none. Both use the same test for "brand new" (no card, no known mark), so they appear together on a
// fresh workspace and vanish together once anything exists. "Not now" is remembered on this device only.

import { starterProfile } from '$lib/study/starter';

export interface StarterOfferFacts {
	language: string;
	cards: number;
	/** Live `known:` rows, declared or by hand. */
	marks: number;
	/** The server ships a Starter set for the language. */
	setAvailable: boolean;
	/** Starter mode is already on. */
	enabled: boolean;
	dismissed: boolean;
}

export function shouldOfferStarter(facts: StarterOfferFacts): boolean {
	return (
		facts.cards === 0 &&
		facts.marks === 0 &&
		facts.setAvailable &&
		!facts.enabled &&
		!facts.dismissed &&
		starterProfile(facts.language) !== null
	);
}

export function starterDismissKey(workspaceId: number): string {
	return `qinqin.starter.dismissed.${workspaceId}`;
}

export function isStarterDismissed(storage: Storage | null, workspaceId: number): boolean {
	try {
		return storage?.getItem(starterDismissKey(workspaceId)) === '1';
	} catch {
		return false;
	}
}

export function setStarterDismissed(storage: Storage | null, workspaceId: number): void {
	try {
		storage?.setItem(starterDismissKey(workspaceId), '1');
	} catch {
		// Private mode or denied storage: the offer shows again next visit.
	}
}
