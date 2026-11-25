// Touch suite (#37): the writing pad and the tone pad under REAL touches. The strokes go through Android's input
// subsystem (adb shell input swipe / motionevent) over the pad's on-screen position (from DevTools), so the
// WebView gets what a finger sends: pointer events of type touch, the gesture recogniser's view of a drag, the
// system back-gesture zones. Checked per pad: touch-action none, the pad received pointerdown/move/up and no
// pointercancel, the page did not scroll, no text selection and no context menu appeared, and the stroke was
// judged (the outline of the stroke turns filled; the tone pad's label names the tone). Finally an informational
// probe of the screen edge (the back gesture zone) is recorded.
import { adb, screenshot, sleep, waitFor } from '../lib.mjs';
import { addCards, useLearner } from './common.mjs';
import { bodyText, calibrate, click, clickNamed, find, resumedActivity, stroke, swipe, waitText, where, NAV } from '../page.mjs';

/** Counters on one element and on the page, read with read(). */
const INSTRUMENT = (sel) => `(() => {
	const el = document.querySelector(${JSON.stringify(sel)});
	const c = { down: 0, move: 0, up: 0, cancel: 0, types: [], contextmenu: 0, selectionchange: 0, scrolls: 0, touchmovePrevented: 0 };
	window.__t = c;
	for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => { c[t === 'pointerdown' ? 'down' : t === 'pointermove' ? 'move' : t === 'pointerup' ? 'up' : 'cancel']++; if (!c.types.includes(e.pointerType)) c.types.push(e.pointerType); }, true);
	document.addEventListener('contextmenu', () => c.contextmenu++, true);
	document.addEventListener('selectionchange', () => c.selectionchange++, true);
	addEventListener('scroll', () => c.scrolls++, true);
	return { touchAction: getComputedStyle(el).touchAction, userSelect: getComputedStyle(el).userSelect, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY, scrollY: scrollY };
})()`;
const READ = `({ ...window.__t, selection: String(getSelection()), scrollY })`;

const padBox = (cdp, sel) =>
	cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);

async function chip(ctx, label) {
	await click(ctx.cdp, find.named(label, '[role=dialog] label, [role=dialog] [role=checkbox], [role=dialog] button'));
}
async function savedTypes(user, language) {
	const rows = await user.api(`/api/rows?workspace=${user.ws[language]}&prefix=study-setup`);
	return rows.find((r) => r.key === 'study-setup')?.data?.cardTypes ?? null;
}

export async function run(ctx) {
	const { rec, num } = ctx;
	const C = ctx.learners.C;
	let cal = null;

	await rec.step('touch: sign in as the learner, seed 十 (ja) and 学习 (zh), calibrate adb touch to the page', async () => {
		await useLearner(ctx, C);
		await addCards(C, 'ja', [{ kind: 'vocab', written: '十' }]);
		await addCards(C, 'zh', [{ kind: 'vocab', written: '学习' }]);
		await sleep(800);
		cal = await calibrate(ctx.cdp);
		num.touchCalibration = cal;
		return cal;
	});
	if (rec.suiteFailed()) return;

	await rec.step('writing pad: two strokes by finger (a swipe and a held multi-point path); each is judged, nothing scrolls or selects', async () => {
		await ctx.cdp.eval("location.assign('/study')");
		await waitFor('the study dialog', () => ctx.cdp.eval(`!!(${find.dialog('Study')})`), { timeout: 40_000 });
		await chip(ctx, 'Writing');
		await waitFor('the writing chip saved', async () => (await savedTypes(C, 'ja'))?.includes('writing'), { timeout: 20_000, interval: 500 });
		await clickNamed(ctx.cdp, 'Start studying');
		let padFound = false;
		for (let i = 0; i < 6 && !padFound; i++) {
			const s = await waitFor('a card', async () => ((await ctx.cdp.eval('!!document.querySelector("canvas.ink")')) ? 'pad' : (await ctx.cdp.eval(`!!(${find.named('Show answer')})`)) ? 'card' : /Session complete/.test(await bodyText(ctx.cdp)) ? 'done' : null), { timeout: 30_000, interval: 300 });
			if (s === 'pad') padFound = true;
			else if (s === 'card') {
				await clickNamed(ctx.cdp, 'Show answer');
				await click(ctx.cdp, find.named('Good'));
			} else break;
		}
		if (!padFound) throw new Error('no writing card appeared');
		await waitFor('the outlines', () => ctx.cdp.eval('document.querySelectorAll(".pad path.outline").length === 2'), { timeout: 15_000 });
		await sleep(600);
		const before = await ctx.cdp.eval(INSTRUMENT('canvas.ink'));
		const box = await padBox(ctx.cdp, 'canvas.ink');
		await sleep(400);
		const b = await padBox(ctx.cdp, 'canvas.ink');
		const at = (fx, fy) => ({ x: b.x + b.w * fx, y: b.y + b.h * fy });
		const filled = () => ctx.cdp.eval('document.querySelectorAll(".pad path.outline.filled").length');
		screenshot('touch-01-writing-pad-before');
		// Stroke 1: the horizontal bar, left to right, one adb swipe.
		swipe(cal, at(0.14, 0.454), at(0.86, 0.454), 350);
		await waitFor('stroke 1 judged', async () => (await filled()) === 1, { timeout: 8000, interval: 200 });
		await sleep(300);
		// Stroke 2: the vertical, top to bottom, a path of several points held down (the page scrolls on such a drag unless the pad owns it).
		stroke(cal, [at(0.503, 0.117), at(0.503, 0.3), at(0.503, 0.5), at(0.503, 0.7), at(0.503, 0.8)]);
		await waitFor('stroke 2 judged', async () => (await filled()) === 2, { timeout: 8000, interval: 200 });
		const t = await ctx.cdp.eval(READ);
		screenshot('touch-02-writing-pad-after');
		const problems = [];
		if (before.touchAction !== 'none') problems.push(`touch-action ${before.touchAction}`);
		if (t.down < 2 || t.up < 2) problems.push(`pointer events: ${JSON.stringify(t)}`);
		if (t.cancel > 0) problems.push(`pointercancel fired ${t.cancel} times`);
		if (!t.types.every((x) => x === 'touch')) problems.push(`pointer types ${t.types}`);
		if (t.scrollY !== before.scrollY || t.scrolls > 0) problems.push(`the page scrolled during the strokes (${t.scrolls} scroll events)`);
		if (t.selection !== '' || t.contextmenu > 0) problems.push(`selection "${t.selection}" / context menu ${t.contextmenu}`);
		num.writingPad = { box: b, before, events: t, strokesJudged: await filled() };
		if (problems.length > 0) throw new Error(problems.join('; '));
		void box;
		// The card completes: its grade buttons appear and grading it reaches the server.
		await waitFor('the answer side', () => ctx.cdp.eval(`!!(${find.named('Good')})`), { timeout: 15_000 });
		await click(ctx.cdp, find.named('Good'));
		const ev = await waitFor('the writing review on the server', async () => {
			const out = [];
			const page = await C.api(`/api/events?limit=200&workspace=${C.ws.ja}`);
			out.push(...page.events.filter((e) => e.type === 'review'));
			return out.some((e) => /writing/.test(`${e.payload.mode} ${e.payload.cardId}`)) ? out : null;
		}, { timeout: 45_000, interval: 1000 });
		return { ...num.writingPad, writingReviews: ev.filter((e) => /writing/.test(`${e.payload.mode} ${e.payload.cardId}`)).length };
	});

	await rec.step('tone pad: a finger swipe up and to the right sets tone 2 on both pads; Check marks it right', async () => {
		await ctx.cdp.eval("location.assign('/')");
		await waitFor('Home', () => ctx.cdp.eval(`!!${NAV}`), { timeout: 30_000 });
		await clickNamed(ctx.cdp, 'Workspace:');
		await click(ctx.cdp, find.named('Chinese', '[role=menuitemradio], [role=menuitem]'));
		await waitFor('the Chinese workspace', () => ctx.cdp.eval(`!!(${find.named('Workspace: Chinese')})`), { timeout: 15_000 });
		await ctx.cdp.eval("location.assign('/study')");
		await waitFor('the study dialog', () => ctx.cdp.eval(`!!(${find.dialog('Study')})`), { timeout: 40_000 });
		await chip(ctx, 'Tone');
		await waitFor('the tone chip saved', async () => (await savedTypes(C, 'zh'))?.includes('tone'), { timeout: 20_000, interval: 500 });
		await clickNamed(ctx.cdp, 'Start studying');
		let found = false;
		for (let i = 0; i < 6 && !found; i++) {
			const s = await waitFor('a card', async () => ((await ctx.cdp.eval('document.querySelectorAll("ol.syllables .pad").length')) > 0 ? 'tone' : (await ctx.cdp.eval(`!!(${find.named('Show answer')})`)) ? 'card' : /Session complete/.test(await bodyText(ctx.cdp)) ? 'done' : null), { timeout: 30_000, interval: 300 });
			if (s === 'tone') found = true;
			else if (s === 'card') {
				await clickNamed(ctx.cdp, 'Show answer');
				await click(ctx.cdp, find.named('Good'));
			} else break;
		}
		if (!found) throw new Error('no tone card appeared');
		await sleep(500);
		const inst = await ctx.cdp.eval(INSTRUMENT('ol.syllables .pad'));
		// All pads: counters on the list catch events bubbling from each pad.
		await ctx.cdp.eval(`(() => { const c = window.__t; const ol = document.querySelector('ol.syllables'); for (const t of ['pointerdown', 'pointerup', 'pointercancel']) ol.addEventListener(t, (e) => { c[t === 'pointerdown' ? 'down' : t === 'pointerup' ? 'up' : 'cancel']++; }, true); c.down = c.up = c.cancel = c.move = 0; })()`);
		const count = await ctx.cdp.eval('document.querySelectorAll("ol.syllables .pad").length');
		const labelsBefore = await ctx.cdp.eval('[...document.querySelectorAll("ol.syllables .pad")].map((p) => p.getAttribute("aria-label"))');
		for (let i = 0; i < count; i++) {
			const b = await ctx.cdp.eval(`(() => { const el = document.querySelectorAll('ol.syllables .pad')[${i}]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
			await sleep(400);
			const bb = await ctx.cdp.eval(`(() => { const r = document.querySelectorAll('ol.syllables .pad')[${i}].getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
			void b;
			swipe(cal, { x: bb.x + bb.w * 0.15, y: bb.y + bb.h * 0.75 }, { x: bb.x + bb.w * 0.85, y: bb.y + bb.h * 0.2 }, 300);
			await sleep(500);
		}
		const labelsAfter = await ctx.cdp.eval('[...document.querySelectorAll("ol.syllables .pad")].map((p) => p.getAttribute("aria-label"))');
		const t = await ctx.cdp.eval(READ);
		screenshot('touch-03-tone-pad');
		const problems = [];
		if (inst.touchAction !== 'none') problems.push(`touch-action ${inst.touchAction}`);
		if (t.down < count || t.up < count) problems.push(`pointer events ${JSON.stringify(t)}`);
		if (t.cancel > 0) problems.push(`pointercancel ${t.cancel}`);
		if (t.scrolls > 0 || t.scrollY !== inst.scrollY) problems.push('the page scrolled');
		if (t.selection !== '' || t.contextmenu > 0) problems.push('selection or context menu');
		if (labelsAfter.some((l, i) => l === labelsBefore[i])) problems.push(`labels did not change: ${JSON.stringify(labelsAfter)}`);
		num.tonePad = { pads: count, labelsBefore, labelsAfter, events: t };
		if (problems.length > 0) throw new Error(problems.join('; '));
		await clickNamed(ctx.cdp, 'Check');
		await waitText(ctx.cdp, /Correct!/, { timeout: 10_000 });
		return num.tonePad;
	});

	await rec.step('screen edge: where a stroke starting at the very edge goes (informational: gesture zones recorded)', async () => {
		const mode = adb(['shell', 'cmd', 'overlay', 'list', '--user', '0', 'android'], { soft: true }).split('\n').filter((l) => /navbar|navigation/i.test(l)).join(' ').slice(0, 200);
		await ctx.cdp.eval(`(() => {
			const d = document.createElement('div'); d.id = '__edge'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none';
			const c = { down: 0, move: 0, up: 0, cancel: 0, firstX: null, lastX: null }; window.__edge = c;
			for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) d.addEventListener(t, (e) => { c[t === 'pointerdown' ? 'down' : t === 'pointermove' ? 'move' : t === 'pointerup' ? 'up' : 'cancel']++; if (c.firstX === null) c.firstX = e.clientX; c.lastX = e.clientX; }, true);
			document.body.appendChild(d);
		})()`);
		const probe = async (label, x1, x2) => {
			await ctx.cdp.eval('(() => { const c = window.__edge; c.down = c.move = c.up = c.cancel = 0; c.firstX = c.lastX = null; })()');
			const y = Math.round(cal.size.sh ? cal.size.sh * cal.dpr * 0.5 : 1200);
			adb(['shell', 'input', 'swipe', String(x1), String(y), String(x2), String(y), '300'], { soft: true });
			await sleep(1200);
			const front = resumedActivity().includes(ctx.PKG);
			const c = await ctx.cdp.eval('window.__edge').catch(() => null);
			if (!front) ctx.launch();
			return { label, startedAtScreenX: x1, appStayedInFront: front, ...c };
		};
		const res = [];
		res.push(await probe('left edge, 3 px', 3, 500));
		res.push(await probe('left, 40 px in', 40, 500));
		res.push(await probe('right edge, 3 px', cal.size.sw * cal.dpr - 3, cal.size.sw * cal.dpr - 500));
		await ctx.cdp.eval('document.getElementById("__edge")?.remove()').catch(() => {});
		num.edgeGestures = { navigation: mode, probes: res };
		return num.edgeGestures;
	});
	void where;
}
