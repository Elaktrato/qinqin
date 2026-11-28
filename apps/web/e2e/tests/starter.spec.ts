// Flow: Starter mode (#214). A new word shows as its romaji first, not its script; the answer is the normal one;
// switching Starter mode off shows the card as it always was (a display rule, no history lost). The picture needs an
// images pack, which the e2e instance does not install, so the stages that show a picture are covered by the dom tests.
// At phone width, Home and Settings offer the whole set of about 150 words (#275) without scrolling sideways.

import { expect, seedRandom, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { addCards } from '../support/study';

async function openSession(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/study');
	await page.getByRole('dialog', { name: 'Study' }).getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
}

test('a new word shows romaji first, and switching Starter mode off shows the normal card', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '私' }]);
	await seedRandom(page, 214);

	// Settings → Study → Starter mode: on, for every vocabulary card.
	await page.goto('/settings?tab=study');
	const saved = () => page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
	let wait = saved();
	await page.getByTestId('starter-enabled').check();
	await wait;
	wait = saved();
	await page.getByLabel('Applies to').selectOption('all');
	await wait;
	await expect(page.getByLabel('Applies to')).toHaveValue('all');

	await openSession(page);
	const front = page.getByTestId('starter-front');
	await expect(front).toBeVisible();
	await expect(front).not.toContainText('私');
	await expect(front).not.toContainText('わたし');
	await expect(front).toHaveAttribute('data-placement', 'none');

	await page.getByRole('button', { name: 'Show answer' }).click();
	await expect(page.getByRole('group', { name: 'Grade this card' })).toBeVisible();

	// Off: the same card is the normal card.
	await page.goto('/settings?tab=study');
	wait = saved();
	await page.getByTestId('starter-enabled').uncheck();
	await wait;
	await openSession(page);
	await expect(page.getByTestId('starter-front')).toHaveCount(0);
	await expect(page.locator('.face-prompt')).toContainText('私');
});

test('the Starter offer on Home is quiet once the workspace has a card', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '私' }]);
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByTestId('starter-offer')).toHaveCount(0);
});

test.describe('at phone width', () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

	test('Starter mode offers the full set of about 150 words (#275)', async ({ page, learner }) => {
		const sets = await learner.api.get<{ language: string; wordCount: number; humanReviewed: boolean }[]>('/api/starter-sets');
		for (const language of ['ja', 'zh']) {
			const set = sets.find((s) => s.language === language);
			expect(set?.wordCount, language).toBeGreaterThanOrEqual(140);
		}
		const ja = sets.find((s) => s.language === 'ja')!;
		const note = `${ja.wordCount} everyday words with pictures. Reviewed by agents acting as native-speaker teachers, not yet by a person.`;

		// Home offers it to the brand-new workspace, saying how large it is.
		await page.goto('/');
		const offer = page.getByTestId('starter-offer');
		await expect(offer).toBeVisible();
		await expect(offer.getByTestId('starter-set-note')).toHaveText(note);
		await expectNoSidewaysScroll(page, 'Home with the Starter offer');

		// Settings → Study offers the same set; adding it copies what the installed dictionaries have.
		await page.goto('/settings?tab=study');
		const add = page.getByTestId('starter-add');
		await expect(add.getByTestId('starter-set-note')).toHaveText(note);
		await expectNoSidewaysScroll(page, 'Settings, Study with the Starter words');
		await add.getByRole('button', { name: 'Add the Starter words to my decks' }).click();
		await expect(add.getByRole('status')).toContainText(/Added \d+ Starter words?\. Starter mode is on\./);
		await expectNoSidewaysScroll(page, 'Settings, Study after adding the Starter words');
	});
});
