// Structural mirrors of the JSON the Go API serves. Only the fields the
// web client reads are declared; later pages extend these as needed.

export interface Reading {
	type: string;
	value: string;
	plain: string;
	ord: number;
}

export interface Badge {
	schemeId: number;
	schemeName: string;
	levelName: string;
	derived: boolean;
}

export interface SenseView {
	dictionaryId: number;
	dictionaryName: string;
	packId: string;
	license: string;
	attribution: string;
	gloss: string;
}

export interface Sentence {
	id: number;
	entryId: number;
	sourcePack: string;
	userId: number | null;
	hanzi: string;
	pinyin: string;
	translation: string;
}

// EntryBase is an entry as it appears nested inside another entry's
// variants: the shared row without the detail sections.
export interface EntryBase {
	id: number;
	language: string;
	kind: string;
	written: string;
	readings: Reading[];
	attrs: Record<string, string>;
	radicalId: number | null;
}

// SearchHit is one result of GET /api/search: the entry plus the source
// of the match — "written", "gloss", or the type of the matching reading
// ("pinyin", "bopomofo", "kana", …).
export interface SearchHit extends EntryBase {
	source: string;
}

// Entry is GET /api/entries/{id}: the shared row plus the caller's
// senses, scheme badges, variants, and example sentences.
export interface Entry extends EntryBase {
	badges: Badge[];
	variants: EntryBase[];
	sentences: Sentence[];
	senses: SenseView[];
}

// EntryDetail is the full entry view returned by GET and PUT
// /api/entries/{id}: the entry plus the sections above.
export type EntryDetail = Entry;

// Level is one rung of a scheme's ladder, ordered by ord. GET /api/schemes
// serves only the fields the web client reads.
export interface Level {
	id: number;
	ord: number;
	name: string;
}

// Scheme is GET /api/schemes: an installed levels pack (HSK, JLPT, …) and
// its ordered levels.
export interface Scheme {
	id: number;
	name: string;
	unit: string;
	language: string;
	levels: Level[];
}

// Dictionary is one element of GET /api/dictionaries: an installed
// dictionary pack's credit line. The list endpoint does not expose the
// pack id or timestamps.
export interface Dictionary {
	id: number;
	name: string;
	version: string;
	license: string;
	attribution: string;
}

export interface Workspace {
	id: number;
	language: string;
	settings: Record<string, unknown>;
	updatedAt: string;
}

// PluginInfo is one element of GET /api/plugins: the plugin manifest
// (feature plugins verbatim, pack plugins synthesized) plus the
// caller's home state.
export interface PluginInfo {
	id: string;
	manifest: { name?: unknown; [key: string]: unknown };
	enabled: boolean;
	order: number;
}

// StudyEventBody is one event in POST /api/events/batch. The server
// overwrites userId with the token's user and keeps ts verbatim.
export interface StudyEventBody {
	id: string;
	workspaceId: number;
	device: string;
	ts: string;
	type: string;
	payload: unknown;
}

// LookupResult is one entry of GET /api/lookup. start/end are code-point
// offsets of `matched` in the text the caller passed to lookupAt.
export interface LookupResult {
	entryId: number;
	kind: 'word' | 'character';
	term: string;
	reading: string;
	forms: { text: string; flags?: string[] }[];
	readings: { type: string; value: string; plain: string }[];
	matched: string;
	start: number;
	end: number;
	reasons: string[];
	tags: string[];
	frequencies: { packId: number; packName: string; rank: number; display?: string }[];
	senses: {
		dictionaryId: number;
		dictionaryName: string;
		pos: string[];
		tags: string[];
		glosses: string[];
		xrefs: string[];
	}[];
	pri: number;
}

// SegmentMatch is one dictionary match from /api/segment[/at]; start and
// end are code-point offsets into the segmented text.
export interface SegmentMatch {
	surface: string;
	start: number;
	end: number;
	lemma: string;
	reason: string;
	entries: SegmentCandidate[];
}

// SegmentCandidate is one entry a match resolves to; reading is true when
// it matched by a kana reading rather than its written form (Japanese).
export interface SegmentCandidate {
	id: number;
	kind: 'character' | 'word';
	reading?: boolean;
}

// Book is one library book as served by /api/library/books.
export interface Book {
	id: number;
	language: string;
	title: string;
	author: string;
	source: string;
	sourceId: string;
	sourceUrl: string;
	attribution: string;
	licenseNote: string;
	chapterCount: number;
	position: string;
	createdAt: string;
}

export interface Chapter {
	title: string;
	paragraphs: { text: string; ruby?: string }[][];
}

export interface SourceInfo {
	id: string;
	name: string;
	languages: string[];
}

export interface SourceResult {
	sourceId: string;
	title: string;
	author: string;
	language: string;
	note: string;
}
