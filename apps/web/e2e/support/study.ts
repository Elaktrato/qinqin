// Study data written through the push API in the shapes of
// docs/contracts/study/rows.json and events/payloads.json.

import { epub } from './epub';
import { ulid } from './api';
import type { Learner } from './fixtures';

export interface CardSpec {
	kind: 'vocab' | 'reverse';
	written: string;
	/** Days ago of one earlier review graded Easy (not due today; buries nothing today). */
	reviewedDaysAgo?: number;
}

const DAY = 86_400_000;

/**
 * Puts cards in the General deck of a workspace, in the given order (oldest
 * first), with `cardTypes` switched on for General, plus the earlier reviews
 * the specs ask for.
 */
export async function addCards(learner: Learner, language: string, cards: CardSpec[], cardTypes: string[] = []): Promise<void> {
	const ws = learner.workspaces[language];
	const now = Date.now();
	const stamp = new Date(now).toISOString();
	const rows = [];
	const events = [];
	for (const [i, c] of cards.entries()) {
		const entryId = await learner.entryId(language, c.written);
		const id = `c-${c.kind}-${entryId}`;
		rows.push({
			workspaceId: ws,
			id,
			kind: c.kind,
			entryId,
			written: c.written,
			entryKind: null,
			sentenceId: null,
			skipKinds: [],
			deckIds: ['general'],
			createdAt: new Date(now - 10 * DAY + i * 1000).toISOString(),
			extra: {},
			updatedAt: stamp,
			deletedAt: null
		});
		if (c.reviewedDaysAgo !== undefined) {
			const ts = now - c.reviewedDaysAgo * DAY + i * 1000;
			events.push({
				id: ulid(ts),
				workspaceId: ws,
				device: 'e2e',
				ts: new Date(ts).toISOString(),
				type: 'review',
				payload: { cardId: id, mode: c.kind, grade: 4 }
			});
		}
	}
	const deckSettings =
		cardTypes.length > 0
			? [{ workspaceId: ws, deckId: 'general', cardTypes, newOrder: null, extra: {}, updatedAt: stamp, deletedAt: null }]
			: [];
	await learner.api.post('/api/sync/push', { cards: rows, deckSettings, events });
	await settled(learner, ws, rows.map((r) => r.id));
}

/**
 * A pull round ships rows stamped before its `until`, a whole second
 * (docs/contracts/sync): rows written in the second the page loads arrive
 * only with the next round. Waits until a round ships every pushed card, so
 * the page's first pull sees them.
 */
async function settled(learner: Learner, ws: number, cardIds: string[]): Promise<void> {
	const deadline = Date.now() + 5000;
	for (;;) {
		const page = await learner.api.get<{ collections: { cards: { id: string }[] }; more: boolean }>(
			`/api/sync/pull?v=2&collections=cards&limit=2000&workspace=${ws}`
		);
		const shipped = new Set(page.collections.cards.map((c) => c.id));
		if (cardIds.every((id) => shipped.has(id))) return;
		if (Date.now() > deadline) throw new Error('pushed cards never appeared in a pull round');
		await new Promise((r) => setTimeout(r, 100));
	}
}

/** Uploads a one-chapter epub to a workspace's library; returns the book id. */
export async function addBook(learner: Learner, language: string, title: string, paragraphs: string[]): Promise<number> {
	const form = new FormData();
	form.set('workspace', String(learner.workspaces[language]));
	form.set('file', new Blob([new Uint8Array(epub(title, language, paragraphs))]), 'book.epub');
	const book = await learner.api.post<{ id: number }>('/api/library/upload', form);
	return book.id;
}
