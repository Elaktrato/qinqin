// IME suite (#37): Chinese and Japanese composition in the places where Enter does something: the search box, a typing
// card and the journal editor (the lookup of a shared or selected text arrives at the search box, so it is the same
// field). The DevTools Input domain stands in for the keyboard: imeSetComposition is the underlined pre-edit text,
// insertText with a composition open commits it, and Enter during composition is sent the way Gboard and Samsung
// send it (key "Process", keyCode 229). Checked: the pre-edit string survives a re-render (the page waits and
// reflows while composing), Enter during composition does nothing, the committed text arrives whole (no lost or
// doubled characters), and Enter after the commit does what it should. The manual keyboards (Gboard Pinyin, Gboard
// Japanese, handwriting) are in docs/superpowers/checklists/android-ime.md.
import { screenshot, sleep, waitFor } from '../lib.mjs';
import { addCards, setCardTypes, useLearner } from './common.mjs';
import { bodyText, click, clickNamed, commit, compose, find, focusField, imeLog, press, waitText, watchIme, where } from '../page.mjs';

const value = (cdp, finder) => cdp.eval(`(${finder}).value`);

export async function run(ctx) {
	const { rec, num } = ctx;
	const D = ctx.learners.D;

	await rec.step('ime: sign in as the learner, seed one typing card (reverse)', async () => {
		await useLearner(ctx, D);
		await addCards(D, 'ja', [{ kind: 'vocab', written: '学校', reviewedDaysAgo: 30 }], ['reverse']);
		await setCardTypes(D, 'ja', ['reverse']);
		return { ws: D.ws };
	});
	if (rec.suiteFailed()) return;

	await rec.step('ime: search box - Enter during composition does not submit; commit then Enter searches', async () => {
		await ctx.cdp.eval("location.assign('/search')");
		const field = find.field('Search entries');
		await waitFor('the search box', () => ctx.cdp.eval(`!!(${field}) && !(${field}).disabled`), { timeout: 30_000 });
		await focusField(ctx.cdp, field);
		await watchIme(ctx.cdp);
		await compose(ctx.cdp, 'gakkou');
		await sleep(1200); // the page reflows meanwhile (workspace, widgets): the pre-edit text must stay
		const composing = await value(ctx.cdp, field);
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await compose(ctx.cdp, 'がっこう');
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await sleep(700);
		const w = await where(ctx.cdp);
		if (/q=/.test(w.search)) throw new Error(`Enter during composition submitted the search: ${w.href}`);
		const midLog = await imeLog(ctx.cdp);
		if (midLog.some((e) => e.t === 'compositionend')) {
			// DevTools' synthetic composition may be committed by the emulator's busy event loop: record it and let the
			// commit below start from an empty field (a real IME keeps the composition open until the person commits).
			num.imeSearchEarlyEnd = midLog;
			await ctx.cdp.eval(`(() => { const f = ${field}; f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
		}
		await commit(ctx.cdp, '学校');
		await sleep(300);
		const committed = await value(ctx.cdp, field);
		if (committed !== '学校') throw new Error(`committed text is "${committed}" (composing was "${composing}")`);
		if (/q=/.test((await where(ctx.cdp)).search)) throw new Error('committing a candidate submitted the search');
		await press(ctx.cdp, 'Enter');
		await waitFor('the search URL', async () => /q=/.test((await where(ctx.cdp)).search), { timeout: 15_000 });
		await waitText(ctx.cdp, /school/);
		screenshot('ime-01-search');
		const log = await imeLog(ctx.cdp);
		num.imeSearch = { composing, committed, events: log.map((e) => e.t + (e.isComposing === undefined ? '' : `:${e.isComposing}`)) };
		return num.imeSearch;
	});

	await rec.step('ime: typing card - Enter during composition does not check; commit then Enter checks', async () => {
		await ctx.cdp.eval("location.assign('/study')");
		await waitFor('the study dialog', () => ctx.cdp.eval(`!!(${find.dialog('Study')})`), { timeout: 40_000 });
		// The card is a vocab card studied in the Reverse mode: choose the chips as a person does (Reverse on, Vocab off).
		const chipScope = 'dialog label, dialog [role=checkbox], dialog button, [role=dialog] label, [role=dialog] [role=checkbox], [role=dialog] button';
		await click(ctx.cdp, find.named('Reverse', chipScope));
		await sleep(600);
		await click(ctx.cdp, find.named('Vocab', chipScope));
		await sleep(800);
		await clickNamed(ctx.cdp, 'Start studying', { timeout: 40_000 });
		const field = find.field('Type the word');
		await waitFor('the typing card', () => ctx.cdp.eval(`!!(${field})`), { timeout: 30_000 });
		await focusField(ctx.cdp, field);
		await watchIme(ctx.cdp);
		await compose(ctx.cdp, 'gakkou');
		await sleep(800);
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await compose(ctx.cdp, 'がっこう');
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await sleep(600);
		let text = await bodyText(ctx.cdp);
		if (/Correct|Not quite/.test(text)) throw new Error(`the card was checked during composition: ${text.slice(0, 200)}`);
		await commit(ctx.cdp, '学校');
		await sleep(300);
		const typed = await value(ctx.cdp, field);
		if (typed !== '学校') throw new Error(`typed text is "${typed}"`);
		if (/Correct|Not quite/.test(await bodyText(ctx.cdp))) throw new Error('committing a candidate checked the card');
		await press(ctx.cdp, 'Enter');
		await waitText(ctx.cdp, /Correct/, { timeout: 15_000 });
		screenshot('ime-02-typing-card');
		return { typed, imeEvents: (await imeLog(ctx.cdp)).length };
	});

	await rec.step('ime: journal editor - composition keeps its text, Enter during composition adds no line break, the text is saved whole', async () => {
		await ctx.cdp.eval("location.assign('/journal/new')");
		const field = find.field('Entry');
		await waitFor('the editor', () => ctx.cdp.eval(`!!(${field})`), { timeout: 30_000 });
		await focusField(ctx.cdp, field);
		await watchIme(ctx.cdp);
		await compose(ctx.cdp, 'jintian');
		await sleep(1000);
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await commit(ctx.cdp, '今天');
		await sleep(400);
		await compose(ctx.cdp, 'wo');
		await sleep(1500); // the editor autosaves while the composition is open: it must not rewrite the field
		const during = await value(ctx.cdp, field);
		await press(ctx.cdp, 'Enter', { vk: 229 });
		await commit(ctx.cdp, '我');
		await sleep(400);
		await compose(ctx.cdp, 'qu');
		await commit(ctx.cdp, '去了学校。');
		await sleep(400);
		const text = await value(ctx.cdp, field);
		if (text !== '今天我去了学校。') throw new Error(`the editor holds ${JSON.stringify(text)} (during composition: ${JSON.stringify(during)})`);
		await waitText(ctx.cdp, /Saved/, { timeout: 20_000 });
		const saved = await waitFor('the entry on the server', async () => {
			for (const ws of Object.values(D.ws)) {
				const list = await D.api(`/api/journal/entries?workspace=${ws}`);
				const hit = list.find((e) => e.text === '今天我去了学校。');
				if (hit) return hit;
			}
			return null;
		}, { timeout: 30_000, interval: 1000 });
		screenshot('ime-03-journal');
		return { during, text, savedId: saved.id };
	});
}
