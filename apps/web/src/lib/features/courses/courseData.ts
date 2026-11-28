// The courses a learner sees, held for the session and on the device (#222, Rulings 6–8): GET /api/courses and
// GET /api/courses/{id} answer signed-in users only and the service worker does not keep them, so the app does
// (#221 ruling 28). A page shows what is held at once and refreshes it behind (#290). The device copy
// (localStorage `qinqin.course.v1.<user>.<key>`) is only ever read for its own user and is removed at sign-out
// (context/session.svelte.ts); storage that is full or denied leaves the session's copy only.

import { course as loadCourse, courses as loadCourses, decodeCourse, decodeCourseList, type Course, type CourseInfo } from '$lib/api/courses';
import type { Session } from '$lib/context/session.svelte';

export const COURSE_COPY_PREFIX = 'qinqin.course.v1.';

type Held = Pick<Session, 'user' | 'alive' | 'caches' | 'deps'>;

function key(session: Held, name: string): string | null {
	return session.user === null ? null : `${COURSE_COPY_PREFIX}${session.user}.${name}`;
}

function read(session: Held, name: string): unknown {
	const k = key(session, name);
	if (k === null) return null;
	try {
		const raw = session.deps.local()?.getItem(k);
		return raw == null ? null : JSON.parse(raw);
	} catch {
		return null;
	}
}

function write(session: Held, name: string, value: unknown): void {
	const k = key(session, name);
	if (k === null || !session.alive) return;
	try {
		session.deps.local()?.setItem(k, JSON.stringify(value));
	} catch {
		// Storage full or denied: the session's copy still holds it.
	}
}

const byId = (list: readonly CourseInfo[]): CourseInfo[] => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** heldCourseList: the installed courses of a language this session (or this user's device) holds, or null. */
export function heldCourseList(session: Held, language: string): CourseInfo[] | null {
	const lists = session.caches.courses.lists;
	if (!lists.has(language)) {
		const copy = read(session, `list.${language}`);
		if (copy === null) return null;
		lists.set(language, byId(decodeCourseList({ courses: copy })));
	}
	return lists.get(language) ?? null;
}

/** refreshCourseList reads the installed courses of a language and holds them. Errors reject and keep what is held. */
export async function refreshCourseList(session: Held, language: string): Promise<CourseInfo[]> {
	const list = byId(await loadCourses(language));
	if (session.alive) {
		session.caches.courses.lists.set(language, list);
		write(session, `list.${language}`, list);
	}
	return list;
}

/** heldCourse: the filled course this session (or this user's device) holds, or null. */
export function heldCourse(session: Held, id: string): Course | null {
	const held = session.caches.courses.courses;
	if (!held.has(id)) {
		const copy = decodeCourse(read(session, id));
		if (copy === null || copy.id !== id) return null;
		held.set(id, copy);
	}
	return held.get(id) ?? null;
}

/**
 * refreshCourse reads a filled course and holds it; the device copy is rewritten only when `fill` changed. Null: the
 * server has no such course (any more). Errors reject and keep what is held.
 */
export async function refreshCourse(session: Held, id: string): Promise<Course | null> {
	const fresh = await loadCourse(id);
	if (fresh === null || !session.alive) return fresh;
	const before = heldCourse(session, id);
	session.caches.courses.courses.set(id, fresh);
	if (before?.fill !== fresh.fill) write(session, id, fresh);
	return fresh;
}

/** pickCourse remembers the learner's course of a workspace on this device (Ruling 6). */
export function pickCourse(session: Held, workspaceId: number, courseId: string): void {
	const picks = read(session, 'picks');
	const next = typeof picks === 'object' && picks !== null && !Array.isArray(picks) ? { ...(picks as Record<string, unknown>) } : {};
	next[String(workspaceId)] = courseId;
	write(session, 'picks', next);
}

/** chosenCourse: the course of a workspace among the installed ones: the pick on this device, else the first by id. */
export function chosenCourse(session: Held, workspaceId: number, list: readonly CourseInfo[]): CourseInfo | null {
	const picks = read(session, 'picks');
	const picked = typeof picks === 'object' && picks !== null ? (picks as Record<string, unknown>)[String(workspaceId)] : undefined;
	return list.find((c) => c.id === picked) ?? byId(list)[0] ?? null;
}

/**
 * workspaceCourse: the filled course of a workspace (the device's pick, else the first by id), from what is held, read
 * from the server only when nothing is; null without a course for the language or when it cannot be read. Never
 * rejects: Home's widget and the milestones (#225) show nothing rather than an error.
 */
export async function workspaceCourse(session: Held, workspace: { id: number; language: string }): Promise<Course | null> {
	try {
		const list = heldCourseList(session, workspace.language) ?? (await refreshCourseList(session, workspace.language));
		const info = chosenCourse(session, workspace.id, list);
		if (info === null) return null;
		return heldCourse(session, info.id) ?? (await refreshCourse(session, info.id));
	} catch {
		return null;
	}
}

/** forgetCourseCopies removes every device copy (the sign-out). */
export function forgetCourseCopies(storage: Storage | null): void {
	if (storage === null) return;
	try {
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const k = storage.key(i);
			if (k?.startsWith(COURSE_COPY_PREFIX)) keys.push(k);
		}
		for (const k of keys) storage.removeItem(k);
	} catch {
		// Nothing to remove.
	}
}
