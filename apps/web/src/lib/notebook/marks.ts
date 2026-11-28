// The mistake notebook's marks (#227, docs/contracts/notebook/): a removal by hand and a clear are `notebook` events,
// written through the session's outbox like every answer.

import type { StudyEventBody } from '$lib/api/types';
import { notebookPayload, type NotebookPayload } from '$lib/events/eventPayloads';
import { newUlid } from '$lib/events/ulid';
import { NOTEBOOK_EVENT } from '$lib/studycore/notebook';

/** markEvent builds the event of one mark. */
export function markEvent(workspaceId: number, mark: NotebookPayload, now: number = Date.now()): StudyEventBody {
	return { id: newUlid(now), workspaceId, device: 'web', ts: new Date(now).toISOString(), type: NOTEBOOK_EVENT, payload: notebookPayload(mark) };
}
