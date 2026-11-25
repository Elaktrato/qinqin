<script lang="ts">
	// A reading's text. A pinyin reading is drawn with each syllable in the colour of its tone and its contour
	// under it when the Tone colours aid is on (#212); any other reading, or the aid off, is the plain text.
	// The contour is the cue that is not a colour: it stays when colours are forced or cannot be told apart.
	// The colours come from the painted theme (aids/tones.ts). Motion: none.
	import { TONE_CONTOURS, toneName, toneSegments } from './tones';
	import { useVisualAids } from './useAids';

	// `force` draws the colours whatever the switch says (the preview in Settings).
	let { value, type = 'pinyin', force = false }: { value: string; type?: string; force?: boolean } = $props();
	const view = useVisualAids();
	const on = $derived(type.trim().toLowerCase() === 'pinyin' && (force || view.aids.toneColors));
	const segments = $derived(on ? toneSegments(value) : []);
</script>

{#if !on}{value}{:else}<span class="tones" style={view.toneStyle}
		>{#each segments as segment, i (i)}{#if segment.tone === null}{segment.text}{:else}<span
					class="syl"
					data-tone={segment.tone}
					style:color={`var(--tone-${segment.tone})`}
					title={toneName(segment.tone)}
					>{segment.text}<svg class="contour" viewBox="0 0 10 10" aria-hidden="true" focusable="false"
						><path d={TONE_CONTOURS[segment.tone].path} /></svg
					></span
				>{/if}{/each}</span
	>{/if}

<style>
	.syl {
		position: relative;
		display: inline-block;
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
