// Performance suite (#37): a regression baseline for the shell on the CI emulator (software-rendered x86, so NOT
// phone numbers). Measured: cold start (am start -W and until the page has text; first run and offline come from
// the shell suite), the load timeline of Home, the card flip latency over a study session, five client-side route
// transitions, the JS heap after the session and a long chapter, and jank from `dumpsys gfxinfo` while a long
// reader chapter is scrolled with real swipes. Everything lands in summary.json (numbers.perf) and perf.json.
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, adb, sleep, waitFor } from '../lib.mjs';
import { addBook, addCards, useLearner } from './common.mjs';
import { calibrate, click, clickNamed, find, swipe, waitText, where } from '../page.mjs';

const WORDS = ['私', '学校', '行く', '飲む', '水', '本', '食べる', '読む'];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const stats = (a) => ({ n: a.length, min: Math.min(...a), median: median(a), max: Math.max(...a) });

function gfxinfo(pkg) {
	const out = adb(['shell', 'dumpsys', 'gfxinfo', pkg], { soft: true, timeout: 60_000 });
	const n = (re) => Number((out.match(re) || [])[1] ?? NaN);
	return {
		totalFrames: n(/Total frames rendered: (\d+)/),
		jankyFrames: n(/Janky frames: (\d+)/),
		jankyPercent: Number((out.match(/Janky frames: \d+ \(([\d.]+)%\)/) || [])[1] ?? NaN),
		p50ms: n(/50th percentile: (\d+)ms/),
		p90ms: n(/90th percentile: (\d+)ms/),
		p95ms: n(/95th percentile: (\d+)ms/),
		p99ms: n(/99th percentile: (\d+)ms/),
		missedVsync: n(/Number Missed Vsync: (\d+)/),
		slowUiThread: n(/Number Slow UI thread: (\d+)/),
		slowBitmapUploads: n(/Number Slow bitmap uploads: (\d+)/),
		slowDraw: n(/Number Slow issue draw commands: (\d+)/)
	};
}

export async function run(ctx) {
	const { rec, num } = ctx;
	const P = ctx.learners.P;
	const perf = (num.perf = {});

	await rec.step('perf: device, WebView, APK size', async () => {
		perf.disclaimer = 'CI emulator: software-accelerated x86 (swiftshader), no real GPU or phone SoC. A regression baseline, not phone numbers.';
		perf.device = { model: adb(['shell', 'getprop', 'ro.product.model'], { soft: true }), api: adb(['shell', 'getprop', 'ro.build.version.sdk'], { soft: true }), abi: adb(['shell', 'getprop', 'ro.product.cpu.abi'], { soft: true }) };
		const wv = adb(['shell', 'dumpsys', 'webviewupdate'], { soft: true, timeout: 30_000 });
		perf.webview = { package: (wv.match(/Current WebView package \(name, version\): \(([^,]+), ([^)]+)\)/) || []).slice(1, 3).join(' '), userAgentChrome: null };
		perf.apkBytes = process.env.E2E_APK ? statSync(process.env.E2E_APK).size : null;
		perf.memTotalKb = Number((adb(['shell', 'cat', '/proc/meminfo'], { soft: true }).match(/MemTotal:\s+(\d+)/) || [])[1] ?? NaN);
		return perf;
	});

	await rec.step('perf: sign in as the learner, seed eight cards and a long book', async () => {
		await useLearner(ctx, P);
		await addCards(P, 'ja', WORDS.map((written) => ({ kind: 'vocab', written })));
		const lines = ['私は学校に行きます。', '水を飲みます。', '学生は本を読みます。', '食べる前に手を洗います。', '今日はいい天気ですね。'];
		const paras = Array.from({ length: 400 }, (_, i) => `${i + 1}。${lines[i % lines.length].repeat(3)}`);
		P.bookId = await addBook(ctx, P, 'ja', '長い本', paras);
		return { bookId: P.bookId };
	});
	if (rec.failed) return;

	await rec.step('perf: cold start online (3 runs) and the load timeline of Home', async () => {
		const runs = [];
		for (let i = 0; i < 3; i++) {
			ctx.cdp.close();
			const c = await ctx.coldStart(`perf${i + 1}`);
			ctx.cdp = c.cdp;
			runs.push({ amStartTotalMs: c.totalTimeMs, amStartWaitMs: c.waitTimeMs, toRenderedPageMs: c.renderMs });
			await sleep(2500);
		}
		const timeline = await ctx.cdp.eval(`(async () => {
			const nav = performance.getEntriesByType('navigation')[0];
			const fcp = performance.getEntriesByName('first-contentful-paint')[0];
			const lcp = await new Promise((res) => { try { new PerformanceObserver((l) => res(l.getEntries().at(-1).startTime)).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => res(null), 1500); } catch { res(null); } });
			const longTasks = await new Promise((res) => { try { const out = []; new PerformanceObserver((l) => out.push(...l.getEntries().map((e) => e.startTime + e.duration))).observe({ type: 'longtask', buffered: true }); setTimeout(() => res(out), 800); } catch { res([]); } });
			return { domInteractive: Math.round(nav.domInteractive), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), loadEnd: Math.round(nav.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null, lcp: lcp === null ? null : Math.round(lcp), lastLongTaskEnd: longTasks.length ? Math.round(Math.max(...longTasks)) : 0 };
		})()`);
		perf.coldStart = {
			firstRun: num.coldStart_firstRun ?? null,
			onlineRuns: runs,
			onlineMedianToRenderedMs: median(runs.map((r) => r.toRenderedPageMs)),
			onlineMedianAmStartMs: median(runs.map((r) => r.amStartTotalMs)),
			offline: num.coldStart_offline ?? null
		};
		perf.homeTimeline = { ...timeline, note: 'ms since navigation start; tti proxy = max(lcp, lastLongTaskEnd)', ttiProxyMs: Math.max(timeline.lcp ?? 0, timeline.lastLongTaskEnd) };
		return { coldStart: perf.coldStart, homeTimeline: perf.homeTimeline };
	});

	await rec.step('perf: study card flip latency (click to second frame) over eight cards', async () => {
		await ctx.cdp.eval("location.assign('/study')");
		await clickNamed(ctx.cdp, 'Start studying', { timeout: 40_000 });
		const flips = [];
		for (let i = 0; i < WORDS.length; i++) {
			await waitFor('the card', () => ctx.cdp.eval(`!!(${find.named('Show answer')})`), { timeout: 20_000, interval: 250 });
			await sleep(400);
			const ms = await ctx.cdp.eval(`(async () => {
				const b = ${find.named('Show answer')};
				const t0 = performance.now();
				b.click();
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				const t1 = performance.now();
				return t1 - t0;
			})()`);
			flips.push(Math.round(ms));
			await click(ctx.cdp, find.named('Good'));
		}
		await waitText(ctx.cdp, /Session complete/, { timeout: 20_000 });
		perf.cardFlipMs = stats(flips);
		perf.cardFlipSamples = flips;
		return perf.cardFlipMs;
	});

	await rec.step('perf: five client-side route transitions through the bottom bar (click to second frame with content)', async () => {
		await ctx.cdp.eval("location.assign('/')");
		await waitFor('Home', () => ctx.cdp.eval(`!!document.querySelector('nav[aria-label=Main]')`), { timeout: 30_000 });
		await sleep(1500);
		const hops = [['Decks', '/flashcards'], ['Reader', '/reader'], ['Search', '/search'], ['Home', '/'], ['Reader', '/reader']];
		const times = {};
		for (const [label, path] of hops) {
			await ctx.cdp.eval(`(() => {
				window.__nav = {};
				addEventListener('click', () => { __nav.t0 = performance.now(); }, { capture: true, once: true });
				const tick = () => {
					if (location.pathname === ${JSON.stringify(path)} && (document.querySelector('main, h1')?.innerText || '').trim().length > 0) requestAnimationFrame(() => requestAnimationFrame(() => { __nav.t1 = performance.now(); }));
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			})()`);
			await click(ctx.cdp, find.named(label, 'nav[aria-label=Main] a'));
			const t = await waitFor(`the transition to ${path}`, () => ctx.cdp.eval('window.__nav.t1 && window.__nav.t0 ? Math.round(window.__nav.t1 - window.__nav.t0) : null'), { timeout: 15_000, interval: 150 });
			(times[`${label} (${path})`] ||= []).push(t);
			await sleep(700);
		}
		perf.routeTransitionsMs = times;
		return times;
	});

	await rec.step('perf: a long reader chapter: load time, heap, and jank while scrolling with real swipes', async () => {
		const t0 = Date.now();
		await ctx.cdp.eval(`location.assign('/reader/book/${P.bookId}/0')`);
		await waitText(ctx.cdp, /1。私は学校に行きます/, { timeout: 60_000 });
		const loadMs = Date.now() - t0;
		await sleep(1500);
		const cal = await calibrate(ctx.cdp);
		const height = cal.size.h;
		adb(['shell', 'dumpsys', 'gfxinfo', ctx.PKG, 'reset'], { soft: true });
		const x = cal.size.w / 2;
		const scrollsBefore = await ctx.cdp.eval('Math.max(scrollY, ...[...document.querySelectorAll("*")].map((e) => e.scrollTop))');
		for (let i = 0; i < 14; i++) {
			swipe(cal, { x, y: height * 0.75 }, { x, y: height * 0.25 }, 220);
			await sleep(250);
		}
		await sleep(600);
		const frames = gfxinfo(ctx.PKG);
		const scrolled = await ctx.cdp.eval('Math.max(scrollY, ...[...document.querySelectorAll("*")].map((e) => e.scrollTop))');
		await ctx.cdp.send('Performance.enable').catch(() => {});
		const metrics = await ctx.cdp.send('Performance.getMetrics').catch(() => null);
		const m = Object.fromEntries((metrics?.metrics || []).map((e) => [e.name, e.value]));
		const heap = await ctx.cdp.eval('performance.memory ? { usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1), limitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1) } : null');
		perf.longChapter = { paragraphs: 400, loadToTextMs: loadMs, scrolledPx: Math.round(scrolled - scrollsBefore), swipes: 14, domNodes: await ctx.cdp.eval('document.getElementsByTagName("*").length') };
		perf.jank = { ...frames, note: 'dumpsys gfxinfo of the app after reset + 14 swipes on the long chapter; software GL, so a baseline only' };
		perf.jsHeap = { afterSessionAndChapter: heap, performanceGetMetrics: { JSHeapUsedSize: m.JSHeapUsedSize ?? null, JSHeapTotalSize: m.JSHeapTotalSize ?? null, Nodes: m.Nodes ?? null, Documents: m.Documents ?? null } };
		perf.processMemory = adb(['shell', 'dumpsys', 'meminfo', ctx.PKG], { soft: true, timeout: 30_000 }).split('\n').filter((l) => /TOTAL|Java Heap|Native Heap/.test(l)).slice(0, 3).map((l) => l.trim().replace(/\s+/g, ' '));
		if (perf.longChapter.scrolledPx <= 0) throw new Error('the swipes did not scroll the chapter');
		return { longChapter: perf.longChapter, jank: perf.jank, jsHeap: perf.jsHeap };
	});

	await rec.step('perf: write perf.json', async () => {
		writeFileSync(join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
		return { keys: Object.keys(perf) };
	});
	void where;
}
