// No page scrolls sideways on a phone (#296): every main page, every
// Settings tab and every Admin section at 360 × 740, as a learner with
// cards and a book (and as the administrator for Data and Admin), and the
// Data tab with a pack whose id, attribution and package line are 120
// characters without a space. A planted overflow fails the guard, so the
// guard cannot pass vacuously. A new screen adds its path here
// (docs/wiki/Development.md, "Phone width").

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll, sidewaysOverflow } from '../support/layout';
import { addBook, addCards } from '../support/study';
import { ulid } from '../support/api';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });
// Many pages per test: a longer hang backstop than the suite's 60 s.
test.describe.configure({ timeout: 120_000 });

/** The learner's Settings tabs (lib/settings/tabs.ts; Data and Admin are the administrator's). */
const LEARNER_TABS = ['workspaces', 'layout', 'appearance', 'study', 'features', 'notifications', 'ai', 'account'];
/** The Admin tab's sections (ADMIN_SECTIONS in lib/settings/tabs.ts). */
const ADMIN_SECTIONS = ['users', 'invites', 'email', 'security', 'backup', 'updates'];

/** A run of 120 characters with no break opportunity. */
const LONG = 'x'.repeat(120);

/** Opens a path and waits until it has its heading and the network is quiet. */
async function open(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	await page.waitForLoadState('networkidle');
}

async function check(page: Page, path: string): Promise<void> {
	await test.step(path, async () => {
		await open(page, path);
		await expectNoSidewaysScroll(page, path);
	});
}

test('every main page fits a 360 px phone', async ({ page, learner }) => {
	await addCards(learner, 'ja', [
		{ kind: 'vocab', written: '学校', reviewedDaysAgo: 3 },
		{ kind: 'reverse', written: '学校' },
		{ kind: 'vocab', written: '水' }
	]);
	await addCards(learner, 'zh', [{ kind: 'vocab', written: '你好', reviewedDaysAgo: 2 }]);
	const bookId = await addBook(learner, 'ja', '学校の本', ['私は学校に行きます。', '水を飲みます。']);
	const entry = await learner.entryId('ja', '学校');

	const paths = [
		'/',
		'/flashcards',
		'/study',
		'/study/scheduling',
		'/study/advanced',
		'/reader',
		`/reader/book/${bookId}/0`,
		'/search',
		`/search?q=${encodeURIComponent('学校')}`,
		`/entry/${entry}`,
		'/lookups',
		'/journal',
		'/grammar',
		'/scripts',
		'/practice',
		'/stats',
		'/stats/week',
		'/stats/characters',
		'/sources',
		'/account/password',
		...LEARNER_TABS.map((tab) => `/settings?tab=${tab}`)
	];
	for (const path of paths) await check(page, path);
});

test('the tone-pair drill fits a 360 px phone (#180)', async ({ page, learner }) => {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.zh);
	// One answer, so the grid shows a weak pair and the weakest round has an item.
	await learner.api.post('/api/events/batch', {
		events: [
			{
				id: ulid(Date.now()),
				workspaceId: learner.workspaces.zh,
				device: 'web',
				ts: new Date().toISOString(),
				type: 'drill.tone-pairs',
				payload: { item: '3-3', mode: 'mark', grade: 1 }
			}
		]
	});
	for (const path of ['/practice', '/practice/tone-pairs', '/practice/tone-pairs/weakest']) await check(page, path);
});

test.describe('signed out', () => {
	test.use({ signedIn: false });
	test('the sign-in and registration pages fit a 360 px phone', async ({ page }) => {
		for (const path of ['/login', '/register', '/reset']) await check(page, path);
	});
});

test('Settings → Data with a long pack, and every Admin section, fit a 360 px phone', async ({ page, admin }) => {
	// The administrator's session instead of the learner's, before the first page loads.
	await page.addInitScript((token) => localStorage.setItem('qinqin.token', token), admin.token);
	// One more pack in the server's real answers, 120 characters without a space in its id,
	// attribution and package line: installing it would change the worker's shared server.
	const packId = `e2e-${LONG}`;
	await page.route(/\/api\/admin\/packs$/, async (route) => {
		const response = await route.fetch();
		const packs = (await response.json()) as Record<string, unknown>[];
		packs.push({
			...packs[0],
			type: 'dictionary',
			packId,
			name: `Long ${LONG}`,
			license: `CC-BY-4.0 ${LONG}`,
			attribution: `https://example.org/${LONG}`
		});
		await route.fulfill({ response, json: packs });
	});
	await page.route(/\/api\/packages\?languages=all$/, async (route) => {
		const response = await route.fetch();
		const catalogue = (await response.json()) as { packages: Record<string, unknown>[] };
		const ready = catalogue.packages.find((p) => p.state === 'ready' && p.type === 'lexicon');
		expect(ready, 'the fixture builds a lexicon').toBeTruthy();
		const id = `lexicon.zh-${'x'.repeat(109)}`;
		catalogue.packages.push({
			...ready,
			id,
			url: `/api/packages/${id}/${ready!.revision}`,
			sources: [{ type: 'dictionary', packId, name: 'Long', version: '1', license: 'CC-BY-4.0', attribution: '', notice: '' }]
		});
		await route.fulfill({ response, json: catalogue });
	});

	await test.step('/settings?tab=data', async () => {
		await open(page, '/settings?tab=data');
		await expect(page.getByText(packId, { exact: true })).toBeVisible();
		await expect(page.getByText(`lexicon.zh-${'x'.repeat(109)}`)).toBeVisible();
		await expectNoSidewaysScroll(page, 'Settings → Data');
	});
	for (const section of ADMIN_SECTIONS) await check(page, `/settings?tab=admin&section=${section}`);
});

test('a planted overflow fails the guard', async ({ page }) => {
	await open(page, '/');
	expect((await sidewaysOverflow(page)).offenders, 'Home fits before anything is planted').toEqual([]);

	// A long unbroken string in a paragraph: its box fits, its text does not.
	await page.evaluate((long) => {
		const p = document.createElement('p');
		p.className = 'planted-text';
		p.textContent = long;
		document.querySelector('main')!.append(p);
	}, LONG.repeat(3));
	let report = await sidewaysOverflow(page);
	expect(report.offenders.join('\n')).toContain('planted');
	expect(report.scrollWidth).toBeGreaterThan(report.screenWidth);
	await expect(expectNoSidewaysScroll(page, 'planted text')).rejects.toThrow(/sticking out/);

	// A wide box under a root that hides sideways overflow: no page scroll, but the box sticks out.
	await page.evaluate(() => {
		document.querySelector('.planted-text')!.remove();
		document.documentElement.style.overflowX = 'hidden';
		document.body.style.overflowX = 'hidden';
		const box = document.createElement('div');
		box.className = 'planted-box';
		box.style.width = '600px';
		box.style.height = '10px';
		document.querySelector('main')!.append(box);
	});
	report = await sidewaysOverflow(page);
	expect(report.offenders.join('\n')).toContain('planted-box');

	// The same box in its own sideways-scrolling wrapper is allowed (a wide table's wrapper).
	await page.evaluate(() => {
		document.documentElement.style.overflowX = '';
		document.body.style.overflowX = '';
		const wrap = document.createElement('div');
		wrap.style.overflowX = 'auto';
		const box = document.querySelector('.planted-box')!;
		box.replaceWith(wrap);
		wrap.append(box);
	});
	await expectNoSidewaysScroll(page, 'a wide box in a scrolling wrapper');

	// An absolutely positioned label at the far end of that box escapes an unpositioned wrapper.
	await page.evaluate(() => {
		const box = document.querySelector<HTMLElement>('.planted-box')!;
		const label = document.createElement('span');
		label.className = 'planted-label';
		label.textContent = 'actions';
		label.style.cssText = 'position: absolute; width: 1px; height: 1px; overflow: hidden; margin-left: 590px';
		box.append(label);
	});
	report = await sidewaysOverflow(page);
	expect(report.offenders.join('\n')).toContain('planted-label');
	// A positioned wrapper is its containing block and bounds it.
	await page.evaluate(() => {
		document.querySelector<HTMLElement>('.planted-box')!.parentElement!.style.position = 'relative';
	});
	await expectNoSidewaysScroll(page, 'a label in a positioned scrolling wrapper');
});
