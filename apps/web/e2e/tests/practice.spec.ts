// The Practice area (the drills framework) on a 360 px phone, with the sample drill behind the developer flag
// (localStorage "qinqin.dev.drills" = "sample"): Practice joins the navigation, the
// list, a round whose answers reach the server as drill.sample events, the result, the weakest round, and the back
// button out of a round. Without a drill for the language: practice-no-drill.spec.ts.

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test('the sample drill: a round, its answers on the server, the weakest round', async ({ page, learner }) => {
	await page.addInitScript((id) => {
		localStorage.setItem('qinqin.dev.drills', 'sample');
		// Japanese: the conjugation drill has no items there (the shared e2e pack has no parts of speech), so the
		// sample drill and the counter readings (#179) are the ones to practise; Chinese has the tone-pair drill's words.
		localStorage.setItem('qinqin.workspace', String(id));
	}, learner.workspaces.ja);
	await page.goto('/practice');
	// Japanese lists the counter drills too (#179): the sample drill's own entry.
	const sample = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Sample drill' }) });
	await expect(sample).toBeVisible();
	await expect(sample.getByText('5 new')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice');

	await sample.getByRole('link', { name: 'Practise', exact: true }).click();
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
