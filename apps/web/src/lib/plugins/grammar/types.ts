// TypeScript mirrors of the grammar API (server/internal/grammar). The
// server always sends `pattern`, `distractors` and `schemeLevels` as arrays.

export interface SchemeLevel {
	scheme: string;
	level: string;
}

export interface Level {
	id: string;
	name: string;
	schemeLevels: SchemeLevel[];
}

export interface Example {
	id: string;
	text: string;
	reading: string;
	translation: string;
	focus: string;
	distractors: string[];
}

export interface Lesson {
	id: string;
	level: string;
	title: string;
	summary: string;
	pattern: string[];
	body: string[];
	examples: Example[];
}

export interface LessonSummary {
	id: string;
	level: string;
	title: string;
	summary: string;
	examples: number;
}

export interface PackInfo {
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	notice: string;
	levels: Level[];
	/** Omitted in a LessonView's pack. */
	lessons?: LessonSummary[];
}

export interface LessonView {
	pack: PackInfo;
	lesson: Lesson;
	prev: string;
	next: string;
}

/** A learner's result for one lesson. */
export interface Progress {
	completedAt: string;
	best: number;
	total: number;
}
