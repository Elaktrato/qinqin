// The payloads of the study events the web app writes, one builder per
// type, pinned by docs/contracts/events/payloads.json. `lookup` has no
// builder: it is never written since #72 (the history is the `lookups`
// row). `review` payloads are built by studycore/events.ts.

/** `session`: no payload (JSON null). */
export function sessionPayload(): null {
	return null;
}

/** `view`: the dictionary entry the page showed. */
export function viewPayload(entryId: number): { entryId: number } {
	return { entryId };
}

/** `read`: one flush of the reading timer, credited to the book. */
export function readPayload(bookId: number, seconds: number): { bookId: number; seconds: number } {
	return { bookId, seconds };
}

/** `journal`: the journal entry (its ULID) whose text changed. */
export function journalPayload(entryId: string): { entryId: string } {
	return { entryId };
}

/** `script`: one answer of the writing-system trainer (#204): the system, the item or word, the mode, right or wrong. */
export function scriptPayload(system: string, item: string, mode: string, ok: boolean): { system: string; item: string; mode: string; ok: boolean } {
	return { system, item, mode, ok };
}

/**
 * `grammar`: one finished grammar run (#277): the grammar point (`<packId>:<lessonId>`), the mode (`lesson`, or
 * `review` for a review of a learned point, #181), the score and the number of exercises.
 */
export function grammarPayload<M extends 'lesson' | 'review' = 'lesson'>(
	packId: string,
	lessonId: string,
	score: number,
	total: number,
	mode: M = 'lesson' as M
): { point: string; mode: M; score: number; total: number } {
	return { point: `${packId}:${lessonId}`, mode, score, total };
}

/** The members of a `course` event, by kind (docs/contracts/courses/README.md "Progress events"). */
export type CoursePayload =
	| { kind: 'lesson-started'; course: string; unit: string; lesson: string }
	| { kind: 'lesson-finished'; course: string; unit: string; lesson: string; score: number; total: number; words: readonly string[] }
	| { kind: 'unit-test'; course: string; unit: string; score: number; total: number; passed: boolean; early: boolean }
	| { kind: 'section-exam'; course: string; section: string; score: number; total: number; passed: boolean }
	| { kind: 'placement'; course: string; section: string };

/**
 * `course`: course progress (#221): a lesson started or finished (with the keys of the words it taught), a unit test
 * (passed as judged then; `early` when taken before the unit's lessons were done), a section exam, a placement. The
 * members come out in the contract's order (courses/derive.json `build`), whatever order the input has.
 */
export function coursePayload(p: CoursePayload): CoursePayload {
	switch (p.kind) {
		case 'lesson-started':
			return { kind: p.kind, course: p.course, unit: p.unit, lesson: p.lesson };
		case 'lesson-finished':
			return { kind: p.kind, course: p.course, unit: p.unit, lesson: p.lesson, score: p.score, total: p.total, words: [...p.words] };
		case 'unit-test':
			return { kind: p.kind, course: p.course, unit: p.unit, score: p.score, total: p.total, passed: p.passed, early: p.early };
		case 'section-exam':
			return { kind: p.kind, course: p.course, section: p.section, score: p.score, total: p.total, passed: p.passed };
		case 'placement':
			return { kind: p.kind, course: p.course, section: p.section };
	}
}

/**
 * `drill.<id>`: one answer in a drill (docs/contracts/drills/): the item, the drill's mode and the FSRS grade (1 Again …
 * 4 Easy), then the drill's own members in their order (#228: the character asked and the one given); a member never
 * replaces the three.
 */
export function drillPayload(
	item: string,
	mode: string,
	grade: 1 | 2 | 3 | 4,
	extra: Readonly<Record<string, string>> = {}
): { item: string; mode: string; grade: 1 | 2 | 3 | 4 } & Record<string, string | number> {
	const payload: { item: string; mode: string; grade: 1 | 2 | 3 | 4 } & Record<string, string | number> = { item, mode, grade };
	for (const [name, value] of Object.entries(extra)) if (name !== 'item' && name !== 'mode' && name !== 'grade') payload[name] = value;
	return payload;
}

/** The members of a `notebook` mark (#227, docs/contracts/notebook/): a removal by hand of one item, or a clear. */
export type NotebookPayload = { action: 'remove'; item: string } | { action: 'clear' };

/** `notebook`: a mark of the mistake notebook; the members come out in the contract's order (notebook.json `build`). */
export function notebookPayload(p: NotebookPayload): NotebookPayload {
	return p.action === 'remove' ? { action: p.action, item: p.item } : { action: p.action };
}
