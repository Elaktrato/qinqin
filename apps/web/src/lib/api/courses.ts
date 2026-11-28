// Courses (#221): GET /api/courses (the installed course packs) and GET /api/courses/{id} (one course filled with
// words from the server's installed level packs). Contract: docs/contracts/courses/README.md; the filled course is
// fill.json's `expect` plus the pack's credits and the `fill` hash (the route's ETag). Signed-in users only.

import { api } from './client';

/** A text in the interface languages; `en` is always there. */
export type CourseTitle = Record<string, string>;

/** One installed course (GET /api/courses). */
export interface CourseInfo {
	id: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	notice: string;
	title: CourseTitle;
}

/** A unit's word: the dictionary entry's key (the word's id in progress events), display form, reading and entry id. */
export interface CourseWord {
	key: string;
	form: string;
	reading: string;
	entryId: number;
	/** The frequency rank; null when the language's frequency pack has none. */
	rank: number | null;
	topics: string[];
}

export type CourseLesson =
	| { id: string; kind: 'words'; words: string[] }
	| { id: string; kind: 'script'; characters: string[]; scripts: string[] }
	| { id: string; kind: 'grammar'; point: string; available: boolean }
	| { id: string; kind: 'practice' | 'listening' | 'speaking' | 'reading' };

export interface CourseText {
	title: string;
	body: string;
	translation?: CourseTitle;
}

export interface CourseUnit {
	id: string;
	title: CourseTitle;
	topics: string[];
	grammar: string[];
	characters: string[];
	scripts: string[];
	text: CourseText | null;
	focus: 'listening' | 'speaking' | null;
	/** A unit test closes the unit. */
	test: boolean;
	words: CourseWord[];
	lessons: CourseLesson[];
}

export interface CourseSection {
	id: string;
	/** The 1-based level position in the course's level scheme; null for a start section without words. */
	level: number | null;
	levelName: string | null;
	title: CourseTitle;
	/** A section exam closes the section. */
	exam: boolean;
	units: CourseUnit[];
}

export interface Checkpoint {
	questions: number;
	passPercent?: number;
}

export interface Course {
	id: string;
	name: string;
	version: string;
	license: string;
	attribution: string;
	notice: string;
	/** Identifies the filled content; the route's ETag. */
	fill: string;
	language: string;
	title: CourseTitle;
	source: { kind: 'levels' | 'frequency' | 'none'; pack: string | null };
	checkpoints: { lesson: Checkpoint; unit: Checkpoint & { passPercent: number }; section: Checkpoint & { passPercent: number } };
	sections: CourseSection[];
	unplaced: { key: string; form: string; reading: string; level: number; reason: string }[];
	counts: { candidates: number; placed: number; byTopic: number; unplaced: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isTitle = (v: unknown): v is CourseTitle => isObj(v) && isStr(v.en) && Object.values(v).every(isStr);

class Malformed extends Error {}
function need(ok: boolean): asserts ok {
	if (!ok) throw new Malformed();
}

function decodeWord(v: unknown): CourseWord {
	need(isObj(v) && isStr(v.key) && isStr(v.form) && isStr(v.reading) && isInt(v.entryId) && (v.rank === null || isInt(v.rank)) && isStrs(v.topics));
	return { key: v.key, form: v.form, reading: v.reading, entryId: v.entryId, rank: v.rank as number | null, topics: [...v.topics] };
}

/** decodeLesson reads one lesson; null for a kind this client does not know (a later server's), which it skips. */
function decodeLesson(v: unknown): CourseLesson | null {
	need(isObj(v) && isStr(v.id) && isStr(v.kind));
	switch (v.kind) {
		case 'words':
			need(isStrs(v.words));
			return { id: v.id, kind: 'words', words: [...v.words] };
		case 'script':
			need(isStrs(v.characters) && isStrs(v.scripts));
			return { id: v.id, kind: 'script', characters: [...v.characters], scripts: [...v.scripts] };
		case 'grammar':
			need(isStr(v.point) && typeof v.available === 'boolean');
			return { id: v.id, kind: 'grammar', point: v.point, available: v.available };
		case 'practice':
		case 'listening':
		case 'speaking':
		case 'reading':
			return { id: v.id, kind: v.kind };
	}
	return null;
}

function decodeText(v: unknown): CourseText | null {
	if (v === null) return null;
	need(isObj(v) && isStr(v.title) && isStr(v.body) && (v.translation === undefined || isTitle(v.translation)));
	const t: CourseText = { title: v.title, body: v.body };
	if (v.translation !== undefined) t.translation = { ...(v.translation as CourseTitle) };
	return t;
}

function decodeUnit(v: unknown): CourseUnit {
	need(isObj(v) && isStr(v.id) && isTitle(v.title) && isStrs(v.topics) && isStrs(v.grammar) && isStrs(v.characters) && isStrs(v.scripts));
	need(v.focus === null || v.focus === 'listening' || v.focus === 'speaking');
	need(typeof v.test === 'boolean' && Array.isArray(v.words) && Array.isArray(v.lessons));
	const lessons: CourseLesson[] = [];
	for (const l of v.lessons) {
		const lesson = decodeLesson(l);
		if (lesson !== null) lessons.push(lesson);
	}
	return {
		id: v.id,
		title: { ...v.title },
		topics: [...v.topics],
		grammar: [...v.grammar],
		characters: [...v.characters],
		scripts: [...v.scripts],
		text: decodeText(v.text),
		focus: v.focus as CourseUnit['focus'],
		test: v.test,
		words: v.words.map(decodeWord),
		lessons
	};
}

function decodeSection(v: unknown): CourseSection {
	need(isObj(v) && isStr(v.id) && (v.level === null || isInt(v.level)) && (v.levelName === null || isStr(v.levelName)));
	need(isTitle(v.title) && typeof v.exam === 'boolean' && Array.isArray(v.units));
	return { id: v.id, level: v.level as number | null, levelName: v.levelName as string | null, title: { ...v.title }, exam: v.exam, units: v.units.map(decodeUnit) };
}

function decodeCheckpoint(v: unknown, marked: boolean): Checkpoint {
	need(isObj(v) && isInt(v.questions) && (marked ? isInt(v.passPercent) : v.passPercent === undefined));
	return marked ? { questions: v.questions, passPercent: v.passPercent as number } : { questions: v.questions };
}

/** decodeCourse reads GET /api/courses/{id}; null when the body is not a filled course. */
export function decodeCourse(body: unknown): Course | null {
	try {
		const b = body;
		need(isObj(b));
		for (const k of ['id', 'name', 'version', 'license', 'attribution', 'notice', 'fill', 'language'] as const) need(isStr(b[k]));
		need(isTitle(b.title) && isObj(b.source) && isObj(b.checkpoints) && isObj(b.counts) && Array.isArray(b.sections) && Array.isArray(b.unplaced));
		const src = b.source;
		need((src.kind === 'levels' || src.kind === 'frequency' || src.kind === 'none') && (src.pack === null || isStr(src.pack)));
		const cp = b.checkpoints;
		const counts = b.counts;
		for (const k of ['candidates', 'placed', 'byTopic', 'unplaced'] as const) need(isInt(counts[k]));
		const unplaced = b.unplaced.map((u) => {
			need(isObj(u) && isStr(u.key) && isStr(u.form) && isStr(u.reading) && isInt(u.level) && isStr(u.reason));
			return { key: u.key, form: u.form, reading: u.reading, level: u.level, reason: u.reason };
		});
		return {
			id: b.id as string,
			name: b.name as string,
			version: b.version as string,
			license: b.license as string,
			attribution: b.attribution as string,
			notice: b.notice as string,
			fill: b.fill as string,
			language: b.language as string,
			title: { ...b.title },
			source: { kind: src.kind, pack: src.pack as string | null },
			checkpoints: {
				lesson: decodeCheckpoint(cp.lesson, false),
				unit: decodeCheckpoint(cp.unit, true) as Checkpoint & { passPercent: number },
				section: decodeCheckpoint(cp.section, true) as Checkpoint & { passPercent: number }
			},
			sections: b.sections.map(decodeSection),
			unplaced,
			counts: { candidates: counts.candidates as number, placed: counts.placed as number, byTopic: counts.byTopic as number, unplaced: counts.unplaced as number }
		};
	} catch (e) {
		if (e instanceof Malformed) return null;
		throw e;
	}
}

/** decodeCourseList reads GET /api/courses, skipping a malformed entry. */
export function decodeCourseList(body: unknown): CourseInfo[] {
	if (!isObj(body) || !Array.isArray(body.courses)) return [];
	const out: CourseInfo[] = [];
	for (const c of body.courses) {
		if (!isObj(c) || !isTitle(c.title)) continue;
		const { id, name, version, language, license, attribution, notice } = c;
		if (![id, name, version, language, license, attribution, notice].every(isStr)) continue;
		out.push({ id, name, version, language, license, attribution, notice, title: { ...c.title } } as CourseInfo);
	}
	return out;
}

/** courses lists the installed courses, of one language when given. */
export async function courses(language?: string): Promise<CourseInfo[]> {
	const q = language ? `?${new URLSearchParams({ language })}` : '';
	return decodeCourseList(await api<unknown>(`/api/courses${q}`));
}

/** course loads one filled course; null when the server sent something that is not one. */
export async function course(id: string): Promise<Course | null> {
	return decodeCourse(await api<unknown>(`/api/courses/${encodeURIComponent(id)}`));
}
