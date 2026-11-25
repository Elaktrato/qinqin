// Pages suite (#37): every route of the app at phone size in qinqin Day and qinqin Night, in the shell. For each
// page: a screenshot (the CI artifact android-emulator-*/pages-<theme>-<page>.png) and cheap invariants read
// through DevTools: no horizontal overflow, no uncaught error, the bottom bar covering nothing at the end of the
// page, header text not clipped, tap targets of the bar and the top bar at least 44 px (other small targets are
// listed in the summary, not failed). The theme is switched with the real control (Settings, Appearance).
import { screenshot, sleep, waitFor } from '../lib.mjs';
import { clickNamed, click, collectErrors, find, waitText } from '../page.mjs';
import { addBook, addCards, setMode, useLearner } from './common.mjs';

const SETTINGS_TABS = ['workspaces', 'layout', 'appearance', 'study', 'features', 'notifications', 'ai', 'account', 'data', 'admin'];
const ADMIN_SECTIONS = ['users', 'invites', 'email', 'security', 'backup', 'updates'];

/** Evaluated in the page after it settled: returns the invariants as numbers and lists. */
const INVARIANTS = `(() => {
	const de = document.documentElement;
	const bar = document.querySelector('nav[aria-label=Main]');
	const barBox = bar && bar.getClientRects().length ? bar.getBoundingClientRect() : null;
	const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')].filter((el) => el && el.scrollHeight > el.clientHeight + 40 && (el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY)));
	const sc = scrollers.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
	let covered = null;
	if (barBox) {
		if (sc) sc.scrollTop = sc.scrollHeight;
		const leaves = [...document.querySelectorAll('main *, #main *, body > div *')].filter((e) => !bar.contains(e) && e.children.length === 0 && e.getClientRects().length && e.textContent.trim() && getComputedStyle(e).position !== 'fixed');
		const lowest = leaves.map((e) => e.getBoundingClientRect().bottom).filter((b) => b > 0).sort((a, b) => b - a)[0];
		covered = lowest !== undefined && lowest > barBox.top + 1 ? Math.round(lowest - barBox.top) : 0;
		if (sc) sc.scrollTop = 0;
	}
	const clipped = [...document.querySelectorAll('header *, [role=banner] *, h1')].filter((e) => e.getClientRects().length && e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && getComputedStyle(e).textOverflow !== 'ellipsis').map((e) => e.textContent.trim().slice(0, 40));
	const small = (root) => [...root.querySelectorAll('a[href], button, [role=button], [role=tab]')].filter((e) => e.getClientRects().length).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44)).map(({ e, r }) => ({ name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }));
	const header = document.querySelector('header, [role=banner]');
	return {
		scrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth,
		scheme: de.dataset.scheme, covered, clipped,
		barSmall: bar ? small(bar) : [], headerSmall: header ? small(header) : [], otherSmall: small(document.body).length,
		textLength: document.body.innerText.trim().length
	};
})()`;

export async function run(ctx) {
	const { rec, num } = ctx;
	const B = ctx.learners.B;
	const fails = [];
	const smallTargets = {};
	let errors = [];

	await rec.step('pages: sign in as the learner, seed a book and cards', async () => {
		await useLearner(ctx, B);
		await addCards(B, 'ja', ['私', '学校'].map((written) => ({ kind: 'vocab', written }))).catch(() => {});
		B.bookId = B.bookId ?? (await addBook(ctx, B, 'ja', '学校の本', ['私は学校に行きます。', '水を飲みます。']));
		B.entryId = (await B.api(`/api/search?q=${encodeURIComponent('学校')}&lang=ja`)).find((h) => h.written === '学校')?.id;
		errors = await collectErrors(ctx.cdp);
		return { bookId: B.bookId, entryId: B.entryId };
	});
	if (rec.failed) return;

	const routes = () => [
		['home', '/'],
		['search', '/search'],
		['search-results', '/search?q=%E5%AD%A6%E6%A0%A1'],
		['search-parts', '/search/parts'],
		['entry', `/entry/${B.entryId}`],
		['lookups', '/lookups'],
		['flashcards', '/flashcards'],
		['study-advanced', '/study/advanced'],
		['study-scheduling', '/study/scheduling'],
		['reader', '/reader'],
		['reader-book', `/reader/book/${B.bookId}/0`],
		['reader-sources', '/reader/sources'],
		['journal', '/journal'],
		['journal-new', '/journal/new'],
		['grammar', '/grammar'],
		['stats', '/stats'],
		['stats-characters', '/stats/characters'],
		['stats-week', '/stats/week'],
		...SETTINGS_TABS.map((t) => [`settings-${t}`, `/settings?tab=${t}`]),
		...ADMIN_SECTIONS.map((s) => [`settings-admin-${s}`, `/settings?tab=admin&section=${s}`]),
		['sources', '/sources'],
		['account-password', '/account/password'],
		['account-two-factor', '/account/two-factor-setup']
	];

	/** Looks at the page as it is now: screenshot + invariants; records failures. */
	const inspect = async (theme, name) => {
		const before = errors.length;
		await sleep(1200); // fonts, widgets and the data of the page settle
		const inv = await ctx.cdp.eval(INVARIANTS);
		await sleep(150);
		screenshot(`pages-${theme}-${name}`);
		const problems = [];
		if (inv.scheme !== (theme === 'night' ? 'dark' : 'light')) problems.push(`scheme ${inv.scheme}`);
		if (inv.scrollWidth > inv.innerWidth || inv.bodyScrollWidth > inv.innerWidth) problems.push(`horizontal overflow ${Math.max(inv.scrollWidth, inv.bodyScrollWidth)} > ${inv.innerWidth}`);
		if (inv.covered > 0) problems.push(`the bottom bar covers the last content by ${inv.covered}px`);
		if (inv.clipped.length > 0) problems.push(`header text clipped: ${inv.clipped.join(' | ')}`);
		if (inv.barSmall.length > 0) problems.push(`bar targets under 44px: ${JSON.stringify(inv.barSmall)}`);
		if (inv.headerSmall.length > 0) smallTargets[`${theme}/${name}/header`] = inv.headerSmall;
		if (inv.textLength < 10) problems.push('the page is empty');
		const newErrors = errors.slice(before);
		if (newErrors.length > 0) problems.push(`errors: ${newErrors.slice(0, 3).join(' | ')}`);
		if (inv.otherSmall > 0) smallTargets[`${theme}/${name}`] = inv.otherSmall;
		if (problems.length > 0) fails.push(`${theme}/${name}: ${problems.join('; ')}`);
		return inv;
	};

	for (const theme of ['day', 'night']) {
		await rec.step(`pages (${theme}): switch the theme in Settings, Appearance`, async () => {
			const r = await setMode(ctx, theme === 'night' ? 'dark' : 'light', click);
			num[`pagesTheme_${theme}`] = r;
			screenshot(`pages-${theme}-0-settings-appearance-switched`);
			return r;
		});
		if (rec.failed) return;

		await rec.step(`pages (${theme}): every route`, async () => {
			const seen = [];
			for (const [name, url] of routes()) {
				try {
					await ctx.cdp.eval(`location.assign(${JSON.stringify(url)})`);
					await waitFor(`${name} to render`, async () => (await ctx.cdp.eval(`location.pathname + location.search`)).length > 0 && (await ctx.cdp.eval('document.readyState')) === 'complete' && (await ctx.cdp.eval('document.body.innerText.trim().length')) > 5, { timeout: 30_000, interval: 300 });
					await inspect(theme, name);
					seen.push(name);
				} catch (err) {
					fails.push(`${theme}/${name}: ${err.message}`);
				}
			}
			return { visited: seen.length, of: routes().length };
		});

		await rec.step(`pages (${theme}): overlays (More sheet, account menu, study modal, session card)`, async () => {
			const views = [];
			await ctx.cdp.eval("location.assign('/')");
			await waitFor('Home', () => ctx.cdp.eval(`!!document.querySelector('nav[aria-label=Main]')`), { timeout: 30_000 });
			await sleep(800);
			await click(ctx.cdp, find.named('More', 'nav[aria-label=Main] button'));
			await waitFor('the sheet', () => ctx.cdp.eval(`!!(${find.css('[role=dialog]')})`), { timeout: 10_000 });
			await inspect(theme, 'overlay-more-sheet');
			await ctx.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
			await ctx.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
			await sleep(500);
			await clickNamed(ctx.cdp, 'Account menu');
			await waitFor('the menu', () => ctx.cdp.eval(`!!(${find.css('[role=menu]')})`), { timeout: 10_000 });
			await inspect(theme, 'overlay-account-menu');
			views.push('more', 'account');
			await ctx.cdp.eval("location.assign('/study')");
			await waitFor('the study dialog', () => ctx.cdp.eval(`!!(${find.dialog('Study')})`), { timeout: 30_000 });
			await inspect(theme, 'overlay-study-modal');
			await clickNamed(ctx.cdp, 'Start studying');
			await waitText(ctx.cdp, /\d+ \/ \d+/, { timeout: 30_000 });
			await inspect(theme, 'study-session-front');
			await clickNamed(ctx.cdp, 'Show answer');
			await waitFor('the grades', () => ctx.cdp.eval(`!!(${find.named('Good')})`), { timeout: 10_000 });
			await inspect(theme, 'study-session-back');
			views.push('study-modal', 'session-front', 'session-back');
			return views;
		});
	}

	num.pagesSmallTargets = smallTargets;
	num.pagesCount = routes().length;
	await rec.step('pages: invariants held on every page in both themes', async () => {
		if (fails.length > 0) throw new Error(`${fails.length} problems:\n${fails.join('\n')}`);
		return { pages: routes().length, themes: 2 };
	});
}
