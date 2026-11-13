<script lang="ts">
	import type { Entry } from '$lib/api/types';
	import {
		pinyinReadings,
		toneCandidates,
		toneVerdict,
		type CardResult,
		type FlowItem,
		type ToneVerdict
	} from '$lib/study/cardFlow';
	import { suggestToneGrade, toneFromGesture, type GesturePoint, type Tone } from '$lib/study/tones';

	interface Props {
		item: FlowItem;
		entry: Entry;
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, done, onDone }: Props = $props();

	const TONES: { tone: Tone; glyph: string; name: string }[] = [
		{ tone: 1, glyph: 'ˉ', name: 'first tone, high level' },
		{ tone: 2, glyph: 'ˊ', name: 'second tone, rising' },
		{ tone: 3, glyph: 'ˇ', name: 'third tone, dipping' },
		{ tone: 4, glyph: 'ˋ', name: 'fourth tone, falling' },
		{ tone: 5, glyph: '·', name: 'neutral tone' }
	];

	// Contours in a 100×100 box, y down (Chao tone letters 55, 35, 214, 51).
	const CONTOUR: Record<Tone, string> = {
		1: 'M12 22 L88 22',
		2: 'M12 62 L88 18',
		3: 'M12 42 Q42 98 88 26',
		4: 'M12 16 L88 86',
		5: ''
	};

	const candidates = $derived(toneCandidates(entry.readings));
	// The first clean reading decides the syllables shown; any reading
	// with the same syllable count is accepted when checking.
	const syllables = $derived(candidates[0] ?? []);
	const allReadings = $derived(pinyinReadings(entry.readings));

	let chosen = $state<(Tone | null)[]>([]);
	let active = $state(0);
	let verdict = $state<ToneVerdict | null>(null);
	let trace = $state<GesturePoint[]>([]);
	let tracing = $state<number | null>(null);
	let announcement = $state('');
	let pads = $state<(HTMLElement | null)[]>([]);

	$effect(() => {
		// One slot per syllable; the card is keyed per item, so this runs once.
		const count = syllables.length;
		chosen = Array.from({ length: count }, () => null);
	});

	const complete = $derived(chosen.length > 0 && chosen.every((tone) => tone !== null));

	function nameOf(tone: Tone): string {
		return TONES[tone - 1].name;
	}

	function setTone(index: number, tone: Tone): void {
		if (done || index < 0 || index >= chosen.length) return;
		chosen = chosen.map((current, i) => (i === index ? tone : current));
		announcement = `Syllable ${index + 1}: ${nameOf(tone)}.`;
		if (index === active && active < chosen.length - 1) active += 1;
	}

	function check(): void {
		if (done || !complete) return;
		const result = toneVerdict(chosen as Tone[], candidates);
		verdict = result;
		announcement = result.correct
			? 'Correct!'
			: `${result.wrong} ${result.wrong === 1 ? 'tone' : 'tones'} wrong.`;
		onDone({ suggested: suggestToneGrade(result.wrong), meta: { mistakes: result.wrong } });
	}

	function point(event: PointerEvent, pad: HTMLElement): GesturePoint {
		const rect = pad.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function onPointerDown(event: PointerEvent, index: number): void {
		// Primary pointer only, and for a mouse only the main button: a
		// right-click must not set a tone.
		if (done || !event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const pad = event.currentTarget as HTMLElement;
		event.preventDefault();
		pad.setPointerCapture(event.pointerId);
		active = index;
		tracing = index;
		trace = [point(event, pad)];
	}

	function onPointerMove(event: PointerEvent, index: number): void {
		if (tracing !== index || !event.isPrimary) return;
		trace = [...trace, point(event, event.currentTarget as HTMLElement)];
	}

	function onPointerUp(event: PointerEvent, index: number): void {
		if (tracing !== index || !event.isPrimary) return;
		const path = [...trace, point(event, event.currentTarget as HTMLElement)];
		tracing = null;
		trace = [];
		setTone(index, toneFromGesture(path));
	}

	function onPointerCancel(): void {
		tracing = null;
		trace = [];
	}

	function isTextField(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			target.closest('input, textarea, select, [contenteditable="true"]') !== null
		);
	}

	function isActivatable(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && target.closest('button, a') !== null;
	}

	/**
	 * Until the answer is checked this card owns the keyboard: 1–5 set the
	 * highlighted syllable's tone, arrows move, Backspace clears, Enter
	 * checks. The runner ignores keys while a tone card is unchecked.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (done || event.defaultPrevented || event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTextField(event.target)) return;

		if (/^[1-5]$/.test(event.key)) {
			event.preventDefault();
			setTone(active, Number(event.key) as Tone);
			return;
		}
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				active = Math.max(0, active - 1);
				return;
			case 'ArrowRight':
				event.preventDefault();
				active = Math.min(chosen.length - 1, active + 1);
				return;
			case 'Backspace':
				event.preventDefault();
				if (chosen[active] === null && active > 0) active -= 1;
				chosen = chosen.map((tone, i) => (i === active ? null : tone));
				return;
			case 'Enter':
				// A focused button activates natively; do not check twice.
				if (isActivatable(event.target)) return;
				event.preventDefault();
				check();
				return;
		}
	}

	function polyline(points: GesturePoint[], pad: HTMLElement | null): string {
		if (pad === null) return '';
		const { width, height } = pad.getBoundingClientRect();
		if (width === 0 || height === 0) return '';
		return points.map((p) => `${(p.x / width) * 100},${(p.y / height) * 100}`).join(' ');
	}

</script>

<svelte:window onkeydown={onKeydown} />

<p class="written" lang="zh">{entry.written}</p>
<p class="prompt">
	Swipe each pad in the tone's shape (a tap is the neutral tone), use the buttons, or press 1–5.
</p>

<ol class="syllables" aria-label="Syllables" data-card-input>
	{#each syllables as syllable, index (index)}
		{@const tone = chosen[index] ?? null}
		{@const mark = verdict?.marks[index]}
		<li class="syllable" class:active={index === active && !done}>
			<div
				class="pad"
				class:right={mark === true}
				class:wrong={mark === false}
				bind:this={pads[index]}
				role="img"
				aria-label={`Syllable ${index + 1}, ${syllable.plain}: ${tone === null ? 'no tone yet' : nameOf(tone)}`}
				onpointerdown={(event) => onPointerDown(event, index)}
				onpointermove={(event) => onPointerMove(event, index)}
				onpointerup={(event) => onPointerUp(event, index)}
				onpointercancel={onPointerCancel}
			>
				<svg viewBox="0 0 100 100" aria-hidden="true" class="contour">
					{#if tone !== null}
						{#if tone === 5}
							<circle cx="50" cy="56" r="7" />
						{:else}
							<path d={CONTOUR[tone]} />
						{/if}
					{/if}
					{#if tracing === index && trace.length > 1}
						<polyline class="trace" points={polyline(trace, pads[index] ?? null)} />
					{/if}
				</svg>
				<span class="plain">{syllable.plain}</span>
			</div>
			<div class="tone-buttons" role="group" aria-label={`Tone for ${syllable.plain}`}>
				{#each TONES as option (option.tone)}
					<button
						type="button"
						class:selected={tone === option.tone}
						aria-pressed={tone === option.tone}
						aria-label={`${option.tone}: ${option.name}`}
						disabled={done}
						onclick={() => {
							active = index;
							setTone(index, option.tone);
						}}
					>
						<span aria-hidden="true">{option.tone}{option.glyph}</span>
					</button>
				{/each}
			</div>
			{#if verdict !== null}
				<p class="answer" class:right={mark === true} class:wrong={mark === false}>
					{verdict.best?.[index]?.text ?? syllable.text}
				</p>
			{/if}
		</li>
	{/each}
</ol>

{#if !done}
	<button type="button" class="primary" disabled={!complete} onclick={check}>Check</button>
{/if}

<p class="feedback" class:bad={verdict !== null && !verdict.correct} role="status" aria-live="polite">
	{announcement}
</p>

{#if done}
	<p class="readings">
		Pinyin: <strong>{allReadings.join(' / ')}</strong>
	</p>
{/if}

<style>
	.written {
		margin: 0;
		font-size: 2.75rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.prompt {
		margin: 0.35rem 0 0;
		opacity: 0.75;
	}

	.syllables {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.syllable {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
	}

	.pad {
		position: relative;
		width: 7.5rem;
		height: 7.5rem;
		border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.6rem;
		display: grid;
		place-items: end center;
		cursor: crosshair;
		/* Swipes are gestures, never scrolls. */
		touch-action: none;
		user-select: none;
	}

	.syllable.active .pad {
		border-color: #0b6bcb;
	}

	.pad.right {
		border-color: #2e7d32;
	}

	.pad.wrong {
		border-color: #c62828;
	}

	.contour {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: none;
		stroke: #0b6bcb;
		stroke-width: 6;
		stroke-linecap: round;
	}

	.contour circle {
		fill: #0b6bcb;
		stroke: none;
	}

	.contour .trace {
		stroke: color-mix(in srgb, currentColor 45%, transparent);
		stroke-width: 4;
	}

	.plain {
		position: relative;
		margin-bottom: 0.35rem;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.tone-buttons {
		display: flex;
		gap: 0.2rem;
	}

	.tone-buttons button {
		min-width: 1.6rem;
		padding: 0.2rem 0.3rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.3rem;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.tone-buttons button.selected {
		border-color: #0b6bcb;
		background: color-mix(in srgb, #0b6bcb 15%, transparent);
	}

	.answer {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.right {
		color: #2e7d32;
	}

	.wrong {
		color: #c62828;
	}

	.pad.right,
	.pad.wrong {
		color: inherit;
	}

	.primary {
		margin-top: 1rem;
		padding: 0.45rem 0.9rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0.75rem 0 0;
		font-weight: 600;
		color: #2e7d32;
	}

	.feedback.bad {
		color: #c62828;
	}

	.readings {
		margin: 0.25rem 0 0;
	}
</style>
