// The look-alike drill (#228) on a 360 px phone, against the suite's own dictionary packs: the learner studies 喝, so
// Practice lists Look-alike characters with the set 喝/渴; a round recognises the character (its meaning among the
// set's), the next round asks the word with a gap; both answers reach the server as drill.look-alikes events with the
// character asked and the one given; the back button leaves the round. Japanese: the kana sets are there with
// nothing studied, and hidden romaji stay hidden.

import { test, expect } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { addCards } from '../support/study';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const MEANING: Record<string, string> = { 喝: 'to drink', 渴: 'thirsty' };

test('a look-alike set: recognised, then chosen in a word with a gap; the answers on the server', async ({ page, learner }) => {
	const ws = learner.workspaces.zh;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await addCards(learner, 'zh', [{ kind: 'vocab', written: '喝', reviewedDaysAgo: 2 }]);

	await page.goto('/practice');
	const drill = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Look-alike characters' }) });
	await expect(drill.getByText('1 new')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice with the look-alike drill');

	await drill.getByRole('link', { name: 'Practise', exact: true }).click();
	await expect(page).toHaveURL(/\/practice\/look-alikes$/);
	await expect(page.getByText('What is this character?')).toBeVisible();
	const asked = (await page.locator('p.shown').textContent())?.trim() ?? '';
	expect(Object.keys(MEANING)).toContain(asked);
	await expectNoSidewaysScroll(page, '/practice/look-alikes (recognise)');
	await page.getByRole('group', { name: 'Choose its meaning' }).getByRole('button').filter({ hasText: MEANING[asked] }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Right' })).toContainText(`Right: ${asked}.`);
	await expect(page.getByRole('list', { name: 'The characters of the set' }).getByRole('listitem')).toHaveCount(2);
	await expectNoSidewaysScroll(page, '/practice/look-alikes (answer)');

	await expect
		.poll(async () => (await learner.api.events(ws)).filter((e) => e.type === 'drill.look-alikes').map((e) => e.payload))
		.toEqual([{ item: '喝渴', mode: 'recognise', grade: 3, asked, given: asked }]);

	// The next round: the set has an answer, so it asks the word with a gap.
	await page.goto('/practice/look-alikes');
	await expect(page.getByText('Which character fills the gap?')).toBeVisible();
	const gap = (await page.locator('p.gap').textContent())?.trim() ?? '';
	const right = gap === '＿茶' ? '喝' : '渴';
	await expectNoSidewaysScroll(page, '/practice/look-alikes (choose)');
	await page.getByRole('group', { name: 'Choose the character' }).getByRole('button', { name: right === '喝' ? '渴' : '喝' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Not quite' })).toContainText(`it is ${right}`);
	await expect
		.poll(async () => (await learner.api.events(ws)).filter((e) => e.type === 'drill.look-alikes').length)
		.toBe(2);
	const last = (await learner.api.events(ws)).filter((e) => e.type === 'drill.look-alikes').map((e) => e.payload as Record<string, unknown>);
	expect(last).toContainEqual({ item: '喝渴', mode: 'choose', grade: 1, asked: right, given: right === '喝' ? '渴' : '喝' });

	// The back button (the Android shell's too) leaves the round.
	await page.goto('/practice');
	await page.goto('/practice/look-alikes');
	await page.goBack();
	await expect(page).toHaveURL(/\/practice$/);
});

test('Japanese: the kana sets with nothing studied; hidden romaji stay hidden', async ({ page, learner }) => {
	const ws = learner.workspaces.ja;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await learner.api.call('PUT', `/api/workspaces/${ws}`, { settings: { romanisation: { romaji: 'never' } } });

	await page.goto('/practice/look-alikes');
	await expect(page.getByText('What is this character?')).toBeVisible();
	const choices = page.getByRole('group', { name: 'Choose its meaning' });
	await expect(choices.getByRole('button').first()).toBeVisible();
	await expect(choices).not.toContainText(/[a-z]/);
	await expectNoSidewaysScroll(page, '/practice/look-alikes (kana)');
	await choices.getByRole('button').first().click();
	await expect(page.getByRole('list', { name: 'The characters of the set' })).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/look-alikes (kana answer)');
});
