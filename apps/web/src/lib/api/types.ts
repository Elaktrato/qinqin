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

// SenseGroup is one sense of an entry as one dictionary gives it, with
// its part of speech, tags and cross-references.
export interface SenseGroup {
	dictionaryId: number;
	dictionaryName: string;
	packId: string;
	license: string;
	attribution: string;
	pos: string[];
	tags: string[];
	glosses: string[];
	xrefs: string[];
}

// Entry is GET /api/entries/{id}: the shared row plus the caller's
// senses, scheme badges, variants, and example sentences. senses is one
// row per gloss; senseGroups one row per sense; forms the written forms
// (flags such as rK or trad).
export interface Entry extends EntryBase {
	badges: Badge[];
	variants: EntryBase[];
	sentences: Sentence[];
	senses: SenseView[];
	forms?: { text: string; flags: string[]; pri?: number }[];
	senseGroups?: SenseGroup[];
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

// FrequencyPack is one element of GET /api/frequency-packs: an installed
// word-frequency pack's credit line, in priority order.
export interface FrequencyPack {
	id: number;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
}

export interface Workspace {
	id: number;
	language: string;
	/** Optional display name; '' for the first workspace of a language. */
	name: string;
	settings: Record<string, unknown>;
	updatedAt: string;
}

// Language is one element of GET /api/languages: a language with
// installed dictionary data. `name` may be a pack title (for example a
// demo dictionary's name), so the UI labels languages from the code via
// languageLabel instead of showing it.
export interface Language {
	code: string;
	name: string;
	installed: boolean;
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
	/** The workspace whose library holds the book. */
	workspaceId: number;
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

// Bookmark is one bookmark of a library book. `position` uses the reading
// position format ("<chapter>:<paragraph>"); `label` is at most 120 code
// points (the server cleans whitespace and control characters).
export interface Bookmark {
	id: number;
	bookId: number;
	position: string;
	label: string;
	createdAt: string;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

// Highlight is one highlighted span of a library book: code points
// [start,end) of the displayed plain text (ruby excluded) of one
// paragraph. `text` is the server's snapshot of that span (trimmed, at
// most 500 code points), used to notice when the text changed; `note` is
// optional (at most 2000 code points). Only colour and note can change.
export interface Highlight {
	id: number;
	bookId: number;
	chapter: number;
	paragraph: number;
	start: number;
	end: number;
	text: string;
	color: HighlightColor;
	note: string;
	createdAt: string;
	updatedAt: string;
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
	/** The phonetic reading that matched the query (hiragana for ja, toneless pinyin for zh). */
	reading?: string;
}
