// The study pull of one workspace (docs/contracts/sync/, pull v2): a round of
// the keyed rows and the typed study collections of the workspace plus the
// user-global rows, merged in page order. From no cursor it
// asks for tombstones too: the stamps of a later write must beat the server's
// tombstones (a re-add from a slower clock must not lose to them). With a
// cursor it is a delta: the rows written since, tombstones included.

import { firstPageUrl, pullAll } from '$lib/sync/pager';
import { STUDY_COLLECTIONS } from '../rows';

/**
 * What the study pull asks for: the keyed rows plus every typed study collection (record 0002). The feature
 * switches come from GET /api/features (#199).
 */
export const STUDY_PULL_COLLECTIONS: readonly string[] = ['rows', ...STUDY_COLLECTIONS];

export interface StudyRound {
	collections: Record<string, unknown[]>;
	/** The cursor of the next delta round. */
	cursor: string;
	/** The server clock of the round, truncated to the second: rows stamped from it on come next round. */
	until: string;
	pages: number;
}

/** pullStudyRound reads one round of a workspace: from scratch, or a delta from `since` (a cursor). */
export async function pullStudyRound(
	get: (path: string) => Promise<unknown>,
	workspaceId: number,
	since?: string
): Promise<StudyRound> {
	const first = firstPageUrl({
		collections: STUDY_PULL_COLLECTIONS,
		workspace: workspaceId,
		tombstones: true,
		...(since === undefined ? {} : { since })
	});
	let until = '';
	const round = await pullAll(
		async (path) => {
			const page = await get(path);
			if (until === '' && typeof page === 'object' && page !== null) {
				const at = (page as { until?: unknown }).until;
				if (typeof at === 'string') until = at;
			}
			return page;
		},
		first,
		STUDY_PULL_COLLECTIONS
	);
	return { collections: round.collections, cursor: round.cursor, until, pages: round.pages };
}
