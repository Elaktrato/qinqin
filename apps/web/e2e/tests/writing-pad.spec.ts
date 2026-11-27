// The writing pad on a phone (#285): the flashcards' writing card and the scripts trainer's Write mode size the
// pad to the screen (lib/writing/padSize.ts). At 360 × 740 it fills the content width and stays square, the
// feedback line stays above the docked actions, nothing scrolls sideways, and a stroke drawn on the larger pad
// is accepted (the matcher works in pad units). In landscape it keeps its minimum and nothing scrolls sideways.
//
// The e2e server has no strokes pack (an empty pack root): the stroke files are served from the Hanzi Writer
// data the web app's tests already use, and the eligibility answer adds the writing card, through page.route.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { webRoot } from '../support/build';
import { expect, seedRandom, test, type Learner } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { addCards } from '../support/study';

// page.route does not see what a service worker fetches, and the app's worker serves /hanzi/.
test.use({ serviceWorkers: 'block' });

const strokeFile = (ch: string): string => readFileSync(join(webRoot, 'node_modules', 'hanzi-writer-data', `${ch}.json`), 'utf8');

/** Serves stroke data for every /hanzi/ request: the character's own where the data has it, else `fallback`'s. */
async function serveStrokes(page: Page, fallback: string): Promise<void> {
	await page.route(/\/hanzi\/U[0-9A-F]+\.json/, async (route) => {
		const hex = /U([0-9A-F]+)\.json/.exec(route.request().url())![1];
		const ch = String.fromCodePoint(parseInt(hex, 16));
		let body: string;
		try {
			body = strokeFile(ch);
		} catch {
			body = strokeFile(fallback);
		}
		await route.fulfill({ status: 200, contentType: 'application/json', body });
	});
}

/** Every entry the server is asked about may also make a writing card. */
async function allowWriting(page: Page): Promise<void> {
	await page.route(/\/api\/study\/eligibility$/, async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { entries: Record<string, string[]> };
		for (const kinds of Object.values(body.entries)) if (!kinds.includes('writing')) kinds.push('writing');
		await route.fulfill({ response, json: body });
	});
}

/** Starts a session of writing cards of 水 from the study modal. */
async function startWriting(page: Page): Promise<void> {
	await page.goto('/study');
	const modal = page.getByRole('dialog', { name: 'Study' });
	await expect(modal).toBeVisible();
	const writing = modal.getByRole('checkbox', { name: 'Writing' });
	await writing.check();
	await modal.getByRole('checkbox', { name: 'Vocab' }).uncheck();
	// The writing card is counted once the eligibility answer is in.
	await expect(modal).toContainText('This session: 1 card');
	await modal.getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
	await expect(page.getByRole('article', { name: /^Write card$/ })).toBeVisible();
}

/** Draws a median (unit-box points, y down) on the pad with the mouse. */
async function draw(page: Page, box: { x: number; y: number; width: number; height: number }, points: [number, number][]): Promise<void> {
	const at = ([x, y]: [number, number]) => [box.x + x * box.width, box.y + y * box.height] as const;
	await page.mouse.move(...at(points[0]));
	await page.mouse.down();
	for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 4 });
	await page.mouse.up();
}

/** Stroke `i` of 水 as unit-box points (the data's 1024 box, y up, baseline 900). */
function strokeOf(i: number): [number, number][] {
	const data = JSON.parse(strokeFile('水')) as { medians: [number, number][][] };
	return data.medians[i].map(([x, y]) => [x / 1024, (900 - y) / 1024]);
}
const firstStroke = () => strokeOf(0);
/** A line no stroke of 水 has: along the bottom, right to left. */
const WRONG: [number, number][] = [
	[0.9, 0.95],
	[0.5, 0.95],
	[0.1, 0.95]
];

/** Opens a writing card of 水 with the strokes and the eligibility routed. */
async function openWritingCard(page: Page, learner: Learner): Promise<void> {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '水' }]);
	await seedRandom(page, 285);
	await serveStrokes(page, '水');
	await allowWriting(page);
	await startWriting(page);
}

/** Where the pad, the feedback line and the dock are once the pad has its size. */
async function layout(page: Page) {
	const pad = page.locator('.pad[data-card-input]');
	await expect(pad).toBeVisible();
	// The pad has been measured once it is no longer at its 12.5rem starting size.
	await expect.poll(async () => Math.round((await pad.boundingBox())!.width)).not.toBe(200);
	const box = (await pad.boundingBox())!;
	const face = (await page.locator('.face-work').boundingBox())!;
	const feedback = (await page.locator('.feedback[role="status"]').boundingBox())!;
	const dock = (await page.locator('[data-action-dock]').boundingBox())!;
	return { box, contentWidth: face.width, feedbackBottom: feedback.y + feedback.height, dockTop: dock.y };
}

test.describe('on a phone', () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

	test('the writing card grows as far as the height allows, stays square and accepts a stroke', async ({ page, learner }) => {
		await openWritingCard(page, learner);
		const { box, contentWidth, feedbackBottom, dockTop } = await layout(page);
		expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
		// At 740 px the prompt (word, readings, gloss) leaves less height than width: the pad stops where the
		// feedback line meets the dock, larger than the old 200 px.
		expect(box.width).toBeGreaterThan(240);
		expect(box.width).toBeLessThanOrEqual(contentWidth);
		expect(feedbackBottom).toBeLessThanOrEqual(dockTop + 1);
		expect(dockTop - feedbackBottom).toBeLessThan(4);
		await expectNoSidewaysScroll(page, 'the writing card');

		// A stroke drawn on the larger pad is accepted.
		await draw(page, box, firstStroke());
		await expect(page.locator('.pad .outline.filled')).toHaveCount(1);
		await expect(page.getByText('Mistakes: 0')).toBeVisible();
	});

	test('three misses on a stroke trace that stroke only, again on a later stroke, each a hint (#287)', async ({ page, learner }) => {
		await openWritingCard(page, learner);
		const { box } = await layout(page);
		const before = (await learner.api.reviews(learner.workspaces.ja)).length;
		const trace = page.locator('.pad path.trace');
		for (let i = 0; i < 2; i++) await draw(page, box, WRONG);
		await expect(page.locator('.actions .count')).toHaveText('Mistakes: 2');
		await expect(trace).toHaveCount(0);
		await draw(page, box, WRONG);
		// The third miss: that stroke alone stays, faint, with its start; no other stroke is shown.
		await expect(trace).toHaveCount(1);
		await expect(page.locator('.pad circle.trace-start')).toHaveCount(1);
		await expect(page.locator('.pad .outline.filled')).toHaveCount(0);
		await expect(page.locator('.pad .outline.scaffold')).toHaveCount(0);
		await draw(page, box, strokeOf(0));
		await expect(page.locator('.pad .outline.filled')).toHaveCount(1);
		await expect(trace).toHaveCount(0);
		// The second stroke gets three misses too: it alone is traced.
		for (let i = 0; i < 3; i++) await draw(page, box, WRONG);
		await expect(trace).toHaveCount(1);
		const traced = await trace.getAttribute('d');
		const second = await page.locator('.pad path.outline').nth(1).getAttribute('d');
		expect(traced).toBe(second);
		// Show strokes, then the suggested grade: two automatic hints and the shown character.
		await page.getByRole('button', { name: 'Show strokes' }).click();
		await page.getByRole('button', { name: /^Again\b/ }).click();
		await expect.poll(async () => (await learner.api.reviews(learner.workspaces.ja)).length - before).toBe(1);
		const review = (await learner.api.reviews(learner.workspaces.ja)).slice(before)[0];
		expect(review.payload.meta).toMatchObject({ mistakes: 6, hints: 3 });
	});

	test('the scripts trainer’s Write mode fills the width and keeps its buttons on screen', async ({ page, learner }) => {
		await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.ja);
		await serveStrokes(page, '一');
		await page.goto('/scripts/hiragana/practice/write');
		const pad = page.locator('.pad[data-card-input]');
		await expect(pad).toBeVisible();
		const wrap = page.locator('.write');
		const wrapBox = (await wrap.boundingBox())!;
		await expect.poll(async () => Math.round((await pad.boundingBox())!.width)).toBeGreaterThanOrEqual(Math.floor(wrapBox.width) - 1);
		const box = (await pad.boundingBox())!;
		expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
		const hint = (await page.getByRole('button', { name: 'Hint' }).boundingBox())!;
		expect(hint.y + hint.height).toBeLessThanOrEqual(PHONE.height);
		await expectNoSidewaysScroll(page, 'the scripts trainer’s Write mode');
	});
});

test.describe('on a tall phone', () => {
	test.use({ viewport: { width: PHONE.width, height: 860 }, hasTouch: true, isMobile: true });

	test('the writing card fills the content width', async ({ page, learner }) => {
		await openWritingCard(page, learner);
		const { box, contentWidth, feedbackBottom, dockTop } = await layout(page);
		// 328 px: 360 px less the face's padding.
		expect(Math.abs(box.width - contentWidth)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
		expect(feedbackBottom).toBeLessThanOrEqual(dockTop + 1);
		await expectNoSidewaysScroll(page, 'the writing card on a tall phone');
	});
});

test.describe('on a phone in landscape', () => {
	test.use({ viewport: { width: PHONE.height, height: PHONE.width }, hasTouch: true, isMobile: true });

	test('the writing card keeps its minimum and nothing scrolls sideways', async ({ page, learner }) => {
		await openWritingCard(page, learner);
		const { box } = await layout(page);
		expect(Math.round(box.width)).toBe(160);
		expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
		await expectNoSidewaysScroll(page, 'the writing card in landscape');
	});
});

test('turning a phone mid-card resizes the pad and it still accepts a stroke', async ({ page, learner }) => {
	await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
	await openWritingCard(page, learner);
	const { box: first } = await layout(page);
	const before = first.width;
	const pad = page.locator('.pad[data-card-input]');
	await page.setViewportSize(PHONE);
	await expect.poll(async () => (await pad.boundingBox())!.width).toBeGreaterThan(before);
	const box = (await pad.boundingBox())!;
	await draw(page, box, firstStroke());
	await expect(page.locator('.pad .outline.filled')).toHaveCount(1);
});
