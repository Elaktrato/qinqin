// Reading-position restore, as pure decisions for BookView.
//
// Rule: the saved position is applied once per opened book. When the URL
// chapter is the saved chapter, scroll to the saved paragraph. When it
// differs, restore only if the URL chapter is 0 (the default the library
// links to): then navigate to the saved chapter first. Any other chapter
// in the URL is an explicit choice and wins.
import { parsePosition, type Position } from './position';

export type RestorePlan =
	| { kind: 'none' }
	| { kind: 'scroll'; target: Position }
	| { kind: 'navigate'; target: Position };

export function restorePlan(stored: string, chapterCount: number, urlChapter: number): RestorePlan {
	const saved = parsePosition(stored);
	if (!saved || saved.chapter >= chapterCount) return { kind: 'none' };
	if (saved.chapter === urlChapter) return { kind: 'scroll', target: saved };
	if (urlChapter === 0) return { kind: 'navigate', target: saved };
	return { kind: 'none' };
}

/**
 * jumpPlan is the plan for an explicit jump (a bookmark): scroll within
 * the chapter on screen, otherwise navigate to the target chapter first.
 * Unlike restorePlan, the chapter in the URL never wins.
 */
export function jumpPlan(stored: string, chapterCount: number, urlChapter: number): RestorePlan {
	const target = parsePosition(stored);
	if (!target || target.chapter >= chapterCount) return { kind: 'none' };
	return target.chapter === urlChapter ? { kind: 'scroll', target } : { kind: 'navigate', target };
}

/**
 * restoreDecision says what a pending restore does now: 'restore' once
 * its chapter is loaded, 'wait' while it loads, and 'skip' when the
 * reader went elsewhere or the chapter failed (never block reading).
 */
export function restoreDecision(state: {
	target: Position;
	urlChapter: number;
	loadedChapter: number | null;
	loadFailed: boolean;
}): 'restore' | 'wait' | 'skip' {
	if (state.urlChapter !== state.target.chapter || state.loadFailed) return 'skip';
	return state.loadedChapter === state.target.chapter ? 'restore' : 'wait';
}
