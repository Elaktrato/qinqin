<script lang="ts">
	import type HanziWriter from 'hanzi-writer';
	import type { CharacterJson } from 'hanzi-writer';

	interface Props {
		char: string;
		size?: number;
	}

	let { char, size = 160 }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	let unavailableFor = $state<string | null>(null);
	let looping = $state(false);

	let writer: HanziWriter | null = null;

	$effect(() => {
		const symbol = char;
		const node = host;
		// Read synchronously so a size change re-initialises the writer.
		const dimension = size;
		// Do not retry a character whose data is missing or failed; a
		// different character gets a fresh attempt.
		if (!node || unavailableFor === symbol) return;

		let cancelled = false;
		ready = false;
		looping = false;

		void (async () => {
			try {
				// The URL map is its own lazy chunk: it must not ride along
				// with the entry page for every non-stroke entry.
				const { hanziDataUrl } = await import('$lib/hanzi-data-urls');
				if (cancelled) return;
				const url = hanziDataUrl(symbol);
				if (!url) {
					unavailableFor = symbol;
					return;
				}
				const [module, response] = await Promise.all([import('hanzi-writer'), fetch(url)]);
				if (cancelled) return;
				if (!response.ok) throw new Error(`No stroke data for ${symbol}`);
				const data = (await response.json()) as CharacterJson;
				if (cancelled) return;
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
				if (!cancelled) unavailableFor = symbol;
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
		void writer.animateCharacter();
	}

	function toggleLoop(): void {
		if (!writer) return;
		looping = !looping;
		if (looping) {
			void writer.loopCharacterAnimation();
		} else {
			// Stop the loop and settle on the fully drawn character.
			void writer.showCharacter();
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
