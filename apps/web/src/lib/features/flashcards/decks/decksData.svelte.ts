// The decks page's data: one load of the workspace's study history, the
// schedule index built once from it, and the clock/day captured at load so
// every number on the page agrees. Shared by the list, the detail and the
// settings view; each calls `load` for the selected workspace. The last
// snapshot of a workspace is held for the session (#290): the decks opened
// again show it at once and refresh it behind; a failed refresh keeps it with
// a quiet notice (`stale`).

import type { Session } from '$lib/context/session.svelte';
import { untrack } from 'svelte';
import { errorText } from '$lib/api/apiErrors';
import { t } from '$lib/i18n';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import type { DeckSettings } from '$lib/studycore/deckSettings';
import { loadStudyHistory } from '$lib/studycore/data';
import { activeWeights } from '$lib/studycore/readModel';
import type { Deck, ReviewEvent, StudyCard } from '$lib/studycore/types';
import { addDays } from '$lib/time/studyDay';
import { contextForData } from '$lib/studycore/currentContext';
import type { StudyContext } from '$lib/studycore/studyContext';
import { scheduleIndex, type ScheduleIndex } from './deckStats';
import { heldValue, holdValue } from '$lib/widgets/widgetLoad.svelte';

export interface DecksSnapshot {
	workspaceId: number;
	decks: Deck[];
	cards: StudyCard[];
	reviews: ReviewEvent[];
	deckSettings: Record<string, DeckSettings>;
	weights: readonly number[];
	index: ScheduleIndex;
	/** Entries the learner marked known (#68). */
	known: number[];
	now: Date;
	ctx: StudyContext;
	addDays: typeof addDays;
}

export type DecksStatus = 'loading' | 'ready' | 'error' | 'no-workspace';

export function createDecksData(session: Session) {
	const opened = session.workspaces.current?.id ?? null;
	const held = opened === null ? undefined : heldValue<DecksSnapshot>(session, 'decks', opened);
	let status = $state<DecksStatus>(held === undefined ? 'loading' : 'ready');
	let error = $state('');
	let stale = $state('');
	let snapshot = $state.raw<DecksSnapshot | null>(held ?? null);
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
		const shown = current !== null && current.workspaceId === workspaceId;
		if (!shown) {
			// Another workspace: its held snapshot, or loading.
			const other = heldValue<DecksSnapshot>(session, 'decks', workspaceId);
			snapshot = other ?? null;
			status = other === undefined ? 'loading' : 'ready';
		}
		error = '';
		try {
			const data = await loadStudyHistory(session.study, workspaceId, { force });
			if (mine !== seq) return;
			const weights = activeWeights(data) ?? DEFAULT_W;
			const ctx = contextForData(session.zone, data, workspaceId);
			snapshot = {
				workspaceId,
				decks: data.decks,
				cards: data.cards,
				reviews: data.reviews,
				deckSettings: data.deckSettings ?? {},
				weights,
				index: scheduleIndex(data.cards, data.reviews, weights, ctx.clock),
				known: data.known ?? [],
				now: new Date(),
				ctx,
				addDays
			};
			holdValue(session, 'decks', workspaceId, snapshot);
			status = 'ready';
			stale = '';
		} catch (err) {
			if (mine !== seq) return;
			const text = errorText(err, t('flashcards.decks.loadError'));
			if (untrack(() => snapshot) !== null) {
				// The data on screen stays: say quietly that it is not up to date.
				stale = text;
				return;
			}
			error = text;
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
		/** A refresh failed while data is shown (the quiet notice). */
		get stale() {
			return stale;
		},
		get data() {
			return snapshot;
		},
		load
	};
}

export type DecksData = ReturnType<typeof createDecksData>;
