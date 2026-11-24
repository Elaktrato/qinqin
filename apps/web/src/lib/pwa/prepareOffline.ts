// Offline preparation: after a workspace's study data has loaded online, fetch
// what a session started today needs - through the same helpers the pages use,
// so the worker's partition holds exactly the URLs the offline page will ask
// for. The queue is computed by the real planner (daily limits, vacation,
// burying, the learner's day), not a copy of its rules.

import { entryPath } from '../api/entries';
import { deckSessionPlan, type DeckSessionOptions } from '../study/cardFlow';
import { writableChars } from '../study/writing';
import type { StudyContext } from '../study/studyContext';
import { type StudyCardKind, type StudyHistory } from '../study/types';
import { effectiveCardTypes, effectiveKinds, type ExtraChoices } from '../study/cardTypesMemory';
import { enabledKinds } from '../study/deckSettings';
import type { StudySessionConfig } from '../study/session';
import type { OfflineState } from './offlineState.svelte';

/** The API reads every page of the app shell needs, besides the study data. */
export const OFFLINE_API_PATHS: readonly string[] = [
	'/api/auth/me',
	'/api/workspaces',
	'/api/plugins',
	'/api/languages',
	'/api/me/time-zone'
];

export const PREPARE_THROTTLE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;
const EXTRA_NEW = 50;
/** At most this many more entries for an offline Study all session (spec Ruling, #175 review). */
const STUDY_ALL_EXTRA = 200;
const CONCURRENCY = 2;

export interface OfflinePlan {
	entryIds: number[];
	/** Single characters of writing cards (stroke data is fetched per character). */
	chars: string[];
}

type PlanInput = Omit<DeckSessionOptions, 'skip'>;

/**
 * planOffline: the real cards of the session a user would start now, plus the
 * next `extraNew` new cards. Both plans go through the daily limits, so what
 * is saved is what could be studied today. Then what a Study all session
 * would add (no limits), at most `studyAllExtra` more entries, due cards
 * first. Companion (virtual) items are not studied offline and are left out.
 * Never more than `maxEntries` in all.
 */
export function planOffline(
	input: PlanInput,
	opts: { extraNew?: number; maxEntries?: number; studyAllExtra?: number } = {}
): OfflinePlan {
	const extraNew = opts.extraNew ?? EXTRA_NEW;
	const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
	const studyAllExtra = opts.studyAllExtra ?? STUDY_ALL_EXTRA;
	const entryIds: number[] = [];
	const chars = new Set<string>();
	const seen = new Set<number>();
	const passes: { options: PlanInput; extra: number }[] = [
		{ options: input, extra: maxEntries },
		{ options: { ...input, newLimit: input.newLimit + extraNew }, extra: maxEntries },
		{ options: { ...input, studyAll: true }, extra: studyAllExtra }
	];
	for (const pass of passes) {
		const max = Math.min(maxEntries, entryIds.length + pass.extra);
		for (const item of deckSessionPlan(pass.options).queue) {
			if (item.virtual || seen.has(item.entryId) || entryIds.length >= max) continue;
			seen.add(item.entryId);
			entryIds.push(item.entryId);
			if (item.kind === 'writing') {
				for (const ch of writableChars(item.card?.written ?? item.written ?? '')) chars.add(ch);
			}
		}
	}
	return { entryIds, chars: [...chars] };
}

export function receiptKey(userId: number, workspaceId: number): string {
	return `qinqin.pwa.prepared.${userId}.${workspaceId}`;
}

/** The prefix of every receipt ("Clear offline data" removes them all). */
export const RECEIPT_PREFIX = 'qinqin.pwa.prepared.';

interface Receipt {
	at: number;
	cards: number;
	reviews: number;
	entries: number;
	/** Pages of the study round saved (pull v2); absent in receipts of older builds. */
	pages?: number;
	/** The cache partition (credential) the entries were saved in. */
	partition: string;
}

export interface PrepareDeps {
	userId: number;
	loadHistory: (workspaceId: number) => Promise<StudyHistory>;
	config: () => StudySessionConfig;
	/** This tab's own setup kinds, or null when the tab has none (absent: the config's). */
	tabTypes?: () => readonly string[] | null;
	/** The kinds last started in the workspace (cardTypesMemory), or null. */
	remembered?: () => StudyCardKind[] | null;
	/** The learner's opt-in checkbox choices in the workspace (cardTypesMemory). */
	choices?: () => ExtraChoices;
	language: string;
	contextFor: (data: StudyHistory, workspaceId: number, now: number) => StudyContext;
	weights: (data: StudyHistory) => readonly number[];
	fetchEntry: (id: number) => Promise<unknown>;
	fetchStroke: (char: string) => Promise<unknown>;
	fetchApi: (path: string) => Promise<unknown>;
	/** Pages of the study round `loadHistory` just read (each page is saved by the worker as it is read). */
	pullPages: (workspaceId: number) => number;
	storage: Storage | null;
	now: () => number;
	/** True when a worker controls the page, the device is online and data saver is off. */
	canPrepare: () => boolean;
	/** The signed-in credential's cache partition name; null when there is none. */
	partition: () => Promise<string | null>;
	/** True when the worker already holds this API path for the current partition. */
	isCached: (path: string) => Promise<boolean>;
	extraNew?: number;
	/** Entries prepared for an offline Study all session beyond the others (planOffline). */
	studyAllExtra?: number;
	onPrepared: (prepared: NonNullable<OfflineState['prepared']>) => void;
}

/**
 * readReceipt: what was last prepared for a workspace, as the Settings line
 * shows it. A receipt written for another credential partition (another login)
 * describes a cache that is not this session's: nothing is shown for it.
 */
export function readReceipt(
	storage: Storage | null,
	userId: number,
	workspaceId: number,
	partition: string | null
): NonNullable<OfflineState['prepared']> | null {
	const receipt = readReceiptAt(storage, receiptKey(userId, workspaceId));
	if (receipt === null || partition === null || receipt.partition !== partition) return null;
	return { workspaceId, cards: receipt.entries, at: new Date(receipt.at).toISOString() };
}

/** clearReceipts: every "prepared" receipt (wherever the partitions are deleted). */
export function clearReceipts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): void {
	if (storage === null) return;
	try {
		const doomed: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key !== null && key.startsWith(RECEIPT_PREFIX)) doomed.push(key);
		}
		for (const key of doomed) storage.removeItem(key);
	} catch {
		// Storage denied: the receipts are only validated against the partition anyway.
	}
}

function readReceiptAt(storage: Storage | null, key: string): Receipt | null {
	try {
		const raw = storage?.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Receipt>;
		return typeof parsed.at === 'number' && typeof parsed.cards === 'number' && typeof parsed.reviews === 'number' && typeof parsed.partition === 'string'
			? (parsed as Receipt)
			: null;
	} catch {
		return null;
	}
}

/** Runs `task` over `items` with at most CONCURRENCY in flight; the first error stops the rest and is thrown. */
async function pool<T>(items: readonly T[], task: (item: T) => Promise<unknown>): Promise<void> {
	let next = 0;
	let failure: unknown = null;
	const worker = async (): Promise<void> => {
		while (failure === null && next < items.length) {
			const item = items[next++];
			try {
				await task(item);
			} catch (err) {
				failure = err ?? new Error('failed');
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	if (failure !== null) throw failure;
}

export async function prepareOffline(
	workspaceId: number,
	d: PrepareDeps
): Promise<{ status: 'prepared' | 'skipped' | 'failed'; entries: number }> {
	if (!d.canPrepare()) return { status: 'skipped', entries: 0 };
	try {
		const partition = await d.partition();
		if (partition === null) return { status: 'skipped', entries: 0 };
		const key = receiptKey(d.userId, workspaceId);
		const receipt = readReceiptAt(d.storage, key);
		const now = d.now();
		// Fresh enough: do not even download the study history to find out.
		if (receipt !== null && receipt.partition === partition && now - receipt.at < PREPARE_THROTTLE_MS) {
			return { status: 'skipped', entries: receipt.entries };
		}
		const data = await d.loadHistory(workspaceId);
		const config = d.config();
		// A levels session cannot run offline (its entries come from the scheme
		// API); prepare the plain deck session instead.
		const deckIds = config.mode === 'decks' && config.deckIds.length > 0 ? config.deckIds : ['general'];
		// The kinds a session started now would study: the tab's setup (else the
		// kinds last started in the workspace, else vocab) plus each opt-in kind
		// a deck in scope switches on and the learner has not unchecked — the
		// rule of the Study page, the home widget and the deck start (effectiveKinds).
		const tabTypes = d.tabTypes ? d.tabTypes() : config.cardTypes;
		const kinds = effectiveKinds(
			effectiveCardTypes(tabTypes, d.remembered?.() ?? null),
			enabledKinds(data.deckSettings, deckIds),
			d.choices?.() ?? {}
		);
		const plan = planOffline(
			{
				cards: data.cards,
				reviews: data.reviews,
				deckIds,
				kinds: kinds.length > 0 ? kinds : ['vocab'],
				newLimit: config.newLimit,
				reviewLimit: config.reviewLimit,
				now: new Date(now),
				w: d.weights(data),
				ctx: d.contextFor(data, workspaceId, now),
				deckSettings: data.deckSettings,
				language: d.language
			},
			{ extraNew: d.extraNew, studyAllExtra: d.studyAllExtra }
		);
		for (const path of OFFLINE_API_PATHS) await d.fetchApi(path);
		await pool(plan.entryIds, async (id) => {
			if (!(await d.isCached(entryPath(id)))) await d.fetchEntry(id);
		});
		await pool(plan.chars, (ch) => d.fetchStroke(ch));
		const saved: Receipt = { at: now, cards: data.cards.length, reviews: data.reviews.length, entries: plan.entryIds.length, pages: d.pullPages(workspaceId), partition };
		try {
			d.storage?.setItem(key, JSON.stringify(saved));
		} catch {
			// No receipt: the next visit prepares again.
		}
		d.onPrepared({ workspaceId, cards: plan.entryIds.length, at: new Date(now).toISOString() });
		return { status: 'prepared', entries: plan.entryIds.length };
	} catch {
		// Offline mid-way, a server error: nothing is promised and nothing is recorded.
		return { status: 'failed', entries: 0 };
	}
}
