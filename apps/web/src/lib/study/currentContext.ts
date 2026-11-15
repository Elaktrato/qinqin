// The StudyContext of the signed-in learner for a workspace's vacation runs,
// from the learner's current zone history. history.ts calls it per load.

import { currentStudyDay, currentStudyHistory } from '../time/zone';
import { contextFor, type StudyContext } from './studyContext';
import type { Run } from './vacation';

export function currentContext(runs: readonly Run[] = [], now: number = Date.now()): StudyContext {
	return contextFor(currentStudyDay(), runs, now, currentStudyHistory());
}
