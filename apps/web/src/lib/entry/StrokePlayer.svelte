<script lang="ts">
	import type HanziWriter from 'hanzi-writer';
	import type { CharacterJson } from 'hanzi-writer';
	import { fetchStrokeData } from '$lib/study/strokeData';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	interface Props {
		char: string;
		size?: number;
	}

	let { char, size = 160 }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	// A character with no stroke data at all: the failed text, never an empty box.
	let unavailableFor = $state<string | null>(null);
	// A transient failure: the failed text with Try again.
	let failedFor = $state<string | null>(null);
	// Bumped by Try again to run the load effect once more.
	let attempt = $state(0);
	let looping = $state(false);
	let playing = $state(false);
	// The stroke being drawn and the character's total, for "勤 · 3 of 13".
	let progress = $state(0);
	let total = $state(0);
	// Bumped to stop a running per-stroke animation (Pause, a new character).
	let run = 0;

	let writer: HanziWriter | null = null;

	$effect(() => {
		const symbol = char;
		const node = host;
		// Read synchronously so a size change re-initialises the writer.
		const dimension = size;
		void attempt;
		// A definitively missing character is not retried; a different
		// character gets a fresh attempt.
		if (!node || unavailableFor === symbol) return;

		let cancelled = false;
		ready = false;
		looping = false;
		playing = false;
		progress = 0;
		total = 0;
		failedFor = null;

		void (async () => {
			try {
				// The server serves the stroke data package under /hanzi/ with
				// codepoint names (U597D.json); fetchStrokeData builds
				// the URL, caches good and missing results and never caches a
				// transient failure.
				if (symbol.codePointAt(0) === undefined) {
					unavailableFor = symbol;
					return;
				}
				const [module, result] = await Promise.all([import('hanzi-writer'), fetchStrokeData(session.caches.strokes, symbol)]);
				if (cancelled) return;
				if (result.kind === 'missing') {
					unavailableFor = symbol;
					return;
				}
				if (result.kind === 'error') {
					failedFor = symbol;
					return;
				}
				const data = result.data as CharacterJson;
				total = data.strokes?.length ?? 0;
				// The player follows the theme (design §6): the stroke is the
				// readable accent, the outline the line colour, read at runtime.
				const style = getComputedStyle(node);
				writer = module.default.create(node, symbol, {
					width: dimension,
					height: dimension,
					padding: 8,
					showOutline: true,
					strokeColor: style.getPropertyValue('--accent').trim() || 'currentColor',
					outlineColor: style.getPropertyValue('--line').trim() || 'currentColor',
					// Feed the self-hosted data; never hit the CDN.
					charDataLoader: (_char, onLoad) => {
						onLoad(data);
					}
				});
				ready = true;
			} catch {
				// hanzi-writer itself failed to load or start: worth a retry.
				if (!cancelled) failedFor = symbol;
			}
		})();

		return () => {
			cancelled = true;
			run++;
			ready = false;
			looping = false;
			playing = false;
			progress = 0;
			total = 0;
			const active = writer;
			writer = null;
			if (active) void active.pauseAnimation().catch(() => {});
			// hanzi-writer has no destroy(); drop its SVG so a new
			// character does not stack on top of the old one.
			node.replaceChildren();
		};
	});

	async function play(): Promise<void> {
		if (!writer) return;
		if (playing) {
			pause();
			return;
		}
		// A one-shot animation replaces any running loop.
		looping = false;
		playing = true;
		const mine = ++run;
		progress = 0;
		for (let i = 0; i < total; i++) {
			if (mine !== run || !playing) return;
			progress = i + 1;
			let failed = false;
			await writer.animateStroke(i).catch(() => {
				failed = true;
			});
			if (failed || mine !== run) {
				playing = false;
				return;
			}
		}
		if (mine === run) playing = false;
	}

	/** Pause stops before the next stroke; the button becomes Play. */
	function pause(): void {
		if (!playing) return;
		playing = false;
		run++;
		void writer?.pauseAnimation().catch(() => {});
	}

	/** Try again clears the failure first: the canvas must exist for the load effect. */
	function retry(): void {
		failedFor = null;
		attempt++;
	}

	function toggleLoop(): void {
		if (!writer) return;
		looping = !looping;
		if (looping) {
			playing = false;
			run++;
			writer.loopCharacterAnimation().catch(() => {});
		} else {
			// Stop the loop and settle on the fully drawn character.
			writer.showCharacter().catch(() => {});
		}
	}
</script>

{#if unavailableFor === char || failedFor === char}
	<div class="stroke-player">
		<p class="note" role="status">{t('entry.strokes.failed')}</p>
		{#if failedFor === char}
			<div class="controls">
				<button type="button" class="retry" onclick={retry}>{t('common.action.retry')}</button>
			</div>
		{/if}
	</div>
{:else}
	<div class="stroke-player">
		<div
			class="canvas"
			bind:this={host}
			style:width={`${size}px`}
			style:height={`${size}px`}
			role="img"
			aria-label={t('entry.strokes.label', { char })}
		></div>
		{#if !ready}
			<!-- Holds the space and says what is happening, so the page does not jump. -->
			<p class="note" style:width={`${size}px`}>
				{t('entry.strokes.loading')}
			</p>
		{/if}
		{#if ready}
			<div class="controls">
				<Button icon={playing ? 'pause' : 'play'} onclick={() => void play()}
					>{playing ? t('entry.strokes.pause') : t('entry.strokes.play')}</Button
				>
				<Button icon="repeat" aria-pressed={looping} onclick={toggleLoop}>{t('entry.strokes.loop')}</Button>
			</div>
			{#if total > 0}
				<p class="progress" data-progress aria-live="off">
					{t('entry.strokes.progress', { char, n: progress, total })}
				</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.stroke-player {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.canvas {
		/* Transparent: the stroke SVG is the only thing painted. */
		background: transparent;
	}

	.note {
		/* The height of the controls row that replaces it, so nothing jumps. */
		min-height: 2rem;
		display: flex;
		align-items: center;
		margin: 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.controls {
		display: flex;
		align-items: center;
		min-height: 2rem;
		gap: 0.5rem;
	}

	.retry {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.retry:hover,
	.retry:focus-visible {
		border-color: var(--accent);
	}

	.progress {
		margin: 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
