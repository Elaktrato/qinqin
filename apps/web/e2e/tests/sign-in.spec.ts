// Flow 1: signing in (and out) through the real sign-in page.

import { expect, test } from '../support/fixtures';

test.use({ signedIn: false });

test('a learner signs in, lands on Home, and signs out again', async ({ page, learner }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);

	await page.getByLabel('Username').fill(learner.username);
	await page.getByLabel('Password').fill('not-the-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	// The error is a sentence from the error catalogue, never raw JSON (#168).
	await expect(page.getByRole('alert')).toContainText(/username or password/i);
	await expect(page).toHaveURL(/\/login$/);

	await page.getByLabel('Password').fill(learner.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	await expect(page.getByRole('searchbox', { name: /search/i }).or(page.getByPlaceholder(/search entries/i))).toBeVisible();

	// A reload keeps the session.
	await page.reload();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

	await page.getByRole('button', { name: /account/i }).click();
	await page.getByRole('menuitem', { name: /sign out/i }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
