// Course progress (#221, docs/contracts/courses/README.md): what a learner did in a course is `course` study events
// (a lesson started or finished, a unit test, a section exam, a placement), and the path state (done, current,
// unlocked and locked units and lessons, the words to mark known, the catch-up lessons) is derived from them over the
// filled course, never stored. The same rule as the server's courses.Derive, pinned by derive.json and changes.json.

import type { StudyEvent } from '$lib/events';

/** The event type of course progress. */
export const COURSE_EVENT = 'course';

/** The most words a lesson introduces (the catch-up lessons' size too). */
export const MAX_LESSON_WORDS = 7;

/** A unit's `next` when its lessons are done and its test comes next. */
export const NEXT_TEST = 'test';

const MAX_SCORE = 1000;
const MAX_EVENT_WORDS = 50;
const MAX_KEY_BYTES = 128;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PACK_ID = /^[A-Za-z0-9._-]{1,128}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** What the derivation reads of a filled course (`Course` of lib/api/courses.ts has it all). */
export interface DeriveCourse {
	sections: readonly {
		id: string;
		units: readonly { id: string; test: boolean; words: readonly { key: string }[]; lessons: readonly { id: string }[] }[];
	}[];
}

/** One readable course event. */
export interface CourseEvent {
	id: string;
	/** The instant of `ts`, epoch milliseconds. */
	at: number;
	kind: 'lesson-started' | 'lesson-finished' | 'unit-test' | 'section-exam' | 'placement';
	course: string;
	unit: string;
	section: string;
	lesson: string;
	score: number;
	total: number;
	passed: boolean;
	early: boolean;
	words: string[];
}

export type Status = 'done' | 'current' | 'unlocked' | 'locked';
export type LessonStatus = 'done' | 'next' | 'unlocked' | 'locked';

export interface LessonState {
	id: string;
	status: LessonStatus;
	/** Started and not finished. */
	started: boolean;
}

/** A catch-up lesson: words a done, studied unit gained after the learner finished it. */
export interface CatchUpLesson {
	id: string;
	kind: 'words';
	words: string[];
}

export interface UnitState {
	id: string;
	status: Status;
	/** Done by a test, an exam or a placement, not by study. */
	skipped: boolean;
	testPassed: boolean;
	/** The unit's next lesson id, or NEXT_TEST, while it is open; null otherwise. */
	next: string | null;
	lessons: LessonState[];
	catchUp: CatchUpLesson[];
}

export interface SectionState {
	id: string;
	status: Status;
	examPassed: boolean;
	units: UnitState[];
}

export interface CourseState {
	/** The next thing to do on the path; null when every unit is done. */
	current: { section: string; unit: string; next: string } | null;
	sections: SectionState[];
	/** Every word a finished lesson taught, in the order first met. */
	met: string[];
	/** Words of skipped units neither met nor marked known: the client marks them known. */
	known: string[];
}

const bytes = (s: string): number => new TextEncoder().encode(s).length;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && ID.test(v);
const isPack = (v: unknown): v is string => typeof v === 'string' && PACK_ID.test(v);
const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SCORE;

/** parseCourseEvent reads a stored event as a course event; null when it is not a readable one (README "Parsing"). */
export function parseCourseEvent(event: Pick<StudyEvent, 'id' | 'ts' | 'type' | 'payload'>): CourseEvent | null {
	if (event === null || typeof event !== 'object' || event.type !== COURSE_EVENT) return null;
	if (typeof event.ts !== 'string' || !RFC3339.test(event.ts)) return null;
	const at = Date.parse(event.ts);
	if (!Number.isFinite(at)) return null;
	const p = event.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	const r = p as Record<string, unknown>;
	if (!isPack(r.course)) return null;
	const out: CourseEvent = {
		id: String(event.id),
		at,
		kind: 'placement',
		course: r.course,
		unit: '',
		section: '',
		lesson: '',
		score: 0,
		total: 0,
		passed: false,
		early: false,
		words: []
	};
	const scored = (): boolean => {
		if (!isScore(r.score) || !isScore(r.total) || r.score > r.total) return false;
		out.score = r.score;
		out.total = r.total;
		return true;
	};
	switch (r.kind) {
		case 'lesson-started':
		case 'lesson-finished': {
			if (!isId(r.unit) || !isId(r.lesson)) return null;
			out.kind = r.kind;
			out.unit = r.unit;
			out.lesson = r.lesson;
			if (r.kind === 'lesson-started') return out;
			if (!scored()) return null;
			const words = r.words;
			if (!Array.isArray(words) || words.length > MAX_EVENT_WORDS) return null;
			for (const w of words) if (typeof w !== 'string' || w === '' || bytes(w) > MAX_KEY_BYTES) return null;
			out.words = [...(words as string[])];
			return out;
		}
		case 'unit-test':
			if (!isId(r.unit) || !scored() || typeof r.passed !== 'boolean' || typeof r.early !== 'boolean') return null;
			return { ...out, kind: r.kind, unit: r.unit, passed: r.passed, early: r.early };
		case 'section-exam':
			if (!isId(r.section) || !scored() || typeof r.passed !== 'boolean') return null;
			return { ...out, kind: r.kind, section: r.section, passed: r.passed };
		case 'placement':
			if (!isId(r.section)) return null;
			return { ...out, section: r.section };
	}
	return null;
}

/** lessonSizes splits n words into ceil(n/7) lessons whose sizes differ by at most one, the larger first. */
export function lessonSizes(n: number): number[] {
	if (n <= 0) return [];
	const m = Math.ceil(n / MAX_LESSON_WORDS);
	return Array.from({ length: m }, (_, i) => Math.floor(n / m) + (i < n % m ? 1 : 0));
}

function catchUpLessons(keys: string[]): CatchUpLesson[] {
	const out: CatchUpLesson[] = [];
	let at = 0;
	lessonSizes(keys.length).forEach((size, i) => {
		out.push({ id: `catch-up-${i + 1}`, kind: 'words', words: keys.slice(at, at + size) });
		at += size;
	});
	return out;
}

const pair = (unit: string, lesson: string): string => `${unit}\u0000${lesson}`;

/** courseEventsOf: the readable events of course `courseId` in replay order (instant, then id). */
export function courseEventsOf(courseId: string, events: readonly StudyEvent[]): CourseEvent[] {
	const ps: CourseEvent[] = [];
	for (const e of events) {
		const p = parseCourseEvent(e);
		if (p !== null && p.course === courseId) ps.push(p);
	}
	return ps.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type ReplayUnit = DeriveCourse['sections'][number]['units'][number];

/**
 * CourseReplay applies a course's events one at a time (README "Derivation"): finished and started lessons, met
 * words, and which units are passed (studied or skipped). deriveCourseState reads it after the last event; the
 * milestones read it after each one.
 */
export class CourseReplay {
	readonly course: DeriveCourse;
	/** Every unit in course order: its section and unit index. */
	readonly order: { section: number; unit: number }[] = [];
	readonly unitAt = new Map<string, number>();
	readonly sectionAt = new Map<string, number>();
	readonly finished = new Set<string>();
	readonly started = new Set<string>();
	readonly met: string[] = [];
	readonly metSet = new Set<string>();
	/** Per unit in course order: 0 not passed, 1 studied, 2 skipped. */
	readonly passed: (0 | 1 | 2)[];
	readonly testPassed: boolean[];
	readonly examPassed: boolean[];

	constructor(course: DeriveCourse) {
		this.course = course;
		course.sections.forEach((s, si) => {
			this.sectionAt.set(s.id, si);
			s.units.forEach((u, ui) => {
				this.unitAt.set(u.id, this.order.length);
				this.order.push({ section: si, unit: ui });
			});
		});
		this.passed = new Array<0 | 1 | 2>(this.order.length).fill(0);
		this.testPassed = new Array<boolean>(this.order.length).fill(false);
		this.examPassed = new Array<boolean>(course.sections.length).fill(false);
	}

	/** unit: the unit at a position in course order. */
	unit(i: number): ReplayUnit {
		const at = this.order[i]!;
		return this.course.sections[at.section]!.units[at.unit]!;
	}

	/** isFinished: the lesson of the unit was finished. */
	isFinished(unit: string, lesson: string): boolean {
		return this.finished.has(pair(unit, lesson));
	}

	/** done: passed, or, for a unit without a test, every lesson finished. */
	done(i: number): boolean {
		if (this.passed[i] !== 0) return true;
		const u = this.unit(i);
		return !u.test && u.lessons.every((l) => this.finished.has(pair(u.id, l.id)));
	}

	apply(p: CourseEvent): void {
		switch (p.kind) {
			case 'lesson-started':
				this.started.add(pair(p.unit, p.lesson));
				break;
			case 'lesson-finished':
				this.finished.add(pair(p.unit, p.lesson));
				for (const w of p.words) {
					if (!this.metSet.has(w)) {
						this.metSet.add(w);
						this.met.push(w);
					}
				}
				break;
			case 'unit-test': {
				const i = this.unitAt.get(p.unit);
				if (i === undefined || !p.passed) break;
				this.testPassed[i] = true;
				if (p.early) this.#skipBefore(i + 1);
				else if (this.passed[i] === 0) this.passed[i] = 1;
				break;
			}
			case 'section-exam': {
				const si = this.sectionAt.get(p.section);
				if (si === undefined || !p.passed) break;
				this.examPassed[si] = true;
				this.#skipBefore(this.#endOf((s) => s <= si));
				break;
			}
			case 'placement': {
				const si = this.sectionAt.get(p.section);
				if (si === undefined) break;
				this.#skipBefore(this.#endOf((s) => s < si));
				break;
			}
		}
	}

	#skipBefore(end: number): void {
		for (let i = 0; i < end; i++) if (this.passed[i] === 0) this.passed[i] = 2;
	}

	#endOf(inSection: (section: number) => boolean): number {
		let end = 0;
		this.order.forEach((r, i) => {
			if (inSection(r.section)) end = i + 1;
		});
		return end;
	}
}

/**
 * deriveCourseState replays one workspace's events of course `courseId` over the filled course (README
 * "Derivation"). `known` is the words the learner has marked known. The result depends on the events' (ts, id) order,
 * never on their arrival.
 */
export function deriveCourseState(course: DeriveCourse, courseId: string, events: readonly StudyEvent[], known: readonly string[]): CourseState {
	const replay = new CourseReplay(course);
	for (const p of courseEventsOf(courseId, events)) replay.apply(p);
	const { order, unitAt, finished, started, met, metSet, passed, testPassed, examPassed } = replay;
	const unit = (i: number) => replay.unit(i);

	const knownIn = new Set(known);
	const knownOut = new Set<string>();
	const state: CourseState = { current: null, sections: [], met, known: [] };
	const done = order.map((_, i) => {
		const u = unit(i);
		const d = replay.done(i);
		if (passed[i] === 2) {
			for (const w of u.words) {
				if (!metSet.has(w.key) && !knownIn.has(w.key) && !knownOut.has(w.key)) {
					knownOut.add(w.key);
					state.known.push(w.key);
				}
			}
		}
		return d;
	});
	const position = done.lastIndexOf(true);
	let current = -1;
	for (let i = position + 1; i < order.length; i++) {
		if (!done[i]) {
			current = i;
			break;
		}
	}

	for (const s of course.sections) {
		let allDone = true;
		let hasCurrent = false;
		let hasUnlocked = false;
		const units: UnitState[] = [];
		for (const u of s.units) {
			const i = unitAt.get(u.id)!;
			const us: UnitState = { id: u.id, status: 'locked', skipped: false, testPassed: testPassed[i]!, next: null, lessons: [], catchUp: [] };
			if (done[i]) {
				us.status = 'done';
				us.skipped = passed[i] === 2;
				us.lessons = u.lessons.map((l) => ({ id: l.id, status: 'done', started: false }));
				if (passed[i] !== 2) {
					const keys = u.words.map((w) => w.key).filter((k) => !metSet.has(k) && !knownIn.has(k) && !knownOut.has(k));
					us.catchUp = catchUpLessons(keys);
				}
			} else if (i === current || i < position) {
				us.status = i === current ? 'current' : 'unlocked';
				if (i === current) hasCurrent = true;
				else hasUnlocked = true;
				const next = openLessons(u, finished, started, us);
				us.next = next === '' ? null : next;
				if (i === current) state.current = { section: s.id, unit: u.id, next };
			} else {
				us.lessons = u.lessons.map((l) => ({ id: l.id, status: finished.has(pair(u.id, l.id)) ? 'done' : 'locked', started: false }));
			}
			allDone &&= done[i]!;
			units.push(us);
		}
		const status: Status = allDone ? 'done' : hasCurrent ? 'current' : hasUnlocked ? 'unlocked' : 'locked';
		state.sections.push({ id: s.id, status, examPassed: examPassed[course.sections.indexOf(s)]!, units });
	}
	// Member order as the server's JSON: current, sections, met, known.
	return { current: state.current, sections: state.sections, met: state.met, known: state.known };
}

/**
 * openLessons sets the lesson states of an open unit and returns its next lesson id, NEXT_TEST or '' (README "Inside
 * a unit"): the position is the last finished lesson; the first unfinished one after it is next; unfinished lessons
 * before it are unlocked; later ones locked. With none after it, the test is next, or, for a unit without a test,
 * its first unfinished lesson.
 */
function openLessons(u: DeriveCourse['sections'][number]['units'][number], finished: Set<string>, started: Set<string>, us: UnitState): string {
	const isDone = (id: string) => finished.has(pair(u.id, id));
	let pos = -1;
	u.lessons.forEach((l, li) => {
		if (isDone(l.id)) pos = li;
	});
	let next = -1;
	for (let li = pos + 1; li < u.lessons.length; li++) {
		if (!isDone(u.lessons[li]!.id)) {
			next = li;
			break;
		}
	}
	if (next < 0 && !u.test) next = u.lessons.findIndex((l) => !isDone(l.id));
	us.lessons = u.lessons.map((l, li) => {
		let status: LessonStatus;
		if (isDone(l.id)) status = 'done';
		else if (li === next) status = 'next';
		else if (li < pos || (next >= 0 && li < next)) status = 'unlocked';
		else status = 'locked';
		return { id: l.id, status, started: started.has(pair(u.id, l.id)) && !isDone(l.id) && status !== 'locked' };
	});
	if (next >= 0) return u.lessons[next]!.id;
	return u.test ? NEXT_TEST : '';
}
