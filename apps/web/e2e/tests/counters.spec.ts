// The measure-word and counter drills (#179) on a 360 px phone. This spec's server also holds two small packs
// (fixtures/counters: 汽车 and 苹果 in the CC-CEDICT format with their CL notes, 紙 and 犬 in the JMdict format; no other
// spec sees them). Chinese: the learner studies both nouns, Practice lists Measure words, a round asks 一＿汽车 typed
// (Enter during an IME composition does not check, the field keeps its focus and Enter moves on) and then from the
// choices; the answers reach the server as drill.measure-words events; the back button leaves the round. Japanese:
// the counter of 紙 typed in kana, and a counter reading (text the IME turned into kanji is asked again in kana).

import type { Page } from '@playwright/test';
import { test as base, expect } from '../support/fixtures';
import { fixtureCounters } from '../support/build';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { startServer, type RunningServer } from '../support/server';
import { addCards } from '../support/study';

const test = base.extend<object, { server: RunningServer }>({
	server: [
		async ({}, use, workerInfo) => {
			const server = await startServer(workerInfo.project.outputDir, `counters-w${workerInfo.workerIndex}`, { seed: fixtureCounters });
			await use(server);
			await server.stop();
		},
		{ scope: 'worker', timeout: 60_000 }
	]
});

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

async function imeEnter(page: Page, label: string): Promise<void> {
	await page.getByRole('textbox', { name: label }).evaluate((el) => {
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
	});
}

test('a measure-word round: typed through the IME, then chosen, the answers on the server', async ({ page, learner }) => {
	const ws = learner.workspaces.zh;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await addCards(learner, 'zh', [
		{ kind: 'vocab', written: '汽车', reviewedDaysAgo: 3 },
		{ kind: 'vocab', written: '苹果', reviewedDaysAgo: 2 }
	]);
	const car = await learner.entryId('zh', '汽车');
	const apple = await learner.entryId('zh', '苹果');

	await page.goto('/practice');
	const drill = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Measure words' }) });
	await expect(drill).toBeVisible();
	await expect(drill.getByText('2 new')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice with the measure-word drill');

	await drill.getByRole('link', { name: 'Practise', exact: true }).click();
	await expect(page).toHaveURL(/\/practice\/measure-words$/);
	await expect(page.getByText('Question 1 of 2')).toBeVisible();
	await expect(page.getByText('car', { exact: true })).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/measure-words (typed)');

	const field = page.getByRole('textbox', { name: 'Measure word' });
	await expect(field).toBeFocused();
	await field.fill('辆');
	// Enter that commits an IME composition never checks the answer.
	await imeEnter(page, 'Measure word');
	const verdict = page.getByRole('status').filter({ hasText: /Right|Not quite|understood/ });
	await expect(verdict).toHaveCount(0);
	await field.press('Enter');
	await expect(verdict).toContainText('Right: 辆');
	await expect(verdict).toContainText('一辆汽车');
	// The field keeps its focus (the phone keyboard stays up); Enter moves on.
	await expect(field).toBeFocused();
	await field.press('Enter');

	await expect(page.getByText('Question 2 of 2')).toBeVisible();
	await page.getByRole('button', { name: 'Show choices' }).click();
	await expect(page.getByRole('group', { name: 'Choose the measure word' }).getByRole('button')).toHaveCount(4);
	await expectNoSidewaysScroll(page, '/practice/measure-words (choices)');
	await page.getByRole('button', { name: '个', exact: true }).click();
	await expect(verdict).toContainText('Right: 个');

	await expect
		.poll(async () =>
			(await learner.api.events(ws))
				.filter((e) => e.type === 'drill.measure-words')
				.map((e) => e.payload as { item: string; mode: string; grade: number })
				.sort((a, b) => a.item.localeCompare(b.item))
		)
		.toEqual(
			[
				{ item: String(car), mode: 'produce', grade: 3 },
				{ item: String(apple), mode: 'choose', grade: 2 }
			].sort((a, b) => a.item.localeCompare(b.item))
		);

	// The back button (the Android shell's too) leaves the round.
	await page.goBack();
	await expect(page).toHaveURL(/\/practice$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
});

test('Japanese: a counter typed in kana, and a counter reading through the IME', async ({ page, learner }) => {
	const ws = learner.workspaces.ja;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '紙', reviewedDaysAgo: 2 }]);
	const paper = await learner.entryId('ja', '紙');

	await page.goto('/practice');
	await expect(page.getByRole('heading', { level: 2, name: 'Counters' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Counter readings' })).toBeVisible();

	const verdict = page.getByRole('status').filter({ hasText: /Right|Not quite/ });
	await page.goto('/practice/counters');
	const counter = page.getByRole('textbox', { name: 'Counter' });
	await expect(counter).toBeFocused();
	await expect(page.getByText('paper', { exact: true })).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/counters');
	await counter.fill('まい');
	await counter.press('Enter');
	await expect(verdict).toContainText('Right: 枚【まい】');

	await page.goto('/practice/counter-readings');
	const reading = page.getByRole('textbox', { name: 'Reading' });
	await expect(reading).toBeFocused();
	await expect(page.getByText('1つ', { exact: true })).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/counter-readings');
	// The IME turned ひとつ into 一つ: not graded, asked again in kana.
	await reading.fill('一つ');
	await reading.press('Enter');
	await expect(page.getByRole('alert')).toContainText('Type the reading in kana or romaji');
	await reading.fill('ひとつ');
	await imeEnter(page, 'Reading');
	await expect(verdict).toHaveCount(0);
	await reading.press('Enter');
	await expect(verdict).toContainText('Right: 一つ【ひとつ】');
	await expect(reading).toBeFocused();

	await expect
		.poll(async () =>
			(await learner.api.events(ws))
				.filter((e) => e.type === 'drill.counters' || e.type === 'drill.counter-readings')
				.map((e) => ({ type: e.type, ...(e.payload as { item: string; mode: string; grade: number }) }))
				.sort((a, b) => a.type.localeCompare(b.type))
		)
		.toEqual([
			{ type: 'drill.counter-readings', item: 'tsu:1', mode: 'produce', grade: 3 },
			{ type: 'drill.counters', item: String(paper), mode: 'produce', grade: 3 }
		]);
});
