// Course words in normal study (#222, Rulings 12, 16–18): a finished word lesson adds a vocab card for each of its
// words to the course's deck (a stored deck with a derived id, made by the first lesson that needs it) and records
// each new card's first review from the lesson's check, so the words never wait behind a daily new-card limit. Words
// of skipped units are marked known as one declaration; "Add these as cards" adds them as new cards. Written through
// the study core's write primitives (record 0004: the course never imports the flashcards feature).

import type { Course, CourseWord } from '$lib/api/courses';
import type { Session } from '$lib/context/session.svelte';
import { pushStudy, replanned, requireWorkspaceArg } from '$lib/studycore/commands/write';
import { setKnownMarks } from '$lib/studycore/commands/keyed';
import type { StudyState } from '$lib/studycore/data';
import { newUlid } from '$lib/events/ulid';
import { extraOf, freshCardId, studyWrite, type Snap, type StudyWrite } from '$lib/studycore/plan';
import { cardRow, deckRow } from '$lib/studycore/rows';
import type { Deck, ReviewGrade, StudyCard } from '$lib/studycore/types';
import { wordsByKey } from './progress';
import { titleText } from './roadmap';

/** The id of a course's deck: `d-course-` and the course id, lower case, other characters as `-` (Ruling 17). */
export function courseDeckId(courseId: string): string {
	return `d-course-${courseId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

export interface CourseCardWord {
	entryId: number;
	form: string;
}

/** planCourseCards: the deck (when missing) and a vocab card for each word that has none, in word order. */
export function planCourseCards(
	data: { decks: readonly Deck[]; cards: readonly StudyCard[] },
	snap: Snap,
	course: Pick<Course, 'id' | 'title'>,
	words: readonly CourseCardWord[],
	now: Date
): { writes: StudyWrite[]; created: StudyCard[] } {
	const deckId = courseDeckId(course.id);
	const writes: StudyWrite[] = [];
	const carded = new Set(data.cards.filter((c) => c.kind === 'vocab').map((c) => c.entryId));
	const created: StudyCard[] = [];
	for (const w of words) {
		if (carded.has(w.entryId)) continue;
		carded.add(w.entryId);
		created.push({
			id: freshCardId([...data.cards, ...created], snap?.unreadable ?? new Set(), 'vocab', w.entryId),
			kind: 'vocab',
			entryId: w.entryId,
			written: w.form,
			deckIds: [deckId],
			createdAt: now.toISOString()
		});
	}
	if (created.length > 0 && !data.decks.some((d) => d.id === deckId)) {
		const deck = studyWrite(snap, 'decks', deckRow({ id: deckId, name: titleText(course.title, 'en'), createdAt: now.toISOString() }, extraOf(snap, 'decks', deckId)));
		if (deck !== null) writes.push(deck);
	}
	for (const card of created) {
		const write = studyWrite(snap, 'cards', cardRow(card, extraOf(snap, 'cards', card.id)));
		if (write !== null) writes.push(write);
	}
	return { writes, created };
}

/** addCourseCards writes the course deck and the words' new cards; answers the cards it created. */
export async function addCourseCards(study: StudyState, workspaceId: number, course: Pick<Course, 'id' | 'title'>, words: readonly CourseCardWord[]): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'addCourseCards');
	return replanned(study, workspaceId, async ({ data, snapshot }) => {
		const plan = planCourseCards(data, snapshot, course, words, new Date());
		if (plan.writes.length > 0) await pushStudy(study, workspaceId, plan.writes);
		return plan.created;
	});
}

/**
 * recordFirstReviews records the first review of each card a lesson created, graded by the lesson's check
 * (Ruling 16): through the outbox, like every review.
 */
export async function recordFirstReviews(
	session: { outbox: Pick<Session['outbox'], 'recordReview'> },
	workspaceId: number,
	cards: readonly StudyCard[],
	grades: ReadonlyMap<number, ReviewGrade>
): Promise<void> {
	for (const card of cards) await session.outbox.recordReview(workspaceId, card.id, grades.get(card.entryId) ?? 3, 'vocab');
}

/**
 * uncardedMetWords: the course words met in lessons whose entry has no vocab card: the cards of a lesson finished
 * offline (the lesson counts; its cards could not be written), or cards the learner deleted. The roadmap offers to add
 * them; nothing adds them by itself.
 */
export function uncardedMetWords(course: Course, met: readonly string[], cards: readonly StudyCard[]): CourseWord[] {
	const words = wordsByKey(course);
	const carded = new Set(cards.filter((c) => c.kind === 'vocab').map((c) => c.entryId));
	return met.map((k) => words.get(k)).filter((w): w is CourseWord => w !== undefined && !carded.has(w.entryId));
}

/** markCourseKnown marks the entries of course word keys known, as one declaration of the course (Ruling 12). */
export async function markCourseKnown(study: StudyState, workspaceId: number, course: Course, keys: readonly string[]): Promise<void> {
	const words = wordsByKey(course);
	const ids = keys.map((k) => words.get(k)?.entryId).filter((id): id is number => id !== undefined);
	if (ids.length === 0) return;
	await setKnownMarks(study, workspaceId, ids, true, {
		batch: { id: newUlid(), source: 'placement', scope: `Course: ${titleText(course.title, 'en')}` }
	});
}
