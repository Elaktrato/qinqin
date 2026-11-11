<script lang="ts">
	import type HanziWriter from 'hanzi-writer';
	import type { CharacterJson } from 'hanzi-writer';

	interface Props {
		char: string;
		size?: number;
	}

	let { char, size = 160 }: Props = $props();

	// Resolve every character file to an emitted asset URL at build time.
	// Only the URL map ships in the JS bundle; the JSON itself is fetched
	// lazily, and an uncovered character has no entry, so the player renders
	// nothing instead of requesting a 404.
	const charUrls: Record<string, string | undefined> = import.meta.glob(
		'/node_modules/hanzi-writer-data/*.json',
		{ query: '?url&no-inline', import: 'default', eager: true }
	);

	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	let failedUrl = $state<string | null>(null);
	let looping = $state(false);

	let writer: HanziWriter | null = null;

	const dataUrl = $derived(charUrls[`/node_modules/hanzi-writer-data/${char}.json`]);

	$effect(() => {
		const symbol = char;
		const url = dataUrl;
		// Read synchronously so a size change re-initialises the writer.
		const dimension = size;
		// Do not retry an asset that already failed for this character;
		// a different character (different URL) gets a fresh attempt.
		if (!url || url === failedUrl) return;
		const node = host;
		if (!node) return;

		let cancelled = false;
		ready = false;
		looping = false;

		void (async () => {
			try {
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
				if (!cancelled) failedUrl = url;
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

{#if dataUrl && failedUrl !== dataUrl}
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
