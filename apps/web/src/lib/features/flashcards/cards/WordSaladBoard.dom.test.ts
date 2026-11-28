import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shuffleTokens } from '$lib/exercises/wordSalad';
import WordSaladBoard from './WordSaladBoard.svelte';

// #291: drag and drop and the keyboard move on the Word salad board.

const solution = ['我', '喜欢', '吃', '苹果'];
const seed = 's';
const bankOrder = shuffleTokens(solution, seed);

// jsdom has no layout. Each row lays its items (tiles and the gap) out in one line, 40 px wide, 50 px apart:
// the answer row at y 0–40, the bank at y 100–140.
const ROW_TOP = { answer: 0, bank: 100 } as const;
function fakeLayout(this: HTMLElement): DOMRect {
	const rect = (left: number, top: number, width: number, height: number) =>
		({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} }) as DOMRect;
	const list = this.closest('ol, ul');
	const which = list?.classList.contains('bank') ? 'bank' : 'answer';
	if (this.tagName === 'OL' || this.tagName === 'UL') return rect(0, ROW_TOP[which], 400, 40);
	const item = this.closest('li');
	if (list !== null && item !== null) {
		const index = [...list.children].indexOf(item);
		return rect(index * 50, ROW_TOP[which], 40, 40);
	}
	return rect(0, 0, 400, 200);
}

beforeEach(() => {
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(fakeLayout);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function setup() {
	const onResult = vi.fn();
	render(WordSaladBoard, { solution, seed, disabled: false, onResult, language: 'zh' });
	return { onResult };
}

const answerRow = () => screen.getByRole('list', { name: 'Your sentence' });
const bankRow = () => screen.getByRole('list', { name: 'Word tiles' });
const answerWords = () => [...answerRow().querySelectorAll('button')].map((b) => b.textContent);
const board = () => document.querySelector('.board') as HTMLElement;
const announcement = () => document.querySelector('[data-salad-announce]')?.textContent ?? '';

async function placeAll(order: string[]): Promise<void> {
	for (const word of order) await fireEvent.click(screen.getByRole('button', { name: `Place ${word}` }));
}

const pointer = (x: number, y: number, pointerType = 'mouse') => ({
	clientX: x,
	clientY: y,
	pointerId: 1,
	pointerType,
	isPrimary: true,
	button: 0
});

/** Press on `tile`, move to (x, y) in two steps, release there. */
async function drag(tile: HTMLElement, x: number, y: number, pointerType = 'mouse'): Promise<void> {
	const from = tile.getBoundingClientRect();
	const sx = from.left + 20;
	const sy = from.top + 20;
	await fireEvent.pointerDown(tile, pointer(sx, sy, pointerType));
	await fireEvent.pointerMove(board(), pointer(sx + (x - sx) / 2, sy + (y - sy) / 2, pointerType));
	await fireEvent.pointerMove(board(), pointer(x, y, pointerType));
	await fireEvent.pointerUp(board(), pointer(x, y, pointerType));
}

describe('WordSaladBoard drag and drop (#291)', () => {
	it('drags a placed tile to a new position in the answer', async () => {
		setup();
		await placeAll(['苹果', '我', '喜欢', '吃']);
		// 苹果 (first) dropped past 吃's centre: the others close up, it lands last.
		await drag(screen.getByRole('button', { name: 'Remove 苹果' }), 190, 20);
		expect(answerWords()).toEqual(['我', '喜欢', '吃', '苹果']);
		expect(announcement()).toBe('苹果 moved to position 4 of 4');
	});

	it('drags a bank tile straight into the middle of the answer', async () => {
		setup();
		await placeAll(['我', '吃']);
		await drag(screen.getByRole('button', { name: 'Place 喜欢' }), 30, 20, 'touch');
		expect(answerWords()).toEqual(['我', '喜欢', '吃']);
		expect(bankRow().textContent).not.toContain('喜欢');
	});

	it('drags a placed tile back to the bank', async () => {
		setup();
		await placeAll(['我', '吃']);
		await drag(screen.getByRole('button', { name: 'Remove 我' }), 20, 120, 'pen');
		expect(answerWords()).toEqual(['吃']);
		expect(screen.getByRole('button', { name: 'Place 我' })).toBeTruthy();
		expect(announcement()).toBe('我 removed');
	});

	it('shows a gap where the tile will land while dragging', async () => {
		setup();
		await placeAll(['我', '吃', '苹果']);
		const tile = screen.getByRole('button', { name: 'Remove 苹果' });
		await fireEvent.pointerDown(tile, pointer(120, 20));
		await fireEvent.pointerMove(board(), pointer(20, 20));
		const items = [...answerRow().children];
		expect(items[0].hasAttribute('data-salad-gap')).toBe(true);
		expect(document.querySelector('[data-salad-ghost]')?.textContent).toBe('苹果');
		await fireEvent.pointerUp(board(), pointer(20, 20));
		expect(answerWords()).toEqual(['苹果', '我', '吃']);
		expect(answerRow().querySelector('[data-salad-gap]')).toBeNull();
		expect(document.querySelector('[data-salad-ghost]')).toBeNull();
	});

	it('a release away from both rows puts the tile back', async () => {
		setup();
		await placeAll(['我', '吃']);
		await drag(screen.getByRole('button', { name: 'Remove 我' }), 20, 400);
		expect(answerWords()).toEqual(['我', '吃']);
	});

	it('Escape cancels a drag', async () => {
		setup();
		await placeAll(['我', '吃']);
		await fireEvent.pointerDown(screen.getByRole('button', { name: 'Remove 我' }), pointer(20, 20));
		await fireEvent.pointerMove(board(), pointer(90, 20));
		await fireEvent.keyDown(window, { key: 'Escape' });
		await fireEvent.pointerUp(board(), pointer(90, 20));
		expect(answerWords()).toEqual(['我', '吃']);
	});

	it('a cancelled pointer (the browser took it) changes nothing', async () => {
		setup();
		await placeAll(['我', '吃']);
		await fireEvent.pointerDown(screen.getByRole('button', { name: 'Remove 我' }), pointer(20, 20));
		await fireEvent.pointerMove(board(), pointer(90, 20));
		await fireEvent.pointerCancel(board(), pointer(90, 20));
		expect(answerWords()).toEqual(['我', '吃']);
	});

	it('a shaky tap is still a tap', async () => {
		setup();
		const tile = screen.getByRole('button', { name: 'Place 我' });
		const at = tile.getBoundingClientRect();
		await fireEvent.pointerDown(tile, pointer(at.left + 20, at.top + 20, 'touch'));
		await fireEvent.pointerMove(board(), pointer(at.left + 24, at.top + 26, 'touch'));
		await fireEvent.pointerUp(board(), pointer(at.left + 24, at.top + 26, 'touch'));
		await fireEvent.click(tile, { detail: 1 });
		expect(answerWords()).toEqual(['我']);
	});

	it('the click that ends a drag does not also tap', async () => {
		setup();
		await placeAll(['我', '吃']);
		await drag(screen.getByRole('button', { name: 'Remove 我' }), 120, 20);
		expect(answerWords()).toEqual(['吃', '我']);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 我' }), { detail: 1 });
		expect(answerWords()).toEqual(['吃', '我']);
	});

	it('a reorder is not a wrong check', async () => {
		const { onResult } = setup();
		await placeAll(['喜欢', '我', '吃', '苹果']);
		await drag(screen.getByRole('button', { name: 'Remove 我' }), 20, 20);
		expect(answerWords()).toEqual(solution);
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(onResult).toHaveBeenCalledWith({ wrongChecks: 0, gaveUp: false });
	});

	it('every tile is a drag handle (touch-action: none in the styles)', () => {
		setup();
		expect(bankOrder).toHaveLength(4);
		for (const tile of bankRow().querySelectorAll('button')) expect(tile.hasAttribute('data-salad-tile')).toBe(true);
	});
});

describe('WordSaladBoard keyboard move (#291)', () => {
	it('Alt+Arrow moves a focused placed tile and announces it, focus stays on it', async () => {
		setup();
		await placeAll(['我', '吃', '喜欢']);
		const tile = screen.getByRole('button', { name: 'Remove 喜欢' });
		tile.focus();
		await fireEvent.keyDown(tile, { key: 'ArrowLeft', altKey: true });
		expect(answerWords()).toEqual(['我', '喜欢', '吃']);
		expect(announcement()).toBe('喜欢 moved to position 2 of 3');
		expect(document.activeElement?.textContent).toBe('喜欢');
		await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', altKey: true });
		expect(answerWords()).toEqual(['我', '吃', '喜欢']);
	});

	it('at the edge nothing moves; arrows without Alt are left alone', async () => {
		setup();
		await placeAll(['我', '吃']);
		const first = screen.getByRole('button', { name: 'Remove 我' });
		first.focus();
		await fireEvent.keyDown(first, { key: 'ArrowLeft', altKey: true });
		await fireEvent.keyDown(first, { key: 'ArrowRight' });
		expect(answerWords()).toEqual(['我', '吃']);
	});

	it('says how to move a placed tile', async () => {
		setup();
		await placeAll(['我']);
		const tile = screen.getByRole('button', { name: 'Remove 我' });
		const id = tile.getAttribute('aria-describedby');
		expect(id).toBeTruthy();
		expect(document.getElementById(id!)?.textContent).toBe('Alt+Left and Alt+Right move it.');
	});

	it('tap and Enter keep working as before', async () => {
		setup();
		await placeAll(['我', '吃']);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 我' }));
		expect(answerWords()).toEqual(['吃']);
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		expect(answerWords()).toEqual([]);
	});
});
