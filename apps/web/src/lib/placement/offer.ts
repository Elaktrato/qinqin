// When Home offers the placement test (#74): a workspace that has no card, no
// known mark and no declaration yet, with a level list installed for its
// language, until the learner says "Not now" (remembered on this device only:
// a per-viewer convenience, the offer reappears nowhere once anything exists).

export interface OfferFacts {
	cards: number;
	/** Live `known:` rows, declared or by hand. */
	marks: number;
	/** Level schemes installed for the workspace's language (samples excluded). */
	schemes: number;
	dismissed: boolean;
}

export function shouldOffer(facts: OfferFacts): boolean {
	return facts.cards === 0 && facts.marks === 0 && facts.schemes > 0 && !facts.dismissed;
}

export function dismissKey(workspaceId: number): string {
	return `qinqin.placement.dismissed.${workspaceId}`;
}

export function isDismissed(storage: Storage | null, workspaceId: number): boolean {
	try {
		return storage?.getItem(dismissKey(workspaceId)) === '1';
	} catch {
		return false;
	}
}

export function setDismissed(storage: Storage | null, workspaceId: number): void {
	try {
		storage?.setItem(dismissKey(workspaceId), '1');
	} catch {
		// Private mode or denied storage: the offer shows again next visit.
	}
}
