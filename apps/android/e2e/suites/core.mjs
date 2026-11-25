// Core suite (#37): the paths a person uses every day, driven through the real UI of the app in the shell.
//   1. sign in on the sign-in page (a wrong password first), as a second learner;
//   2. a study session that goes BACK a card and regrades it; the server holds the replacement exactly once;
//   3. a reader lookup by a real touch (adb tap) on a word; the sheet shows the dictionary entry;
//   4. the bottom bar (phone layout, sections, More) and the Android back button: overlay first, then history,
//      then the app leaves to the background (it must not crash).
import { adb, appPid, connectPage, screenshot, sleep, waitFor } from '../lib.mjs';
import { back, bodyText, calibrate, click, clickNamed, collectErrors, find, focusField, resumedActivity, tap, typeText, waitText, where, NAV } from '../page.mjs';
import { addBook, addCards, apiLogin, resilient, reviewsOf } from './common.mjs';

const WORDS = ['私', '学校', '行く', '飲む'];

const cardWord = (cdp) => cdp.eval(`(${JSON.stringify(WORDS)}).find((w) => (document.querySelector('article')?.innerText || '').includes(w)) || null`);
const hasButton = (cdp, label) => cdp.eval(`!!(${find.named(label)})`);

export async function run(ctx) {
	const { rec, num } = ctx;
	const B = ctx.learners.B;
	let errors = [];

	await rec.step('core: seed the second learner (cards, a book) through the API', async () => {
		await apiLogin(ctx, B);
		const ids = await addCards(B, 'ja', WORDS.map((written) => ({ kind: 'vocab', written })));
		B.bookId = await addBook(ctx, B, 'ja', '学校の本', ['私は学校に行きます。', '水を飲みます。']);
		return { cards: ids.length, bookId: B.bookId, workspaces: B.ws };
	});
	if (rec.suiteFailed()) return;

	await rec.step('sign in: a wrong password is refused with a sentence, the right one lands on Home', async () => {
		await resilient(ctx, 'sign-out', async () => {
			ctx.cdp.eval("location.assign('/')").catch(() => {});
			await sleep(1500);
			await clickNamed(ctx.cdp, 'Account menu');
			await click(ctx.cdp, find.named('Sign out'));
		});
		await waitFor('the sign-in page', async () => (await where(ctx.cdp)).path === '/login', { timeout: 30_000 });
		screenshot('core-01-sign-in');
		await focusField(ctx.cdp, find.field('Username'));
		await typeText(ctx.cdp, B.username);
		await focusField(ctx.cdp, find.field('Password'));
		await typeText(ctx.cdp, 'not-the-password');
		await clickNamed(ctx.cdp, 'Sign in', { timeout: 10_000 });
		const alert = await waitFor('the error', () => ctx.cdp.eval(`document.querySelector('[role=alert]')?.innerText || ''`), { timeout: 20_000 });
		if (!/username or password/i.test(alert)) throw new Error(`error text: ${alert}`);
		if ((await where(ctx.cdp)).path !== '/login') throw new Error('left the sign-in page after a wrong password');
		await focusField(ctx.cdp, find.field('Password'));
		await ctx.cdp.eval('document.activeElement.select && document.activeElement.select()');
		await typeText(ctx.cdp, B.password);
		await clickNamed(ctx.cdp, 'Sign in', { timeout: 10_000 });
		await waitFor('Home', async () => (await where(ctx.cdp)).path === '/', { timeout: 30_000 });
		ctx.signedAs = B.username;
		await waitFor('the bar', () => ctx.cdp.eval(`!!${NAV}`), { timeout: 30_000 });
		errors = await collectErrors(ctx.cdp);
		screenshot('core-02-home');
		return { alert };
	});
	if (rec.suiteFailed()) return;

	await rec.step('study: grade a card, go BACK, regrade it; the server holds the replacement exactly once', async () => {
		await ctx.cdp.eval("location.assign('/study')");
		await clickNamed(ctx.cdp, 'Start studying', { timeout: 40_000 });
		await waitFor('the session', async () => (await where(ctx.cdp)).path === '/study/session', { timeout: 20_000 });
		const seen = [];
		const next = async () => {
			const s = await waitFor('a card or the end', async () => {
				if (/Session complete/.test(await bodyText(ctx.cdp))) return 'done';
				return (await hasButton(ctx.cdp, 'Show answer')) ? 'card' : null;
			}, { timeout: 30_000, interval: 250 });
			return s;
		};
		// Card 1: Again by mistake.
		if ((await next()) !== 'card') throw new Error('no first card');
		const first = await cardWord(ctx.cdp);
		if (!first) throw new Error('cannot read the first card');
		await clickNamed(ctx.cdp, 'Show answer');
		await click(ctx.cdp, find.named('Again'));
		seen.push(first);
		// Card 2 is current: go back to card 1 with the on-screen Back button.
		if ((await next()) !== 'card') throw new Error('no second card');
		const second = await cardWord(ctx.cdp);
		if (second === first) throw new Error('the next card is the same word');
		await click(ctx.cdp, find.named('Back to the card graded before'));
		await waitText(ctx.cdp, /Graded Again/);
		if ((await cardWord(ctx.cdp)) !== first) throw new Error('Back did not show the first card again');
		screenshot('core-03-regrade');
		await click(ctx.cdp, find.named('Good'));
		await waitFor('Graded Again to disappear', async () => !/Graded Again/.test(await bodyText(ctx.cdp)), { timeout: 15_000 });
		// Back on the card that was current, unanswered.
		if ((await next()) !== 'card' || (await cardWord(ctx.cdp)) !== second) throw new Error('did not return to the second card');
		// The rest: Good each.
		for (let n = 0; n < 8; n++) {
			const s = await next();
			if (s === 'done') break;
			seen.push(await cardWord(ctx.cdp));
			await clickNamed(ctx.cdp, 'Show answer');
			await click(ctx.cdp, find.named('Good'));
		}
		await waitText(ctx.cdp, /Session complete/);
		screenshot('core-04-session-done');
		// The server: one review per card plus one replacement that names the review it voids (events/review-replace.json).
		const reviews = await waitFor('the reviews on the server', async () => {
			const r = await reviewsOf(B, 'ja');
			return r.length >= WORDS.length + 1 ? r : null;
		}, { timeout: 45_000, interval: 1000 });
		const replacements = reviews.filter((r) => r.payload.replaces);
		const replaced = new Set(replacements.map((r) => r.payload.replaces));
		const counted = reviews.filter((r) => !replaced.has(r.id));
		const ids = new Set(reviews.map((r) => r.id));
		if (replacements.length !== 1 || replacements[0].payload.grade !== 3) throw new Error(`replacements: ${JSON.stringify(replacements.map((r) => r.payload))}`);
		if (ids.size !== reviews.length) throw new Error('a review id appears twice');
		if (reviews.length !== WORDS.length + 1 || counted.length !== WORDS.length || new Set(counted.map((r) => r.payload.cardId)).size !== WORDS.length) throw new Error(`${reviews.length} reviews, ${counted.length} counted`);
		const voided = reviews.find((r) => r.id === replacements[0].payload.replaces);
		if (!voided || voided.payload.grade !== 1 || voided.payload.cardId !== replacements[0].payload.cardId) throw new Error('the replaced review is not the Again on the same card');
		num.studyBack = { reviews: reviews.length, counted: counted.length, replacedGrade: voided.payload.grade, newGrade: replacements[0].payload.grade };
		await click(ctx.cdp, find.named('End session')).catch(() => {});
		return num.studyBack;
	});

	await rec.step('reader: a real tap on a word opens the sheet with its dictionary entry', async () => {
		await ctx.cdp.eval(`location.assign('/reader/book/${B.bookId}/0')`);
		await waitText(ctx.cdp, /私は学校に行きます/, { timeout: 40_000 });
		await sleep(800);
		const cal = await calibrate(ctx.cdp);
		num.touchCalibration = cal;
		const wordPoint = (ch) => ctx.cdp.eval(`(() => {
			const p = [...document.querySelectorAll('p, div, span')].find((e) => e.children.length === 0 && e.textContent.includes('私は学校に行きます'));
			p.scrollIntoView({ block: 'center' });
			const n = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
			const i = n.data.indexOf(${JSON.stringify(ch)});
			const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
			const b = r.getBoundingClientRect();
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		})()`);
		await wordPoint('学');
		await sleep(500); // the scroll settles
		const at2 = await wordPoint('学');
		tap(cal, at2);
		const sheet = await waitFor('the lookup sheet', () => ctx.cdp.eval(`(() => { const d = ${find.dialog('学校')}; return d ? d.innerText : ''; })()`), { timeout: 20_000, interval: 400 });
		screenshot('core-05-reader-lookup');
		if (!/がっこう/.test(sheet) || !/school/.test(sheet)) throw new Error(`sheet text: ${sheet.slice(0, 200)}`);
		const selection = await ctx.cdp.eval('String(getSelection())');
		return { sheet: sheet.slice(0, 120), selection };
	});

	await rec.step('back button: the lookup sheet closes first, the reader stays', async () => {
		const before = (await where(ctx.cdp)).path;
		back();
		await waitFor('the sheet to close', async () => !(await ctx.cdp.eval(`!!(${find.dialog('学校')})`)), { timeout: 10_000, interval: 300 });
		const after = (await where(ctx.cdp)).path;
		if (before !== after) throw new Error(`the page changed from ${before} to ${after}`);
		return { path: after };
	});

	await rec.step('bottom bar: phone layout, sections, More; edge to edge above the system bar', async () => {
		await ctx.cdp.eval("location.assign('/')");
		await waitFor('the bar', () => ctx.cdp.eval(`!!${NAV}`), { timeout: 30_000 });
		const bar = await ctx.cdp.eval(`(() => {
			const n = ${NAV}; const r = n.getBoundingClientRect();
			return { names: [...n.querySelectorAll('a')].map((a) => a.textContent.trim()), more: !![...n.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('More')), bottom: r.bottom, innerHeight, width: innerWidth };
		})()`);
		if (bar.names.slice(0, 3).join() !== 'Home,Decks,Reader') throw new Error(`bar items: ${JSON.stringify(bar)}`);
		if (!bar.more) throw new Error('no More button');
		if (bar.bottom > bar.innerHeight + 1) throw new Error(`the bar is below the viewport: ${bar.bottom} > ${bar.innerHeight}`);
		screenshot('core-06-home-bar');
		// Sections.
		await click(ctx.cdp, find.named('Reader', 'nav[aria-label=Main] a'));
		await waitFor('/reader', async () => (await where(ctx.cdp)).path === '/reader', { timeout: 20_000 });
		const current = await ctx.cdp.eval(`(${NAV}).querySelector('a[aria-current=page]')?.textContent.trim()`);
		if (current !== 'Reader') throw new Error(`current item: ${current}`);
		// More opens the sheet with the other sections.
		await click(ctx.cdp, find.named('More', 'nav[aria-label=Main] button'));
		await waitFor('the More sheet', () => ctx.cdp.eval(`!!(${find.css('dialog[open], [role=dialog]')}) && !!(${find.named('Stats', '[role=dialog] a')})`), { timeout: 10_000 });
		screenshot('core-07-more-sheet');
		return { ...bar, current };
	});

	await rec.step('back button: sheet, then menu, then dialog, then history, then the app leaves', async () => {
		const trail = [];
		const gone = (finder) => waitFor('the overlay to close', async () => !(await ctx.cdp.eval(`!!(${finder})`)), { timeout: 10_000, interval: 300 });
		// The More sheet is open: BACK closes it, the page stays.
		back();
		await gone(find.css('dialog[open], [role=dialog]'));
		trail.push(['more-sheet', (await where(ctx.cdp)).path]);
		if ((await where(ctx.cdp)).path !== '/reader') throw new Error(`BACK with the sheet open changed the page: ${JSON.stringify(trail)}`);
		// The account menu.
		await clickNamed(ctx.cdp, 'Account menu');
		await waitFor('the menu', () => ctx.cdp.eval(`!!(${find.css('[role=menu]')})`), { timeout: 10_000 });
		back();
		await gone(find.css('[role=menu]'));
		trail.push(['account-menu', (await where(ctx.cdp)).path]);
		if ((await where(ctx.cdp)).path !== '/reader') throw new Error(`BACK with the menu open changed the page: ${JSON.stringify(trail)}`);
		// A dialog: the study modal is a dialog over Home; BACK closes it and the page stays Home.
		await click(ctx.cdp, find.named('Home', 'nav[aria-label=Main] a'));
		await waitFor('/', async () => (await where(ctx.cdp)).path === '/', { timeout: 15_000 });
		await ctx.cdp.eval("location.href = '/study'").catch(() => {});
		await waitFor('the study dialog', () => ctx.cdp.eval(`!!(${find.dialog('Study')})`), { timeout: 30_000 });
		back();
		await gone(find.dialog('Study'));
		trail.push(['study-dialog', (await where(ctx.cdp)).path]);
		// History: Home -> Decks -> Reader; BACK twice returns to the page before Decks.
		await waitFor('the bar', () => ctx.cdp.eval(`!!${NAV}`), { timeout: 30_000 });
		await click(ctx.cdp, find.named('Decks', 'nav[aria-label=Main] a'));
		await waitFor('/flashcards', async () => (await where(ctx.cdp)).path === '/flashcards', { timeout: 15_000 });
		await click(ctx.cdp, find.named('Reader', 'nav[aria-label=Main] a'));
		await waitFor('/reader', async () => (await where(ctx.cdp)).path === '/reader', { timeout: 15_000 });
		back();
		await waitFor('history back to /flashcards', async () => (await where(ctx.cdp)).path === '/flashcards', { timeout: 10_000 });
		trail.push(['history-1', '/flashcards']);
		back();
		await waitFor('history back to a page before Decks', async () => (await where(ctx.cdp)).path !== '/flashcards', { timeout: 10_000 });
		trail.push(['history-2', (await where(ctx.cdp)).path]);
		// BACK until the history is used up: the app must leave to the background (alive, not crashed).
		for (let i = 0; i < 25 && resumedActivity().includes(ctx.PKG); i++) {
			back();
			await sleep(1000);
		}
		const top = resumedActivity();
		const alive = appPid();
		const crashed = /FATAL EXCEPTION[\s\S]{0,300}qinqin/.test(adb(['logcat', '-d', '-b', 'crash'], { soft: true }));
		if (top.includes(ctx.PKG)) throw new Error(`the app is still in front after BACK presses: ${top}`);
		if (crashed) throw new Error('the app crashed');
		if (!alive) throw new Error('the app process is gone (expected: moved to the background, alive)');
		trail.push(['leave', top]);
		// Bring it back; the page must still be there.
		ctx.cdp.close();
		ctx.launch();
		ctx.cdp = await connectPage(ctx.ORIGIN + '/', { timeout: 60_000 });
		await waitFor('the page after returning', async () => (await bodyText(ctx.cdp)).trim().length > 40, { timeout: 30_000 });
		return trail;
	});

	rec.numbers.coreErrors = errors.slice(0, 20);
	await rec.step('core: no uncaught page errors during the suite', async () => {
		if (errors.length > 0) throw new Error(errors.slice(0, 5).join(' | '));
	});
}
