// Keyed-row commands (#193): the study namespace's keyed rows — vacations
// (user-global), the daily goal, known marks and seen milestones — through
// commands/write.ts (lib/sync/keyed.ts underneath).

import { ApiError } from '../../api/client';
import { GOALS_KEY, type GoalsRow } from '../../goals/goals';
import { MILESTONE_KEY_PREFIX } from '../../milestones/catalogue';
import { PartialPushError } from '../../sync/push';
import { knownMarkKey, knownMarkRow } from '../knownMarks';
import { VACATION_PREFIX, type VacationPeriod } from '../vacation';
import { planningView } from '../data';
import { deleteData, pushKeyedRows, putData, requireWorkspaceArg } from './write';

/** saveVacation stores one vacation period (user-global: no workspace). */
export async function saveVacation(period: VacationPeriod): Promise<void> {
	await putData(null, `${VACATION_PREFIX}${period.id}`, period);
}

/** deleteVacation tombstones one vacation period. */
export async function deleteVacation(id: string): Promise<void> {
	await deleteData(null, `${VACATION_PREFIX}${id}`);
}

/**
 * saveGoals stores one workspace's daily goal row as given (unknown keys
 * included); the caller plans it with planGoalEdit (goals/goals.ts) and
 * passes the workspace the row was read from, never "whatever is current
 * now", so a workspace switch mid-save cannot write another workspace.
 */
export async function saveGoals(workspaceId: number, row: GoalsRow): Promise<void> {
	requireWorkspaceArg(workspaceId, 'saveGoals');
	await putData(workspaceId, GOALS_KEY, row);
}

/**
 * setKnownMark marks (PUT) or unmarks (DELETE = tombstone) one entry as
 * known in the given workspace (the book's, never 'whatever is current').
 * Unmarking a mark the server does not hold is not an error.
 */
export async function setKnownMark(workspaceId: number, entryId: number, on: boolean): Promise<void> {
	requireWorkspaceArg(workspaceId, 'setKnownMark');
	if (on) {
		const row = knownMarkRow(entryId, new Date());
		await putData(workspaceId, row.key, row.data);
		return;
	}
	try {
		await deleteData(workspaceId, knownMarkKey(entryId));
	} catch (err) {
		if (!(err instanceof ApiError && err.status === 404)) throw err;
	}
}

/**
 * setKnownMarks marks or unmarks many entries through pushKeyedRows (200
 * rows per request). A skipped row is a PartialPushError; unmark only
 * entries whose mark is live (a tombstone for a missing row is skipped).
 */
export async function setKnownMarks(
	workspaceId: number,
	entryIds: readonly number[],
	on: boolean,
	opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
	requireWorkspaceArg(workspaceId, 'setKnownMarks');
	// Each row is stamped after the time the server holds for its key (a
	// client clock behind the server's would otherwise lose every write).
	const { knownAt } = (await planningView(workspaceId)).snapshot;
	const now = new Date();
	const rows = [...new Set(entryIds)].map((id) => {
		const row = knownMarkRow(id, now);
		const at = knownAt.get(row.key);
		const stamp = at === undefined ? {} : { knownAt: at };
		return on ? { ...row, ...stamp } : { key: row.key, data: {}, deleted: true as const, ...stamp };
	});
	await pushKeyedRows(workspaceId, rows, opts);
}

/**
 * saveSeenMilestones writes `milestone:<id>` rows (docs/contracts/milestones/)
 * in one push: never a tombstone, the caller passes only keys that are not
 * live (seenWritePlan); a row reviving a tombstone carries its `knownAt` and
 * is stamped after it. 'done': every row was written. 'pending': the server
 * skipped a row (it holds a newer one for the key: a tombstone this client
 * has not pulled, or a clock behind the server's) or refused one; the
 * caller keeps those ids pending until the row is live in a pull. A failed
 * request rejects (also pending). Listeners are notified either way.
 */
export async function saveSeenMilestones(
	workspaceId: number,
	rows: readonly { key: string; data: unknown; knownAt?: string }[],
): Promise<'done' | 'pending'> {
	requireWorkspaceArg(workspaceId, 'saveSeenMilestones');
	for (const row of rows) {
		if (!row.key.startsWith(MILESTONE_KEY_PREFIX)) throw new Error(`${row.key}: not a milestone row`);
	}
	if (rows.length === 0) return 'done';
	try {
		await pushKeyedRows(
			workspaceId,
			rows.map((row) => ({ key: row.key, data: row.data, ...(row.knownAt === undefined ? {} : { knownAt: row.knownAt }) })),
			{ chunk: rows.length },
		);
	} catch (err) {
		if (err instanceof PartialPushError && err.skipped > 0) return 'pending';
		throw err;
	}
	return 'done';
}

