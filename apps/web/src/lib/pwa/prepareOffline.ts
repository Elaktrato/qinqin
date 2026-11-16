// Offline preparation: after a workspace's study data has loaded online, fetch
// what a session started today needs - through the same helpers the pages use,
// so the worker's partition holds exactly the URLs the offline page will ask
// for. The queue is computed by the real planner (daily limits, vacation,
// burying, the learner's day), not a copy of its rules.

import { deckSessionPlan, type DeckSessionOptions } from '../study/cardFlow';
import { writableChars } from '../study/writing';
import type { StudyContext } from '../study/studyContext';
import { CARD_KINDS, type StudyHistory } from '../study/types';
import type { StudySessionConfig } from '../study/session';
import type { OfflineState } from './offlineState';

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
 * is saved is what could be studied today. Companion (virtual) items are not
 * studied offline and are left out.
 */
export function planOffline(
	input: PlanInput,
	opts: { extraNew?: number; maxEntries?: number } = {}
): OfflinePlan {
	const extraNew = opts.extraNew ?? EXTRA_NEW;
	const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
	const entryIds: number[] = [];
	const chars = new Set<string>();
	const seen = new Set<number>();
	for (const options of [input, { ...input, newLimit: input.newLimit + extraNew }]) {
		for (const item of deckSessionPlan(options).queue) {
			if (item.virtual || seen.has(item.entryId) || entryIds.length >= maxEntries) continue;
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
}

export interface PrepareDeps {
	userId: number;
	loadHistory: (workspaceId: number) => Promise<StudyHistory>;
	config: () => StudySessionConfig;
	language: string;
	contextFor: (data: StudyHistory, workspaceId: number, now: number) => StudyContext;
	weights: (data: StudyHistory) => readonly number[];
	fetchEntry: (id: number) => Promise<unknown>;
	fetchStroke: (char: string) => Promise<unknown>;
	fetchApi: (path: string) => Promise<unknown>;
	storage: Storage | null;
	now: () => number;
	/** True when a worker controls the page, the device is online and data saver is off. */
	canPrepare: () => boolean;
	extraNew?: number;
	onPrepared: (prepared: NonNullable<OfflineState['prepared']>) => void;
}

/** readReceipt: what was last prepared for a workspace, as the Settings line shows it. */
export function readReceipt(
	storage: Storage | null,
	userId: number,
	workspaceId: number
): NonNullable<OfflineState['prepared']> | null {
	const receipt = readReceiptAt(storage, receiptKey(userId, workspaceId));
	return receipt === null ? null : { workspaceId, cards: receipt.entries, at: new Date(receipt.at).toISOString() };
}

function readReceiptAt(storage: Storage | null, key: string): Receipt | null {
	try {
		const raw = storage?.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Receipt>;
		return typeof parsed.at === 'number' && typeof parsed.cards === 'number' && typeof parsed.reviews === 'number'
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
		const data = await d.loadHistory(workspaceId);
		const key = receiptKey(d.userId, workspaceId);
		const receipt = readReceiptAt(d.storage, key);
		const now = d.now();
		if (
			receipt !== null &&
			now - receipt.at < PREPARE_THROTTLE_MS &&
			receipt.cards === data.cards.length &&
			receipt.reviews === data.reviews.length
		) {
			return { status: 'skipped', entries: receipt.entries };
		}
		const config = d.config();
		// A levels session cannot run offline (its entries come from the scheme
		// API); prepare the plain deck session instead.
		const deckIds = config.mode === 'decks' && config.deckIds.length > 0 ? config.deckIds : ['general'];
		const kinds = CARD_KINDS.filter((kind) => config.cardTypes.includes(kind));
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
			{ extraNew: d.extraNew }
		);
		for (const path of OFFLINE_API_PATHS) await d.fetchApi(path);
		await pool(plan.entryIds, (id) => d.fetchEntry(id));
		await pool(plan.chars, (ch) => d.fetchStroke(ch));
		const saved: Receipt = { at: now, cards: data.cards.length, reviews: data.reviews.length, entries: plan.entryIds.length };
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
