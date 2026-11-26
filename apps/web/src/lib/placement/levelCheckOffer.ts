// When Home offers the level check (#82, experimental): a quiet note to a learner who has started (some cards or
// known marks) in a language with a level list. It is the opposite of the placement and Starter offers, which are for
// a brand-new workspace. "Not now" is remembered on this device only.

/** Cards a learner needs before the offer shows: ruling — fewer cards give a coverage figure of no use. */
export const LEVEL_CHECK_MIN_CARDS = 20;

export interface LevelCheckOfferFacts {
	cards: number;
	/** Live `known:` rows, declared or by hand. */
	marks: number;
	/** Installed level lists of the workspace language that can be checked. */
	schemes: number;
	dismissed: boolean;
}

export function shouldOfferLevelCheck(facts: LevelCheckOfferFacts): boolean {
	return (facts.cards >= LEVEL_CHECK_MIN_CARDS || facts.marks > 0) && facts.schemes > 0 && !facts.dismissed;
}

export function levelCheckDismissKey(workspaceId: number): string {
	return `qinqin.levelcheck.dismissed.${workspaceId}`;
}

export function isLevelCheckDismissed(storage: Storage | null, workspaceId: number): boolean {
	try {
		return storage?.getItem(levelCheckDismissKey(workspaceId)) === '1';
	} catch {
		return false;
	}
}

export function setLevelCheckDismissed(storage: Storage | null, workspaceId: number): void {
	try {
		storage?.setItem(levelCheckDismissKey(workspaceId), '1');
	} catch {
		// Private mode or denied storage: the offer shows again next visit.
	}
}
