// One open course for a page (#222): the workspace's installed courses, the chosen (or named) course and the
// learner's path state, shown from what is held at once and refreshed behind (#290, Rulings 6–8). The roadmap and the
// player create one for their lifetime (record 0009); an answer that lands after the session ended changes nothing.

import type { Course, CourseInfo } from '$lib/api/courses';
import type { Session } from '$lib/context/session.svelte';
import type { CourseState } from '$lib/studycore/courseProgress';
import { loadStudyHistory } from '$lib/studycore/data';
import type { StudyHistory } from '$lib/studycore/types';
import { chosenCourse, heldCourse, heldCourseList, refreshCourse, refreshCourseList } from './courseData';
import { courseState } from './progress';

export type CourseViewStatus = 'loading' | 'ready' | 'none' | 'missing' | 'error';

export class CourseView {
	readonly #session: Session;
	readonly #workspace: { id: number; language: string };
	readonly #courseId: string | null;
	status = $state<CourseViewStatus>('loading');
	list = $state.raw<CourseInfo[]>([]);
	course = $state.raw<Course | null>(null);
	history = $state.raw<StudyHistory | null>(null);
	state = $state.raw<CourseState | null>(null);
	/** A background refresh failed: what shows is the held copy. */
	stale = $state(false);

	constructor(session: Session, workspace: { id: number; language: string }, courseId: string | null) {
		this.#session = session;
		this.#workspace = workspace;
		this.#courseId = courseId;
	}

	get workspaceId(): number {
		return this.#workspace.id;
	}

	/** load shows the held course at once and refreshes the list and the course behind it. Never rejects. */
	async load(): Promise<void> {
		const session = this.#session;
		try {
			let list = heldCourseList(session, this.#workspace.language);
			if (list === null) list = await refreshCourseList(session, this.#workspace.language);
			else void refreshCourseList(session, this.#workspace.language).then((l) => this.#alive() && (this.list = l), () => (this.stale = true));
			this.list = list;
			const id = this.#courseId ?? chosenCourse(session, this.#workspace.id, list)?.id ?? null;
			if (id === null) {
				this.status = 'none';
				return;
			}
			let course = heldCourse(session, id);
			if (course === null) course = await refreshCourse(session, id);
			else {
				const held = course;
				void refreshCourse(session, id).then(
					(fresh) => {
						if (fresh !== null && fresh.fill !== held.fill && this.#alive()) void this.#show(fresh);
					},
					() => (this.stale = true)
				);
			}
			if (course === null) {
				this.status = 'missing';
				return;
			}
			await this.#show(course);
		} catch {
			if (this.#alive()) this.status = 'error';
		}
	}

	/** reread replays the study history again (after this page wrote progress, marks or cards). */
	async reread(): Promise<void> {
		if (this.course !== null) await this.#show(this.course);
	}

	async #show(course: Course): Promise<void> {
		const history = await loadStudyHistory(this.#session.study, this.#workspace.id);
		if (!this.#alive()) return;
		this.course = course;
		this.history = history;
		this.state = courseState(course, history);
		this.status = 'ready';
	}

	#alive(): boolean {
		return this.#session.alive;
	}
}
