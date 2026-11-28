// What the study modal and /study/advanced count from (moved from the study
// page): one workspace's study data, the level schemes of its language and the
// entries of one level. A slow answer for an earlier workspace or level never
// lands. `fresh` reads the log fresh (the advanced page, as before); otherwise
// the shared history cache answers (the modal: it opens without waiting when
// the home widget or the decks page read it already). It is ready once the
// session's eligibility index knows the words too (#288): the counts then only
// promise cards the session shows.

import type { Session } from '$lib/context/session.svelte';
import { errorText } from '$lib/api/apiErrors';
import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { EntryBase, Scheme } from '$lib/api/types';
import { t } from '$lib/i18n';
import { contextForData, currentContext } from '$lib/studycore/currentContext';
import { loadStudyData, loadStudyHistory } from '$lib/studycore/data';
import type { DeckSettings } from '$lib/studycore/deckSettings';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { activeWeights } from '$lib/studycore/readModel';
import type { StudyContext } from '$lib/studycore/studyContext';
import type { Deck, ReviewEvent, StudyCard, StudyHistory } from '$lib/studycore/types';
import type { VacationPeriod } from '$lib/studycore/vacation';
import { companionEntryIds } from '../session/eligibility.svelte';

export type SetupDataStatus = 'no-workspace' | 'loading' | 'ready' | 'error';

function describeScheduling(data: StudyHistory): string {
	const active = data.fsrs?.active;
	if (active === null || active === undefined) return t('study.setup.schedDefault');
	const day = active.createdAt.slice(0, 10);
	return active.source === 'optimized' ? t('study.setup.schedOptimised', { day }) : t('study.setup.schedImported', { day });
}

export function createSetupData(session: Session, opts: { fresh: boolean }) {
	let status = $state<SetupDataStatus>('loading');
	let error = $state('');
	let workspaceId = $state<number | null>(null);
	let language = $state<string | null>(null);
	let decks = $state.raw<Deck[]>([]);
	let cards = $state.raw<StudyCard[]>([]);
	let reviews = $state.raw<ReviewEvent[]>([]);
	let deckSettings = $state.raw<Record<string, DeckSettings>>({});
	let weights = $state.raw<readonly number[]>(DEFAULT_W);
	let ctx = $state.raw<StudyContext>(currentContext(session.zone));
	let vacations = $state.raw<VacationPeriod[]>([]);
	let schedulingLabel = $state(t('study.setup.schedDefault'));
	let schemes = $state.raw<Scheme[]>([]);
	let schemesLoaded = $state(false);
	let schemeError = $state('');
	let levelEntries = $state.raw<EntryBase[]>([]);
	let levelLoading = $state(false);
	let levelError = $state('');
	let seq = 0;
	let levelSeq = 0;

	function apply(data: StudyHistory, ws: number): void {
		decks = data.decks;
		cards = data.cards;
		reviews = data.reviews;
		deckSettings = data.deckSettings ?? {};
		weights = activeWeights(data);
		ctx = contextForData(session.zone, data, ws);
		vacations = data.vacations ?? [];
		schedulingLabel = describeScheduling(data);
	}

	function read(ws: number): Promise<StudyHistory> {
		return opts.fresh ? loadStudyData(session.study, ws) : loadStudyHistory(session.study, ws);
	}

	async function loadSchemes(mine: number, lang: string | null): Promise<void> {
		try {
			const list = await getSchemes();
			if (mine !== seq) return;
			schemes = (Array.isArray(list) ? list : []).filter((scheme) => scheme.language === lang);
		} catch (err) {
			if (mine !== seq) return;
			schemes = [];
			schemeError = errorText(err, t('study.setup.schemesFailed'));
		} finally {
			if (mine === seq) schemesLoaded = true;
		}
	}

	return {
		get status() {
			return status;
		},
		get error() {
			return error;
		},
		get workspaceId() {
			return workspaceId;
		},
		get language() {
			return language;
		},
		get decks() {
			return decks;
		},
		get cards() {
			return cards;
		},
		get reviews() {
			return reviews;
		},
		get deckSettings() {
			return deckSettings;
		},
		get weights() {
			return weights;
		},
		get ctx() {
			return ctx;
		},
		get vacations() {
			return vacations;
		},
		get schedulingLabel() {
			return schedulingLabel;
		},
		/** The installed schemes of the workspace language. */
		get schemes() {
			return schemes;
		},
		/** The schemes when the read answered; null while loading or after a failed read (unknown: nothing is repaired). */
		get knownSchemes(): Scheme[] | null {
			return schemesLoaded && schemeError === '' ? schemes : null;
		},
		get schemesLoaded() {
			return schemesLoaded;
		},
		get schemeError() {
			return schemeError;
		},
		get levelEntries() {
			return levelEntries;
		},
		get levelLoading() {
			return levelLoading;
		},
		get levelError() {
			return levelError;
		},

		/** load reads a workspace (null: none selected); the schemes load alongside. */
		async load(ws: number | null, lang: string | null): Promise<void> {
			const mine = ++seq;
			levelSeq++;
			levelEntries = [];
			levelLoading = false;
			levelError = '';
			workspaceId = ws;
			language = lang;
			error = '';
			schemes = [];
			schemesLoaded = false;
			schemeError = '';
			if (ws === null) {
				decks = [];
				cards = [];
				reviews = [];
				status = 'no-workspace';
				return;
			}
			status = 'loading';
			const schemesDone = loadSchemes(mine, lang);
			try {
				const data = await read(ws);
				if (mine !== seq) return;
				// A failed request leaves the words unknown: planned as before, checked when shown.
				await session.eligibility.ensure(companionEntryIds(data.cards));
				if (mine !== seq) return;
				apply(data, ws);
				status = 'ready';
			} catch (err) {
				if (mine !== seq) return;
				decks = [];
				cards = [];
				reviews = [];
				error = errorText(err, t('study.setup.decksFailed'));
				status = 'error';
			}
			await schemesDone;
		},

		/** refresh re-reads the study data of the shown workspace without the loading state. */
		async refresh(): Promise<void> {
			const ws = workspaceId;
			if (ws === null) return;
			const mine = seq;
			try {
				const data = await read(ws);
				await session.eligibility.ensure(companionEntryIds(data.cards));
				if (mine === seq) apply(data, ws);
			} catch {
				// Keep what is shown; the next change or visit reads again.
			}
		},

		/** loadLevel reads the entries of one level; a newer request wins. */
		async loadLevel(schemeId: number, levelName: string): Promise<void> {
			const mine = ++levelSeq;
			levelLoading = true;
			levelError = '';
			levelEntries = [];
			try {
				const list = await getSchemeEntries(schemeId, levelName);
				if (mine !== levelSeq) return;
				levelEntries = list;
			} catch (err) {
				if (mine !== levelSeq) return;
				levelError = errorText(err, t('study.setup.levelFailed'));
			} finally {
				if (mine === levelSeq) levelLoading = false;
			}
		},

		/** clearLevel drops the level entries (decks mode, or no level resolved). */
		clearLevel(): void {
			levelSeq++;
			levelEntries = [];
			levelLoading = false;
			levelError = '';
		}
	};
}

export type SetupData = ReturnType<typeof createSetupData>;
