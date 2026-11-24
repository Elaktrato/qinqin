// Extra flow: open registration and create an account in the browser.

import { randomBytes } from 'node:crypto';
import { ADMIN } from '../support/build';
import { expect, test } from '../support/fixtures';

test.use({ signedIn: false });

test('with registration open, a newcomer creates an account and lands on Home', async ({ page, admin }) => {
	await admin.call('PATCH', '/api/admin/settings/auth', { registration: 'open', currentPassword: ADMIN.password });
	const username = `newcomer-${randomBytes(4).toString('hex')}`;

	await page.goto('/register');
	await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password', { exact: true }).fill(`e2e-${randomBytes(8).toString('hex')}-Pw!`);
	await page.getByRole('button', { name: 'Create account' }).click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	const { users } = await admin.get<{ users: { username: string }[] }>('/api/admin/users');
	expect(users.map((u) => u.username)).toContain(username);
});
