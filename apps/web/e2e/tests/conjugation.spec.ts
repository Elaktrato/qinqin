// The conjugation drill (#178) on a 360 px phone. This spec's server also holds a small JMdict-format pack
// (fixtures/conjugation: 書く, 高い with their parts of speech; no other spec sees it). The learner studies both
// words: Practice lists the drill, a round asks a due item to be produced (typed: Enter during an IME composition
// does not check, the field keeps its focus and Enter moves on) and a new item to be recognised, the answers reach
// the server as drill.conjugation events, the back button leaves the round, and Settings > Study > Conjugation
// switches a family on.

import { test as base, expect } from '../support/fixtures';
import { fixtureConjugation } from '../support/build';
import { ulid } from '../support/api';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { startServer, type RunningServer } from '../support/server';
import { addCards } from '../support/study';

const test = base.extend<object, { server: RunningServer }>({
	server: [
		async ({}, use, workerInfo) => {
			const server = await startServer(workerInfo.project.outputDir, `conjugation-w${workerInfo.workerIndex}`, { seed: fixtureConjugation });
			await use(server);
			await server.stop();
		},
		{ scope: 'worker', timeout: 60_000 }
	]
});

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const DAY = 86_400_000;

test('a conjugation round: produce through the IME, recognise, the answers on the server', async ({ page, learner }) => {
	const ws = learner.workspaces.ja;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await addCards(learner, 'ja', [
		{ kind: 'vocab', written: '書く', reviewedDaysAgo: 3 },
		{ kind: 'vocab', written: '高い', reviewedDaysAgo: 2 }
	]);
	const kaku = await learner.entryId('ja', '書く');
	// An answer of a month ago: 書く's past family is due, and asked as its second form (plain past negative).
	const ts = Date.now() - 30 * DAY;
	const seeded = ulid(ts);
	await learner.api.post('/api/sync/push', {
		events: [{ id: seeded, workspaceId: ws, device: 'e2e', ts: new Date(ts).toISOString(), type: 'drill.conjugation', payload: { item: `${kaku}:past`, mode: 'recognise', grade: 3 } }]
	});

	await page.goto('/practice');
	await expect(page.getByRole('heading', { level: 2, name: 'Conjugation' })).toBeVisible();
	// Within the conjugation drill (Japanese also lists the counter drills, #179, and the look-alike kana sets, #228).
	const drill = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Conjugation' }) });
	await expect(drill.getByText('9 new', { exact: true })).toBeVisible();
	await expect(drill.getByText('1 due', { exact: true })).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice with the conjugation drill');

	// Japanese lists the counter drills too (#179): the conjugation drill's own entry.
	await page
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { level: 2, name: 'Conjugation' }) })
		.getByRole('link', { name: 'Practise', exact: true })
		.click();
	await expect(page).toHaveURL(/\/practice\/conjugation$/);
	await expect(page.getByText('Question 1 of 10')).toBeVisible();
	await expect(page.getByText('書く', { exact: true })).toBeVisible();
	await expect(page.getByText('plain past negative (〜なかった)')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/conjugation (produce)');

	const field = page.getByLabel('Your answer');
	await expect(field).toBeFocused();
	await field.fill('かかなかった');
	// Enter that commits an IME composition never checks the answer.
	await field.evaluate((el) => {
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
	});
	const verdict = page.getByRole('status').filter({ hasText: /Right\.|Not quite/ });
	await expect(verdict).toHaveCount(0);
	await field.press('Enter');
	await expect(verdict).toHaveText(/Right\./);
	// The field keeps its focus (the phone keyboard stays up); Enter moves on.
	await expect(field).toBeFocused();
	await field.press('Enter');

	// A new item: recognised. 書く's polite family shows its first form.
	await expect(page.getByText('Question 2 of 10')).toBeVisible();
	await expect(page.getByText('Which form is this?')).toBeVisible();
	await expect(page.getByText('書きます')).toBeVisible();
	await page.getByRole('button', { name: 'polite (〜ます / 〜です)' }).click();
	await expect(verdict).toHaveText(/Right\./);
	await expectNoSidewaysScroll(page, '/practice/conjugation (recognise)');

	await expect
		.poll(async () =>
			(await learner.api.events(ws))
				.filter((e) => e.type === 'drill.conjugation' && e.id !== seeded)
				.map((e) => e.payload as { item: string; mode: string; grade: number })
				.sort((a, b) => a.item.localeCompare(b.item))
		)
		.toEqual([
			{ item: `${kaku}:past`, mode: 'produce', grade: 3 },
			{ item: `${kaku}:polite`, mode: 'recognise', grade: 3 }
		]);

	// The back button (the Android shell's too) leaves the round.
	await page.goBack();
	await expect(page).toHaveURL(/\/practice$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
});

test('Settings > Study > Conjugation switches a family on, and the drill offers it', async ({ page, learner }) => {
	const ws = learner.workspaces.ja;
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '書く', reviewedDaysAgo: 3 }]);
	await page.goto('/settings?tab=study');
	const passive = page.getByRole('checkbox', { name: 'Passive' });
	await expect(passive).not.toBeChecked();
	const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
	await passive.check();
	await saved;
	await expectNoSidewaysScroll(page, '/settings?tab=study with Conjugation');
	await page.goto('/practice');
	// 書く: the five beginner families and the passive.
	await expect(page.getByText('6 new')).toBeVisible();
});
