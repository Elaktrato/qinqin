// What the mistake notebook's page reads (#227): the workspace's study history (queued answers included), the
// notebook derived from it, and the names it shows: the drills' candidate items, the grammar lesson titles and the
// courses the session holds. A name that cannot be loaded falls back to the item's id; the notebook itself never
// waits for the network beyond the history.

import type { Workspace } from '$lib/api/types';
import type { Course } from '$lib/api/courses';
import type { Session } from '$lib/context/session.svelte';
import { getLanguage } from '$lib/i18n';
import { heldCourse, refreshCourse } from '$lib/features/courses/courseData';
import { listGrammar } from '$lib/features/grammar/api';
import { availableDrills, deviceStorage } from '$lib/features/practice/drills';
import type { DrillDef, DrillItem } from '$lib/features/practice/types';
import { contextForData } from '$lib/studycore/currentContext';
import { loadStudyHistory } from '$lib/studycore/data';
import { notebookItems, type NotebookItem } from '$lib/studycore/notebook';
import { activeWeights } from '$lib/studycore/readModel';
import type { StudyHistory } from '$lib/studycore/types';
import { dueCardIds } from './practise';
import { drillsNamed, notebookCardIds, type NotebookContext } from './view';

export interface NotebookData {
	items: NotebookItem[];
	ctx: NotebookContext;
	/** The notebook's cards that are due now. */
	dueCards: string[];
	/** The decks those cards are in (the session's decks). */
	cardDecks: string[];
}

async function drillItemsOf(defs: readonly DrillDef[], session: Session, workspace: Workspace, history: StudyHistory): Promise<Map<string, Map<string, DrillItem>>> {
	const lists = await Promise.all(defs.map((d) => d.items({ session, workspace, history }).catch((): DrillItem[] => [])));
	return new Map(defs.map((d, i) => [d.id, new Map(lists[i].map((item) => [item.key, item]))]));
}

async function grammarTitlesOf(items: readonly NotebookItem[], language: string): Promise<Map<string, string>> {
	if (!items.some((item) => item.ref.source === 'grammar')) return new Map();
	try {
		const packs = await listGrammar(language);
		return new Map(packs.flatMap((p) => (p.lessons ?? []).map((l) => [`${p.packId}:${l.id}`, l.title] as const)));
	} catch {
		return new Map();
	}
}

async function coursesOf(session: Session, items: readonly NotebookItem[]): Promise<Map<string, Course>> {
	const ids = [...new Set(items.flatMap((item) => (item.ref.source === 'course' ? [item.ref.course] : [])))];
	const out = new Map<string, Course>();
	await Promise.all(
		ids.map(async (id) => {
			const held = heldCourse(session, id) ?? (await refreshCourse(session, id).catch(() => null));
			if (held !== null) out.set(id, held);
		})
	);
	return out;
}

/** loadNotebook reads the history once and the names the notebook's items need. */
export async function loadNotebook(session: Session, workspace: Workspace, now: Date = new Date()): Promise<NotebookData> {
	const history = await loadStudyHistory(session.study, workspace.id);
	const items = notebookItems(history);
	const named = new Set(drillsNamed(items));
	const defs = availableDrills(workspace.language, deviceStorage()).filter((d) => named.has(d.id));
	const [drillItems, grammarTitles, courses] = await Promise.all([
		drillItemsOf(defs, session, workspace, history),
		grammarTitlesOf(items, workspace.language),
		coursesOf(session, items)
	]);
	const cards = new Map(history.cards.map((card) => [card.id, card]));
	const ctxOfDay = contextForData(session.zone, history, workspace.id, now.getTime());
	const notebookCards = notebookCardIds(items);
	const dueCards = dueCardIds(notebookCards, history.reviews, now, activeWeights(history), ctxOfDay);
	const cardDecks = [...new Set(dueCards.flatMap((id) => cards.get(id)?.deckIds ?? []))];
	return {
		items,
		ctx: { cards, drills: new Map(defs.map((d) => [d.id, d])), drillItems, grammarTitles, courses, language: getLanguage() },
		dueCards,
		cardDecks
	};
}
