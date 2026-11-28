// The Practice area (the drills framework) on a 360 px phone, with the sample drill behind the developer flag
// (localStorage "qinqin.dev.drills" = "sample"): Practice joins the navigation, the
// list, a round whose answers reach the server as drill.sample events, the result, the weakest round, and the back
// button out of a round. Without the flag, /practice says no drill applies and Practice is not in the bar.

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test('without a drill for the language, /practice answers and Practice stays out of the navigation', async ({ page, learner }) => {
	// Japanese: the tone-pair drill (#180) applies to Chinese only.
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.ja);
	await page.goto('/practice');
	await expect(page.getByText('No drills for this language yet.')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice (no drill)');
	const bar = page.getByRole('navigation', { name: 'Main' });
	await bar.getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Grammar' })).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Practice' })).toHaveCount(0);
});

test('the sample drill: a round, its answers on the server, the weakest round', async ({ page, learner }) => {
	await page.addInitScript(() => localStorage.setItem('qinqin.dev.drills', 'sample'));
	await page.goto('/practice');
	await expect(page.getByRole('heading', { level: 2, name: 'Sample drill' })).toBeVisible();
	await expect(page.getByText('5 new')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice');

	await page.getByRole('link', { name: 'Practise', exact: true }).click();
	await expect(page).toHaveURL(/\/practice\/sample$/);
	await expect(page.getByText('Question 1 of 5')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice/sample');
	const choices = ['I knew it', 'I did not', 'I knew it', 'I did not', 'I knew it'];
	for (const [i, choice] of choices.entries()) {
		await expect(page.getByText(`Question ${i + 1} of 5`)).toBeVisible();
		await page.getByRole('button', { name: choice }).click();
		const next = page.getByRole('button', { name: i === 4 ? 'See results' : 'Next' });
		await expect(next).toBeFocused();
		await next.click();
	}
	await expect(page.getByRole('heading', { name: 'Round done' })).toBeVisible();
	await expect(page.getByText('3 of 5 right')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the round result');

	// The five answers reached the server as drill.sample events.
	await expect
		.poll(async () => {
			const all = [...(await learner.api.events(learner.workspaces.ja)), ...(await learner.api.events(learner.workspaces.zh))];
			return all.filter((e) => e.type === 'drill.sample').map((e) => (e.payload as { grade: number }).grade).sort();
		})
		.toEqual([1, 1, 3, 3, 3]);

	await page.getByRole('link', { name: 'Back to the drills' }).click();
	await expect(page.getByText('Your 5 weakest items, from every drill.')).toBeVisible();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Practice' })).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('link', { name: 'Practise weakest' }).click();
	await expect(page).toHaveURL(/\/practice\/weakest$/);
	await expect(page.getByText('Question 1 of 5')).toBeVisible();
	// The items answered "I did not" come first.
	await expect(page.locator('.question .prompt')).toHaveText(/sample-(2|4)/);
	await expectNoSidewaysScroll(page, '/practice/weakest');

	// The back button (the Android shell's too) leaves the round.
	await page.goBack();
	await expect(page).toHaveURL(/\/practice$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
});
