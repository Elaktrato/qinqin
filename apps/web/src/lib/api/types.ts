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
export interface SearchGloss {
	dictionaryId: number;
	gloss: string;
}

export interface SearchLevel {
	scheme: string;
	level: string;
}

export interface SearchHit extends EntryBase {
	source: string;
	glosses?: SearchGloss[];
	levels?: SearchLevel[];
}

// EntryCharacter is one Han character of a word entry (#104).
export interface EntryCharacter {
	id: number;
	written: string;
	reading: { type: string; value: string } | null;
	gloss: string;
	radical: { id: number; written: string } | null;
	strokes: number;
	levels: SearchLevel[];
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
	characters?: EntryCharacter[];
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
	/** The manifest id of the pack (`hsk-mini`, …); the server always sends it. */
	packId?: string;
	/** The pack's manifest version, licence and credits (Sources page). */
	version?: string;
	license?: string;
	attribution?: string;
	/** The pack's notice mini-markup (lib/sources/notice.ts); '' when none. */
	notice?: string;
	levels: Level[];
}

// CharRow is one character of GET /api/characters in its compact form.
// Every field but the id and glyph is omitted when absent.
export interface CharRow {
	/** Entry id. */
	i: number;
	/** The written glyph (simplified for zh). */
	c: string;
	/** Stroke count. */
	s?: number;
	/** ja: KANJIDIC2 grade (1–6, 8, 9, 10). */
	g?: number;
	/** ja: KANJIDIC2 newspaper frequency rank. */
	f?: number;
	/** zh: 1 when the character is in the 通用规范汉字表. */
	t?: number;
	/** zh: GB2312 level (1 or 2). */
	b?: number;
	/** zh: Hong Kong primary grade (1–6). */
	h?: number;
	/** First reading. */
	r?: string;
	/** First gloss. */
	m?: string;
	/** Variant forms (zh traditional/simplified partners) sharing the cell. */
	v?: string[];
	/** Kangxi number (1–214) of the character's radical (docs/contracts/radicals). */
	k?: number;
}

// CharactersResponse is GET /api/characters?language=.
export interface CharactersResponse {
	language: string;
	count: number;
	chars: CharRow[];
	/** True when the database predates the new importer fields (re-seed needed). */
	stale?: boolean;
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
	/** The pack's notice mini-markup (lib/sources/notice.ts); '' when none. */
	notice?: string;
	/** The pack id the dictionary was installed from. */
	packId: string;
	/** The language the dictionary covers ('' for rows from before pack management). */
	language: string;
}

// ComponentPart is one part of GET /api/components: its glyph, its stroke
// count (0 = unknown) and how many characters contain it.
export interface ComponentPart {
	c: string;
	s: number;
	n: number;
}

// ComponentsResponse is GET /api/components?language= (docs/contracts/radicals).
export interface ComponentsResponse {
	language: string;
	/** the packs the index is built from, by pack id */
	packs: { id: string; license: string; attribution: string }[];
	parts: ComponentPart[];
	/** glyph -> the parts it contains */
	chars: Record<string, string[]>;
}

// StrokePack is one element of GET /api/stroke-packs: an installed strokes
// pack's credit line (a strokes pack has languages, sorted, not one language).
export interface StrokePack {
	packId: string;
	name: string;
	version: string;
	languages: string[];
	license: string;
	attribution: string;
	notice: string;
}

// ComponentPack is one element of GET /api/component-packs: an installed
// character components pack's credit line.
export interface ComponentPack {
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	/** The pack's notice mini-markup (lib/sources/notice.ts); '' when none. */
	notice?: string;
}

// LemmaPack is one element of GET /api/lemma-packs: an installed
// lemmatizer rule-table pack's credit line (#176).
export interface LemmaPack {
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	/** The pack's notice mini-markup (lib/sources/notice.ts); '' when none. */
	notice?: string;
}

// FrequencyPack is one element of GET /api/frequency-packs: an installed
// word-frequency pack's credit line, in priority order.
export interface FrequencyPack {
	id: number;
	/** The manifest id (e.g. `jiten-frequency`); stable across servers. */
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	/** The pack's notice mini-markup (lib/sources/notice.ts); '' when none. */
	notice?: string;
}

export interface Workspace {
	id: number;
	language: string;
	/** Optional display name; '' for the first workspace of a language. */
	name: string;
	settings: Record<string, unknown>;
	updatedAt: string;
}

// Language is one element of GET /api/languages: a known language,
// with `installed` telling whether it has dictionary data. `name` may be a pack title (for example a
// demo dictionary's name), so the UI labels languages from the code via
// languageLabel instead of showing it.
export interface Language {
	code: string;
	name: string;
	installed: boolean;
	/** 'code' for a built-in code pack (zh, ja), 'data' for a data-only language. */
	kind: 'code' | 'data';
}

// PluginInfo is one element of GET /api/plugins: the plugin manifest
// (feature plugins verbatim, pack plugins synthesized) plus the
// caller's home state.
export interface PluginInfo {
	id: string;
	manifest: { name?: unknown; [key: string]: unknown };
	enabled: boolean;
	order: number;
	/** True for the app's own surface-less built-ins (qinqin-core): not listed in Settings. */
	hidden?: boolean;
}

// StudyEventBody is one event in POST /api/events/batch. The server
// overwrites userId with the token's user and stores ts as UTC whole
// seconds (fraction truncated; docs/contracts/events/).
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
	readings: { type: string; value: string; plain: string; flags?: string[] }[];
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
	/** The entry's lowest level in each installed levels scheme, scheme order. */
	levels: { scheme: string; level: string }[];
}

// SegmentMatch is one dictionary match from /api/segment[/at]; start and
// end are code-point offsets into the segmented text.
export interface SegmentMatch {
	surface: string;
	start: number;
	end: number;
	lemma: string;
	/** Set when the first entry matched a compound's stem (勉強 for 勉強しています): furigana aligns against it. */
	stem?: string;
	reason: string;
	entries: SegmentCandidate[];
	/** Only with `readings: true`: the best candidate's reading, the caller's overlay applied. */
	reading?: { type: string; value: string };
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
// paragraph. `text` is exactly that span (no edge whitespace, end - start
// code points, at most 500), used to notice when the text changed; `note`
// is optional (at most 2000 code points). Only colour and note can change.
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
