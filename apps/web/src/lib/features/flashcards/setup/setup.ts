// The saved study setup (docs/contracts/study/setup.json): the workspace keyed
// row `study-setup`, what the study modal's Start studies. Pure: read member by
// member, repaired member by member, written over the stored row so unknown
// members survive. The running session's own copy (seed, Study all, the page
// it was started from) stays in the tab (session.ts).

import { profileOf } from '$lib/languages/profiles';
import type { Scheme } from '$lib/api/types';
import { parseNewOrder, type SessionNewOrder } from '$lib/studycore/newOrder';
import type { StudySessionConfig, StudySessionMode } from '../session/session';
import type { TypeOrder } from '../session/sessionMix';
import { CARD_KINDS, GENERAL_DECK_ID, OPT_IN_KINDS, type OptInKind, type StudyCardKind } from '$lib/studycore/types';

export const STUDY_SETUP_KEY = 'study-setup';

export interface StudySetup {
	version: number;
	/** "all" stays live (a deck created later joins), or the chosen deck ids. */
	decks: 'all' | string[];
	mode: StudySessionMode;
	schemeId: number | null;
	levelName: string | null;
	/** The chosen kinds that are not opt-in (CARD_KINDS order). */
	cardTypes: StudyCardKind[];
	/** Opt-in kinds the learner switched off; the others follow the decks. */
	unchecked: OptInKind[];
	newLimit: number;
	reviewLimit: number;
	newOrder: SessionNewOrder;
	typeOrder: TypeOrder;
}

/** Why a read setup was repaired (the modal says so in one line). */
export type SetupNote = 'levelGone' | 'decksGone' | 'typesGone';

const MAX_LIMIT = 999;
const DEFAULT_KINDS: readonly StudyCardKind[] = ['vocab'];

export function defaultSetup(): StudySetup {
	return {
		version: 1,
		decks: 'all',
		mode: 'decks',
		schemeId: null,
		levelName: null,
		cardTypes: [...DEFAULT_KINDS],
		unchecked: [],
		newLimit: 20,
		reviewLimit: 100,
		newOrder: 'random',
		typeOrder: 'mixed'
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptIn(kind: unknown): kind is OptInKind {
	return (OPT_IN_KINDS as readonly unknown[]).includes(kind);
}

function limit(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : fallback;
}

function validVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parseDecks(value: unknown): StudySetup['decks'] {
	if (!Array.isArray(value)) return 'all';
	const ids = [...new Set(value.filter((id): id is string => typeof id === 'string' && id !== ''))];
	return ids.length > 0 ? ids : 'all';
}

function parseKinds(value: unknown): StudyCardKind[] {
	if (!Array.isArray(value)) return [...DEFAULT_KINDS];
	const known = value.filter((kind) => (CARD_KINDS as readonly unknown[]).includes(kind));
	// A list with only opt-in kinds is an empty list; one with no known kind at all is the default.
	if (value.length > 0 && known.length === 0) return [...DEFAULT_KINDS];
	return CARD_KINDS.filter((kind) => !isOptIn(kind) && known.includes(kind));
}

function parseOrder(value: unknown): SessionNewOrder {
	if (value === 'deck' || value === 'random') return value;
	return parseNewOrder(value) ?? 'random';
}

/** parseSetup reads a stored row (null: none) member by member; never throws a row away. */
export function parseSetup(raw: unknown): StudySetup {
	const row = isRecord(raw) ? raw : {};
	const defaults = defaultSetup();
	return {
		version: validVersion(row.version) ? row.version : 1,
		decks: parseDecks(row.decks),
		mode: row.mode === 'levels' ? 'levels' : 'decks',
		schemeId: typeof row.schemeId === 'number' && Number.isInteger(row.schemeId) && row.schemeId > 0 ? row.schemeId : null,
		levelName: typeof row.levelName === 'string' && row.levelName.trim() !== '' ? row.levelName : null,
		cardTypes: parseKinds(row.cardTypes),
		unchecked: Array.isArray(row.unchecked) ? OPT_IN_KINDS.filter((kind) => (row.unchecked as unknown[]).includes(kind)) : [],
		newLimit: limit(row.newLimit, defaults.newLimit),
		reviewLimit: limit(row.reviewLimit, defaults.reviewLimit),
		newOrder: parseOrder(row.newOrder),
		typeOrder: row.typeOrder === 'grouped' ? 'grouped' : 'mixed'
	};
}

/** withSetup is the row to write: the stored object with the setup's members replaced (unknown members and a stored version kept). */
export function withSetup(stored: unknown, next: StudySetup): Record<string, unknown> {
	const base = isRecord(stored) ? stored : {};
	const { version: _version, ...members } = next;
	return { ...base, ...members, version: validVersion(base.version) ? base.version : 1 };
}

export interface RepairContext {
	/** The workspace's deck ids (General need not be listed); null: not known yet. */
	deckIds: readonly string[] | null;
	/** The installed schemes; null: not known yet. */
	schemes: readonly (Pick<Scheme, 'id' | 'language'> & { levels: readonly { name: string }[] })[] | null;
	/** The workspace language. */
	language: string;
}

/** repairSetup fixes each member that no longer fits on its own (4.4b) and names what it changed. */
export function repairSetup(setup: StudySetup, ctx: RepairContext): { setup: StudySetup; notes: SetupNote[] } {
	const notes: SetupNote[] = [];
	let next = setup;
	if (next.mode === 'levels') {
		const unusable = next.schemeId === null || next.levelName === null;
		const scheme = ctx.schemes?.find((s) => s.id === next.schemeId && s.language === ctx.language);
		const gone = ctx.schemes !== null && (scheme === undefined || !scheme.levels.some((l) => l.name === next.levelName));
		if (unusable || gone) {
			next = { ...next, mode: 'decks' };
			notes.push('levelGone');
		}
	}
	if (next.decks !== 'all' && ctx.deckIds !== null) {
		const known = new Set([GENERAL_DECK_ID, ...ctx.deckIds]);
		if (!next.decks.some((id) => known.has(id))) {
			next = { ...next, decks: 'all' };
			notes.push('decksGone');
		}
	}
	const offered = profileOf(ctx.language).cardKinds;
	const kept = next.cardTypes.filter((kind) => offered.includes(kind));
	if (kept.length !== next.cardTypes.length) {
		if (kept.length === 0) {
			next = { ...next, cardTypes: [...DEFAULT_KINDS] };
			notes.push('typesGone');
		} else {
			next = { ...next, cardTypes: kept };
		}
	}
	return { setup: next, notes };
}

/** setupDeckIds: the decks a session over the setup draws from ("all" = General and every deck). */
export function setupDeckIds(setup: StudySetup, decks: readonly { id: string }[]): string[] {
	const all = [GENERAL_DECK_ID, ...decks.map((deck) => deck.id).filter((id) => id !== GENERAL_DECK_ID)];
	if (setup.decks === 'all') return all;
	const known = new Set(all);
	const kept = setup.decks.filter((id) => known.has(id));
	return kept.length > 0 ? kept : all;
}

/**
 * setupKinds: the kinds a session over the setup studies — its chosen kinds the
 * language offers, plus each opt-in kind a deck in scope switches on (`enabled`)
 * that the learner has not unchecked.
 */
export function setupKinds(setup: StudySetup, enabled: ReadonlySet<OptInKind>, language: string): StudyCardKind[] {
	const offered = profileOf(language).cardKinds;
	return CARD_KINDS.filter(
		(kind) =>
			offered.includes(kind) &&
			(isOptIn(kind) ? enabled.has(kind) && !setup.unchecked.includes(kind) : setup.cardTypes.includes(kind))
	);
}

/** setupSessionConfig: the tab's running session started from the setup (session.ts). */
export function setupSessionConfig(
	setup: StudySetup,
	deckIds: readonly string[],
	kinds: readonly StudyCardKind[],
	opts: { studyAll?: boolean; seed: number; from: string }
): StudySessionConfig {
	return {
		...(opts.studyAll ? { studyAll: true } : {}),
		mode: setup.mode,
		schemeId: setup.schemeId,
		levelName: setup.levelName,
		deckIds: [...deckIds],
		newLimit: setup.newLimit,
		reviewLimit: setup.reviewLimit,
		cardTypes: [...kinds],
		newOrder: setup.newOrder,
		typeOrder: setup.typeOrder,
		seed: opts.seed,
		from: opts.from
	};
}
