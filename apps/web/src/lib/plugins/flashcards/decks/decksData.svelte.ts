// The decks page's data: one load of the workspace's study history, the
// schedule index built once from it, and the clock/day captured at load so
// every number on the page agrees. Shared by the list, the detail and the
// settings view; each calls `load` for the selected workspace.

import { untrack } from 'svelte';
import { errorMessage } from '$lib/stats/errors';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import type { DeckSettings } from '$lib/study/deckSettings';
import { loadStudyHistory } from '$lib/study/history';
import { activeWeights } from '$lib/study/store';
import type { Deck, ReviewEvent, StudyCard } from '$lib/study/types';
import { addDays, type StudyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { scheduleIndex, type ScheduleIndex } from './deckStats';

export interface DecksSnapshot {
	workspaceId: number;
	decks: Deck[];
	cards: StudyCard[];
	reviews: ReviewEvent[];
	deckSettings: Record<string, DeckSettings>;
	weights: readonly number[];
	index: ScheduleIndex;
	now: Date;
	day: StudyDay;
	addDays: typeof addDays;
}

export type DecksStatus = 'loading' | 'ready' | 'error' | 'no-workspace';

export function createDecksData() {
	let status = $state<DecksStatus>('loading');
	let error = $state('');
	let snapshot = $state.raw<DecksSnapshot | null>(null);
	// A slow earlier request never overwrites a newer one.
	let seq = 0;

	async function load(workspaceId: number | null, force = false): Promise<void> {
		const mine = ++seq;
		if (workspaceId === null) {
			snapshot = null;
			status = 'no-workspace';
			return;
		}
		// A reload after a write keeps the old view on screen until the new one arrives.
		// Untracked: a component calls load from an effect, which must not depend on the snapshot.
		const current = untrack(() => snapshot);
		if (current === null || current.workspaceId !== workspaceId) status = 'loading';
		error = '';
		try {
			const data = await loadStudyHistory(workspaceId, { force });
			if (mine !== seq) return;
			const weights = activeWeights(data) ?? DEFAULT_W;
			snapshot = {
				workspaceId,
				decks: data.decks,
				cards: data.cards,
				reviews: data.reviews,
				deckSettings: data.deckSettings ?? {},
				weights,
				index: scheduleIndex(data.cards, data.reviews, weights),
				now: new Date(),
				day: currentStudyDay(),
				addDays
			};
			status = 'ready';
		} catch (err) {
			if (mine !== seq) return;
			snapshot = null;
			error = errorMessage(err, 'Could not load your decks.');
			status = 'error';
		}
	}

	return {
		get status() {
			return status;
		},
		get error() {
			return error;
		},
		get data() {
			return snapshot;
		},
		load
	};
}

export type DecksData = ReturnType<typeof createDecksData>;
