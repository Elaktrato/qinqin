// Flow: Starter mode (#214). A new word shows as its romaji first, not its script; the answer is the normal one;
// switching Starter mode off shows the card as it always was (a display rule, no history lost). The picture needs an
// images pack, which the e2e instance does not install, so the stages that show a picture are covered by the dom tests.

import { expect, seedRandom, test } from '../support/fixtures';
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
