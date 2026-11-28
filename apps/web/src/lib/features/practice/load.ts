// What the Practice area reads: the workspace's study history (its drill answers, queued and just-sent ones
// included), the study clock, and each drill's candidate items.

import type { Workspace } from '$lib/api/types';
import type { Session } from '$lib/context/session.svelte';
import { contextForData } from '$lib/studycore/currentContext';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillStates, type DrillStates } from '$lib/studycore/drills';
import type { StudyClock } from '$lib/studycore/studyClock';
import type { DrillDef, DrillItem } from './types';

export interface PracticeData {
	states: DrillStates;
	clock: StudyClock;
	/** Each drill's candidate items, by drill id. */
	items: ReadonlyMap<string, readonly DrillItem[]>;
}

/** loadPractice reads the history once and asks every drill for its items. */
export async function loadPractice(session: Session, workspace: Workspace, drills: readonly DrillDef[]): Promise<PracticeData> {
	const history = await loadStudyHistory(session.study, workspace.id);
	const clock = contextForData(session.zone, history, workspace.id).clock;
	const lists = await Promise.all(drills.map((d) => d.items({ session, workspace, history })));
	return {
		states: drillStates(history.drillAnswers ?? [], clock),
		clock,
		items: new Map(drills.map((d, i) => [d.id, lists[i]]))
	};
}
