<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { CharOutcome } from '$lib/exercises/writing';
	import { joinPaths } from '$lib/writing/geometry';
	import { appendInk, createPalmGate, morphPath, toPadUnit } from '$lib/writing/ink';
	import { matchStroke } from '$lib/writing/matcher';
	import { applyResult, hintsOf, outcomeOf, requestHint, startQuiz } from '$lib/writing/quiz';
	import type { CharStrokes, Pt } from '$lib/writing/strokes';

	interface Props {
		strokes: CharStrokes;
		onComplete: (outcome: CharOutcome, hints: number) => void;
		/** Incrementing triggers a reveal of the whole character. */
		revealSignal: number;
		/** Incrementing shows the next stroke briefly (one hint per step). */
		hintSignal: number;
		/** Label for the pad (the card knows the position in the word). */
		label: string;
		/** Live progress for the card's feedback line. */
		onChange?: (progress: { mistakes: number; remaining: number }) => void;
	}

	let { strokes, onComplete, revealSignal, hintSignal, label, onChange }: Props = $props();

	const SNAP_MS = 140;
	const MISS_MS = 250;
	const REVEAL_STEP_MS = 150;
	const GLOW_MS = 1000;

	// The quiz state is a plain variable on purpose: a fast writer's next
	// stroke is judged against the state the previous stroke produced, with
	// no wait for rendering or animation.
	let quiz = untrack(() => startQuiz(strokes.medians.length));
	let finished = $state(false);

	let filled = $state<number[]>([]);
	// The stroke traced after three misses on it (#287): dimmed, with its start, until it is drawn.
	let trace = $state<number | null>(null);
	let glow = $state<{ stroke: number; token: number } | null>(null);
	let glowToken = 0;

	let canvas: HTMLCanvasElement | null = null;
	let ctx: CanvasRenderingContext2D | null = null;
	let raf = 0;
	let dpr = 1;
	// Current side of the pad in CSS px, measured; the canvas backing store follows it. The pad takes its
	// container's width (lib/writing/padSize.ts sizes the container, #285).
	let side = 200;

	interface Fade {
		ink: Pt[];
		target: Pt[] | null;
		start: number;
		duration: number;
		color: string | null;
		/** Stay fully visible for the duration instead of fading (reduced motion). */
		hold?: boolean;
	}
	const acceptsDown = createPalmGate();
	let live: Pt[] = [];
	let activePointer: number | null = null;
	let fades: Fade[] = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();

	function reduced(): boolean {
		try {
			return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		} catch {
			return false;
		}
	}

	function later(fn: () => void, ms: number): void {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	}

	function stroke(ctx2: CanvasRenderingContext2D, pts: readonly Pt[], color: string, alpha: number): void {
		if (pts.length === 0) return;
		ctx2.globalAlpha = alpha;
		ctx2.strokeStyle = color;
		ctx2.beginPath();
		ctx2.moveTo(pts[0].x * side, pts[0].y * side);
		if (pts.length === 1) ctx2.lineTo(pts[0].x * side + 0.01, pts[0].y * side);
		for (let i = 1; i < pts.length; i++) ctx2.lineTo(pts[i].x * side, pts[i].y * side);
		ctx2.stroke();
	}

	function draw(now: number): void {
		raf = 0;
		if (ctx === null || canvas === null) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, side, side);
		// The ink follows the pad: 6 px at 200 px, as before #285.
		ctx.lineWidth = Math.max(4, side * 0.03);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		// Canvas cannot use var(): the ink reads the theme's tokens (#101).
		const style = getComputedStyle(canvas);
		const base = style.getPropertyValue('--accent').trim() || style.color;
		const miss = style.getPropertyValue('--bad').trim() || style.color;
		stroke(ctx, live, base, 1);
		fades = fades.filter((f) => now - f.start < f.duration);
		for (const f of fades) {
			const t = (now - f.start) / f.duration;
			if (f.target) {
				// Snap: the ink travels onto the reference stroke while it
				// fades; the outline fades in underneath via CSS.
				stroke(ctx, morphPath(f.ink, f.target, t), base, 1 - t);
			} else {
				stroke(ctx, f.ink, f.color ?? miss, f.hold ? 1 : 1 - t);
			}
		}
		ctx.globalAlpha = 1;
		if (live.length > 0 || fades.length > 0) raf = requestAnimationFrame(draw);
	}

	function schedule(): void {
		if (raf === 0) raf = requestAnimationFrame(draw);
	}

	function down(e: PointerEvent): void {
		if (finished || canvas === null) return;
		// A pointer whose up/cancel never arrived (failed capture) must not wedge the pad.
		if (activePointer !== null) {
			if (e.pointerId !== activePointer) return;
			activePointer = null;
			live = [];
		}
		if (!acceptsDown(e)) return;
		e.preventDefault();
		activePointer = e.pointerId;
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// Synthetic or already-released pointer: drawing still works.
		}
		live = [];
		appendInk(live, toPadUnit(e.clientX, e.clientY, canvas.getBoundingClientRect()));
		schedule();
	}

	function move(e: PointerEvent): void {
		if (e.pointerId !== activePointer || canvas === null) return;
		const rect = canvas.getBoundingClientRect();
		const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
		for (const c of batch.length > 0 ? batch : [e]) {
			appendInk(live, toPadUnit(c.clientX, c.clientY, rect));
		}
		schedule();
	}

	function up(e: PointerEvent): void {
		if (e.pointerId !== activePointer || canvas === null) return;
		activePointer = null;
		appendInk(live, toPadUnit(e.clientX, e.clientY, canvas.getBoundingClientRect()));
		const ink = live;
		live = [];
		judge(ink);
		schedule();
	}

	function cancel(e: PointerEvent): void {
		if (e.pointerId !== activePointer) return;
		activePointer = null;
		live = [];
		schedule();
	}

	function judge(ink: Pt[]): void {
		const result = matchStroke(ink, strokes.medians, quiz.next);
		const { state, effect } = applyResult(quiz, result);
		quiz = state;
		trace = quiz.trace;
		if (!('none' in effect)) {
			onChange?.({ mistakes: quiz.mistakes, remaining: quiz.total - quiz.next });
		}
		const now = performance.now();
		const instant = reduced();
		if ('snap' in effect) {
			filled = [...filled, ...effect.snap.filter((i) => !filled.includes(i))];
			if (!instant) {
				fades.push({
					ink,
					target: joinPaths(effect.snap.map((i) => strokes.medians[i])),
					start: now,
					duration: SNAP_MS,
					color: null
				});
			}
			if (quiz.complete) finish(false, instant ? 0 : SNAP_MS);
		} else if ('miss' in effect) {
			// Reduced motion keeps a static red cue instead of a fade.
			fades.push({ ink, target: null, start: now, duration: MISS_MS, color: null, hold: instant });
			if (effect.glow !== undefined) showGlow(effect.glow);
		}
	}

	function showGlow(stroke: number): void {
		glowToken += 1;
		const token = glowToken;
		glow = { stroke, token };
		later(() => {
			if (glow?.token === token) glow = null;
		}, GLOW_MS);
	}

	function finish(revealed: boolean, delay: number): void {
		finished = true;
		activePointer = null;
		live = [];
		const report = () => onComplete(outcomeOf(strokes.char, quiz, revealed), hintsOf(quiz));
		if (delay <= 0) report();
		else later(report, delay);
	}

	function reveal(): void {
		if (finished) return;
		finished = true;
		activePointer = null;
		live = [];
		const missing = strokes.medians.map((_, i) => i).filter((i) => !filled.includes(i));
		const step = reduced() ? 0 : REVEAL_STEP_MS;
		const report = () => onComplete(outcomeOf(strokes.char, quiz, true), hintsOf(quiz));
		if (step === 0) {
			filled = [...filled, ...missing];
			report();
			return;
		}
		missing.forEach((index, n) => {
			later(() => {
				filled = [...filled, index];
			}, n * step);
		});
		later(report, missing.length * step + SNAP_MS);
	}

	function hint(): void {
		if (finished) return;
		const { state, glow: target } = requestHint(quiz);
		quiz = state;
		showGlow(target);
	}

	// Signals: ignore the value present at mount, react to later increments.
	let seenReveal = untrack(() => revealSignal);
	let seenHint = untrack(() => hintSignal);
	$effect(() => {
		const r = revealSignal;
		if (r !== seenReveal) {
			seenReveal = r;
			untrack(reveal);
		}
	});
	$effect(() => {
		const h = hintSignal;
		if (h !== seenHint) {
			seenHint = h;
			untrack(hint);
		}
	});

	onMount(() => {
		if (canvas === null) return;
		ctx = canvas.getContext('2d');
		const fit = () => {
			if (canvas === null) return;
			dpr = window.devicePixelRatio || 1;
			side = canvas.clientWidth || side;
			canvas.width = Math.round(side * dpr);
			canvas.height = Math.round(side * dpr);
			schedule();
		};
		fit();
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
		observer?.observe(canvas);
		return () => {
			observer?.disconnect();
			if (raf !== 0) cancelAnimationFrame(raf);
			for (const id of timers) clearTimeout(id);
			timers.clear();
			ctx = null;
		};
	});

	function startPoint(index: number): Pt {
		return strokes.medians[index][0];
	}
</script>

<div
	class="pad"
	class:done={finished}
	data-card-input
	role="img"
	aria-label={label}
>
	<svg class="layer" viewBox="0 0 1024 1024" aria-hidden="true">
		<line x1="0" y1="0" x2="1024" y2="1024" class="grid diag" />
		<line x1="1024" y1="0" x2="0" y2="1024" class="grid diag" />
		<line x1="512" y1="0" x2="512" y2="1024" class="grid" />
		<line x1="0" y1="512" x2="1024" y2="512" class="grid" />
		<g transform="translate(0 900) scale(1 -1)">
			{#each strokes.outlines as outline, index (index)}
				<path
					d={outline}
					class="outline"
					class:filled={filled.includes(index)}
				/>
			{/each}
			{#if trace !== null && !filled.includes(trace)}
				<path d={strokes.outlines[trace]} class="trace" />
			{/if}
			{#if glow !== null}
				{#key glow.token}
					<path d={strokes.outlines[glow.stroke]} class="glow" />
				{/key}
			{/if}
		</g>
		{#if trace !== null && !filled.includes(trace)}
			<circle cx={startPoint(trace).x * 1024} cy={startPoint(trace).y * 1024} r="26" class="trace-start" />
		{/if}
		{#if glow !== null}
			{#key glow.token}
				<circle
					cx={startPoint(glow.stroke).x * 1024}
					cy={startPoint(glow.stroke).y * 1024}
					r="26"
					class="start"
				/>
			{/key}
		{/if}
	</svg>
	<canvas
		bind:this={canvas}
		class="layer ink"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={cancel}
		onlostpointercapture={cancel}
	></canvas>
</div>

<style>
	.pad {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		box-sizing: border-box;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		touch-action: none;
		user-select: none;
	}

	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	svg.layer {
		pointer-events: none;
	}

	.ink {
		touch-action: none;
		cursor: crosshair;
	}

	/* The guide lines: --hair, dashed (design §9). */
	.grid {
		stroke: var(--hair);
		stroke-width: 3;
		stroke-dasharray: 18 14;
	}

	.grid.diag {
		stroke-dasharray: 12 14;
		stroke-width: 2;
	}

	.outline {
		fill: var(--accent);
		opacity: 0;
		transition: opacity 140ms ease-out;
	}

	/* The stroke traced after three misses: only that stroke, faint, until it is drawn. */
	.trace,
	.trace-start {
		fill: currentColor;
		opacity: 0.18;
	}

	.outline.filled {
		opacity: 1;
	}

	/* The finished character is the correct state (design §5: colour where it
	   means something); the dots and the feedback words carry it as well. */
	.pad.done .outline {
		fill: var(--good);
	}

	.glow {
		fill: var(--warn);
		opacity: 0;
		animation: pulse 900ms ease-in-out 1;
	}

	.start {
		fill: var(--warn);
		animation: pulse 900ms ease-in-out 1 forwards;
		opacity: 0;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0;
		}
		35% {
			opacity: 0.85;
		}
	}

	@media (forced-colors: active) {
		.pad {
			border-color: ButtonText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.outline {
			transition: none;
		}
		.glow,
		.start {
			animation: none;
			opacity: 0.8;
		}
	}
</style>
