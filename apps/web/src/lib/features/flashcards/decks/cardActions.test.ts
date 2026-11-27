import { describe, expect, it, vi } from 'vitest';

import { createCardActions, UNDO_MS, type CardActionsDeps } from './cardActions';
import { PartialCardsError } from '../commands/cards';
import type { StudyCard } from '$lib/studycore/types';

function row(entryId: number, kind: StudyCard['kind'] = 'vocab'): StudyCard {
	return { id: `c-${kind}-${entryId}`, kind, entryId, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' };
}

function deps(over: Partial<CardActionsDeps> = {}): CardActionsDeps & {
	log: string[];
	fire(): void;
} {
	const log: string[] = [];
	let timer: (() => void) | null = null;
	const base: CardActionsDeps = {
		deleteCards: vi.fn(async (_ws: number, ids: readonly string[]) => ids.map((id) => ({ ...row(1), id }))),
		moveCards: vi.fn(async (_ws: number, ids: readonly string[]) => ids.map((id) => ({ ...row(1), id }))),
		restoreCards: vi.fn(async () => {}),
		dropSiblingCards: vi.fn(async (_ws: number, ids: readonly string[]) => ids.map((id) => ({ ...row(1, 'reverse'), id }))),
		skipKind: vi.fn(async () => [row(1)]),
		unskipKind: vi.fn(async () => [row(1)]),
		onchanged: vi.fn(async () => {
			log.push('changed');
		}),
		setTimer: ((fn: () => void) => {
			timer = fn;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout,
		clearTimer: (() => {
			timer = null;
		}) as unknown as typeof clearTimeout,
		...over
	};
	return Object.assign(base, {
		log,
		fire() {
			const fn = timer;
			timer = null;
			fn?.();
		}
	});
}

function snapshot(actions: ReturnType<typeof createCardActions>) {
	let value = { busy: false, error: '', undo: null as null | { text: string; rows: StudyCard[]; onlyLive: boolean } };
	actions.state.subscribe((s) => (value = s));
	return () => value;
}

describe('createCardActions', () => {
	it('an undo restores into the workspace the rows came from, whatever is shown now (#174)', async () => {
		const d = deps();
		const actions = createCardActions(d);
		await actions.remove(7, ['c-vocab-1']);
		// The user switched to workspace 9 and pressed Undo.
		await actions.undo();
		expect(d.restoreCards).toHaveBeenCalledWith(7, [expect.objectContaining({ id: 'c-vocab-1' })], { onlyLive: false });
	});

	it('remove offers an undo with the removed rows and reloads', async () => {
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['c-vocab-1']);
		expect(d.deleteCards).toHaveBeenCalledWith(7, ['c-vocab-1']);
		expect(d.onchanged).toHaveBeenCalledTimes(1);
		expect(now().undo?.text).toBe('Card deleted.');
		expect(now().undo?.onlyLive).toBe(false);
		await actions.undo();
		expect(d.restoreCards).toHaveBeenCalledWith(7, [expect.objectContaining({ id: 'c-vocab-1' })], { onlyLive: false });
		expect(now().undo).toBeNull();
	});

	it('names plural deletions and moves', async () => {
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['a', 'b']);
		expect(now().undo?.text).toBe('2 cards deleted.');
		await actions.move(7, ['a', 'b'], 'verbs', 'Verbs');
		expect(d.moveCards).toHaveBeenCalledWith(7, ['a', 'b'], 'verbs');
		expect(now().undo).toMatchObject({ text: 'Moved 2 cards to Verbs.', onlyLive: true });
		await actions.move(7, ['a'], 'verbs', 'Verbs');
		expect(now().undo?.text).toBe('Moved to Verbs.');
	});

	it('keeps the landed part of a partial failure undoable and shows the error', async () => {
		const landed = [row(1)];
		const d = deps({ deleteCards: vi.fn(async () => { throw new PartialCardsError('half', landed, new Error('x')); }) });
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['c-vocab-1', 'c-vocab-2']);
		expect(now().error).toBe('half');
		expect(now().undo?.rows).toEqual(landed);
		expect(d.onchanged).toHaveBeenCalledTimes(1);
	});

	it('a non-partial failure shows the message and offers no undo', async () => {
		const d = deps({ moveCards: vi.fn(async () => { throw new Error('nope'); }) });
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.move(7, ['a'], 'x', 'X');
		expect(now().error).toBe('That did not work.'); // an Error's own text never shows (#168)
		expect(now().undo).toBeNull();
	});

	it('a failed undo keeps the slot with the rows still to restore and is retryable', async () => {
		const restore = vi
			.fn()
			.mockRejectedValueOnce(new PartialCardsError('no', [row(2)], new Error('x')))
			.mockResolvedValue(undefined);
		const d = deps({ restoreCards: restore });
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['c-vocab-1']);
		await actions.undo();
		expect(now().error).toBe('no');
		expect(now().undo?.rows).toEqual([row(2)]);
		await actions.undo();
		expect(restore).toHaveBeenLastCalledWith(7, [row(2)], { onlyLive: false });
		expect(now().undo).toBeNull();
		expect(now().error).toBe('');
	});

	it('serializes writes: a second action waits for the first', async () => {
		const order: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const d = deps({
			deleteCards: vi.fn(async (_ws: number, ids: readonly string[]) => {
				order.push('delete-start');
				await gate;
				order.push('delete-end');
				return ids.map((id) => ({ ...row(1), id }));
			}),
			moveCards: vi.fn(async () => {
				order.push('move');
				return [];
			})
		});
		const actions = createCardActions(d);
		const first = actions.remove(7, ['a']);
		const second = actions.move(7, ['b'], 'x', 'X');
		await Promise.resolve();
		expect(order).toEqual(['delete-start']);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(['delete-start', 'delete-end', 'move']);
	});

	it('a new change replaces the undo slot', async () => {
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['a']);
		await actions.move(7, ['b'], 'x', 'X');
		expect(now().undo?.text).toBe('Moved to X.');
	});

	it('the undo slot expires after 10 s, but never under a running write', async () => {
		expect(UNDO_MS).toBe(10000);
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['a']);
		expect(now().undo).not.toBeNull();
		d.fire();
		expect(now().undo).toBeNull();

		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const slow = deps({
			restoreCards: vi.fn(async () => {
				await gate;
			})
		});
		const a2 = createCardActions(slow);
		const n2 = snapshot(a2);
		await a2.remove(7, ['a']);
		const undoing = a2.undo();
		await Promise.resolve();
		await Promise.resolve();
		slow.fire(); // would expire, but a write is running
		expect(n2().busy).toBe(true);
		release();
		await undoing;
	});

	it('pauseTimer stops expiry and resumeTimer restarts it', async () => {
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.remove(7, ['a']);
		actions.pauseTimer();
		d.fire();
		expect(now().undo).not.toBeNull();
		actions.resumeTimer();
		d.fire();
		expect(now().undo).toBeNull();
	});

	it('dropKind, skip and unskip are undoable with onlyLive false', async () => {
		const d = deps();
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.dropKind(7, ['c-reverse-1']);
		expect(d.dropSiblingCards).toHaveBeenCalledWith(7, ['c-reverse-1']);
		expect(now().undo).toMatchObject({ text: 'Card removed.', onlyLive: false });
		await actions.skip(7, 1, 'cloze');
		expect(d.skipKind).toHaveBeenCalledWith(7, 1, 'cloze');
		expect(now().undo).toMatchObject({ text: 'Cloze turned off for this word.', onlyLive: false });
		await actions.unskip(7, 1, 'reverse');
		expect(d.unskipKind).toHaveBeenCalledWith(7, 1, 'reverse');
		expect(now().undo).toMatchObject({ text: 'Reverse turned back on.', onlyLive: false });
	});

	it('an action that changed nothing offers no undo', async () => {
		const d = deps({ skipKind: vi.fn(async () => []) });
		const actions = createCardActions(d);
		const now = snapshot(actions);
		await actions.skip(7, 1, 'reverse');
		expect(now().undo).toBeNull();
	});

	it('destroy stops the timer and ignores later notifications', async () => {
		const d = deps();
		const actions = createCardActions(d);
		await actions.remove(7, ['a']);
		actions.destroy();
		d.fire();
	});
});
