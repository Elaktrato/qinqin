<script lang="ts">
	// A reading's text. A pinyin reading is drawn with each syllable in the colour of its tone when the Tone
	// colours aid is on, and with its contour under it when the Tone contour aid is on (#212; two switches since
	// the owner ruling of 2026-11-26); any other reading, or both off, is the plain text.
	// The contour is the cue that is not a colour: it stays when colours are forced or cannot be told apart.
	// The colours come from the painted theme (aids/tones.ts). Motion: none.
	import { TONE_CONTOURS, toneName, toneSegments } from './tones';
	import { useVisualAids } from './useAids';

	// `force` draws colours and contour whatever the switches say; `colors` and `contour` decide one each (the
	// previews in Settings).
	let {
		value,
		type = 'pinyin',
		force = false,
		colors,
		contour
	}: { value: string; type?: string; force?: boolean; colors?: boolean; contour?: boolean } = $props();
	const view = useVisualAids();
	const pinyin = $derived(type.trim().toLowerCase() === 'pinyin');
	const withColors = $derived(pinyin && (colors ?? (force || view.aids.toneColors)));
	const withContour = $derived(pinyin && (contour ?? (force || view.aids.toneContour)));
	const on = $derived(withColors || withContour);
	const segments = $derived(on ? toneSegments(value) : []);
</script>

{#if !on}{value}{:else}<span class="tones" style={view.toneStyle}
		>{#each segments as segment, i (i)}{#if segment.tone === null}{segment.text}{:else}<span
					class="syl"
					class:with-contour={withContour}
					data-tone={segment.tone}
					style:color={withColors ? `var(--tone-${segment.tone})` : undefined}
					title={toneName(segment.tone)}
					>{segment.text}{#if withContour}<svg class="contour" viewBox="0 0 10 10" aria-hidden="true" focusable="false"
							><path d={TONE_CONTOURS[segment.tone].path} /></svg
						>{/if}</span
				>{/if}{/each}</span
	>{/if}

<style>
	.syl {
		position: relative;
		display: inline-block;
	}
	.with-contour {
		padding-bottom: 0.3em;
	}
	.contour {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		margin-inline: auto;
		width: 0.7em;
		height: 0.3em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		overflow: visible;
	}
	@media (forced-colors: active) {
		/* The system picks the text colour; the contour (currentColor) keeps the tone readable. */
		.syl {
			color: CanvasText !important;
		}
	}
</style>
