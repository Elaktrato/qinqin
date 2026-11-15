<script lang="ts">
	import type HanziWriter from 'hanzi-writer';
	import type { CharacterJson } from 'hanzi-writer';
	import { fetchStrokeData } from '$lib/study/strokeData';

	interface Props {
		char: string;
		size?: number;
	}

	let { char, size = 160 }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	// A character with no stroke data at all (404): the player stays hidden.
	let unavailableFor = $state<string | null>(null);
	// A transient failure: the player shows a note with Try again.
	let failedFor = $state<string | null>(null);
	// Bumped by Try again to run the load effect once more.
	let attempt = $state(0);
	let looping = $state(false);

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
		failedFor = null;

		void (async () => {
			try {
				// The stroke data is copied into static/hanzi by the prebuild
				// step under codepoint names (U597D.json); fetchStrokeData builds
				// the URL, caches good and missing results and never caches a
				// transient failure.
				if (symbol.codePointAt(0) === undefined) {
					unavailableFor = symbol;
					return;
				}
				const [module, result] = await Promise.all([import('hanzi-writer'), fetchStrokeData(symbol)]);
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
				writer = module.default.create(node, symbol, {
					width: dimension,
					height: dimension,
					padding: 8,
					showOutline: true,
					strokeColor: '#0b6bcb',
					outlineColor: '#9aa0a6',
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
			ready = false;
			looping = false;
			const active = writer;
			writer = null;
			if (active) void active.pauseAnimation().catch(() => {});
			// hanzi-writer has no destroy(); drop its SVG so a new
			// character does not stack on top of the old one.
			node.replaceChildren();
		};
	});

	function play(): void {
		if (!writer) return;
		// A one-shot animation replaces any running loop.
		looping = false;
		writer.animateCharacter().catch(() => {});
	}

	function toggleLoop(): void {
		if (!writer) return;
		looping = !looping;
		if (looping) {
			writer.loopCharacterAnimation().catch(() => {});
		} else {
			// Stop the loop and settle on the fully drawn character.
			writer.showCharacter().catch(() => {});
		}
	}
</script>

{#if unavailableFor !== char}
	<div class="stroke-player">
		<div
			class="canvas"
			bind:this={host}
			style:width={`${size}px`}
			style:height={`${size}px`}
			role="img"
			aria-label={`Stroke order for ${char}`}
		></div>
		{#if !ready && failedFor !== char}
			<!-- Holds the space and says what is happening, so the page does not jump. -->
			<p class="note" role="status" aria-live="polite" style:width={`${size}px`}>
				Loading stroke order…
			</p>
		{/if}
		{#if failedFor === char}
			<p class="note" role="status">Stroke order could not be loaded.</p>
			<div class="controls">
				<button type="button" onclick={() => attempt++}>Try again</button>
			</div>
		{/if}
		{#if ready}
			<div class="controls">
				<button type="button" onclick={play}>Play</button>
				<button
					type="button"
					class="loop"
					aria-pressed={looping}
					onclick={toggleLoop}>Loop</button
				>
			</div>
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
		opacity: 0.65;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
	}

	.controls button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.controls button:hover,
	.controls button:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	.controls .loop[aria-pressed='true'] {
		border-color: #0b6bcb;
		color: #0b6bcb;
		background: color-mix(in srgb, #0b6bcb 12%, transparent);
	}
</style>
