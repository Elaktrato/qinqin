// When Home offers the course start card (#225, plan Rulings 21–23): a workspace that has nothing yet (no card, no
// known mark, no course event) whose language has a course, while Courses is on. The card asks how the learner wants
// to start: "I'm new to this language" (the course, with Starter mode) or "I know some already" (the course
// placement, or the level declaration of #74). Wherever a course applies it takes the place of the Starter (#214) and
// placement (#74) offers, which stay for languages without a course. "Not now" is remembered on this device only.

export interface CourseStartFacts {
	coursesOn: boolean;
	/** The workspace's language has an installed course. */
	hasCourse: boolean;
	cards: number;
	/** Live `known:` rows, declared or by hand. */
	marks: number;
	/** The workspace's course events. */
	courseEvents: number;
	dismissed: boolean;
}

/** courseStartApplies: a course stands for this workspace's start, so the older offers stay away. */
export function courseStartApplies(facts: CourseStartFacts): boolean {
	return facts.coursesOn && facts.hasCourse;
}

export function shouldOfferCourseStart(facts: CourseStartFacts): boolean {
	return courseStartApplies(facts) && facts.cards === 0 && facts.marks === 0 && facts.courseEvents === 0 && !facts.dismissed;
}

export function courseStartDismissKey(workspaceId: number): string {
	return `qinqin.courseStart.dismissed.${workspaceId}`;
}

export function isCourseStartDismissed(storage: Storage | null, workspaceId: number): boolean {
	try {
		return storage?.getItem(courseStartDismissKey(workspaceId)) === '1';
	} catch {
		return false;
	}
}

export function setCourseStartDismissed(storage: Storage | null, workspaceId: number): void {
	try {
		storage?.setItem(courseStartDismissKey(workspaceId), '1');
	} catch {
		// Private mode or denied storage: the card shows again next visit.
	}
}
