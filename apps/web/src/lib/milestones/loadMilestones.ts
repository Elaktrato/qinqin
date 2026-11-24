// The only I/O of the milestones: the cached study history and event log of
// one workspace, the feature switches, the vacation runs, the pending list
// and, on Stats → Week, the installed levels. Home computes the log families
// only (no replay); the Week tab passes the timelines and the character
// universe it already loaded. Rule: docs/contracts/milestones/.

import { onSessionEnd, sessionEpoch } from '../session/sessionEnd';
import { get } from 'svelte/store';
import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { CharRow } from '$lib/api/types';
import { loadWorkspaceEvents } from '$lib/events';
import { FLASHCARDS_ID, READER_ID, featureEnabled } from '$lib/features';
import { levelDecks, levelItems, ownedLevelDeckId } from '$lib/features/flashcards/decks/systemDecks';
import { usesHan } from '$lib/languages';
import { pluginEnabled } from '$lib/plugins';
import { pluginStates } from '$lib/plugins/states';
import { buildSections } from '$lib/study/charGroups';
import { loadStudyHistory } from '$lib/study/history';
import { outboxUser } from '$lib/study/outboxUser';
import { saveSeenMilestones } from '$lib/study/store';
import { GENERAL_DECK_ID } from '$lib/study/types';
import type { StudyCard } from '$lib/study/types';
import { vacationRuns } from '$lib/study/vacation';
import { currentStudyDay } from '$lib/time/zone';
import type { Timelines } from '$lib/weekly/replay';
import { MILESTONE_KEY_PREFIX, enabledFamilies, logFamilies } from './catalogue';
import { milestoneTitle } from './milestoneText';
import { milestoneCard, milestoneHistory, unseenReached, type CardPlan, type HistoryItem } from './plan';
import { reachedFromLog, type Reached } from './reached';
import { reachedFromReplay, type LevelInput } from './replayReached';
import {
	addPending,
	dropPending,
	prunePending,
	readPending,
	seenIds,
	seenWritePlan,
	type SeenMilestone
} from './seen';

export const JOURNAL_PLUGIN_ID = 'qinqin-journal';

export interface MilestonesView {
	/** The workspace this view was loaded for: a dismiss writes there, never into another one. */
	workspaceId: number;
	plan: CardPlan;
	history: HistoryItem[];
	/** Titles of every id in the plan and the history. */
	titles: Map<string, string>;
	/** The reached milestones the plan was made from (markSeen writes their days). */
	reached: Reached[];
	/** The live seen rows the plan was made against. */
	live: ReadonlyMap<string, SeenMilestone>;
	/** Tombstoned seen rows: id → newest stamp (a re-dismiss is stamped after it). */
	tombstones?: ReadonlyMap<string, string>;
}

export interface WeekInputs {
	/** The Week tab's timelines (loadWeek), so the sweep replays nothing new. */
	timelines: Timelines;
	/** The language's character universe (loadWeekCharacters), null when not loaded. */
	chars: readonly CharRow[] | null;
	/** The cards the universe was scored with (written forms resolved); default: the history's. */
	cards?: readonly StudyCard[];
}

/** A pending flush is tried at most this often (a failed push notifies, and the page reloads). */
const FLUSH_EVERY_MS = 30_000;
const lastFlush = new Map<string, number>();
/** The last load's user, workspace and live rows: an `online` flush never rewrites a live row. */
let lastPlace: {
	user: number;
	workspaceId: number;
	live: ReadonlyMap<string, SeenMilestone>;
	tombstones: ReadonlyMap<string, string>;
} | null = null;
let onlineHooked = false;
onSessionEnd(() => resetMilestonesForTests());

/** Test hook: forget the flush throttle and the last place. */
export function resetMilestonesForTests(): void {
	lastFlush.clear();
	lastPlace = null;
}

function hookOnline(): void {
	if (onlineHooked || typeof window === 'undefined') return;
	onlineHooked = true;
	window.addEventListener('online', () => void flushOnOnline());
}

/** flushOnOnline: back online, push the pending ids that were not live at the last load. */
export async function flushOnOnline(): Promise<void> {
	lastFlush.clear();
	if (lastPlace === null) return;
	await flushPending(lastPlace.user, lastPlace.workspaceId, lastPlace.live, lastPlace.tombstones, Date.now());
}

function rowOf(m: SeenMilestone, now: number, tombstones: ReadonlyMap<string, string>): { key: string; data: unknown; knownAt?: string } {
	const knownAt = tombstones.get(m.id);
	return {
		...(knownAt === undefined ? {} : { knownAt }),
		key: `${MILESTONE_KEY_PREFIX}${m.id}`,
		data: {
			version: 1,
			id: m.id,
			seenAt: m.seenAt ?? new Date(now).toISOString(),
			...(m.reachedDay === null ? {} : { reachedDay: m.reachedDay })
		}
	};
}

/** flushPending pushes the pending ids that are not live; a failure keeps them. */
async function flushPending(
	user: number,
	workspaceId: number,
	live: ReadonlyMap<string, SeenMilestone>,
	tombstones: ReadonlyMap<string, string>,
	now: number
): Promise<void> {
	const key = `${user}:${workspaceId}`;
	const last = lastFlush.get(key);
	if (last !== undefined && now - last < FLUSH_EVERY_MS) return;
	const pending = readPending(user, workspaceId).filter((m) => !live.has(m.id));
	if (pending.length === 0) return;
	lastFlush.set(key, now);
	try {
		const result = await saveSeenMilestones(
			workspaceId,
			pending.map((m) => rowOf(m, now, tombstones))
		);
		// 'pending': a row was skipped or refused; it stays pending until live in a pull.
		if (result === 'done') dropPending(user, workspaceId, pending.map((m) => m.id));
	} catch {
		// Offline or refused as a whole: the ids stay pending (still seen here).
	}
}

/** The levels of the language's installed schemes with their members; [] when they cannot be read. */
async function loadLevels(
	language: string,
	chars: readonly CharRow[] | null
): Promise<{ levels: LevelInput[]; names: Map<string, string> }> {
	const levels: LevelInput[] = [];
	const names = new Map<string, string>();
	let decks;
	try {
		decks = levelDecks(await getSchemes(), language);
	} catch {
		return { levels, names };
	}
	const membersOf = new Map<number, Awaited<ReturnType<typeof fetchSchemeCharacters>>>();
	for (const deck of decks) {
		try {
			if (deck.unit === 'character') {
				if (chars === null) continue;
				let members = membersOf.get(deck.schemeId);
				if (members === undefined) {
					members = await fetchSchemeCharacters(deck.schemeId);
					membersOf.set(deck.schemeId, members);
				}
				const level = members.find((m) => m.name === deck.level);
				if (level === undefined) continue;
				const section = buildSections(chars, 'scheme:0', members).find((s) => s.id === `level-${level.levelId}`);
				const cells = (section?.chars ?? []).map((row) => [row.c, ...(row.v ?? [])]);
				levels.push({ packId: deck.packId, level: deck.level, unit: 'character', entryIds: [], cells });
			} else {
				const entries = levelItems(deck, await getSchemeEntries(deck.schemeId, deck.level));
				levels.push({ packId: deck.packId, level: deck.level, unit: 'word', entryIds: entries.map((e) => e.id) });
			}
			names.set(ownedLevelDeckId(deck.packId, deck.level), `${deck.schemeName} · ${deck.level}`);
		} catch {
			// One level that cannot be read is left out; the others count.
		}
	}
	return { levels, names };
}

/**
 * loadMilestones: the card plan, the history and the titles of one
 * workspace. `scope: 'home'` computes the log families only; 'week' adds
 * the replay families from `week` and the installed levels. Before the
 * plugin states are loaded nothing is computed: no card, seen rows only.
 * Callers guard against a stale answer (workspace switch) themselves.
 */
export async function loadMilestones(
	workspaceId: number,
	opts: { scope: 'home' | 'week'; language: string; now?: number; week?: WeekInputs }
): Promise<MilestonesView> {
	hookOnline();
	const now = opts.now ?? Date.now();
	const day = currentStudyDay();
	const today = day.today(now);
	const epoch = sessionEpoch();
	const [data, log] = await Promise.all([loadStudyHistory(workspaceId), loadWorkspaceEvents(workspaceId)]);
	const live = data.seenMilestones ?? new Map<string, SeenMilestone>();
	const tombstones = data.milestoneTombstones ?? new Map<string, string>();

	const user = outboxUser();
	// A load for a session that has ended leaves no place to flush into (#173).
	if (user !== null && epoch === sessionEpoch()) {
		lastPlace = { user, workspaceId, live, tombstones };
		prunePending(user, workspaceId, live);
		await flushPending(user, workspaceId, live, tombstones, now);
	}
	const pending = user === null ? [] : readPending(user, workspaceId);

	const states = get(pluginStates);
	let reached: Reached[] = [];
	let names = new Map<string, string>();
	if (states.status === 'ready') {
		const all = enabledFamilies({
			flashcards: featureEnabled(FLASHCARDS_ID, states.list),
			reader: featureEnabled(READER_ID, states.list),
			journal: pluginEnabled(JOURNAL_PLUGIN_ID, states.list),
			han: usesHan(opts.language)
		});
		const families = opts.scope === 'home' || opts.week === undefined ? logFamilies(all) : all;
		const deckIds = new Set([GENERAL_DECK_ID, ...data.decks.map((d) => d.id)]);
		const vacation = vacationRuns(data.vacations ?? [], workspaceId, today);
		// The log as loaded (filtered inside, keyed by content): a reload is a memo hit.
		reached = reachedFromLog({ reviews: data.reviews, events: log, workspaceId, cards: data.cards, deckIds, day, vacation, now, families });
		if (opts.scope === 'week' && opts.week !== undefined && families.has('words-mature')) {
			const chars = families.has('characters-learned') ? opts.week.chars : null;
			const loaded = families.has('level-complete') ? await loadLevels(opts.language, opts.week.chars) : null;
			names = loaded?.names ?? names;
			const replayed = reachedFromReplay({
				cards: opts.week.cards ?? data.cards,
				deckIds,
				timelines: opts.week.timelines,
				day,
				now,
				families,
				chars,
				levels: loaded?.levels ?? []
			});
			reached = [...reached, ...replayed].sort((a, b) => a.at - b.at);
		}
	}

	const plan = states.status === 'ready' ? milestoneCard(unseenReached(reached, seenIds(live, pending)), today) : { kind: 'none' as const };
	const titles = new Map<string, string>();
	const title = (id: string): string | null => {
		const known = titles.get(id);
		if (known !== undefined) return known;
		const text = milestoneTitle(id, names);
		if (text !== null) titles.set(id, text);
		return text;
	};
	// A level no longer installed has no name: it stays seen, unlisted.
	const history = milestoneHistory(reached, live, pending, day).filter((item) => title(item.id) !== null);
	if (plan.kind !== 'none') for (const id of plan.ids) title(id);
	return { workspaceId, plan, history, titles, reached, live, tombstones };
}

/**
 * markSeen marks every milestone the card covered, in the view's own
 * workspace: the ids go into the
 * pending list first, then the rows of the ids without a live row are
 * pushed; on success they leave the pending list. Never throws.
 */
export async function markSeen(view: MilestonesView): Promise<void> {
	if (view.plan.kind === 'none') return;
	const { workspaceId } = view;
	const covered = new Set(view.plan.ids);
	const mark = view.reached.filter((r) => covered.has(r.id));
	const now = new Date();
	const user = outboxUser();
	const items = mark.map((r) => ({ id: r.id, seenAt: now.toISOString(), reachedDay: r.day }));
	if (user !== null) addPending(user, workspaceId, items);
	const rows = seenWritePlan(mark, view.live, now, view.tombstones);
	try {
		// 'pending': a row was skipped or refused; its id stays pending until live in a pull.
		if ((await saveSeenMilestones(workspaceId, rows)) === 'done' && user !== null) {
			dropPending(user, workspaceId, items.map((m) => m.id));
		}
	} catch {
		// Offline: the ids stay pending and the next load flushes them.
	}
}
