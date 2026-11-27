// Flow: the interface language per workspace (#297) at phone size. Settings → Workspaces → Interface language stores
// the current workspace's own language on the server (a merge patch of its settings) and mirrors it for the next
// start; "Use my account setting" clears it. English is the only catalogue today, so choosing it changes no text
// and needs no reload; the reload into another language is covered by the unit and layout tests with a fake
// catalogue (lib/i18n/interfaceLanguage.reload.test.ts, routes/layoutLanguage.dom.test.ts).

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const LABEL = 'Interface language in this workspace';

function saved(page: Page) {
	return page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
}

test('a workspace chooses its interface language and goes back to the account setting', async ({ page, learner }) => {
	const zh = learner.workspaces['zh'];
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), zh);
	await page.goto('/settings?tab=workspaces');
	const select = page.getByLabel(LABEL);
	await expect(select).toHaveValue('');
	await expect(select.locator('option').first()).toHaveText('Use my account setting (English)');
	await expectNoSidewaysScroll(page, 'Settings → Workspaces with the interface language');

	// Choose English: stored with the workspace and mirrored; the page keeps running (same catalogue, no reload).
	let navigations = 0;
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) navigations++;
	});
	await select.selectOption('en');
	const put = saved(page);
	await page.getByRole('button', { name: 'Save language' }).first().click();
	const body = (await put).request().postDataJSON();
	expect(body).toEqual({ settings: { interfaceLanguage: 'en' } });
	await expect.poll(() => page.evaluate((id) => localStorage.getItem(`qq.interfaceLanguage.workspace.${id}`), zh)).toBe('en');
	expect(navigations).toBe(0);
	const list = await learner.api.get<{ id: number; settings: Record<string, unknown> }[]>('/api/workspaces');
	expect(list.find((w) => w.id === zh)?.settings.interfaceLanguage).toBe('en');

	// A new start opens in it and shows the stored choice.
	await page.reload();
	await expect(page.getByLabel(LABEL)).toHaveValue('en');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	// Back to the account setting: the key is removed, and so is the mirror.
	await page.getByLabel(LABEL).selectOption('');
	const cleared = saved(page);
	await page.getByRole('button', { name: 'Save language' }).first().click();
	expect((await cleared).request().postDataJSON()).toEqual({ settings: { interfaceLanguage: null } });
	await expect.poll(() => page.evaluate((id) => localStorage.getItem(`qq.interfaceLanguage.workspace.${id}`), zh)).toBeNull();
	const after = await learner.api.get<{ id: number; settings: Record<string, unknown> }[]>('/api/workspaces');
	expect(after.find((w) => w.id === zh)?.settings).not.toHaveProperty('interfaceLanguage');
});
